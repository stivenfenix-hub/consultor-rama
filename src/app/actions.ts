"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { loginWithEmail, logout, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  agregarProcesoPorRadicado,
  sincronizarProceso,
  marcarVistas,
} from "@/lib/sync";
import { RamaError } from "@/lib/rama";

type ActionState = { error?: string; ok?: string };

const loginSchema = z.object({
  email: z.string().email("Correo invalido"),
  name: z.string().optional(),
});

export async function loginAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    name: formData.get("name") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos invalidos" };
  }
  await loginWithEmail(parsed.data.email, parsed.data.name);
  redirect("/dashboard");
}

export async function logoutAction() {
  await logout();
  redirect("/login");
}

const radicadoSchema = z
  .string()
  .transform((s) => s.replace(/\D/g, ""))
  .refine((s) => s.length === 23, "El radicado debe tener 23 digitos");

export async function agregarProcesoAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const parsed = radicadoSchema.safeParse(formData.get("radicado"));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Radicado invalido" };
  }
  try {
    const creados = await agregarProcesoPorRadicado(user.id, parsed.data);
    revalidatePath("/dashboard");
    return { ok: `Proceso agregado (${creados.length} registro(s)).` };
  } catch (err) {
    if (err instanceof RamaError) return { error: err.message };
    return {
      error:
        "No se pudo consultar la Rama Judicial (puede estar lenta). Intenta de nuevo.",
    };
  }
}

export async function refrescarProcesoAction(caseId: string) {
  const user = await requireUser();
  const caso = await prisma.case.findFirst({
    where: { id: caseId, userId: user.id },
  });
  if (!caso) return;
  try {
    await sincronizarProceso(caseId);
  } catch {
    // el error queda guardado en caso.lastError
  }
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/${caseId}`);
}

export async function marcarVistasAction(caseId: string) {
  const user = await requireUser();
  const caso = await prisma.case.findFirst({
    where: { id: caseId, userId: user.id },
  });
  if (!caso) return;
  await marcarVistas(caseId);
  revalidatePath(`/dashboard/${caseId}`);
  revalidatePath("/dashboard");
}

export async function eliminarProcesoAction(caseId: string) {
  const user = await requireUser();
  await prisma.case.deleteMany({ where: { id: caseId, userId: user.id } });
  revalidatePath("/dashboard");
  redirect("/dashboard");
}
