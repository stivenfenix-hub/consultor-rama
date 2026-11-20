import "server-only";
import { prisma } from "./db";
import { ensureColumn } from "./runtime-columns";
import { esDiaHabil } from "./dias-habiles";

// ---------- Estados electrónicos (Publicaciones Procesales) ----------
// Muchos juzgados publican sus estados solo en publicacionesprocesales.ramajudicial.gov.co,
// como PDF con todos los procesos del día: por eso hay radicados que no aparecen
// en la Consulta Nacional. Aquí se revisan las publicaciones del despacho de cada
// radicado vigilado, se leen los PDF y se busca el radicado (completo o
// "2026-00894", como lo escriben los juzgados).
//
// El portal es lento (una búsqueda tarda ~4 min y a veces da 504). Desde el
// 7 nov 2026 es para TODOS los usuarios (el root puede apagarlo a alguno) y lo
// corre el VPS (estados-worker), con su propia IP, no Hostinger. Desde el 18 nov
// 2026 revisa las 24 horas en ciclos que empiezan a las 6 p. m. de cada día hábil
// (y siguen hasta las 6 p. m. del día siguiente): cada despacho una vez por ciclo,
// solo su último estado, al mismo ritmo pausado y con los mismos topes por hora.
// Los pedidos (radicados recién agregados, "Actualizar") se atienden siempre.

const BASE = "https://publicacionesprocesales.ramajudicial.gov.co";
const PORTLET = "co_com_avanti_efectosProcesales_PublicacionesEfectosProcesalesPortletV2_INSTANCE_BIyXQFHVaYaq";
const NS = `_${PORTLET}`;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const DIAS_ATRAS = 7; // ventana de búsqueda (de ahí solo se toma el último estado)
const NOCHE_DESDE = 18 * 60; // 6:00 p. m. (minutos, hora de Bogotá): inicio de cada ciclo
// En el VPS se ajustan con variables de entorno (ver estados-worker).
const DESPACHOS_POR_CORRIDA = Number(process.env.ESTADOS_DESPACHOS_POR_CORRIDA) || 2;
/**
 * Pausa al azar entre un despacho y otro (como una persona, no un robot).
 * Por defecto 15 a 25 s (19 nov 2026; antes 15 a 35 y 20 a 60 s): se va ajustando para encontrar el equilibrio con el portal.
 */
const PAUSA_MIN_MS = Number(process.env.ESTADOS_PAUSA_MIN_MS) || 15_000;
const PAUSA_MAX_MS = Math.max(PAUSA_MIN_MS, Number(process.env.ESTADOS_PAUSA_MAX_MS) || 25_000);
const PRESUPUESTO_MS = 15 * 60 * 1000;
/** Documentos por publicación: todos (tope de seguridad 300); a cambio, se descargan más despacio (ver PAUSA_PDF). */
const MAX_ARCHIVOS = Number(process.env.ESTADOS_MAX_ARCHIVOS) || 300;
/** Pausa al azar entre un PDF y otro (19 nov 2026: 2 a 6 s, antes ese día 3 a 7 s; 18 nov: 4 a 8 s). */
const PAUSA_PDF_MIN_MS = Number(process.env.ESTADOS_PAUSA_PDF_MIN_MS) || 2_000;
const PAUSA_PDF_MAX_MS = Math.max(PAUSA_PDF_MIN_MS, Number(process.env.ESTADOS_PAUSA_PDF_MAX_MS) || 6_000);
/**
 * Topes de la revisión (18 nov 2026, tras el bloqueo del VPS por volumen):
 * juzgados revisados por hora y por ciclo de 24 h, contando los pedidos. Antes
 * del bloqueo se hacían 60-120 por hora; ahora máximo la mitad. 45 x 24 = 1.080.
 */
/** Tope de juzgados por hora (19 nov 2026: 90; antes 45). Si sale un 403, volver a 45. */
const TOPE_HORA = Number(process.env.ESTADOS_TOPE_HORA) || 90;
const TOPE_CICLO = Number(process.env.ESTADOS_TOPE_DIA) || 1080;
const MAX_TEXTO_ARCHIVO = 60_000;

// Una sola preparación por proceso, aunque lleguen varias páginas a la vez al arrancar.
let tablasListas: Promise<void> | null = null;
function asegurarTablas() {
  tablasListas ??= crearTablas().catch((e) => {
    tablasListas = null;
    throw e;
  });
  return tablasListas;
}

async function crearTablas() {
  await ensureColumn("User", "estadosActivo", "BOOLEAN NOT NULL DEFAULT true");
  // Estados para todos (7 nov 2026): los nuevos usuarios lo tienen activo y,
  // una sola vez, se activa a todos los que ya existían. El ALTER va aquí
  // dentro porque bloquea la tabla User: no debe correr en cada arranque.
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "EstadoMigracion" (id TEXT PRIMARY KEY, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const [primera] = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO "EstadoMigracion" (id) VALUES ('todos-activos') ON CONFLICT DO NOTHING RETURNING id`,
  );
  if (primera) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "User" ALTER COLUMN "estadosActivo" SET DEFAULT true`);
    await prisma.$executeRawUnsafe(`UPDATE "User" SET "estadosActivo" = true WHERE NOT "estadosActivo"`);
  }
  // Bloqueos del portal por salida (vps / hostinger): ver "Freno ante bloqueos".
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "EstadoBloqueo" (
      salida TEXT PRIMARY KEY,
      desde TIMESTAMPTZ NOT NULL DEFAULT now(),
      hasta TIMESTAMPTZ NOT NULL,
      intentos INTEGER NOT NULL DEFAULT 1,
      status INTEGER,
      levantado TIMESTAMPTZ,
      "avisadoAt" TIMESTAMPTZ
    )`);
  // Revisiones que la app (Hostinger) hace directo cuando el VPS está bloqueado (tope diario).
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "EstadoUsoDirecto" (dia DATE PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "EstadoDespacho" (
      despacho TEXT PRIMARY KEY,
      "revisadoAt" TIMESTAMPTZ,
      "ultimoError" TEXT,
      publicaciones INTEGER NOT NULL DEFAULT 0
    )`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "EstadoPublicacion" (
      id TEXT PRIMARY KEY,
      despacho TEXT NOT NULL,
      titulo TEXT NOT NULL,
      fecha DATE,
      archivos JSONB NOT NULL DEFAULT '[]',
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "EstadoDespacho" ADD COLUMN IF NOT EXISTS "errorAt" TIMESTAMPTZ`);
  // Pedido de revisión fuera de la noche (un abogado en prueba agregó un radicado de ese despacho).
  await prisma.$executeRawUnsafe(`ALTER TABLE "EstadoDespacho" ADD COLUMN IF NOT EXISTS "pedidoAt" TIMESTAMPTZ`);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "EstadoPublicacion_despacho" ON "EstadoPublicacion" (despacho, fecha)`,
  );
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "EstadoHallazgo" (
      id SERIAL PRIMARY KEY,
      "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
      radicado TEXT NOT NULL,
      "publicacionId" TEXT NOT NULL REFERENCES "EstadoPublicacion"(id) ON DELETE CASCADE,
      archivo TEXT,
      url TEXT,
      extracto TEXT,
      visto BOOLEAN NOT NULL DEFAULT false,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE ("userId", radicado, "publicacionId")
    )`);
  // Radicados que el abogado quitó de estados (no se vigilan hasta que lo vuelva a agregar).
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "EstadoQuitado" (
      "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
      radicado TEXT NOT NULL,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY ("userId", radicado)
    )`);
  // Hallazgos por avisar: salen en el mismo resumen de las actuaciones
  // (correo, WhatsApp y notificación), no en un aviso aparte de noche.
  await ensureColumn("EstadoHallazgo", "porAvisar", "BOOLEAN NOT NULL DEFAULT false");
  // Todos los documentos de la publicación donde está el radicado; archivo/url es el primero.
  await ensureColumn("EstadoHallazgo", "documentos", "JSONB");
}

export type EstadoPorAvisar = {
  id: number;
  userId: string;
  radicado: string;
  titulo: string;
  fecha: Date | null;
  extracto: string | null;
};

