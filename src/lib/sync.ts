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
import { sendPushToUser } from "./push";
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
  await sincronizarProceso(caseRow.id, {
    marcarComoVistas: !existing,
    docsActuacion: false,
  });
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
  return caseRow;
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

/**
 * Refresca TODOS los procesos (lo que llama el cron de 24h).
 * Procesa en serie con una pausa para no saturar a la Rama, y al final envia a
 * cada abogado UN correo-resumen con sus procesos que tuvieron actuaciones
 * nuevas.
 */
export async function sincronizarTodos(pausaMs = 1500) {
  const casos = await prisma.case.findMany({
    select: {
      id: true,
      radicado: true,
      userId: true,
      user: { select: { email: true, name: true } },
    },
  });

  const resultados: {
    caseId: string;
    ok: boolean;
    nuevas?: number;
    error?: string;
  }[] = [];

  // Agrupa por abogado; solo se notifica a quien tenga actuaciones nuevas.
  type Pendiente = {
    email: string;
    name: string | null;
    casos: { radicado: string; caseId: string; nuevas: RamaActuacion[] }[];
  };
  const porUsuario = new Map<string, Pendiente>();

  for (const c of casos) {
    const entry =
      porUsuario.get(c.userId) ??
      ({
        email: c.user.email,
        name: c.user.name,
        casos: [],
      } as Pendiente);
    porUsuario.set(c.userId, entry);

    try {
      const r = await sincronizarProceso(c.id);
      resultados.push({ caseId: c.id, ok: true, nuevas: r.nuevas });
      if (r.nuevas > 0) {
        entry.casos.push({
          radicado: c.radicado,
          caseId: c.id,
          nuevas: r.nuevasList,
        });
      }
    } catch (err) {
      resultados.push({
        caseId: c.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    await new Promise((res) => setTimeout(res, pausaMs));
  }

  // Enviar correos + push solo a quien tuvo novedades; sin novedades no se
  // notifica nada. (No romper la corrida del cron si falla el envio.)
  for (const [userId, u] of porUsuario) {
    try {
      if (u.casos.length > 0) {
        await enviarResumen(u.email, u.name, u.casos);
        const totalNuevas = u.casos.reduce((n, c) => n + c.nuevas.length, 0);
        await sendPushToUser(userId, {
          title: "Actuaciones nuevas",
          body: `Tienes ${totalNuevas} actuación(es) nueva(s) en ${u.casos.length} de tus procesos.`,
          url: "/dashboard",
          tag: "actuaciones",
        }).catch(() => {});
      }
    } catch (err) {
      console.error(`[mail] fallo enviando a ${u.email}:`, err);
    }
  }

  return resultados;
}

/** Construye y envia el correo-resumen de actuaciones nuevas a un abogado. */
async function enviarResumen(
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
          <a href="${appUrl}/dashboard/${c.caseId}">Ver proceso</a>
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
          `${c.radicado}: ${c.nuevas.length} nuevas\n  ${appUrl}/dashboard/${c.caseId}`,
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
