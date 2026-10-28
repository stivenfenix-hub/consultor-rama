import "server-only";
import { prisma } from "./db";
import { ensureColumn } from "./runtime-columns";
import {
  obtenerActuacionesNuevas,
  obtenerDetalle,
  obtenerDocumentos,
  obtenerDocumentosActuacion,
  obtenerSujetos,
  RamaError,
  type Actuacion as RamaActuacion,
  type Documento as RamaDocumento,
} from "./rama";
import { usuariosConAcceso } from "./subscription";
import { enviarResumen, procesarReintentos } from "./sync";
import { sendPushToUser } from "./push";
import { revisarRama } from "./monitor-rama";
import {
  avisarReporteSinProcesos,
  enviarReporteWhatsapp,
  registrarAvisoWhatsapp,
  textoActuaciones,
} from "./reporte-whatsapp";

/**
 * Sincronización nocturna por cola.
 *
 * Un cron llama a tick() cada 5 minutos, todo el día; el código decide qué hacer
 * según la hora de Bogotá:
 *   - 8:00 p.m. a 6:45 a.m.: revisa procesos por lotes, a ritmo controlado.
 *     Los activos se revisan dos veces por noche (una pasada desde las 8 p.m. y
 *     otra desde las 3 a.m.), así lo último antes del resumen está fresco.
 *   - Desde las 7:00 a.m.: envía UN resumen por abogado (correo + push) con las
 *     actuaciones nuevas que encontró la noche.
 *
 * Reglas anti-bloqueo: una sola consulta por proceso de la Rama aunque lo sigan
 * varios abogados, revisión liviana (página 1 de actuaciones), pausas aleatorias,
 * pocas consultas a la vez y freno automático ante 429/403.
 */

// ---------- Configuración (con variables de entorno opcionales) ----------
const num = (v: string | undefined, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : def;
};
const CONCURRENCIA = num(process.env.SYNC_CONCURRENCY, 2); // consultas a la vez
const PAUSA_MIN_MS = num(process.env.SYNC_PAUSE_MIN_MS, 1500);
const PAUSA_MAX_MS = num(process.env.SYNC_PAUSE_MAX_MS, 3000);
const PRESUPUESTO_MS = num(process.env.SYNC_BUDGET_MS, 240_000); // por corrida de 5 min
const LOCK_MS = PRESUPUESTO_MS + 120_000;

// Horario (hora Bogotá, en minutos desde la medianoche).
const VENTANA_INICIO = 20 * 60; // 8:00 p.m.
const VENTANA_FIN = 6 * 60 + 45; // 6:45 a.m.
const SEGUNDA_PASADA = 3 * 60; // 3:00 a.m.
const RESUMEN_DESDE = 7 * 60; // 7:00 a.m.
const RESUMEN_HASTA = 20 * 60; // no se avisa de noche
const REPORTE_WA = 7 * 60 + 30; // 7:30 a.m.: Excel de avisos para WhatsApp
const REPORTE_SIN_PROCESOS = 7 * 60 + 20; // 7:20 a.m.: registrados ayer sin procesos (root)

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;
const BOGOTA_OFFSET = -5 * HORA; // Colombia no tiene horario de verano

