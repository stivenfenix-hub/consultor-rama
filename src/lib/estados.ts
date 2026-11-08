import "server-only";
import { prisma } from "./db";
import { ensureColumn } from "./runtime-columns";
import { nocheHabil } from "./dias-habiles";

// ---------- Estados electrónicos (Publicaciones Procesales) ----------
// Muchos juzgados publican sus estados solo en publicacionesprocesales.ramajudicial.gov.co,
// como PDF con todos los procesos del día: por eso hay radicados que no aparecen
// en la Consulta Nacional. Aquí se revisan las publicaciones del despacho de cada
// radicado vigilado, se leen los PDF y se busca el radicado (completo o
// "2026-00894", como lo escriben los juzgados).
//
// El portal es lento (una búsqueda tarda ~4 min y a veces da 504). Desde el
// 7 nov 2026 es para TODOS los usuarios (el root puede apagarlo a alguno) y lo
// corre el VPS (estados-worker), con su propia IP, no Hostinger: de noche
// (6 p. m. a 6:45 a. m.) cada despacho una vez y solo su último estado; de día
// solo los despachos pedidos (radicados recién agregados o "Revisar ahora").

const BASE = "https://publicacionesprocesales.ramajudicial.gov.co";
const PORTLET = "co_com_avanti_efectosProcesales_PublicacionesEfectosProcesalesPortletV2_INSTANCE_BIyXQFHVaYaq";
const NS = `_${PORTLET}`;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const DIAS_ATRAS = 7; // ventana de búsqueda (de ahí solo se toma el último estado)
const NOCHE_DESDE = 18 * 60; // 6:00 p. m. (minutos, hora de Bogotá)
const NOCHE_HASTA = 6 * 60 + 45; // 6:45 a. m.
// En el VPS se ajustan con variables de entorno (ver estados-worker).
const DESPACHOS_POR_CORRIDA = Number(process.env.ESTADOS_DESPACHOS_POR_CORRIDA) || 2;
/** Pausa entre un despacho y otro, para no cargar el portal. */
const PAUSA_DESPACHOS_MS = Number(process.env.ESTADOS_PAUSA_MS) || 0;
const PRESUPUESTO_MS = 15 * 60 * 1000;
const MAX_ARCHIVOS = 60; // por publicación
const MAX_TEXTO_ARCHIVO = 60_000;

