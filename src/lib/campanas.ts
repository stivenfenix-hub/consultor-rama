import "server-only";
import { prisma } from "./db";
import { randomUUID } from "node:crypto";
import { guardarArchivo, leerArchivo } from "./firma-storage";
import { sendMail } from "./mailer";

/**
 * Campañas del root (Panel admin → Campañas).
 *
 * Campaña "firma-gratis": invita a probar la Firma Electrónica a quienes ya
 * tienen al menos 1 proceso y aún no han enviado ningún documento a firmar
 * (justo los que tienen la primera firma gratis).
 *
 * Los envíos salen de a poco durante el día:
 *   - WhatsApp: por la cola del WhatsApp comercial (pausa de 25 a 70 s entre
 *     mensajes, de 7:01 a.m. a 8 p.m. y con su máximo diario).
 *   - Correo: cola propia ("CorreoCola") que el cron de cada 5 minutos va
 *     vaciando de a 1 o 2, de 8 a.m. a 7 p.m., con un máximo diario (el SMTP
 *     de Hostinger permite pocos correos al día y también los usan los avisos).
 */

export const CAMPANA_FIRMA = "firma-gratis";
export const CORREOS_CAMPANA_DIA = 40;
const APP_URL = process.env.APP_URL ?? "https://app.estradox.com";
export const ENLACE_FIRMAS = `${APP_URL}/dashboard/firmas`;
/**
 * Ejemplo de firma en UNA imagen (poder firmado + certificado, lado a lado): los
 * abogados desconfían de abrir PDF adjuntos (virus), una imagen se ve sin abrir nada.
 * Vive en public/campanas (la sirve la app). El WhatsApp la manda con el texto de pie.
 */
export const IMAGEN_EJEMPLO_FIRMA = `${APP_URL}/campanas/firma-ejemplo.jpg`;

export const PLANTILLA_WA_FIRMA = `Hola Dr(a). {apellido}, ¿sus clientes todavía tienen que ir a la notaría para firmar un poder? 📄🏃‍♂️

En Estradox acabamos de lanzar la nueva *Firma Electrónica* con validez jurídica (Ley 527 de 1999 y Ley 2213 de 2022). Ahora puede enviar poderes, contratos de honorarios o pagarés, y su cliente firma directamente desde el celular en minutos.

Usted elige el nivel de seguridad, hasta el más alto: código por WhatsApp o correo + foto de la cédula + reconocimiento facial.

🎁 Le activamos *1 firma 100 % GRATIS* en su cuenta.

Pruébela sin pagar nada: envíe su primer documento y vea cómo recibe el PDF sellado y certificado.
👉 {enlace}

Quedamos atentos si tiene alguna duda con su primer envío. ¡Feliz semana!`;

export const ASUNTO_CORREO_FIRMA = "🎁 Le regalamos su primera Firma Electrónica (poderes sin ir a notaría)";

export const PLANTILLA_CORREO_FIRMA = `Estimado/a Dr(a). {apellido}:

Sabemos que hacer que un cliente imprima, firme, vaya a la notaría y escanee un documento es un proceso del pasado que retrasa el inicio de sus procesos judiciales.

Por eso hoy lanzamos la **Firma Electrónica de Estradox**: sus clientes firman poderes especiales, contratos de honorarios y pagarés directamente desde el celular, con total validez jurídica bajo la Ley 527 de 1999 y la Ley 2213 de 2022.

**¿Cómo funciona? Es tan fácil como contar hasta 3:**
1️⃣ **Sube su documento:** cargue su PDF o Word en Estradox (o use una plantilla) y marque dónde firma su cliente.
2️⃣ **El cliente firma desde el celular:** le llega un enlace por WhatsApp o correo, valida su identidad (código, cédula y rostro) y firma con el dedo en segundos.
3️⃣ **Recibe el PDF certificado:** le llega el documento sellado con fecha, hora exacta y certificado de trazabilidad. ¡Listo para radicar!

🎁 **¡Su primera firma es nuestra!**
Le activamos 1 firma totalmente GRATIS en su cuenta para que pruebe la tecnología sin pagar nada. Después, cada documento firmado y certificado cuesta desde $4.900 COP.

{boton}

**¿Qué puede firmar electrónicamente?**
✅ Poderes especiales (civil, laboral, familia, administrativo, tutelas).
✅ Contratos de honorarios.
✅ Pagarés.
✅ Contratos de arrendamiento y promesas de compraventa.

Nota: los documentos con solemnidad estricta, como poderes generales, escrituras públicas de inmuebles y testamentos, aún requieren el trámite notarial presencial.

Pruebe su primera firma hoy mismo y descubra lo rápido que es agilizar sus procesos.

Un cordial saludo,
El equipo de Estradox`;

