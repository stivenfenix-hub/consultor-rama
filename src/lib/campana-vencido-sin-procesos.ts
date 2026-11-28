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
 * 28 nov 2026: también a quien SÍ tenía procesos y se le venció la prueba
 * ("vencidoConProcesos"): cuántos procesos vigilamos y cuántas novedades le
 * avisamos, qué le pareció, enlace para activar el plan y oferta de ayuda. Antes
 * a ellos solo les llegaba el aviso de pago.
 *
 * UNA sola vez por usuario, EL MISMO DÍA en que vence (pedido del dueño, 28 nov
 * 2026): se revisa cada hora de 8 a.m. a 7 p.m. en días hábiles; quien vence de
 * noche o en fin de semana lo recibe en la siguiente revisión (hasta 10 días
 * después). El aviso de pago "venció" sale a las 7:00 del día siguiente. No a
 * admins, socios ni a quien pidió no recibir mensajes.
 */

export const CAMPANA_VENCIDO_SIN_PROCESOS = "vencidoSinProcesos";
export const CAMPANA_VENCIDO_CON_PROCESOS = "vencidoConProcesos";
const DESDE_DIAS = 0;
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

export const TEXTO_WA_VENCIDO_CON_PROCESOS = `Hola, {nombre}. Le escribe Manuela, de Estradox.

Su prueba gratis terminó {fecha}. Durante este mes vigilamos sus {procesos} en la Rama Judicial y en los estados electrónicos{novedades}. Desde que terminó, ya no los estamos revisando.

Quería preguntarle: ¿qué le pareció? ¿Hubo algo que le faltó o que no funcionó como esperaba? Su opinión nos ayuda mucho.

Si quiere seguir recibiendo el resumen de las 7:00 a. m., puede activar su plan aquí:
👉 https://app.estradox.com/dashboard/suscripcion

Si necesita unos días más para decidir o tiene alguna duda, respóndame y le ayudo.

Si no le interesa, me dice y no le escribo más.`;

const ASUNTO_CORREO_CON = "Sus procesos ya no se están vigilando";
const TEXTO_CORREO_CON = `Hola, {nombre}:

Le escribe Manuela, de Estradox. Su prueba gratis terminó **{fecha}**. Durante este mes vigilamos sus **{procesos}** en la Rama Judicial y en los estados electrónicos{novedades}. Desde que terminó, ya no los estamos revisando.

Quería preguntarle: ¿qué le pareció? ¿Hubo algo que le faltó o que no funcionó como esperaba? Su opinión nos ayuda mucho.

Si quiere seguir recibiendo cada mañana el resumen de estados y actuaciones nuevas, active su plan:

{boton:👉 Activar mi plan|https://app.estradox.com/dashboard/suscripcion}

Si necesita unos días más para decidir o tiene alguna duda, escríbame por WhatsApp y le ayudo:

{boton:💬 Escribirle a Manuela por WhatsApp|{whatsapp}}

Manuela, de Estradox`;

/** Línea comercial (la que vincula el worker); por si aún no está guardada. */
const COMERCIAL_RESPALDO = "573013335444";
const SALUDO_WA = "Hola, Manuela. Quiero activar mis 15 días en Estradox.";

