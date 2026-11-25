import "server-only";
import { prisma } from "./db";
import { ensureColumn } from "./runtime-columns";

/**
 * Campaña "aproveche su prueba" (25 nov 2026, redactada con la experta de
 * marketing y probada con el abogado-usuario): a quien está en prueba con 1 a 4
 * radicados y le quedan 4 a 8 días, un WhatsApp (línea comercial) y un correo
 * el mismo día, UNA sola vez. Sin push, sin precio ni enlace de pago (eso lo hace
 * el aviso de 3 días). Ofrece cargarle el listado (Excel o foto).
 * Días hábiles de 9 a 11 a.m., para no caer encima del resumen de las 7:00.
 */

export const CAMPANA_APROVECHAR = "aprovechar";
const APP_URL = "https://app.estradox.com";
const DIAS_DESDE = 4;
const DIAS_HASTA = 8;
const MAX_RADICADOS = 4;
const MAX_DIA = 20;
const LANZAMIENTO = "2026-10-22T05:00:00Z"; // el mismo de subscription.ts

/** "ERICK" -> "Erick". */
function palabra(s: string | null | undefined) {
  const p = (s ?? "").trim().split(/\s+/)[0] ?? "";
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : "";
}

function quien(u: { firstName: string | null; lastName: string | null; name: string | null }) {
  const nombre = palabra(u.firstName) || palabra(u.name);
  const apellido = palabra(u.lastName) || palabra((u.name ?? "").trim().split(/\s+/).slice(1).join(" "));
  return [nombre, apellido].filter(Boolean).join(" ");
}

function frases(radicados: number, actuaciones: number, dias: number) {
  const vigila = `Hoy vigilamos ${radicados === 1 ? "1 de sus procesos" : `${radicados} de sus procesos`}`;
  const hallazgo =
    actuaciones > 0
      ? ` y esta semana encontramos ${actuaciones === 1 ? "1 actuación nueva" : `${actuaciones} actuaciones nuevas`} en ${radicados === 1 ? "él" : "ellos"}`
      : "";
  return { vigila: `${vigila}${hallazgo}.`, quedan: `A su prueba gratuita le quedan ${dias} días` };
}

export function textoWhatsappAprovechar(nombre: string, radicados: number, actuaciones: number, dias: number) {
  const f = frases(radicados, actuaciones, dias);
  return `Buen día${nombre ? `, ${nombre}` : ""}. Le escribe Manuela, de Estradox.

${f.vigila} ${f.quedan}: es el mejor momento para tener ahí todos los que lleva.

Si no tiene tiempo, envíeme por aquí su listado (Excel o una foto) y yo se los cargo hoy.

Si ya no le interesa, dígame y no le escribo más.`;
}

export function correoAprovechar(nombre: string, radicados: number, actuaciones: number, dias: number) {
  const f = frases(radicados, actuaciones, dias);
  const asunto = `Le quedan ${dias} días de prueba: ¿ya están todos sus procesos?`;
  const texto = `${nombre ? `${nombre}, buen día.` : "Buen día."}

${f.vigila} ${f.quedan}, y entre más radicados tenga cargados, más le sirve el resumen que le llega cada mañana a las 7:00 a. m. con lo nuevo de la Rama Judicial y de los estados electrónicos.

Agregar uno es pegar los 23 dígitos del radicado aquí:
${APP_URL}/dashboard/procesos

¿No tiene tiempo? Responda este correo con su listado en Excel o una foto y yo se los cargo.

Un saludo,
Manuela de Estradox`;
  return { asunto, texto };
}

