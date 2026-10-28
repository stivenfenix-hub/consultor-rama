import "server-only";
import webpush from "web-push";
import { prisma } from "./db";
import { ensureColumn } from "./runtime-columns";

const PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const PRIVATE = process.env.VAPID_PRIVATE_KEY;
const SUBJECT =
  process.env.VAPID_SUBJECT || "mailto:notificaciones@estradox.com";

let configured = false;
function ensure(): boolean {
  if (configured) return true;
  if (!PUBLIC || !PRIVATE) return false;
  webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE);
  configured = true;
  return true;
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

type Sub = { id: string; endpoint: string; p256dh: string; auth: string; createdAt?: Date };

// Registro de envíos (respuesta del servicio push de cada dispositivo), visible
// para el root en Panel admin → Notificaciones.
let tablaLista = false;
async function logPush(sub: Sub, status: number | null, detalle: string) {
  try {
    if (!tablaLista) {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "PushEvent" (
          id SERIAL PRIMARY KEY,
          "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
          "subId" TEXT,
          servicio TEXT,
          status INTEGER,
          detalle TEXT
        )`);
      tablaLista = true;
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO "PushEvent" ("subId", servicio, status, detalle) VALUES ($1, $2, $3, $4)`,
      sub.id,
      new URL(sub.endpoint).host,
      status,
      detalle.slice(0, 500),
    );
  } catch (e) {
    console.error("[push] log", e);
  }
}

export async function eventosPush() {
  try {
    return await prisma.$queryRawUnsafe<
      { id: number; createdAt: Date; subId: string; servicio: string; status: number | null; detalle: string }[]
    >(`SELECT id, "createdAt", "subId", servicio, status, detalle FROM "PushEvent" ORDER BY id DESC LIMIT 20`);
  } catch {
    return [];
  }
}

async function sendToSubs(subs: Sub[], payload: PushPayload) {
  if (!ensure()) {
    console.warn("[push] VAPID no configurado (faltan claves).");
    return { sent: 0, failed: 0 };
  }
  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
        // Prioridad alta: Android la entrega de inmediato aunque el celular esté
        // bloqueado o en ahorro de energía (con "normal" puede retenerla hasta
        // desbloquearlo). TTL: si el celular está apagado, se reintenta 24 h.
        { urgency: "high", TTL: 24 * 60 * 60 },
      );
      sent++;
      await logPush(s, 201, "entregada al servicio push");
    } catch (err) {
      failed++;
      const code = (err as { statusCode?: number })?.statusCode;
      const cuerpo = (err as { body?: string; message?: string })?.body ?? (err as Error)?.message ?? "";
      await logPush(s, code ?? null, `error: ${cuerpo}`);
      // Suscripción vencida o inválida: eliminarla.
      if (code === 404 || code === 410) {
        await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
      }
    }
  }
  return { sent, failed };
}

// Avisos para la app Android: guarda cada notificación y la app los consulta
// en segundo plano (GET /api/mobile/notices). userId null = para todos.
let avisosListos = false;
export async function ensureMobileNoticeTable() {
  if (avisosListos) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "MobileNotice" (
      id SERIAL PRIMARY KEY,
      "userId" TEXT REFERENCES "User"(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      url TEXT,
      tag TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "MobileNotice_userId_idx" ON "MobileNotice" ("userId")`,
  );
  avisosListos = true;
}

/** Guarda el aviso en la app (campana y app Android) sin enviar push. Devuelve su id. */
export async function guardarAviso(userId: string | null, payload: PushPayload) {
  try {
    await ensureMobileNoticeTable();
    const [r] = await prisma.$queryRawUnsafe<{ id: number }[]>(
      `INSERT INTO "MobileNotice" ("userId", title, body, url, tag) VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      userId,
      payload.title,
      payload.body,
      payload.url ?? null,
      payload.tag ?? null,
    );
    return r?.id ?? null;
  } catch (e) {
    console.error("[push] aviso app", e);
    return null;
  }
}

/**
 * La push lleva el id de su aviso en la URL (?aviso=): al tocarla, la campana
 * lo marca como leído.
 */
function conAviso(payload: PushPayload, avisoId: number | null): PushPayload {
  if (!avisoId) return payload;
  const url = payload.url || "/dashboard";
  return { ...payload, url: `${url}${url.includes("?") ? "&" : "?"}aviso=${avisoId}` };
}

export async function sendPushToUser(userId: string, payload: PushPayload) {
  const avisoId = await guardarAviso(userId, payload);
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  return sendToSubs(subs, conAviso(payload, avisoId));
}

/** Push a un grupo de usuarios (p. ej. los que aceptaron ofertas). */
export async function sendPushToUsers(userIds: string[], payload: PushPayload) {
  let sent = 0;
  let failed = 0;
  // Uno por uno: cada usuario tiene su propio aviso (y su id en la push).
  for (const id of userIds) {
    const r = await sendPushToUser(id, payload);
    sent += r.sent;
    failed += r.failed;
  }
  return { sent, failed };
}

// ---------- Campana de notificaciones (web) ----------
export type AvisoApp = {
  id: number;
  title: string;
  body: string;
  url: string | null;
  createdAt: Date;
  leido: boolean;
};