const BOTON_CORREO = "Enviar mi primer documento GRATIS →";

function primerApellido(lastName: string | null, name: string | null) {
  const a = (lastName ?? "").trim().split(/\s+/)[0] || (name ?? "").trim().split(/\s+/).slice(1)[0] || "";
  return a ? a.charAt(0).toUpperCase() + a.slice(1).toLowerCase() : "";
}

/** Pone apellido, nombre y enlace ("Dr(a). {apellido}" -> "Dr(a)." si no hay apellido). */
export function personalizar(texto: string, u: { firstName: string | null; lastName: string | null; name: string | null }) {
  const apellido = primerApellido(u.lastName, u.name);
  const nombre = (u.firstName || u.name || "").trim().split(/\s+/)[0] ?? "";
  let t = apellido ? texto.replace(/\{apellido\}/g, apellido) : texto.replace(/ ?\{apellido\}/g, "");
  t = nombre ? t.replace(/\{nombre\}/g, nombre) : t.replace(/ ?\{nombre\}/g, "");
  return t.replace(/\{enlace\}/g, ENLACE_FIRMAS);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Texto del correo → HTML sencillo: párrafos, **negrilla**, {boton} y enlaces. */
export function correoHtml(texto: string) {
  const parrafos = texto.split(/\n{2,}/).map((p) => {
    if (p.trim() === "{imagen}") {
      return `<p style="margin:18px 0"><a href="${IMAGEN_EJEMPLO_FIRMA}"><img src="${IMAGEN_EJEMPLO_FIRMA}" width="580" alt="Ejemplo: poder firmado electrónicamente y su certificado de auditoría" style="display:block;width:100%;max-width:580px;height:auto;border:1px solid #ddd6fe;border-radius:8px"></a></p>`;
    }
    if (p.trim() === "{boton}") {
      return `<p style="text-align:center;margin:26px 0"><a href="${ENLACE_FIRMAS}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;font-weight:700;padding:14px 26px;border-radius:10px;font-size:16px">${BOTON_CORREO}</a></p>`;
    }
    const html = esc(p)
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#7c3aed">$1</a>')
      .replace(/\n/g, "<br>");
    return `<p style="margin:0 0 14px;line-height:1.55">${html}</p>`;
  });
  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:580px;margin:0 auto;color:#1d1b2e;font-size:15px">
      <p style="font-size:20px;font-weight:800;color:#5b21b6;margin:0 0 18px">Estradox</p>
      ${parrafos.join("\n")}
    </div>`;
}

export function correoTexto(texto: string) {
  return texto
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace("{boton}", `${BOTON_CORREO} ${ENLACE_FIRMAS}`)
    .replace("{imagen}", `Vea el ejemplo: ${IMAGEN_EJEMPLO_FIRMA}`);
}

// ---------- Cola de correos ----------

let tabla: Promise<unknown> | null = null;
export const asegurarCola = () =>
  (tabla ??= (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "CorreoCola" (
        id SERIAL PRIMARY KEY,
        campana TEXT NOT NULL,
        "userId" TEXT REFERENCES "User"(id) ON DELETE CASCADE,
        para TEXT NOT NULL,
        asunto TEXT NOT NULL,
        html TEXT NOT NULL,
        texto TEXT NOT NULL,
        estado TEXT NOT NULL DEFAULT 'pendiente',
        error TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "enviadoAt" TIMESTAMPTZ
      )`);
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "CorreoCola_pendiente" ON "CorreoCola" (id) WHERE estado = 'pendiente'`,
    );
    // PDF adjunto de la campaña (24 nov 2026): el archivo vive en el disco de Hostinger;
    // aquí solo su id y el nombre con que le llega al abogado.
    await prisma.$executeRawUnsafe(`ALTER TABLE "CorreoCola" ADD COLUMN IF NOT EXISTS adjunto TEXT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "CorreoCola" ADD COLUMN IF NOT EXISTS "adjuntoNombre" TEXT`);
  })().catch((e) => {
    tabla = null;
    throw e;
  }));

// ---------- PDF adjunto ----------

/** Máximo del PDF adjunto (el SMTP y WhatsApp lo aceptan sin problema). */
export const ADJUNTO_MAX_BYTES = 5 * 1024 * 1024;
export type AdjuntoCampana = { id: string; nombre: string };

/**
 * Guarda el PDF que acompaña la campaña en el disco de Hostinger (la misma carpeta
 * persistente de los PDF de firmas), no en Supabase: el correo lo adjunta desde
 * ahí y el servicio de WhatsApp lo descarga una vez por su enlace.
 */
export async function guardarAdjuntoCampana(nombre: string, datos: Buffer): Promise<AdjuntoCampana> {
  const id = randomUUID();
  await guardarArchivo(`${id}/campana.pdf`, datos);
  const limpio = (nombre.replace(/[\\/:*?"<>|]+/g, " ").trim() || "documento").slice(0, 120);
  return { id, nombre: /\.pdf$/i.test(limpio) ? limpio : `${limpio}.pdf` };
}

export const esIdAdjunto = (id: string) => /^[a-f0-9-]{36}$/.test(id);

/** Lee el PDF del disco (queda en memoria después de la primera vez). */
const enMemoria = new Map<string, Buffer>();
export async function leerAdjuntoCampana(id: string): Promise<Buffer | null> {
  if (!esIdAdjunto(id)) return null;
  const hay = enMemoria.get(id);
  if (hay) return hay;
  const datos = await leerArchivo(`${id}/campana.pdf`).catch(() => null);
  if (datos) {
    if (enMemoria.size >= 5) enMemoria.delete(enMemoria.keys().next().value!);
    enMemoria.set(id, datos);
  }
  return datos;
}

/** Enlace del PDF para el servicio de WhatsApp (el id es aleatorio, imposible de adivinar). */
export const enlaceAdjunto = (id: string) => `${APP_URL}/api/campana-adjunto/${id}`;

const horaBogota = () => {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Bogota", hour: "numeric", hour12: false }).formatToParts(new Date());
  return Number(p.find((x) => x.type === "hour")?.value ?? 0);
};

/**
 * Lo llama el cron de cada 5 minutos: envía 1 o 2 correos de campaña, de
 * 8 a.m. a 7 p.m. (Bogotá) y sin pasar el máximo diario.
 */
export async function procesarCorreosCampana(): Promise<number> {
  const h = horaBogota();
  if (h < 8 || h >= 19) return 0;
  await asegurarCola();
  const [hoy] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n FROM "CorreoCola" WHERE estado = 'enviado'
       AND ("enviadoAt" AT TIME ZONE 'America/Bogota')::date = (now() AT TIME ZONE 'America/Bogota')::date`,
  );
  const quedan = CORREOS_CAMPANA_DIA - Number(hoy?.n ?? 0);
  if (quedan <= 0) return 0;
  const lote = Math.min(quedan, Math.random() < 0.5 ? 1 : 2);
  const filas = await prisma.$queryRawUnsafe<
    { id: number; para: string; asunto: string; html: string; texto: string; adjunto: string | null; adjuntoNombre: string | null }[]
  >(
    `UPDATE "CorreoCola" SET estado = 'enviando'
     WHERE id IN (SELECT id FROM "CorreoCola" WHERE estado = 'pendiente' ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED)
     RETURNING id, para, asunto, html, texto, adjunto, "adjuntoNombre"`,
    lote,
  );
  let enviados = 0;
  for (const f of filas) {
    try {
      let attachments: { filename: string; content: Buffer; contentType: string }[] | undefined;
      if (f.adjunto) {
        const datos = await leerAdjuntoCampana(f.adjunto);
        if (!datos) throw new Error("El PDF adjunto ya no está en el servidor.");
        attachments = [{ filename: f.adjuntoNombre || "documento.pdf", content: datos, contentType: "application/pdf" }];
      }
      await sendMail({ to: f.para, subject: f.asunto, html: f.html, text: f.texto, attachments });
      await prisma.$executeRawUnsafe(`UPDATE "CorreoCola" SET estado = 'enviado', "enviadoAt" = now(), error = NULL WHERE id = $1`, f.id);
      enviados++;
    } catch (e) {
      await prisma.$executeRawUnsafe(`UPDATE "CorreoCola" SET estado = 'fallido', error = $2 WHERE id = $1`, f.id, String(e).slice(0, 300));
    }
  }
  return enviados;
}

