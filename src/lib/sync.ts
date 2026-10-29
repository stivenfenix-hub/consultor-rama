import "server-only";
import { LOGOS, urlAbsoluta } from "./marca";
import { prisma } from "./db";
import {
  buscarPorRadicado,
  obtenerDetalle,
  obtenerActuaciones,
  obtenerDocumentos,
  obtenerDocumentosActuacion,
  obtenerSujetos,
  laMasReciente,
  fechaRama,
  RamaError,
  type ProcesoResumen,
  type Actuacion as RamaActuacion,
  type Documento as RamaDocumento,
} from "./rama";
import { sendMail } from "./mailer";
import { after } from "next/server";

const parseFecha = fechaRama;

/**
 * Registra un proceso para un abogado a partir del radicado.
 * Trae detalle + actuaciones de la Rama y los guarda. Si ya existe, lo refresca.
 */
export async function agregarProcesoPorRadicado(
  userId: string,
  radicado: string,
  limite = Infinity,
) {
  const procesos = await buscarPorRadicado(radicado);
  if (procesos.length === 0) {
    throw new RamaError("No se encontro ningun proceso con ese radicado.", 404);
  }
  // Un radicado puede tener varios idProceso (p. ej. por instancias).
  // Registramos todos los que devuelva.
  const creados = [];
  for (const p of procesos) {
    creados.push(await upsertProceso(userId, p, limite));
  }
  return creados;
}

/**
 * El proxy de Hostinger corta las peticiones a los 60 s y la Rama a veces
 * tarda 10-20 s por consulta: lo que no alcance en este tiempo sigue en
 * segundo plano (after) y el abogado recibe un aviso cuando termina.
 */
const PRESUPUESTO_AGREGAR_MS = 30_000;

/** Corre después de responder (o sin esperar si no hay petición en curso). */
function enFondo(tarea: () => Promise<unknown>) {
  const segura = () => tarea().catch((e) => console.error("[agregar] fondo", e));
  try {
    after(segura);
  } catch {
    void segura();
  }
}

export type ResultadoAgregar = {
  agregados: number;
  yaEstaban: number;
  /** Quedaron en la lista pero la Rama no entregó las actuaciones todavía. */
  pendientes: number;
  privados: number;
  noEncontrados: string[];
  fallidos: string[];
  /** La Rama pidió pausar: estos no se intentaron. */
  sinIntentar: string[];
  /** Se siguen cargando en segundo plano (la Rama estaba lenta). */
  enFondo: number;
  /** Error técnico de cada fallido (diagnóstico para el root). */
  errores?: string[];
};

