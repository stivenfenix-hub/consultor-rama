import "server-only";
import { prisma } from "./db";
import { ensureColumn } from "./runtime-columns";
import { sendMail } from "./mailer";
import { obtenerDetalle, RamaError } from "./rama";

/**
 * Monitor de la Rama Judicial: en cada corrida del cron (cada 5 minutos, día y
 * noche) hace una consulta liviana de un proceso conocido. Si la Rama no
 * responde 3 veces seguidas (~15 min), avisa al root por la campana, push y
 * correo; si sigue caída, recuerda cada 3 horas; cuando vuelve, avisa que se
 * recuperó y cuánto duró la caída.
 */

const FALLAS_PARA_ALERTA = 3;
const RECORDAR_CADA_MS = 3 * 60 * 60_000;
const TZ = "America/Bogota";

type Estado = {
  fallas: number;
  caidaDesde: Date | null;
  alertaAt: Date | null;
  revisadaAt: Date | null;
  error: string | null;
  ms: number | null;
  okAt: Date | null;
};

let listo: Promise<void> | null = null;
function asegurarColumnas() {
  listo ??= (async () => {
    await ensureColumn("SiteSetting", "ramaFallas", "INTEGER NOT NULL DEFAULT 0");
    await ensureColumn("SiteSetting", "ramaCaidaDesde", "TIMESTAMPTZ");
    await ensureColumn("SiteSetting", "ramaAlertaAt", "TIMESTAMPTZ");
    await ensureColumn("SiteSetting", "ramaRevisadaAt", "TIMESTAMPTZ");
    await ensureColumn("SiteSetting", "ramaOkAt", "TIMESTAMPTZ");
    await ensureColumn("SiteSetting", "ramaError", "TEXT");
    await ensureColumn("SiteSetting", "ramaMs", "INTEGER");
  })().catch((e) => {
    listo = null;
    throw e;
  });
  return listo;
}

export async function estadoRama(): Promise<Estado | null> {
  await asegurarColumnas();
  const [s] = await prisma.$queryRawUnsafe<Estado[]>(
    `SELECT "ramaFallas" AS fallas, "ramaCaidaDesde" AS "caidaDesde", "ramaAlertaAt" AS "alertaAt",
            "ramaRevisadaAt" AS "revisadaAt", "ramaError" AS error, "ramaMs" AS ms, "ramaOkAt" AS "okAt"
     FROM "SiteSetting" WHERE id = 'site'`,
  );
  return s ?? null;
}

/** Una consulta a la Rama. Un 400/404 cuenta como "responde": el API está vivo. */
async function probar(): Promise<{ ok: true; ms: number } | { ok: false; ms: number; error: string } | null> {
  const [c] = await prisma.$queryRawUnsafe<{ idProceso: string }[]>(
    `SELECT "idProceso" FROM "Case"
     WHERE "syncStatus" IS DISTINCT FROM 'privado' AND "idProceso" IS NOT NULL
     ORDER BY random() LIMIT 1`,
  );
  if (!c) return null; // sin procesos con qué probar
  const inicio = Date.now();
  try {
    const d = await obtenerDetalle(c.idProceso, 2);
    const ms = Date.now() - inicio;
    if (!d || typeof d !== "object" || !d.llaveProceso) return { ok: false, ms, error: "La Rama respondió vacío o con datos no válidos." };
    return { ok: true, ms };
  } catch (err) {
    const ms = Date.now() - inicio;
    if (err instanceof RamaError && (err.status === 400 || err.status === 404)) return { ok: true, ms };
    if (err instanceof RamaError && err.isRateLimit) {
      return { ok: false, ms, error: "La Rama está bloqueando nuestras consultas (exceso de consultas o firewall)." };
    }
    const msg = err instanceof Error ? err.message : String(err);
    const amable = /abort/i.test(msg)
      ? "La Rama no respondió a tiempo (timeout)."
      : /fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|socket/i.test(msg)
        ? "No hay conexión con el servidor de la Rama."
        : msg;
    return { ok: false, ms, error: amable.slice(0, 300) };
  }
}

const hora = (d: Date) =>
  d.toLocaleString("es-CO", { timeZone: TZ, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function duracion(ms: number) {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min`;
}

async function avisarAdmins(title: string, body: string, tag: string) {
  const admins = await prisma.user.findMany({ where: { role: "admin" }, select: { id: true, email: true } });
  const { sendPushToUsers } = await import("./push");
  await sendPushToUsers(
    admins.map((a) => a.id),
    { title, body, url: "/dashboard/admin", tag },
  ).catch((e) => console.error("[monitor-rama] push", e));
  for (const a of admins) {
    await sendMail({
      to: a.email,
      subject: title,
      text: body,
      html: `<div style="font-family:system-ui,sans-serif"><p style="font-size:15px">${body}</p><p style="color:#777;font-size:13px">Estado en vivo: Panel admin de Estradox.</p></div>`,
    }).catch((e) => console.error("[monitor-rama] correo", e));
  }
}

/** Se llama en cada corrida del cron. */
export async function revisarRama() {
  await asegurarColumnas();
  const r = await probar();
  if (!r) return { omitido: "sin procesos para probar" };
  const antes = await estadoRama();
  const ahora = new Date();

  if (r.ok) {
    await prisma.$executeRawUnsafe(
      `UPDATE "SiteSetting" SET "ramaFallas" = 0, "ramaCaidaDesde" = NULL, "ramaAlertaAt" = NULL,
         "ramaRevisadaAt" = now(), "ramaOkAt" = now(), "ramaError" = NULL, "ramaMs" = $1::int
       WHERE id = 'site'`,
      r.ms,
    );
    // Solo se avisa la recuperación si antes se avisó la caída.
    if (antes?.alertaAt && antes.caidaDesde) {
      const dur = duracion(ahora.getTime() - new Date(antes.caidaDesde).getTime());
      await avisarAdmins(
        "✅ La Rama Judicial volvió a funcionar",
        `La consulta de procesos de la Rama responde de nuevo (caída desde ${hora(new Date(antes.caidaDesde))}, duró ${dur}). La sincronización sigue normal.`,
        "monitor-rama",
      );
    }
    return { ok: true, ms: r.ms };
  }

  const fallas = (antes?.fallas ?? 0) + 1;
  const caidaDesde = antes?.caidaDesde ? new Date(antes.caidaDesde) : ahora;
  const alertar =
    fallas >= FALLAS_PARA_ALERTA &&
    (!antes?.alertaAt || ahora.getTime() - new Date(antes.alertaAt).getTime() >= RECORDAR_CADA_MS);
  await prisma.$executeRawUnsafe(
    `UPDATE "SiteSetting" SET "ramaFallas" = $1::int, "ramaCaidaDesde" = $2::timestamptz,
       "ramaRevisadaAt" = now(), "ramaError" = $3::text, "ramaMs" = $4::int
       ${alertar ? `, "ramaAlertaAt" = now()` : ""}
     WHERE id = 'site'`,
    fallas,
    caidaDesde,
    r.error,
    r.ms,
  );
  if (alertar) {
    const sigue = !!antes?.alertaAt;
    await avisarAdmins(
      sigue ? "⚠️ La Rama Judicial sigue fallando" : "⚠️ La Rama Judicial no está respondiendo",
      `${r.error} Falla desde ${hora(caidaDesde)} (${duracion(ahora.getTime() - caidaDesde.getTime())}). Mientras tanto no se pueden agregar ni actualizar procesos; la sincronización reintenta sola y te aviso cuando vuelva.`,
      "monitor-rama",
    );
  }
  return { ok: false, fallas, error: r.error, alerta: alertar };
}