let lecturasListas = false;
async function asegurarLecturas() {
  if (lecturasListas) return;
  await ensureMobileNoticeTable();
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "MobileNoticeRead" (
      "noticeId" INTEGER NOT NULL REFERENCES "MobileNotice"(id) ON DELETE CASCADE,
      "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
      "readAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY ("noticeId", "userId")
    )`,
  );
  // "Marcar todas como leídas": lo anterior a esta fecha cuenta como leído.
  await ensureColumn("User", "avisosTodosLeidosAt", "TIMESTAMPTZ");
  lecturasListas = true;
}

/**
 * Un aviso cuenta como leído si:
 *  - el usuario lo tocó (o entró a su página por otro lado: MobileNoticeRead),
 *  - es de actuaciones y ya vio todas las actuaciones que había hasta ese aviso,
 *  - usó "Marcar todas como leídas" después de que llegó, o
 *  - llegó antes de que creara su cuenta (avisos generales viejos).
 * $1 = userId.
 */
const LEIDO_SQL = `(
  n."createdAt" < u."createdAt"
  OR (u."avisosTodosLeidosAt" IS NOT NULL AND n."createdAt" <= u."avisosTodosLeidosAt")
  OR EXISTS (SELECT 1 FROM "MobileNoticeRead" r WHERE r."noticeId" = n.id AND r."userId" = $1)
  OR (n.tag = 'actuaciones' AND NOT EXISTS (
    SELECT 1 FROM "Actuacion" a JOIN "Case" c ON c.id = a."caseId"
    WHERE c."userId" = $1 AND a."seenAt" IS NULL AND a."createdAt" <= n."createdAt"))
)`;
const AVISOS_DEL_USUARIO = `FROM "MobileNotice" n JOIN "User" u ON u.id = $1
  WHERE (n."userId" = $1 OR n."userId" IS NULL)
    AND n."createdAt" > now() - interval '7 days'`;

/** Últimos avisos del usuario (los suyos y los generales), última semana. */
export async function listarAvisos(userId: string, limite = 30): Promise<AvisoApp[]> {
  await asegurarLecturas();
  return prisma.$queryRawUnsafe<AvisoApp[]>(
    `SELECT n.id, n.title, n.body, n.url, n."createdAt", ${LEIDO_SQL} AS leido
     ${AVISOS_DEL_USUARIO}
     ORDER BY n.id DESC LIMIT $2`,
    userId,
    limite,
  );
}

/** Avisos sin leer. Con `limite`, solo entre los últimos `limite` (lo que muestra la campana). */
export async function contarAvisosNoLeidos(userId: string, limite?: number): Promise<number> {
  await asegurarLecturas();
  const [r] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    limite
      ? `SELECT count(*) FILTER (WHERE NOT leido) AS n FROM (
           SELECT ${LEIDO_SQL} AS leido ${AVISOS_DEL_USUARIO} ORDER BY n.id DESC LIMIT ${Math.floor(limite)}
         ) x`
      : `SELECT count(*) AS n ${AVISOS_DEL_USUARIO} AND NOT ${LEIDO_SQL}`,
    userId,
  );
  return Number(r?.n ?? 0);
}

/** Marca un aviso como leído (el usuario lo tocó). */
export async function marcarAvisoLeido(userId: string, noticeId: number) {
  await asegurarLecturas();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "MobileNoticeRead" ("noticeId", "userId")
     SELECT id, $2 FROM "MobileNotice" WHERE id = $1 AND ("userId" = $2 OR "userId" IS NULL)
     ON CONFLICT DO NOTHING`,
    noticeId,
    userId,
  );
}

/**
 * Entró a una página por otro lado (menú, push, correo): los avisos que llevan
 * a esa página quedan leídos. Los de actuaciones no: esos se leen al ver las
 * actuaciones.
 */
export async function marcarAvisosDeRuta(userId: string, ruta: string) {
  // El inicio es la página por defecto de muchos avisos (promos, avisos del
  // root): entrar ahí no significa haberlos leído.
  if (ruta === "/dashboard" || ruta === "/dashboard/admin") return;
  await asegurarLecturas();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "MobileNoticeRead" ("noticeId", "userId")
     SELECT id, $1 FROM "MobileNotice"
     WHERE ("userId" = $1 OR "userId" IS NULL) AND url = $2
       AND tag IS DISTINCT FROM 'actuaciones'
       AND "createdAt" > now() - interval '7 days'
     ON CONFLICT DO NOTHING`,
    userId,
    ruta,
  );
}

export async function marcarTodosLeidos(userId: string) {
  await asegurarLecturas();
  await prisma.$executeRawUnsafe(`UPDATE "User" SET "avisosTodosLeidosAt" = now() WHERE id = $1`, userId);
}

// ---------- Notificaciones enviadas por el root (Panel admin) ----------
export type EnvioPromo = { clave: string; title: string; body: string; fecha: Date; usuarios: number };

/** Notificaciones que el root envió, agrupadas por envío (mismo texto y minuto). */
export async function listarEnviosPromo(): Promise<EnvioPromo[]> {
  await ensureMobileNoticeTable();
  const filas = await prisma.$queryRawUnsafe<{ title: string; body: string; fecha: Date; usuarios: bigint }[]>(
    `SELECT title, body, date_trunc('minute', "createdAt") AS fecha, count(*) AS usuarios
     FROM "MobileNotice" WHERE tag = 'promo'
     GROUP BY title, body, date_trunc('minute', "createdAt")
     ORDER BY fecha DESC LIMIT 40`,
  );
  return filas.map((f) => ({
    clave: JSON.stringify([f.title, f.body, new Date(f.fecha).toISOString()]),
    title: f.title,
    body: f.body,
    fecha: f.fecha,
    usuarios: Number(f.usuarios),
  }));
}

/** Borra un envío del root de la campana de todos (y de la app Android). */
export async function borrarEnvioPromo(clave: string) {
  const [title, body, fecha] = JSON.parse(clave) as [string, string, string];
  return prisma.$executeRawUnsafe(
    `DELETE FROM "MobileNotice"
     WHERE tag = 'promo' AND title = $1 AND body = $2
       AND date_trunc('minute', "createdAt") = $3::timestamptz`,
    title,
    body,
    fecha,
  );
}