/** Agrega varios radicados y cuenta qué pasó con cada uno. */
export async function agregarRadicados(
  userId: string,
  radicados: string[],
  presupuestoMs = PRESUPUESTO_AGREGAR_MS,
  alAvanzar?: (hechos: number) => Promise<void>,
): Promise<ResultadoAgregar> {
  const r: ResultadoAgregar = {
    agregados: 0,
    yaEstaban: 0,
    pendientes: 0,
    privados: 0,
    noEncontrados: [],
    fallidos: [],
    sinIntentar: [],
    enFondo: 0,
  };
  const limite = Date.now() + presupuestoMs;
  for (let i = 0; i < radicados.length; i++) {
    const rad = radicados[i];
    if (Date.now() > limite) {
      // Sin tiempo: el resto se agrega en segundo plano.
      const resto = radicados.slice(i);
      r.enFondo += resto.length;
      enFondo(() => agregarEnFondo(userId, resto));
      break;
    }
    try {
      const creados = await agregarProcesoPorRadicado(userId, rad, limite);
      if (creados.every((c) => !c.nuevo)) r.yaEstaban++;
      else if (creados.some((c) => c.privado)) r.privados++;
      else if (creados.some((c) => c.pendiente)) r.pendientes++;
      else if (creados.some((c) => c.cargando)) r.enFondo++;
      else r.agregados++;
    } catch (err) {
      if (err instanceof RamaError && err.isRateLimit) {
        r.sinIntentar.push(...radicados.slice(i));
        break;
      }
      if (err instanceof RamaError && err.status === 404) r.noEncontrados.push(rad);
      else {
        r.fallidos.push(rad);
        r.errores = [...(r.errores ?? []), `${rad}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300)];
        console.error("[agregar]", rad, err);
      }
    }
    await alAvanzar?.(i + 1);
  }
  // Lo que la Rama no respondió se reintenta solo (ver procesarReintentos).
  await programarReintentos(userId, [...r.fallidos, ...r.sinIntentar]).catch((e) =>
    console.error("[agregar] reintentos", e),
  );
  return r;
}

/** Agrega en segundo plano lo que no alcanzó (app móvil) y avisa al terminar. */
async function agregarEnFondo(userId: string, radicados: string[]) {
  const r = await agregarRadicados(userId, radicados, Infinity);
  await avisarCargaLista(userId, r);
}

async function avisarCargaLista(userId: string, r: ResultadoAgregar) {
  const listos = r.agregados + r.pendientes + r.privados + r.enFondo;
  const { sendPushToUser } = await import("./push");
  await sendPushToUser(userId, {
    title:
      listos > 0
        ? "✅ Tus procesos ya están cargados"
        : r.fallidos.length + r.sinIntentar.length
          ? "⏳ La Rama Judicial no respondió todavía"
          : "⚠️ No pudimos cargar tus procesos",
    body:
      (listos > 0 ? `Cargamos ${listos} proceso(s) de la Rama Judicial. Ya puedes revisarlos.` : "") +
      (r.yaEstaban ? ` ${r.yaEstaban} ya estaba(n) en tu lista.` : "") +
      (r.noEncontrados.length ? ` No existen en la Rama: ${r.noEncontrados.join(", ")}.` : "") +
      (r.fallidos.length + r.sinIntentar.length
        ? ` La Rama no respondió para: ${[...r.fallidos, ...r.sinIntentar].join(", ")}; lo seguimos intentando solos y te avisamos.`
        : ""),
    url: "/dashboard/procesos",
    tag: `agregados-${Date.now()}`,
  }).catch(() => {});
}

// ---------- Carga de procesos en segundo plano (web) ----------
// El abogado pega los radicados y sigue usando Estradox: la carga corre después
// de responder y la página de Procesos muestra el avance y el resultado.
export type CargaProcesos = {
  id: number;
  total: number;
  listos: number;
  estado: "cargando" | "listo";
  ok: string | null;
  error: string | null;
  createdAt: Date;
  detalle: string | null;
};

let cargasListas = false;
async function asegurarCargas() {
  if (cargasListas) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CargaProcesos" (
      id SERIAL PRIMARY KEY,
      "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
      total INTEGER NOT NULL,
      listos INTEGER NOT NULL DEFAULT 0,
      estado TEXT NOT NULL DEFAULT 'cargando',
      ok TEXT,
      error TEXT,
      visto BOOLEAN NOT NULL DEFAULT false,
      detalle TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "CargaProcesos" ADD COLUMN IF NOT EXISTS detalle TEXT`);
  cargasListas = true;
}

/** Registra la carga y la corre en segundo plano. */
export async function iniciarCargaProcesos(userId: string, radicados: string[], invalidos: string[] = []) {
  await asegurarCargas();
  const [c] = await prisma.$queryRawUnsafe<{ id: number }[]>(
    `INSERT INTO "CargaProcesos" ("userId", total) VALUES ($1, $2) RETURNING id`,
    userId,
    radicados.length,
  );
  enFondo(async () => {
    let r: ResultadoAgregar;
    try {
      r = await agregarRadicados(userId, radicados, Infinity, async (n) => {
        await prisma
          .$executeRawUnsafe(`UPDATE "CargaProcesos" SET listos = $2 WHERE id = $1`, c.id, n)
          .catch(() => {});
      });
    } catch (e) {
      console.error("[carga] fallo", e);
      r = {
        agregados: 0, yaEstaban: 0, pendientes: 0, privados: 0, noEncontrados: [], fallidos: radicados,
        sinIntentar: [], enFondo: 0, errores: [e instanceof Error ? e.message : String(e)],
      };
    }
    const m = mensajeAgregar(r, invalidos);
    await prisma.$executeRawUnsafe(
      `UPDATE "CargaProcesos" SET estado = 'listo', listos = total, ok = $2, error = $3, detalle = $4 WHERE id = $1`,
      c.id,
      m.ok ?? null,
      m.error ?? null,
      r.errores?.join("\n") ?? null,
    );
    await avisarCargaLista(userId, r);
  });
}

/** Cargas recientes que el abogado aún no cerró (para el aviso en Procesos). */
export async function cargasPendientesDeVer(userId: string): Promise<CargaProcesos[]> {
  await asegurarCargas();
  // Si el servidor se reinició a mitad de una carga, no se queda "cargando" para siempre.
  await prisma.$executeRawUnsafe(
    `UPDATE "CargaProcesos" SET estado = 'listo',
       error = 'La carga se interrumpió. Revisa tu lista y vuelve a agregar los que falten.'
     WHERE "userId" = $1 AND estado = 'cargando' AND "createdAt" < now() - interval '15 minutes'`,
    userId,
  );
  const cargas = await prisma.$queryRawUnsafe<CargaProcesos[]>(
    `SELECT id, total, listos, estado, ok, error, detalle, "createdAt" FROM "CargaProcesos"
     WHERE "userId" = $1 AND NOT visto AND "createdAt" > now() - interval '2 days'
     ORDER BY id DESC LIMIT 3`,
    userId,
  );

  // Aviso de falla cuyos radicados ya están en la lista (los cargó un reintento
  // o el abogado los agregó de nuevo): ya no aplica, se cierra solo.
  const conFalla = cargas.filter((c) => c.estado === "listo" && c.error);
  if (conFalla.length === 0) return cargas;
  const enLista = new Set(
    (
      await prisma.case.findMany({ where: { userId }, select: { radicado: true }, distinct: ["radicado"] })
    ).map((c) => c.radicado),
  );
  const resueltas = conFalla
    .filter((c) => {
      const rads = c.error!.match(/\d{23}/g) ?? [];
      return rads.length > 0 && rads.every((r) => enLista.has(r));
    })
    .map((c) => c.id);
  if (resueltas.length === 0) return cargas;
  await prisma.$executeRawUnsafe(
    `UPDATE "CargaProcesos" SET visto = true WHERE id = ANY($1::int[])`,
    resueltas,
  );
  return cargas.filter((c) => !resueltas.includes(c.id));
}

export async function marcarCargaVista(userId: string, id: number) {
  await asegurarCargas();
  await prisma.$executeRawUnsafe(
    `UPDATE "CargaProcesos" SET visto = true WHERE id = $1 AND "userId" = $2 AND estado = 'listo'`,
    id,
    userId,
  );
}

// ---------- Reintentos automáticos ----------
// Si la Rama no responde al agregar, el radicado queda aquí y el cron lo vuelve
// a intentar cada vez más espaciado (~31 h en total). El abogado no tiene que
// volver a pegarlo: se le avisa cuando queda cargado (o si no existe).
const ESPERAS_MIN = [5, 10, 20, 30, 60, 60, 120, 120, 240, 240, 480, 480];

let reintentosListos = false;
async function asegurarReintentos() {
  if (reintentosListos) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "RadicadoReintento" (
      "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
      radicado TEXT NOT NULL,
      intentos INTEGER NOT NULL DEFAULT 0,
      "proximoAt" TIMESTAMPTZ NOT NULL DEFAULT now() + interval '5 minutes',
      "ultimoError" TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY ("userId", radicado)
    )`);
  reintentosListos = true;
}

async function programarReintentos(userId: string, radicados: string[]) {
  if (radicados.length === 0) return;
  await asegurarReintentos();
  for (const rad of radicados) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "RadicadoReintento" ("userId", radicado) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      userId,
      rad,
    );
  }
}

/** Radicados del abogado que se están reintentando (para mostrarlos en Procesos). */
export async function reintentosDelUsuario(userId: string) {
  await asegurarReintentos();
  return prisma.$queryRawUnsafe<{ radicado: string; intentos: number; proximoAt: Date }[]>(
    `SELECT radicado, intentos, "proximoAt" FROM "RadicadoReintento" WHERE "userId" = $1 ORDER BY "createdAt"`,
    userId,
  );
}

/** Lo llama el cron: reintenta los radicados que ya toca. */
export async function procesarReintentos(presupuestoMs = 90_000) {
  await asegurarReintentos();
  const inicio = Date.now();
  const filas = await prisma.$queryRawUnsafe<{ userId: string; radicado: string; intentos: number }[]>(
    `SELECT "userId", radicado, intentos FROM "RadicadoReintento"
     WHERE "proximoAt" <= now() ORDER BY "proximoAt" LIMIT 20`,
  );
  const { sendPushToUser } = await import("./push");
  let cargados = 0;
  let fallidos = 0;
  for (const f of filas) {
    if (Date.now() - inicio > presupuestoMs) break;
    try {
      await agregarProcesoPorRadicado(f.userId, f.radicado);
      await prisma.$executeRawUnsafe(
        `DELETE FROM "RadicadoReintento" WHERE "userId" = $1 AND radicado = $2`,
        f.userId,
        f.radicado,
      );
      cargados++;
      // El aviso de "no pudimos cargar" de ese radicado ya no aplica.
      await prisma
        .$executeRawUnsafe(
          `UPDATE "CargaProcesos" SET visto = true
           WHERE "userId" = $1 AND estado = 'listo' AND ok IS NULL AND error LIKE '%' || $2 || '%'`,
          f.userId,
          f.radicado,
        )
        .catch(() => {});
      await sendPushToUser(f.userId, {
        title: "✅ Ya cargamos tu proceso",
        body: `La Rama Judicial respondió y el radicado ${f.radicado} ya está en tu lista. Ya puedes revisarlo.`,
        url: "/dashboard/procesos",
        tag: `reintento-${f.radicado}`,
      }).catch(() => {});
    } catch (err) {
      if (err instanceof RamaError && err.isRateLimit) break; // la Rama pidió pausar
      const noExiste = err instanceof RamaError && err.status === 404;
      const intentos = f.intentos + 1;
      if (noExiste || intentos >= ESPERAS_MIN.length) {
        await prisma.$executeRawUnsafe(
          `DELETE FROM "RadicadoReintento" WHERE "userId" = $1 AND radicado = $2`,
          f.userId,
          f.radicado,
        );
        await sendPushToUser(f.userId, {
          title: "⚠️ No pudimos cargar un proceso",
          body: noExiste
            ? `El radicado ${f.radicado} no existe en la Rama Judicial. Revisa el número.`
            : `La Rama Judicial no respondió por más de un día para ${f.radicado}. Intenta agregarlo de nuevo más tarde.`,
          url: "/dashboard/procesos",
          tag: `reintento-${f.radicado}`,
        }).catch(() => {});
      } else {
        await prisma.$executeRawUnsafe(
          `UPDATE "RadicadoReintento" SET intentos = $3, "ultimoError" = $4,
             "proximoAt" = now() + ($5 || ' minutes')::interval
           WHERE "userId" = $1 AND radicado = $2`,
          f.userId,
          f.radicado,
          intentos,
          (err instanceof Error ? err.message : String(err)).slice(0, 300),
          String(ESPERAS_MIN[intentos]),
        );
      }
      fallidos++;
    }
  }
  return { pendientes: filas.length, cargados, fallidos };
}

/** Mensajes para el usuario a partir del resultado (y los radicados mal escritos). */
export function mensajeAgregar(
  r: ResultadoAgregar,
  invalidos: string[] = [],
): { ok?: string; error?: string } {
  const ok: string[] = [];
  if (r.agregados) ok.push(`${r.agregados} proceso(s) agregado(s).`);
  if (r.pendientes) {
    ok.push(
      `${r.pendientes} agregado(s); la Rama no entregó sus actuaciones a tiempo y se cargarán en la próxima actualización.`,
    );
  }
  if (r.privados) {
    ok.push(`${r.privados} agregado(s), pero es privado: la Rama no publica sus actuaciones.`);
  }
  if (r.enFondo) {
    ok.push(
      `${r.enFondo} se está(n) cargando en segundo plano porque la Rama Judicial está lenta: aparecerán en tu lista en unos minutos y te avisamos al terminar.`,
    );
  }
  if (r.yaEstaban) ok.push(`${r.yaEstaban} ya estaba(n) en tu lista.`);

  const err: string[] = [];
  if (invalidos.length) {
    err.push(`No tienen 23 dígitos: ${invalidos.join(", ")}.`);
  }
  if (r.noEncontrados.length) {
    err.push(`No existen en la Rama Judicial: ${r.noEncontrados.join(", ")}.`);
  }
  const reintentar = [...r.fallidos, ...r.sinIntentar];
  if (reintentar.length) {
    err.push(
      `La Rama Judicial no respondió para: ${reintentar.join(", ")}. Lo seguiremos intentando automáticamente y te avisamos cuando quede cargado; no tienes que volver a agregarlo.`,
    );
  }
  return {
    ok: ok.length ? ok.join(" ") : undefined,
    error: err.length ? err.join(" ") : undefined,
  };
}

async function upsertProceso(userId: string, resumen: ProcesoResumen, limite = Infinity) {
  const idProceso = String(resumen.idProceso);

  const existing = await prisma.case.findUnique({
    where: { userId_idProceso: { userId, idProceso } },
  });

  const caseRow = await prisma.case.upsert({
    where: { userId_idProceso: { userId, idProceso } },
    update: {},
    create: {
      userId,
      idProceso,
      radicado: resumen.llaveProceso,
      despacho: resumen.despacho,
      departamento: resumen.departamento,
      sujetos: resumen.sujetosProcesales,
      esPrivado: resumen.esPrivado ?? false,
      fechaProceso: parseFecha(resumen.fechaProceso),
    },
  });

  const id = caseRow.id;
  const opts = { marcarComoVistas: !existing, docsActuacion: false };

  // Se acabó el tiempo de la petición: ya está en la lista y se carga después.
  if (Date.now() > limite) {
    enFondo(async () => {
      await sincronizarProceso(id, opts);
      await cargarDocumentosActuacionEnFondo(id);
    });
    return { ...caseRow, nuevo: !existing, pendiente: false, privado: false, cargando: true };
  }

  // Carga rápida: detalle y actuaciones. Partes y documentos van en segundo
  // plano. Si la Rama falla, el proceso igual queda en la lista: la cola lo completa.
  try {
    await sincronizarProceso(id, { ...opts, extrasEnFondo: true });
  } catch (err) {
    const privado = err instanceof Error && /privad/i.test(err.message);
    return { ...caseRow, nuevo: !existing, pendiente: !privado, privado, cargando: false };
  }
  // Los documentos descargables (por actuación) aparecen a los pocos segundos.
  enFondo(() => cargarDocumentosActuacionEnFondo(id));
  return { ...caseRow, nuevo: !existing, pendiente: false, privado: false, cargando: false };
}

/**
 * Re-consulta un proceso contra la Rama: actualiza el detalle, inserta las
 * actuaciones que falten y cuenta cuantas son nuevas.
 */
export async function sincronizarProceso(
  caseId: string,
  opts: {
    marcarComoVistas?: boolean;
    docsActuacion?: boolean;
    /** Partes y documentos después de responder (al agregar, para no hacer esperar). */
    extrasEnFondo?: boolean;
  } = {},
) {
  const caseRow = await prisma.case.findUnique({ where: { id: caseId } });
  if (!caseRow) throw new Error("Proceso no encontrado");

  const t0 = Date.now();
  try {
    // 1-2. Detalle y actuaciones en paralelo (la Rama es lenta).
    const [detalle, actuaciones] = await Promise.all([
      obtenerDetalle(caseRow.idProceso),
      obtenerActuaciones(caseRow.idProceso),
    ]);

    // 3. Insertar solo las nuevas
    const existentes = await prisma.actuacion.findMany({
      where: { caseId },
      select: { idRegActuacion: true },
    });
    const yaConocidas = new Set(existentes.map((a) => a.idRegActuacion));

    const nuevas = actuaciones.filter(
      (a) => !yaConocidas.has(String(a.idRegActuacion)),
    );

    if (nuevas.length > 0) {
      await prisma.actuacion.createMany({
        data: nuevas.map((a) => ({
          caseId,
          idRegActuacion: String(a.idRegActuacion),
          consActuacion: a.consActuacion ?? null,
          actuacion: a.actuacion ?? null,
          anotacion: a.anotacion ?? null,
          fechaActuacion: parseFecha(a.fechaActuacion),
          fechaRegistro: parseFecha(a.fechaRegistro),
          conDocumentos: a.conDocumentos ?? false,
          seenAt: opts.marcarComoVistas ? new Date() : null,
        })),
        skipDuplicates: true,
      });
    }

    const masReciente = laMasReciente(actuaciones); // no siempre vienen ordenadas
    const nuevasNoVistas = opts.marcarComoVistas ? 0 : nuevas.length;

    await prisma.case.update({
      where: { id: caseId },
      data: {
        despacho: detalle.despacho ?? caseRow.despacho,
        ponente: detalle.ponente,
        tipoProceso: detalle.tipoProceso,
        claseProceso: detalle.claseProceso,
        subclaseProceso: detalle.subclaseProceso,
        recurso: detalle.recurso,
        ubicacion: detalle.ubicacion,
        fechaProceso: parseFecha(detalle.fechaProceso) ?? caseRow.fechaProceso,
        lastSyncedAt: new Date(),
        lastActuacionDate: parseFecha(masReciente?.fechaActuacion),
        lastActuacionId: masReciente
          ? String(masReciente.idRegActuacion)
          : caseRow.lastActuacionId,
        unseenCount: { increment: nuevasNoVistas },
        lastError: null,
      },
    });

    await prisma.syncLog.create({
      data: {
        caseId,
        operacion: "Actuaciones",
        resultado: "exito",
        durationMs: Date.now() - t0,
        elementos: nuevas.length,
      },
    });

    // Partes y Documentos (cada uno con su propio registro, sin romper el sync).
    const extras = () =>
      Promise.all([
        sincronizarSujetos(caseId, caseRow.idProceso),
        sincronizarDocumentos(caseId, caseRow.idProceso, actuaciones, opts.docsActuacion !== false),
      ]);
    if (opts.extrasEnFondo) enFondo(extras);
    else await extras();

    return {
      nuevas: nuevas.length,
      total: actuaciones.length,
      nuevasList: nuevas,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.case.update({
      where: { id: caseId },
      data: { lastSyncedAt: new Date(), lastError: msg.slice(0, 500) },
    });
    await prisma.syncLog
      .create({
        data: {
          caseId,
          operacion: "Actuaciones",
          resultado: "fallo",
          durationMs: Date.now() - t0,
          elementos: 0,
          error: msg.slice(0, 500),
        },
      })
      .catch(() => {});
    throw err;
  }
}

/** Trae y guarda las partes (sujetos) del proceso; registra en SyncLog. */
async function sincronizarSujetos(caseId: string, idProceso: string) {
  const t = Date.now();
  try {
    const sujetos = await obtenerSujetos(idProceso);
    await prisma.parte.deleteMany({ where: { caseId } });
    if (sujetos.length > 0) {
      await prisma.parte.createMany({
        data: sujetos.map((s) => ({
          caseId,
          idRegSujeto: String(s.idRegSujeto),
          nombre: (s.nombreRazonSocial ?? "").replace(/\s+/g, " ").trim() || null,
          tipoSujeto: s.tipoSujeto ?? null,
          identificacion: s.identificacion ?? null,
        })),
        skipDuplicates: true,
      });
    }
    await prisma.syncLog.create({
      data: {
        caseId,
        operacion: "Partes",
        resultado: "exito",
        durationMs: Date.now() - t,
        elementos: sujetos.length,
      },
    });
  } catch (err) {
    await prisma.syncLog
      .create({
        data: {
          caseId,
          operacion: "Partes",
          resultado: "fallo",
          durationMs: Date.now() - t,
          elementos: 0,
          error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
        },
      })
      .catch(() => {});
  }
}

/**
 * Trae y guarda los documentos del proceso: los de nivel proceso + los de
 * cada actuación con documentos (estos últimos son los descargables).
 */
async function sincronizarDocumentos(
  caseId: string,
  idProceso: string,
  actuaciones: RamaActuacion[],
  perActuacion = true,
) {
  const t = Date.now();
  try {
    const todos = await obtenerDocumentos(idProceso);

    // Documentos por actuación (lo lento; opcional). Cap para no saturar.
    if (perActuacion) {
      const conDocs = actuaciones.filter((a) => a.conDocumentos).slice(0, 30);
      for (const a of conDocs) {
        const d = await obtenerDocumentosActuacion(a.idRegActuacion);
        todos.push(...d);
        await new Promise((res) => setTimeout(res, 300));
      }
    }

    // Dedupe por idRegDocumento.
    const vistos = new Set<string>();
    const docs = todos.filter((d) => {
      const k = String(d.idRegDocumento);
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });

    if (docs.length > 0) {
      await prisma.documento.createMany({
        data: docs.map((d) => ({
          caseId,
          idRegDocumento: String(d.idRegDocumento),
          nombre: d.nombre ?? null,
          descripcion: d.descripcion ?? null,
          tipo: d.tipo || null,
          fechaCarga: parseFecha(d.fechaCarga),
          consActuacion: d.consActuacion ?? null,
        })),
        skipDuplicates: true,
      });
    }
    await prisma.syncLog.create({
      data: {
        caseId,
        operacion: "Documentos",
        resultado: "exito",
        durationMs: Date.now() - t,
        elementos: docs.length,
      },
    });
  } catch (err) {
    await prisma.syncLog
      .create({
        data: {
          caseId,
          operacion: "Documentos",
          resultado: "fallo",
          durationMs: Date.now() - t,
          elementos: 0,
          error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
        },
      })
      .catch(() => {});
  }
}

/**
 * Trae los documentos por actuación (los descargables) en segundo plano, leyendo
 * las actuaciones ya guardadas. Permite que agregar un proceso sea rápido.
 */
/**
 * Control por actuación de sus documentos: "docsIntentos" cuenta las veces que
 * la Rama falló al pedirlos; 99 = ya se pidieron con éxito (tengan o no).
 * Pendiente = dice "con documentos", no tiene ninguno guardado y no se ha
 * pedido con éxito ni agotado los intentos.
 */
const MAX_INTENTOS_DOCS = 6;
const SQL_ACT_PENDIENTE = `a."conDocumentos" AND a."docsIntentos" < ${MAX_INTENTOS_DOCS}
  AND NOT EXISTS (SELECT 1 FROM "Documento" d
                  WHERE d."caseId" = a."caseId" AND d."consActuacion" = a."consActuacion")`;
let columnasDocsListas = false;
async function asegurarColumnasDocs() {
  if (columnasDocsListas) return;
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Actuacion" ADD COLUMN IF NOT EXISTS "docsIntentos" INT NOT NULL DEFAULT 0`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Case" ADD COLUMN IF NOT EXISTS "docsIntentoAt" TIMESTAMP`,
  );
  columnasDocsListas = true;
}

/**
 * Pide los documentos de las actuaciones pendientes del proceso (las más
 * recientes primero, 30 por vez). Lo que falle queda pendiente y el cron lo
 * vuelve a pedir; así ningún documento se pierde por una caída de la Rama.
 */
async function cargarDocumentosActuacionEnFondo(
  caseId: string,
): Promise<{ docs: number; fallas: number; pedidas: number }> {
  const t = Date.now();
  let fallas = 0;
  let total = 0;
  let pedidas = 0;
  try {
    await asegurarColumnasDocs();
    const acts = await prisma.$queryRawUnsafe<{ id: string; idRegActuacion: string }[]>(
      `SELECT a.id, a."idRegActuacion" FROM "Actuacion" a
       WHERE a."caseId" = $1 AND ${SQL_ACT_PENDIENTE}
       ORDER BY a."fechaActuacion" DESC NULLS LAST LIMIT 30`,
      caseId,
    );
    let seguidas = 0;
    for (const a of acts) {
      pedidas++;
      try {
        const d = await obtenerDocumentosActuacion(a.idRegActuacion);
        if (d.length > 0) {
          await prisma.documento.createMany({
            data: d.map((x) => ({
              caseId,
              idRegDocumento: String(x.idRegDocumento),
              nombre: x.nombre ?? null,
              descripcion: x.descripcion ?? null,
              tipo: x.tipo || null,
              fechaCarga: parseFecha(x.fechaCarga),
              consActuacion: x.consActuacion ?? null,
            })),
            skipDuplicates: true,
          });
          total += d.length;
        }
        // Se marca solo después de guardar: si guardar falla, queda pendiente.
        await prisma.$executeRawUnsafe(`UPDATE "Actuacion" SET "docsIntentos" = 99 WHERE id = $1`, a.id);
        seguidas = 0;
      } catch {
        fallas++;
        await prisma
          .$executeRawUnsafe(`UPDATE "Actuacion" SET "docsIntentos" = "docsIntentos" + 1 WHERE id = $1`, a.id)
          .catch(() => {});
        // Tres fallas seguidas = la Rama está caída: se reintenta más tarde.
        if (++seguidas >= 3) break;
      }
      await new Promise((res) => setTimeout(res, 400));
    }
    if (pedidas > 0) {
      await prisma.syncLog
        .create({
          data: {
            caseId,
            operacion: "Documentos",
            resultado: fallas > 0 && total === 0 ? "fallo" : "exito",
            durationMs: Date.now() - t,
            elementos: total,
            error: fallas > 0 ? `La Rama falló en ${fallas} actuación(es); se reintenta sola` : null,
          },
        })
        .catch(() => {});
    }
    console.log("[docs-fondo]", caseId, { pedidas, docs: total, fallas, ms: Date.now() - t });
    return { docs: total, fallas, pedidas };
  } catch (err) {
    console.error("[docs-fondo] error", caseId, err);
    return { docs: total, fallas: fallas + 1, pedidas };
  }
}

/**
 * Documentos que no llegaron (la Rama falló al agregar el proceso o en la
 * revisión nocturna, o quedaron más allá de las 30 actuaciones de la primera
 * carga). Un proceso por corrida del cron, sin repetir el mismo antes de 20 min.
 */
export async function completarDocumentosPendientes() {
  await asegurarColumnasDocs();
  const [c] = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT c.id FROM "Case" c
     WHERE (c."docsIntentoAt" IS NULL OR c."docsIntentoAt" < now() - interval '20 minutes')
       AND EXISTS (SELECT 1 FROM "Actuacion" a WHERE a."caseId" = c.id AND ${SQL_ACT_PENDIENTE})
     ORDER BY c."createdAt" DESC LIMIT 1`,
  );
  if (!c) return { pendientes: 0 };
  await prisma.$executeRawUnsafe(`UPDATE "Case" SET "docsIntentoAt" = now() WHERE id = $1`, c.id);
  return { caso: c.id, ...(await cargarDocumentosActuacionEnFondo(c.id)) };
}

/** Marca todas las actuaciones de un proceso como vistas. */
export async function marcarVistas(caseId: string) {
  await prisma.actuacion.updateMany({
    where: { caseId, seenAt: null },
    data: { seenAt: new Date() },
  });
  await prisma.case.update({ where: { id: caseId }, data: { unseenCount: 0 } });
}

/** Construye y envia el correo-resumen de actuaciones nuevas a un abogado. */
export async function enviarResumen(
  email: string,
  name: string | null,
  casos: { radicado: string; caseId: string; nuevas: RamaActuacion[] }[],
) {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const totalNuevas = casos.reduce((n, c) => n + c.nuevas.length, 0);

  const bloques = casos
    .map((c) => {
      const items = c.nuevas
        .slice(0, 10)
        .map((a) => {
          const fecha =
            fechaRama(a.fechaActuacion)?.toLocaleDateString("es-CO", {
              timeZone: "America/Bogota",
            }) ?? "";
          return `<li><strong>${escapeHtml(a.actuacion ?? "Actuacion")}</strong> — ${fecha}${
            a.anotacion ? `<br/><span style="color:#555">${escapeHtml(a.anotacion)}</span>` : ""
          }</li>`;
        })
        .join("");
      const extra =
        c.nuevas.length > 10 ? `<li>…y ${c.nuevas.length - 10} mas</li>` : "";
      return `
        <div style="margin:16px 0;padding:12px;border:1px solid #e5e7eb;border-radius:8px">
          <div style="font-family:monospace">${escapeHtml(c.radicado)}</div>
          <ul>${items}${extra}</ul>
          <a href="${appUrl}/dashboard/procesos/${c.caseId}">Ver proceso</a>
        </div>`;
    })
    .join("");

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:620px;margin:0 auto">
      <img src="${urlAbsoluta(LOGOS.correo)}" alt="Estradox" height="26" style="margin-bottom:12px" />
      <h2>Tienes ${totalNuevas} actuacion(es) nueva(s)</h2>
      <p>Hola ${escapeHtml(name ?? "")}, se detectaron novedades en ${casos.length} de tus procesos:</p>
      ${bloques}
      <p style="color:#777;font-size:12px">Estradox — actualización automática.</p>
    </div>`;

  const text =
    `Tienes ${totalNuevas} actuacion(es) nueva(s) en ${casos.length} proceso(s):\n\n` +
    casos
      .map(
        (c) =>
          `${c.radicado}: ${c.nuevas.length} nuevas\n  ${appUrl}/dashboard/procesos/${c.caseId}`,
      )
      .join("\n\n");

  await sendMail({
    to: email,
    subject: `${totalNuevas} actuacion(es) nueva(s) en tus procesos`,
    html,
    text,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Intentos de carga por abogado (Panel admin → Usuarios). */
export async function resumenCargasPorUsuario() {
  await asegurarCargas();
  await asegurarReintentos();
  const filas = await prisma.$queryRawUnsafe<
    { userId: string; cargas: bigint; conError: bigint; reintentos: bigint }[]
  >(
    `SELECT u.id AS "userId",
            (SELECT count(*) FROM "CargaProcesos" c WHERE c."userId" = u.id) AS cargas,
            (SELECT count(*) FROM "CargaProcesos" c WHERE c."userId" = u.id AND c.error IS NOT NULL) AS "conError",
            (SELECT count(*) FROM "RadicadoReintento" r WHERE r."userId" = u.id) AS reintentos
     FROM "User" u`,
  );
  return new Map(
    filas.map((f) => [f.userId, { cargas: Number(f.cargas), conError: Number(f.conError), reintentos: Number(f.reintentos) }]),
  );
}

/**
 * Carga reciente del abogado para el aviso flotante de escritorio: la que está
 * cargando o terminó en la última hora y aún no cerró. Una sola consulta.
 */
export async function cargaParaAviso(userId: string) {
  await asegurarCargas();
  const [c] = await prisma.$queryRawUnsafe<
    { id: number; estado: "cargando" | "listo"; ok: string | null; error: string | null }[]
  >(
    `SELECT id, estado, ok, error FROM "CargaProcesos"
     WHERE "userId" = $1 AND NOT visto AND "createdAt" > now() - interval '1 hour'
     ORDER BY id DESC LIMIT 1`,
    userId,
  );
  return c ?? null;
}

/** Estado de una carga del abogado (lo consulta el aviso mientras carga). */
export async function estadoCarga(userId: string, id: number) {
  await asegurarCargas();
  const [c] = await prisma.$queryRawUnsafe<
    { id: number; estado: "cargando" | "listo"; ok: string | null; error: string | null }[]
  >(
    `SELECT id, estado, ok, error FROM "CargaProcesos" WHERE id = $1 AND "userId" = $2`,
    id,
    userId,
  );
  return c ?? null;
}
