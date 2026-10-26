import "server-only";
import { headers } from "next/headers";
import { prisma } from "./db";
import { ensureColumn } from "./runtime-columns";

/**
 * Consentimientos (Ley 1581 de 2012): aceptación de Términos y Política de
 * datos al registrarse (incluye ofertas y novedades). Quien no quiera ofertas
 * las desactiva en Configuración y queda excluido de los envíos.
 * Cada cambio queda en ConsentEvent (cuándo, qué versión, IP y navegador): es
 * la prueba de la autorización que exige la SIC.
 */

// Cambiar al publicar una nueva versión de los Términos o la Política.
export const VERSION_LEGAL = "2026-10-25.2";

let listo: Promise<void> | null = null;
function asegurar() {
  listo ??= (async () => {
    await ensureColumn("User", "termsAcceptedAt", "TIMESTAMPTZ");
    await ensureColumn("User", "termsVersion", "TEXT");
    // true = el usuario desactivó ofertas y novedades en Configuración.
    await ensureColumn("User", "marketingOptOut", "BOOLEAN NOT NULL DEFAULT false");
    await ensureColumn("User", "marketingOptOutAt", "TIMESTAMPTZ");
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ConsentEvent" (
        id SERIAL PRIMARY KEY,
        "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
        tipo TEXT NOT NULL,
        valor BOOLEAN NOT NULL,
        version TEXT,
        ip TEXT,
        "userAgent" TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "ConsentEvent_userId_idx" ON "ConsentEvent" ("userId")`,
    );
  })().catch((e) => {
    listo = null;
    throw e;
  });
  return listo;
}

async function origen() {
  try {
    const h = await headers();
    const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || null;
    return { ip, ua: (h.get("user-agent") ?? "").slice(0, 300) || null };
  } catch {
    return { ip: null, ua: null };
  }
}

async function registrarEvento(userId: string, tipo: "terminos" | "ofertas", valor: boolean) {
  const { ip, ua } = await origen();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ConsentEvent" ("userId", tipo, valor, version, ip, "userAgent")
     VALUES ($1, $2, $3, $4, $5, $6)`,
    userId,
    tipo,
    valor,
    VERSION_LEGAL,
    ip,
    ua,
  );
}

/** Al crear la cuenta: aceptó Términos y Política (que incluyen ofertas y novedades). */
export async function registrarConsentimientoInicial(userId: string) {
  await asegurar();
  await prisma.$executeRawUnsafe(
    `UPDATE "User" SET "termsAcceptedAt" = now(), "termsVersion" = $2 WHERE id = $1`,
    userId,
    VERSION_LEGAL,
  );
  await registrarEvento(userId, "terminos", true);
  await registrarEvento(userId, "ofertas", true);
}

/** ¿Recibe ofertas y novedades? (sí, salvo que las haya desactivado). */
export async function getOfertas(userId: string): Promise<boolean> {
  try {
    await asegurar();
    const rows = await prisma.$queryRawUnsafe<{ v: boolean }[]>(
      `SELECT "marketingOptOut" AS v FROM "User" WHERE id = $1`,
      userId,
    );
    return !(rows[0]?.v ?? false);
  } catch {
    return true;
  }
}

/** El usuario activa o desactiva ofertas y novedades desde Configuración. */
export async function setOfertas(userId: string, valor: boolean) {
  await asegurar();
  await prisma.$executeRawUnsafe(
    `UPDATE "User" SET "marketingOptOut" = $2, "marketingOptOutAt" = now() WHERE id = $1`,
    userId,
    !valor,
  );
  await registrarEvento(userId, "ofertas", valor);
}

/** Destinatarios de notificaciones: todos, menos quienes desactivaron ofertas. */
export async function usuariosParaAvisos(): Promise<string[]> {
  await asegurar();
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM "User" WHERE NOT "marketingOptOut"`,
  );
  return rows.map((r) => r.id);
}
