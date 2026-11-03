import "server-only";
import crypto from "node:crypto";
import { prisma } from "./db";
import { ensureColumn } from "./runtime-columns";

/**
 * Google Drive del root para los comprobantes del Portal socios. El root lo
 * conecta una vez (permiso drive.file: Estradox solo ve los archivos que él
 * mismo crea) y los archivos van a la carpeta "Estradox - Socios".
 * Usa el mismo cliente OAuth del inicio de sesión con Google; en Google Cloud
 * hay que autorizar  APP_URL + /api/socios/drive/callback  y activar la Drive API.
 */

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
export const DRIVE_REDIRECT = `${APP_URL}/api/socios/drive/callback`;
export const COOKIE_DRIVE = "g_drive";
const CARPETA = "Estradox - Socios";

let listo = false;
async function asegurar() {
  if (listo) return;
  for (const c of ["driveRefreshToken", "driveCuenta", "driveCarpetaId"]) {
    await ensureColumn("SiteSetting", c, "TEXT");
  }
  listo = true;
}

export function driveDisponible() {
  return !!CLIENT_ID && !!CLIENT_SECRET;
}

/** URL para que el root autorice Drive (+ estado que se guarda en cookie). */
export function iniciarDrive() {
  const state = crypto.randomBytes(24).toString("base64url");
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: DRIVE_REDIRECT,
    response_type: "code",
    scope: "openid email https://www.googleapis.com/auth/drive.file",
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, state };
}

/** Cambia el código por el token de larga duración y lo guarda. */
export async function conectarDrive(code: string) {
  await asegurar();
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: DRIVE_REDIRECT,
      grant_type: "authorization_code",
    }),
  });
  const j = (await r.json()) as { refresh_token?: string; id_token?: string; error?: string };
  if (!r.ok || !j.refresh_token) throw new Error(j.error ?? "Google no entregó el permiso de Drive.");
  let cuenta: string | null = null;
  try {
    const payload = JSON.parse(Buffer.from((j.id_token ?? "").split(".")[1] ?? "", "base64url").toString());
    cuenta = payload.email ?? null;
  } catch {
    // ignore
  }
  await prisma.$executeRawUnsafe(
    `UPDATE "SiteSetting" SET "driveRefreshToken" = $1, "driveCuenta" = $2, "driveCarpetaId" = NULL WHERE id = 'site'`,
    j.refresh_token,
    cuenta,
  );
}

export async function estadoDrive(): Promise<{ conectado: boolean; cuenta: string | null }> {
  try {
    await asegurar();
    const [s] = await prisma.$queryRawUnsafe<{ t: string | null; c: string | null }[]>(
      `SELECT "driveRefreshToken" AS t, "driveCuenta" AS c FROM "SiteSetting" WHERE id = 'site'`,
    );
    return { conectado: !!s?.t, cuenta: s?.c ?? null };
  } catch {
    return { conectado: false, cuenta: null };
  }
}

let cache: { token: string; hasta: number } | null = null;
async function tokenAcceso(): Promise<string | null> {
  if (cache && cache.hasta > Date.now() + 60_000) return cache.token;
  await asegurar();
  const [s] = await prisma.$queryRawUnsafe<{ t: string | null }[]>(
    `SELECT "driveRefreshToken" AS t FROM "SiteSetting" WHERE id = 'site'`,
  );
  if (!s?.t) return null;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: s.t,
      grant_type: "refresh_token",
    }),
  });
  const j = (await r.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!r.ok || !j.access_token) throw new Error(`Drive: ${j.error ?? r.status}`);
  cache = { token: j.access_token, hasta: Date.now() + (j.expires_in ?? 3000) * 1000 };
  return cache.token;
}

async function carpetaId(token: string): Promise<string> {
  const [s] = await prisma.$queryRawUnsafe<{ id: string | null }[]>(
    `SELECT "driveCarpetaId" AS id FROM "SiteSetting" WHERE id = 'site'`,
  );
  if (s?.id) return s.id;
  const r = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: CARPETA, mimeType: "application/vnd.google-apps.folder" }),
  });
  const j = (await r.json()) as { id?: string };
  if (!r.ok || !j.id) throw new Error(`Drive: no se pudo crear la carpeta (${r.status})`);
  await prisma.$executeRawUnsafe(`UPDATE "SiteSetting" SET "driveCarpetaId" = $1 WHERE id = 'site'`, j.id);
  return j.id;
}

/** Sube un archivo a la carpeta de socios. null si Drive no está conectado. */
export async function subirADrive(nombre: string, mime: string, datos: Buffer) {
  const token = await tokenAcceso();
  if (!token) return null;
  const padre = await carpetaId(token);
  const limite = `estradox${crypto.randomBytes(8).toString("hex")}`;
  const meta = JSON.stringify({ name: nombre, parents: [padre] });
  const cuerpo = Buffer.concat([
    Buffer.from(`--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`),
    Buffer.from(`--${limite}\r\nContent-Type: ${mime}\r\n\r\n`),
    datos,
    Buffer.from(`\r\n--${limite}--`),
  ]);
  const r = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${limite}` },
      body: cuerpo,
    },
  );
  const j = (await r.json()) as { id?: string; webViewLink?: string; error?: { message?: string } };
  if (!r.ok || !j.id) {
    // Si la carpeta se borró en Drive, se crea de nuevo en el próximo intento.
    if (r.status === 404) await prisma.$executeRawUnsafe(`UPDATE "SiteSetting" SET "driveCarpetaId" = NULL WHERE id = 'site'`);
    throw new Error(`Drive: ${j.error?.message ?? r.status}`);
  }
  return { id: j.id, url: j.webViewLink ?? `https://drive.google.com/file/d/${j.id}/view` };
}