/** Hallazgos de estados que aún no se han avisado en el resumen (y no ha visto). */
export async function estadosPorAvisar(): Promise<EstadoPorAvisar[]> {
  await asegurarTablas();
  return prisma.$queryRawUnsafe<EstadoPorAvisar[]>(
    `SELECT h.id, h."userId", h.radicado, p.titulo, p.fecha, h.extracto
     FROM "EstadoHallazgo" h JOIN "EstadoPublicacion" p ON p.id = h."publicacionId"
     WHERE h."porAvisar" AND NOT h.visto
     ORDER BY h."userId", h.radicado, p.fecha DESC NULLS LAST`,
  );
}

/** Marca como avisados (todos los del usuario, incluidos los ya vistos). */
export async function marcarEstadosAvisados(userId: string) {
  await prisma.$executeRawUnsafe(
    `UPDATE "EstadoHallazgo" SET "porAvisar" = false WHERE "userId" = $1 AND "porAvisar"`,
    userId,
  );
}

const despachoDe = (radicado: string) => radicado.slice(0, 12);

// ---------- Quién vigila qué ----------
/** Radicados vigilados: los procesos del usuario y los que intentó agregar (aunque la Rama no los tenga). */
async function seguimientos(filtro: { despacho?: string; userId?: string } = {}) {
  await asegurarTablas();
  // Las páginas de un abogado piden solo lo suyo (antes traían los de todos).
  const deUsuario = filtro.userId ? `AND u.id = $1` : "";
  const filas = await prisma.$queryRawUnsafe<{ userId: string; radicado: string }[]>(
    `SELECT DISTINCT r."userId", r.radicado FROM (
       SELECT c."userId", c.radicado FROM "Case" c JOIN "User" u ON u.id = c."userId" WHERE u."estadosActivo" ${deUsuario}
       UNION
       SELECT cp."userId", (regexp_matches(
         coalesce(cp.radicados, '') || ' ' || coalesce(cp.error, '') || ' ' || coalesce(cp.ok, ''), '\\d{23}', 'g'))[1]
       FROM "CargaProcesos" cp JOIN "User" u ON u.id = cp."userId" WHERE u."estadosActivo" ${deUsuario}
     ) r
     WHERE NOT EXISTS (SELECT 1 FROM "EstadoQuitado" q WHERE q."userId" = r."userId" AND q.radicado = r.radicado)`,
    ...(filtro.userId ? [filtro.userId] : []),
  );
  return filtro.despacho ? filas.filter((f) => despachoDe(f.radicado) === filtro.despacho) : filas;
}

/**
 * El abogado quita un radicado de estados: deja de vigilarse y se borran sus
 * hallazgos. Si es un proceso de la Rama, el proceso sigue igual en su lista.
 */
export async function dejarDeVigilar(userId: string, radicado: string) {
  await asegurarTablas();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "EstadoQuitado" ("userId", radicado) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    userId,
    radicado,
  );
  await prisma.$executeRawUnsafe(`DELETE FROM "EstadoHallazgo" WHERE "userId" = $1 AND radicado = $2`, userId, radicado);
}

/**
 * Cuántos radicados vigila el abogado SOLO en estados (no están en su lista de
 * la Rama). Cuentan para los procesos incluidos del plan y los adicionales.
 */
export async function contarSoloEstados(userId: string): Promise<number> {
  return (await radicadosSoloEstados(userId)).length;
}

/** Radicados del usuario que solo están en estados electrónicos (no en la Consulta Nacional). */
export async function radicadosSoloEstados(userId: string): Promise<string[]> {
  if (!(await estadosActivo(userId))) return [];
  const filas = await prisma.$queryRawUnsafe<{ rad: string }[]>(
    `SELECT DISTINCT x.rad FROM (
       SELECT (regexp_matches(
         coalesce(cp.radicados, '') || ' ' || coalesce(cp.error, '') || ' ' || coalesce(cp.ok, ''), '\\d{23}', 'g'))[1] AS rad
       FROM "CargaProcesos" cp WHERE cp."userId" = $1
     ) x
     WHERE NOT EXISTS (SELECT 1 FROM "Case" c WHERE c."userId" = $1 AND c.radicado = x.rad)
       AND NOT EXISTS (SELECT 1 FROM "EstadoQuitado" q WHERE q."userId" = $1 AND q.radicado = x.rad)`,
    userId,
  );
  return filas.map((f) => f.rad);
}

/**
 * Procesos de cada usuario (tabla de Usuarios del root): radicados de la Rama
 * más los que solo están en estados. Un radicado cuenta una vez, igual que en
 * el Dashboard y en el plan.
 */
export async function conteoProcesosPorUsuario(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  await asegurarTablas();
  const filas = await prisma.$queryRawUnsafe<{ userId: string; n: bigint }[]>(
    `SELECT r."userId", count(DISTINCT r.radicado) AS n FROM (
       SELECT c."userId", c.radicado FROM "Case" c WHERE c."userId" = ANY($1::text[])
       UNION
       SELECT cp."userId", (regexp_matches(
         coalesce(cp.radicados, '') || ' ' || coalesce(cp.error, '') || ' ' || coalesce(cp.ok, ''), '\\d{23}', 'g'))[1]
       FROM "CargaProcesos" cp JOIN "User" u ON u.id = cp."userId"
       WHERE cp."userId" = ANY($1::text[]) AND u."estadosActivo"
     ) r
     WHERE EXISTS (SELECT 1 FROM "Case" c WHERE c."userId" = r."userId" AND c.radicado = r.radicado)
        OR NOT EXISTS (SELECT 1 FROM "EstadoQuitado" q WHERE q."userId" = r."userId" AND q.radicado = r.radicado)
     GROUP BY r."userId"`,
    ids,
  );
  return new Map(filas.map((f) => [f.userId, Number(f.n)]));
}

export async function estadosActivo(userId: string): Promise<boolean> {
  try {
    await asegurarTablas();
    const [r] = await prisma.$queryRawUnsafe<{ v: boolean }[]>(
      `SELECT "estadosActivo" AS v FROM "User" WHERE id = $1`,
      userId,
    );
    return !!r?.v;
  } catch {
    return false;
  }
}

export async function cambiarEstadosActivo(userId: string, valor: boolean) {
  await asegurarTablas();
  await prisma.$executeRawUnsafe(`UPDATE "User" SET "estadosActivo" = $2 WHERE id = $1`, userId, valor);
}

// ---------- Portal ----------
// ---------- Freno ante bloqueos del portal ----------
// El 16 nov 2026 el firewall (Azure) del portal bloqueó la IP del VPS con 403 y el
// servicio siguió insistiendo cada minuto. Ahora, al primer 403/429, esa salida
// (VPS u Hostinger) deja de consultar 6 horas; luego prueba UNA consulta cada 3 horas
// hasta que el portal vuelva a responder (una cada 3 h). El root recibe aviso (campanita y push).

/** Desde dónde se consulta el portal: "vps" (servicio de estados) u "hostinger" (la app). */
export const SALIDA_ESTADOS = process.env.ESTADOS_SALIDA?.trim() || "hostinger";
/** Primer 403: espera corta (puede ser un error suelto del portal). */
const ESPERA_CORTA_MIN = 10;
const PAUSA_BLOQUEO_H = 6;
const REPRUEBA_H = 3;

let cacheBloqueo: { hasta: Date | null; hay: boolean; leido: number } | null = null;

/** Bloqueo de una salida: `hasta` en el futuro = en pausa; en el pasado = toca probar. */
export async function bloqueoPortal(salida = SALIDA_ESTADOS) {
  await asegurarTablas();
  const [b] = await prisma.$queryRawUnsafe<
    { hasta: Date; desde: Date; intentos: number; status: number; levantado: Date | null }[]
  >(`SELECT hasta, desde, intentos, status, levantado FROM "EstadoBloqueo" WHERE salida = $1`, salida);
  return b ?? null;
}

async function pausadoHasta(): Promise<Date | null> {
  if (cacheBloqueo && Date.now() - cacheBloqueo.leido < 30_000) {
    return cacheBloqueo.hasta && cacheBloqueo.hasta.getTime() > Date.now() ? cacheBloqueo.hasta : null;
  }
  const b = await bloqueoPortal();
  cacheBloqueo = { hasta: b ? new Date(b.hasta) : null, hay: !!b && !b.levantado, leido: Date.now() };
  return b && new Date(b.hasta).getTime() > Date.now() ? new Date(b.hasta) : null;
}

