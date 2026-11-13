import "server-only";
import { prisma } from "./db";

/**
 * Soporte y PQRS: el abogado escribe (pregunta, problema, sugerencia, petición,
 * queja o reclamo) y el root le contesta en una conversación por caso, con
 * estado (abierto → respondido → resuelto). Cada lado ve qué tiene sin leer.
 */

export const TIPOS_SOPORTE = {
  ayuda: { label: "Pregunta o ayuda", emoji: "❓" },
  problema: { label: "Algo no funciona", emoji: "🛠️" },
  sugerencia: { label: "Sugerencia", emoji: "💡" },
  peticion: { label: "Petición", emoji: "📝" },
  queja: { label: "Queja o reclamo", emoji: "⚠️" },
} as const;
export type TipoSoporte = keyof typeof TIPOS_SOPORTE;
export const esTipoSoporte = (t: string): t is TipoSoporte => t in TIPOS_SOPORTE;

/** abierto: espera respuesta de Estradox · respondido: Estradox contestó · cerrado: resuelto. */
export type EstadoSoporte = "abierto" | "respondido" | "cerrado";
export const ESTADOS_SOPORTE: Record<EstadoSoporte, string> = {
  abierto: "Esperando respuesta",
  respondido: "Respondido",
  cerrado: "Resuelto",
};

let listo: Promise<void> | null = null;
function asegurarTablas() {
  listo ??= (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "SoporteCaso" (
        id SERIAL PRIMARY KEY,
        "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
        tipo TEXT NOT NULL,
        asunto TEXT NOT NULL,
        estado TEXT NOT NULL DEFAULT 'abierto',
        "vistoUsuario" BOOLEAN NOT NULL DEFAULT true,
        "vistoSoporte" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "SoporteMensaje" (
        id SERIAL PRIMARY KEY,
        "casoId" INTEGER NOT NULL REFERENCES "SoporteCaso"(id) ON DELETE CASCADE,
        autor TEXT NOT NULL,
        texto TEXT NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "SoporteCaso_user" ON "SoporteCaso" ("userId", "updatedAt" DESC)`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "SoporteMensaje_caso" ON "SoporteMensaje" ("casoId", id)`,
    );
  })().catch((e) => {
    listo = null;
    throw e;
  });
  return listo;
}

export type CasoSoporte = {
  id: number;
  userId: string;
  tipo: TipoSoporte;
  asunto: string;
  estado: EstadoSoporte;
  vistoUsuario: boolean;
  vistoSoporte: boolean;
  createdAt: Date;
  updatedAt: Date;
  /** Primeras palabras del último mensaje. */
  ultimo: string | null;
  ultimoAutor: "usuario" | "soporte" | null;
  mensajes: number;
  nombre?: string;
  email?: string;
};

export type MensajeSoporte = { id: number; autor: "usuario" | "soporte"; texto: string; createdAt: Date };

const COLS = `c.id, c."userId", c.tipo, c.asunto, c.estado, c."vistoUsuario", c."vistoSoporte", c."createdAt", c."updatedAt",
  (SELECT left(m.texto, 160) FROM "SoporteMensaje" m WHERE m."casoId" = c.id ORDER BY m.id DESC LIMIT 1) AS ultimo,
  (SELECT m.autor FROM "SoporteMensaje" m WHERE m."casoId" = c.id ORDER BY m.id DESC LIMIT 1) AS "ultimoAutor",
  (SELECT count(*)::int FROM "SoporteMensaje" m WHERE m."casoId" = c.id) AS mensajes`;

const NOMBRE = `coalesce(nullif(trim(coalesce(u."firstName",'') || ' ' || coalesce(u."lastName",'')), ''), u.name, u.email) AS nombre, u.email`;

const limpiar = (s: string, max: number) => s.replace(/\r\n/g, "\n").trim().slice(0, max);

// ---------- Abogado ----------
export async function casosDelUsuario(userId: string): Promise<CasoSoporte[]> {
  await asegurarTablas();
  return prisma.$queryRawUnsafe<CasoSoporte[]>(
    `SELECT ${COLS} FROM "SoporteCaso" c WHERE c."userId" = $1 ORDER BY c."updatedAt" DESC LIMIT 100`,
    userId,
  );
}

