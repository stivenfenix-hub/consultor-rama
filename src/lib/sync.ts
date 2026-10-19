import "server-only";
import { prisma } from "./db";
import {
  buscarPorRadicado,
  obtenerDetalle,
  obtenerActuaciones,
  RamaError,
  type ProcesoResumen,
  type Actuacion as RamaActuacion,
} from "./rama";
import { sendMail } from "./mailer";

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

  // Primera carga: las actuaciones existentes NO cuentan como "nuevas".
  await sincronizarProceso(caseRow.id, { marcarComoVistas: !existing });
  return caseRow;
}

/**
 * Re-consulta un proceso contra la Rama: actualiza el detalle, inserta las
 * actuaciones que falten y cuenta cuantas son nuevas.
 */
export async function sincronizarProceso(
  caseId: string,
  opts: { marcarComoVistas?: boolean } = {},
) {
  const caseRow = await prisma.case.findUnique({ where: { id: caseId } });
  if (!caseRow) throw new Error("Proceso no encontrado");

  try {
    // 1. Detalle (datos que no vienen en el resumen)
    const detalle = await obtenerDetalle(caseRow.idProceso);

    // 2. Actuaciones
    const actuaciones = await obtenerActuaciones(caseRow.idProceso);

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
    throw err;
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

  // Agrupa por abogado: TODOS los que tienen procesos reciben correo,
  // tengan o no actuaciones nuevas.
  type Pendiente = {
    email: string;
    name: string | null;
    totalCasos: number;
    casos: { radicado: string; caseId: string; nuevas: RamaActuacion[] }[];
  };
  const porUsuario = new Map<string, Pendiente>();

  for (const c of casos) {
    // Asegura una entrada por abogado aunque no tenga novedades.
    const entry =
      porUsuario.get(c.userId) ??
      ({
        email: c.user.email,
        name: c.user.name,
        totalCasos: 0,
        casos: [],
      } as Pendiente);
    entry.totalCasos++;
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

  // Enviar correos (no romper la corrida del cron si falla el envio)
  for (const [, u] of porUsuario) {
    try {
      if (u.casos.length > 0) {
        await enviarResumen(u.email, u.name, u.casos);
      } else {
        await enviarSinNovedades(u.email, u.name, u.totalCasos);
      }
    } catch (err) {
      console.error(`[mail] fallo enviando a ${u.email}:`, err);
    }
  }

  return resultados;
}

/** Correo diario cuando el abogado NO tuvo actuaciones nuevas. */
async function enviarSinNovedades(
  email: string,
  name: string | null,
  totalCasos: number,
) {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const hoy = new Date().toLocaleDateString("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  await sendMail({
    to: email,
    subject: "Sin novedades en tus procesos hoy",
    text:
      `Hola ${name ?? ""},\n\nRevisamos tus ${totalCasos} proceso(s) hoy (${hoy}) y no hubo ` +
      `actuaciones nuevas.\n\nVer tus procesos: ${appUrl}/dashboard`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto">
        <h2>Sin novedades hoy</h2>
        <p>Hola ${escapeHtml(name ?? "")}, revisamos tus <b>${totalCasos}</b> proceso(s) el ${escapeHtml(hoy)} y <b>no hubo actuaciones nuevas</b>.</p>
        <p>Te avisaremos apenas aparezca algo.</p>
        <p><a href="${appUrl}/dashboard">Ver mis procesos</a></p>
        <p style="color:#777;font-size:12px">Consultor de Procesos — actualización automática diaria.</p>
      </div>`,
  });
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
            ? new Date(a.fechaActuacion).toLocaleDateString("es-CO")
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
      <h2>Tienes ${totalNuevas} actuacion(es) nueva(s)</h2>
      <p>Hola ${escapeHtml(name ?? "")}, se detectaron novedades en ${casos.length} de tus procesos:</p>
      ${bloques}
      <p style="color:#777;font-size:12px">Consultor de Procesos — actualizacion automatica.</p>
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
