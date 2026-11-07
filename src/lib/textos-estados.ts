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