async function enlaceWhatsappComercial(saludo = SALUDO_WA) {
  const [r] = await prisma.$queryRawUnsafe<{ numero: string | null }[]>(
    `SELECT numero FROM "WaEstado" WHERE cuenta = 'comercial'`,
  );
  const numero = (r?.numero ?? "").replace(/\D/g, "") || COMERCIAL_RESPALDO;
  return `https://wa.me/${numero}?text=${encodeURIComponent(saludo)}`;
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
  await ensureColumn("User", "desactivadoAt", "TIMESTAMPTZ");
  const { ensureMobileNoticeTable } = await import("./push");
  await ensureMobileNoticeTable();
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
     WHERE role <> 'admin' AND NOT es_socio AND NOT "marketingOptOut" AND "desactivadoAt" IS NULL
       AND (coalesce("whatsapp", '') <> '' OR "emailVerified" IS NOT NULL)
       AND hasta <= now() - make_interval(days => $3::int)
       AND hasta >= now() - make_interval(days => $4::int)
       AND NOT EXISTS (SELECT 1 FROM "Case" c WHERE c."userId" = s.id)
       AND NOT EXISTS (SELECT 1 FROM "WaMensaje" m WHERE m."userId" = s.id AND m.tipo = $5)
       AND NOT EXISTS (SELECT 1 FROM "CorreoCola" c WHERE c."userId" = s.id AND c.campana = $5)
       AND NOT EXISTS (SELECT 1 FROM "MobileNotice" n WHERE n."userId" = s.id AND n.tag = $5)
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

type ConProcesos = Candidato & { hasta: Date; procesos: number; novedades: number };

/** Prueba vencida (nunca pagó) con al menos 1 proceso: lo de "vencidoConProcesos". */
export async function candidatosVencidoConProcesos(): Promise<ConProcesos[]> {
  const { asegurarTablasWa } = await import("./whatsapp");
  const { asegurarCola } = await import("./campanas");
  await Promise.all([asegurarTablasWa(), asegurarCola()]);
  await ensureColumn("User", "marketingOptOut", "BOOLEAN NOT NULL DEFAULT false");
  await ensureColumn("User", "desactivadoAt", "TIMESTAMPTZ");
  const { ensureMobileNoticeTable } = await import("./push");
  await ensureMobileNoticeTable();
  const { getPlan } = await import("./subscription");
  const { diasPrueba } = await getPlan();
  const filas = await prisma.$queryRawUnsafe<(Candidato & { hasta: Date })[]>(
    `WITH s AS (
       SELECT u.*, coalesce(u.socio, false) AS es_socio,
              coalesce(u."trialEndsAt", greatest(u."createdAt", $1::timestamptz) + make_interval(days => $2::int)) AS hasta
       FROM "User" u
       WHERE u."paidUntil" IS NULL
     )
     SELECT id, email, "emailVerified", "firstName", name, "whatsapp", hasta FROM s
     WHERE role <> 'admin' AND NOT es_socio AND NOT "marketingOptOut" AND "desactivadoAt" IS NULL
       AND (coalesce("whatsapp", '') <> '' OR "emailVerified" IS NOT NULL)
       AND hasta <= now() - make_interval(days => $3::int)
       AND hasta >= now() - make_interval(days => $4::int)
       AND NOT EXISTS (SELECT 1 FROM "WaMensaje" m WHERE m."userId" = s.id AND m.tipo = $5)
       AND NOT EXISTS (SELECT 1 FROM "CorreoCola" c WHERE c."userId" = s.id AND c.campana = $5)
       AND NOT EXISTS (SELECT 1 FROM "MobileNotice" n WHERE n."userId" = s.id AND n.tag = $5)
     ORDER BY hasta DESC`,
    LANZAMIENTO,
    diasPrueba,
    DESDE_DIAS,
    HASTA_DIAS,
    CAMPANA_VENCIDO_CON_PROCESOS,
  );
  const { conteoProcesosPorUsuario } = await import("./estados");
  const conteo = await conteoProcesosPorUsuario(filas.map((f) => f.id));
  const con = filas.filter((f) => (conteo.get(f.id) ?? 0) > 0).slice(0, MAX_DIA);
  if (con.length === 0) return [];
  // Novedades avisadas en la prueba: actuaciones que aparecieron después de cargar
  // el proceso (no las viejas que trajo la carga) + hallazgos en estados electrónicos.
  const nov = await prisma.$queryRawUnsafe<{ userId: string; n: number }[]>(
    `SELECT x."userId", sum(x.n)::int AS n FROM (
       SELECT c."userId", count(*)::int AS n FROM "Actuacion" a JOIN "Case" c ON c.id = a."caseId"
        WHERE c."userId" = ANY($1::text[]) AND a."createdAt" > c."createdAt" + interval '1 hour'
        GROUP BY 1
       UNION ALL
       SELECT h."userId", count(*)::int FROM "EstadoHallazgo" h WHERE h."userId" = ANY($1::text[]) GROUP BY 1
     ) x GROUP BY 1`,
    con.map((c) => c.id),
  ).catch(() => []);
  const novDe = new Map(nov.map((r) => [r.userId, Number(r.n)]));
  return con.map((c) => ({ ...c, procesos: conteo.get(c.id) ?? 0, novedades: novDe.get(c.id) ?? 0 }));
}

function ponerCon(texto: string, u: ConProcesos) {
  const dia = (d: Date) => d.toLocaleDateString("es-CO", { day: "numeric", month: "long", timeZone: "America/Bogota" });
  const fecha = dia(new Date(u.hasta)) === dia(new Date()) ? "hoy" : `el ${dia(new Date(u.hasta))}`;
  const procesos = u.procesos === 1 ? "1 proceso" : `${u.procesos} procesos`;
  const novedades =
    u.novedades > 0 ? `, y le avisamos de ${u.novedades === 1 ? "1 novedad" : `${u.novedades} novedades`} (actuaciones y estados)` : "";
  return poner(texto, palabra(u.firstName) || palabra(u.name))
    .replace(/\{fecha\}/g, fecha)
    .replace(/\{procesos\}/g, procesos)
    .replace(/\{novedades\}/g, novedades);
}

export async function enviarCampanaVencidoSinProcesos() {
  const { esDiaHabil } = await import("./dias-habiles");
  if (!esDiaHabil(new Date(Date.now() - 5 * 60 * 60 * 1000))) return { omitido: "día no hábil" };
  await ensureColumn("SiteSetting", "vencidoSinProcesosFecha", "TEXT");
  const { hoyBogota } = await import("./reporte-whatsapp");
  const horaB = new Date().toLocaleString("en-US", { timeZone: "America/Bogota", hour: "2-digit", hour12: false });
  const hoy = `${hoyBogota()} ${horaB}`;
  const [s] = await prisma.$queryRawUnsafe<{ f: string | null }[]>(
    `SELECT "vencidoSinProcesosFecha" AS f FROM "SiteSetting" WHERE id = 'site'`,
  );
  if (s?.f === hoy) return { omitido: "ya revisado esta hora" };

  const elegidos = await candidatosVencidoSinProcesos();
  const { encolarWhatsapp } = await import("./whatsapp");
  const { correoHtml, correoTexto } = await import("./campanas");
  const { sendPushToUser } = await import("./push");
  const enlaceWa = await enlaceWhatsappComercial();
  let whatsapp = 0;
  let correos = 0;
  let push = 0;
  const notificar = async (userId: string, title: string, body: string, tag: string) => {
    // Queda en la campana (web y app Android) y llega como push a sus dispositivos.
    const r = await sendPushToUser(userId, { title, body, url: "/dashboard/suscripcion", tag }).catch(() => null);
    if (r) push++;
  };
  const { esCuentaVaciaDuplicada } = await import("./whatsapp");
  for (const u of elegidos) {
    // Se registró dos veces y la otra cuenta (mismo celular) sí tiene procesos.
    if (await esCuentaVaciaDuplicada(u.id).catch(() => false)) continue;
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
    await notificar(
      u.id,
      "¿Qué pasó con tu prueba?",
      "Tu prueba terminó sin procesos cargados. Escríbenos y te activamos 15 días más para probar con calma; si nos mandas tus radicados, los cargamos por ti.",
      CAMPANA_VENCIDO_SIN_PROCESOS,
    );
  }
  // Con procesos: qué vigilamos, qué le pareció y cómo seguir.
  const conProcesos = await candidatosVencidoConProcesos();
  const enlaceWaCon = await enlaceWhatsappComercial("Hola, Manuela. Tengo una pregunta sobre mi plan de Estradox.");
  for (const u of conProcesos) {
    const telefono = (u.whatsapp ?? "").replace(/\D/g, "");
    if (telefono) {
      whatsapp += await encolarWhatsapp([
        { tipo: CAMPANA_VENCIDO_CON_PROCESOS, userId: u.id, telefono, mensaje: ponerCon(TEXTO_WA_VENCIDO_CON_PROCESOS, u) },
      ]);
    }
    if (u.emailVerified) {
      const texto = ponerCon(TEXTO_CORREO_CON, u).replace("{whatsapp}", enlaceWaCon);
      correos += await prisma.$executeRawUnsafe(
        `INSERT INTO "CorreoCola" (campana, "userId", para, asunto, html, texto)
         SELECT $1, $2, $3, $4, $5, $6
         WHERE NOT EXISTS (SELECT 1 FROM "CorreoCola" WHERE campana = $1 AND "userId" = $2)`,
        CAMPANA_VENCIDO_CON_PROCESOS,
        u.id,
        u.email,
        ASUNTO_CORREO_CON,
        correoHtml(texto),
        correoTexto(texto),
      );
    }
    const pr = u.procesos === 1 ? "tu proceso" : `tus ${u.procesos} procesos`;
    const nv = u.novedades > 0 ? ` y te avisamos de ${u.novedades === 1 ? "1 novedad" : `${u.novedades} novedades`}` : "";
    await notificar(
      u.id,
      "Tu prueba terminó: tus procesos ya no se vigilan",
      `Vigilamos ${pr}${nv}. Activa tu plan para seguir recibiendo el resumen de las 7:00 a. m.`,
      CAMPANA_VENCIDO_CON_PROCESOS,
    );
  }
  // Se marca al final: si algo falla antes, la próxima corrida lo reintenta.
  await prisma.$executeRawUnsafe(`UPDATE "SiteSetting" SET "vencidoSinProcesosFecha" = $1 WHERE id = 'site'`, hoy);
  return { sinProcesos: elegidos.length, conProcesos: conProcesos.length, whatsapp, correos, push };
}