export async function enviarCampanaAprovechar() {
  const { esDiaHabil } = await import("./dias-habiles");
  if (!esDiaHabil(new Date(Date.now() - 5 * 60 * 60 * 1000))) return { omitido: "día no hábil" };
  await ensureColumn("SiteSetting", "aprovecharFecha", "TEXT");
  const { hoyBogota } = await import("./reporte-whatsapp");
  const hoy = hoyBogota();
  const [s] = await prisma.$queryRawUnsafe<{ f: string | null }[]>(
    `SELECT "aprovecharFecha" AS f FROM "SiteSetting" WHERE id = 'site'`,
  );
  if (s?.f === hoy) return { omitido: "ya enviado hoy" };

  const { asegurarTablasWa, encolarWhatsapp } = await import("./whatsapp");
  const { asegurarCola, correoHtml, correoTexto } = await import("./campanas");
  const { getPlan } = await import("./subscription");
  await asegurarTablasWa();
  await asegurarCola();
  await ensureColumn("User", "marketingOptOut", "BOOLEAN NOT NULL DEFAULT false");
  await ensureColumn("User", "socio", "BOOLEAN NOT NULL DEFAULT false");
  const { diasPrueba } = await getPlan();

  // En prueba (sin pago vigente) y con 4 a 8 días por delante.
  const candidatos = await prisma.$queryRawUnsafe<
    {
      id: string;
      email: string;
      firstName: string | null;
      lastName: string | null;
      name: string | null;
      whatsapp: string | null;
      dias: number;
    }[]
  >(
    `SELECT * FROM (
       SELECT u.id, u.email, u."firstName", u."lastName", u.name, u."whatsapp",
              ceil(extract(epoch FROM coalesce(u."trialEndsAt",
                greatest(u."createdAt", $1::timestamptz) + make_interval(days => $2::int)) - now()) / 86400)::int AS dias
       FROM "User" u
       WHERE u.role <> 'admin' AND NOT u.socio AND NOT u."marketingOptOut"
         AND u."emailVerified" IS NOT NULL
         AND (u."paidUntil" IS NULL OR u."paidUntil" < now())
         AND NOT EXISTS (SELECT 1 FROM "WaMensaje" m WHERE m."userId" = u.id AND m.tipo = $3)
         AND NOT EXISTS (SELECT 1 FROM "CorreoCola" c WHERE c."userId" = u.id AND c.campana = $3)
     ) x WHERE dias BETWEEN $4::int AND $5::int
     ORDER BY dias`,
    LANZAMIENTO,
    diasPrueba,
    CAMPANA_APROVECHAR,
    DIAS_DESDE,
    DIAS_HASTA,
  );

  // Radicados como en Usuarios (Rama + solo en estados): de 1 a 4.
  const { conteoProcesosPorUsuario } = await import("./estados");
  const conteo = await conteoProcesosPorUsuario(candidatos.map((u) => u.id));
  const elegidos = candidatos
    .map((u) => ({ ...u, radicados: conteo.get(u.id) ?? 0 }))
    .filter((u) => u.radicados >= 1 && u.radicados <= MAX_RADICADOS)
    .slice(0, MAX_DIA);
  if (elegidos.length === 0) {
    await marcarDia(hoy);
    return { candidatos: candidatos.length, elegidos: 0 };
  }

  // Actuaciones de la última semana en sus procesos (dato real para el mensaje).
  const act = await prisma.$queryRawUnsafe<{ userId: string; n: number }[]>(
    `SELECT c."userId", count(*)::int AS n FROM "Actuacion" a JOIN "Case" c ON c.id = a."caseId"
     WHERE c."userId" = ANY($1::text[]) AND a."fechaActuacion" >= now() - interval '7 days'
     GROUP BY 1`,
    elegidos.map((u) => u.id),
  );
  const actuaciones = new Map(act.map((a) => [a.userId, a.n]));

  let whatsapp = 0;
  let correos = 0;
  for (const u of elegidos) {
    const nombre = quien(u);
    const n = actuaciones.get(u.id) ?? 0;
    const telefono = (u.whatsapp ?? "").replace(/\D/g, "");
    if (telefono) {
      whatsapp += await encolarWhatsapp([
        { tipo: CAMPANA_APROVECHAR, userId: u.id, telefono, mensaje: textoWhatsappAprovechar(nombre, u.radicados, n, u.dias) },
      ]);
    }
    const c = correoAprovechar(nombre, u.radicados, n, u.dias);
    correos += await prisma.$executeRawUnsafe(
      `INSERT INTO "CorreoCola" (campana, "userId", para, asunto, html, texto)
       SELECT $1, $2, $3, $4, $5, $6
       WHERE NOT EXISTS (SELECT 1 FROM "CorreoCola" WHERE campana = $1 AND "userId" = $2)`,
      CAMPANA_APROVECHAR,
      u.id,
      u.email,
      c.asunto,
      correoHtml(c.texto),
      correoTexto(c.texto),
    );
  }
  await marcarDia(hoy);
  return { candidatos: candidatos.length, elegidos: elegidos.length, whatsapp, correos };
}

async function marcarDia(hoy: string) {
  await prisma.$executeRawUnsafe(`UPDATE "SiteSetting" SET "aprovecharFecha" = $1 WHERE id = 'site'`, hoy);
}
