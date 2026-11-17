import "server-only";
import { prisma } from "./db";
import {
  NIVELES,
  PRECIOS_FIRMA,
  documentoPorId,
  documentosEnviados,
  firmantesDe,
  marcarEnviado,
  nombreAbogado,
  type NivelVerificacion,
} from "./firmas";
import { enviarInvitacion } from "./firma-envios";

/**
 * Cobro de Firma Electrónica: cada documento se paga con Bold ANTES de enviar
 * los correos y WhatsApp a los firmantes. Al confirmarse el pago (webhook de
 * Bold, la página de regreso o el cron de respaldo) se envía solo.
 *
 *   - El primer documento de cada abogado es gratis (para que lo pruebe).
 *   - La cuenta administradora no paga.
 *   - Precio por documento según el nivel (PRECIOS_FIRMA), sin importar
 *     cuántos firmantes tenga.
 */

export type Cotizacion = { precio: number; gratis: boolean; motivo: "primera" | "admin" | null };

export async function cotizar(userId: string, nivel: NivelVerificacion): Promise<Cotizacion> {
  const [u] = await prisma.$queryRawUnsafe<{ role: string | null }[]>(`SELECT role FROM "User" WHERE id = $1`, userId);
  if (u?.role === "admin") return { precio: 0, gratis: true, motivo: "admin" };
  if ((await documentosEnviados(userId)) === 0) return { precio: 0, gratis: true, motivo: "primera" };
  return { precio: PRECIOS_FIRMA[nivel], gratis: false, motivo: null };
}

export const nombreNivel = (n: NivelVerificacion) => NIVELES[n].t;

/**
 * Envía el documento a todos sus firmantes. Solo la primera llamada envía
 * (marcarEnviado es atómico), así que es seguro llamarla dos veces.
 */
export async function enviarDocumento(
  documentoId: string,
  cobro: { gratis: boolean; pagado: boolean },
  origen: { ip?: string | null; userAgent?: string | null } = {},
): Promise<{ enviado: boolean; sinCanal: number }> {
  if (!(await marcarEnviado(documentoId, cobro))) return { enviado: false, sinCanal: 0 };
  const doc = await documentoPorId(documentoId);
  if (!doc) return { enviado: false, sinCanal: 0 };
  const [firmantes, abogado] = await Promise.all([firmantesDe(doc.id), nombreAbogado(doc.userId)]);
  let sinCanal = 0;
  for (const f of firmantes) {
    const canales = await enviarInvitacion(doc, f, abogado, origen).catch((e) => {
      console.error("[firma] invitación", e);
      return [] as string[];
    });
    if (canales.length === 0) sinCanal++;
  }
  return { enviado: true, sinCanal };
}

/** Lo llama la confirmación de Bold cuando se aprueba el pago de un documento. */
export async function enviarTrasPago(documentoId: string, linkId: string, monto: number) {
  const doc = await documentoPorId(documentoId);
  if (!doc || doc.estado !== "DRAFT") return;
  // Se envía si pagó el link vigente del documento, o si lo que pagó cubre el
  // precio actual (por ejemplo, pagó un link anterior y luego cambió algo).
  if (doc.pagoId !== linkId && monto < (doc.precio ?? 0)) {
    console.warn(`[firma] pago ${linkId} no cubre el documento ${documentoId}`);
    return;
  }
  const r = await enviarDocumento(documentoId, { gratis: false, pagado: true }, { userAgent: "Pago confirmado por Bold" });
  if (r.enviado) console.log(`[firma] documento ${documentoId} enviado tras el pago ${linkId}`);
}

/** Links de pago de un documento que siguen sin confirmar (para revisarlos en Bold). */
export async function pagosPendientesDeFirma(documentoId: string) {
  return prisma.$queryRawUnsafe<{ id: string; status: string; url: string | null; amount: number }[]>(
    `SELECT id, status, url, amount FROM "BoldPayment"
     WHERE "firmaId" = $1 AND tipo = 'firma' ORDER BY "createdAt" DESC LIMIT 5`,
    documentoId,
  );
}
