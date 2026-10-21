import "server-only";
import { cookies } from "next/headers";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "./db";

/**
 * Sesion por cookie firmada (HMAC) + autenticacion por contrasena (bcrypt).
 * El registro, la verificacion de correo y el reset estan en accounts.ts.
 */

const COOKIE = "session";
const SECRET = process.env.SESSION_SECRET ?? "dev-insecure-secret-change-me";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 dias

function sign(value: string): string {
  const sig = crypto.createHmac("sha256", SECRET).update(value).digest("hex");
  return `${value}.${sig}`;
}

function verify(signed: string | undefined): string | null {
  if (!signed) return null;
  const idx = signed.lastIndexOf(".");
  if (idx < 0) return null;
  const value = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  const expected = crypto
    .createHmac("sha256", SECRET)
    .update(value)
    .digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return value;
}

export async function createSession(userId: string) {
  const jar = await cookies();
  jar.set(COOKIE, sign(userId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function logout() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function getCurrentUser() {
  const jar = await cookies();
  const userId = verify(jar.get(COOKIE)?.value);
  if (!userId) return null;
  return prisma.user.findUnique({ where: { id: userId } });
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin") throw new Error("FORBIDDEN");
  return user;
}

/** Página de inicio según el rol: el admin (root) entra al panel admin. */
export function homePath(role: string | null | undefined) {
  return role === "admin" ? "/dashboard/admin" : "/dashboard";
}

export async function isAdmin() {
  const user = await getCurrentUser();
  return user?.role === "admin";
}

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

/**
 * Resultado de intentar iniciar sesion.
 * - ok: credenciales correctas y correo verificado -> crea la sesion.
 * - unverified: credenciales correctas pero falta verificar el correo.
 * - invalid: correo o contrasena incorrectos.
 */
export type LoginResult =
  | { status: "ok"; role: string }
  | { status: "unverified"; email: string }
  | { status: "invalid" };

export async function loginWithPassword(
  emailRaw: string,
  password: string,
): Promise<LoginResult> {
  const email = emailRaw.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  // Siempre comparamos contra un hash para no filtrar si el correo existe.
  const hash =
    user?.passwordHash ?? "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidin";
  const okPass = await bcrypt.compare(password, hash);
  if (!user || !user.passwordHash || !okPass) return { status: "invalid" };
  if (!user.emailVerified) return { status: "unverified", email };
  await createSession(user.id);
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });
  return { status: "ok", role: user.role };
}
