// Utilidades del detalle de un proceso, compartidas por la página web y el API móvil.

/** Convierte el string de sujetos de la Rama en una lista {rol, nombre}. */
export function parsePartes(
  sujetos: string | null,
): { rol: string; nombre: string }[] {
  if (!sujetos) return [];
  return sujetos
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((seg) => {
      const idx = seg.indexOf(":");
      if (idx < 0) return { rol: "Parte", nombre: seg };
      return {
        rol: seg.slice(0, idx).trim(),
        nombre: seg.slice(idx + 1).trim(),
      };
    });
}

// Detecta enlaces a grabaciones dentro del texto de las actuaciones.
const URL_RE = /https?:\/\/[^\s<>"')]+/gi;
const MEDIA_HOST =
  /(youtube\.com|youtu\.be|drive\.google|meet\.google|docs\.google|teams\.microsoft|zoom\.us|vimeo\.com|onedrive|1drv\.ms|dropbox\.com)/i;
const MEDIA_EXT = /\.(mp4|mp3|wav|m4a|mov|avi|mkv|ogg|webm)(\?|$)/i;

export function extraerGrabaciones(
  acts: { anotacion: string | null; actuacion: string | null; fechaActuacion: Date | null }[],
): { fecha: Date | null; actuacion: string; url: string }[] {
  const out: { fecha: Date | null; actuacion: string; url: string }[] = [];
  const vistas = new Set<string>();
  for (const a of acts) {
    const texto = `${a.anotacion ?? ""} ${a.actuacion ?? ""}`;
    const urls = texto.match(URL_RE) ?? [];
    for (const raw of urls) {
      const url = raw.replace(/[.,;)]+$/, "");
      if ((MEDIA_HOST.test(url) || MEDIA_EXT.test(url)) && !vistas.has(url)) {
        vistas.add(url);
        out.push({
          fecha: a.fechaActuacion,
          actuacion: a.actuacion ?? "Actuación",
          url,
        });
      }
    }
  }
  return out;
}
