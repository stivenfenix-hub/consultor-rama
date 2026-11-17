"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { destinatariosFirma, encolarCorreosFirma, personalizar } from "@/lib/campanas";

type Resultado = { ok?: string; error?: string };

/** Root: encola la campaña de Firma electrónica gratis a los elegidos (WhatsApp y/o correo). */
export async function enviarCampanaFirmaAction(
  ids: string[],
  canales: { whatsapp: boolean; correo: boolean; notificacion?: boolean },
  textos: { whatsapp: string; asunto: string; correo: string; notiTitulo?: string; notiCuerpo?: string },
): Promise<Resultado> {
  await requireAdmin();
  if (!canales.whatsapp && !canales.correo && !canales.notificacion) {
    return { error: "Elige al menos un canal: WhatsApp, correo o notificación." };
  }
  if (canales.notificacion && String(textos.notiCuerpo ?? "").trim().length < 10) {
    return { error: "Escribe el texto de la notificación." };
  }
  if (!Array.isArray(ids) || ids.length === 0) return { error: "Elige al menos un abogado." };
  const wa = String(textos.whatsapp ?? "").trim().slice(0, 3000);
  const asunto = String(textos.asunto ?? "").trim().slice(0, 200);
  const cuerpo = String(textos.correo ?? "").trim().slice(0, 12000);
  if (canales.whatsapp && wa.length < 20) return { error: "Escribe el mensaje de WhatsApp." };
  if (canales.correo && (asunto.length < 5 || cuerpo.length < 20)) return { error: "Escribe el asunto y el correo." };

  // Solo a quienes siguen cumpliendo: 1 proceso o más y ninguna firma enviada.
  const { lista } = await destinatariosFirma();
  const validos = new Set(lista.map((d) => d.id));
  const elegidos = ids.filter((id) => validos.has(id));
  if (!elegidos.length) return { error: "Ninguno de los elegidos cumple: ya enviaron una firma o no tienen procesos." };
  // "whatsapp" es columna creada en tiempo de ejecución (no está en el esquema de Prisma).
  const usuarios = await prisma.$queryRawUnsafe<
    { id: string; email: string; firstName: string | null; lastName: string | null; name: string | null; whatsapp: string | null }[]
  >(`SELECT id, email, "firstName", "lastName", name, "whatsapp" FROM "User" WHERE id = ANY($1::text[])`, elegidos);

  const partes: string[] = [];
  if (canales.whatsapp) {
    const { encolarWhatsapp, estadoWhatsapp } = await import("@/lib/whatsapp");
    const comercial = (await estadoWhatsapp().catch(() => [])).find((e) => e.cuenta === "comercial");
    if (!comercial?.numero) return { error: "El WhatsApp comercial no está vinculado." };
    const conNumero = usuarios.filter((u) => (u.whatsapp ?? "").replace(/\D/g, "").length >= 10);
    const n = await encolarWhatsapp(
      conNumero.map((u) => ({ userId: u.id, tipo: "campana", telefono: u.whatsapp!, mensaje: personalizar(wa, u) })),
    );
    partes.push(
      `${n} WhatsApp en cola (salen despacio por el comercial, máximo ${comercial.maxDia} al día)` +
        (usuarios.length - conNumero.length ? `; ${usuarios.length - conNumero.length} sin número` : ""),
    );
  }
  if (canales.correo) {
    const n = await encolarCorreosFirma(usuarios, asunto, cuerpo);
    partes.push(
      `${n} correo(s) en cola (salen de a 1 o 2 cada 5 minutos, de 8 a.m. a 7 p.m.)` +
        (usuarios.length - n ? `; ${usuarios.length - n} ya lo tenían` : ""),
    );
  }
  if (canales.notificacion) {
    // Campanita de la plataforma (y app Android) + notificación push a sus dispositivos.
    // Va en segundo plano: con muchos abogados tarda unos segundos.
    const titulo = String(textos.notiTitulo ?? "").trim().slice(0, 80) || "🎁 Tu primera firma electrónica es gratis";
    const cuerpoNoti = String(textos.notiCuerpo ?? "").trim().slice(0, 200);
    const ids = usuarios.map((u) => u.id);
    after(async () => {
      const { sendPushToUsers } = await import("@/lib/push");
      const r = await sendPushToUsers(ids, { title: titulo, body: cuerpoNoti, url: "/dashboard/firmas", tag: "campana-firma" }).catch(
        (e) => {
          console.error("[campana] push", e);
          return null;
        },
      );
      if (r) console.log(`[campana] push: ${r.sent} enviadas, ${r.failed} fallidas`);
    });
    partes.push(`Campanita y notificación push a ${ids.length} abogado(s) (al momento)`);
  }
  revalidatePath("/dashboard/admin/campanas");
  revalidatePath("/dashboard/admin/whatsapp");
  return { ok: partes.join(". ") + "." };
}
