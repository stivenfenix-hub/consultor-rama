import "server-only";
import { prisma } from "./db";
import { ensureColumn } from "./runtime-columns";
import { sendMail } from "./mailer";

// Correos automáticos que el root edita en Panel admin → Correos automáticos:
//  - "welcome": bienvenida, al activar la cuenta (confirmar el correo).
//  - "reminder": recordatorio, 24 h después de activar si aún no tiene procesos.
//  - "subEnding": la prueba o el mes pagado vence en ≤ 3 días.
//  - "subExpired": la prueba o el mes pagado ya venció.
// Formato del cuerpo:
//  - {nombre} se reemplaza por el nombre del abogado; {fecha} por la fecha de
//    vencimiento, {dias} por los días que faltan y {precio} por el valor del plan.
//  - Una línea que solo diga [boton] se convierte en el botón grande.
//  - **texto** se muestra en negrilla. Una línea en blanco separa párrafos.

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

export type EmailKind = "welcome" | "reminder" | "subEnding" | "subExpired";
export const EMAIL_KINDS: EmailKind[] = ["welcome", "reminder", "subEnding", "subExpired"];

// A dónde lleva el botón de cada correo.
const BOTON_DESTINO: Record<EmailKind, string> = {
  welcome: "/dashboard/procesos",
  reminder: "/dashboard/procesos",
  subEnding: "/dashboard/suscripcion",
  subExpired: "/dashboard/suscripcion",
};

export type EmailVars = { nombre: string; fecha?: string; dias?: string; precio?: string };
export type EmailTemplate = { subject: string; button: string; body: string };

const FIRMA = `Atentamente,
El equipo de Estradox by UNOR Group
www.estradox.com`;

export const EMAIL_DEFAULTS: Record<EmailKind, EmailTemplate> = {
  welcome: {
    subject: "¡Bienvenido a Estradox! Tu mes gratis está activo ⚖️",
    button: "👉 Cargar mi primer radicado de 23 dígitos",
    body: `Hola, {nombre}:

A partir de hoy, tus mañanas como litigante van a cambiar. Bienvenido a Estradox.

Se acabaron las horas perdidas frente a un Excel y los errores de carga en la página de la Consulta Nacional Unificada. Nuestro sistema ya está listo para vigilar tus procesos, pero necesitamos que des el primer paso.

Para que mañana a las 7:00 a.m. recibas tu primer reporte automatizado, haz clic en el siguiente enlace y registra tu primer caso:

[boton]

**¿Qué pasa después?**

1. **Pega tus radicados:** Sube tus procesos activos en la plataforma.
2. **Relájate:** Nuestro servidor revisará la Rama Judicial por ti todos los días a primera hora.
3. **Recibe alertas:** Si un juzgado sube una actuación, te enviaremos una notificación push a tu celular y un resumen a este correo.

**Sobre tu suscripción:** Disfruta de 30 días de acceso total, 100% gratis. A partir del día 31, tu plan tendrá un valor de solo $24.900 COP mensuales (IVA y comisiones incluidas). No te preocupes, te avisaremos días antes de que termine tu prueba para que decidas si deseas continuar.

Si tienes alguna duda técnica o necesitas ayuda subiendo tus procesos, simplemente responde a este correo y nuestro equipo de soporte te ayudará de inmediato.

Muchos éxitos en tus audiencias de esta semana.

${FIRMA}`,
  },
  reminder: {
    subject: "⏳ Tu cuenta está lista, solo falta un pequeño paso...",
    button: "👉 Subir mi primer radicado ahora",
    body: `Hola, {nombre}:

Notamos que activaste tu cuenta en Estradox, pero aún no has cargado tu primer radicado judicial.

Sabemos perfectamente que el día a día de un litigante está lleno de audiencias, memoriales y clientes urgentes. Sin embargo, registrar tu primer proceso te tomará menos de 1 minuto y te ahorrará horas de revisión manual de aquí en adelante.

Para que nuestro servidor empiece a vigilar tus casos desde mañana a las 7:00 a.m., solo necesitas hacer clic aquí y pegar los 23 dígitos:

[boton]

**¿Tuviste algún problema técnico o no sabes por dónde empezar?** No te preocupes. Si la plataforma te generó un error o necesitas ayuda para cargar un listado grande de radicados, simplemente responde a este correo. Nuestro equipo de soporte técnico está listo para ayudarte a configurarlo paso a paso.

No dejes que el tiempo corra sin aprovechar tu mes de prueba gratis. ¡Automatiza tus procesos hoy mismo!

${FIRMA}`,
  },
  subEnding: {
    subject: "⏰ Tu acceso a Estradox vence en {dias} día(s)",
    button: "👉 Renovar mi plan",
    body: `Hola, {nombre}:

Te escribimos para avisarte que tu acceso a Estradox vence el **{fecha}**.

Para que sigamos vigilando tus procesos todos los días y no te pierdas ninguna actuación, renueva tu plan mensual por solo **{precio} COP** (IVA y comisiones incluidas). Puedes pagar con tarjeta, PSE, Nequi o Botón Bancolombia.

[boton]

Si decides no continuar, no tienes que hacer nada: tu cuenta simplemente quedará en pausa y podrás reactivarla cuando quieras.

${FIRMA}`,
  },
  subExpired: {
    subject: "Tu acceso a Estradox venció: reactívalo hoy",
    button: "👉 Reactivar mi plan",
    body: `Hola, {nombre}:

Tu acceso a Estradox venció el **{fecha}**, así que dejamos de revisar tus procesos en la Rama Judicial y no recibirás alertas de actuaciones nuevas.

Tus procesos siguen guardados. Reactiva tu plan mensual por **{precio} COP** y retomamos la vigilancia de inmediato:

[boton]

Si tienes alguna duda, responde a este correo y te ayudamos.

${FIRMA}`,
  },
};

