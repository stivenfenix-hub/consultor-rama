"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  createSession,
  getCurrentUser,
  homePath,
  loginWithPassword,
  logout,
  requireUser,
  requireAdmin,
} from "@/lib/auth";
import { updateSiteSettings } from "@/lib/settings";
import {
  borrarEnvioPromo,
  contarAvisosNoLeidos,
  listarAvisos,
  marcarAvisoLeido,
  marcarAvisosDeRuta,
  marcarTodosLeidos,
  sendPushToUser,
  sendPushToUsers,
  type AvisoApp,
} from "@/lib/push";
import { sendMail } from "@/lib/mailer";
import {
  CUENTAS_WA,
  encolarPruebaWa,
  encolarWhatsapp,
  estadoWhatsapp,
  gestionarColaWa,
  setComandoWa,
  setMaxDiaWa,
  setPausaWa,
  setWaActuaciones,
  ultimosMensajesWa,
  type CuentaWa,
  type EstadoWa,
  type MensajeWa,
} from "@/lib/whatsapp";
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
  getWhatsappPorUsuario,
  normalizarWhatsapp,
  setWhatsapp,
} from "@/lib/accounts";
import { prisma } from "@/lib/db";
import { esProcesoPrivado, MSG_PRIVADO, revisarProcesoManual, tick } from "@/lib/sync-queue";
import { marcarRegistroNuevo } from "@/lib/meta-registro";
import { MSG_RAMA_ACTUALIZAR } from "@/lib/aviso-rama";
import { avisarNuevoUsuario } from "@/lib/aviso-admin";
import { registrarConsentimientoInicial, setOfertas, usuariosParaAvisos } from "@/lib/consent";
import {
  analizarRadicados,
  MAX_RADICADOS_POR_ENVIO,
  passwordSchema,
  registerSchema,
} from "@/lib/validation";
import { estadoCarga, iniciarCargaProcesos, marcarCargaVista, marcarVistas } from "@/lib/sync";
import {
  ejecutarActualizarTodos,
  marcarActualizacionProceso,
  proximaActualizacionProceso,
  sinLimiteManual,
  cambiarSinLimiteManual,
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
    await marcarRegistroNuevo(nuevo.id); // conversión para el Píxel de Meta
    after(() => avisarNuevoUsuario(nuevo.id, "correo"));
    // Prueba de la autorización (Ley 1581). No se bloquea el registro si falla.
    await registrarConsentimientoInicial(nuevo.id).catch((e) =>
      console.error("[consentimiento]", e),
    );
    // Sin verificación de correo: entra de una vez.
    await createSession(nuevo.id);
  } catch (err) {
    // El único error de cuenta al registrar es el correo ya registrado.
    if (err instanceof AccountError) return { error: err.message, field: "email" };
    return { error: "No se pudo crear la cuenta. Intenta de nuevo." };
  }
  redirect(homePath("user"));
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

  // Los logos ya no se suben aquí: son archivos publicados (lib/marca.ts).
  const data: {
    brandName: string;
    colorAccent: string;
    colorAccent2: string;
    colorBg: string;
    colorPanel: string;
    byUrl?: string;
  } = { ...parsed.data };

  const byUrl = String(formData.get("byUrl") ?? "").trim();
  if (byUrl) {
    if (!/^https?:\/\//i.test(byUrl)) {
      return { error: "El enlace 'By' debe iniciar con http:// o https://" };
    }
    data.byUrl = byUrl;
  }

  await updateSiteSettings(data);
  revalidatePath("/", "layout");
  return { ok: "Apariencia actualizada. Los cambios ya están aplicados." };
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
  // También por el WhatsApp comercial (a quienes tienen WhatsApp registrado).
  let porWhatsapp = "";
  if (formData.get("whatsapp") === "on") {
    const telefonos = await getWhatsappPorUsuario();
    const enlace = parsed.data.url || `${process.env.APP_URL ?? "https://app.estradox.com"}/dashboard`;
    const n = await encolarWhatsapp(
      destinatarios
        .filter((id) => telefonos.has(id))
        .map((id) => ({
          tipo: "promo",
          userId: id,
          telefono: telefonos.get(id)!,
          mensaje: `*${parsed.data.title}*\n\n${parsed.data.body}\n\n👉 ${enlace}`,
        })),
    );
    porWhatsapp = n
      ? ` WhatsApp: ${n} mensaje(s) en cola.`
      : " WhatsApp: no se encoló nada (¿el WhatsApp comercial está vinculado?).";
  }
  return {
    ok: `Enviado a ${destinatarios.length} usuario(s): ${res.sent} dispositivo(s)${res.failed ? ` (${res.failed} fallidos)` : ""}.${porWhatsapp}`,
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
  const { validos, invalidos } = analizarRadicados(String(formData.get("radicado") ?? ""));
  if (validos.length === 0) {
    return {
      error: invalidos.length
        ? `El radicado debe tener 23 dígitos. Revisa: ${invalidos.join(", ")}.`
        : "Ingresa uno o más radicados de 23 dígitos (separados por coma o espacio).",
    };
  }
  if (validos.length > MAX_RADICADOS_POR_ENVIO) {
    return {
      error: `Puedes agregar máximo ${MAX_RADICADOS_POR_ENVIO} procesos por vez y pegaste ${validos.length}. Agrégalos en tandas de ${MAX_RADICADOS_POR_ENVIO}.`,
    };
  }

  // Se carga en segundo plano: el abogado puede seguir usando Estradox y en
  // Procesos ve el avance; al terminar le llega notificación y aviso.
  await iniciarCargaProcesos(user.id, validos, invalidos);
  revalidatePath("/dashboard/procesos");
  return {
    ok: `Estamos cargando ${validos.length} proceso(s) desde la Rama Judicial. Puedes seguir usando Estradox: te avisamos cuando estén listos.`,
  };
}

