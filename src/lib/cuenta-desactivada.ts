import "server-only";
import { prisma } from "./db";
import { ensureColumn } from "./runtime-columns";

/**
 * Cuenta desactivada (28 nov 2026): alternativa a eliminar para quien ya no
 * quiere el servicio. Deja de vigilar sus procesos (Rama y estados), no se le
 * escribe nada (WhatsApp, correo, campana) y no puede iniciar sesión. A diferencia
 * de eliminar, se CONSERVA todo: procesos, pagos, firmas electrónicas (PDF sellado
 * y certificado) y la autorización de datos (Ley 1581). El root la reactiva cuando
 * quiera desde Panel admin → Usuarios.
 */

export const MSG_CUENTA_DESACTIVADA =
  "Tu cuenta de Estradox está desactivada. Si quieres volver a usarla, escríbenos y la reactivamos.";

let columna: Promise<void> | null = null;
export const asegurarColumnaDesactivado = () =>
  (columna ??= ensureColumn("User", "desactivadoAt", "TIMESTAMPTZ").catch((e) => {
    columna = null;
    throw e;
  }));

export async function estaDesactivado(userId: string): Promise<boolean> {
  try {
    await asegurarColumnaDesactivado();
    const [r] = await prisma.$queryRawUnsafe<{ d: Date | null }[]>(
      `SELECT "desactivadoAt" AS d FROM "User" WHERE id = $1`,
      userId,
    );
    return !!r?.d;
  } catch {
    // Si no se puede leer, no se bloquea a nadie.
    return false;
  }
}

/** Ids desactivados (de entre `ids`, o todos). */
export async function idsDesactivados(ids?: string[]): Promise<Set<string>> {
  try {
    await asegurarColumnaDesactivado();
    const filas = ids
      ? ids.length === 0
        ? []
        : await prisma.$queryRawUnsafe<{ id: string }[]>(
            `SELECT id FROM "User" WHERE "desactivadoAt" IS NOT NULL AND id = ANY($1::text[])`,
            ids,
          )
      : await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "User" WHERE "desactivadoAt" IS NOT NULL`);
    return new Set(filas.map((f) => f.id));
  } catch {
    return new Set();
  }
}

/** Desactiva: marca la cuenta, cierra sus sesiones de la app y cancela lo que tenía por enviar. */
export async function desactivarCuenta(userId: string) {
  await asegurarColumnaDesactivado();
  await prisma.$executeRawUnsafe(`UPDATE "User" SET "desactivadoAt" = now() WHERE id = $1`, userId);
  const cancelar = [
    `DELETE FROM "MobileSession" WHERE "userId" = $1`,
    `UPDATE "WaMensaje" SET estado = 'cancelado', error = 'cuenta desactivada' WHERE "userId" = $1 AND estado = 'pendiente'`,
    `UPDATE "CorreoCola" SET estado = 'cancelado', error = 'cuenta desactivada' WHERE "userId" = $1 AND estado = 'pendiente'`,
    `UPDATE "AvisoWhatsapp" SET "reportadoAt" = now() WHERE "userId" = $1 AND "reportadoAt" IS NULL`,
  ];
  // Cada tabla puede no existir aún en una base nueva: lo que falle se ignora.
  for (const sql of cancelar) await prisma.$executeRawUnsafe(sql, userId).catch(() => 0);
}

export async function reactivarCuenta(userId: string) {
  await asegurarColumnaDesactivado();
  await prisma.$executeRawUnsafe(`UPDATE "User" SET "desactivadoAt" = NULL WHERE id = $1`, userId);
}
