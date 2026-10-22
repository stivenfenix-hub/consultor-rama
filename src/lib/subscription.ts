import "server-only";
import { prisma } from "./db";
import { ensureColumn } from "./runtime-columns";

// Suscripción: prueba gratis de N días y luego plan mensual pagado con Bold
// (link de pago: tarjeta, PSE, Nequi, Botón Bancolombia). Bold no cobra
// automáticamente cada mes, así que cada pago suma 30 días de acceso.
//
// Variables de entorno:
//   BOLD_API_KEY     llave de identidad del Botón de pagos (crea y consulta links)
//   BOLD_SECRET_KEY  llave secreta (firma de los webhooks; vacía en pruebas)

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const BOLD_API = "https://integrations.api.bold.co";
const DIA_MS = 24 * 60 * 60 * 1000;
const DIAS_POR_PAGO = 30;
// Usuarios creados antes de lanzar los cobros: su prueba empieza este día.
const LANZAMIENTO = new Date("2026-10-22T05:00:00Z");

export const PLAN_DEFAULTS = { precio: 24900, diasPrueba: 30 };

export function boldConfigurado() {
  return !!process.env.BOLD_API_KEY;
}

// ---------- Esquema (columnas/tabla creadas en tiempo de ejecución) ----------
let esquemaListo = false;
async function ensureSchema() {
  if (esquemaListo) return;
  await ensureColumn("User", "trialEndsAt", "TIMESTAMPTZ");
  await ensureColumn("User", "paidUntil", "TIMESTAMPTZ");
  await ensureColumn("User", "subNoticeFor", "TIMESTAMPTZ");
  await ensureColumn("User", "subExpiredFor", "TIMESTAMPTZ");
  await ensureColumn("SiteSetting", "planPrice", "INTEGER");
  await ensureColumn("SiteSetting", "trialDays", "INTEGER");
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BoldPayment" (
      id TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
      amount INTEGER NOT NULL,
      status TEXT NOT NULL,
      url TEXT,
      "paymentId" TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "paidAt" TIMESTAMPTZ
    )`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BoldEvent" (
      id SERIAL PRIMARY KEY,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      tipo TEXT NOT NULL,
      detalle TEXT NOT NULL
    )`);
  esquemaListo = true;
}