// ---------- Columnas (se crean solas en producción) ----------
let listo: Promise<void> | null = null;
export function asegurarColumnasCola() {
  listo ??= (async () => {
    await ensureColumn("Case", "nextCheckAt", "TIMESTAMPTZ");
    await ensureColumn("Case", "lastCheckedAt", "TIMESTAMPTZ");
    await ensureColumn("Case", "syncStatus", "TEXT NOT NULL DEFAULT 'pending'");
    await ensureColumn("Case", "retryCount", "INTEGER NOT NULL DEFAULT 0");
    await ensureColumn("Case", "lastFullSyncAt", "TIMESTAMPTZ");
    await ensureColumn("Actuacion", "pendingNotify", "BOOLEAN NOT NULL DEFAULT false");
    for (const col of ["syncLockUntil", "syncPausedUntil", "syncLastTickAt"]) {
      await ensureColumn("SiteSetting", col, "TIMESTAMPTZ");
    }
    await ensureColumn("SiteSetting", "syncPauseMs", "INTEGER");
    await ensureColumn("SiteSetting", "syncLastTickInfo", "TEXT");
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "Case_nextCheckAt_idx" ON "Case" ("nextCheckAt" ASC NULLS FIRST)`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "Actuacion_pendingNotify_idx" ON "Actuacion" ("caseId") WHERE "pendingNotify"`,
    );
    await prisma.siteSetting.upsert({ where: { id: "site" }, create: { id: "site" }, update: {} });
  })().catch((e) => {
    listo = null;
    throw e;
  });
  return listo;
}

// ---------- Hora de Bogotá ----------
function minutosBogota(d = new Date()) {
  const b = new Date(d.getTime() + BOGOTA_OFFSET);
  return b.getUTCHours() * 60 + b.getUTCMinutes();
}
export function enVentanaNocturna(d = new Date()) {
  const m = minutosBogota(d);
  return m >= VENTANA_INICIO || m < VENTANA_FIN;
}
/** Próxima vez (después de `desde`) que en Bogotá sean las `minutos`, + días extra. */
function proximaHora(minutos: number, diasExtra = 0, desde = new Date()) {
  const b = new Date(desde.getTime() + BOGOTA_OFFSET);
  const medianoche = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()) - BOGOTA_OFFSET;
  let t = medianoche + minutos * MIN;
  if (t <= desde.getTime()) t += DIA;
  return new Date(t + diasExtra * DIA);
}
/** Inicio de la ventana nocturna actual (o de la última, si es de día). */
export function inicioVentanaActual(d = new Date()) {
  const t = proximaHora(VENTANA_INICIO, 0, d);
  return new Date(t.getTime() - DIA);
}

/** Cuándo volver a revisar un proceso que salió bien, según su actividad. */
function siguienteRevision(ultimaActuacion: Date | null, ahora = new Date()) {
  const dias = ultimaActuacion ? (ahora.getTime() - ultimaActuacion.getTime()) / DIA : 0;
  if (dias > 365) return proximaHora(VENTANA_INICIO, 6, ahora); // dormido: semanal
  if (dias > 90) return proximaHora(VENTANA_INICIO, 1, ahora); // tranquilo: cada 2 días
  // Activo: dos veces por noche (8 p.m. y 3 a.m.).
  const m = minutosBogota(ahora);
  // (Si se revisó poco antes de las 3 a.m., cuenta como la segunda pasada.)
  const primeraPasada = m >= VENTANA_INICIO || m < SEGUNDA_PASADA - 60;
  return primeraPasada ? proximaHora(SEGUNDA_PASADA, 0, ahora) : proximaHora(VENTANA_INICIO, 0, ahora);
}

const esperaPorFallo = [15 * MIN, 30 * MIN, HORA, 2 * HORA, 4 * HORA];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = () => PAUSA_MIN_MS + Math.random() * Math.max(0, PAUSA_MAX_MS - PAUSA_MIN_MS);

// ---------- Lock entre corridas (también entre procesos del servidor) ----------
async function tomarLock(): Promise<boolean> {
  const n = await prisma.$executeRawUnsafe(
    `UPDATE "SiteSetting" SET "syncLockUntil" = now() + ($1 || ' milliseconds')::interval
     WHERE id = 'site' AND ("syncLockUntil" IS NULL OR "syncLockUntil" < now())`,
    String(LOCK_MS),
  );
  return n > 0;
}
async function soltarLock() {
  await prisma.$executeRawUnsafe(`UPDATE "SiteSetting" SET "syncLockUntil" = NULL WHERE id = 'site'`);
}

