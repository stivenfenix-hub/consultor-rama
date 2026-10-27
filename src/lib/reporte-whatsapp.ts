import "server-only";
import ExcelJS from "exceljs";
import { prisma } from "./db";
import { ensureColumn } from "./runtime-columns";
import { sendMail } from "./mailer";

/**
 * Reporte diario para enviar los avisos por WhatsApp desde una plataforma de
 * envío masivo (sin la API de WhatsApp). Cuando sale el resumen de las 7 a.m.
 * a un abogado, se guarda aquí el mismo aviso en texto; a las 7:30 a.m. se
 * manda al root un Excel sin encabezado:
 *   A: "Nombre - aviso"   B: teléfono (573001234567)
 * Solo van los abogados que tuvieron actuaciones nuevas.
 */

const APP_URL = process.env.APP_URL ?? "https://app.estradox.com";

let listo: Promise<void> | null = null;
function asegurarTabla() {
  listo ??= (async () => {
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "ReporteWhatsapp" (
        id SERIAL PRIMARY KEY,
        fecha TEXT NOT NULL,
        "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
        mensaje TEXT NOT NULL,
        telefono TEXT NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "ReporteWhatsapp_fecha_idx" ON "ReporteWhatsapp" (fecha)`,
    );
    await ensureColumn("SiteSetting", "reporteWaFecha", "TEXT");
  })().catch((e) => {
    listo = null;
    throw e;
  });
  return listo;
}

/** Fecha de hoy en Bogotá (AAAA-MM-DD). */
export function hoyBogota(d = new Date()) {
  return d.toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}

function primerNombre(firstName: string | null, name: string | null) {
  const n = (firstName || name || "").trim().split(/\s+/)[0];
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : "Doctor(a)";
}

function fechaCorta(d: Date | string | null | undefined) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("es-CO", { timeZone: "America/Bogota" });
}

type CasoAviso = {
  radicado: string;
  nuevas: { actuacion?: string; anotacion?: string; fechaActuacion?: string }[];
};

/** El mismo contenido del correo-resumen, en texto para WhatsApp. */
export function textoAviso(nombre: string, casos: CasoAviso[]) {
  const total = casos.reduce((n, c) => n + c.nuevas.length, 0);
  const bloques = casos.map((c) => {
    const items = c.nuevas.slice(0, 10).map((a) => {
      const fecha = fechaCorta(a.fechaActuacion);
      const nota = a.anotacion
        ? `: ${a.anotacion.replace(/\s+/g, " ").trim().slice(0, 160)}${a.anotacion.length > 160 ? "…" : ""}`
        : "";
      return `• ${fecha ? `${fecha} ` : ""}${a.actuacion ?? "Actuación"}${nota}`;
    });
    if (c.nuevas.length > 10) items.push(`• …y ${c.nuevas.length - 10} más`);
    return `Proceso ${c.radicado}\n${items.join("\n")}`;
  });
  return (
    `${nombre} - Tienes ${total} actuación(es) nueva(s) en ${casos.length} de tus procesos:\n\n` +
    `${bloques.join("\n\n")}\n\nVer en Estradox: ${APP_URL}/dashboard`
  );
}

/** Guarda el aviso del abogado para el reporte de hoy (sin teléfono, no va). */
export async function registrarAvisoWhatsapp(userId: string, casos: CasoAviso[]) {
  try {
    await asegurarTabla();
    const [u] = await prisma.$queryRawUnsafe<
      { firstName: string | null; name: string | null; whatsapp: string | null }[]
    >(`SELECT "firstName", name, "whatsapp" FROM "User" WHERE id = $1`, userId);
    const telefono = (u?.whatsapp ?? "").replace(/\D/g, "");
    if (!u || !telefono) return;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ReporteWhatsapp" (fecha, "userId", mensaje, telefono) VALUES ($1, $2, $3, $4)`,
      hoyBogota(),
      userId,
      textoAviso(primerNombre(u.firstName, u.name), casos),
      telefono,
    );
  } catch (e) {
    console.error("[reporte-wa] registrar", e);
  }
}

/** Arma el Excel (sin encabezado): A = mensaje, B = teléfono. */
export async function excelReporte(filas: { mensaje: string; telefono: string }[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Avisos");
  ws.getColumn(1).width = 90;
  ws.getColumn(2).width = 16;
  for (const f of filas) {
    const row = ws.addRow([f.mensaje, f.telefono]);
    row.getCell(1).alignment = { wrapText: true, vertical: "top" };
    row.getCell(2).numFmt = "@"; // texto: que Excel no lo vuelva notación científica
    row.getCell(2).alignment = { vertical: "top" };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * Envía al root el reporte de hoy, una sola vez al día. `forzar` lo reenvía
 * (prueba desde el panel).
 */
export async function enviarReporteWhatsapp(opts: { forzar?: boolean } = {}) {
  await asegurarTabla();
  const hoy = hoyBogota();
  const [s] = await prisma.$queryRawUnsafe<{ f: string | null }[]>(
    `SELECT "reporteWaFecha" AS f FROM "SiteSetting" WHERE id = 'site'`,
  );
  if (!opts.forzar && s?.f === hoy) return { omitido: "ya enviado hoy" };

  const filas = await prisma.$queryRawUnsafe<{ mensaje: string; telefono: string }[]>(
    `SELECT mensaje, telefono FROM "ReporteWhatsapp" WHERE fecha = $1 ORDER BY "createdAt"`,
    hoy,
  );
  const marcar = () =>
    prisma.$executeRawUnsafe(`UPDATE "SiteSetting" SET "reporteWaFecha" = $1 WHERE id = 'site'`, hoy);
  if (filas.length === 0) {
    await marcar();
    return { enviados: 0 };
  }

  const admins = await prisma.user.findMany({ where: { role: "admin" }, select: { email: true } });
  const excel = await excelReporte(filas);
  for (const a of admins) {
    await sendMail({
      to: a.email,
      subject: `Reporte WhatsApp ${hoy}: ${filas.length} aviso(s)`,
      text: `Adjunto el Excel con ${filas.length} aviso(s) de actuaciones nuevas para enviar por WhatsApp.`,
      html: `<div style="font-family:system-ui,sans-serif"><p>Adjunto el Excel con <b>${filas.length}</b> aviso(s) de actuaciones nuevas de hoy para enviar por WhatsApp.</p><p style="color:#777;font-size:13px">Columna A: nombre y aviso. Columna B: teléfono.</p></div>`,
      attachments: [
        {
          filename: `avisos-whatsapp-${hoy}.xlsx`,
          content: excel,
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      ],
    });
  }
  await marcar();
  return { enviados: filas.length };
}
