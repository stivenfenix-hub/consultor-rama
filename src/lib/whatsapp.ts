import "server-only";
import { prisma } from "./db";

/**
 * WhatsApp propio de Estradox (sin la API de WhatsApp): un servicio aparte
 * (carpeta whatsapp-worker) mantiene vinculados dos WhatsApp por QR y envía,
 * despacio, lo que Estradox deja en la cola "WaMensaje":
 *   - "avisos":    actuaciones nuevas y avisos de pago.
 *   - "comercial": quienes no han cargado procesos y promociones.
 * Aquí está lo que usa Estradox: el estado para el root y encolar mensajes.
 */

export type CuentaWa = "avisos" | "comercial";
export const CUENTAS_WA: CuentaWa[] = ["avisos", "comercial"];

/** A qué WhatsApp va cada tipo de aviso. */
export function cuentaDeTipo(tipo: string): CuentaWa {
  return tipo === "sinProcesos" || tipo === "promo" ? "comercial" : "avisos";
}

let listo: Promise<void> | null = null;
export function asegurarTablasWa() {
  listo ??= (async () => {
    // Las mismas tablas que crea el servicio (IF NOT EXISTS).
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "WaSesion" (
      cuenta TEXT NOT NULL,
      clave TEXT NOT NULL,
      valor TEXT NOT NULL,
      PRIMARY KEY (cuenta, clave)
    )`);
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "WaEstado" (
      cuenta TEXT PRIMARY KEY,
      estado TEXT NOT NULL DEFAULT 'apagado',
      qr TEXT,
      numero TEXT,
      pausado BOOLEAN NOT NULL DEFAULT false,
      "maxDia" INTEGER NOT NULL DEFAULT 40,
      comando TEXT,
      "ultimoError" TEXT,
      "actualizadoAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "workerVistoAt" TIMESTAMPTZ
    )`);
    for (const c of CUENTAS_WA) {
      await prisma.$executeRawUnsafe(`INSERT INTO "WaEstado" (cuenta) VALUES ($1) ON CONFLICT DO NOTHING`, c);
    }
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "WaMensaje" (
      id SERIAL PRIMARY KEY,
      cuenta TEXT NOT NULL,
      "userId" TEXT,
      tipo TEXT NOT NULL,
      telefono TEXT NOT NULL,
      mensaje TEXT NOT NULL,
      estado TEXT NOT NULL DEFAULT 'pendiente',
      intentos INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "enviadoAt" TIMESTAMPTZ
    )`);
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "WaMensaje_pendiente_idx" ON "WaMensaje" (cuenta, id) WHERE estado = 'pendiente'`,
    );
  })().catch((e) => {
    listo = null;
    throw e;
  });
  return listo;
}

export type EstadoWa = {
  cuenta: CuentaWa;
  estado: string;
  qr: string | null;
  numero: string | null;
  pausado: boolean;
  maxDia: number;
  ultimoError: string | null;
  /** El servicio respondió hace menos de 1 minuto. */
  servicioActivo: boolean;
  pendientes: number;
  enviadosHoy: number;
  fallidos: number;
};

export async function estadoWhatsapp(): Promise<EstadoWa[]> {
  await asegurarTablasWa();
  return prisma.$queryRawUnsafe<EstadoWa[]>(
    `SELECT e.cuenta, e.estado, e.qr, e.numero, e.pausado, e."maxDia", e."ultimoError",
       (e."workerVistoAt" > now() - interval '1 minute') IS TRUE AS "servicioActivo",
       (SELECT count(*)::int FROM "WaMensaje" m WHERE m.cuenta = e.cuenta AND m.estado IN ('pendiente', 'enviando')) AS pendientes,
       (SELECT count(*)::int FROM "WaMensaje" m WHERE m.cuenta = e.cuenta AND m.estado = 'enviado'
          AND (m."enviadoAt" AT TIME ZONE 'America/Bogota')::date = (now() AT TIME ZONE 'America/Bogota')::date) AS "enviadosHoy",
       (SELECT count(*)::int FROM "WaMensaje" m WHERE m.cuenta = e.cuenta AND m.estado = 'fallido') AS fallidos
     FROM "WaEstado" e WHERE e.cuenta = ANY($1::text[]) ORDER BY e.cuenta`,
    CUENTAS_WA,
  );
}

export type MensajeWa = {
  id: number;
  cuenta: CuentaWa;
  tipo: string;
  telefono: string;
  mensaje: string;
  estado: string;
  error: string | null;
  createdAt: Date;
  enviadoAt: Date | null;
};

export async function ultimosMensajesWa(limite = 60): Promise<MensajeWa[]> {
  await asegurarTablasWa();
  return prisma.$queryRawUnsafe<MensajeWa[]>(
    `SELECT id, cuenta, tipo, telefono, mensaje, estado, error, "createdAt", "enviadoAt"
     FROM "WaMensaje" ORDER BY id DESC LIMIT $1`,
    limite,
  );
}

