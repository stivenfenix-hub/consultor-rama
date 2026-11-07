import { textoPrivado } from "./textos-estados";

// Textos para cuando la Rama Judicial (la fuente de la información) falla.
// Regla del dueño (7 nov 2026): al abogado NUNCA se le muestra un error de la
// Rama. Todo se reintenta en segundo plano y se le dice que en unos momentos le
// notificamos. Los únicos errores que ve son los suyos: radicado sin 23 dígitos
// o que no existe. Las caídas de la Rama solo las ve el root (Panel admin).

/** Ya no se muestra a los abogados (se conserva para el panel del root). */
export const MSG_RAMA_CAIDA =
  "La Rama Judicial —la plataforma oficial de donde Estradox toma la información— no está respondiendo en este momento.";

/** Al actualizar un proceso a mano y la Rama no responde: se sigue intentando en segundo plano. */
export const MSG_RAMA_ACTUALIZAR =
  "Estamos actualizando tu proceso en segundo plano. En unos momentos te notificamos cuando esté listo.";

export const MSG_RAMA_DOCUMENTO =
  "Estamos preparando este documento. Intenta abrirlo de nuevo en unos minutos.";

/** Ya no se muestra a los abogados. */
export const MSG_RAMA_REVISION = "";

/** ¿El mensaje es de una falla de la Rama (para mostrarlo con estilo tranquilo)? */
export const esMensajeRama = (m?: string | null) =>
  !!m && (m.startsWith("La Rama Judicial") || m === MSG_RAMA_ACTUALIZAR || m === MSG_RAMA_DOCUMENTO);
export const MSG_RAMA_DOC_RESTRINGIDO =
  "El juzgado dejó este documento restringido: no se puede descargar desde la consulta pública. Si lo necesitas, solicítalo directamente al despacho.";

/**
 * Qué decirle al abogado según el último error guardado del proceso. No todo
 * error es una caída: privado y "sin actuaciones" son respuestas normales.
 * Las fallas de la Rama no se le muestran (se reintentan solas).
 */
export function avisoProceso(
  lastError?: string | null,
  /** El abogado tiene estados electrónicos activo (los privados se vigilan ahí). */
  enEstados = true,
): { tipo: "privado" | "sinActuaciones"; texto: string } | null {
  if (!lastError) return null;
  if (/privad/i.test(lastError)) {
    return { tipo: "privado", texto: textoPrivado(enEstados) };
  }
  if (/no se encontraron actuaciones/i.test(lastError)) {
    return { tipo: "sinActuaciones", texto: "Este proceso aún no tiene actuaciones publicadas en la Rama Judicial. Te avisamos cuando aparezca la primera." };
  }
  return null;
}
