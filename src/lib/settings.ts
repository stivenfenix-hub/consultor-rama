import "server-only";
import { prisma } from "./db";
import { ensureColumn } from "./runtime-columns";

export type SiteSettings = {
  id: string;
  brandName: string;
  logoDataUrl: string | null;
  emailLogoDataUrl: string | null;
  byLogoDataUrl: string | null;
  byUrl: string;
  notifIconDataUrl: string | null;
  notifBadgeDataUrl: string | null;
  colorAccent: string;
  colorAccent2: string;
  colorBg: string;
  colorPanel: string;
};

const DEFAULTS: SiteSettings = {
  id: "site",
  brandName: "Estradox",
  logoDataUrl: null,
  emailLogoDataUrl: null,
  byLogoDataUrl: null,
  byUrl: "https://unorgroup.com",
  notifIconDataUrl: null,
  notifBadgeDataUrl: null,
  colorAccent: "#8b3dff",
  colorAccent2: "#4b23e6",
  colorBg: "#0a0820",
  colorPanel: "#151140",
};

/**
 * Los ajustes (con los logos en base64, ~100 KB) se leían de Supabase en cada
 * página, varias veces: era casi todo el egress de la base. Ahora se guardan en
 * memoria 5 minutos por proceso; un cambio en Apariencia tarda como mucho eso
 * en verse en los demás procesos.
 */
const TTL_MS = 5 * 60_000;
let memo: { v: SiteSettings; at: number } | null = null;
let memoFavicon: { v: string | null; at: number } | null = null;

/** Lee los ajustes del sitio (por defecto si la fila no existe). */
export async function getSiteSettings(): Promise<SiteSettings> {
  if (memo && Date.now() - memo.at < TTL_MS) return memo.v;
  const v = await leerSiteSettings();
  if (v) memo = { v, at: Date.now() };
  return v ?? DEFAULTS;
}

/** Firma corta de una imagen, para que su URL cambie cuando cambia el logo. */
export function versionImagen(dataUrl: string | null) {
  if (!dataUrl) return "0";
  let h = 0;
  for (let i = 0; i < dataUrl.length; i += 97) h = (h * 31 + dataUrl.charCodeAt(i)) | 0;
  return `${dataUrl.length.toString(36)}${(h >>> 0).toString(36)}`;
}

async function leerSiteSettings(): Promise<SiteSettings | null> {
  try {
    const s = await prisma.siteSetting.findUnique({
      where: { id: "site" },
      select: {
        id: true,
        brandName: true,
        logoDataUrl: true,
        emailLogoDataUrl: true,
        byLogoDataUrl: true,
        byUrl: true,
        notifIconDataUrl: true,
        notifBadgeDataUrl: true,
        colorAccent: true,
        colorAccent2: true,
        colorBg: true,
        colorPanel: true,
      },
    });
    if (!s) return DEFAULTS;
    return {
      id: s.id,
      brandName: s.brandName,
      logoDataUrl: s.logoDataUrl,
      emailLogoDataUrl: s.emailLogoDataUrl,
      byLogoDataUrl: s.byLogoDataUrl,
      byUrl: s.byUrl,
      notifIconDataUrl: s.notifIconDataUrl,
      notifBadgeDataUrl: s.notifBadgeDataUrl,
      colorAccent: s.colorAccent,
      colorAccent2: s.colorAccent2,
      colorBg: s.colorBg,
      colorPanel: s.colorPanel,
    };
  } catch {
    return null;
  }
}

export async function updateSiteSettings(
  data: Partial<Omit<SiteSettings, "id">>,
) {
  memo = null;
  await prisma.siteSetting.upsert({
    where: { id: "site" },
    update: data,
    create: { id: "site", ...data },
  });
}

// ---------- Favicon ----------
// Columna creada en tiempo de ejecución (ver runtime-columns.ts).
const ensureFaviconColumn = () =>
  ensureColumn("SiteSetting", "faviconDataUrl", "TEXT");

/** Favicon subido por el admin (data URL) o null si usa el de por defecto. */
export async function getFaviconDataUrl(): Promise<string | null> {
  if (memoFavicon && Date.now() - memoFavicon.at < TTL_MS) return memoFavicon.v;
  try {
    await ensureFaviconColumn();
    const rows = await prisma.$queryRawUnsafe<{ f: string | null }[]>(
      `SELECT "faviconDataUrl" AS f FROM "SiteSetting" WHERE id = 'site'`,
    );
    const v = rows[0]?.f ?? null;
    memoFavicon = { v, at: Date.now() };
    return v;
  } catch {
    return null;
  }
}

export async function setFaviconDataUrl(dataUrl: string | null) {
  memoFavicon = null;
  await ensureFaviconColumn();
  await prisma.siteSetting.upsert({
    where: { id: "site" },
    create: { id: "site" },
    update: {},
  });
  await prisma.$executeRawUnsafe(
    `UPDATE "SiteSetting" SET "faviconDataUrl" = $1 WHERE id = 'site'`,
    dataUrl,
  );
}
