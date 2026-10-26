"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
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
import { sendPushToUsers } from "@/lib/push";
import { sendMail } from "@/lib/mailer";
import {
  EMAIL_KINDS,
  renderEmail,
  saveEmailTemplate,
  type EmailKind,
} from "@/lib/auto-emails";
import {
  crearLinkDePago,
  extenderAcceso,
  getPlan,
  getSuscripcion,
  esMesesPaquete,
  savePlan,
  terminarAcceso,
  tieneAcceso,
} from "@/lib/subscription";
import {
  registerUser,
  resendVerification,
  requestPasswordReset,
  resetPassword,
  changePassword,
  AccountError,
  normalizarWhatsapp,
  setWhatsapp,
} from "@/lib/accounts";
import { prisma } from "@/lib/db";
import { revisarProcesoManual, tick } from "@/lib/sync-queue";
import { registrarConsentimientoInicial, setOfertas, usuariosParaAvisos } from "@/lib/consent";
import { parseRadicados, passwordSchema, registerSchema } from "@/lib/validation";
import {
  agregarProcesoPorRadicado,
  marcarVistas,
} from "@/lib/sync";
import {
  ejecutarActualizarTodos,
  marcarActualizacionProceso,
  proximaActualizacionProceso,
  reservarActualizarTodos,
} from "@/lib/limits";

type ActionState = {
  error?: string;
  ok?: string;
  needsVerify?: string;
  /** Campo del formulario con el error (el formulario solo borra ese). */
  field?: string;
};

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
/** Las dos contraseñas del formulario ("password" y "password2") deben coincidir. */
function contrasenasNoCoinciden(formData: FormData) {
  return String(formData.get("password") ?? "") !== String(formData.get("password2") ?? "");
}
const NO_COINCIDEN = "Las contraseñas no coinciden.";

export async function registerAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // Honeypot anti-bot: campo oculto que un humano nunca llena.
  if (String(formData.get("website") ?? "") !== "") {
    return { ok: "Revisa tu correo para verificar tu cuenta." };
  }
  if (contrasenasNoCoinciden(formData)) return { error: NO_COINCIDEN, field: "password2" };
  const parsed = registerSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
    whatsapp: String(formData.get("whatsapp") ?? ""),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      error: issue?.message ?? "Datos inválidos",
      field: issue?.path[0] != null ? String(issue.path[0]) : undefined,
    };
  }
  try {
    const nuevo = await registerUser(parsed.data);
    // Prueba de la autorización (Ley 1581). No se bloquea el registro si falla.
    await registrarConsentimientoInicial(nuevo.id).catch((e) =>
      console.error("[consentimiento]", e),
    );
    return {
      ok: "¡Listo! Te enviamos un correo para verificar tu cuenta. Revisa tu bandeja (y spam).",
    };
  } catch (err) {
    // El único error de cuenta al registrar es el correo ya registrado.
    if (err instanceof AccountError) return { error: err.message, field: "email" };
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
  if (contrasenasNoCoinciden(formData)) return { error: NO_COINCIDEN };
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
  if (contrasenasNoCoinciden(formData)) return { error: NO_COINCIDEN };
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

// ---------- Eliminar cuenta (la pide Google Play: en la app y en la web) ----------
export async function deleteAccountAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  if (user.role === "admin") return { error: "La cuenta administradora no se puede eliminar." };
  const password = String(formData.get("password") ?? "");
  const bcrypt = (await import("bcryptjs")).default;
  const ok = !!user.passwordHash && (await bcrypt.compare(password, user.passwordHash));
  if (!ok) return { error: "La contraseña no es correcta." };
  await prisma.user.delete({ where: { id: user.id } });
  await logout();
  redirect("/login");
}