async function registrarBloqueo(status: number) {
  // Escalera (18 nov 2026):
  //  1er 403 (sin bloqueo vigente): espera corta de 10 min y reintenta (puede ser un error suelto).
  //  2º 403 seguido: bloqueo real -> pausa de 6 h y aviso al root.
  //  Después: una prueba cada 3 h hasta que responda.
  const [b] = await prisma.$queryRawUnsafe<{ hasta: Date; intentos: number }[]>(
    `INSERT INTO "EstadoBloqueo" (salida, desde, hasta, intentos, status)
     VALUES ($1, now(), now() + ($2 || ' minutes')::interval, 1, $5)
     ON CONFLICT (salida) DO UPDATE SET
       desde = CASE WHEN "EstadoBloqueo".levantado IS NOT NULL THEN now() ELSE "EstadoBloqueo".desde END,
       hasta = now() + (CASE
                 WHEN "EstadoBloqueo".levantado IS NOT NULL THEN $2 || ' minutes'
                 WHEN "EstadoBloqueo".intentos = 1 THEN $3 || ' hours'
                 ELSE $4 || ' hours' END)::interval,
       intentos = CASE WHEN "EstadoBloqueo".levantado IS NOT NULL THEN 1 ELSE "EstadoBloqueo".intentos + 1 END,
       "avisadoAt" = CASE WHEN "EstadoBloqueo".levantado IS NOT NULL THEN NULL ELSE "EstadoBloqueo"."avisadoAt" END,
       levantado = NULL,
       status = $5
     RETURNING hasta, intentos`,
    SALIDA_ESTADOS,
    String(ESPERA_CORTA_MIN),
    String(PAUSA_BLOQUEO_H),
    String(REPRUEBA_H),
    status,
  );
  cacheBloqueo = { hasta: b ? new Date(b.hasta) : null, hay: true, leido: Date.now() };
  console.error(
    `[estados] portal respondió ${status} a la salida ${SALIDA_ESTADOS} (intento ${b?.intentos}); en pausa hasta ${b?.hasta?.toISOString()}`,
  );
}

async function levantarBloqueo() {
  if (cacheBloqueo && !cacheBloqueo.hay && Date.now() - cacheBloqueo.leido < 30_000) return;
  const n = await prisma.$executeRawUnsafe(
    `UPDATE "EstadoBloqueo" SET levantado = now() WHERE salida = $1 AND levantado IS NULL`,
    SALIDA_ESTADOS,
  );
  if (n) {
    // Queda el registro (levantado) para avisar al root que volvió; el cron lo borra después del aviso.
    console.log(`[estados] el portal volvió a responder a la salida ${SALIDA_ESTADOS}`);
  }
  cacheBloqueo = { hasta: null, hay: false, leido: Date.now() };
}

const azar = (min: number, max: number) => min + Math.random() * (max - min);
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function traer(url: string, ms: number) {
  const hasta = await pausadoHasta();
  if (hasta) throw new Error(`Pausa por bloqueo del portal hasta ${hasta.toISOString()}`);
  const r = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "es-CO,es;q=0.9", Accept: "text/html,application/pdf,*/*" },
    signal: AbortSignal.timeout(ms),
  });
  if (r.status === 403 || r.status === 429) {
    await registrarBloqueo(r.status);
    throw new Error(`Publicaciones Procesales respondió ${r.status}`);
  }
  if (!r.ok) throw new Error(`Publicaciones Procesales respondió ${r.status}`);
  if (cacheBloqueo?.hay !== false) await levantarBloqueo().catch(() => {});
  return r;
}

const fechaISO = (d: Date) => d.toISOString().slice(0, 10);

type Item = { id: string; titulo: string; fecha: string | null };

