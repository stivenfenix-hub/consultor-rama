import { PrismaClient } from "@prisma/client";

/**
 * Conexión a Supabase por el pooler en MODO TRANSACCIÓN (puerto 6543).
 * En modo sesión (5432) cada proceso de Hostinger se queda con sus conexiones
 * fijas y el plan gratis da ~15: al llenarse, las páginas esperan turno y se
 * quedan cargando. En modo transacción las conexiones se comparten por consulta.
 * Si DATABASE_URL apunta al pooler en 5432 se pasa a 6543 con pgbouncer=true
 * (sin prepared statements, necesario para Prisma) y un límite por proceso.
 * DB_MODO_SESION=true deja la URL tal cual.
 */
function urlConexion(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw || process.env.DB_MODO_SESION === "true") return raw;
  try {
    const u = new URL(raw);
    if (u.hostname.endsWith("pooler.supabase.com") && (u.port === "5432" || u.port === "")) {
      u.port = "6543";
    }
    if (u.port === "6543") {
      if (!u.searchParams.has("pgbouncer")) u.searchParams.set("pgbouncer", "true");
      if (!u.searchParams.has("connection_limit")) u.searchParams.set("connection_limit", "5");
      if (!u.searchParams.has("pool_timeout")) u.searchParams.set("pool_timeout", "20");
    }
    return u.toString();
  } catch {
    return raw;
  }
}

/** Descripción de la conexión en uso, sin usuario ni contraseña (diagnóstico). */
export function describirConexion() {
  try {
    const u = new URL(urlConexion() ?? "");
    const p = u.searchParams;
    return [
      u.hostname.includes("pooler") ? "pooler de Supabase" : u.hostname.includes("supabase") ? "conexión directa" : u.hostname,
      `puerto ${u.port || "5432"} (${u.port === "6543" ? "modo transacción" : "modo sesión"})`,
      `pgbouncer=${p.get("pgbouncer") ?? "no"}`,
      `connection_limit=${p.get("connection_limit") ?? "por defecto de Prisma"}`,
      `pool_timeout=${p.get("pool_timeout") ?? "10"} s`,
    ].join(" · ");
  } catch {
    return "—";
  }
}

// Evita crear multiples instancias en desarrollo (hot reload).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const url = urlConexion();
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(url ? { datasources: { db: { url } } } : {}),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
