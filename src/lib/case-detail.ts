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

const MINUSCULAS = new Set(["de", "del", "la", "las", "los", "el", "y", "e", "en", "por", "para"]);

/** "WILLIAN JAVIER BORJA RICO" o "gerardo nossa" -> "Willian Javier Borja Rico" (si viene todo en mayúsculas o todo en minúsculas). */
function nombreLegible(s: string) {
  const t = s.replace(/\s+/g, " ").trim();
  if (t !== t.toUpperCase() && t !== t.toLowerCase()) return t;
  return t
    .toLowerCase()
    .split(" ")
    .map((w, i) => (i > 0 && MINUSCULAS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ")
    .replace(/\b(Sas|S\.a\.s|Ltda|S\.a|Ese|E\.s\.e|Ph|P\.h)\b/g, (m) => m.toUpperCase());
}

/**
 * Título del proceso (28 nov 2026): "Demandante vs Demandado" a partir de los
 * sujetos de la Rama. Si hay varios de un lado, "y otros". null si no hay partes
 * (p. ej. proceso privado).
 */
export function tituloPartes(sujetos: string | null): string | null {
  if (!sujetos || /PROCESO PRIVADO/i.test(sujetos)) return null;
  const partes = parsePartes(sujetos.replace(/\s+/g, " ")).filter((p) => p.nombre);
  const de = (re: RegExp) => partes.filter((p) => re.test(p.rol)).map((p) => nombreLegible(p.nombre));
  const lado = (l: string[]) => (l.length === 0 ? null : l.length === 1 ? l[0] : `${l[0]} y otros`);
  const a = lado(de(/demandante|accionante|ejecutante|solicitante|denunciante|convocante/i));
  const b = lado(de(/demandad|accionad|ejecutad|indiciad|causante|convocad/i));
  if (a && b) return `${a} vs ${b}`;
  return a ?? b ?? (partes[0] ? nombreLegible(partes[0].nombre) : null);
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
