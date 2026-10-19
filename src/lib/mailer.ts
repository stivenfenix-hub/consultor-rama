import "server-only";
import nodemailer from "nodemailer";

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
    text: opts.text,
    html: opts.html,
  });
  return { skipped: false };
}