/** Publicaciones del despacho entre dos fechas (todas las clases: estados, traslados, etc.). */
async function buscarPublicaciones(
  despacho: string,
  desde: Date,
  hasta: Date,
  porPagina = 75,
  timeoutMs = 290_000,
): Promise<Item[]> {
  const p = new URLSearchParams({
    p_p_id: PORTLET,
    p_p_lifecycle: "0",
    p_p_state: "normal",
    p_p_mode: "view",
    [`${NS}_action`]: "busqueda",
    [`${NS}_idDespacho`]: despacho,
    [`${NS}_fechaInicio`]: fechaISO(desde),
    [`${NS}_fechaFin`]: fechaISO(hasta),
    // La lista viene paginada de a 10; se piden más por página.
    [`${NS}_delta`]: String(porPagina),
    [`${NS}_cur`]: "1",
  });
  const html = await (await traer(`${BASE}/web/publicaciones-procesales/inicio?${p}`, timeoutMs)).text();
  const items = new Map<string, Item>();
  const re = /href="[^"]*detail\.jsp[^"]*?articleId=(\d+)[^"]*"[^>]*title="Ver ([^"]+)"/g;
  for (const m of html.matchAll(re)) {
    if (items.has(m[1])) continue;
    const resto = html.slice(m.index ?? 0, (m.index ?? 0) + 4000);
    const f = /Fecha de Publicaci[^:]*:\s*(?:<[^>]*>\s*)*(\d{4}-\d{2}-\d{2})/.exec(resto);
    items.set(m[1], { id: m[1], titulo: decodificar(m[2]).trim(), fecha: f?.[1] ?? null });
  }
  return [...items.values()];
}

// El 504 lo da el propio portal cuando su servidor interno se demora: esperar
// más no sirve. Se reintenta una sola vez, casi enseguida, con una búsqueda más
// liviana; si vuelve a fallar se pasa al siguiente juzgado (este se reintenta en
// ~1 hora). 19 nov 2026: antes eran 2 reintentos con 45 y 60 s de espera
// (hasta ~10 min perdidos por cada 504).
// 19 nov: el reintento tenía 90 s y el portal, de día, a veces tarda más: 180 s.
const REINTENTOS_LIVIANOS = [{ esperaMs: 10_000, dias: 3, porPagina: 20, timeoutMs: 180_000 }];

/**
 * Un 4xx no mejora reintentando; un timeout, un corte de red u otro 5xx sí.
 * 19 nov 2026: el 504 tampoco se reintenta. Cada reintento costaba ~2 min y casi
 * nunca salía bien; el juzgado vuelve a la cola en 1 hora (errorAt) y se sigue con otro.
 */
const vale_reintentar = (e: unknown) => !/respondió (4\d\d|504)/.test(e instanceof Error ? e.message : String(e));

/** Busca las publicaciones del despacho; si el portal falla, reintenta con menos días y resultados. */
export async function buscarConReintentos(despacho: string): Promise<Item[]> {
  const hasta = new Date(Date.now() + 2 * 86400_000); // hay estados con fecha futura (se fijan al día hábil siguiente)
  const hace = (dias: number) => new Date(Date.now() - dias * 86400_000);
  try {
    return await buscarPublicaciones(despacho, hace(DIAS_ATRAS), hasta);
  } catch (primero) {
    if (!vale_reintentar(primero)) throw primero;
    let ultimo = primero;
    for (const r of REINTENTOS_LIVIANOS) {
      console.log(`[estados] ${despacho}: ${ultimo instanceof Error ? ultimo.message : ultimo}; reintento liviano`);
      await new Promise((ok) => setTimeout(ok, r.esperaMs));
      try {
        return await buscarPublicaciones(despacho, hace(r.dias), hasta, r.porPagina, r.timeoutMs);
      } catch (e) {
        if (!vale_reintentar(e)) throw e;
        ultimo = e;
      }
    }
    throw ultimo;
  }
}

function decodificar(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

type Archivo = { nombre: string; url: string; texto: string; imagen?: boolean };
/** Un documento de un hallazgo (la planilla del estado, un auto, o la página). */
export type DocEstado = { nombre: string; url: string };

let avanceListo = false;
/**
 * Avance en vivo (20 nov 2026): qué juzgado se está revisando y, si está bajando
 * PDFs, en cuál va. Lo muestra el Panel admin para distinguir "trabajando" de "trabado".
 */
async function marcarAvance(despacho: string, pdf?: { i: number; total: number; fecha: string | null }) {
  try {
    if (!avanceListo) {
      await prisma.$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS "EstadoAvance" (id INTEGER PRIMARY KEY, despacho TEXT, fecha TEXT, pdf INTEGER, total INTEGER, "at" TIMESTAMPTZ)`,
      );
      avanceListo = true;
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO "EstadoAvance" (id, despacho, fecha, pdf, total, "at") VALUES (1, $1, $2, $3, $4, now())
       ON CONFLICT (id) DO UPDATE SET despacho = $1, fecha = $2, pdf = $3, total = $4, "at" = now()`,
      despacho,
      pdf?.fecha ?? null,
      pdf ? pdf.i : null,
      pdf ? pdf.total : null,
    );
  } catch {
    // Solo informativo: si falla, la revisión sigue igual.
  }
}

/** Abre una publicación y lee el texto de sus archivos (y de la página misma). */
async function leerPublicacion(
  id: string,
  ctx?: { despacho: string; fecha: string | null },
): Promise<Archivo[]> {
  const rotulo = ctx ? `juzgado ${ctx.despacho}, estado del ${ctx.fecha ?? "?"}` : id;
  const p = new URLSearchParams({
    p_p_id: PORTLET,
    p_p_lifecycle: "0",
    p_p_state: "normal",
    p_p_mode: "view",
    [`${NS}_jspPage`]: "/META-INF/resources/detail.jsp",
    [`${NS}_articleId`]: id,
  });
  const urlPagina = `${BASE}/web/publicaciones-procesales/inicio?${p}`;
  const html = await (await traer(urlPagina, 120_000)).text();

  const archivos: Archivo[] = [];
  // Algunos juzgados escriben el estado en la página (tabla), no en un PDF.
  const cuerpo = html
    .replace(/<select[\s\S]*?<\/select>/g, " ")
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ");
  archivos.push({ nombre: "Página de la publicación", url: urlPagina, texto: sinNulos(decodificar(cuerpo)).slice(0, MAX_TEXTO_ARCHIVO) });

  const vistos = new Set<string>();
  const re = /<a[^>]*href="((?:\/c\/document_library\/get_file\?[^"]+)|(?:\/documents\/\d+\/\d+\/[^"]+))"[^>]*>([\s\S]*?)<\/a>/g;
  const enlaces: { ruta: string; m: RegExpMatchArray }[] = [];
  for (const m of html.matchAll(re)) {
    const ruta = decodificar(m[1]);
    if (ruta.startsWith("/documents/20135/") || vistos.has(ruta)) continue; // logos e instructivos del portal
    vistos.add(ruta);
    if (enlaces.length >= MAX_ARCHIVOS) break;
    enlaces.push({ ruta, m });
  }
  // Avance en el log (19 nov 2026): un estado grande puede tardar 20+ min y, sin
  // esto, el log del VPS no dice nada hasta que termina la corrida.
  const inicioLectura = Date.now();
  const grande = enlaces.length >= 10;
  if (grande) console.log(`[estados] ${rotulo}: leyendo ${enlaces.length} PDFs`);
  for (const [i, { ruta, m }] of enlaces.entries()) {
    if (grande && i > 0 && i % 25 === 0) console.log(`[estados] ${rotulo}: ${i} de ${enlaces.length} PDFs`);
    if (ctx) await marcarAvance(ctx.despacho, { i: i + 1, total: enlaces.length, fecha: ctx.fecha });
    const nombre = decodificar(m[2].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim() || "Documento";
    const url = BASE + ruta;
    try {
      const buf = new Uint8Array(await (await traer(url, 60_000)).arrayBuffer());
      const texto = await textoPdf(buf);
      archivos.push({ nombre, url, texto: sinNulos(texto).slice(0, MAX_TEXTO_ARCHIVO), imagen: texto.trim().length < 20 });
    } catch (e) {
      archivos.push({ nombre, url, texto: "" });
      // Bloqueado a mitad de la publicación: no sigue descargando.
      if (/respondió 40[39]|Pausa por bloqueo/.test(e instanceof Error ? e.message : String(e))) break;
    }
    // Pausa al azar entre un PDF y otro.
    await esperar(azar(PAUSA_PDF_MIN_MS, PAUSA_PDF_MAX_MS));
  }
  if (grande)
    console.log(
      `[estados] ${rotulo}: ${enlaces.length} PDFs leídos en ${Math.round((Date.now() - inicioLectura) / 60_000)} min`,
    );
  return archivos;
}

// Postgres no acepta el carácter nulo (\u0000) en JSONB/TEXT: un PDF con ese
// carácter impedía guardar toda la publicación.
const sinNulos = (s: string) => s.replace(/\u0000/g, "");

async function textoPdf(buf: Uint8Array): Promise<string> {
  // Solo PDF (%PDF): otros formatos (Word, imágenes) se dejan con el enlace.
  if (!(buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46)) return "";
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(buf, { verbosity: 0 });
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

// ---------- Buscar el radicado en el texto ----------
/** Dónde aparece el radicado: completo (23 dígitos, con o sin guiones) o "2026-00894". */
export function buscarRadicado(texto: string, radicado: string): number {
  // Completo: los 21 primeros dígitos (los 2 últimos cambian con la instancia), con o sin separadores.
  const completo = new RegExp(radicado.slice(0, 21).split("").join("[\\s.\\-–]*"));
  const c = completo.exec(texto);
  if (c) return c.index;
  // Corto: "2026-00894", "2026-894" o "2026 00894" (nombres de archivo). Al menos
  // 3 dígitos y sin otra fecha pegada, para no confundir "2026-10-30" con el 00010.
  const anio = radicado.slice(12, 16);
  const consecutivo = String(Number(radicado.slice(16, 21)));
  const corto = new RegExp(
    `(?<![\\d/])${anio}(?:\\s*[-–]\\s*|\\s+)(0{0,4}${consecutivo})(?![\\d/]|-\\d)`,
    "g",
  );
  for (const m of texto.matchAll(corto)) {
    const sep = m[0].slice(4, m[0].length - m[1].length);
    if (m[1].length < 3) continue;
    if (!/[-–]/.test(sep) && m[1].length !== 5) continue; // con espacio, solo la forma de 5 dígitos
    return m.index ?? 0;
  }
  return -1;
}

// Desde el radicado: antes viene la fila del proceso anterior de la planilla.
function extracto(texto: string, i: number) {
  return texto
    .slice(i, i + 320)
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- Corrida ----------
let lockListo = false;
async function tomarLock(minutos: number): Promise<boolean> {
  if (!lockListo) {
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "EstadoLock" (id INTEGER PRIMARY KEY, hasta TIMESTAMPTZ)`,
    );
    await prisma.$executeRawUnsafe(`INSERT INTO "EstadoLock" (id) VALUES (1) ON CONFLICT DO NOTHING`);
    lockListo = true;
  }
  const n = await prisma.$executeRawUnsafe(
    `UPDATE "EstadoLock" SET hasta = now() + ($1 || ' minutes')::interval
     WHERE id = 1 AND (hasta IS NULL OR hasta < now())`,
    String(minutos),
  );
  tengoLock = n > 0;
  return n > 0;
}

/** Este proceso tiene el candado (está en medio de una corrida). */
let tengoLock = false;

/** Al apagar el servicio (pm2 restart): suelta el candado si es suyo, para que el nuevo no espere 20 min. */
export async function soltarLockAlApagar() {
  if (tengoLock) await soltarLock();
}
async function soltarLock() {
  tengoLock = false;
  await prisma.$executeRawUnsafe(`UPDATE "EstadoLock" SET hasta = NULL WHERE id = 1`).catch(() => {});
}

/** Lo llama el cron cada 5 min: revisa los despachos que ya toca y avisa lo que encuentre. */
/** Inicio (6 p. m. de Bogotá) del ciclo de 24 h en curso. */
function inicioNoche(): Date {
  const BOG = 5 * 3600_000;
  const local = new Date(Date.now() - BOG);
  const m = local.getUTCHours() * 60 + local.getUTCMinutes();
  const dia = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const noche = dia + NOCHE_DESDE * 60_000 - (m < NOCHE_DESDE ? 86400_000 : 0);
  return new Date(noche + BOG);
}

/** ¿El ciclo en curso empezó la tarde de un día hábil? (sábado, domingo y festivos los juzgados no publican). */
function cicloHabil(): boolean {
  // 6 p. m. de Bogotá expresadas como fecha UTC del mismo día: sirve para esDiaHabil.
  return esDiaHabil(new Date(inicioNoche().getTime() - 5 * 3600_000));
}

/**
 * Lo llama el cron cada 5 min: revisa (24 h) los despachos que aún no se
 * revisaron en este ciclo. `forzar` (botón del root) corre ya, a cualquier
 * hora, todos los despachos de una vez (de a 2 en paralelo).
 */
export async function revisarEstados(opts: { forzar?: boolean } = {}) {
  // Ciclos que empiezan sábado, domingo o festivo no tienen revisión general
  // (los juzgados no publican); los pedidos de radicados recién agregados sí se atienden.
  const enCiclo = cicloHabil();
  await asegurarTablas();
  // Freno: si el portal bloqueó esta salida, no se consulta hasta que pase la pausa;
  // después, una sola consulta de prueba por vez hasta que vuelva a responder.
  const bloqueo = await bloqueoPortal();
  if (bloqueo && new Date(bloqueo.hasta).getTime() > Date.now() && !bloqueo.levantado) {
    return { omitido: `portal bloqueado (${bloqueo.status}); en pausa hasta ${new Date(bloqueo.hasta).toISOString()}` };
  }
  const probando = !!bloqueo && !bloqueo.levantado;
  // Fuera de un ciclo hábil solo se atienden los pedidos (radicados recién agregados).
  if (!opts.forzar && !enCiclo) {
    const [p] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM "EstadoDespacho" WHERE "pedidoAt" IS NOT NULL`,
    );
    if (Number(p?.n ?? 0) === 0) return { omitido: "ciclo no hábil (fin de semana o festivo)" };
  }
  // Topes: por hora (siempre) y por ciclo (solo la revisión general; los pedidos siguen).
  let cicloLleno = false;
  if (!opts.forzar) {
    const [t] = await prisma.$queryRawUnsafe<{ hora: bigint; noche: bigint }[]>(
      `SELECT count(*) FILTER (WHERE "revisadoAt" > now() - interval '1 hour') AS hora,
              count(*) FILTER (WHERE "revisadoAt" >= $1) AS noche
       FROM "EstadoDespacho"`,
      inicioNoche(),
    );
    if (Number(t?.hora ?? 0) >= TOPE_HORA) return { omitido: `tope por hora (${TOPE_HORA} juzgados)` };
    cicloLleno = Number(t?.noche ?? 0) >= TOPE_CICLO;
  }
  if (!(await tomarLock(opts.forzar ? 150 : 20))) return { omitido: "otra corrida en curso" };
  const inicio = Date.now();
  const info: Record<string, unknown>[] = [];
  try {
    const segs = await seguimientos();
    const despachos = [...new Set(segs.map((s) => despachoDe(s.radicado)))];
    if (despachos.length === 0) return { despachos: 0 };
    // Revisión por prioridad (18 nov 2026):
    //  - Pedidos (radicados nuevos, "Actualizar"): primero, siempre.
    //  - Nunca revisados, o activos (con publicaciones en su última revisión): cada ciclo.
    //  - Quietos (sin publicaciones): ciclo de por medio.
    const pendientes = opts.forzar
      ? despachos.map((despacho) => ({ despacho }))
      : await prisma.$queryRawUnsafe<{ despacho: string }[]>(
          `SELECT d.despacho FROM unnest($1::text[]) AS d(despacho)
           LEFT JOIN "EstadoDespacho" e ON e.despacho = d.despacho
           WHERE (e."pedidoAt" IS NOT NULL OR ($4 AND (
                    e."revisadoAt" IS NULL
                    OR (coalesce(e.publicaciones, 0) > 0 AND e."revisadoAt" < $2)
                    OR (coalesce(e.publicaciones, 0) = 0 AND e."revisadoAt" < $2::timestamptz - interval '24 hours'))))
             AND (e."errorAt" IS NULL OR e."errorAt" < now() - interval '1 hour')
           ORDER BY e."pedidoAt" NULLS LAST, (e."revisadoAt" IS NULL) DESC,
                    (coalesce(e.publicaciones, 0) > 0) DESC, e."revisadoAt" NULLS FIRST
           LIMIT $3`,
          despachos,
          inicioNoche(),
          probando ? 1 : DESPACHOS_POR_CORRIDA,
          enCiclo && !cicloLleno,
        );
    const presupuesto = opts.forzar ? 140 * 60_000 : PRESUPUESTO_MS;
    const cola = [...pendientes];
    const trabajador = async () => {
      for (let p = cola.shift(); p; p = cola.shift()) {
        if (Date.now() - inicio > presupuesto) break;
        info.push(await revisarDespacho(p.despacho));
        // Si en medio de la corrida el portal bloqueó, se para enseguida.
        if (await pausadoHasta()) break;
        // Ritmo humano: pausa al azar entre un juzgado y otro.
        if (cola.length) await esperar(azar(PAUSA_MIN_MS, PAUSA_MAX_MS));
      }
    };
    await Promise.all(opts.forzar ? [trabajador(), trabajador()] : [trabajador()]);
    return { despachos: despachos.length, revisados: info };
  } finally {
    await soltarLock();
  }
}

/** Resumen para el Panel admin: cómo va la revisión de estados del ciclo en curso (desde las 6 p. m.). */
export async function estadoEstadosNoche() {
  await asegurarTablas();
  const desde = inicioNoche();
  const segs = await seguimientos();
  const despachos = [...new Set(segs.map((s) => despachoDe(s.radicado)))];
  const [d] = await prisma.$queryRawUnsafe<
    { revisados: bigint; pedidos: bigint; conError: bigint; ultima: Date | null; ultimoError: Date | null }[]
  >(
    `SELECT count(*) FILTER (WHERE "revisadoAt" >= $2) AS revisados,
            count(*) FILTER (WHERE "pedidoAt" IS NOT NULL) AS pedidos,
            count(*) FILTER (WHERE "errorAt" IS NOT NULL AND ("revisadoAt" IS NULL OR "revisadoAt" < "errorAt")) AS "conError",
            max("revisadoAt") AS ultima, max("errorAt") AS "ultimoError"
     FROM "EstadoDespacho" WHERE despacho = ANY($1::text[])`,
    despachos,
    desde,
  );
  const [h] = await prisma.$queryRawUnsafe<{ noche: bigint; porAvisar: bigint }[]>(
    `SELECT count(*) FILTER (WHERE "createdAt" >= $1) AS noche,
            count(*) FILTER (WHERE "porAvisar" AND NOT visto) AS "porAvisar"
     FROM "EstadoHallazgo"`,
    desde,
  );
  const [u] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n FROM "User" WHERE "estadosActivo"`,
  );
  const errores = await prisma.$queryRawUnsafe<{ despacho: string; error: string | null; errorAt: Date }[]>(
    `SELECT despacho, "ultimoError" AS error, "errorAt" FROM "EstadoDespacho"
     WHERE despacho = ANY($1::text[]) AND "errorAt" IS NOT NULL AND ("revisadoAt" IS NULL OR "revisadoAt" < "errorAt")
     ORDER BY "errorAt" DESC LIMIT 10`,
    despachos,
  );
  const ultimaActividad = [d?.ultima, d?.ultimoError]
    .filter((x): x is Date => !!x)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
  // ¿El VPS se detuvo? Hay trabajo (pedidos, o juzgados que aún tocan en este
  // ciclo hábil, con el mismo criterio de revisarEstados) y nada se ha revisado
  // ni fallado en 20 minutos.
  const [pend] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n FROM unnest($1::text[]) AS d(despacho)
     LEFT JOIN "EstadoDespacho" e ON e.despacho = d.despacho
     WHERE (e."revisadoAt" IS NULL
            OR (coalesce(e.publicaciones, 0) > 0 AND e."revisadoAt" < $2)
            OR (coalesce(e.publicaciones, 0) = 0 AND e."revisadoAt" < $2::timestamptz - interval '24 hours'))
       AND (e."errorAt" IS NULL OR e."errorAt" < now() - interval '1 hour')`,
    despachos,
    desde,
  );
  const hayTrabajo = Number(d?.pedidos ?? 0) > 0 || (cicloHabil() && Number(pend?.n ?? 0) > 0);
  const quieto = !ultimaActividad || Date.now() - new Date(ultimaActividad).getTime() > 20 * 60_000;
  // Qué está haciendo ahora (solo si lo marcó en los últimos 10 minutos).
  const [ahora] = await prisma
    .$queryRawUnsafe<{ despacho: string; fecha: string | null; pdf: number | null; total: number | null; at: Date }[]>(
      `SELECT despacho, fecha, pdf, total, "at" FROM "EstadoAvance" WHERE id = 1 AND "at" > now() - interval '10 minutes'`,
    )
    .catch(() => []);
  return {
    ahora: ahora ?? null,
    desde,
    detenido: hayTrabajo && quieto,
    porRevisar: Number(pend?.n ?? 0),
    usuarios: Number(u?.n ?? 0),
    radicados: segs.length,
    despachos: despachos.length,
    revisados: Number(d?.revisados ?? 0),
    pedidos: Number(d?.pedidos ?? 0),
    conError: Number(d?.conError ?? 0),
    hallazgosNoche: Number(h?.noche ?? 0),
    porAvisar: Number(h?.porAvisar ?? 0),
    ultimaActividad,
    errores,
  };
}

/**
 * "Revisar ahora" del root: deja pedidos todos los despachos vigilados y el
 * VPS los revisa en sus próximas vueltas (Hostinger ya no va al portal).
 */
export async function pedirRevisionDeTodos(): Promise<number> {
  await asegurarTablas();
  const despachos = [...new Set((await seguimientos()).map((s) => despachoDe(s.radicado)))];
  if (despachos.length === 0) return 0;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "EstadoDespacho" (despacho, "pedidoAt") SELECT d, now() FROM unnest($1::text[]) AS d
     ON CONFLICT (despacho) DO UPDATE SET "pedidoAt" = coalesce("EstadoDespacho"."pedidoAt", now())`,
    despachos,
  );
  return despachos.length;
}

async function revisarDespacho(despacho: string) {
  let items: Item[];
  await marcarAvance(despacho);
  try {
    items = await buscarConReintentos(despacho);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // No cuenta como revisado: se reintenta en ~1 hora (ver "errorAt" en revisarEstados).
    await prisma.$executeRawUnsafe(
      `INSERT INTO "EstadoDespacho" (despacho, "ultimoError", "errorAt") VALUES ($1, $2, now())
       ON CONFLICT (despacho) DO UPDATE SET "ultimoError" = EXCLUDED."ultimoError", "errorAt" = now()`,
      despacho,
      msg.slice(0, 300),
    );
    return { despacho, error: msg };
  }

  // Solo el último estado publicado (no traslados, entradas, etc.).
  const ultimo = items
    .filter((i) => /estado/i.test(i.titulo))
    .sort((a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? "") || Number(b.id) - Number(a.id))[0];
  const ya = ultimo
    ? (await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "EstadoPublicacion" WHERE id = $1`, ultimo.id))
        .length > 0
    : true;
  let nuevas = 0;
  for (const it of ya || !ultimo ? [] : [ultimo]) {
    try {
      const archivos = await leerPublicacion(it.id, { despacho, fecha: it.fecha ?? null });
      await prisma.$executeRawUnsafe(
        `INSERT INTO "EstadoPublicacion" (id, despacho, titulo, fecha, archivos) VALUES ($1, $2, $3, $4::date, $5::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        it.id,
        despacho,
        it.titulo,
        it.fecha,
        JSON.stringify(archivos),
      );
      nuevas++;
    } catch (e) {
      console.error("[estados] publicación", it.id, e);
    }
  }
  await prisma.$executeRawUnsafe(
    `INSERT INTO "EstadoDespacho" (despacho, "revisadoAt", "ultimoError", publicaciones) VALUES ($1, now(), NULL, $2)
     ON CONFLICT (despacho) DO UPDATE SET "revisadoAt" = now(), "ultimoError" = NULL, "errorAt" = NULL,
      "pedidoAt" = NULL, publicaciones = $2`,
    despacho,
    items.length,
  );
  // Limpieza: publicaciones viejas sin hallazgos.
  await prisma.$executeRawUnsafe(
    `DELETE FROM "EstadoPublicacion" p WHERE p.despacho = $1 AND p."createdAt" < now() - interval '90 days'
     AND NOT EXISTS (SELECT 1 FROM "EstadoHallazgo" h WHERE h."publicacionId" = p.id)`,
    despacho,
  );
  const hallazgos = await cruzarDespacho(despacho);
  return { despacho, publicaciones: items.length, nuevas, hallazgos };
}

/**
 * Vuelve a cruzar, con las publicaciones ya guardadas (sin ir al portal), los
 * despachos que tienen hallazgos: completa los documentos de los hallazgos de
 * antes (que guardaban uno solo). Lo corre el servicio del VPS al arrancar.
 */
export async function completarDocumentosHallazgos() {
  await asegurarTablas();
  const filas = await prisma.$queryRawUnsafe<{ despacho: string }[]>(
    `SELECT DISTINCT p.despacho FROM "EstadoHallazgo" h JOIN "EstadoPublicacion" p ON p.id = h."publicacionId"`,
  );
  let nuevos = 0;
  for (const f of filas) nuevos += await cruzarDespacho(f.despacho);
  return { despachos: filas.length, nuevos };
}

/** Busca los radicados vigilados del despacho en sus publicaciones guardadas y avisa los nuevos. */
async function cruzarDespacho(despacho: string) {
  const segs = await seguimientos({ despacho });
  if (segs.length === 0) return 0;
  const pubs = await prisma.$queryRawUnsafe<{ id: string; titulo: string; fecha: Date | null; archivos: Archivo[] }[]>(
    `SELECT id, titulo, fecha, archivos FROM "EstadoPublicacion"
     WHERE despacho = $1 AND "createdAt" > now() - interval '60 days'`,
    despacho,
  );
  const nuevosPorUsuario = new Map<string, { radicado: string; titulo: string; extracto: string }[]>();
  for (const pub of pubs) {
    for (const s of segs) {
      // TODOS los archivos de la publicación donde está el radicado (la planilla
      // y cada auto), por su texto o por su nombre ("021-2024-00281-NombraCurador.pdf":
      // los autos escaneados no tienen texto). La página solo si ningún archivo lo tiene.
      const docs: DocEstado[] = [];
      let ext: string | null = null;
      for (const a of pub.archivos.slice(1)) {
        const i = buscarRadicado(a.texto, s.radicado);
        if (i < 0 && buscarRadicado(a.nombre, s.radicado) < 0) continue;
        docs.push({ nombre: a.nombre, url: a.url });
        if (ext === null && i >= 0) ext = extracto(a.texto, i);
      }
      if (docs.length === 0) {
        const pagina = pub.archivos[0];
        const i = pagina ? buscarRadicado(pagina.texto, s.radicado) : -1;
        if (i < 0) continue;
        docs.push({ nombre: pagina.nombre, url: pagina.url });
        ext = extracto(pagina.texto, i);
      }
      // Si ya existía (de antes, con un solo documento), se completa sin volver a avisar.
      const [r] = await prisma.$queryRawUnsafe<{ nuevo: boolean }[]>(
        `INSERT INTO "EstadoHallazgo" ("userId", radicado, "publicacionId", archivo, url, extracto, documentos, "porAvisar")
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, true)
         ON CONFLICT ("userId", radicado, "publicacionId") DO UPDATE
           SET documentos = EXCLUDED.documentos, extracto = EXCLUDED.extracto
           WHERE "EstadoHallazgo".documentos IS DISTINCT FROM EXCLUDED.documentos
              OR "EstadoHallazgo".extracto IS DISTINCT FROM EXCLUDED.extracto
         RETURNING (xmax = 0) AS nuevo`,
        s.userId,
        s.radicado,
        pub.id,
        docs[0].nombre,
        docs[0].url,
        ext,
        JSON.stringify(docs),
      );
      if (r?.nuevo) {
        const l = nuevosPorUsuario.get(s.userId) ?? [];
        l.push({ radicado: s.radicado, titulo: pub.titulo, extracto: ext ?? "" });
        nuevosPorUsuario.set(s.userId, l);
      }
    }
  }
  // El aviso sale en el resumen de actuaciones (enviarResumenesPendientes):
  // mismo correo, WhatsApp y notificación, de 7 a. m. a 6 p. m.
  let total = 0;
  for (const l of nuevosPorUsuario.values()) total += l.length;
  return total;
}

/**
 * Un abogado en prueba agregó radicados: se buscan en estados en segundo plano.
 * Si el despacho ya se revisó en las últimas 24 h, se cruza con el estado ya
 * guardado (sin ir al portal); si no, queda pedido para el próximo cron (cada
 * 5 min, de 2 en 2). No bloquea la carga: se llama sin esperar.
 */
export async function buscarEstadosDeNuevos(userId: string, radicados: string[]) {
  try {
    if (radicados.length === 0 || !(await estadosActivo(userId))) return;
    // Si lo había quitado de estados y lo vuelve a agregar, se vigila otra vez.
    await prisma.$executeRawUnsafe(
      `DELETE FROM "EstadoQuitado" WHERE "userId" = $1 AND radicado = ANY($2::text[])`,
      userId,
      radicados,
    );
    let directos = 0;
    for (const despacho of [...new Set(radicados.map(despachoDe))]) {
      const [d] = await prisma.$queryRawUnsafe<{ reciente: boolean }[]>(
        `SELECT "revisadoAt" > now() - interval '24 hours' AS reciente FROM "EstadoDespacho" WHERE despacho = $1`,
        despacho,
      );
      if (d?.reciente) {
        await cruzarDespacho(despacho);
      } else {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "EstadoDespacho" (despacho, "pedidoAt") VALUES ($1, now())
           ON CONFLICT (despacho) DO UPDATE SET "pedidoAt" = coalesce("EstadoDespacho"."pedidoAt", now())`,
          despacho,
        );
        // VPS bloqueado por el portal: la app (Hostinger) revisa el juzgado directo,
        // con el mismo tope diario que el «Actualizar». Sin cupo, queda pedido al VPS.
        if ((await vpsBloqueado()) && (await tomarCupoDirecto())) {
          if (directos++ > 0) await esperar(azar(PAUSA_MIN_MS, PAUSA_MAX_MS)); // ritmo humano entre juzgados
          await revisarDespachoDirecto(despacho);
        }
      }
    }
  } catch (e) {
    console.error("[estados] radicados nuevos", e);
  }
}

