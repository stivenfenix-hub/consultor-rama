import "server-only";
import { sendMail } from "./mailer";
import { auditar, type Documento, type Firmante } from "./firmas";

/**
 * Mensajes del módulo de Firma Electrónica: invitación a firmar, código OTP,
 * recordatorio y aviso de documento completado. Correo por SMTP (mailer) y
 * WhatsApp por la cola propia de Estradox (cuenta "avisos").
 */

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const DESARROLLO = process.env.NODE_ENV !== "production";
export const enlaceFirma = (token: string) => `${APP_URL}/firmar/${token}`;
export const enlaceVerificar = (id: string) => `${APP_URL}/verificar/${id}`;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function correo(titulo: string, cuerpoHtml: string, boton?: { texto: string; url: string }) {
  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:580px;margin:0 auto;color:#1a1640">
    <h2 style="margin:0 0 12px;font-size:20px">${titulo}</h2>
    <div style="font-size:15px;line-height:1.55">${cuerpoHtml}</div>
    ${
      boton
        ? `<p style="margin:22px 0"><a href="${boton.url}" style="background:#6a2bf5;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;display:inline-block">${boton.texto}</a></p>
           <p style="font-size:12px;color:#6b6890">Si el botón no abre, copia este enlace: ${boton.url}</p>`
        : ""
    }
  </div>`;
}

/** 3001234567 -> 573001234567 (WhatsApp de Colombia). */
export function telefonoWa(t: string | null): string | null {
  const d = (t ?? "").replace(/\D/g, "");
  if (!d) return null;
  return d.length === 10 && d.startsWith("3") ? `57${d}` : d;
}

async function porWhatsapp(userId: string, telefono: string, mensaje: string): Promise<boolean> {
  try {
    const { encolarWhatsapp } = await import("./whatsapp");
    return (await encolarWhatsapp([{ tipo: "firma", telefono, mensaje, userId }])) > 0;
  } catch (e) {
    console.error("[firma] WhatsApp", e);
    return false;
  }
}

/** Invitación (o recordatorio) con el enlace personal de firma. */
export async function enviarInvitacion(
  doc: Documento,
  f: Firmante,
  abogado: string,
  o: { recordatorio?: boolean; ip?: string | null; userAgent?: string | null } = {},
) {
  const url = enlaceFirma(f.token);
  const canales: string[] = [];
  if (f.email) {
    await sendMail({
      to: f.email,
      subject: `${o.recordatorio ? "Recordatorio: " : ""}${abogado} le envió un documento para firmar`,
      html: correo(
        o.recordatorio ? "Tiene un documento pendiente de firma" : "Tiene un documento para firmar",
        `<p>Hola ${esc(f.nombre)},</p>
         <p><b>${esc(abogado)}</b> le envió el documento <b>«${esc(doc.titulo)}»</b> para que lo firme electrónicamente.</p>
         <p>Es rápido y lo puede hacer desde el celular: abre el enlace, confirma su identidad con un código y firma. Tiene plena validez legal en Colombia (Ley 527 de 1999 y Decreto 2364 de 2012).</p>`,
        { texto: "Revisar y firmar", url },
      ),
      text: `${abogado} le envió el documento "${doc.titulo}" para firmar electrónicamente. Ábralo aquí: ${url}`,
    }).catch((e) => console.error("[firma] correo", e));
    canales.push("correo");
    await auditar(doc.id, o.recordatorio ? "REMINDER_SENT" : "SENT_EMAIL", {
      firmanteId: f.id,
      ip: o.ip,
      userAgent: o.userAgent,
      metadata: { canal: "correo", destino: f.email },
    });
  }
  const tel = telefonoWa(f.telefono);
  if (tel) {
    const ok = await porWhatsapp(
      doc.userId,
      tel,
      `Hola ${f.nombre} 👋\n\n${abogado} le envió el documento «${doc.titulo}» para firmar electrónicamente con Estradox ⚖️.\n\nLo puede firmar desde el celular, con plena validez legal:\n👉 ${url}`,
    );
    if (ok) {
      canales.push("whatsapp");
      await auditar(doc.id, o.recordatorio ? "REMINDER_SENT" : "SENT_WHATSAPP", {
        firmanteId: f.id,
        ip: o.ip,
        userAgent: o.userAgent,
        metadata: { canal: "whatsapp", destino: tel },
      });
    }
  }
  if (DESARROLLO) console.log(`[firma] (desarrollo) Enlace de ${f.nombre}: ${url}`);
  return canales;
}

/** Código de 6 dígitos al canal elegido. Devuelve el destino enmascarado. */
export async function enviarOtp(doc: Documento, f: Firmante, codigo: string, canal: "correo" | "whatsapp") {
  if (DESARROLLO) console.log(`[firma] (desarrollo) Código OTP de ${f.nombre}: ${codigo}`);
  if (canal === "whatsapp") {
    const tel = telefonoWa(f.telefono);
    if (!tel) throw new Error("Este firmante no tiene WhatsApp registrado.");
    const ok = await porWhatsapp(
      doc.userId,
      tel,
      `Su código para firmar «${doc.titulo}» es: *${codigo}*\n\nVence en 10 minutos. No lo comparta con nadie. — Estradox`,
    );
    if (!ok && !DESARROLLO) throw new Error("No pudimos enviar el código por WhatsApp. Intente por correo.");
    return `WhatsApp terminado en ${tel.slice(-4)}`;
  }
  if (!f.email) throw new Error("Este firmante no tiene correo registrado.");
  await sendMail({
    to: f.email,
    subject: `${codigo} es su código para firmar`,
    html: correo(
      "Su código de verificación",
      `<p>Hola ${esc(f.nombre)}, use este código para firmar <b>«${esc(doc.titulo)}»</b>:</p>
       <p style="font-size:34px;letter-spacing:8px;font-weight:700;margin:16px 0;color:#6a2bf5">${codigo}</p>
       <p>Vence en 10 minutos. No lo comparta con nadie: equivale a su firma.</p>`,
    ),
    text: `Su código para firmar "${doc.titulo}" es ${codigo}. Vence en 10 minutos. No lo comparta con nadie.`,
  });
  const [u, d] = f.email.split("@");
  return `${u.slice(0, 2)}***@${d}`;
}

/** Documento completado: a cada firmante (y al abogado por la campana). */
export async function avisarCompletado(doc: Documento, firmantes: Firmante[], pdf: Buffer) {
  const url = enlaceVerificar(doc.id);
  const adjunto = [{ filename: `${doc.titulo.replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 80) || "documento"} (firmado).pdf`, content: pdf, contentType: "application/pdf" }];
  for (const f of firmantes) {
    if (!f.email) continue;
    await sendMail({
      to: f.email,
      subject: `Documento firmado: ${doc.titulo}`,
      html: correo(
        "El documento quedó firmado por todos",
        `<p>Hola ${esc(f.nombre)},</p>
         <p>Todas las partes firmaron <b>«${esc(doc.titulo)}»</b>. Va adjunto el PDF sellado, con su certificado de auditoría al final.</p>
         <p>Cualquier persona puede comprobar que es auténtico escaneando el código QR del certificado o en este enlace:</p>`,
        { texto: "Verificar el documento", url },
      ),
      text: `Todas las partes firmaron "${doc.titulo}". Verifíquelo en ${url}`,
      attachments: adjunto,
    }).catch((e) => console.error("[firma] correo completado", e));
  }
  try {
    const { sendPushToUser } = await import("./push");
    await sendPushToUser(doc.userId, {
      title: "✅ Documento firmado por todos",
      body: `«${doc.titulo}» ya tiene todas las firmas. Descarga el PDF sellado.`,
      url: `/dashboard/firmas/${doc.id}`,
      tag: `firma-${doc.id}`,
    });
  } catch (e) {
    console.error("[firma] push", e);
  }
}

/** Avisa al abogado (campana + push) de una firma o un rechazo. */
export async function avisarAbogado(doc: Documento, titulo: string, cuerpo: string) {
  try {
    const { sendPushToUser } = await import("./push");
    await sendPushToUser(doc.userId, { title: titulo, body: cuerpo, url: `/dashboard/firmas/${doc.id}`, tag: `firma-${doc.id}` });
  } catch (e) {
    console.error("[firma] push", e);
  }
}
