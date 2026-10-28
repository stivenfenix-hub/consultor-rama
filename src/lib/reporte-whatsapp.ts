import "server-only";
import ExcelJS from "exceljs";
import { prisma } from "./db";
import { ensureColumn } from "./runtime-columns";
import { sendMail } from "./mailer";

/**
 * Reporte diario para enviar los avisos por WhatsApp desde una plataforma de
 * envío masivo (sin la API de WhatsApp). Cada aviso que Estradox da por correo
 * o por la app (actuaciones nuevas, recordatorio de cargar procesos, acceso por
 * vencer o vencido; la bienvenida no) se guarda también aquí en texto. A las
 * 7:30 a.m. se manda al root un Excel sin encabezado con lo acumulado desde el
 * reporte anterior, una fila por aviso (cada uno es un mensaje aparte):
 *   A: "Nombre - aviso"   B: teléfono (573001234567)
 */

const APP_URL = process.env.APP_URL ?? "https://app.estradox.com";

export type TipoAviso = "actuaciones" | "sinProcesos" | "porVencer" | "vencido";
// Orden de los avisos dentro del mensaje de cada abogado.
const ORDEN: TipoAviso[] = ["actuaciones", "porVencer", "vencido", "sinProcesos"];

let listo: Promise<void> | null = null;
function asegurarTabla() {
  listo ??= (async () => {
    // Primera versión (solo actuaciones); nunca llegó a tener filas.
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "ReporteWhatsapp"`);
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "AvisoWhatsapp" (
        id SERIAL PRIMARY KEY,
        "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
        tipo TEXT NOT NULL,
        mensaje TEXT NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "reportadoAt" TIMESTAMPTZ
      )`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "AvisoWhatsapp_pendiente_idx" ON "AvisoWhatsapp" ("createdAt") WHERE "reportadoAt" IS NULL`,
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

/** Primer apellido con mayúscula inicial ("VIDAL HARDING" -> "Vidal"), para "Dr(a). Vidal". */
function primerApellido(lastName: string | null, name: string | null) {
  const a =
    (lastName ?? "").trim().split(/\s+/)[0] ||
    (name ?? "").trim().split(/\s+/).slice(1)[0] ||
    "";
  return a ? a.charAt(0).toUpperCase() + a.slice(1).toLowerCase() : "";
}

function fechaCorta(d: Date | string | null | undefined) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("es-CO", { timeZone: "America/Bogota" });
}

type CasoAviso = {
  radicado: string;
  nuevas: { actuacion?: string; anotacion?: string; fechaActuacion?: string }[];
};

/** El mismo contenido del correo-resumen de actuaciones, en texto para WhatsApp. */
export function textoActuaciones(casos: CasoAviso[]) {
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
    `Tienes ${total} actuación(es) nueva(s) en ${casos.length} de tus procesos:\n\n` +
    `${bloques.join("\n\n")}\n\nVer en Estradox: ${APP_URL}/dashboard`
  );
}

/** Textos cortos de los correos automáticos (recordatorio y suscripción). */
export function textoAutomatico(
  tipo: Exclude<TipoAviso, "actuaciones">,
  v: { fecha?: string; dias?: string; precio?: string; apellido?: string } = {},
) {
  switch (tipo) {
    case "sinProcesos":
      return `¡Hola Dr(a).${v.apellido ? ` ${v.apellido}` : ""}! Qué gusto saludarle, soy Manuela de Estradox ⚖️.

¡Bienvenido a nuestra plataforma! Notamos que su cuenta ya está activa pero aún no tiene radicados en vigilancia.

Para que no pierda su prueba gratuita y el sistema empiece a trabajar por usted esta misma madrugada, le dejo el enlace directo para agregar su primer proceso:
👉 ${APP_URL}/dashboard/procesos

Solo pegue los 23 dígitos y nosotros nos encargamos del resto. Si tiene alguna duda o prefiere que yo lo suba por usted, ¡escríbame por aquí! 🤝`;
    case "porVencer":
      return `Tu acceso a Estradox vence el ${v.fecha} (en ${v.dias} día(s)). Renueva tu plan por ${v.precio} COP para seguir recibiendo las actuaciones de tus procesos: ${APP_URL}/dashboard/suscripcion`;
    case "vencido":
      return `Tu acceso a Estradox venció el ${v.fecha} y dejamos de revisar tus procesos. Siguen guardados: reactiva tu plan por ${v.precio} COP y retomamos la vigilancia de inmediato: ${APP_URL}/dashboard/suscripcion`;
  }
}

/** Guarda un aviso para el próximo reporte. Nunca rompe el envío original. */
export async function registrarAvisoWhatsapp(userId: string, tipo: TipoAviso, mensaje: string) {
  try {
    await asegurarTabla();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "AvisoWhatsapp" ("userId", tipo, mensaje) VALUES ($1, $2, $3)`,
      userId,
      tipo,
      mensaje,
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
 * Una fila por aviso ("Nombre - aviso"): cada uno se envía como mensaje aparte.
 * Las filas de un mismo abogado quedan juntas (actuaciones primero).
 */
export function agruparPorAbogado(
  avisos: { userId: string; tipo: string; mensaje: string; firstName: string | null; name: string | null; whatsapp: string | null }[],
) {
  const porUsuario = new Map<string, typeof avisos>();
  for (const a of avisos) porUsuario.set(a.userId, [...(porUsuario.get(a.userId) ?? []), a]);
  const filas: { mensaje: string; telefono: string }[] = [];
  for (const lista of porUsuario.values()) {
    const telefono = (lista[0].whatsapp ?? "").replace(/\D/g, "");
    if (!telefono) continue; // sin WhatsApp no se le puede enviar
    const orden = (t: string) => ORDEN.indexOf(t as TipoAviso);
    const nombre = primerNombre(lista[0].firstName, lista[0].name);
    // El mismo texto repetido no se manda dos veces.
    const vistos = new Set<string>();
    for (const a of [...lista].sort((x, y) => orden(x.tipo) - orden(y.tipo))) {
      if (vistos.has(a.mensaje)) continue;
      vistos.add(a.mensaje);
      // El de "sin procesos" ya saluda por el apellido: va sin "Nombre - ".
      filas.push({ mensaje: a.tipo === "sinProcesos" ? a.mensaje : `${nombre} - ${a.mensaje}`, telefono });
    }
  }
  return filas;
}

/**
 * Quien lleva 24 h o más registrado y no ha cargado ningún proceso va una vez
 * al reporte (aunque el correo de recordatorio ya le haya llegado antes).
 */
async function agregarSinProcesos() {
  await ensureColumn("User", "waSinProcesosAt", "TIMESTAMPTZ");
  const usuarios = await prisma.$queryRawUnsafe<{ id: string; lastName: string | null; name: string | null }[]>(
    `UPDATE "User" u SET "waSinProcesosAt" = now()
     WHERE u.role <> 'admin'
       AND u."createdAt" <= now() - interval '24 hours'
       AND u."waSinProcesosAt" IS NULL
       AND NOT EXISTS (SELECT 1 FROM "Case" c WHERE c."userId" = u.id)
     RETURNING u.id, u."lastName", u.name`,
  );
  for (const u of usuarios) {
    const apellido = primerApellido(u.lastName, u.name);
    await registrarAvisoWhatsapp(u.id, "sinProcesos", textoAutomatico("sinProcesos", { apellido }));
  }
}

/**
 * Envía al root el reporte con los avisos no reportados, una sola vez al día.
 * `forzar` lo envía aunque ya haya salido hoy.
 */
export async function enviarReporteWhatsapp(opts: { forzar?: boolean } = {}) {
  await asegurarTabla();
  const hoy = hoyBogota();
  const [s] = await prisma.$queryRawUnsafe<{ f: string | null }[]>(
    `SELECT "reporteWaFecha" AS f FROM "SiteSetting" WHERE id = 'site'`,
  );
  if (!opts.forzar && s?.f === hoy) return { omitido: "ya enviado hoy" };

  await agregarSinProcesos();
  const avisos = await prisma.$queryRawUnsafe<
    { id: number; userId: string; tipo: string; mensaje: string; firstName: string | null; name: string | null; whatsapp: string | null }[]
  >(
    `SELECT a.id, a."userId", a.tipo, a.mensaje, u."firstName", u.name, u."whatsapp"
     FROM "AvisoWhatsapp" a JOIN "User" u ON u.id = a."userId"
     WHERE a."reportadoAt" IS NULL
     ORDER BY a."createdAt"`,
  );
  const filas = agruparPorAbogado(avisos);
  const marcar = async () => {
    await prisma.$executeRawUnsafe(
      `UPDATE "AvisoWhatsapp" SET "reportadoAt" = now() WHERE id = ANY($1::int[])`,
      avisos.map((a) => a.id),
    );
    await prisma.$executeRawUnsafe(`UPDATE "SiteSetting" SET "reporteWaFecha" = $1 WHERE id = 'site'`, hoy);
  };
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
      text: `Adjunto el Excel con ${filas.length} aviso(s) para enviar por WhatsApp (una fila por mensaje).`,
      html: `<div style="font-family:system-ui,sans-serif"><p>Adjunto el Excel con <b>${filas.length}</b> aviso(s) para enviar por WhatsApp, uno por fila (actuaciones nuevas, procesos sin cargar y pagos por vencer o vencidos).</p><p style="color:#777;font-size:13px">Columna A: nombre y aviso. Columna B: teléfono.</p></div>`,
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

// ---------- Registrados el día anterior sin procesos (7:20 a.m., root) ----------

/** Fecha (AAAA-MM-DD, Bogotá) de `dias` días atrás. */
export function fechaBogotaHace(dias: number, d = new Date()) {
  return hoyBogota(new Date(d.getTime() - dias * 24 * 60 * 60 * 1000));
}

/**
 * Quienes se registraron ese día (hora de Bogotá) y aún no han cargado ningún
 * proceso: A = mensaje (saluda por el apellido), B = teléfono.
 */
export async function filasSinProcesosDelDia(fecha: string) {
  const usuarios = await prisma.$queryRawUnsafe<
    { firstName: string | null; lastName: string | null; name: string | null; whatsapp: string | null }[]
  >(
    `SELECT u."firstName", u."lastName", u.name, u."whatsapp" FROM "User" u
     WHERE u.role <> 'admin'
       AND (u."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota')::date = $1::date
       AND NOT EXISTS (SELECT 1 FROM "Case" c WHERE c."userId" = u.id)
     ORDER BY u."createdAt"`,
    fecha,
  );
  const filas: { mensaje: string; telefono: string }[] = [];
  for (const u of usuarios) {
    const telefono = (u.whatsapp ?? "").replace(/\D/g, "");
    if (!telefono) continue;
    filas.push({
      // Sin "Nombre - ": el mensaje ya saluda por el apellido.
      mensaje: textoAutomatico("sinProcesos", { apellido: primerApellido(u.lastName, u.name) }),
      telefono,
    });
  }
  return filas;
}

/** 7:20 a.m.: avisa al root (push + campana) con el enlace para descargar el Excel. */
export async function avisarReporteSinProcesos() {
  await ensureColumn("SiteSetting", "reporteSinProcesosFecha", "TEXT");
  const hoy = hoyBogota();
  const [s] = await prisma.$queryRawUnsafe<{ f: string | null }[]>(
    `SELECT "reporteSinProcesosFecha" AS f FROM "SiteSetting" WHERE id = 'site'`,
  );
  if (s?.f === hoy) return { omitido: "ya enviado hoy" };
  await prisma.$executeRawUnsafe(
    `UPDATE "SiteSetting" SET "reporteSinProcesosFecha" = $1 WHERE id = 'site'`,
    hoy,
  );
  const ayer = fechaBogotaHace(1);
  const filas = await filasSinProcesosDelDia(ayer);
  const admins = await prisma.user.findMany({ where: { role: "admin" }, select: { id: true } });
  const { sendPushToUsers } = await import("./push");
  await sendPushToUsers(
    admins.map((a) => a.id),
    {
      title: "📋 Registrados ayer sin procesos",
      body:
        filas.length > 0
          ? `${filas.length} usuario(s) se registraron ayer y no han cargado procesos. Toca para descargar el Excel.`
          : "Todos los que se registraron ayer ya cargaron procesos (o no hubo registros).",
      url: `/dashboard/admin/reportes?fecha=${ayer}`,
      tag: "reporte-sin-procesos",
    },
  );
  return { fecha: ayer, usuarios: filas.length };
}