/** Registro de eventos de Bold (webhooks y consultas) para soporte. */
export async function logBold(tipo: string, detalle: unknown) {
  try {
    await ensureSchema();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "BoldEvent" (tipo, detalle) VALUES ($1, $2)`,
      tipo,
      (typeof detalle === "string" ? detalle : JSON.stringify(detalle)).slice(0, 2000),
    );
  } catch (e) {
    console.error("[bold] log", e);
  }
}

export async function eventosBold() {
  await ensureSchema();
  return prisma.$queryRawUnsafe<{ id: number; createdAt: Date; tipo: string; detalle: string }[]>(
    `SELECT id, "createdAt", tipo, detalle FROM "BoldEvent" ORDER BY id DESC LIMIT 20`,
  );
}

// ---------- Plan (precio y días de prueba, editables por el root) ----------
export async function getPlan(): Promise<{ precio: number; diasPrueba: number }> {
  try {
    await ensureSchema();
    const rows = await prisma.$queryRawUnsafe<
      { p: number | null; d: number | null }[]
    >(`SELECT "planPrice" AS p, "trialDays" AS d FROM "SiteSetting" WHERE id = 'site'`);
    return {
      precio: rows[0]?.p ?? PLAN_DEFAULTS.precio,
      diasPrueba: rows[0]?.d ?? PLAN_DEFAULTS.diasPrueba,
    };
  } catch {
    return PLAN_DEFAULTS;
  }
}

export async function savePlan(precio: number, diasPrueba: number) {
  await ensureSchema();
  await prisma.siteSetting.upsert({
    where: { id: "site" },
    create: { id: "site" },
    update: {},
  });
  await prisma.$executeRawUnsafe(
    `UPDATE "SiteSetting" SET "planPrice" = $1, "trialDays" = $2 WHERE id = 'site'`,
    precio,
    diasPrueba,
  );
}

// ---------- Estado de la suscripción ----------
export type EstadoSub = "admin" | "prueba" | "activa" | "vencida";
export type Suscripcion = {
  estado: EstadoSub;
  /** Hasta cuándo tiene acceso (fin de la prueba o del último pago). */
  accesoHasta: Date | null;
  trialEndsAt: Date | null;
  paidUntil: Date | null;
  diasRestantes: number;
};

type FilaSub = {
  id: string;
  role: string;
  createdAt: Date;
  trialEndsAt: Date | null;
  paidUntil: Date | null;
};

function calcular(u: FilaSub, diasPrueba: number): Suscripcion & { trialNuevo: boolean } {
  let trial = u.trialEndsAt ? new Date(u.trialEndsAt) : null;
  let trialNuevo = false;
  if (!trial) {
    const inicio = new Date(Math.max(new Date(u.createdAt).getTime(), LANZAMIENTO.getTime()));
    trial = new Date(inicio.getTime() + diasPrueba * DIA_MS);
    trialNuevo = true;
  }
  const paid = u.paidUntil ? new Date(u.paidUntil) : null;
  const hasta = new Date(Math.max(trial.getTime(), paid?.getTime() ?? 0));
  const ahora = Date.now();
  const diasRestantes = Math.max(0, Math.ceil((hasta.getTime() - ahora) / DIA_MS));
  let estado: EstadoSub;
  if (u.role === "admin") estado = "admin";
  else if (paid && paid.getTime() > ahora) estado = "activa";
  else if (trial.getTime() > ahora) estado = "prueba";
  else estado = "vencida";
  return { estado, accesoHasta: hasta, trialEndsAt: trial, paidUntil: paid, diasRestantes, trialNuevo };
}

async function filas(where: string, params: unknown[]): Promise<FilaSub[]> {
  await ensureSchema();
  return prisma.$queryRawUnsafe<FilaSub[]>(
    `SELECT id, role, "createdAt", "trialEndsAt", "paidUntil" FROM "User" ${where}`,
    ...params,
  );
}

/** Estado de un usuario. La primera vez fija el fin de su prueba gratis. */
export async function getSuscripcion(userId: string): Promise<Suscripcion> {
  try {
    const [u] = await filas(`WHERE id = $1`, [userId]);
    if (!u) return { estado: "vencida", accesoHasta: null, trialEndsAt: null, paidUntil: null, diasRestantes: 0 };
    const { diasPrueba } = await getPlan();
    const { trialNuevo, ...s } = calcular(u, diasPrueba);
    if (trialNuevo && s.trialEndsAt) {
      await prisma.$executeRawUnsafe(
        `UPDATE "User" SET "trialEndsAt" = $1 WHERE id = $2 AND "trialEndsAt" IS NULL`,
        s.trialEndsAt,
        userId,
      );
    }
    return s;
  } catch (e) {
    // Si algo falla al leer la suscripción no se bloquea al usuario.
    console.error("[suscripcion] error leyendo estado", e);
    return { estado: "prueba", accesoHasta: null, trialEndsAt: null, paidUntil: null, diasRestantes: 0 };
  }
}

export function tieneAcceso(s: Suscripcion) {
  return s.estado !== "vencida";
}

/** Ids de usuarios con acceso (para que el cron no consulte procesos vencidos). */
export async function usuariosConAcceso(): Promise<Set<string>> {
  const { diasPrueba } = await getPlan();
  const us = await filas("", []);
  return new Set(us.filter((u) => calcular(u, diasPrueba).estado !== "vencida").map((u) => u.id));
}

/** Todos los usuarios con su estado (reporte del root). */
export async function suscripcionesDeTodos() {
  const { diasPrueba } = await getPlan();
  const us = await filas("", []);
  return new Map(us.map((u) => [u.id, calcular(u, diasPrueba)]));
}

/** Suma días de acceso (regalo del root o pago confirmado). */
export async function extenderAcceso(userId: string, dias: number) {
  const s = await getSuscripcion(userId);
  const base = Math.max(Date.now(), s.accesoHasta?.getTime() ?? 0);
  await prisma.$executeRawUnsafe(
    `UPDATE "User" SET "paidUntil" = $1 WHERE id = $2`,
    new Date(base + dias * DIA_MS),
    userId,
  );
}

/** El root termina el acceso de un usuario de inmediato (prueba y plan). */
export async function terminarAcceso(userId: string) {
  await ensureSchema();
  await prisma.$executeRawUnsafe(
    `UPDATE "User" SET "trialEndsAt" = now() - interval '1 minute', "paidUntil" = NULL WHERE id = $1`,
    userId,
  );
}

// ---------- Pagos con Bold ----------
async function bold(path: string, init?: RequestInit) {
  const r = await fetch(`${BOLD_API}${path}`, {
    ...init,
    headers: {
      Authorization: `x-api-key ${process.env.BOLD_API_KEY ?? ""}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Bold ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return j as Record<string, unknown>;
}

/** Crea un link de pago de Bold para el plan mensual y devuelve su URL. */
export async function crearLinkDePago(user: { id: string; email: string }) {
  if (!boldConfigurado()) throw new Error("Los pagos aún no están configurados.");
  await ensureSchema();
  const { precio } = await getPlan();
  const j = await bold("/online/link/v1", {
    method: "POST",
    body: JSON.stringify({
      amount_type: "CLOSE",
      amount: { currency: "COP", total_amount: precio, tip_amount: 0 },
      description: "Estradox - Plan mensual",
      callback_url: `${APP_URL}/dashboard/suscripcion?pago=1`,
      payer_email: user.email,
    }),
  });
  const payload = (j.payload ?? {}) as { payment_link?: string; url?: string };
  if (!payload.payment_link || !payload.url) {
    throw new Error(`Bold no devolvió el link: ${JSON.stringify(j).slice(0, 300)}`);
  }
  await prisma.$executeRawUnsafe(
    `INSERT INTO "BoldPayment" (id, "userId", amount, status, url) VALUES ($1, $2, $3, 'ACTIVE', $4)`,
    payload.payment_link,
    user.id,
    precio,
    payload.url,
  );
  return payload.url;
}

/**
 * Consulta en Bold el estado de un link y, si está pagado, suma los días.
 * Es idempotente: un mismo pago nunca se acredita dos veces. El acceso solo se
 * da con lo que responde el API de Bold (no se confía en el webhook a ciegas).
 */
export async function confirmarPago(
  linkId: string,
  /**
   * Webhook SALE_APPROVED recibido para este link: "real" si vino firmado con la
   * llave secreta; "prueba" si vino firmado con llave vacía (modo de pruebas).
   */
  webhook?: { firma: "real" | "prueba"; monto: number | null; paymentId: string | null },
): Promise<boolean> {
  await ensureSchema();
  const [pago] = await prisma.$queryRawUnsafe<
    { id: string; userId: string; status: string; amount: number }[]
  >(`SELECT id, "userId", status, amount FROM "BoldPayment" WHERE id = $1`, linkId);
  if (!pago || pago.status === "PAID") return false;

  const j = await bold(`/online/link/v1/${encodeURIComponent(linkId)}`);
  const info = ((j.payload as Record<string, unknown>) ?? j) as {
    status?: string;
    transaction_id?: string;
    is_sandbox?: boolean;
  };
  let status = String(info.status ?? "");
  await logBold("consulta", {
    link: linkId,
    status,
    is_sandbox: info.is_sandbox,
    webhook: webhook ?? null,
  });

  // En modo de pruebas Bold deja el link "PROCESSING"; el pago se confirma con
  // el webhook. Uno firmado con la llave secreta es prueba suficiente; uno de
  // pruebas (llave vacía) solo vale si el API dice que el link es de pruebas.
  if (status !== "PAID" && webhook && (status === "PROCESSING" || status === "ACTIVE")) {
    const montoOk = webhook.monto == null || webhook.monto === pago.amount;
    if (montoOk && (webhook.firma === "real" || info.is_sandbox === true)) {
      status = "PAID";
      info.transaction_id = info.transaction_id ?? webhook.paymentId ?? undefined;
    }
  }

  if (status !== "PAID") {
    if (status && status !== pago.status) {
      await prisma.$executeRawUnsafe(
        `UPDATE "BoldPayment" SET status = $1 WHERE id = $2 AND status <> 'PAID'`,
        status,
        linkId,
      );
    }
    return false;
  }
  const marcado = await prisma.$executeRawUnsafe(
    `UPDATE "BoldPayment" SET status = 'PAID', "paidAt" = now(), "paymentId" = $1
     WHERE id = $2 AND status <> 'PAID'`,
    info.transaction_id ?? null,
    linkId,
  );
  if (marcado !== 1) return false; // otro proceso ya lo acreditó
  await extenderAcceso(pago.userId, DIAS_POR_PAGO);
  console.log(`[bold] pago ${linkId} acreditado a ${pago.userId}`);
  return true;
}

/** Revisa los links pendientes recientes del usuario (al volver del checkout). */
export async function verificarPagosPendientes(userId: string) {
  if (!boldConfigurado()) return;
  await ensureSchema();
  const pendientes = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM "BoldPayment"
     WHERE "userId" = $1 AND status IN ('ACTIVE', 'PROCESSING')
       AND "createdAt" > now() - interval '3 days'
     ORDER BY "createdAt" DESC LIMIT 5`,
    userId,
  );
  for (const p of pendientes) {
    await confirmarPago(p.id).catch((e) => console.error("[bold] verificar", e));
  }
}

/**
 * Respaldo del webhook (cron horario): revisa en Bold todos los links
 * pendientes de los últimos 3 días, por si el usuario pagó y no volvió.
 */
export async function verificarTodosLosPagosPendientes(): Promise<number> {
  if (!boldConfigurado()) return 0;
  await ensureSchema();
  const pendientes = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM "BoldPayment"
     WHERE status IN ('ACTIVE', 'PROCESSING')
       AND "createdAt" > now() - interval '3 days'
     ORDER BY "createdAt" DESC LIMIT 50`,
  );
  let acreditados = 0;
  for (const p of pendientes) {
    if (await confirmarPago(p.id).catch(() => false)) acreditados++;
  }
  return acreditados;
}