// Columnas de cada plantilla en SiteSetting (creadas en tiempo de ejecución).
const COLS: Record<EmailKind, { s: string; b: string; t: string }> = {
  welcome: { s: "welcomeSubject", b: "welcomeButton", t: "welcomeBody" },
  reminder: { s: "reminderSubject", b: "reminderButton", t: "reminderBody" },
  subEnding: { s: "subEndingSubject", b: "subEndingButton", t: "subEndingBody" },
  subExpired: { s: "subExpiredSubject", b: "subExpiredButton", t: "subExpiredBody" },
};

async function ensureTemplateColumns(kind: EmailKind) {
  const c = COLS[kind];
  for (const col of [c.s, c.b, c.t]) await ensureColumn("SiteSetting", col, "TEXT");
}

/** Plantilla guardada por el root (o la de por defecto en lo que falte). */
export async function getEmailTemplate(kind: EmailKind): Promise<EmailTemplate> {
  const def = EMAIL_DEFAULTS[kind];
  try {
    await ensureTemplateColumns(kind);
    const c = COLS[kind];
    const rows = await prisma.$queryRawUnsafe<
      { s: string | null; b: string | null; t: string | null }[]
    >(
      `SELECT "${c.s}" AS s, "${c.b}" AS b, "${c.t}" AS t
       FROM "SiteSetting" WHERE id = 'site'`,
    );
    const r = rows[0];
    return {
      subject: r?.s || def.subject,
      button: r?.b || def.button,
      body: r?.t || def.body,
    };
  } catch {
    return def;
  }
}

