import "server-only";

/**
 * Proveedor externo de verificación de identidad (Truora, MetaMap, Olimpia…).
 *
 * Hoy Estradox verifica por su cuenta: el firmante toma fotos de su cédula y
 * una selfie con prueba de vida, y la comparación se hace en su dispositivo
 * (motor "estradox"). Cuando se contrate un proveedor que valide contra la
 * Registraduría y certifique la prueba de vida, se configura así:
 *
 *   IDENTIDAD_PROVEEDOR="truora"   (nombre del proveedor)
 *   IDENTIDAD_API_URL="https://…"   (endpoint de su API)
 *   IDENTIDAD_API_KEY="…"           (llave de su API)
 *
 * y se escribe aquí la llamada a su API dentro de `verificarConProveedor`.
 * El resto del módulo (portal, certificado, detalle del abogado) ya usa el
 * resultado que devuelva esta función.
 */

export type ResultadoProveedor = {
  motor: string;
  numeroCoincide: boolean | null;
  rostroCoincide: boolean | null;
  similitud: number | null;
  vida: { parpadeo: boolean; giro: boolean } | null;
  /** Identificador de la verificación en el proveedor (para auditoría). */
  referencia: string | null;
};

export function proveedorIdentidad(): string | null {
  const p = process.env.IDENTIDAD_PROVEEDOR?.trim();
  return p && process.env.IDENTIDAD_API_KEY ? p : null;
}

/**
 * Envía las fotos al proveedor y devuelve su veredicto. Sin proveedor
 * configurado devuelve null y se usa el resultado de Estradox.
 */
export async function verificarConProveedor(_d: {
  numDoc: string;
  tipoDoc: string;
  frente: Buffer;
  reverso: Buffer;
  selfie: Buffer | null;
}): Promise<ResultadoProveedor | null> {
  const p = proveedorIdentidad();
  if (!p) return null;
  // Integración pendiente: cada proveedor tiene su propia API. Se implementa
  // cuando se contrate (ver IDENTIDAD_API_URL / IDENTIDAD_API_KEY).
  throw new Error(`El proveedor de identidad "${p}" está configurado pero su integración aún no está escrita.`);
}