// ---------- Nombres de los juzgados ----------
// El portal trae en su página de inicio la lista de todos los despachos
// ("252904003001 - JUZGADO 001 CIVIL MUNICIPAL DE FUSAGASUGÁ"). Se guarda en
// la base y se vuelve a pedir solo si falta algún código (máximo una vez al día).
let nombresListos = false;
let ultimoIntentoNombres = 0;
async function asegurarNombres() {
  if (nombresListos) return;
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "DespachoNombre" (codigo TEXT PRIMARY KEY, nombre TEXT NOT NULL)`,
  );
  nombresListos = true;
}

const MINUSCULAS = new Set(["de", "del", "la", "las", "los", "y", "e", "en", "con", "para", "a"]);
function nombreBonito(s: string) {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((p, i) => (i > 0 && MINUSCULAS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(" ")
    .replace(/\b(Epms|Desaj)\b/g, (m) => m.toUpperCase());
}

async function cargarNombresDelPortal() {
  const html = await (await traer(`${BASE}/web/publicaciones-procesales/`, 90_000)).text();
  const codigos: string[] = [];
  const nombres: string[] = [];
  for (const m of html.matchAll(/<option[^>]*value="(\d{12})"[^>]*>\s*\d{12}\s*-\s*([^<]+)/g)) {
    codigos.push(m[1]);
    nombres.push(nombreBonito(decodificar(m[2]).trim()));
  }
  if (codigos.length === 0) return;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "DespachoNombre" (codigo, nombre) SELECT * FROM unnest($1::text[], $2::text[])
     ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre`,
    codigos,
    nombres,
  );
}

