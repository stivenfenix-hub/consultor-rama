import "server-only";
import { prisma } from "./db";
import { ensureColumn } from "./runtime-columns";
import { revisarProcesoManual } from "./sync-queue";
import { sendPushToUser } from "./push";

// Límites de actualización MANUAL (el cron diario no cuenta):
//  - "Actualizar todos": una vez por semana por usuario, en segundo plano y por tandas.
//  - Un proceso: una vez por día (día calendario de Colombia).
// Solo cuenta si la actualización funcionó. El admin no tiene límite.

const SEMANA_MS = 7 * 24 * 60 * 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;
const BOGOTA_OFFSET_MS = -5 * 60 * 60 * 1000; // UTC-5, sin horario de verano
// Si una corrida quedó marcada "en curso" más de esto, se da por caída.
const CORRIDA_MAX_MS = 2 * 60 * 60 * 1000;

const TANDA = 5; // procesos por tanda
const PAUSA_PROCESO_MS = 2000; // entre procesos
const PAUSA_TANDA_MS = 15000; // entre tandas

async function ensureColumns() {
  await ensureColumn("User", "manualRefreshAllAt", "TIMESTAMPTZ");
  await ensureColumn("User", "refreshAllStartedAt", "TIMESTAMPTZ");
  await ensureColumn("Case", "manualRefreshAt", "TIMESTAMPTZ");
  await ensureColumn("User", "sinLimiteManual", "BOOLEAN NOT NULL DEFAULT false");
}

/** El admin y los usuarios que el root marque no tienen límite manual. */
export async function sinLimiteManual(user: { id: string; role: string }): Promise<boolean> {
  if (user.role === "admin") return true;
  try {
    await ensureColumns();
    const rows = await prisma.$queryRawUnsafe<{ v: boolean }[]>(
      `SELECT "sinLimiteManual" AS v FROM "User" WHERE id = $1`,
      user.id,
    );
    return !!rows[0]?.v;
  } catch {
    return false;
  }
}

export async function cambiarSinLimiteManual(userId: string, valor: boolean) {
  await ensureColumns();
  await prisma.$executeRawUnsafe(
    `UPDATE "User" SET "sinLimiteManual" = $2 WHERE id = $1`,
    userId,
    valor,
  );
}

/** Inicio del día siguiente (medianoche de Colombia) a partir de una fecha. */
function siguienteDiaBogota(d: Date): Date {
  const local = d.getTime() + BOGOTA_OFFSET_MS;
  const inicioDiaLocal = Math.floor(local / DIA_MS) * DIA_MS;
  return new Date(inicioDiaLocal + DIA_MS - BOGOTA_OFFSET_MS);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type RefreshAllStatus = {
  enCurso: boolean;
  /** Cuándo vuelve a estar disponible (ISO), o null si ya se puede. */
  disponibleEn: string | null;
};

export async function estadoActualizarTodos(
  userId: string,
  esAdmin: boolean,
): Promise<RefreshAllStatus> {
  try {
    await ensureColumns();
    const rows = await prisma.$queryRawUnsafe<
      { last: Date | null; started: Date | null }[]
    >(
      `SELECT "manualRefreshAllAt" AS last, "refreshAllStartedAt" AS started
       FROM "User" WHERE id = $1`,
      userId,
    );
    const r = rows[0];
    const enCurso =
      !!r?.started && Date.now() - new Date(r.started).getTime() < CORRIDA_MAX_MS;
    let disponibleEn: string | null = null;
    if (!esAdmin && r?.last) {
      const next = new Date(new Date(r.last).getTime() + SEMANA_MS);
      if (next.getTime() > Date.now()) disponibleEn = next.toISOString();
    }
    return { enCurso, disponibleEn };
  } catch {
    return { enCurso: false, disponibleEn: null };
  }
}

/**
 * Intenta iniciar "Actualizar todos". Devuelve un mensaje de error si no se
 * puede, o null si se inició; la corrida la ejecuta `ejecutar` (en segundo plano).
 */
export async function reservarActualizarTodos(
  userId: string,
  esAdmin: boolean,
): Promise<string | null> {
  const estado = await estadoActualizarTodos(userId, esAdmin);
  if (estado.enCurso) return "Ya hay una actualización en curso.";
  if (estado.disponibleEn) return "Ya usaste la actualización de esta semana.";
  // Reserva atómica: evita dos corridas a la vez (doble clic, dos pestañas).
  const reservado = await prisma.$executeRawUnsafe(
    `UPDATE "User" SET "refreshAllStartedAt" = now()
     WHERE id = $1 AND ("refreshAllStartedAt" IS NULL
       OR "refreshAllStartedAt" < now() - interval '2 hours')`,
    userId,
  );
  return reservado === 1 ? null : "Ya hay una actualización en curso.";
}

/** Corre la actualización de todos los procesos del usuario, por tandas. */
export async function ejecutarActualizarTodos(userId: string) {
  const inicio = Date.now();
  let ok = 0;
  let fallidos = 0;
  let nuevas = 0;
  try {
    const casos = await prisma.case.findMany({
      where: { userId },
      select: { id: true },
      orderBy: { lastSyncedAt: "asc" }, // primero los más desactualizados
    });
    for (let i = 0; i < casos.length; i++) {
      if (i > 0) await sleep(i % TANDA === 0 ? PAUSA_TANDA_MS : PAUSA_PROCESO_MS);
      try {
        const r = await revisarProcesoManual(casos[i].id);
        nuevas += r.nuevas;
        ok++;
      } catch {
        fallidos++;
      }
    }
    // Solo cuenta como uso semanal si al menos un proceso se actualizó.
    await prisma.$executeRawUnsafe(
      ok > 0
        ? `UPDATE "User" SET "refreshAllStartedAt" = NULL, "manualRefreshAllAt" = now() WHERE id = $1`
        : `UPDATE "User" SET "refreshAllStartedAt" = NULL WHERE id = $1`,
      userId,
    );
    if (nuevas > 0) {
      await sendPushToUser(userId, {
        title: "Actualización terminada",
        body: `Encontramos ${nuevas} actuación(es) nueva(s) en tus procesos.`,
        url: "/dashboard",
        tag: "actuaciones",
      }).catch(() => {});
    }
    console.log(
      `[actualizar-todos] ${userId}: ${ok} ok, ${fallidos} fallidos, ${nuevas} nuevas, ${Date.now() - inicio} ms`,
    );
  } catch (e) {
    console.error("[actualizar-todos] error", e);
    await prisma
      .$executeRawUnsafe(`UPDATE "User" SET "refreshAllStartedAt" = NULL WHERE id = $1`, userId)
      .catch(() => {});
  }
}

/** Cuándo se puede volver a actualizar manualmente un proceso (ISO) o null. */
export async function proximaActualizacionProceso(
  caseId: string,
  esAdmin: boolean,
): Promise<string | null> {
  if (esAdmin) return null;
  try {
    await ensureColumns();
    const rows = await prisma.$queryRawUnsafe<{ last: Date | null }[]>(
      `SELECT "manualRefreshAt" AS last FROM "Case" WHERE id = $1`,
      caseId,
    );
    const last = rows[0]?.last;
    if (!last) return null;
    const next = siguienteDiaBogota(new Date(last));
    return next.getTime() > Date.now() ? next.toISOString() : null;
  } catch {
    return null;
  }
}

export async function marcarActualizacionProceso(caseId: string) {
  await ensureColumns();
  await prisma.$executeRawUnsafe(
    `UPDATE "Case" SET "manualRefreshAt" = now() WHERE id = $1`,
    caseId,
  );
}
