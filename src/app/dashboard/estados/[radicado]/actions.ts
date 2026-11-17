"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireUser } from "@/lib/auth";
import { estadosActivo, pedirActualizarRadicado, revisarDespachoDirecto } from "@/lib/estados";

/** Botón "Actualizar" de un radicado que solo está en estados electrónicos. */
export async function actualizarEstadoRadicadoAction(radicado: string): Promise<{ error?: string; reciente?: boolean }> {
  const user = await requireUser();
  if (!/^\d{23}$/.test(radicado)) return { error: "Radicado no válido." };
  if (!(await estadosActivo(user.id))) return { error: "Los estados electrónicos no están activos en tu cuenta." };
  const r = await pedirActualizarRadicado(user.id, radicado);
  if (r.estado === "no") return { error: "Este radicado no está en tu lista de estados." };
  // El VPS está bloqueado por el portal: lo revisa la app directamente, en segundo plano.
  if (r.estado === "directo" && r.despacho) {
    const despacho = r.despacho;
    after(async () => {
      await revisarDespachoDirecto(despacho);
    });
  }
  revalidatePath(`/dashboard/estados/${radicado}`);
  return { reciente: r.estado === "reciente" };
}