// ---------- Procesamiento de la cola ----------
type CasoCola = {
  id: string;
  userId: string;
  idProceso: string;
  lastActuacionDate: Date | null;
  lastFullSyncAt: Date | null;
  retryCount: number;
};

type ResultadoLote = {
  revisados: number;
  conNovedad: number;
  actuacionesNuevas: number;
  fallidos: number;
  consultas: number;
  frenado: boolean;
};

/**
 * Revisa un proceso de la Rama para uno o varios abogados. `notificar`: las
 * actuaciones nuevas quedan para el resumen de las 7 a.m. (la cola nocturna);
 * en el refresco manual no, porque el abogado ya las está viendo.
 */
async function procesarGrupo(casos: CasoCola[], r: ResultadoLote, notificar = true) {
  const idProceso = casos[0].idProceso;
  const ids = casos.map((c) => c.id);

  // Lo que ya conoce cada abogado de este proceso.
  const filas = await prisma.actuacion.findMany({
    where: { caseId: { in: ids } },
    select: { caseId: true, idRegActuacion: true },
  });
  const porCaso = new Map(ids.map((id) => [id, new Set<string>()]));
  for (const f of filas) porCaso.get(f.caseId)?.add(f.idRegActuacion);
  // Se consulta con lo que conocen TODOS; luego cada abogado recibe lo suyo.
  const sets = [...porCaso.values()];
  const comunes = new Set([...sets[0]].filter((x) => sets.every((s) => s.has(x))));

  const { nuevas, masReciente, consultas } = await obtenerActuacionesNuevas(idProceso, comunes);
  r.consultas += consultas;

  const ahora = new Date();
  const ultima = parseFecha(masReciente?.fechaActuacion);
  let huboNovedad = false;

  for (const c of casos) {
    const conocidas = porCaso.get(c.id)!;
    const suyas = nuevas.filter((a) => !conocidas.has(String(a.idRegActuacion)));
    // Primera carga (se agregó pero la Rama no respondió en ese momento): el
    // historial no es novedad; se guarda como visto y sin avisar.
    const primeraCarga = conocidas.size === 0 && !c.lastActuacionDate;
    if (suyas.length > 0 && primeraCarga) {
      await prisma.actuacion.createMany({
        data: suyas.map((a) => ({
          caseId: c.id,
          idRegActuacion: String(a.idRegActuacion),
          consActuacion: a.consActuacion ?? null,
          actuacion: a.actuacion ?? null,
          anotacion: a.anotacion ?? null,
          fechaActuacion: parseFecha(a.fechaActuacion),
          fechaRegistro: parseFecha(a.fechaRegistro),
          conDocumentos: a.conDocumentos ?? false,
          seenAt: ahora,
        })),
        skipDuplicates: true,
      });
    } else if (suyas.length > 0) {
      huboNovedad = true;
      r.actuacionesNuevas += suyas.length;
      await prisma.actuacion.createMany({
        data: suyas.map((a) => ({
          caseId: c.id,
          idRegActuacion: String(a.idRegActuacion),
          consActuacion: a.consActuacion ?? null,
          actuacion: a.actuacion ?? null,
          anotacion: a.anotacion ?? null,
          fechaActuacion: parseFecha(a.fechaActuacion),
          fechaRegistro: parseFecha(a.fechaRegistro),
          conDocumentos: a.conDocumentos ?? false,
          seenAt: null,
        })),
        skipDuplicates: true,
      });
      if (notificar) await prisma.$executeRawUnsafe(
        `UPDATE "Actuacion" SET "pendingNotify" = true
         WHERE "caseId" = $1 AND "idRegActuacion" = ANY($2::text[]) AND "seenAt" IS NULL`,
        c.id,
        suyas.map((a) => String(a.idRegActuacion)),
      );
      await prisma.case.update({
        where: { id: c.id },
        data: { unseenCount: { increment: suyas.length } },
      });
    }
    const proxima = siguienteRevision(ultima ?? c.lastActuacionDate, ahora);
    await prisma.$executeRawUnsafe(
      `UPDATE "Case" SET "lastCheckedAt" = now(), "lastSyncedAt" = now(), "nextCheckAt" = $2::timestamptz,
         "syncStatus" = 'ok', "retryCount" = 0, "lastError" = NULL,
         "lastActuacionDate" = GREATEST($3::timestamp, "lastActuacionDate"),
         "lastActuacionId" = COALESCE($4::text, "lastActuacionId")
       WHERE id = $1`,
      c.id,
      proxima,
      ultima,
      masReciente ? String(masReciente.idRegActuacion) : null,
    );
  }
  if (huboNovedad) r.conNovedad++;

  // Datos extra solo cuando hace falta: si hubo novedad (detalle + documentos de
  // las actuaciones nuevas) o una vez por semana (detalle + partes).
  const semanal = casos.some((c) => !c.lastFullSyncAt || ahora.getTime() - c.lastFullSyncAt.getTime() > 7 * DIA);
  if (!huboNovedad && !semanal) return;
  try {
    await sleep(jitter());
    const detalle = await obtenerDetalle(idProceso, 1);
    r.consultas++;
    await prisma.case.updateMany({
      where: { id: { in: ids } },
      data: {
        ponente: detalle.ponente,
        tipoProceso: detalle.tipoProceso,
        claseProceso: detalle.claseProceso,
        subclaseProceso: detalle.subclaseProceso,
        recurso: detalle.recurso,
        ubicacion: detalle.ubicacion,
        ...(detalle.despacho ? { despacho: detalle.despacho } : {}),
      },
    });
    if (huboNovedad) {
      await sleep(jitter());
      const docs: RamaDocumento[] = await obtenerDocumentos(idProceso);
      r.consultas++;
      for (const a of nuevas.filter((x) => x.conDocumentos).slice(0, 10)) {
        await sleep(jitter());
        docs.push(...(await obtenerDocumentosActuacion(a.idRegActuacion)));
        r.consultas++;
      }
      await guardarDocumentos(ids, docs);
    }
    if (semanal) {
      await sleep(jitter());
      const sujetos = await obtenerSujetos(idProceso);
      r.consultas++;
      for (const id of ids) {
        await prisma.parte.deleteMany({ where: { caseId: id } });
        if (sujetos.length > 0) {
          await prisma.parte.createMany({
            data: sujetos.map((s) => ({
              caseId: id,
              idRegSujeto: String(s.idRegSujeto),
              nombre: (s.nombreRazonSocial ?? "").replace(/s+/g, " ").trim() || null,
              tipoSujeto: s.tipoSujeto ?? null,
              identificacion: s.identificacion ?? null,
            })),
            skipDuplicates: true,
          });
        }
      }
      await prisma.$executeRawUnsafe(
        `UPDATE "Case" SET "lastFullSyncAt" = now() WHERE id = ANY($1::text[])`,
        ids,
      );
    }
  } catch (err) {
    // Las actuaciones ya quedaron guardadas; lo extra se reintenta otra noche.
    if (err instanceof RamaError && err.isRateLimit) throw err;
  }
}

