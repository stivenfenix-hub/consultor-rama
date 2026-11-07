// Textos para el abogado cuando un radicado no está en la Consulta Nacional
// pero sí tiene código de juzgado: no es que "no exista", es que el juzgado no
// sube ese proceso a la Rama. Se vigila con estados electrónicos.

/** Marca guardada en la carga ("CargaProcesos".error) para esos radicados. */
export const PREFIJO_ESTADOS = "En vigilancia de estados electrónicos:";
/** Lo que se guardaba antes del 7 nov 2026 (cargas viejas). */
export const PREFIJO_VIEJO = "No existen en la Rama Judicial:";

/** Radicados marcados en el texto de una carga (nuevo o viejo formato) y el resto del texto. */
export function separarEstados(texto: string | null): { radicados: string[]; resto: string } {
  const t = texto ?? "";
  const m = t.match(/(?:En vigilancia de estados electrónicos|No existen en la Rama Judicial): ([^.]*)\./);
  if (!m) return { radicados: [], resto: t.trim() };
  return { radicados: m[1].split(/,\s*/).filter(Boolean), resto: t.replace(m[0], "").trim() };
}

/** Marca guardada para los que la Rama no entregó a tiempo (se reintentan solos). */
export const PREFIJO_SEGUNDO_PLANO = "Terminando de cargar en segundo plano:";

/**
 * Radicados que se siguen cargando en segundo plano (formato nuevo, o el viejo
 * "La Rama Judicial no respondió para: …") y el resto del texto. Al abogado
 * nunca se le muestra la falla de la Rama: solo que en unos momentos le avisamos.
 */
export function separarSegundoPlano(texto: string): { radicados: string[]; resto: string } {
  const re = /(?:Terminando de cargar en segundo plano|La Rama Judicial no respondió para): ([^.]*)\.(?:[^.]*(?:automáticamente|agregarlo)[^.]*\.)*/;
  const m = texto.match(re);
  if (m) {
    return { radicados: m[1].split(/,\s*/).filter(Boolean), resto: texto.replace(m[0], "").trim() };
  }
  // Otras fallas de la Rama ("se interrumpió", etc.): no se muestran.
  if (/rama|no respondi|interrumpi/i.test(texto)) return { radicados: [], resto: "" };
  return { radicados: [], resto: texto.trim() };
}

/** Texto para el abogado sobre los que se siguen cargando solos. */
export function textoSegundoPlano(radicados: string[]) {
  const uno = radicados.length === 1;
  return (
    `${uno ? "El radicado" : "Los radicados"} ${radicados.join(", ")} se ${uno ? "está" : "están"} terminando de ` +
    `cargar en segundo plano. En unos momentos te notificamos cuando ${uno ? "esté listo" : "estén listos"}; ` +
    `no tienes que volver a ${uno ? "agregarlo" : "agregarlos"}.`
  );
}

/**
 * Proceso privado: la Rama no publica sus actuaciones, pero muchos juzgados sí
 * lo publican en sus estados electrónicos, y esos se vigilan.
 */
export function textoPrivado(enEstados = true) {
  return enEstados
    ? "🔒 Proceso privado: la Rama Judicial no publica sus actuaciones en la Consulta Nacional. Pero con Estados " +
        "electrónicos, la nueva tecnología de Estradox, revisamos cada noche las publicaciones públicas del juzgado " +
        "y te avisamos cuando tu proceso salga en un estado."
    : "🔒 Proceso privado: la Rama Judicial no publica sus actuaciones.";
}

/** Explicación corta (notificaciones). */
export function explicacionCorta(radicados: string[]) {
  const uno = radicados.length === 1;
  return (
    `${uno ? "El radicado" : "Los radicados"} ${radicados.join(", ")} no ${uno ? "está" : "están"} en la Consulta ` +
    `Nacional porque el juzgado no sube sus actuaciones a la Rama. ${uno ? "Lo" : "Los"} vigilamos con Estados ` +
    `electrónicos, la nueva tecnología de Estradox: revisamos las publicaciones públicas del juzgado, extraemos la ` +
    `información y te avisamos cuando ${uno ? "aparezca" : "aparezcan"}.`
  );
}
