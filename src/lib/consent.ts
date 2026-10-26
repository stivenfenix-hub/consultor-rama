import "server-only";
import { headers } from "next/headers";
import { prisma } from "./db";
import { ensureColumn } from "./runtime-columns";

/**
 * Consentimientos (Ley 1581 de 2012): aceptación de Términos y Política de
 * datos al registrarse, y permiso OPCIONAL para ofertas y boletines.
 * Cada cambio queda en ConsentEvent (cuándo, qué versión, IP y navegador): es
 * la prueba de la autorización que exige la SIC.
 */

// Cambiar al publicar una nueva versión de los Términos o la Política.
export const VERSION_LEGAL = "2026-10-25";

let listo: Promise<void> | null = null;
function asegurar() {
  listo ??= (async () => {
    await ensureColumn("User", "termsAcceptedAt", "TIMESTAMPTZ");
    await ensureColumn("User", "termsVersion", "TEXT");
    await ensureColumn("User", "marketingOptIn", "BOOLEAN NOT NULL DEFAULT false");
    await ensureColumn("User", "marketingOptInAt", "TIMESTAMPTZ");
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

/** Al crear la cuenta: aceptó Términos/Política y eligió (o no) recibir ofertas. */
export async function registrarConsentimientoInicial(userId: string, ofertas: boolean) {
  await asegurar();
  await prisma.$executeRawUnsafe(
    `UPDATE "User" SET "termsAcceptedAt" = now(), "termsVersion" = $2,
       "marketingOptIn" = $3, "marketingOptInAt" = now()
     WHERE id = $1`,
    userId,
    VERSION_LEGAL,
    ofertas,
  );
  await registrarEvento(userId, "terminos", true);
  await registrarEvento(userId, "ofertas", ofertas);
}

export async function getOfertas(userId: string): Promise<boolean> {
  try {
    await asegurar();
    const rows = await prisma.$queryRawUnsafe<{ v: boolean }[]>(
      `SELECT "marketingOptIn" AS v FROM "User" WHERE id = $1`,
      userId,
    );
    return rows[0]?.v ?? false;
  } catch {
    return false;
  }
}

/** El usuario activa o retira el permiso de ofertas desde Configuración. */
export async function setOfertas(userId: string, valor: boolean) {
  await asegurar();
  await prisma.$executeRawUnsafe(
    `UPDATE "User" SET "marketingOptIn" = $2, "marketingOptInAt" = now() WHERE id = $1`,
    userId,
    valor,
  );
  await registrarEvento(userId, "ofertas", valor);
}

/** Usuarios que autorizaron ofertas y boletines (para envíos promocionales). */
export async function usuariosConOfertas(): Promise<string[]> {
  await asegurar();
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM "User" WHERE "marketingOptIn"`,
  );
  return rows.map((r) => r.id);
}
