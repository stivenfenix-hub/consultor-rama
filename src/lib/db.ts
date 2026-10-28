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
      `connection_limit=${p.get("connection_limit") ?? "por defecto de Prisma"}`,
    ].join(" · ");
  } catch {
    return "—";
  }
}

// Evita crear multiples instancias en desarrollo (hot reload).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
