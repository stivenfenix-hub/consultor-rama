import "server-only";
import crypto from "node:crypto";
import { prisma } from "./db";
import { hashPassword } from "./auth";
import { sendMail } from "./mailer";

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const VERIFY_TTL = 1000 * 60 * 60 * 24; // 24h
const RESET_TTL = 1000 * 60 * 60; // 1h

export class AccountError extends Error {}

function sha256(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

/** Crea un token de un solo uso y devuelve el valor en claro (para el enlace). */
async function createToken(
  userId: string,
  type: "verify" | "reset",
  ttlMs: number,
) {
  const raw = crypto.randomBytes(32).toString("hex");
  // Un solo token activo por tipo.
  await prisma.token.deleteMany({ where: { userId, type } });
  await prisma.token.create({
    data: {
      userId,
      type,
      tokenHash: sha256(raw),
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });
  return raw;
}

/** Valida y consume un token; devuelve el userId o null. */
async function consumeToken(type: "verify" | "reset", raw: string) {
  const token = await prisma.token.findUnique({
    where: { tokenHash: sha256(raw) },
  });
  if (!token || token.type !== type) return null;
  if (token.expiresAt < new Date()) {
    await prisma.token.delete({ where: { id: token.id } }).catch(() => {});
    return null;
  }
  await prisma.token.delete({ where: { id: token.id } });
  return token.userId;
}

// ---------- Registro + verificacion ----------

export async function registerUser(input: {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}) {
  const email = input.email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new AccountError("Ya existe una cuenta con ese correo.");
  }
  const user = await prisma.user.create({
    data: {
      email,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      name: `${input.firstName.trim()} ${input.lastName.trim()}`.trim(),
      passwordHash: await hashPassword(input.password),
      emailVerified: null,
    },
  });
  await enviarVerificacion(user.id, email);
  return user;
}

const LOGO = `${APP_URL}/api/logo/email`;
const BTN =
  "display:inline-block;background:linear-gradient(135deg,#8b3dff,#4b23e6);color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600";

async function enviarVerificacion(userId: string, email: string) {
  const raw = await createToken(userId, "verify", VERIFY_TTL);
  const link = `${APP_URL}/verify?token=${raw}`;
  await sendMail({
    to: email,
    subject: "Verifica tu correo - Estradox",
    text: `Confirma tu cuenta visitando: ${link}\n\nEl enlace vence en 24 horas.`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto">
        <img src="${LOGO}" alt="Estradox" height="26" style="margin-bottom:12px" />
        <h2>Confirma tu cuenta</h2>
        <p>Gracias por registrarte en <b>Estradox</b>. Confirma tu correo para activar tu cuenta:</p>
        <p><a href="${link}" style="${BTN}">Verificar mi correo</a></p>
        <p style="color:#777;font-size:13px">O copia este enlace: ${link}<br/>Vence en 24 horas.</p>
      </div>`,
  });
}

/** Reenvia el correo de verificacion si la cuenta aun no esta verificada. */
export async function resendVerification(emailRaw: string) {
  const email = emailRaw.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (user && !user.emailVerified) {
    await enviarVerificacion(user.id, email);
  }
}

/** Verifica el correo a partir del token. Devuelve true si fue valido. */
export async function verifyEmailToken(raw: string) {
  const userId = await consumeToken("verify", raw);
  if (!userId) return false;
  await prisma.user.update({
    where: { id: userId },
    data: { emailVerified: new Date() },
  });
  return true;
}

// ---------- Reset de contrasena ----------

/** Siempre resuelve igual (no revela si el correo existe). */
export async function requestPasswordReset(emailRaw: string) {
  const email = emailRaw.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return;
  const raw = await createToken(user.id, "reset", RESET_TTL);
  const link = `${APP_URL}/reset?token=${raw}`;
  await sendMail({
    to: email,
    subject: "Restablece tu contraseña - Estradox",
    text: `Para cambiar tu contraseña visita: ${link}\n\nEl enlace vence en 1 hora. Si no lo solicitaste, ignora este correo.`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto">
        <img src="${LOGO}" alt="Estradox" height="26" style="margin-bottom:12px" />
        <h2>Restablece tu contraseña</h2>
        <p>Recibimos una solicitud para cambiar tu contraseña. Si fuiste tú, continúa:</p>
        <p><a href="${link}" style="${BTN}">Cambiar contraseña</a></p>
        <p style="color:#777;font-size:13px">O copia este enlace: ${link}<br/>Vence en 1 hora. Si no lo solicitaste, ignora este correo.</p>
      </div>`,
  });
}

/** Cambia la contrasena usando un token de reset. Devuelve true si fue valido. */
export async function resetPassword(raw: string, newPassword: string) {
  const userId = await consumeToken("reset", raw);
  if (!userId) return false;
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword) },
  });
  return true;
}

// ---------- Cambio de contrasena autenticado ----------

export async function changePassword(
  userId: string,
  current: string,
  next: string,
) {
  const bcrypt = (await import("bcryptjs")).default;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.passwordHash) throw new AccountError("Cuenta sin contraseña.");
  const ok = await bcrypt.compare(current, user.passwordHash);
  if (!ok) throw new AccountError("La contraseña actual no es correcta.");
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(next) },
  });
}