// ---------- Mi cuenta: WhatsApp ----------
export async function updateWhatsappAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const n = normalizarWhatsapp(String(formData.get("whatsapp") ?? ""));
  if (!n) return { error: "Ingresa un número de WhatsApp válido (ej. 300 123 4567)." };
  try {
    await setWhatsapp(user.id, n);
  } catch {
    return { error: "No se pudo guardar el número." };
  }
  revalidatePath("/dashboard/configuracion");
  return { ok: `WhatsApp guardado: ${n}` };
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

// ---------- Admin: correos automáticos (bienvenida y recordatorio) ----------
const emailTemplateSchema = z.object({
  subject: z.string().trim().min(1, "Escribe el asunto").max(200),
  button: z.string().trim().min(1, "Escribe el texto del botón").max(120),
  body: z.string().trim().min(1, "Escribe el cuerpo del correo").max(10000),
});

export async function saveEmailTemplateAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const k = String(formData.get("kind") ?? "");
  const kind: EmailKind = (EMAIL_KINDS as string[]).includes(k) ? (k as EmailKind) : "welcome";
  const intent = String(formData.get("intent") ?? "save");
  if (intent === "reset") {
    await saveEmailTemplate(kind, null);
    revalidatePath("/dashboard/admin/correos");
    return { ok: "Se restauró el texto original." };
  }
  const parsed = emailTemplateSchema.safeParse({
    subject: formData.get("subject"),
    button: formData.get("button"),
    body: formData.get("body"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }
  await saveEmailTemplate(kind, parsed.data);
  revalidatePath("/dashboard/admin/correos");
  if (intent === "test") {
    const admin = await requireAdmin();
    const nombre = admin.firstName || admin.name || "";
    try {
      await sendMail({ to: admin.email, ...renderEmail(kind, parsed.data, {
          nombre,
          fecha: "15 de noviembre de 2026",
          dias: "3",
          precio: `${(await getPlan()).precio.toLocaleString("es-CO")}`,
        }) });
    } catch {
      return { error: "Se guardó, pero no se pudo enviar la prueba." };
    }
    return { ok: `Guardado y enviado de prueba a ${admin.email}.` };
  }
  return { ok: "Correo guardado." };
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
  // A todos los usuarios, menos quienes desactivaron ofertas en Configuración.
  const destinatarios = await usuariosParaAvisos();
  const res = await sendPushToUsers(destinatarios, {
    title: parsed.data.title,
    body: parsed.data.body,
    url: parsed.data.url || "/dashboard",
    tag: "promo",
  });
  return {
    ok: `Enviado a ${destinatarios.length} usuario(s): ${res.sent} dispositivo(s)${res.failed ? ` (${res.failed} fallidos)` : ""}.`,
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
  const sinAcceso = await bloqueoPorSuscripcion(user.id);
  if (sinAcceso) return sinAcceso;
  const radicados = parseRadicados(String(formData.get("radicado") ?? ""));
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

// Actualización manual de un proceso: una vez por día (el admin sin límite).
export async function refrescarProcesoAction(caseId: string): Promise<ActionState> {
  const user = await requireUser();
  const sinAcceso = await bloqueoPorSuscripcion(user.id);
  if (sinAcceso) return sinAcceso;
  const caso = await prisma.case.findFirst({
    where: { id: caseId, userId: user.id },
  });
  if (!caso) return { error: "Proceso no encontrado." };
  if (await proximaActualizacionProceso(caseId, user.role === "admin")) {
    return { error: "Este proceso ya se actualizó hoy. Podrás hacerlo de nuevo mañana." };
  }
  let resultado: ActionState;
  try {
    await revisarProcesoManual(caseId);
    await marcarActualizacionProceso(caseId); // solo cuenta si funcionó
    resultado = { ok: "Proceso actualizado." };
  } catch {
    // el error queda guardado en caso.lastError; no se gasta el intento del día
    resultado = { error: "La Rama Judicial no respondió. Intenta de nuevo en un rato." };
  }
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/procesos");
  revalidatePath(`/dashboard/procesos/${caseId}`);
  return resultado;
}

// "Actualizar todos": una vez por semana, en segundo plano y por tandas.
export async function actualizarTodosAction(): Promise<ActionState> {
  const user = await requireUser();
  const sinAcceso = await bloqueoPorSuscripcion(user.id);
  if (sinAcceso) return sinAcceso;
  const error = await reservarActualizarTodos(user.id, user.role === "admin");
  if (error) return { error };
  after(() => ejecutarActualizarTodos(user.id));
  revalidatePath("/dashboard");
  return {
    ok: "Actualización iniciada en segundo plano. Puedes seguir usando la plataforma; te avisaremos si hay actuaciones nuevas.",
  };
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

// ---------- Suscripción ----------
/** Mensaje de error si la cuenta no tiene acceso (prueba o plan vencido). */
async function bloqueoPorSuscripcion(userId: string): Promise<ActionState | null> {
  const sub = await getSuscripcion(userId);
  return tieneAcceso(sub)
    ? null
    : { error: "Tu acceso venció. Renueva tu plan en Suscripción para continuar." };
}

/** Crea el link de pago de Bold del paquete elegido y lleva al usuario al checkout. */
export async function pagarSuscripcionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const meses = Number(formData.get("meses") ?? 1);
  if (!esMesesPaquete(meses)) return { error: "Paquete inválido." };
  let url: string;
  try {
    url = await crearLinkDePago({ id: user.id, email: user.email }, meses);
  } catch (e) {
    console.error("[bold] crear link", e);
    return { error: "No pudimos generar el pago en este momento. Intenta de nuevo en unos minutos." };
  }
  redirect(url);
}

const precioSchema = z.coerce
  .number()
  .int("El precio debe ser un número entero")
  .min(1000, "El precio mínimo es $1.000")
  .max(10_000_000);
const planSchema = z.object({
  p1: precioSchema,
  p3: precioSchema,
  p6: precioSchema,
  p12: precioSchema,
  diasPrueba: z.coerce.number().int().min(0).max(365),
});

export async function savePlanAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();
  const parsed = planSchema.safeParse({
    p1: formData.get("p1"),
    p3: formData.get("p3"),
    p6: formData.get("p6"),
    p12: formData.get("p12"),
    diasPrueba: formData.get("diasPrueba"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }
  const { p1, p3, p6, p12, diasPrueba } = parsed.data;
  await savePlan({ 1: p1, 3: p3, 6: p6, 12: p12 }, diasPrueba);
  revalidatePath("/dashboard/admin/suscripciones");
  return { ok: "Plan actualizado." };
}

/** El root termina el acceso de un usuario (queda vencido y solo ve el pago). */
export async function terminarAccesoAction(userId: string) {
  const admin = await requireAdmin();
  if (userId === admin.id) return;
  await terminarAcceso(userId);
  revalidatePath("/dashboard/admin/suscripciones");
}

/** El root regala días de acceso a un usuario. */
export async function regalarDiasAction(userId: string, dias: number) {
  await requireAdmin();
  if (!Number.isInteger(dias) || dias < 1 || dias > 366) return;
  await extenderAcceso(userId, { dias });
  revalidatePath("/dashboard/admin/suscripciones");
}

/** El root lanza una corrida de la cola nocturna ahora (prueba / ponerse al día). */
export async function ejecutarColaAction() {
  await requireAdmin();
  after(async () => {
    try {
      console.log("[cola manual]", JSON.stringify(await tick({ forzar: true })));
    } catch (e) {
      console.error("[cola manual] error", e);
    }
  });
  revalidatePath("/dashboard/admin");
}

/** El usuario activa o retira el permiso de ofertas y boletines. */
export async function updateOfertasAction(valor: boolean): Promise<ActionState> {
  const user = await requireUser();
  await setOfertas(user.id, valor);
  revalidatePath("/dashboard/configuracion");
  return {
    ok: valor
      ? "Listo: volverás a recibir ofertas y novedades de Estradox."
      : "Listo: ya no te enviaremos ofertas ni novedades.",
  };
}
