import "server-only";
import { prisma } from "./db";
import { ensureColumn } from "./runtime-columns";

/**
 * "¿Qué pasó?" (26 nov 2026, con la experta de marketing y el abogado-usuario).
 * A quien se le venció el acceso SIN haber cargado ningún radicado (tampoco solo
 * en estados): un WhatsApp por la línea comercial + un correo para abrir
 * conversación, entender por qué no lo usó y ofrecerle 15 días más.
 *
 * NO extiende nada solo: si el abogado responde que sí, el root lo activa a mano
 * con el botón "Extender 15 días" (Panel admin → Suscripciones) y Manuela sigue la
 * conversación por WhatsApp.
 *
 * UNA sola vez por usuario, 3 a 10 días después del vencimiento (el aviso
 * "venció" de las 7:00 va antes), días hábiles de 2 a 4 p.m. No a admins, socios
 * ni a quien pidió no recibir mensajes.
 */

export const CAMPANA_VENCIDO_SIN_PROCESOS = "vencidoSinProcesos";
const DESDE_DIAS = 3;
const HASTA_DIAS = 10;
const MAX_DIA = 20;
/** Igual que subscription.ts: la prueba de los usuarios antiguos cuenta desde el lanzamiento. */
const LANZAMIENTO = "2026-10-22 05:00:00+00";

export const TEXTO_WA_VENCIDO_SIN_PROCESOS = `Hola, {nombre}. Le escribe Manuela, de Estradox, la plataforma que vigila sus procesos en la Rama Judicial y le avisa cada mañana por WhatsApp cuando hay estados o actuaciones nuevas.

Vi que su prueba terminó sin que alcanzara a cargar ningún proceso, y quería preguntarle: ¿qué pasó? ¿Le faltó tiempo, no le quedó claro cómo cargarlos o no era lo que buscaba? Su respuesta nos ayuda mucho a mejorar.

Si quiere probarlo con calma, le puedo activar 15 días más sin costo. Respóndame y se los activo; si me manda un radicado, el Excel o una foto del listado, yo se los cargo.

Si no le interesa, me dice y no le escribo más.`;

const ASUNTO_CORREO = "¿Qué pasó con su prueba de Estradox?";
const TEXTO_CORREO = `Hola, {nombre}:

Le escribe Manuela, de Estradox, la plataforma que vigila sus procesos en la Rama Judicial y le avisa cada mañana por WhatsApp y correo cuando hay estados o actuaciones nuevas.

Vi que su prueba terminó sin que alcanzara a cargar ningún proceso, y quería preguntarle: ¿qué pasó? ¿Le faltó tiempo, no le quedó claro cómo cargarlos o no era lo que buscaba? Su respuesta nos ayuda mucho a mejorar.

Si quiere probarlo con calma, le puedo activar **15 días más sin costo**. Escríbame por WhatsApp y se los activo; si me manda un radicado (23 dígitos), el Excel o una foto de su listado, yo se los cargo.

{boton:💬 Escribirle a Manuela por WhatsApp|{whatsapp}}

Manuela, de Estradox`;

/** Línea comercial (la que vincula el worker); por si aún no está guardada. */
const COMERCIAL_RESPALDO = "573013335444";
const SALUDO_WA = "Hola, Manuela. Quiero activar mis 15 días en Estradox.";

async function enlaceWhatsappComercial() {
  const [r] = await prisma.$queryRawUnsafe<{ numero: string | null }[]>(
    `SELECT numero FROM "WaEstado" WHERE cuenta = 'comercial'`,
  );
  const numero = (r?.numero ?? "").replace(/\D/g, "") || COMERCIAL_RESPALDO;
  return `https://wa.me/${numero}?text=${encodeURIComponent(SALUDO_WA)}`;
}

function palabra(s: string | null | undefined) {
  const p = (s ?? "").trim().split(/\s+/)[0] ?? "";
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : "";
}

function poner(texto: string, nombre: string) {
  return nombre ? texto.replace(/\{nombre\}/g, nombre) : texto.replace(/, \{nombre\}/g, "");
}

type Candidato = {
  id: string;
  email: string;
  emailVerified: Date | null;
  firstName: string | null;
  name: string | null;
  whatsapp: string | null;
};