export async function pagosDeUsuario(userId: string) {
  await ensureSchema();
  return prisma.$queryRawUnsafe<
    { id: string; amount: number; status: string; createdAt: Date; paidAt: Date | null }[]
  >(
    `SELECT id, amount, status, "createdAt", "paidAt" FROM "BoldPayment"
     WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 20`,
    userId,
  );
}

export async function totalPagosAprobados() {
  await ensureSchema();
  const [r] = await prisma.$queryRawUnsafe<{ n: bigint; total: bigint | null }[]>(
    `SELECT count(*) AS n, sum(amount) AS total FROM "BoldPayment" WHERE status = 'PAID'`,
  );
  return { pagos: Number(r?.n ?? 0), total: Number(r?.total ?? 0) };
}

// ---------- Avisos de vencimiento (cron horario) ----------
/**
 * Usuarios a avisar: "por vencer" (quedan ≤ 3 días) y "vencida" (ya expiró).
 * Cada aviso se manda una vez por fecha de vencimiento.
 */
export async function avisosDeVencimientoPendientes() {
  const { diasPrueba } = await getPlan();
  await ensureSchema();
  const us = await prisma.$queryRawUnsafe<
    (FilaSub & { subNoticeFor: Date | null; subExpiredFor: Date | null })[]
  >(
    `SELECT id, role, "createdAt", "trialEndsAt", "paidUntil", "subNoticeFor", "subExpiredFor"
     FROM "User" WHERE role <> 'admin' AND "emailVerified" IS NOT NULL`,
  );
  const porVencer: { id: string; hasta: Date }[] = [];
  const vencidos: { id: string; hasta: Date }[] = [];
  const ahora = Date.now();
  for (const u of us) {
    const s = calcular(u, diasPrueba);
    if (!s.accesoHasta) continue;
    const hasta = s.accesoHasta;
    const iguales = (d: Date | null) => !!d && Math.abs(new Date(d).getTime() - hasta.getTime()) < 60_000;
    if (s.estado === "vencida") {
      // Solo avisa vencimientos recientes (no a cuentas abandonadas hace meses).
      if (!iguales(u.subExpiredFor) && ahora - hasta.getTime() < 7 * DIA_MS) {
        vencidos.push({ id: u.id, hasta });
      }
    } else if (hasta.getTime() - ahora <= 3 * DIA_MS && !iguales(u.subNoticeFor)) {
      porVencer.push({ id: u.id, hasta });
    }
  }
  return { porVencer, vencidos };
}

export async function marcarAviso(userId: string, tipo: "porVencer" | "vencida", hasta: Date) {
  const col = tipo === "porVencer" ? "subNoticeFor" : "subExpiredFor";
  await prisma.$executeRawUnsafe(`UPDATE "User" SET "${col}" = $1 WHERE id = $2`, hasta, userId);
}