/** Guarda la plantilla; null restaura el texto original. */
export async function saveEmailTemplate(kind: EmailKind, t: EmailTemplate | null) {
  await ensureTemplateColumns(kind);
  await prisma.siteSetting.upsert({
    where: { id: "site" },
    create: { id: "site" },
    update: {},
  });
  const c = COLS[kind];
  await prisma.$executeRawUnsafe(
    `UPDATE "SiteSetting" SET "${c.s}" = $1, "${c.b}" = $2, "${c.t}" = $3
     WHERE id = 'site'`,
    t?.subject ?? null,
    t?.button ?? null,
    t?.body ?? null,
  );
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Negrillas (**x**) y enlaces (www... / https://...) dentro de una línea ya escapada. */
function inline(s: string) {
  return s
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(
      /\b((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:])/g,
      (u) =>
        `<a href="${u.startsWith("http") ? u : `https://${u}`}" style="color:#6a2bf5">${u}</a>`,
    );
}

const BTN =
  "display:inline-block;background:linear-gradient(135deg,#8b3dff,#4b23e6);color:#fff;padding:16px 26px;border-radius:10px;text-decoration:none;font-weight:700;font-size:16px";

function reemplazar(s: string, v: EmailVars) {
  return s
    .replace(/\{nombre\}/g, v.nombre)
    .replace(/\{fecha\}/g, v.fecha ?? "")
    .replace(/\{dias\}/g, v.dias ?? "")
    .replace(/\{precio\}/g, v.precio ?? "");
}

export function renderEmail(kind: EmailKind, t: EmailTemplate, vars: EmailVars) {
  const link = `${APP_URL}${BOTON_DESTINO[kind]}`;
  const body = reemplazar(t.body, vars);

  const bloques = body.replace(/\r\n/g, "\n").split(/\n\s*\n/);
  const html = bloques
    .map((b) => {
      const txt = b.trim();
      if (!txt) return "";
      if (txt === "[boton]") {
        return `<p style="text-align:center;margin:26px 0"><a href="${link}" style="${BTN}">${escapeHtml(t.button)}</a></p>`;
      }
      const lineas = txt.split("\n").map((l) => inline(escapeHtml(l)));
      return `<p style="margin:0 0 14px;line-height:1.55">${lineas.join("<br/>")}</p>`;
    })
    .join("\n");

  const text = body
    .replace(/^\[boton\]$/m, `${t.button}: ${link}`)
    .replace(/\*\*(.+?)\*\*/g, "$1");

  return {
    subject: reemplazar(t.subject, vars),
    text,
    html: `
      <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:580px;margin:0 auto;color:#1d1b2e;font-size:15px">
        <img src="${APP_URL}/api/logo/email" alt="Estradox" height="28" style="margin-bottom:18px" />
        ${html}
      </div>`,
  };
}

export async function enviarPlantilla(
  kind: EmailKind,
  userId: string,
  vars: Omit<EmailVars, "nombre"> = {},
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;
  const nombre = user.firstName || user.name || "";
  await sendMail({
    to: user.email,
    ...renderEmail(kind, await getEmailTemplate(kind), { nombre, ...vars }),
  });
}

/** Envía la bienvenida a un usuario (no lanza error: solo lo registra). */
export async function enviarBienvenida(userId: string) {
  try {
    await enviarPlantilla("welcome", userId);
  } catch (e) {
    console.error("[bienvenida] no se pudo enviar", e);
  }
}

// Solo cuentas activadas desde que existe el recordatorio: los usuarios
// anteriores sin procesos no lo reciben.
const RECORDATORIO_DESDE = new Date("2026-10-22T19:30:00Z");

/**
 * Recordatorio a quienes activaron la cuenta hace 24 h o más y aún no tienen
 * ningún proceso. Se envía una sola vez por usuario. Devuelve cuántos envió.
 */
export async function enviarRecordatoriosPendientes(): Promise<number> {
  await ensureColumn("User", "reminderSentAt", "TIMESTAMPTZ");
  const pendientes = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT u.id FROM "User" u
     WHERE u."emailVerified" IS NOT NULL
       AND u."emailVerified" >= $1
       AND u."emailVerified" <= now() - interval '24 hours'
       AND u."reminderSentAt" IS NULL
       AND u.role <> 'admin'
       AND NOT EXISTS (SELECT 1 FROM "Case" c WHERE c."userId" = u.id)
     LIMIT 50`,
    RECORDATORIO_DESDE,
  );
  let enviados = 0;
  for (const { id } of pendientes) {
    // Se marca antes de enviar: si el correo falla no se reintenta en bucle.
    const marcado = await prisma.$executeRawUnsafe(
      `UPDATE "User" SET "reminderSentAt" = now() WHERE id = $1 AND "reminderSentAt" IS NULL`,
      id,
    );
    if (marcado !== 1) continue;
    try {
      await enviarPlantilla("reminder", id);
      enviados++;
    } catch (e) {
      console.error("[recordatorio] no se pudo enviar", id, e);
    }
  }
  return enviados;
}

/** Avisos de "tu acceso vence pronto" y "tu acceso venció" (una vez por fecha). */
export async function enviarAvisosDeSuscripcion(): Promise<number> {
  const { avisosDeVencimientoPendientes, marcarAviso, getPlan } = await import("./subscription");
  const { porVencer, vencidos } = await avisosDeVencimientoPendientes();
  const { precio } = await getPlan();
  const precioTxt = `$${precio.toLocaleString("es-CO")}`;
  const fechaTxt = (d: Date) =>
    d.toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Bogota" });
  let enviados = 0;
  for (const [lista, kind, tipo] of [
    [porVencer, "subEnding", "porVencer"],
    [vencidos, "subExpired", "vencida"],
  ] as const) {
    for (const { id, hasta } of lista) {
      // Se marca antes de enviar: si el correo falla no se reintenta en bucle.
      await marcarAviso(id, tipo, hasta);
      const dias = Math.max(1, Math.ceil((hasta.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
      try {
        await enviarPlantilla(kind, id, { fecha: fechaTxt(hasta), dias: String(dias), precio: precioTxt });
        enviados++;
      } catch (e) {
        console.error(`[${kind}] no se pudo enviar`, id, e);
      }
    }
  }
  return enviados;
}
