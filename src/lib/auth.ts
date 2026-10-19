import "server-only";
import { cookies } from "next/headers";
import crypto from "node:crypto";
import { prisma } from "./db";

/**
 * Auth MINIMA para el starter: identifica al abogado por su correo (sin
 * contrasena) y guarda una cookie de sesion firmada con HMAC.
 *
 * ⚠️  Esto NO es seguro para produccion. Antes de salir a prod reemplazalo por
 * un flujo real: codigo OTP por correo, magic link o passkeys (p. ej. con
 * better-auth, Auth.js o Clerk). Ver README.
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
  // Comparacion en tiempo constante
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return value;
}

/** Inicia (o crea) la sesion del abogado a partir de su correo. */
export async function loginWithEmail(emailRaw: string, name?: string) {
  const email = emailRaw.trim().toLowerCase();
  const user = await prisma.user.upsert({
    where: { email },
    update: name ? { name } : {},
    create: { email, name },
  });
  const jar = await cookies();
  jar.set(COOKIE, sign(user.id), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
  return user;
}

export async function logout() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

/** Devuelve el usuario actual o null. */
export async function getCurrentUser() {
  const jar = await cookies();
  const userId = verify(jar.get(COOKIE)?.value);
  if (!userId) return null;
  return prisma.user.findUnique({ where: { id: userId } });
}

/** Igual que getCurrentUser pero lanza si no hay sesion. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return user;
}