// ---------- Destinatarios ----------

export type DestinatarioFirma = {
  id: string;
  nombre: string;
  email: string;
  telefono: string;
  procesos: number;
  ultimoWa: Date | null;
  ultimoCorreo: Date | null;
};

/**
 * Abogados (no root) con al menos 1 proceso que todavía no han enviado ningún
 * documento a firmar. Primero los que más procesos tienen.
 */
export async function destinatariosFirma(): Promise<{ lista: DestinatarioFirma[]; yaUsaron: number }> {
  const { asegurarTablasFirma } = await import("./firmas");
  const { asegurarTablasWa } = await import("./whatsapp");
  await Promise.all([asegurarTablasFirma(), asegurarTablasWa(), asegurarCola()]);
  const filas = await prisma.$queryRawUnsafe<
    {
      id: string;
      firstName: string | null;
      lastName: string | null;
      name: string | null;
      email: string;
      whatsapp: string | null;
      usoFirma: boolean;
      ultimoWa: Date | null;
      ultimoCorreo: Date | null;
    }[]
  >(
    `SELECT u.id, u."firstName", u."lastName", u.name, u.email, u."whatsapp",
            EXISTS (SELECT 1 FROM "FirmaDocumento" d WHERE d."userId" = u.id AND d."enviadoAt" IS NOT NULL) AS "usoFirma",
            (SELECT max(m."createdAt") FROM "WaMensaje" m WHERE m."userId" = u.id AND m.tipo = 'campana') AS "ultimoWa",
            (SELECT max(c."createdAt") FROM "CorreoCola" c WHERE c."userId" = u.id AND c.campana = $1) AS "ultimoCorreo"
     FROM "User" u
     WHERE u.role <> 'admin'
       AND (EXISTS (SELECT 1 FROM "Case" c WHERE c."userId" = u.id)
            OR EXISTS (SELECT 1 FROM "CargaProcesos" cp WHERE cp."userId" = u.id))`,
    CAMPANA_FIRMA,
  );
  const { conteoProcesosPorUsuario } = await import("./estados");
  const conteo = await conteoProcesosPorUsuario(filas.map((f) => f.id));
  const conProcesos = filas.filter((f) => (conteo.get(f.id) ?? 0) >= 1);
  const lista = conProcesos
    .filter((f) => !f.usoFirma)
    .map((f) => ({
      id: f.id,
      nombre: [f.firstName, f.lastName].filter(Boolean).join(" ") || f.name || f.email,
      email: f.email,
      telefono: (f.whatsapp ?? "").replace(/\D/g, ""),
      procesos: conteo.get(f.id) ?? 0,
      ultimoWa: f.ultimoWa,
      ultimoCorreo: f.ultimoCorreo,
    }))
    .sort((a, b) => b.procesos - a.procesos);
  return { lista, yaUsaron: conProcesos.length - lista.length };
}

