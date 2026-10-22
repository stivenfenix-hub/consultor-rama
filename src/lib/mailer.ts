import "server-only";
import nodemailer from "nodemailer";
import { getSiteSettings } from "./settings";

/**
 * Envio de correos por SMTP. Configurable con variables de entorno:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *
 * Si no hay SMTP_HOST configurado, no falla: solo registra el correo en consola
 * (util en desarrollo).
 */

const HOST = process.env.SMTP_HOST;
const PORT = Number(process.env.SMTP_PORT ?? 587);
const USER = process.env.SMTP_USER;
const PASS = process.env.SMTP_PASS;
const FROM = process.env.SMTP_FROM ?? "Consultor de Procesos <no-reply@localhost>";

let transporter: nodemailer.Transporter | null = null;
function getTransporter() {
  if (!HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: HOST,
      port: PORT,
      secure: PORT === 465, // true para 465, STARTTLS para el resto
      auth: USER && PASS ? { user: USER, pass: PASS } : undefined,
    });
  }
  return transporter;
}

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

/** Pie común de todos los correos: "By" + logo de UNOR (el logo "By" del sitio). */
async function pieBy() {
  const s = await getSiteSettings();
  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:580px;margin:28px auto 0;padding-top:16px;border-top:1px solid #e6e4ef;text-align:center">
      <a href="${s.byUrl}" style="text-decoration:none;color:#8a879c;font-size:12px">
        <span style="vertical-align:middle">By</span>
        <img src="${APP_URL}/api/logo/by" alt="UNOR" height="18" style="vertical-align:middle;margin-left:6px;border:0" />
      </a>
    </div>`;
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}) {
  const t = getTransporter();
  if (!t) {
    console.log(
      `[mail] (SMTP no configurado) Para: ${opts.to} | Asunto: ${opts.subject}`,
    );
    return { skipped: true };
  }
  await t.sendMail({
    from: FROM,
    to: opts.to,
    subject: opts.subject,
    text: opts.text ? `${opts.text}\n\nBy UNOR Group` : undefined,
    html: opts.html + (await pieBy()),
  });
  return { skipped: false };
}
