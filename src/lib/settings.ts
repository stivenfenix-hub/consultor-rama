import "server-only";
import { prisma } from "./db";

export type SiteSettings = {
  id: string;
  brandName: string;
  logoDataUrl: string | null;
  colorAccent: string;
  colorAccent2: string;
  colorBg: string;
  colorPanel: string;
};

const DEFAULTS: SiteSettings = {
  id: "site",
  brandName: "Estradox",
  logoDataUrl: null,
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
