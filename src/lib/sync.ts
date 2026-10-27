import "server-only";
import { prisma } from "./db";
import {
  buscarPorRadicado,
  obtenerDetalle,
  obtenerActuaciones,
  obtenerDocumentos,
  obtenerDocumentosActuacion,
  obtenerSujetos,
  RamaError,
  type ProcesoResumen,
  type Actuacion as RamaActuacion,
  type Documento as RamaDocumento,
} from "./rama";
import { sendMail } from "./mailer";
import { after } from "next/server";

function parseFecha(f?: string | null): Date | null {
  if (!f) return null;
  const d = new Date(f);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Registra un proceso para un abogado a partir del radicado.
 * Trae detalle + actuaciones de la Rama y los guarda. Si ya existe, lo refresca.
 */
export async function agregarProcesoPorRadicado(
  userId: string,
  radicado: string,
) {
  const procesos = await buscarPorRadicado(radicado);
  if (procesos.length === 0) {
    throw new RamaError("No se encontro ningun proceso con ese radicado.", 404);
  }
  // Un radicado puede tener varios idProceso (p. ej. por instancias).
  // Registramos todos los que devuelva.
  const creados = [];
  for (const p of procesos) {
    creados.push(await upsertProceso(userId, p));
  }
  return creados;
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
};

/** Agrega varios radicados y cuenta qué pasó con cada uno. */
export async function agregarRadicados(
  userId: string,
  radicados: string[],
): Promise<ResultadoAgregar> {
  const r: ResultadoAgregar = {
    agregados: 0,
    yaEstaban: 0,
    pendientes: 0,
    privados: 0,
    noEncontrados: [],
    fallidos: [],
    sinIntentar: [],
  };
  for (let i = 0; i < radicados.length; i++) {
    const rad = radicados[i];
    try {
      const creados = await agregarProcesoPorRadicado(userId, rad);
      if (creados.every((c) => !c.nuevo)) r.yaEstaban++;
      else if (creados.some((c) => c.privado)) r.privados++;
      else if (creados.some((c) => c.pendiente)) r.pendientes++;
      else r.agregados++;
    } catch (err) {
      if (err instanceof RamaError && err.isRateLimit) {
        r.sinIntentar.push(...radicados.slice(i));
        break;
      }
      if (err instanceof RamaError && err.status === 404) r.noEncontrados.push(rad);
      else r.fallidos.push(rad);
    }
  }
  return r;
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
  if (r.yaEstaban) ok.push(`${r.yaEstaban} ya estaba(n) en tu lista.`);

  const err: string[] = [];
  if (invalidos.length) {
    err.push(`No tienen 23 dígitos: ${invalidos.join(", ")}.`);
  }
  if (r.noEncontrados.length) {
    err.push(`No existen en la Rama Judicial: ${r.noEncontrados.join(", ")}.`);
  }
  if (r.fallidos.length) {
    err.push(
      `La Rama no respondió para: ${r.fallidos.join(", ")}. Intenta de nuevo en un rato.`,
    );
  }
  if (r.sinIntentar.length) {
    err.push(
      `La Rama pidió pausar las consultas; intenta en unos minutos con: ${r.sinIntentar.join(", ")}.`,
    );
  }
  return {
    ok: ok.length ? ok.join(" ") : undefined,
    error: err.length ? err.join(" ") : undefined,
  };
}

async function upsertProceso(userId: string, resumen: ProcesoResumen) {
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

  // Carga rápida: todo menos los documentos por actuación (eso es lo lento).
  // Si la Rama falla, el proceso igual queda en la lista: la cola lo completa.
  try {
    await sincronizarProceso(caseRow.id, {
      marcarComoVistas: !existing,
      docsActuacion: false,
    });
  } catch (err) {
    const privado = err instanceof Error && /privad/i.test(err.message);
    return { ...caseRow, nuevo: !existing, pendiente: !privado, privado };
  }
  // Los documentos descargables (por actuación) se traen en segundo plano
  // para que agregar sea rápido; aparecen a los pocos segundos.
  const id = caseRow.id;
  try {
    // after(): corre DESPUÉS de enviar la respuesta (no hace esperar al usuario).
    after(() => cargarDocumentosActuacionEnFondo(id));
  } catch {
    // Fuera de una petición (p. ej. scripts): ejecutar sin esperar.
    void cargarDocumentosActuacionEnFondo(id).catch(() => {});
  }
  return { ...caseRow, nuevo: !existing, pendiente: false, privado: false };
}

/**
 * Re-consulta un proceso contra la Rama: actualiza el detalle, inserta las
 * actuaciones que falten y cuenta cuantas son nuevas.
 */
export async function sincronizarProceso(
  caseId: string,
  opts: { marcarComoVistas?: boolean; docsActuacion?: boolean } = {},
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

    const masReciente = actuaciones[0]; // la Rama ordena desc
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
    await Promise.all([
      sincronizarSujetos(caseId, caseRow.idProceso),
      sincronizarDocumentos(
        caseId,
        caseRow.idProceso,
        actuaciones,
        opts.docsActuacion !== false,
      ),
    ]);

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
async function cargarDocumentosActuacionEnFondo(caseId: string) {
  const t = Date.now();
  console.log("[docs-fondo] inicio", caseId);
  try {
    const acts = await prisma.actuacion.findMany({
      where: { caseId, conDocumentos: true },
      select: { idRegActuacion: true },
      orderBy: { fechaActuacion: "desc" },
      take: 30,
    });
    const todos: RamaDocumento[] = [];
    for (const a of acts) {
      try {
        const d = await obtenerDocumentosActuacion(a.idRegActuacion);
        todos.push(...d);
      } catch {
        // seguir con las demás
      }
      await new Promise((res) => setTimeout(res, 400));
    }
    if (todos.length === 0) return;

    const vistos = new Set<string>();
    const docs = todos.filter((d) => {
      const k = String(d.idRegDocumento);
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });
    await prisma.documento
      .createMany({
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
      })
      .catch(() => {});
    await prisma.syncLog
      .create({
        data: {
          caseId,
          operacion: "Documentos",
          resultado: "exito",
          durationMs: Date.now() - t,
          elementos: docs.length,
        },
      })
      .catch(() => {});
    console.log("[docs-fondo] fin", caseId, Date.now() - t, "ms");
  } catch (err) {
    console.error("[docs-fondo] error", caseId, err);
  }
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
          const fecha = a.fechaActuacion
            ? new Date(a.fechaActuacion).toLocaleDateString("es-CO", {
                timeZone: "America/Bogota",
              })
            : "";
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
      <img src="${appUrl}/api/logo/email" alt="Estradox" height="26" style="margin-bottom:12px" />
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