let tablasListas = false;
async function asegurarTablas() {
  if (tablasListas) return;
  await ensureColumn("User", "estadosActivo", "BOOLEAN NOT NULL DEFAULT true");
  // Estados para todos (7 nov 2026): los nuevos usuarios lo tienen activo y,
  // una sola vez, se activa a todos los que ya existían.
  await prisma.$executeRawUnsafe(`ALTER TABLE "User" ALTER COLUMN "estadosActivo" SET DEFAULT true`);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "EstadoMigracion" (id TEXT PRIMARY KEY, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const [primera] = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO "EstadoMigracion" (id) VALUES ('todos-activos') ON CONFLICT DO NOTHING RETURNING id`,
  );
  if (primera) await prisma.$executeRawUnsafe(`UPDATE "User" SET "estadosActivo" = true WHERE NOT "estadosActivo"`);
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
  tablasListas = true;
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
async function seguimientos(despacho?: string) {
  await asegurarTablas();
  const filas = await prisma.$queryRawUnsafe<{ userId: string; radicado: string }[]>(
    `SELECT DISTINCT r."userId", r.radicado FROM (
       SELECT c."userId", c.radicado FROM "Case" c JOIN "User" u ON u.id = c."userId" WHERE u."estadosActivo"
       UNION
       SELECT cp."userId", (regexp_matches(
         coalesce(cp.radicados, '') || ' ' || coalesce(cp.error, '') || ' ' || coalesce(cp.ok, ''), '\\d{23}', 'g'))[1]
       FROM "CargaProcesos" cp JOIN "User" u ON u.id = cp."userId" WHERE u."estadosActivo"
     ) r
     WHERE NOT EXISTS (SELECT 1 FROM "EstadoQuitado" q WHERE q."userId" = r."userId" AND q.radicado = r.radicado)`,
  );
  return despacho ? filas.filter((f) => despachoDe(f.radicado) === despacho) : filas;
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
  if (!(await estadosActivo(userId))) return 0;
  const [r] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(DISTINCT x.rad) AS n FROM (
       SELECT (regexp_matches(
         coalesce(cp.radicados, '') || ' ' || coalesce(cp.error, '') || ' ' || coalesce(cp.ok, ''), '\\d{23}', 'g'))[1] AS rad
       FROM "CargaProcesos" cp WHERE cp."userId" = $1
     ) x
     WHERE NOT EXISTS (SELECT 1 FROM "Case" c WHERE c."userId" = $1 AND c.radicado = x.rad)
       AND NOT EXISTS (SELECT 1 FROM "EstadoQuitado" q WHERE q."userId" = $1 AND q.radicado = x.rad)`,
    userId,
  );
  return Number(r?.n ?? 0);
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
async function traer(url: string, ms: number) {
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`Publicaciones Procesales respondió ${r.status}`);
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
// más no sirve. Se reintenta enseguida, con una búsqueda más liviana.
const REINTENTOS_LIVIANOS = [
  { esperaMs: 45_000, dias: 3, porPagina: 20, timeoutMs: 120_000 },
  { esperaMs: 60_000, dias: 3, porPagina: 20, timeoutMs: 120_000 },
];

/** Un 4xx no mejora reintentando; un 5xx, un timeout o un corte de red sí. */
const vale_reintentar = (e: unknown) => !/respondió 4\d\d/.test(e instanceof Error ? e.message : String(e));

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

/** Abre una publicación y lee el texto de sus archivos (y de la página misma). */
async function leerPublicacion(id: string): Promise<Archivo[]> {
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
  archivos.push({ nombre: "Página de la publicación", url: urlPagina, texto: decodificar(cuerpo).slice(0, MAX_TEXTO_ARCHIVO) });

  const vistos = new Set<string>();
  const re = /<a[^>]*href="((?:\/c\/document_library\/get_file\?[^"]+)|(?:\/documents\/\d+\/\d+\/[^"]+))"[^>]*>([\s\S]*?)<\/a>/g;
  for (const m of html.matchAll(re)) {
    const ruta = decodificar(m[1]);
    if (ruta.startsWith("/documents/20135/") || vistos.has(ruta)) continue; // logos e instructivos del portal
    vistos.add(ruta);
    if (vistos.size > MAX_ARCHIVOS) break;
    const nombre = decodificar(m[2].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim() || "Documento";
    const url = BASE + ruta;
    try {
      const buf = new Uint8Array(await (await traer(url, 60_000)).arrayBuffer());
      const texto = await textoPdf(buf);
      archivos.push({ nombre, url, texto: texto.slice(0, MAX_TEXTO_ARCHIVO), imagen: texto.trim().length < 20 });
    } catch {
      archivos.push({ nombre, url, texto: "" });
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return archivos;
}

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

function extracto(texto: string, i: number) {
  return texto
    .slice(Math.max(0, i - 80), i + 260)
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
  return n > 0;
}
async function soltarLock() {
  await prisma.$executeRawUnsafe(`UPDATE "EstadoLock" SET hasta = NULL WHERE id = 1`).catch(() => {});
}

/** Lo llama el cron cada 5 min: revisa los despachos que ya toca y avisa lo que encuentre. */
/** Inicio (6 p. m. de Bogotá) de la noche en curso o de la última. */
function inicioNoche(): Date {
  const BOG = 5 * 3600_000;
  const local = new Date(Date.now() - BOG);
  const m = local.getUTCHours() * 60 + local.getUTCMinutes();
  const dia = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const noche = dia + NOCHE_DESDE * 60_000 - (m < NOCHE_DESDE ? 86400_000 : 0);
  return new Date(noche + BOG);
}

/**
 * Lo llama el cron cada 5 min: de noche revisa los despachos que aún no se
 * revisaron en esta noche. `forzar` (botón del root) corre ya, a cualquier
 * hora, todos los despachos de una vez (de a 2 en paralelo).
 */
export async function revisarEstados(opts: { forzar?: boolean } = {}) {
  const ahora = new Date(Date.now() - 5 * 3600_000); // Bogotá (UTC-5)
  const m = ahora.getUTCHours() * 60 + ahora.getUTCMinutes();
  // Sábado, domingo y festivos no hay revisión nocturna (los juzgados no publican);
  // los pedidos de radicados recién agregados sí se atienden.
  const deNoche = !(m < NOCHE_DESDE && m >= NOCHE_HASTA) && nocheHabil();
  await asegurarTablas();
  // De día solo se atienden los pedidos (radicados recién agregados).
  if (!opts.forzar && !deNoche) {
    const [p] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM "EstadoDespacho" WHERE "pedidoAt" IS NOT NULL`,
    );
    if (Number(p?.n ?? 0) === 0) return { omitido: "fuera del horario nocturno" };
  }
  if (!(await tomarLock(opts.forzar ? 150 : 20))) return { omitido: "otra corrida en curso" };
  const inicio = Date.now();
  const info: Record<string, unknown>[] = [];
  try {
    const segs = await seguimientos();
    const despachos = [...new Set(segs.map((s) => despachoDe(s.radicado)))];
    if (despachos.length === 0) return { despachos: 0 };
    const pendientes = opts.forzar
      ? despachos.map((despacho) => ({ despacho }))
      : await prisma.$queryRawUnsafe<{ despacho: string }[]>(
          `SELECT d.despacho FROM unnest($1::text[]) AS d(despacho)
           LEFT JOIN "EstadoDespacho" e ON e.despacho = d.despacho
           WHERE (e."pedidoAt" IS NOT NULL OR ($4 AND (e."revisadoAt" IS NULL OR e."revisadoAt" < $2)))
             AND (e."errorAt" IS NULL OR e."errorAt" < now() - interval '1 hour')
           ORDER BY e."pedidoAt" NULLS LAST, e."revisadoAt" NULLS FIRST
           LIMIT $3`,
          despachos,
          inicioNoche(),
          DESPACHOS_POR_CORRIDA,
          deNoche,
        );
    const presupuesto = opts.forzar ? 140 * 60_000 : PRESUPUESTO_MS;
    const cola = [...pendientes];
    const trabajador = async () => {
      for (let p = cola.shift(); p; p = cola.shift()) {
        if (Date.now() - inicio > presupuesto) break;
        info.push(await revisarDespacho(p.despacho));
        if (PAUSA_DESPACHOS_MS && cola.length) await new Promise((r) => setTimeout(r, PAUSA_DESPACHOS_MS));
      }
    };
    await Promise.all(opts.forzar ? [trabajador(), trabajador()] : [trabajador()]);
    return { despachos: despachos.length, revisados: info };
  } finally {
    await soltarLock();
  }
}

/** Resumen para el Panel admin (sincronización nocturna): cómo va la revisión de estados de esta noche. */
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
  // ¿El VPS se detuvo? Hay trabajo (pedidos, o noche hábil sin terminar) y nada
  // se ha revisado ni fallado en 20 minutos.
  const bog = new Date(Date.now() - 5 * 3600_000);
  const m = bog.getUTCHours() * 60 + bog.getUTCMinutes();
  const deNoche = !(m < NOCHE_DESDE && m >= NOCHE_HASTA) && nocheHabil();
  const hayTrabajo = Number(d?.pedidos ?? 0) > 0 || (deNoche && Number(d?.revisados ?? 0) < despachos.length);
  const quieto = !ultimaActividad || Date.now() - new Date(ultimaActividad).getTime() > 20 * 60_000;
  return {
    desde,
    detenido: hayTrabajo && quieto,
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
      const archivos = await leerPublicacion(it.id);
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

/** Busca los radicados vigilados del despacho en sus publicaciones guardadas y avisa los nuevos. */
async function cruzarDespacho(despacho: string) {
  const segs = await seguimientos(despacho);
  if (segs.length === 0) return 0;
  const pubs = await prisma.$queryRawUnsafe<{ id: string; titulo: string; fecha: Date | null; archivos: Archivo[] }[]>(
    `SELECT id, titulo, fecha, archivos FROM "EstadoPublicacion"
     WHERE despacho = $1 AND "createdAt" > now() - interval '60 days'`,
    despacho,
  );
  const nuevosPorUsuario = new Map<string, { radicado: string; titulo: string; extracto: string }[]>();
  for (const pub of pubs) {
    for (const s of segs) {
      // Primero los PDF; la página solo si ningún archivo lo tiene.
      const orden = [...pub.archivos.slice(1), ...pub.archivos.slice(0, 1)];
      for (const a of orden) {
        const i = buscarRadicado(a.texto, s.radicado);
        if (i < 0) continue;
        const ext = extracto(a.texto, i);
        const [r] = await prisma.$queryRawUnsafe<{ id: number }[]>(
          `INSERT INTO "EstadoHallazgo" ("userId", radicado, "publicacionId", archivo, url, extracto, "porAvisar")
           VALUES ($1, $2, $3, $4, $5, $6, true) ON CONFLICT DO NOTHING RETURNING id`,
          s.userId,
          s.radicado,
          pub.id,
          a.nombre,
          a.url,
          ext,
        );
        if (r) {
          const l = nuevosPorUsuario.get(s.userId) ?? [];
          l.push({ radicado: s.radicado, titulo: pub.titulo, extracto: ext });
          nuevosPorUsuario.set(s.userId, l);
        }
        break;
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
};

export async function hallazgosDelUsuario(userId: string, limite = 200, desde = 0): Promise<HallazgoVista[]> {
  await asegurarTablas();
  return prisma.$queryRawUnsafe<HallazgoVista[]>(
    `SELECT h.id, h.radicado, p.titulo, p.fecha, h.archivo, h.url, h.extracto, h.visto, h."createdAt"
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
      `SELECT h.id, h.radicado, p.titulo, p.fecha, h.archivo, h.url, h.extracto, h.visto, h."createdAt"
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

/** Enlace del archivo de un hallazgo, solo si es del usuario y viene del portal de la Rama. */
export async function archivoDeHallazgo(userId: string, id: number) {
  await asegurarTablas();
  const [h] = await prisma.$queryRawUnsafe<{ url: string | null; archivo: string | null }[]>(
    `SELECT url, archivo FROM "EstadoHallazgo" WHERE id = $1 AND "userId" = $2`,
    id,
    userId,
  );
  if (!h?.url || !h.url.startsWith(`${BASE}/`)) return null;
  return { url: h.url, archivo: h.archivo ?? "estado" };
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
export async function soloEnEstados(userId: string): Promise<SoloEstados[]> {
  const vigilados = await vigiladosDelUsuario(userId);
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
  const segs = (await seguimientos()).filter((s) => s.userId === userId);
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
