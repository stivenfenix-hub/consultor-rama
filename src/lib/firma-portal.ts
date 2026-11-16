import "server-only";
import { cookies } from "next/headers";
import {
  cookieFirma,
  documentoPorId,
  firmantePorToken,
  sesionValida,
  type Documento,
  type Firmante,
} from "./firmas";

/**
 * Acceso del firmante (sin cuenta en Estradox): se identifica con el token de
 * su enlace y, después del OTP, con una cookie firmada de corta duración.
 */

export type AccesoFirmante =
  | { ok: true; firmante: Firmante; doc: Documento; verificado: boolean }
  | { ok: false; estado: number; error: string };

export async function accesoFirmante(token: string): Promise<AccesoFirmante> {
  const firmante = await firmantePorToken(token);
  if (!firmante) return { ok: false, estado: 404, error: "Este enlace no es válido." };
  const doc = await documentoPorId(firmante.documentoId);
  if (!doc || doc.estado === "DRAFT") return { ok: false, estado: 404, error: "Este enlace no es válido." };
  const jar = await cookies();
  const verificado = sesionValida(firmante.id, jar.get(cookieFirma(firmante.id))?.value);
  return { ok: true, firmante, doc, verificado };
}

/** ¿Todavía se puede firmar este documento con este enlace? Devuelve el motivo si no. */
export function bloqueo(doc: Documento, f: Firmante): string | null {
  if (doc.estado === "EXPIRED") return "Este enlace venció. Pídale a su abogado que le envíe el documento de nuevo.";
  if (doc.estado === "REJECTED") return "Este documento fue rechazado y ya no se puede firmar.";
  if (f.estado === "SIGNED") return "Usted ya firmó este documento.";
  if (f.estado === "REJECTED") return "Usted rechazó este documento.";
  if (doc.estado === "COMPLETED") return "Este documento ya fue firmado por todos.";
  return null;
}
