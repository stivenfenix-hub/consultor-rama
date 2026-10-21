"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  homePath,
  loginWithPassword,
  logout,
  requireUser,
  requireAdmin,
} from "@/lib/auth";
import { setFaviconDataUrl, updateSiteSettings } from "@/lib/settings";
import { sendPushToAll } from "@/lib/push";
import {
  registerUser,
  resendVerification,
  requestPasswordReset,
  resetPassword,
  changePassword,
  AccountError,
  normalizarWhatsapp,
} from "@/lib/accounts";
import { prisma } from "@/lib/db";
import {
  agregarProcesoPorRadicado,
  sincronizarProceso,
  sincronizarProcesosDeUsuario,
  marcarVistas,
} from "@/lib/sync";

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
  redirect(homePath(res.role));
}

// ---------- Registro ----------
const registerSchema = z.object({
  firstName: z.string().min(1, "Ingresa tu nombre"),
  lastName: z.string().min(1, "Ingresa tu apellido"),
  email: z.string().email("Correo inválido"),
  whatsapp: z
    .string()
    .transform((v, ctx) => {
      const n = normalizarWhatsapp(v);
      if (!n) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Ingresa un número de WhatsApp válido (ej. 300 123 4567).",
        });
        return z.NEVER;
      }
      return n;
    }),
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
    whatsapp: String(formData.get("whatsapp") ?? ""),
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
    emailLogoDataUrl?: string;
    byLogoDataUrl?: string;
    byUrl?: string;
    notifIconDataUrl?: string;
    notifBadgeDataUrl?: string;
  } = { ...parsed.data };

  // Convierte un archivo de imagen a data URL (máx 500 KB). Devuelve mensaje de error o null.
  async function fileToDataUrl(
    field: string,
  ): Promise<{ dataUrl?: string; error?: string }> {
    const f = formData.get(field);
    if (!(f instanceof File) || f.size === 0) return {};
    if (!f.type.startsWith("image/"))
      return { error: "El logo debe ser una imagen (PNG recomendado)." };
    if (f.size > 500 * 1024)
      return { error: "El logo es muy pesado (máx 500 KB)." };
    const buf = Buffer.from(await f.arrayBuffer());
    return { dataUrl: `data:${f.type};base64,${buf.toString("base64")}` };
  }

  const plat = await fileToDataUrl("logo");
  if (plat.error) return { error: plat.error };
  if (plat.dataUrl) data.logoDataUrl = plat.dataUrl;

  const mail = await fileToDataUrl("emailLogo");
  if (mail.error) return { error: mail.error };
  if (mail.dataUrl) data.emailLogoDataUrl = mail.dataUrl;

  const by = await fileToDataUrl("byLogo");
  if (by.error) return { error: by.error };
  if (by.dataUrl) data.byLogoDataUrl = by.dataUrl;

  const byUrl = String(formData.get("byUrl") ?? "").trim();
  if (byUrl) {
    if (!/^https?:\/\//i.test(byUrl)) {
      return { error: "El enlace 'By' debe iniciar con http:// o https://" };
    }
    data.byUrl = byUrl;
  }

  const nIcon = await fileToDataUrl("notifIcon");
  if (nIcon.error) return { error: nIcon.error };
  if (nIcon.dataUrl) data.notifIconDataUrl = nIcon.dataUrl;

  const nBadge = await fileToDataUrl("notifBadge");
  if (nBadge.error) return { error: nBadge.error };
  if (nBadge.dataUrl) data.notifBadgeDataUrl = nBadge.dataUrl;

  const fav = await fileToDataUrl("favicon");
  if (fav.error) return { error: fav.error };
  if (fav.dataUrl) await setFaviconDataUrl(fav.dataUrl);

  await updateSiteSettings(data);
  revalidatePath("/", "layout");
  return { ok: "Apariencia actualizada. Los cambios ya están aplicados." };
}

export async function resetLogoAction(
  which:
    | "platform"
    | "email"
    | "by"
    | "notif-icon"
    | "notif-badge"
    | "favicon" = "platform",
) {
  await requireAdmin();
  if (which === "favicon") {
    await setFaviconDataUrl(null);
    revalidatePath("/", "layout");
    return;
  }
  const data =
    which === "email"
      ? { emailLogoDataUrl: null }
      : which === "by"
        ? { byLogoDataUrl: null }
        : which === "notif-icon"
          ? { notifIconDataUrl: null }
          : which === "notif-badge"
            ? { notifBadgeDataUrl: null }
            : { logoDataUrl: null };
  await updateSiteSettings(data);
  revalidatePath("/", "layout");
}

// ---------- Admin: enviar notificación (promo/info) a todos ----------
const promoSchema = z.object({
  title: z.string().min(1, "Escribe un título").max(80),
  body: z.string().min(1, "Escribe el mensaje").max(300),
  url: z.string().url("Enlace inválido").or(z.literal("")).optional(),
});

export async function enviarPromoAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const parsed = promoSchema.safeParse({
    title: formData.get("title"),
    body: formData.get("body"),
    url: formData.get("url") || "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }
  const res = await sendPushToAll({
    title: parsed.data.title,
    body: parsed.data.body,
    url: parsed.data.url || "/dashboard",
    tag: "promo",
  });
  return {
    ok: `Enviado a ${res.sent} dispositivo(s)${res.failed ? ` (${res.failed} fallidos)` : ""}.`,
  };
}

export async function logoutAction() {
  await logout();
  redirect("/login");
}

export async function agregarProcesoAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const input = String(formData.get("radicado") ?? "");
  // Acepta varios radicados separados por coma, espacio, punto y coma o salto.
  const radicados = [
    ...new Set(
      input
        .split(/[\s,;]+/)
        .map((s) => s.replace(/\D/g, ""))
        .filter((s) => s.length === 23),
    ),
  ];
  if (radicados.length === 0) {
    return {
      error:
        "Ingresa uno o más radicados de 23 dígitos (separados por coma o espacio).",
    };
  }

  let agregados = 0;
  let fallidos = 0;
  for (const rad of radicados) {
    try {
      await agregarProcesoPorRadicado(user.id, rad);
      agregados++;
    } catch {
      fallidos++;
    }
  }
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/procesos");

  if (agregados === 0) {
    return {
      error:
        "No se pudo agregar ningún proceso (la Rama puede estar lenta o los radicados no existen).",
    };
  }
  return {
    ok: `${agregados} proceso(s) agregado(s)${fallidos ? `, ${fallidos} con error` : ""}.`,
  };
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

export async function actualizarTodosAction() {
  const user = await requireUser();
  await sincronizarProcesosDeUsuario(user.id);
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/procesos");
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