/** Nombre de cada despacho (código de 12 dígitos); los que no estén en el portal no vienen. */
export async function nombresDespachos(codigos: string[]): Promise<Map<string, string>> {
  if (codigos.length === 0) return new Map();
  try {
    await asegurarNombres();
    const leer = async () =>
      prisma.$queryRawUnsafe<{ codigo: string; nombre: string }[]>(
        `SELECT codigo, nombre FROM "DespachoNombre" WHERE codigo = ANY($1::text[])`,
        codigos,
      );
    const filas = await leer();
    // Si falta alguno, se piden al portal en segundo plano (la página no espera al portal, que es lento).
    if (filas.length < new Set(codigos).size && Date.now() - ultimoIntentoNombres > 86400_000) {
      ultimoIntentoNombres = Date.now();
      void cargarNombresDelPortal().catch((e) => console.error("[estados] nombres del portal", e));
    }
    const mapa = new Map(filas.map((f) => [f.codigo, f.nombre]));
    // Los que el portal no tiene: el nombre que da la Consulta Nacional, si hay un proceso de ese despacho.
    const faltan = [...new Set(codigos)].filter((c) => !mapa.has(c));
    if (faltan.length > 0) {
      const deRama = await prisma.$queryRawUnsafe<{ codigo: string; nombre: string }[]>(
        `SELECT DISTINCT ON (left(radicado, 12)) left(radicado, 12) AS codigo, despacho AS nombre
         FROM "Case" WHERE left(radicado, 12) = ANY($1::text[]) AND despacho IS NOT NULL`,
        faltan,
      );
      for (const d of deRama) mapa.set(d.codigo, nombreBonito(d.nombre));
    }
    return mapa;
  } catch (e) {
    console.error("[estados] nombres de despachos", e);
    return new Map();
  }
}