async function guardarDocumentos(caseIds: string[], docs: RamaDocumento[]) {
  const vistos = new Set<string>();
  const unicos = docs.filter((d) => {
    const k = String(d.idRegDocumento);
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
  if (unicos.length === 0) return;
  for (const caseId of caseIds) {
    await prisma.documento.createMany({
      data: unicos.map((d) => ({
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
}

/** Aviso para el abogado cuando la Rama no publica las actuaciones. */
export const MSG_PRIVADO = "Proceso privado: la Rama Judicial no publica sus actuaciones.";

/** La Rama responde "No se pueden ver actuaciones de un proceso privado". */
export function esProcesoPrivado(err: unknown) {
  return err instanceof Error && /privad/i.test(err.message);
}

async function marcarFallo(casos: CasoCola[], err: unknown) {
  const msg = (err instanceof Error ? err.message : String(err)).slice(0, 500);
  if (esProcesoPrivado(err)) {
    // No es una falla: se revisa una vez por semana por si deja de ser privado.
    await prisma.$executeRawUnsafe(
      `UPDATE "Case" SET "lastCheckedAt" = now(), "nextCheckAt" = $2::timestamptz,
         "syncStatus" = 'privado', "retryCount" = 0, "lastError" = $3::text
       WHERE id = ANY($1::text[])`,
      casos.map((c) => c.id),
      proximaHora(VENTANA_INICIO, 6),
      MSG_PRIVADO,
    );
    return;
  }
  const negocio = err instanceof RamaError && (err.status === 400 || err.status === 404);
  for (const c of casos) {
    const intentos = c.retryCount + 1;
    // Al abogado solo se le muestra el error si persiste (3+ intentos).
    const proxima = negocio
      ? proximaHora(VENTANA_INICIO) // no existe / privado: se intenta otra noche
      : new Date(Date.now() + esperaPorFallo[Math.min(intentos, esperaPorFallo.length) - 1]);
    await prisma.$executeRawUnsafe(
      `UPDATE "Case" SET "lastCheckedAt" = now(), "nextCheckAt" = $2::timestamptz, "syncStatus" = 'error',
         "retryCount" = $3::int,
         "lastError" = CASE WHEN $3::int >= 3 THEN $4::text ELSE "lastError" END
       WHERE id = $1`,
      c.id,
      proxima,
      intentos,
      msg,
    );
  }
  await prisma.syncLog
    .create({
      data: { caseId: casos[0].id, operacion: "Cola", resultado: "fallo", durationMs: 0, elementos: 0, error: msg },
    })
    .catch(() => {});
}

/** Revisa procesos durante PRESUPUESTO_MS. */
async function procesarCola(): Promise<ResultadoLote> {
  const r: ResultadoLote = { revisados: 0, conNovedad: 0, actuacionesNuevas: 0, fallidos: 0, consultas: 0, frenado: false };
  const inicio = Date.now();
  const conAcceso = await usuariosConAcceso().catch(() => null);

  const vencidos = await prisma.$queryRawUnsafe<CasoCola[]>(
    `SELECT id, "userId", "idProceso", "lastActuacionDate", "lastFullSyncAt", "retryCount"
     FROM "Case"
     WHERE "nextCheckAt" IS NULL OR "nextCheckAt" <= now()
     ORDER BY "nextCheckAt" ASC NULLS FIRST, "lastCheckedAt" ASC NULLS FIRST
     LIMIT 600`,
  );

  // Cuentas sin acceso (prueba/plan vencido): no se consultan; se miran mañana.
  const sinAcceso = conAcceso ? vencidos.filter((c) => !conAcceso.has(c.userId)) : [];
  if (sinAcceso.length > 0) {
    await prisma.$executeRawUnsafe(
      `UPDATE "Case" SET "nextCheckAt" = now() + interval '12 hours' WHERE id = ANY($1::text[])`,
      sinAcceso.map((c) => c.id),
    );
  }
  const activos = conAcceso ? vencidos.filter((c) => conAcceso.has(c.userId)) : vencidos;

  // Un grupo por proceso de la Rama (varios abogados pueden seguir el mismo).
  const grupos = new Map<string, CasoCola[]>();
  for (const c of activos) {
    const g = grupos.get(c.idProceso) ?? [];
    g.push(c);
    grupos.set(c.idProceso, g);
  }
  const pendientes = [...grupos.values()];

  const trabajador = async (n: number) => {
    await sleep(n * 700); // arranque escalonado
    while (!r.frenado && Date.now() - inicio < PRESUPUESTO_MS) {
      const grupo = pendientes.shift();
      if (!grupo) return;
      try {
        await procesarGrupo(grupo, r);
        r.revisados += grupo.length;
      } catch (err) {
        if (err instanceof RamaError && err.isRateLimit) {
          r.frenado = true;
          await prisma.$executeRawUnsafe(
            `UPDATE "Case" SET "syncStatus" = 'rate_limited', "nextCheckAt" = now() + interval '15 minutes'
             WHERE id = ANY($1::text[])`,
            grupo.map((c) => c.id),
          );
          return;
        }
        r.fallidos += grupo.length;
        await marcarFallo(grupo, err).catch(() => {});
      }
      await sleep(jitter());
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCIA }, (_, i) => trabajador(i)));
  return r;
}

/**
 * Refresco manual de un proceso (botón "Actualizar" y "Actualizar todos"):
 * misma revisión liviana que la cola nocturna, así un abogado con muchos
 * procesos no dispara cientos de consultas a la Rama.
 */
export async function revisarProcesoManual(caseId: string) {
  await asegurarColumnasCola();
  const [c] = await prisma.$queryRawUnsafe<CasoCola[]>(
    `SELECT id, "userId", "idProceso", "lastActuacionDate", "lastFullSyncAt", "retryCount"
     FROM "Case" WHERE id = $1`,
    caseId,
  );
  if (!c) throw new Error("Proceso no encontrado");
  const r: ResultadoLote = { revisados: 0, conNovedad: 0, actuacionesNuevas: 0, fallidos: 0, consultas: 0, frenado: false };
  try {
    await procesarGrupo([c], r, false);
  } catch (err) {
    const msg = esProcesoPrivado(err) ? MSG_PRIVADO : (err instanceof Error ? err.message : String(err)).slice(0, 500);
    await prisma.case.update({ where: { id: caseId }, data: { lastError: msg } }).catch(() => {});
    throw err;
  }
  return { nuevas: r.actuacionesNuevas };
}

// ---------- Resumen de las 7 a.m. ----------
type FilaAviso = {
  id: string;
  caseId: string;
  radicado: string;
  userId: string;
  email: string;
  name: string | null;
  actuacion: string | null;
  anotacion: string | null;
  fechaActuacion: Date | null;
  seenAt: Date | null;
};

/** Envía un resumen por abogado con las actuaciones pendientes de avisar. */
export async function enviarResumenesPendientes(presupuestoMs = 200_000) {
  const inicio = Date.now();
  const filas = await prisma.$queryRawUnsafe<FilaAviso[]>(
    `SELECT a.id, a."caseId", c.radicado, c."userId", u.email, u.name,
            a.actuacion, a.anotacion, a."fechaActuacion", a."seenAt"
     FROM "Actuacion" a
     JOIN "Case" c ON c.id = a."caseId"
     JOIN "User" u ON u.id = c."userId"
     WHERE a."pendingNotify"
     ORDER BY c."userId", c.radicado, a."fechaActuacion" DESC NULLS LAST`,
  );
  const porUsuario = new Map<string, FilaAviso[]>();
  for (const f of filas) {
    const l = porUsuario.get(f.userId) ?? [];
    l.push(f);
    porUsuario.set(f.userId, l);
  }

  let enviados = 0;
  for (const [userId, lista] of porUsuario) {
    if (Date.now() - inicio > presupuestoMs) break; // sigue en la próxima corrida
    // Lo que el abogado ya vio en la app no se le vuelve a avisar.
    const sinVer = lista.filter((f) => !f.seenAt);
    try {
      if (sinVer.length > 0) {
        const porCaso = new Map<string, { radicado: string; caseId: string; nuevas: RamaActuacion[] }>();
        for (const f of sinVer) {
          const c = porCaso.get(f.caseId) ?? { radicado: f.radicado, caseId: f.caseId, nuevas: [] };
          c.nuevas.push({
            idRegActuacion: 0,
            actuacion: f.actuacion ?? undefined,
            anotacion: f.anotacion ?? undefined,
            fechaActuacion: f.fechaActuacion ? new Date(f.fechaActuacion).toISOString() : undefined,
          });
          porCaso.set(f.caseId, c);
        }
        const casos = [...porCaso.values()];
        await enviarResumen(lista[0].email, lista[0].name, casos);
        await registrarAvisoWhatsapp(userId, "actuaciones", textoActuaciones(casos));
        await sendPushToUser(userId, {
          title: "Actuaciones nuevas",
          body: `Tienes ${sinVer.length} actuación(es) nueva(s) en ${casos.length} de tus procesos.`,
          url: "/dashboard",
          tag: "actuaciones",
        }).catch(() => {});
        enviados++;
      }
      await prisma.$executeRawUnsafe(
        `UPDATE "Actuacion" SET "pendingNotify" = false WHERE id = ANY($1::text[])`,
        lista.map((f) => f.id),
      );
    } catch (err) {
      // Se reintenta en la siguiente corrida (las filas siguen pendientes).
      console.error(`[resumen] fallo con ${lista[0].email}:`, err);
    }
    await sleep(300);
  }
  return enviados;
}

// ---------- Corrida del cron (cada 5 minutos) ----------
/** `forzar`: el admin la lanza a mano (revisa la cola aunque sea de día). */
export async function tick(opts: { forzar?: boolean } = {}) {
  await asegurarColumnasCola();
  if (!(await tomarLock())) return { omitido: "otra corrida en curso" };
  const info: Record<string, unknown> = { inicio: new Date().toISOString(), ...(opts.forzar ? { manual: true } : {}) };
  try {
    const [s] = await prisma.$queryRawUnsafe<{ pausa: Date | null; pausaMs: number | null }[]>(
      `SELECT "syncPausedUntil" AS pausa, "syncPauseMs" AS "pausaMs" FROM "SiteSetting" WHERE id = 'site'`,
    );

    const m = minutosBogota();
    if (m >= RESUMEN_DESDE && m < RESUMEN_HASTA) {
      info.resumenesEnviados = await enviarResumenesPendientes();
    }
    // Registrados ayer que no han cargado procesos: aviso al root para descargar el Excel.
    if (m >= REPORTE_SIN_PROCESOS && m < RESUMEN_HASTA) {
      info.reporteSinProcesos = await avisarReporteSinProcesos().catch((e) => ({
        error: e instanceof Error ? e.message : String(e),
      }));
    }
    // Reporte de WhatsApp para el root: 7:30 a.m., cuando ya salieron los
    // resúmenes (si alguno sigue pendiente, a más tardar a las 9:00 a.m.).
    if (m >= REPORTE_WA && m < RESUMEN_HASTA) {
      const [p] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM "Actuacion" WHERE "pendingNotify"`,
      );
      if (Number(p?.n ?? 0) === 0 || m >= 9 * 60) {
        info.reporteWhatsapp = await enviarReporteWhatsapp().catch((e) => ({
          error: e instanceof Error ? e.message : String(e),
        }));
      }
    }

    // ¿La Rama está respondiendo? Si falla seguido, avisa al root.
    info.rama = await revisarRama().catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
    // Radicados que la Rama no respondió al agregarlos: se reintentan solos.
    info.reintentos = await procesarReintentos().catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
    // "Última actuación" = la de fecha más reciente que tenemos guardada (antes se
    // tomaba la primera que mandaba la Rama, y SIUGJ no las ordena).
    info.fechasCorregidas = await prisma
      .$executeRawUnsafe(
        `UPDATE "Case" c SET "lastActuacionDate" = m.f
         FROM (SELECT "caseId", max("fechaActuacion") AS f FROM "Actuacion" GROUP BY "caseId") m
         WHERE m."caseId" = c.id AND m.f > COALESCE(c."lastActuacionDate", '-infinity'::timestamp)`,
      )
      .catch(() => 0);

    if (!opts.forzar && !enVentanaNocturna()) {
      info.cola = "fuera de horario";
    } else if (s?.pausa && new Date(s.pausa) > new Date()) {
      info.cola = `en pausa por bloqueo hasta ${new Date(s.pausa).toISOString()}`;
    } else {
      const r = await procesarCola();
      info.cola = r;
      if (r.frenado) {
        // La Rama pidió frenar: pausa creciente (15 min, 30 min, ... máx. 2 h).
        const pausaMs = Math.min(Math.max((s?.pausaMs ?? 0) * 2, 15 * MIN), 2 * HORA);
        await prisma.$executeRawUnsafe(
          `UPDATE "SiteSetting" SET "syncPausedUntil" = now() + ($1 || ' milliseconds')::interval,
             "syncPauseMs" = $2::int WHERE id = 'site'`,
          String(pausaMs),
          pausaMs,
        );
        info.pausaMin = pausaMs / MIN;
      } else if (s?.pausaMs) {
        await prisma.$executeRawUnsafe(`UPDATE "SiteSetting" SET "syncPauseMs" = NULL WHERE id = 'site'`);
      }
    }
    info.fin = new Date().toISOString();
    return info;
  } catch (err) {
    info.error = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    await prisma
      .$executeRawUnsafe(
        `UPDATE "SiteSetting" SET "syncLastTickAt" = now(), "syncLastTickInfo" = $1 WHERE id = 'site'`,
        JSON.stringify(info),
      )
      .catch(() => {});
    await soltarLock().catch(() => {});
  }
}

// ---------- Monitoreo (Panel admin) ----------
export async function estadoSincronizacion() {
  await asegurarColumnasCola();
  const desde = inicioVentanaActual();
  const [conteo] = await prisma.$queryRawUnsafe<
    { total: bigint; revisados: bigint; pendientes: bigint; errores: bigint; bloqueados: bigint; privados: bigint }[]
  >(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE "lastCheckedAt" >= $1::timestamptz) AS revisados,
            count(*) FILTER (WHERE "nextCheckAt" IS NULL OR "nextCheckAt" <= now()) AS pendientes,
            count(*) FILTER (WHERE "syncStatus" = 'error') AS errores,
            count(*) FILTER (WHERE "syncStatus" = 'rate_limited') AS bloqueados,
            count(*) FILTER (WHERE "syncStatus" = 'privado') AS privados
     FROM "Case"`,
    desde,
  );
  const [avisos] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n FROM "Actuacion" WHERE "pendingNotify"`,
  );
  const [s] = await prisma.$queryRawUnsafe<
    { lastTick: Date | null; info: string | null; pausa: Date | null }[]
  >(
    `SELECT "syncLastTickAt" AS "lastTick", "syncLastTickInfo" AS info, "syncPausedUntil" AS pausa
     FROM "SiteSetting" WHERE id = 'site'`,
  );
  const fallidos = await prisma.$queryRawUnsafe<
    { radicado: string; error: string | null; intentos: number; proxima: Date | null }[]
  >(
    `SELECT radicado, "lastError" AS error, "retryCount" AS intentos, "nextCheckAt" AS proxima
     FROM "Case" WHERE "syncStatus" IN ('error', 'rate_limited')
     ORDER BY "retryCount" DESC LIMIT 10`,
  );
  let ultimaCorrida: Record<string, unknown> | null = null;
  try {
    ultimaCorrida = s?.info ? JSON.parse(s.info) : null;
  } catch {}
  return {
    desde,
    total: Number(conteo?.total ?? 0),
    revisados: Number(conteo?.revisados ?? 0),
    pendientes: Number(conteo?.pendientes ?? 0),
    errores: Number(conteo?.errores ?? 0),
    bloqueados: Number(conteo?.bloqueados ?? 0),
    privados: Number(conteo?.privados ?? 0),
    avisosPendientes: Number(avisos?.n ?? 0),
    ultimaCorridaAt: s?.lastTick ?? null,
    ultimaCorrida,
    pausaHasta: s?.pausa && new Date(s.pausa) > new Date() ? s.pausa : null,
    fallidos,
  };
}

function parseFecha(s?: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
