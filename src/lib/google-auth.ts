import "server-only";
import crypto from "node:crypto";
import { prisma } from "./db";
import { ensureColumn } from "./runtime-columns";

/**
 * "Continuar con Google" (OAuth 2.0 / OpenID Connect, sin librerías).
 * Variables: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET. La dirección de retorno
 * autorizada en Google Cloud es  APP_URL + /api/auth/google/callback.
 */

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

export const REDIRECT_URI = `${APP_URL}/api/auth/google/callback`;
export const COOKIE_ESTADO = "g_oauth";

export function googleConfigurado() {
  return !!CLIENT_ID && !!CLIENT_SECRET;
}

const b64url = (b: Buffer) => b.toString("base64url");

/** URL de Google + estado/verificador PKCE que se guardan en una cookie corta. */
export function iniciarGoogle() {
  const state = b64url(crypto.randomBytes(24));
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return {
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    cookie: `${state}.${verifier}`,
  };
}

export type PerfilGoogle = {
  sub: string;
  email: string;
  nombre: string;
  apellido: string;
};

/** Cambia el código por el perfil. El id_token llega directo de Google por TLS. */
export async function perfilDesdeCodigo(code: string, verifier: string): Promise<PerfilGoogle> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (!res.ok || !data.id_token) throw new Error(`Google: ${data.error ?? res.status}`);

  const payload = JSON.parse(Buffer.from(data.id_token.split(".")[1], "base64url").toString("utf8")) as {
    iss?: string;
    aud?: string;
    exp?: number;
    sub?: string;
    email?: string;
    email_verified?: boolean;
    given_name?: string;
    family_name?: string;
    name?: string;
  };
  const issOk = payload.iss === "https://accounts.google.com" || payload.iss === "accounts.google.com";
  if (!issOk || payload.aud !== CLIENT_ID || !payload.sub || (payload.exp ?? 0) * 1000 < Date.now()) {
    throw new Error("Google: token inválido");
  }
  if (!payload.email || !payload.email_verified) throw new Error("Google: correo no verificado");
  const [nombre, ...resto] = (payload.name ?? "").split(" ");
  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    nombre: payload.given_name ?? nombre ?? "",
    apellido: payload.family_name ?? resto.join(" "),
  };
}

/**
 * Cuenta para ese perfil de Google: si el correo ya existe, es la misma cuenta
 * (y queda verificada); si no, se crea ya verificada. `nueva` = recién creada.
 */
export async function cuentaGoogle(p: PerfilGoogle) {
  await ensureColumn("User", "googleSub", "TEXT");
  const existente = await prisma.user.findUnique({ where: { email: p.email } });
  if (existente) {
    await prisma.user.update({
      where: { id: existente.id },
      data: {
        emailVerified: existente.emailVerified ?? new Date(),
        lastLoginAt: new Date(),
        // Cuenta sin verificar: la contraseña la puso alguien que no probó ser
        // dueño del correo (pudo ser otra persona). Google sí lo probó: se borra.
        ...(existente.emailVerified ? {} : { passwordHash: null }),
      },
    });
    await prisma.$executeRawUnsafe(`UPDATE "User" SET "googleSub" = $2 WHERE id = $1`, existente.id, p.sub);
    return { user: existente, nueva: !existente.emailVerified };
  }
  const user = await prisma.user.create({
    data: {
      email: p.email,
      firstName: p.nombre || null,
      lastName: p.apellido || null,
      name: `${p.nombre} ${p.apellido}`.trim() || null,
      passwordHash: null, // entra con Google; puede crear contraseña con "Olvidé mi contraseña"
      emailVerified: new Date(),
      lastLoginAt: new Date(),
    },
  });
  await prisma.$executeRawUnsafe(`UPDATE "User" SET "googleSub" = $2 WHERE id = $1`, user.id, p.sub);
  return { user, nueva: true };
}

/** ¿Cuenta creada con Google que aún no registra su WhatsApp (obligatorio)? */
export async function faltaWhatsappGoogle(userId: string): Promise<boolean> {
  try {
    const rows = await prisma.$queryRawUnsafe<{ g: string | null; w: string | null }[]>(
      `SELECT "googleSub" AS g, "whatsapp" AS w FROM "User" WHERE id = $1`,
      userId,
    );
    return !!rows[0]?.g && !rows[0]?.w;
  } catch {
    return false; // columnas aún no creadas: nadie ha entrado con Google
  }
}
