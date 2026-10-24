import "server-only";
import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { User } from "@prisma/client";
import { prisma } from "./db";
import { getSuscripcion, tieneAcceso } from "./subscription";
import { getWhatsapp } from "./accounts";

/**
 * Sesiones de la app Android: token Bearer aleatorio (se guarda su HASH), uno
 * por dispositivo, revocable al cerrar sesión. La web sigue usando la cookie.
 */

const TOKEN_TTL_DIAS = 180;

let tablaLista = false;
async function ensureTable() {
  if (tablaLista) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "MobileSession" (
      id SERIAL PRIMARY KEY,
      "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
      "tokenHash" TEXT NOT NULL UNIQUE,
      device TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "lastUsedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  tablaLista = true;
}

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

function bearer(req: NextRequest): string | null {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() || null : null;
}

/** Crea una sesión para el dispositivo y devuelve el token en claro. */
export async function createMobileSession(userId: string, device: string | null) {
  await ensureTable();
  const raw = `edx_${crypto.randomBytes(32).toString("hex")}`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "MobileSession" ("userId", "tokenHash", device) VALUES ($1, $2, $3)`,
    userId,
    sha256(raw),
    device?.slice(0, 120) ?? null,
  );
  return raw;
}

export async function revokeMobileSession(req: NextRequest) {
  const raw = bearer(req);
  if (!raw) return;
  await ensureTable();
  await prisma.$executeRawUnsafe(`DELETE FROM "MobileSession" WHERE "tokenHash" = $1`, sha256(raw));
}

async function userFromRequest(req: NextRequest): Promise<User | null> {
  const raw = bearer(req);
  if (!raw) return null;
  await ensureTable();
  const rows = await prisma.$queryRawUnsafe<{ id: number; userId: string; lastUsedAt: Date }[]>(
    `SELECT id, "userId", "lastUsedAt" FROM "MobileSession" WHERE "tokenHash" = $1`,
    sha256(raw),
  );
  const s = rows[0];
  if (!s) return null;
  const inactivo = Date.now() - new Date(s.lastUsedAt).getTime();
  if (inactivo > TOKEN_TTL_DIAS * 24 * 60 * 60 * 1000) {
    await prisma.$executeRawUnsafe(`DELETE FROM "MobileSession" WHERE id = $1`, s.id);
    return null;
  }
  // Renueva la vigencia como mucho una vez por hora (evita escribir en cada petición).
  if (inactivo > 60 * 60 * 1000) {
    await prisma.$executeRawUnsafe(`UPDATE "MobileSession" SET "lastUsedAt" = now() WHERE id = $1`, s.id);
  }
  return prisma.user.findUnique({ where: { id: s.userId } });
}

export function jsonError(error: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status });
}

/** Lee el cuerpo JSON de la petición ({} si no hay o es inválido). */
export async function body(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const j = await req.json();
    return j && typeof j === "object" ? (j as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

/**
 * Envuelve un endpoint del API móvil: exige el token (401 si falta) y, salvo
 * `allowExpired`, una suscripción con acceso (402 si venció). Los errores
 * inesperados se responden como 500 en JSON.
 */
export async function withMobileUser(
  req: NextRequest,
  handler: (user: User) => Promise<Response>,
  opts: { allowExpired?: boolean } = {},
): Promise<Response> {
  try {
    const user = await userFromRequest(req);
    if (!user) return jsonError("Tu sesión expiró. Vuelve a iniciar sesión.", 401);
    if (!opts.allowExpired && !tieneAcceso(await getSuscripcion(user.id))) {
      return jsonError("Tu acceso venció. Renueva tu plan para continuar.", 402);
    }
    return await handler(user);
  } catch (e) {
    console.error("[mobile]", req.nextUrl.pathname, e);
    return jsonError("Ocurrió un error. Intenta de nuevo.", 500);
  }
}

/** Datos de la cuenta que la app muestra (perfil + estado de la suscripción). */
export async function perfil(user: User) {
  const [sub, whatsapp] = await Promise.all([getSuscripcion(user.id), getWhatsapp(user.id)]);
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      whatsapp,
    },
    suscripcion: {
      estado: sub.estado,
      accesoHasta: sub.accesoHasta,
      diasRestantes: sub.diasRestantes,
    },
  };
}

/** Igual que withMobileUser pero para endpoints sin sesión (login, registro...). */
export async function publicMobile(req: NextRequest, handler: () => Promise<Response>) {
  try {
    return await handler();
  } catch (e) {
    console.error("[mobile]", req.nextUrl.pathname, e);
    return jsonError("Ocurrió un error. Intenta de nuevo.", 500);
  }
}
