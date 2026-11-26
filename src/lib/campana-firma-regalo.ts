import "server-only";
import { prisma } from "./db";
import { ensureColumn } from "./runtime-columns";

/**
 * Regalo de la Firma Electrónica (26 nov 2026, textos con la experta de
 * marketing y el abogado-usuario): el día hábil siguiente a que el abogado carga
 * su PRIMER radicado (justo cuando se le desbloquea la primera firma gratis), un
 * WhatsApp por la línea comercial y un correo, UNA sola vez.
 *
 * No se envía a quien ya envió un documento a firmar, ni a quien ya recibió la
 * campaña masiva "firma-gratis" (Panel admin → Campañas), ni a quien pidió no
 * recibir mensajes. Días hábiles de 11 a.m. a 2 p.m., después del resumen de las
 * 7:00, de "aproveche su prueba" (9-11) y del segundo mensaje sin procesos (10:00).
 */

export const CAMPANA_FIRMA_REGALO = "firmaRegalo";
/** Primer radicado de ayer hacia atrás hasta 5 días (cubre fines de semana y festivos). */
const DIAS_MAX = 5;
const MAX_DIA = 30;

export const TEXTO_WA_FIRMA_REGALO = `Hola, {nombre}. Le escribe Manuela, de Estradox.

Su primer proceso ya quedó vigilado: cuando haya novedades, a las 7:00 a. m. le llega el resumen.

Un dato que le puede servir: en su cuenta también tiene Firma Electrónica, y su primer documento es *gratis*. Usted sube el poder o el contrato, su cliente lo firma desde el celular y usted recibe el PDF sellado (Ley 527 de 1999 y Ley 2213 de 2022).

👉 {enlace}

Si no le interesa, me dice y no le escribo más.`;

export const ASUNTO_CORREO_FIRMA_REGALO = "Su primer documento con firma electrónica es gratis";

export const TEXTO_CORREO_FIRMA_REGALO = `Hola, {nombre}:

Su primer proceso ya está vigilado en Estradox. Cuando haya novedades en la Rama Judicial o en los estados electrónicos, a las 7:00 a. m. le llega el resumen.

Le cuento de otra herramienta que ya tiene en su cuenta: la **Firma Electrónica**. Su **primer documento es gratis**.

Así se ve un poder firmado con Estradox y su certificado de auditoría:

{imagen}

Así funciona:
1. Usted sube el PDF o Word (o usa una plantilla) y marca dónde firma su cliente.
2. Al cliente le llega un enlace por WhatsApp o correo. Valida su identidad con el nivel que usted elija, desde un código hasta código, foto de la cédula y reconocimiento facial, y firma con el dedo.
3. Usted recibe el **PDF sellado** con fecha, hora y certificado de trazabilidad.

Sirve, por ejemplo, para poderes especiales, contratos de honorarios y pagarés, con respaldo en la Ley 527 de 1999 y la Ley 2213 de 2022.

**No sirve** para poderes generales, escrituras ni testamentos.

{boton}

Después del primero, cada documento cuesta desde $4.900 COP.

Manuela, de Estradox`;

function palabra(s: string | null | undefined) {
  const p = (s ?? "").trim().split(/\s+/)[0] ?? "";
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : "";
}

function poner(texto: string, nombre: string, enlace: string) {
  const t = nombre ? texto.replace(/\{nombre\}/g, nombre) : texto.replace(/, \{nombre\}/g, "").replace(/\{nombre\}/g, "");
  return t.replace(/\{enlace\}/g, enlace);
}

type Candidato = {
  id: string;
  email: string;
  emailVerified: Date | null;
  firstName: string | null;
  name: string | null;
  whatsapp: string | null;
};

