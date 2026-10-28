import "server-only";
import { prisma } from "./db";

// Los logos ya no van en la base: son archivos publicados (ver lib/marca.ts).
export type SiteSettings = {
  id: string;
  brandName: string;
  byUrl: string;
  colorAccent: string;
  colorAccent2: string;
  colorBg: string;
  colorPanel: string;
};

const DEFAULTS: SiteSettings = {
  id: "site",
  brandName: "Estradox",
  byUrl: "https://unorgroup.com",
  colorAccent: "#8b3dff",
  colorAccent2: "#4b23e6",
  colorBg: "#0a0820",
  colorPanel: "#151140",
};

/**
 * Se lee en cada página: se guarda en memoria 5 minutos por proceso para no
 * consultar Supabase cada vez. Un cambio en Apariencia tarda como mucho eso en
 * verse en los demás procesos.
 */
const TTL_MS = 5 * 60_000;
let memo: { v: SiteSettings; at: number } | null = null;

/** Lee los ajustes del sitio (por defecto si la fila no existe). */
export async function getSiteSettings(): Promise<SiteSettings> {
  if (memo && Date.now() - memo.at < TTL_MS) return memo.v;
  const v = await leerSiteSettings();
  if (v) memo = { v, at: Date.now() };
  return v ?? DEFAULTS;
}

async function leerSiteSettings(): Promise<SiteSettings | null> {
  try {
    const s = await prisma.siteSetting.findUnique({
      where: { id: "site" },
      select: {
        id: true,
        brandName: true,
        byUrl: true,
        colorAccent: true,
        colorAccent2: true,
        colorBg: true,
        colorPanel: true,
      },
    });
    return s ?? DEFAULTS;
  } catch {
    return null;
  }
}

export async function updateSiteSettings(data: Partial<Omit<SiteSettings, "id">>) {
  memo = null;
  await prisma.siteSetting.upsert({
    where: { id: "site" },
    update: data,
    create: { id: "site", ...data },
  });
}