/** Respuestas de Estradox que el abogado no ha leído (para el menú). */
export async function soporteSinLeerUsuario(userId: string): Promise<number> {
  try {
    await asegurarTablas();
    const [r] = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM "SoporteCaso" WHERE "userId" = $1 AND NOT "vistoUsuario"`,
      userId,
    );
    return r?.n ?? 0;
  } catch {
    return 0;
  }
}

export async function crearCaso(userId: string, tipo: TipoSoporte, asunto: string, texto: string) {
  await asegurarTablas();
  const [c] = await prisma.$queryRawUnsafe<{ id: number }[]>(
    `INSERT INTO "SoporteCaso" ("userId", tipo, asunto) VALUES ($1, $2, $3) RETURNING id`,
    userId,
    tipo,
    limpiar(asunto, 140),
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "SoporteMensaje" ("casoId", autor, texto) VALUES ($1, 'usuario', $2)`,
    c.id,
    limpiar(texto, 5000),
  );
  await avisarSoporte(c.id, "nuevo").catch((e) => console.error("[soporte] aviso root", e));
  return c.id;
}

// ---------- Conversación (abogado o root) ----------
/** El caso con sus mensajes. Con `userId`, solo si es de ese abogado. */
export async function casoConMensajes(id: number, userId?: string) {
  await asegurarTablas();
  const [caso] = await prisma.$queryRawUnsafe<CasoSoporte[]>(
    `SELECT ${COLS}, ${NOMBRE} FROM "SoporteCaso" c JOIN "User" u ON u.id = c."userId"
     WHERE c.id = $1 ${userId ? `AND c."userId" = $2` : ""}`,
    ...(userId ? [id, userId] : [id]),
  );
  if (!caso) return null;
  const mensajes = await prisma.$queryRawUnsafe<MensajeSoporte[]>(
    `SELECT id, autor, texto, "createdAt" FROM "SoporteMensaje" WHERE "casoId" = $1 ORDER BY id`,
    id,
  );
  return { caso, mensajes };
}

export async function marcarVisto(id: number, lado: "usuario" | "soporte") {
  await asegurarTablas();
  const col = lado === "usuario" ? "vistoUsuario" : "vistoSoporte";
  await prisma.$executeRawUnsafe(`UPDATE "SoporteCaso" SET "${col}" = true WHERE id = $1 AND NOT "${col}"`, id);
}

/** Nuevo mensaje en un caso: del abogado (queda esperando respuesta) o de Estradox (respondido). */
export async function responder(id: number, autor: "usuario" | "soporte", texto: string, userId?: string) {
  await asegurarTablas();
  const t = limpiar(texto, 5000);
  if (!t) return false;
  const n = await prisma.$executeRawUnsafe(
    autor === "usuario"
      ? `UPDATE "SoporteCaso" SET estado = 'abierto', "vistoSoporte" = false, "vistoUsuario" = true, "updatedAt" = now()
         WHERE id = $1 AND "userId" = $2`
      : `UPDATE "SoporteCaso" SET estado = 'respondido', "vistoUsuario" = false, "vistoSoporte" = true, "updatedAt" = now()
         WHERE id = $1`,
    ...(autor === "usuario" ? [id, userId] : [id]),
  );
  if (n !== 1) return false;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "SoporteMensaje" ("casoId", autor, texto) VALUES ($1, $2, $3)`,
    id,
    autor,
    t,
  );
  if (autor === "usuario") await avisarSoporte(id, "respuesta").catch((e) => console.error("[soporte] aviso root", e));
  else await avisarUsuario(id, t).catch((e) => console.error("[soporte] aviso abogado", e));
  return true;
}

/** Marca el caso como resuelto o lo vuelve a abrir. Con `userId`, solo si es de ese abogado. */
export async function cambiarEstado(id: number, estado: "cerrado" | "abierto", userId?: string) {
  await asegurarTablas();
  await prisma.$executeRawUnsafe(
    `UPDATE "SoporteCaso" SET estado = $2, "updatedAt" = now() WHERE id = $1 ${userId ? `AND "userId" = $3` : ""}`,
    ...(userId ? [id, estado, userId] : [id, estado]),
  );
}

// ---------- Root ----------
export async function casosSoporte(filtro: EstadoSoporte | "todos" | "sinLeer", desde = 0, limite = 20) {
  await asegurarTablas();
  const where =
    filtro === "todos" ? "" : filtro === "sinLeer" ? `WHERE NOT c."vistoSoporte"` : `WHERE c.estado = $3`;
  const params: unknown[] = [limite, desde];
  if (filtro !== "todos" && filtro !== "sinLeer") params.push(filtro);
  const [casos, [t]] = await Promise.all([
    prisma.$queryRawUnsafe<CasoSoporte[]>(
      `SELECT ${COLS}, ${NOMBRE} FROM "SoporteCaso" c JOIN "User" u ON u.id = c."userId" ${where}
       ORDER BY (c.estado = 'abierto') DESC, c."updatedAt" DESC LIMIT $1 OFFSET $2`,
      ...params,
    ),
    prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM "SoporteCaso" c ${where.replace("$3", "$1")}`,
      ...params.slice(2),
    ),
  ]);
  return { casos, total: t?.n ?? 0 };
}

