"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { loginWithPassword, logout, requireUser, requireAdmin } from "@/lib/auth";
import { updateSiteSettings } from "@/lib/settings";
import {
  registerUser,
  resendVerification,
  requestPasswordReset,
  resetPassword,
  changePassword,
  AccountError,
} from "@/lib/accounts";
import { prisma } from "@/lib/db";
import {
  agregarProcesoPorRadicado,
  sincronizarProceso,
  marcarVistas,
} from "@/lib/sync";
import { RamaError } from "@/lib/rama";

type ActionState = { error?: string; ok?: string; needsVerify?: string };

const passwordSchema = z
  .string()
  .min(8, "La contraseña debe tener al menos 8 caracteres")
  .regex(/[A-Za-z]/, "Debe incluir al menos una letra")
  .regex(/[0-9]/, "Debe incluir al menos un número");

// ---------- Login ----------
export async function loginAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Ingresa correo y contraseña." };

  const res = await loginWithPassword(email, password);
  if (res.status === "invalid") return { error: "Correo o contraseña incorrectos." };
  if (res.status === "unverified")
    return {
      error: "Tu correo aún no está verificado. Revisa tu bandeja.",
      needsVerify: res.email,
    };
  redirect("/dashboard");
}

// ---------- Registro ----------
const registerSchema = z.object({
  firstName: z.string().min(1, "Ingresa tu nombre"),
  lastName: z.string().min(1, "Ingresa tu apellido"),
  email: z.string().email("Correo inválido"),
  password: passwordSchema,
});

export async function registerAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // Honeypot anti-bot: campo oculto que un humano nunca llena.
  if (String(formData.get("website") ?? "") !== "") {
    return { ok: "Revisa tu correo para verificar tu cuenta." };
  }
  const parsed = registerSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }
  try {
    await registerUser(parsed.data);
    return {
      ok: "¡Listo! Te enviamos un correo para verificar tu cuenta. Revisa tu bandeja (y spam).",
    };
  } catch (err) {
    if (err instanceof AccountError) return { error: err.message };
    return { error: "No se pudo crear la cuenta. Intenta de nuevo." };
  }
}

export async function resendVerificationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "");
  if (email) await resendVerification(email);
  return { ok: "Si la cuenta existe y no está verificada, te reenviamos el correo." };
}

// ---------- Olvidé mi contraseña ----------
export async function forgotAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "");
  if (email) await requestPasswordReset(email);
  return {
    ok: "Si existe una cuenta con ese correo, te enviamos un enlace para restablecer la contraseña.",
  };
}

// ---------- Restablecer con token ----------
const resetSchema = z.object({
  token: z.string().min(10, "Token inválido"),
  password: passwordSchema,
});

export async function resetAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = resetSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }
  const ok = await resetPassword(parsed.data.token, parsed.data.password);
  if (!ok) return { error: "El enlace es inválido o ya venció. Solicita uno nuevo." };
  return { ok: "Contraseña actualizada. Ya puedes iniciar sesión." };
}

// ---------- Cambio de contraseña (autenticado) ----------
const changeSchema = z.object({
  current: z.string().min(1, "Ingresa tu contraseña actual"),
  password: passwordSchema,
});

export async function changePasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const parsed = changeSchema.safeParse({
    current: formData.get("current"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }
  try {
    await changePassword(user.id, parsed.data.current, parsed.data.password);
    return { ok: "Contraseña actualizada correctamente." };
  } catch (err) {
    if (err instanceof AccountError) return { error: err.message };
    return { error: "No se pudo cambiar la contraseña." };
  }
}

// ---------- Admin: apariencia del sitio ----------
const hex = z.string().regex(/^#([0-9a-fA-F]{6})$/, "Color inválido (usa #RRGGBB)");
const appearanceSchema = z.object({
  brandName: z.string().min(1).max(40),
  colorAccent: hex,
  colorAccent2: hex,
  colorBg: hex,
  colorPanel: hex,
});

export async function updateAppearanceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const parsed = appearanceSchema.safeParse({
    brandName: formData.get("brandName"),
    colorAccent: formData.get("colorAccent"),
    colorAccent2: formData.get("colorAccent2"),
    colorBg: formData.get("colorBg"),
    colorPanel: formData.get("colorPanel"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const data: {
    brandName: string;
    colorAccent: string;
    colorAccent2: string;
    colorBg: string;
    colorPanel: string;
    logoDataUrl?: string;
  } = { ...parsed.data };

  // Logo opcional (archivo -> data URL base64). Máx 500 KB.
  const logo = formData.get("logo");
  if (logo instanceof File && logo.size > 0) {
    if (!logo.type.startsWith("image/")) {
      return { error: "El logo debe ser una imagen (PNG recomendado)." };
    }
    if (logo.size > 500 * 1024) {
      return { error: "El logo es muy pesado (máx 500 KB)." };
    }
    const buf = Buffer.from(await logo.arrayBuffer());
    data.logoDataUrl = `data:${logo.type};base64,${buf.toString("base64")}`;
  }

  await updateSiteSettings(data);
  revalidatePath("/", "layout");
  return { ok: "Apariencia actualizada. Los cambios ya están aplicados." };
}

export async function resetLogoAction() {
  await requireAdmin();
  await updateSiteSettings({ logoDataUrl: null });
  revalidatePath("/", "layout");
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
    revalidatePath("/dashboard/procesos");
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
  revalidatePath("/dashboard/procesos");
  revalidatePath(`/dashboard/procesos/${caseId}`);
}

export async function marcarVistasAction(caseId: string) {
  const user = await requireUser();
  const caso = await prisma.case.findFirst({
    where: { id: caseId, userId: user.id },
  });
  if (!caso) return;
  await marcarVistas(caseId);
  revalidatePath(`/dashboard/procesos/${caseId}`);
  revalidatePath("/dashboard/procesos");
  revalidatePath("/dashboard");
}

export async function eliminarProcesoAction(caseId: string) {
  const user = await requireUser();
  await prisma.case.deleteMany({ where: { id: caseId, userId: user.id } });
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/procesos");
  redirect("/dashboard/procesos");
}