/** Resumen de la cola de correos de la campaña (para la página). */
export async function resumenCorreos() {
  await asegurarCola();
  const filas = await prisma.$queryRawUnsafe<{ estado: string; n: bigint }[]>(
    `SELECT estado, count(*) AS n FROM "CorreoCola" WHERE campana = $1 GROUP BY estado`,
    CAMPANA_FIRMA,
  );
  const [hoy] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n FROM "CorreoCola" WHERE estado = 'enviado'
       AND ("enviadoAt" AT TIME ZONE 'America/Bogota')::date = (now() AT TIME ZONE 'America/Bogota')::date`,
  );
  const por = Object.fromEntries(filas.map((f) => [f.estado, Number(f.n)]));
  return { pendientes: por.pendiente ?? 0, enviados: por.enviado ?? 0, fallidos: por.fallido ?? 0, hoy: Number(hoy?.n ?? 0) };
}

/** Deja en cola los correos de la campaña (sin repetir a quien ya lo tiene pendiente o enviado). */
export async function encolarCorreosFirma(
  usuarios: { id: string; email: string; firstName: string | null; lastName: string | null; name: string | null }[],
  asunto: string,
  cuerpo: string,
  adjunto: AdjuntoCampana | null = null,
): Promise<number> {
  await asegurarCola();
  let n = 0;
  for (const u of usuarios) {
    const texto = personalizar(cuerpo, u);
    n += await prisma.$executeRawUnsafe(
      `INSERT INTO "CorreoCola" (campana, "userId", para, asunto, html, texto, adjunto, "adjuntoNombre")
       SELECT $1, $2, $3, $4, $5, $6, $7, $8
       WHERE NOT EXISTS (SELECT 1 FROM "CorreoCola" WHERE campana = $1 AND "userId" = $2 AND estado IN ('pendiente', 'enviando', 'enviado'))`,
      CAMPANA_FIRMA,
      u.id,
      u.email,
      personalizar(asunto, u),
      correoHtml(texto),
      correoTexto(texto),
      adjunto?.id ?? null,
      adjunto?.nombre ?? null,
    );
  }
  return n;
}