export async function conteosSoporte() {
  try {
    await asegurarTablas();
    const [r] = await prisma.$queryRawUnsafe<{ abiertos: number; sinLeer: number; respondidos: number; cerrados: number; todos: number }[]>(
      `SELECT count(*) FILTER (WHERE estado = 'abierto')::int AS abiertos,
              count(*) FILTER (WHERE NOT "vistoSoporte")::int AS "sinLeer",
              count(*) FILTER (WHERE estado = 'respondido')::int AS respondidos,
              count(*) FILTER (WHERE estado = 'cerrado')::int AS cerrados,
              count(*)::int AS todos
       FROM "SoporteCaso"`,
    );
    return r ?? { abiertos: 0, sinLeer: 0, respondidos: 0, cerrados: 0, todos: 0 };
  } catch {
    return { abiertos: 0, sinLeer: 0, respondidos: 0, cerrados: 0, todos: 0 };
  }
}

// ---------- Avisos ----------
/** Al root (todos los admin): caso nuevo o el abogado respondió. */
async function avisarSoporte(id: number, que: "nuevo" | "respuesta") {
  const r = await casoConMensajes(id);
  if (!r) return;
  const { caso, mensajes } = r;
  const admins = await prisma.user.findMany({ where: { role: "admin" }, select: { id: true } });
  const { sendPushToUser } = await import("./push");
  const tipo = TIPOS_SOPORTE[caso.tipo] ?? TIPOS_SOPORTE.ayuda;
  const ultimo = mensajes[mensajes.length - 1]?.texto ?? "";
  for (const a of admins) {
    await sendPushToUser(a.id, {
      title: `${tipo.emoji} ${que === "nuevo" ? "Soporte" : "Respuesta en soporte"}: ${caso.asunto}`,
      body: `${caso.nombre ?? caso.email}: ${ultimo.slice(0, 140)}`,
      url: `/dashboard/admin/soporte/${id}`,
      tag: `soporte-${id}`,
    });
  }
}

/** Al abogado: Estradox le respondió (notificación, campana y correo). */
async function avisarUsuario(id: number, texto: string) {
  const r = await casoConMensajes(id);
  if (!r) return;
  const { caso } = r;
  const { sendPushToUser } = await import("./push");
  await sendPushToUser(caso.userId, {
    title: `💬 Te respondimos: ${caso.asunto}`,
    body: texto.slice(0, 160),
    url: `/dashboard/soporte/${id}`,
    tag: `soporte-${id}`,
  });
  if (!caso.email) return;
  const appUrl = process.env.APP_URL ?? "https://app.estradox.com";
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
  const { sendMail } = await import("./mailer");
  await sendMail({
    to: caso.email,
    subject: `Estradox te respondió: ${caso.asunto}`,
    text: `${texto}\n\nVer la conversación: ${appUrl}/dashboard/soporte/${id}`,
    html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#222;max-width:560px">
      <p>Hola${caso.nombre ? ` ${esc(caso.nombre.split(" ")[0])}` : ""}, te respondimos sobre <b>${esc(caso.asunto)}</b>:</p>
      <div style="border-left:3px solid #7c3aed;padding:8px 12px;background:#f6f3ff;margin:12px 0">${esc(texto)}</div>
      <p><a href="${appUrl}/dashboard/soporte/${id}" style="display:inline-block;background:#7c3aed;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Ver y responder</a></p>
    </div>`,
  });
}