/**
 * ¿Hay que encolar para esta cuenta? Solo si alguna vez se vinculó (tiene
 * número): así, mientras no exista el servicio, no se acumulan mensajes.
 */
async function cuentaActiva(cuenta: CuentaWa) {
  await asegurarTablasWa();
  const [r] = await prisma.$queryRawUnsafe<{ ok: boolean }[]>(
    `SELECT (numero IS NOT NULL) AS ok FROM "WaEstado" WHERE cuenta = $1`,
    cuenta,
  );
  return !!r?.ok;
}

/** Deja mensajes en la cola de su WhatsApp (sin repetir el mismo texto al mismo número el mismo día). */
export async function encolarWhatsapp(
  mensajes: { tipo: string; telefono: string; mensaje: string; userId?: string | null }[],
) {
  let n = 0;
  const activas = new Map<CuentaWa, boolean>();
  for (const m of mensajes) {
    const telefono = m.telefono.replace(/\D/g, "");
    if (!telefono) continue;
    const cuenta = cuentaDeTipo(m.tipo);
    if (!activas.has(cuenta)) activas.set(cuenta, await cuentaActiva(cuenta));
    if (!activas.get(cuenta)) continue;
    n += await prisma.$executeRawUnsafe(
      `INSERT INTO "WaMensaje" (cuenta, "userId", tipo, telefono, mensaje)
       SELECT $1, $2, $3, $4, $5
       WHERE NOT EXISTS (
         SELECT 1 FROM "WaMensaje" WHERE cuenta = $1 AND telefono = $4 AND mensaje = $5
           AND "createdAt" > now() - interval '20 hours')`,
      cuenta,
      m.userId ?? null,
      m.tipo,
      telefono,
      m.mensaje,
    );
  }
  return n;
}

export async function setComandoWa(cuenta: CuentaWa, comando: "desvincular") {
  await asegurarTablasWa();
  await prisma.$executeRawUnsafe(`UPDATE "WaEstado" SET comando = $2 WHERE cuenta = $1`, cuenta, comando);
}

export async function setPausaWa(cuenta: CuentaWa, pausado: boolean) {
  await asegurarTablasWa();
  await prisma.$executeRawUnsafe(`UPDATE "WaEstado" SET pausado = $2 WHERE cuenta = $1`, cuenta, pausado);
}

export async function setMaxDiaWa(cuenta: CuentaWa, maxDia: number) {
  await asegurarTablasWa();
  await prisma.$executeRawUnsafe(`UPDATE "WaEstado" SET "maxDia" = $2 WHERE cuenta = $1`, cuenta, maxDia);
}

/** Vuelve a poner en cola los fallidos (o borra los pendientes) de una cuenta. */
export async function gestionarColaWa(cuenta: CuentaWa, accion: "reintentar" | "vaciar") {
  await asegurarTablasWa();
  return accion === "reintentar"
    ? prisma.$executeRawUnsafe(
        `UPDATE "WaMensaje" SET estado = 'pendiente', intentos = 0, error = NULL WHERE cuenta = $1 AND estado = 'fallido'`,
        cuenta,
      )
    : prisma.$executeRawUnsafe(`DELETE FROM "WaMensaje" WHERE cuenta = $1 AND estado = 'pendiente'`, cuenta);
}

/** Mensaje de prueba directo a la cola (aunque la cuenta no tenga número aún). */
export async function encolarPruebaWa(cuenta: CuentaWa, telefono: string, mensaje: string) {
  await asegurarTablasWa();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "WaMensaje" (cuenta, tipo, telefono, mensaje) VALUES ($1, 'prueba', $2, $3)`,
    cuenta,
    telefono.replace(/\D/g, ""),
    mensaje,
  );
}

// ---------- Actuaciones por WhatsApp: solo a quien lo activa ----------
// "waActuaciones": null = aún no decide (se le muestra la burbuja), true/false = su elección.
async function columnaOptIn() {
  const { ensureColumn } = await import("./runtime-columns");
  await ensureColumn("User", "waActuaciones", "BOOLEAN");
}

export async function getWaActuaciones(userId: string): Promise<boolean | null> {
  try {
    await columnaOptIn();
    const [r] = await prisma.$queryRawUnsafe<{ v: boolean | null }[]>(
      `SELECT "waActuaciones" AS v FROM "User" WHERE id = $1`,
      userId,
    );
    return r?.v ?? null;
  } catch {
    return null;
  }
}

export async function setWaActuaciones(userId: string, valor: boolean) {
  await columnaOptIn();
  await prisma.$executeRawUnsafe(`UPDATE "User" SET "waActuaciones" = $2 WHERE id = $1`, userId, valor);
}

/** De estos usuarios, quiénes activaron las actuaciones por WhatsApp. */
export async function conWaActuaciones(userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  await columnaOptIn();
  const filas = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM "User" WHERE id = ANY($1::text[]) AND "waActuaciones" IS TRUE`,
    userIds,
  );
  return new Set(filas.map((f) => f.id));
}
