import "server-only";
import { prisma } from "./db";

// Columnas agregadas en tiempo de ejecución (ADD COLUMN IF NOT EXISTS) para no
// depender de correr migraciones en la base de producción.
const ready = new Set<string>();

export async function ensureColumn(table: string, column: string, type: string) {
  const key = `${table}.${column}`;
  if (ready.has(key)) return;
  const cols = await prisma.$queryRawUnsafe<unknown[]>(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name = $1 AND column_name = $2`,
    table,
    column,
  );
  if (cols.length === 0) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${column}" ${type}`,
    );
  }
  ready.add(key);
}
