// Textos para cuando la Rama Judicial (la fuente de la información) falla.
// Se muestran como explicación tranquila, no como error rojo: el problema es
// de la plataforma de la Rama, no del abogado ni de Estradox.

export const MSG_RAMA_CAIDA =
  "La Rama Judicial —la plataforma oficial de donde Estradox toma la información— no está respondiendo en este momento. No es un problema de tu cuenta ni de Estradox: tus datos están seguros y lo intentamos de nuevo automáticamente en cuanto vuelva.";

export const MSG_RAMA_ACTUALIZAR =
  "La Rama Judicial no respondió en este momento (es una falla temporal de su plataforma, no de Estradox). Tu proceso sigue guardado; esta noche lo revisamos de nuevo automáticamente, o puedes intentarlo en un rato.";

export const MSG_RAMA_DOCUMENTO =
  "La Rama Judicial no está entregando este documento en este momento (es una falla temporal de su plataforma, no de Estradox). Intenta de nuevo en unos minutos.";

export const MSG_RAMA_REVISION =
  "La Rama Judicial no respondió en la última revisión. Lo intentamos de nuevo automáticamente; no tienes que hacer nada.";

/** ¿El mensaje es de una falla de la Rama (para mostrarlo con estilo tranquilo)? */
export const esMensajeRama = (m?: string | null) => !!m && m.startsWith("La Rama Judicial");
export const MSG_RAMA_DOC_RESTRINGIDO = "La Rama Judicial no permite descargar este documento: el juzgado lo dejó restringido en su plataforma. No es una falla de Estradox; si lo necesitas, solicítalo directamente al despacho.";
