import "server-only";
import { prisma } from "./db";
import { ensureColumn } from "./runtime-columns";
import { sendMail } from "./mailer";

// Correo de bienvenida que se envía cuando el abogado activa su cuenta.
// El root lo edita en Panel admin → Correo de bienvenida. Formato del cuerpo:
//  - {nombre} se reemplaza por el nombre del abogado.
//  - Una línea que solo diga [boton] se convierte en el botón grande.
//  - **texto** se muestra en negrilla. Una línea en blanco separa párrafos.

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

export type WelcomeTemplate = { subject: string; button: string; body: string };

export const WELCOME_DEFAULT: WelcomeTemplate = {
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

Atentamente,
El equipo de Estradox by UNOR Group
www.estradox.com`,
};

async function ensureColumns() {
  await ensureColumn("SiteSetting", "welcomeSubject", "TEXT");
  await ensureColumn("SiteSetting", "welcomeButton", "TEXT");
  await ensureColumn("SiteSetting", "welcomeBody", "TEXT");
}

/** Plantilla guardada por el root (o la de por defecto en lo que falte). */
export async function getWelcomeTemplate(): Promise<WelcomeTemplate> {
  try {
    await ensureColumns();
    const rows = await prisma.$queryRawUnsafe<
      { s: string | null; b: string | null; t: string | null }[]
    >(
      `SELECT "welcomeSubject" AS s, "welcomeButton" AS b, "welcomeBody" AS t
       FROM "SiteSetting" WHERE id = 'site'`,
    );
    const r = rows[0];
    return {
      subject: r?.s || WELCOME_DEFAULT.subject,
      button: r?.b || WELCOME_DEFAULT.button,
      body: r?.t || WELCOME_DEFAULT.body,
    };
  } catch {
    return WELCOME_DEFAULT;
  }
}

/** Guarda la plantilla; null restaura el texto original. */
export async function saveWelcomeTemplate(t: WelcomeTemplate | null) {
  await ensureColumns();
  await prisma.siteSetting.upsert({
    where: { id: "site" },
    create: { id: "site" },
    update: {},
  });
  await prisma.$executeRawUnsafe(
    `UPDATE "SiteSetting"
     SET "welcomeSubject" = $1, "welcomeButton" = $2, "welcomeBody" = $3
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

export function renderWelcome(t: WelcomeTemplate, nombre: string) {
  const link = `${APP_URL}/dashboard/procesos`;
  const body = t.body.replace(/\{nombre\}/g, nombre);

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
    subject: t.subject,
    text,
    html: `
      <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:580px;margin:0 auto;color:#1d1b2e;font-size:15px">
        <img src="${APP_URL}/api/logo/email" alt="Estradox" height="28" style="margin-bottom:18px" />
        ${html}
      </div>`,
  };
}

/** Envía la bienvenida a un usuario (no lanza error: solo lo registra). */
export async function enviarBienvenida(userId: string) {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;
    const nombre = user.firstName || user.name || "";
    const msg = renderWelcome(await getWelcomeTemplate(), nombre);
    await sendMail({ to: user.email, ...msg });
  } catch (e) {
    console.error("[bienvenida] no se pudo enviar", e);
  }
}