// ---------- Para las páginas ----------
export type HallazgoVista = {
  id: number;
  radicado: string;
  titulo: string;
  fecha: Date | null;
  archivo: string | null;
  url: string | null;
  extracto: string | null;
  visto: boolean;
  createdAt: Date;
  /** Todos los documentos donde salió el radicado (la planilla y cada auto). */
  documentos: DocEstado[];
};

// Los hallazgos de antes solo tienen archivo/url: se muestran como un único documento.
const DOCS = `coalesce(h.documentos, CASE WHEN h.url IS NULL THEN '[]'::jsonb
  ELSE jsonb_build_array(jsonb_build_object('nombre', coalesce(h.archivo, 'estado'), 'url', h.url)) END) AS documentos`;

export async function hallazgosDelUsuario(userId: string, limite = 200, desde = 0): Promise<HallazgoVista[]> {
  await asegurarTablas();
  return prisma.$queryRawUnsafe<HallazgoVista[]>(
    `SELECT h.id, h.radicado, p.titulo, p.fecha, h.archivo, h.url, h.extracto, h.visto, h."createdAt", ${DOCS}
     FROM "EstadoHallazgo" h JOIN "EstadoPublicacion" p ON p.id = h."publicacionId"
     WHERE h."userId" = $1 ORDER BY p.fecha DESC NULLS LAST, h.id DESC LIMIT $2 OFFSET $3`,
    userId,
    limite,
    desde,
  );
}

export async function totalHallazgos(userId: string): Promise<number> {
  await asegurarTablas();
  const [r] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n FROM "EstadoHallazgo" WHERE "userId" = $1`,
    userId,
  );
  return Number(r?.n ?? 0);
}

/** Para la pestaña "Estados electrónicos" del proceso: dónde salió este radicado. */
export async function estadosDelRadicado(userId: string, radicado: string) {
  await asegurarTablas();
  const despacho = despachoDe(radicado);
  const [pubs, [d], nombres] = await Promise.all([
    prisma.$queryRawUnsafe<HallazgoVista[]>(
      `SELECT h.id, h.radicado, p.titulo, p.fecha, h.archivo, h.url, h.extracto, h.visto, h."createdAt", ${DOCS}
       FROM "EstadoHallazgo" h JOIN "EstadoPublicacion" p ON p.id = h."publicacionId"
       WHERE h."userId" = $1 AND h.radicado = $2 ORDER BY p.fecha DESC NULLS LAST, h.id DESC`,
      userId,
      radicado,
    ),
    prisma.$queryRawUnsafe<{ revisadoAt: Date | null }[]>(
      `SELECT "revisadoAt" FROM "EstadoDespacho" WHERE despacho = $1`,
      despacho,
    ),
    nombresDespachos([despacho]),
  ]);
  return { publicaciones: pubs, juzgado: nombres.get(despacho) ?? null, revisadoAt: d?.revisadoAt ?? null };
}

/** Enlace de un documento (por su posición) de un hallazgo, solo si es del usuario y viene del portal de la Rama. */
export async function archivoDeHallazgo(userId: string, id: number, doc = 0) {
  await asegurarTablas();
  const [h] = await prisma.$queryRawUnsafe<{ documentos: DocEstado[] }[]>(
    `SELECT ${DOCS} FROM "EstadoHallazgo" h WHERE h.id = $1 AND h."userId" = $2`,
    id,
    userId,
  );
  const d = h?.documentos?.[doc];
  if (!d?.url || !d.url.startsWith(`${BASE}/`)) return null;
  return { url: d.url, archivo: d.nombre || "estado" };
}

export async function marcarHallazgosVistos(userId: string) {
  await asegurarTablas();
  await prisma.$executeRawUnsafe(`UPDATE "EstadoHallazgo" SET visto = true WHERE "userId" = $1 AND NOT visto`, userId);
}

export async function hallazgosSinVer(userId: string): Promise<number> {
  await asegurarTablas();
  const [r] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n FROM "EstadoHallazgo" WHERE "userId" = $1 AND NOT visto`,
    userId,
  );
  return Number(r?.n ?? 0);
}