export async function cerrarCargaAction(id: number) {
  const user = await requireUser();
  await marcarCargaVista(user.id, id);
  revalidatePath("/dashboard/procesos");
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
  if (await proximaActualizacionProceso(caseId, await sinLimiteManual(user))) {
    return { error: "Este proceso ya se actualizó hoy. Podrás hacerlo de nuevo mañana." };
  }
  let resultado: ActionState;
  try {
    await revisarProcesoManual(caseId);
    await marcarActualizacionProceso(caseId); // solo cuenta si funcionó
    resultado = { ok: "Proceso actualizado." };
  } catch (err) {
    // el error queda guardado en caso.lastError; no se gasta el intento del día
    resultado = {
      error: esProcesoPrivado(err)
        ? MSG_PRIVADO
        : MSG_RAMA_ACTUALIZAR,
    };
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
  const error = await reservarActualizarTodos(user.id, await sinLimiteManual(user));
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
  // Se borran todos los registros del radicado (uno por sistema de la Rama):
  // en la lista se ven como un solo proceso.
  const caso = await prisma.case.findFirst({
    where: { id: caseId, userId: user.id },
    select: { radicado: true },
  });
  if (caso) {
    await prisma.case.deleteMany({ where: { userId: user.id, radicado: caso.radicado } });
  }
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

/** Tras crear la cuenta con Google: guarda el WhatsApp (obligatorio) y entra. */
export async function completarRegistroAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const n = normalizarWhatsapp(String(formData.get("whatsapp") ?? ""));
  if (!n) return { error: "Ingresa un número de WhatsApp válido (ej. 300 123 4567)." };
  try {
    await setWhatsapp(user.id, n);
  } catch {
    return { error: "No se pudo guardar el número. Intenta de nuevo." };
  }
  redirect(homePath(user.role));
}

/**
 * Root: elimina un usuario y todo lo suyo (procesos, actuaciones, documentos,
 * pagos, avisos y sesiones de la app caen en cascada). No se puede eliminar a
 * sí mismo ni a otro administrador.
 */
export async function eliminarUsuarioAction(userId: string): Promise<ActionState> {
  const admin = await requireAdmin();
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { error: "El usuario ya no existe." };
  if (user.id === admin.id || user.role === "admin") {
    return { error: "No se puede eliminar una cuenta de administrador." };
  }
  await prisma.user.delete({ where: { id: userId } });
  revalidatePath("/dashboard/admin");
  revalidatePath("/dashboard/admin/usuarios");
  return { ok: `Usuario ${user.email} eliminado.` };
}

/** Root: quita o devuelve el límite de actualizaciones manuales a un usuario. */
export async function sinLimiteManualAction(userId: string, valor: boolean): Promise<ActionState> {
  await requireAdmin();
  await cambiarSinLimiteManual(userId, valor);
  revalidatePath(`/dashboard/admin/usuarios/${userId}`);
  return { ok: valor ? "Sin límite de actualizaciones manuales." : "Con el límite normal." };
}

// ---------- Campana de notificaciones ----------
/**
 * Cuántos avisos sin leer tiene. Con `ruta` (la página que acaba de abrir),
 * primero marca como leídos los avisos que llevan a esa página.
 */
export async function contarAvisosAction(ruta?: string): Promise<number> {
  const user = await getCurrentUser();
  if (!user) return 0;
  if (ruta) await marcarAvisosDeRuta(user.id, ruta).catch(() => {});
  return contarAvisosNoLeidos(user.id, limiteCampana(user.role)).catch(() => 0);
}

// El root recibe muchos avisos (cada registro nuevo): su campana muestra solo los últimos 10.
const limiteCampana = (role: string) => (role === "admin" ? 10 : undefined);

export async function listarAvisosAction(): Promise<AvisoApp[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  return listarAvisos(user.id, limiteCampana(user.role)).catch(() => []);
}

export async function marcarAvisoLeidoAction(id: number) {
  const user = await getCurrentUser();
  if (user) await marcarAvisoLeido(user.id, id).catch(() => {});
}

export async function marcarTodosLeidosAction() {
  const user = await getCurrentUser();
  if (user) await marcarTodosLeidos(user.id).catch(() => {});
}

/** Root: borra una notificación enviada (deja de verse en las campanas). */
export async function borrarEnvioPromoAction(clave: string): Promise<ActionState> {
  await requireAdmin();
  try {
    const n = await borrarEnvioPromo(clave);
    revalidatePath("/dashboard/admin/notificaciones");
    return { ok: `Notificación borrada (${n} aviso(s)).` };
  } catch {
    return { error: "No se pudo borrar." };
  }
}

// ---------- WhatsApp propio (root) ----------
export async function estadoWhatsappAction(): Promise<{ cuentas: EstadoWa[]; mensajes: MensajeWa[] }> {
  await requireAdmin();
  const [cuentas, mensajes] = await Promise.all([estadoWhatsapp(), ultimosMensajesWa()]);
  return { cuentas, mensajes };
}

export async function controlWhatsappAction(
  cuenta: CuentaWa,
  accion: "pausar" | "reanudar" | "desvincular" | "reintentar" | "vaciar",
): Promise<ActionState> {
  await requireAdmin();
  if (!CUENTAS_WA.includes(cuenta)) return { error: "Cuenta inválida." };
  if (accion === "pausar" || accion === "reanudar") await setPausaWa(cuenta, accion === "pausar");
  else if (accion === "desvincular") await setComandoWa(cuenta, "desvincular");
  else await gestionarColaWa(cuenta, accion);
  return { ok: "Listo." };
}

export async function maxDiaWhatsappAction(cuenta: CuentaWa, maxDia: number): Promise<ActionState> {
  await requireAdmin();
  if (!CUENTAS_WA.includes(cuenta)) return { error: "Cuenta inválida." };
  const n = Math.round(Number(maxDia));
  if (!Number.isFinite(n) || n < 1 || n > 1000) return { error: "Escribe un número entre 1 y 1000." };
  await setMaxDiaWa(cuenta, n);
  return { ok: `Máximo por día: ${n}.` };
}

export async function pruebaWhatsappAction(cuenta: CuentaWa, telefono: string): Promise<ActionState> {
  await requireAdmin();
  if (!CUENTAS_WA.includes(cuenta)) return { error: "Cuenta inválida." };
  const n = normalizarWhatsapp(telefono);
  if (!n) return { error: "Escribe un número válido (ej. 300 123 4567)." };
  await encolarPruebaWa(
    cuenta,
    n,
    `Mensaje de prueba de Estradox (${cuenta === "avisos" ? "WhatsApp de avisos" : "WhatsApp comercial"}). Si te llegó, ya está funcionando ✅`,
  );
  return { ok: "Prueba en cola: sale en menos de un minuto si el WhatsApp está conectado (8 a.m. a 8 p.m.)." };
}

/** El abogado activa o desactiva recibir las actuaciones nuevas por WhatsApp. */
export async function waActuacionesAction(valor: boolean): Promise<ActionState> {
  const user = await requireUser();
  await setWaActuaciones(user.id, valor);
  revalidatePath("/dashboard/configuracion");
  return {
    ok: valor
      ? "¡Listo! Te enviaremos las actuaciones nuevas por WhatsApp."
      : "Listo, ya no te enviaremos actuaciones por WhatsApp.",
  };
}

/** Registro marcado como sospechoso: el usuario corrige su nombre desde el aviso. */
export async function corregirNombreAction(
  firstName: string,
  lastName: string,
): Promise<ActionState & { sigue?: boolean }> {
  const user = await requireUser();
  const f = firstName.trim().slice(0, 80);
  const l = lastName.trim().slice(0, 80);
  if (!f || !l) return { error: "Escribe tu nombre y tu apellido." };
  const { motivosSospecha } = await import("@/lib/sospechoso");
  const motivos = motivosSospecha({ firstName: f, lastName: l, email: user.email });
  const nombreMal = motivosSospecha({ firstName: f, lastName: l, email: "valido@ejemplo.com" }).length > 0;
  if (nombreMal) return { error: "Ese nombre no parece real. Escribe tu nombre y apellido completos." };
  await prisma.user.update({
    where: { id: user.id },
    data: { firstName: f, lastName: l, name: `${f} ${l}` },
  });
  revalidatePath("/dashboard", "layout");
  // Si el problema es el correo, cambiar el nombre no basta.
  return motivos.length > 0
    ? { ok: "Nombre actualizado.", sigue: true }
    : { ok: "¡Gracias! Tus datos quedaron actualizados." };
}

/** Push de prueba al propio root, para confirmar que le llegan al celular. */
export async function pruebaPushAction(): Promise<ActionState> {
  const user = await requireAdmin();
  const n = await prisma.pushSubscription.count({ where: { userId: user.id } });
  if (n === 0) {
    return { error: "No tienes ningún dispositivo con notificaciones activas. Ábrelo en tu celular y actívalas en Configuración." };
  }
  const hora = new Date().toLocaleTimeString("es-CO", { timeZone: "America/Bogota", hour: "numeric", minute: "2-digit" });
  const r = await sendPushToUser(user.id, {
    title: "🔔 Prueba de notificación",
    body: `Si ves esto, las notificaciones te están llegando bien (enviada a las ${hora}).`,
    url: "/dashboard/admin/notificaciones",
    tag: `prueba-${Date.now()}`,
  });
  revalidatePath("/dashboard/admin/notificaciones");
  return r.sent > 0
    ? { ok: `Enviada a ${r.sent} dispositivo(s)${r.failed ? ` (${r.failed} con falla)` : ""}. Revisa tu celular en unos segundos.` }
    : { error: "No se pudo entregar a ningún dispositivo. Vuelve a activar las notificaciones en tu celular (Configuración)." };
}

/**
 * Borra de Supabase las copias viejas de los logos e íconos (base64). Ya son
 * archivos publicados en Hostinger (public/marca) y el código no las lee.
 */
export async function limpiarLogosBdAction(): Promise<ActionState> {
  await requireAdmin();
  await prisma.$executeRawUnsafe(
    `UPDATE "SiteSetting" SET "logoDataUrl" = NULL, "emailLogoDataUrl" = NULL, "byLogoDataUrl" = NULL,
       "notifIconDataUrl" = NULL, "notifBadgeDataUrl" = NULL WHERE id = 'site'`,
  );
  await prisma
    .$executeRawUnsafe(`UPDATE "SiteSetting" SET "faviconDataUrl" = NULL WHERE id = 'site'`)
    .catch(() => {}); // la columna puede no existir
  revalidatePath("/dashboard/admin/base-datos");
  return { ok: "Listo: Supabase ya no guarda ningún logo ni ícono." };
}

/** Estado de una carga de procesos (aviso flotante de escritorio). */
export async function estadoCargaAction(id: number) {
  const user = await requireUser();
  return estadoCarga(user.id, id);
}