/** Quiénes reciben hoy el regalo (también para la prueba en seco). */
export async function candidatosFirmaRegalo(): Promise<Candidato[]> {
  const { asegurarTablasWa } = await import("./whatsapp");
  const { asegurarCola } = await import("./campanas");
  const { asegurarTablasFirma } = await import("./firmas");
  await Promise.all([asegurarTablasWa(), asegurarCola(), asegurarTablasFirma()]);
  await ensureColumn("User", "marketingOptOut", "BOOLEAN NOT NULL DEFAULT false");
  const filas = await prisma.$queryRawUnsafe<Candidato[]>(
    `WITH primero AS (
       SELECT "userId", min(f) AS f FROM (
         SELECT c."userId", ((c."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota')::date AS f FROM "Case" c
         UNION ALL
         SELECT cp."userId", (cp."createdAt" AT TIME ZONE 'America/Bogota')::date FROM "CargaProcesos" cp
       ) x GROUP BY "userId"
     )
     SELECT u.id, u.email, u."emailVerified", u."firstName", u.name, u."whatsapp"
     FROM "User" u JOIN primero p ON p."userId" = u.id
     WHERE u.role <> 'admin' AND NOT u."marketingOptOut"
       AND p.f < (now() AT TIME ZONE 'America/Bogota')::date
       AND p.f >= (now() AT TIME ZONE 'America/Bogota')::date - $1::int
       AND NOT EXISTS (SELECT 1 FROM "FirmaDocumento" d WHERE d."userId" = u.id AND d."enviadoAt" IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM "WaMensaje" m WHERE m."userId" = u.id AND m.tipo IN ($2, 'campana'))
       AND NOT EXISTS (SELECT 1 FROM "CorreoCola" c WHERE c."userId" = u.id AND c.campana IN ($2, 'firma-gratis'))
     ORDER BY p.f, u."createdAt"`,
    DIAS_MAX,
    CAMPANA_FIRMA_REGALO,
  );
  // Con al menos 1 radicado de verdad (Rama o solo estados), como pide la firma gratis.
  const { conteoProcesosPorUsuario } = await import("./estados");
  const conteo = await conteoProcesosPorUsuario(filas.map((f) => f.id));
  return filas.filter((f) => (conteo.get(f.id) ?? 0) >= 1).slice(0, MAX_DIA);
}

export async function enviarCampanaFirmaRegalo() {
  const { esDiaHabil } = await import("./dias-habiles");
  if (!esDiaHabil(new Date(Date.now() - 5 * 60 * 60 * 1000))) return { omitido: "día no hábil" };
  await ensureColumn("SiteSetting", "firmaRegaloFecha", "TEXT");
  const { hoyBogota } = await import("./reporte-whatsapp");
  const hoy = hoyBogota();
  const [s] = await prisma.$queryRawUnsafe<{ f: string | null }[]>(
    `SELECT "firmaRegaloFecha" AS f FROM "SiteSetting" WHERE id = 'site'`,
  );
  if (s?.f === hoy) return { omitido: "ya enviado hoy" };

  const elegidos = await candidatosFirmaRegalo();
  const { encolarWhatsapp } = await import("./whatsapp");
  const { correoHtml, correoTexto, ENLACE_FIRMAS, IMAGEN_EJEMPLO_FIRMA } = await import("./campanas");
  let whatsapp = 0;
  let correos = 0;
  for (const u of elegidos) {
    const nombre = palabra(u.firstName) || palabra(u.name);
    const telefono = (u.whatsapp ?? "").replace(/\D/g, "");
    if (telefono) {
      whatsapp += await encolarWhatsapp([
        {
          tipo: CAMPANA_FIRMA_REGALO,
          userId: u.id,
          telefono,
          mensaje: poner(TEXTO_WA_FIRMA_REGALO, nombre, ENLACE_FIRMAS),
          // Sale como imagen (poder firmado + certificado) con este texto de pie.
          adjuntoUrl: IMAGEN_EJEMPLO_FIRMA,
          adjuntoNombre: "firma-ejemplo.jpg",
        },
      ]);
    }
    if (u.emailVerified) {
      const texto = poner(TEXTO_CORREO_FIRMA_REGALO, nombre, ENLACE_FIRMAS);
      correos += await prisma.$executeRawUnsafe(
        `INSERT INTO "CorreoCola" (campana, "userId", para, asunto, html, texto)
         SELECT $1, $2, $3, $4, $5, $6
         WHERE NOT EXISTS (SELECT 1 FROM "CorreoCola" WHERE campana = $1 AND "userId" = $2)`,
        CAMPANA_FIRMA_REGALO,
        u.id,
        u.email,
        ASUNTO_CORREO_FIRMA_REGALO,
        correoHtml(texto),
        correoTexto(texto),
      );
    }
  }
  // Se marca al final: si algo falla antes, la próxima corrida lo reintenta.
  await prisma.$executeRawUnsafe(`UPDATE "SiteSetting" SET "firmaRegaloFecha" = $1 WHERE id = 'site'`, hoy);
  return { elegidos: elegidos.length, whatsapp, correos };
}