export type SoloEstados = {
  radicado: string;
  despacho: string;
  /** "Juzgado 001 Civil Municipal de Fusagasugá", si el portal lo tiene. */
  juzgado: string | null;
  revisadoAt: Date | null;
  /** id del proceso si también está en la Consulta Nacional. */
  caseId: string | null;
  ultimo: { titulo: string; fecha: Date | null; extracto: string | null; url: string | null } | null;
};

/**
 * Lo que va en Procesos → "En estados electrónicos": los radicados que la
 * Consulta Nacional no tiene (siempre) y los que sí tiene pero salieron en un
 * estado (hay juzgados que publican el estado y no registran la actuación).
 */
export async function soloEnEstados(
  userId: string,
  /** Si la página ya los pidió, para no repetir la consulta. */
  yaVigilados?: Awaited<ReturnType<typeof vigiladosDelUsuario>>,
): Promise<SoloEstados[]> {
  const vigilados = yaVigilados ?? (await vigiladosDelUsuario(userId));
  const casos = new Map(
    (
      await prisma.case.findMany({
        where: { userId },
        select: { id: true, radicado: true },
        orderBy: { lastActuacionDate: { sort: "desc", nulls: "last" } },
      })
    ).map((c) => [c.radicado, c.id] as const).reverse(),
  );
  const faltan = vigilados;
  if (faltan.length === 0) return [];
  const ultimos = await prisma.$queryRawUnsafe<
    { radicado: string; titulo: string; fecha: Date | null; extracto: string | null; url: string | null }[]
  >(
    `SELECT DISTINCT ON (h.radicado) h.radicado, p.titulo, p.fecha, h.extracto, h.url
     FROM "EstadoHallazgo" h JOIN "EstadoPublicacion" p ON p.id = h."publicacionId"
     WHERE h."userId" = $1 AND h.radicado = ANY($2::text[])
     ORDER BY h.radicado, p.fecha DESC NULLS LAST, h.id DESC`,
    userId,
    faltan.map((f) => f.radicado),
  );
  const porRad = new Map(ultimos.map((u) => [u.radicado, u]));
  const nombres = await nombresDespachos(faltan.map((f) => f.despacho));
  return faltan
    .map((f) => {
      const u = porRad.get(f.radicado);
      return {
        radicado: f.radicado,
        despacho: f.despacho,
        juzgado: nombres.get(f.despacho) ?? null,
        revisadoAt: f.revisadoAt ?? null,
        caseId: casos.get(f.radicado) ?? null,
        ultimo: u ? { titulo: u.titulo, fecha: u.fecha, extracto: u.extracto, url: u.url } : null,
      };
    })
    // Los que están en la Rama solo aparecen aquí si salieron en un estado.
    .filter((s) => !s.caseId || s.ultimo)
    .sort((a, b) => (b.ultimo?.fecha?.getTime() ?? 0) - (a.ultimo?.fecha?.getTime() ?? 0));
}

/** Radicados vigilados del usuario y cuándo se revisó su despacho. */
export async function vigiladosDelUsuario(userId: string) {
  await asegurarTablas();
  const segs = await seguimientos({ userId });
  const despachos = [...new Set(segs.map((s) => despachoDe(s.radicado)))];
  const estado = await prisma.$queryRawUnsafe<
    { despacho: string; revisadoAt: Date | null; ultimoError: string | null; publicaciones: number }[]
  >(
    `SELECT despacho, "revisadoAt", "ultimoError", publicaciones FROM "EstadoDespacho" WHERE despacho = ANY($1::text[])`,
    despachos,
  );
  const porDespacho = new Map(estado.map((e) => [e.despacho, e]));
  const nombres = await nombresDespachos(despachos);
  return segs
    .map((s) => ({
      radicado: s.radicado,
      despacho: despachoDe(s.radicado),
      juzgado: nombres.get(despachoDe(s.radicado)) ?? null,
      ...porDespacho.get(despachoDe(s.radicado)),
    }))
    .sort((a, b) => a.radicado.localeCompare(b.radicado));
}

/**
 * Botón "Actualizar" de un radicado que solo está en estados: pide revisar ya
 * el juzgado (lo hace el VPS en sus próximas vueltas, de día también). Si el
 * juzgado se revisó hace menos de 15 minutos, solo se cruza con lo guardado.
 */
export async function pedirActualizarRadicado(
  userId: string,
  radicado: string,
): Promise<{ estado: "pedido" | "reciente" | "directo" | "no"; pedidoAt?: Date; despacho?: string }> {
  await asegurarTablas();
  const vigilado = (await vigiladosDelUsuario(userId)).find((v) => v.radicado === radicado);
  if (!vigilado) return { estado: "no" };
  const despacho = despachoDe(radicado);
  const [d] = await prisma.$queryRawUnsafe<{ reciente: boolean }[]>(
    `SELECT "revisadoAt" > now() - interval '15 minutes' AS reciente FROM "EstadoDespacho" WHERE despacho = $1`,
    despacho,
  );
  if (d?.reciente) {
    await cruzarDespacho(despacho).catch((e) => console.error("[estados] cruzar", e));
    return { estado: "reciente" };
  }
  const [p] = await prisma.$queryRawUnsafe<{ pedidoAt: Date }[]>(
    `INSERT INTO "EstadoDespacho" (despacho, "pedidoAt") VALUES ($1, now())
     ON CONFLICT (despacho) DO UPDATE SET "pedidoAt" = coalesce("EstadoDespacho"."pedidoAt", now())
     RETURNING "pedidoAt"`,
    despacho,
  );
  // Si el VPS está bloqueado por el portal, la app (Hostinger) lo revisa directo,
  // con tope diario para no quemar también esta IP. Si no hay cupo, queda pedido.
  if (await vpsBloqueado()) {
    const cupo = await tomarCupoDirecto();
    if (cupo) return { estado: "directo", pedidoAt: p?.pedidoAt, despacho };
  }
  return { estado: "pedido", pedidoAt: p?.pedidoAt };
}

/** Revisiones directas desde la app por día (cuando el VPS está bloqueado). */
const TOPE_DIRECTO_DIA = Number(process.env.ESTADOS_TOPE_DIRECTO_DIA) || 25;

async function vpsBloqueado() {
  const b = await bloqueoPortal("vps");
  return !!b && !b.levantado;
}

async function tomarCupoDirecto(): Promise<boolean> {
  if (await pausadoHasta()) return false; // Hostinger también está en pausa
  const [r] = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `INSERT INTO "EstadoUsoDirecto" (dia, n) VALUES ((now() AT TIME ZONE 'America/Bogota')::date, 1)
     ON CONFLICT (dia) DO UPDATE SET n = "EstadoUsoDirecto".n + 1
     WHERE "EstadoUsoDirecto".n < $1
     RETURNING n`,
    TOPE_DIRECTO_DIA,
  );
  return !!r;
}

/** Revisión directa de un juzgado desde la app (ver pedirActualizarRadicado). No lanza error. */
export async function revisarDespachoDirecto(despacho: string) {
  try {
    return await revisarDespacho(despacho);
  } catch (e) {
    console.error("[estados] revisión directa", despacho, e);
    return { despacho, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Si el juzgado de ese radicado tiene una revisión pedida y pendiente (para mostrar "buscando…"). */
export async function revisionPendiente(radicado: string): Promise<Date | null> {
  await asegurarTablas();
  const [d] = await prisma.$queryRawUnsafe<{ pedidoAt: Date | null }[]>(
    `SELECT "pedidoAt" FROM "EstadoDespacho" WHERE despacho = $1`,
    despachoDe(radicado),
  );
  return d?.pedidoAt ?? null;
}
