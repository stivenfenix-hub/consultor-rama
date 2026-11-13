"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireUser } from "@/lib/auth";
import { cambiarEstado, crearCaso, esTipoSoporte, responder } from "@/lib/soporte";

export type EstadoForm = { error?: string };

export async function crearCasoAction(_prev: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const user = await requireUser();
  const tipo = String(fd.get("tipo") ?? "");
  const asunto = String(fd.get("asunto") ?? "").trim();
  const texto = String(fd.get("texto") ?? "").trim();
  if (!esTipoSoporte(tipo)) return { error: "Elige de qué se trata." };
  if (asunto.length < 3) return { error: "Escribe un asunto corto (p. ej. «No me llegó el correo»)." };
  if (texto.length < 5) return { error: "Cuéntanos un poco más en el mensaje." };
  let id: number;
  try {
    id = await crearCaso(user.id, tipo, asunto, texto);
  } catch (e) {
    console.error("[soporte] crear", e);
    return { error: "No pudimos enviar tu mensaje. Intenta de nuevo en un momento." };
  }
  redirect(`/dashboard/soporte/${id}?enviado=1`);
}

/** Mensaje en un caso: el abogado en el suyo, o el root (respuesta de Estradox) en cualquiera. */
export async function responderAction(_prev: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const id = Number(fd.get("id"));
  const texto = String(fd.get("texto") ?? "").trim();
  const comoSoporte = fd.get("lado") === "soporte";
  if (!Number.isInteger(id) || !texto) return { error: "Escribe un mensaje." };
  try {
    if (comoSoporte) {
      await requireAdmin();
      await responder(id, "soporte", texto);
      if (fd.get("cerrar") === "1") await cambiarEstado(id, "cerrado");
    } else {
      const user = await requireUser();
      if (!(await responder(id, "usuario", texto, user.id))) return { error: "No encontramos esta conversación." };
    }
  } catch (e) {
    console.error("[soporte] responder", e);
    return { error: "No se pudo enviar. Intenta de nuevo." };
  }
  revalidatePath(comoSoporte ? `/dashboard/admin/soporte/${id}` : `/dashboard/soporte/${id}`);
  return {};
}

export async function estadoCasoAction(fd: FormData) {
  const id = Number(fd.get("id"));
  const estado = fd.get("estado") === "cerrado" ? "cerrado" : "abierto";
  if (!Number.isInteger(id)) return;
  if (fd.get("lado") === "soporte") {
    await requireAdmin();
    await cambiarEstado(id, estado);
    revalidatePath(`/dashboard/admin/soporte/${id}`);
  } else {
    const user = await requireUser();
    await cambiarEstado(id, estado, user.id);
    revalidatePath(`/dashboard/soporte/${id}`);
  }
}
