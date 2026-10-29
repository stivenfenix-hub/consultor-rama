import { PrismaClient } from "@prisma/client";

/**
 * Conexión a Supabase tal como viene en DATABASE_URL (pooler en modo sesión).
 * NO pasar al modo transacción (puerto 6543 + pgbouncer): el 28/10/2026 hizo
 * que Hostinger respondiera 503 en buena parte de las peticiones.
 */

/** Descripción de la conexión en uso, sin usuario ni contraseña (diagnóstico). */
export function describirConexion() {
  try {
    const u = new URL(process.env.DATABASE_URL ?? "");
    const p = u.searchParams;
    return [
      u.hostname.includes("pooler") ? "pooler de Supabase" : u.hostname.includes("supabase") ? "conexión directa" : u.hostname,
      `puerto ${u.port || "5432"} (${u.port === "6543" ? "modo transacción" : "modo sesión"})`,
      `connection_limit=${process.env.ESTRADOX_DB_POOL ?? "3"} (URL: ${p.get("connection_limit") ?? "sin definir"})`,
    ].join(" · ");
  } catch {
    return "—";
  }
}

/**
 * El pooler en modo sesión de Supabase admite solo 15 clientes en total, y
 * Hostinger puede tener varios procesos de la app vivos (más los que quedan
 * tras cada publicación). El pool por defecto de Prisma (CPUs×2+1) los agotó
 * el 29/10/2026 ("max clients reached") y el registro dejó de funcionar.
 * Por eso cada proceso usa pocas conexiones (ESTRADOX_DB_POOL, por defecto 3).
 */
function urlConLimite(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    u.searchParams.set("connection_limit", process.env.ESTRADOX_DB_POOL ?? "3");
    if (!u.searchParams.has("pool_timeout")) u.searchParams.set("pool_timeout", "20");
    return u.toString();
  } catch {
    return raw;
  }
}

// Evita crear multiples instancias en desarrollo (hot reload).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const urlDb = urlConLimite();
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(urlDb ? { datasourceUrl: urlDb } : {}),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
