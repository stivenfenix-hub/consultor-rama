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

/** Lee los ajustes del sitio (crea la fila por defecto si no existe). */
export async function getSiteSettings(): Promise<SiteSettings> {
  try {
    const s = await prisma.siteSetting.findUnique({ where: { id: "site" } });
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
    return DEFAULTS;
  }
}

export async function updateSiteSettings(
  data: Partial<Omit<SiteSettings, "id">>,
) {
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
  try {
    await ensureFaviconColumn();
    const rows = await prisma.$queryRawUnsafe<{ f: string | null }[]>(
      `SELECT "faviconDataUrl" AS f FROM "SiteSetting" WHERE id = 'site'`,
    );
    return rows[0]?.f ?? null;
  } catch {
    return null;
  }
}

export async function setFaviconDataUrl(dataUrl: string | null) {
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
