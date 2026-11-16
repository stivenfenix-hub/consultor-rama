"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import {
  TIPOS_DOC,
  documentoDe,
  eliminarBorrador,
  firmantesDe,
  guardarFirmantes,
  marcarEnviado,
  nombreAbogado,
  origenDe,
  type FirmanteNuevo,
  type PosicionFirma,
  type TipoDoc,
} from "@/lib/firmas";
import { enviarInvitacion } from "@/lib/firma-envios";

type Resultado = { ok?: string; error?: string };

export type FirmanteForm = {
  nombre: string;
  tipoDoc: string;
  numDoc: string;
  email: string;
  telefono: string;
  posicion: PosicionFirma | null;
};

const entre = (n: unknown, min: number, max: number) => typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;

/** Paso 4 del asistente: guarda firmantes y posiciones, y envía los enlaces. */
export async function enviarDocumentoAction(
  id: string,
  firmantes: FirmanteForm[],
  opciones: { otpCorreo: boolean; otpWhatsapp: boolean },
): Promise<Resultado> {
  const user = await requireUser();
  const doc = await documentoDe(user.id, id);
  if (!doc) return { error: "Documento no encontrado." };
  if (doc.estado !== "DRAFT") return { error: "Este documento ya fue enviado." };
  if (!opciones.otpCorreo && !opciones.otpWhatsapp) {
    return { error: "Elige al menos un medio para el código de verificación." };
  }
  if (!Array.isArray(firmantes) || firmantes.length === 0) return { error: "Agrega al menos un firmante." };
  if (firmantes.length > 10) return { error: "Máximo 10 firmantes por documento." };

  const limpios: FirmanteNuevo[] = [];
  for (const [i, f] of firmantes.entries()) {
    const n = i + 1;
    const nombre = String(f.nombre ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
    const numDoc = String(f.numDoc ?? "").trim().slice(0, 30);
    const email = String(f.email ?? "").trim().toLowerCase().slice(0, 160);
    const telefono = String(f.telefono ?? "").replace(/\D/g, "").slice(0, 15);
    const tipoDoc = (f.tipoDoc in TIPOS_DOC ? f.tipoDoc : "CC") as TipoDoc;
    if (nombre.length < 5) return { error: `Firmante ${n}: escribe el nombre completo.` };
    if (numDoc.replace(/\W/g, "").length < 4) return { error: `Firmante ${n}: escribe el número de documento.` };
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { error: `Firmante ${n}: el correo no es válido.` };
    if (telefono && telefono.length < 10) return { error: `Firmante ${n}: el WhatsApp debe tener 10 dígitos.` };
    if (!email && !telefono) return { error: `Firmante ${n}: necesita un correo o un WhatsApp para recibir el enlace.` };
    // Debe poder recibir el código por alguno de los medios elegidos.
    if (!((opciones.otpCorreo && email) || (opciones.otpWhatsapp && telefono))) {
      return {
        error: `Firmante ${n} (${nombre}): no tiene ${opciones.otpCorreo ? "correo" : "WhatsApp"} para recibir el código. Agrégalo o cambia el medio.`,
      };
    }
    const p = f.posicion;
    if (
      !p ||
      !Number.isInteger(p.page) ||
      p.page < 1 ||
      p.page > doc.paginas ||
      !entre(p.x, 0, 1) ||
      !entre(p.y, 0, 1) ||
      !entre(p.width, 0.05, 1) ||
      !entre(p.height, 0.02, 1) ||
      p.x + p.width > 1.001 ||
      p.y + p.height > 1.001
    ) {
      return { error: `Firmante ${n} (${nombre}): ubica su firma en el documento.` };
    }
    limpios.push({
      nombre,
      tipoDoc,
      numDoc,
      email: email || null,
      telefono: telefono || null,
      posicion: { page: p.page, x: p.x, y: p.y, width: p.width, height: p.height },
    });
  }

  await guardarFirmantes(doc.id, limpios);
  await marcarEnviado(doc.id, opciones.otpCorreo, opciones.otpWhatsapp);
  const [enviado, guardados, abogado] = await Promise.all([
    documentoDe(user.id, id),
    firmantesDe(doc.id),
    nombreAbogado(user.id),
  ]);
  const origen = origenDe(await headers());
  let sinCanal = 0;
  for (const f of guardados) {
    const canales = await enviarInvitacion(enviado ?? doc, f, abogado, origen);
    if (canales.length === 0) sinCanal++;
  }
  revalidatePath("/dashboard/firmas");
  return {
    ok:
      sinCanal > 0
        ? `Documento enviado, pero ${sinCanal} firmante(s) no recibieron el enlace. Cópialo desde el detalle y envíaselo tú.`
        : "Documento enviado a firmar.",
  };
}

/** Reenvía el enlace a quienes no han firmado (máximo uno cada 5 minutos por documento). */
export async function recordarAction(id: string): Promise<Resultado> {
  const user = await requireUser();
  const doc = await documentoDe(user.id, id);
  if (!doc) return { error: "Documento no encontrado." };
  if (doc.estado !== "PENDING" && doc.estado !== "PARTIALLY_SIGNED") {
    return { error: "Este documento ya no está pendiente de firmas." };
  }
  const { auditoriaDe } = await import("@/lib/firmas");
  const ultimo = (await auditoriaDe(doc.id)).filter((a) => a.evento === "REMINDER_SENT").pop();
  if (ultimo && Date.now() - new Date(ultimo.createdAt).getTime() < 5 * 60_000) {
    return { error: "Ya enviaste un recordatorio hace poco. Espera 5 minutos." };
  }
  const pendientes = (await firmantesDe(doc.id)).filter((f) => f.estado === "PENDING" || f.estado === "VIEWED");
  const abogado = await nombreAbogado(user.id);
  const origen = origenDe(await headers());
  for (const f of pendientes) await enviarInvitacion(doc, f, abogado, { ...origen, recordatorio: true });
  revalidatePath(`/dashboard/firmas/${id}`);
  return { ok: `Recordatorio enviado a ${pendientes.length} firmante(s).` };
}

export async function eliminarBorradorAction(id: string): Promise<Resultado> {
  const user = await requireUser();
  const n = await eliminarBorrador(user.id, id);
  revalidatePath("/dashboard/firmas");
  return n ? { ok: "Borrador eliminado." } : { error: "Solo se pueden eliminar borradores." };
}