/** Quiénes lo reciben hoy (también para la prueba en seco). */
export async function candidatosVencidoSinProcesos(): Promise<Candidato[]> {
  const { asegurarTablasWa } = await import("./whatsapp");
  const { asegurarCola } = await import("./campanas");
  await Promise.all([asegurarTablasWa(), asegurarCola()]);
  await ensureColumn("User", "marketingOptOut", "BOOLEAN NOT NULL DEFAULT false");
  const { getPlan } = await import("./subscription");
  const { diasPrueba } = await getPlan();
  const filas = await prisma.$queryRawUnsafe<Candidato[]>(
    `WITH s AS (
       SELECT u.*, coalesce(u.socio, false) AS es_socio,
              greatest(
                coalesce(u."trialEndsAt", greatest(u."createdAt", $1::timestamptz) + make_interval(days => $2::int)),
                coalesce(u."paidUntil", 'epoch'::timestamptz)
              ) AS hasta
       FROM "User" u
     )
     SELECT id, email, "emailVerified", "firstName", name, "whatsapp" FROM s
     WHERE role <> 'admin' AND NOT es_socio AND NOT "marketingOptOut"
       AND (coalesce("whatsapp", '') <> '' OR "emailVerified" IS NOT NULL)
       AND hasta <= now() - make_interval(days => $3::int)
       AND hasta >= now() - make_interval(days => $4::int)
       AND NOT EXISTS (SELECT 1 FROM "Case" c WHERE c."userId" = s.id)
       AND NOT EXISTS (SELECT 1 FROM "WaMensaje" m WHERE m."userId" = s.id AND m.tipo = $5)
       AND NOT EXISTS (SELECT 1 FROM "CorreoCola" c WHERE c."userId" = s.id AND c.campana = $5)
     ORDER BY hasta DESC`,
    LANZAMIENTO,
    diasPrueba,
    DESDE_DIAS,
    HASTA_DIAS,
    CAMPANA_VENCIDO_SIN_PROCESOS,
  );
  // Los vigilados solo en estados sí tienen procesos.
  const { conteoProcesosPorUsuario } = await import("./estados");
  const conteo = await conteoProcesosPorUsuario(filas.map((f) => f.id));
  return filas.filter((f) => !conteo.get(f.id)).slice(0, MAX_DIA);
}

export async function enviarCampanaVencidoSinProcesos() {
  const { esDiaHabil } = await import("./dias-habiles");
  if (!esDiaHabil(new Date(Date.now() - 5 * 60 * 60 * 1000))) return { omitido: "día no hábil" };
  await ensureColumn("SiteSetting", "vencidoSinProcesosFecha", "TEXT");
  const { hoyBogota } = await import("./reporte-whatsapp");
  const hoy = hoyBogota();
  const [s] = await prisma.$queryRawUnsafe<{ f: string | null }[]>(
    `SELECT "vencidoSinProcesosFecha" AS f FROM "SiteSetting" WHERE id = 'site'`,
  );
  if (s?.f === hoy) return { omitido: "ya enviado hoy" };

  const elegidos = await candidatosVencidoSinProcesos();
  const { encolarWhatsapp } = await import("./whatsapp");
  const { correoHtml, correoTexto } = await import("./campanas");
  const enlaceWa = await enlaceWhatsappComercial();
  let whatsapp = 0;
  let correos = 0;
  for (const u of elegidos) {
    const nombre = palabra(u.firstName) || palabra(u.name);
    const telefono = (u.whatsapp ?? "").replace(/\D/g, "");
    if (telefono) {
      whatsapp += await encolarWhatsapp([
        { tipo: CAMPANA_VENCIDO_SIN_PROCESOS, userId: u.id, telefono, mensaje: poner(TEXTO_WA_VENCIDO_SIN_PROCESOS, nombre) },
      ]);
    }
    if (u.emailVerified) {
      const texto = poner(TEXTO_CORREO, nombre).replace("{whatsapp}", enlaceWa);
      correos += await prisma.$executeRawUnsafe(
        `INSERT INTO "CorreoCola" (campana, "userId", para, asunto, html, texto)
         SELECT $1, $2, $3, $4, $5, $6
         WHERE NOT EXISTS (SELECT 1 FROM "CorreoCola" WHERE campana = $1 AND "userId" = $2)`,
        CAMPANA_VENCIDO_SIN_PROCESOS,
        u.id,
        u.email,
        ASUNTO_CORREO,
        correoHtml(texto),
        correoTexto(texto),
      );
    }
  }
  // Se marca al final: si algo falla antes, la próxima corrida lo reintenta.
  await prisma.$executeRawUnsafe(`UPDATE "SiteSetting" SET "vencidoSinProcesosFecha" = $1 WHERE id = 'site'`, hoy);
  return { elegidos: elegidos.length, whatsapp, correos };
}
