import "server-only";
import { prisma } from "./db";
import { ensureColumn } from "./runtime-columns";

// Suscripción: prueba gratis de N días y luego plan mensual pagado con Bold
// (link de pago: tarjeta, PSE, Nequi, Botón Bancolombia). Bold no cobra
// automáticamente cada mes, así que cada pago suma 30 días de acceso. Los
// procesos adicionales (ver usoProcesos) se suman al valor de cada link.
//
// Variables de entorno:
//   BOLD_API_KEY     llave de identidad del Botón de pagos (crea y consulta links)
//   BOLD_SECRET_KEY  llave secreta (firma de los webhooks; vacía en pruebas)

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const BOLD_API = "https://integrations.api.bold.co";
const DIA_MS = 24 * 60 * 60 * 1000;
// Usuarios creados antes de lanzar los cobros: su prueba empieza este día.
const LANZAMIENTO = new Date("2026-10-22T05:00:00Z");

// Paquetes: meses de acceso y precio (COP). El de 1 mes es el precio base con
// el que se calcula el ahorro de los demás.
export const MESES_PAQUETES = [1, 3, 6, 12] as const;
export type MesesPaquete = (typeof MESES_PAQUETES)[number];
export type Paquete = { meses: MesesPaquete; precio: number };

const PRECIOS_DEFAULT: Record<MesesPaquete, number> = {
  1: 24900,
  3: 65900,
  6: 119900,
  12: 219900,
};
const COL_PRECIO: Record<MesesPaquete, string> = {
  1: "planPrice",
  3: "planPrice3",
  6: "planPrice6",
  12: "planPrice12",
};

// Procesos incluidos: quien se registra desde LIMITE_DESDE tiene hasta N procesos
// en el plan; cada radicado adicional vale X por mes y se suma a su próximo pago
// (Bold no cobra solo: el link de pago ya trae el valor). Los anteriores siguen ilimitados.
const LIMITE_DESDE = new Date("2026-11-03T05:00:00Z"); // 3 nov 2026, 00:00 Bogotá
const INCLUIDOS_DEFAULT = 40;
const ADICIONAL_DEFAULT = 499;

export type Plan = {
  precio: number;
  diasPrueba: number;
  paquetes: Paquete[];
  procesosIncluidos: number;
  /** Valor por proceso adicional y por mes (COP). */
  precioAdicional: number;
};
export const PLAN_DEFAULTS: Plan = {
  precio: PRECIOS_DEFAULT[1],
  diasPrueba: 30,
  paquetes: MESES_PAQUETES.map((meses) => ({ meses, precio: PRECIOS_DEFAULT[meses] })),
  procesosIncluidos: INCLUIDOS_DEFAULT,
  precioAdicional: ADICIONAL_DEFAULT,
};

export function esMesesPaquete(n: number): n is MesesPaquete {
  return (MESES_PAQUETES as readonly number[]).includes(n);
}

export function boldConfigurado() {
  return !!process.env.BOLD_API_KEY;
}

// ---------- Esquema (columnas/tabla creadas en tiempo de ejecución) ----------
let esquemaListo = false;
async function ensureSchema() {
  if (esquemaListo) return;
  await ensureColumn("User", "trialEndsAt", "TIMESTAMPTZ");
  await ensureColumn("User", "paidUntil", "TIMESTAMPTZ");
  await ensureColumn("User", "subNoticeFor", "TIMESTAMPTZ");
  await ensureColumn("User", "subExpiredFor", "TIMESTAMPTZ");
  // Socio de Estradox: sin cobro y con acceso al portal de socios.
  await ensureColumn("User", "socio", "BOOLEAN NOT NULL DEFAULT false");
  for (const col of Object.values(COL_PRECIO)) {
    await ensureColumn("SiteSetting", col, "INTEGER");
  }
  await ensureColumn("SiteSetting", "trialDays", "INTEGER");
  await ensureColumn("SiteSetting", "procesosIncluidos", "INTEGER");
  await ensureColumn("SiteSetting", "precioAdicional", "INTEGER");
  // Cuántos adicionales ya se le avisaron (para avisar solo cuando sube).
  await ensureColumn("User", "adicionalesAvisados", "INTEGER NOT NULL DEFAULT 0");
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BoldPayment" (
      id TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
      amount INTEGER NOT NULL,
      status TEXT NOT NULL,
      url TEXT,
      "paymentId" TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "paidAt" TIMESTAMPTZ
    )`);
  await ensureColumn("BoldPayment", "meses", "INTEGER NOT NULL DEFAULT 1");
  // "plan" (paquete de meses) o "adicionales" (cobro mensual de procesos adicionales
  // de quien pagó varios meses por adelantado: no suma acceso).
  await ensureColumn("BoldPayment", "tipo", "TEXT NOT NULL DEFAULT 'plan'");
  // Adicionales que ya cubre ese pago (por cada mes del paquete). NULL en pagos de antes.
  await ensureColumn("BoldPayment", "adicionales", "INTEGER");
  // Un renglón por usuario y corte mensual: los adicionales de ese mes que no
  // cubría su paquete. "paymentId" es el link que los cobra (NULL: aún sin cobrar).
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AdicionalMes" (
      "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
      corte TIMESTAMPTZ NOT NULL,
      adicionales INTEGER NOT NULL,
      valor INTEGER NOT NULL,
      "paymentId" TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY ("userId", corte)
    )`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BoldEvent" (
      id SERIAL PRIMARY KEY,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      tipo TEXT NOT NULL,
      detalle TEXT NOT NULL
    )`);
  esquemaListo = true;
}

/** Registro de eventos de Bold (webhooks y consultas) para soporte. */
export async function logBold(tipo: string, detalle: unknown) {
  try {
    await ensureSchema();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "BoldEvent" (tipo, detalle) VALUES ($1, $2)`,
      tipo,
      (typeof detalle === "string" ? detalle : JSON.stringify(detalle)).slice(0, 2000),
    );
  } catch (e) {
    console.error("[bold] log", e);
  }
}

export async function eventosBold() {
  await ensureSchema();
  return prisma.$queryRawUnsafe<{ id: number; createdAt: Date; tipo: string; detalle: string }[]>(
    `SELECT id, "createdAt", tipo, detalle FROM "BoldEvent" ORDER BY id DESC LIMIT 20`,
  );
}

// ---------- Plan (precios de los paquetes y días de prueba, editables por el root) ----------
export async function getPlan(): Promise<Plan> {
  try {
    await ensureSchema();
    const cols = MESES_PAQUETES.map((m) => `"${COL_PRECIO[m]}" AS p${m}`).join(", ");
    const rows = await prisma.$queryRawUnsafe<Record<string, number | null>[]>(
      `SELECT ${cols}, "trialDays" AS d, "procesosIncluidos" AS inc, "precioAdicional" AS adi
       FROM "SiteSetting" WHERE id = 'site'`,
    );
    const r = rows[0] ?? {};
    const paquetes = MESES_PAQUETES.map((meses) => ({
      meses,
      precio: r[`p${meses}`] ?? PRECIOS_DEFAULT[meses],
    }));
    return {
      precio: paquetes[0].precio,
      diasPrueba: r.d ?? PLAN_DEFAULTS.diasPrueba,
      paquetes,
      procesosIncluidos: r.inc ?? INCLUIDOS_DEFAULT,
      precioAdicional: r.adi ?? ADICIONAL_DEFAULT,
    };
  } catch {
    return PLAN_DEFAULTS;
  }
}

export async function savePlan(
  precios: Record<MesesPaquete, number>,
  diasPrueba: number,
  procesos?: { incluidos: number; adicional: number },
) {
  await ensureSchema();
  await prisma.siteSetting.upsert({
    where: { id: "site" },
    create: { id: "site" },
    update: {},
  });
  const sets = MESES_PAQUETES.map((m, i) => `"${COL_PRECIO[m]}" = $${i + 1}`).join(", ");
  await prisma.$executeRawUnsafe(
    `UPDATE "SiteSetting" SET ${sets}, "trialDays" = $${MESES_PAQUETES.length + 1} WHERE id = 'site'`,
    ...MESES_PAQUETES.map((m) => precios[m]),
    diasPrueba,
  );
  if (procesos) {
    await prisma.$executeRawUnsafe(
      `UPDATE "SiteSetting" SET "procesosIncluidos" = $1, "precioAdicional" = $2 WHERE id = 'site'`,
      procesos.incluidos,
      procesos.adicional,
    );
  }
}

// ---------- Socios ----------
export async function esSocio(userId: string): Promise<boolean> {
  try {
    await ensureSchema();
    const [r] = await prisma.$queryRawUnsafe<{ s: boolean }[]>(`SELECT socio AS s FROM "User" WHERE id = $1`, userId);
    return !!r?.s;
  } catch {
    return false;
  }
}

export async function cambiarSocio(userId: string, valor: boolean) {
  await ensureSchema();
  await prisma.$executeRawUnsafe(`UPDATE "User" SET socio = $2 WHERE id = $1`, userId, valor);
}

/** Socios de Estradox (el root y los marcados como socio), para el portal. */
export async function listaSocios() {
  await ensureSchema();
  return prisma.$queryRawUnsafe<{ id: string; nombre: string; email: string }[]>(
    `SELECT id, coalesce(nullif(trim(coalesce("firstName",'') || ' ' || coalesce("lastName",'')), ''), name, email) AS nombre, email
     FROM "User" WHERE role = 'admin' OR socio ORDER BY role = 'admin' DESC, "createdAt"`,
  );
}

// ---------- Procesos incluidos y adicionales ----------
export type UsoProcesos = {
  /** false: usuario anterior al cambio (o admin), sin límite. */
  limitado: boolean;
  incluidos: number;
  /** Radicados distintos en su lista (un radicado en 2 sistemas cuenta 1) más los que solo están en estados electrónicos. */
  total: number;
  adicionales: number;
  precioAdicional: number;
  /** Lo que suman los adicionales por mes. */
  valorMes: number;
  /**
   * Pagó un paquete de varios meses que sigue vigente: los adicionales que ya
   * pagó van hasta el final del paquete; los que agregue después se cobran mes a mes.
   */
  prepago: null | {
    meses: number;
    /** Adicionales que pagó con el paquete. */
    cubiertos: number;
    /** Adicionales de más sobre los pagados: se cobran en cada corte mensual. */
    porCobrar: number;
    /** Valor de cada corte mensual (porCobrar × precio). */
    valorCorte: number;
    /** Próximo corte mensual (null: el próximo cobro es la renovación). */
    proximoCorte: Date | null;
  };
  /** Cobro mensual de adicionales generado y aún sin pagar. */
  cobroPendiente: null | { valor: number; url: string; adicionales: number };
};

function sumarMeses(d: Date, n: number) {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x;
}

type PaqueteVigente = { meses: number; paidAt: Date; cubiertos: number };

/** Último paquete pagado de varios meses que sigue vigente, con los adicionales que cubre. */
async function paqueteVigente(userId: string, plan: Plan): Promise<PaqueteVigente | null> {
  await ensureSchema();
  const [p] = await prisma.$queryRawUnsafe<
    { meses: number; paidAt: Date; amount: number; adicionales: number | null; paidUntil: Date | null }[]
  >(
    `SELECT b.meses, b."paidAt", b.amount, b.adicionales, u."paidUntil"
     FROM "BoldPayment" b JOIN "User" u ON u.id = b."userId"
     WHERE b."userId" = $1 AND b.status = 'PAID' AND b.tipo = 'plan' AND b."paidAt" IS NOT NULL
     ORDER BY b."paidAt" DESC LIMIT 1`,
    userId,
  );
  if (!p || p.meses <= 1 || !p.paidUntil || new Date(p.paidUntil).getTime() <= Date.now()) return null;
  // Pagos de antes de guardar el dato: se deduce del valor pagado.
  const base = plan.paquetes.find((x) => x.meses === p.meses)?.precio ?? 0;
  const cubiertos =
    p.adicionales ?? Math.max(0, Math.round((p.amount - base) / (plan.precioAdicional * p.meses)));
  return { meses: p.meses, paidAt: new Date(p.paidAt), cubiertos };
}

/**
 * Cortes mensuales dentro del tiempo pagado: cada mes contado hacia atrás desde
 * el fin del acceso, después del día del pago (el mes del pago ya va pagado).
 */
function cortes(paidAt: Date, paidUntil: Date) {
  const lista: Date[] = [];
  for (let j = 1; j <= 36; j++) {
    const c = sumarMeses(paidUntil, -j);
    if (c.getTime() <= paidAt.getTime() + 2 * DIA_MS) break;
    lista.unshift(c);
  }
  return lista;
}

export async function usoProcesos(userId: string): Promise<UsoProcesos> {
  const plan = await getPlan();
  const [u] = await prisma.$queryRawUnsafe<{ role: string; createdAt: Date; total: bigint }[]>(
    `SELECT u.role, u."createdAt", (SELECT count(DISTINCT radicado) FROM "Case" c WHERE c."userId" = u.id) AS total
     FROM "User" u WHERE u.id = $1`,
    userId,
  );
  const limitado = !!u && u.role !== "admin" && !(await esSocio(userId)) && new Date(u.createdAt) >= LIMITE_DESDE;
  // Los radicados que solo están en estados electrónicos también cuentan.
  let soloEstados = 0;
  if (limitado) {
    const { contarSoloEstados } = await import("./estados");
    soloEstados = await contarSoloEstados(userId).catch(() => 0);
  }
  const total = Number(u?.total ?? 0) + soloEstados;
  const adicionales = limitado ? Math.max(0, total - plan.procesosIncluidos) : 0;

  let prepago: UsoProcesos["prepago"] = null;
  let cobroPendiente: UsoProcesos["cobroPendiente"] = null;
  if (limitado) {
    const paq = await paqueteVigente(userId, plan).catch(() => null);
    if (paq) {
      const [u2] = await prisma.$queryRawUnsafe<{ paidUntil: Date }[]>(
        `SELECT "paidUntil" FROM "User" WHERE id = $1`,
        userId,
      );
      const porCobrar = Math.max(0, adicionales - paq.cubiertos);
      prepago = {
        meses: paq.meses,
        cubiertos: paq.cubiertos,
        porCobrar,
        valorCorte: porCobrar * plan.precioAdicional,
        proximoCorte: cortes(paq.paidAt, new Date(u2.paidUntil)).find((c) => c.getTime() > Date.now()) ?? null,
      };
    }
    const [c] = await prisma.$queryRawUnsafe<{ amount: number; url: string; adicionales: number | null }[]>(
      `SELECT amount, url, adicionales FROM "BoldPayment"
       WHERE "userId" = $1 AND tipo = 'adicionales' AND status IN ('ACTIVE', 'PROCESSING') AND url IS NOT NULL
       ORDER BY "createdAt" DESC LIMIT 1`,
      userId,
    ).catch(() => []);
    if (c) cobroPendiente = { valor: c.amount, url: c.url, adicionales: c.adicionales ?? 0 };
  }
  return {
    limitado,
    incluidos: plan.procesosIncluidos,
    total,
    adicionales,
    precioAdicional: plan.precioAdicional,
    valorMes: adicionales * plan.precioAdicional,
    prepago,
    cobroPendiente,
  };
}

// Bold no acepta links de muy poco valor: por debajo de esto se acumula al mes siguiente.
const MIN_COBRO = 1000;

/**
 * Cobro mensual de los procesos adicionales de quien pagó varios meses por
 * adelantado (cron horario). En cada corte mensual, los adicionales que no
 * cubría su paquete quedan en "AdicionalMes"; si lo pendiente llega al mínimo
 * de Bold se genera un link y se le avisa (correo, notificación y campana).
 * Lo que no alcanza el mínimo se suma al mes siguiente o a la renovación.
 */
export async function cobrarAdicionalesMensuales(): Promise<number> {
  if (!boldConfigurado()) return 0;
  await ensureSchema();
  const plan = await getPlan();
  const us = await prisma.$queryRawUnsafe<{ id: string; email: string; paidUntil: Date }[]>(
    `SELECT id, email, "paidUntil" FROM "User"
     WHERE role <> 'admin' AND NOT coalesce(socio, false) AND "createdAt" >= $1 AND "paidUntil" > now()`,
    LIMITE_DESDE,
  );
  let cobros = 0;
  for (const u of us) {
    try {
      const paq = await paqueteVigente(u.id, plan);
      if (!paq) continue;
      const corte = cortes(paq.paidAt, new Date(u.paidUntil))
        .filter((c) => c.getTime() <= Date.now())
        .pop();
      // Solo el corte de esta semana (no se cobran meses viejos de golpe).
      if (!corte || Date.now() - corte.getTime() > 7 * DIA_MS) continue;
      const uso = await usoProcesos(u.id);
      const porCobrar = Math.max(0, uso.adicionales - paq.cubiertos);
      if (porCobrar === 0) continue;
      const nuevo = await prisma.$executeRawUnsafe(
        `INSERT INTO "AdicionalMes" ("userId", corte, adicionales, valor) VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        u.id,
        corte,
        porCobrar,
        porCobrar * plan.precioAdicional,
      );
      if (nuevo !== 1) continue;
      const pend = await adicionalesSinCobrar(u.id);
      if (pend.valor < MIN_COBRO) continue;
      const link = await crearLinkBold({
        email: u.email,
        valor: pend.valor,
        descripcion: `Estradox - ${porCobrar} proceso(s) adicional(es) · mes desde el ${fechaCorta(corte)}`,
      });
      await prisma.$executeRawUnsafe(
        `INSERT INTO "BoldPayment" (id, "userId", amount, status, url, meses, tipo, adicionales)
         VALUES ($1, $2, $3, 'ACTIVE', $4, 0, 'adicionales', $5)`,
        link.id,
        u.id,
        pend.valor,
        link.url,
        porCobrar,
      );
      await prisma.$executeRawUnsafe(
        `UPDATE "AdicionalMes" SET "paymentId" = $2 WHERE "userId" = $1 AND corte = ANY($3::timestamptz[])`,
        u.id,
        link.id,
        pend.cortes,
      );
      await avisarCobroAdicionales(u.id, u.email, {
        porCobrar,
        cubiertos: paq.cubiertos,
        meses: paq.meses,
        total: uso.total,
        incluidos: uso.incluidos,
        precio: plan.precioAdicional,
        valor: pend.valor,
        url: link.url,
      });
      cobros++;
    } catch (e) {
      console.error("[suscripcion] cobro adicionales", u.id, e);
    }
  }
  return cobros;
}

/**
 * Meses de adicionales aún sin cobrar: sin link, o en un link de renovación
 * que no se pagó (ese link se abandona y se vuelven a cobrar).
 */
async function adicionalesSinCobrar(userId: string) {
  const filas = await prisma.$queryRawUnsafe<{ corte: Date; valor: number }[]>(
    `SELECT a.corte, a.valor FROM "AdicionalMes" a
     LEFT JOIN "BoldPayment" b ON b.id = a."paymentId"
     WHERE a."userId" = $1 AND (a."paymentId" IS NULL OR (b.tipo = 'plan' AND b.status <> 'PAID'))`,
    userId,
  );
  return { valor: filas.reduce((s, f) => s + f.valor, 0), cortes: filas.map((f) => f.corte) };
}

const fechaCorta = (d: Date) =>
  d.toLocaleDateString("es-CO", { day: "numeric", month: "long", timeZone: "America/Bogota" });

async function avisarCobroAdicionales(
  userId: string,
  email: string,
  d: {
    porCobrar: number;
    cubiertos: number;
    meses: number;
    total: number;
    incluidos: number;
    precio: number;
    valor: number;
    url: string;
  },
) {
  const pesos = (n: number) => `$${n.toLocaleString("es-CO")}`;
  const pagados = d.incluidos + d.cubiertos;
  const titulo = `📋 Cobro de ${d.porCobrar} proceso(s) adicional(es): ${pesos(d.valor)}`;
  const cuerpo =
    `Tu plan de ${d.meses} meses cubre ${pagados} procesos (${d.incluidos} incluidos` +
    (d.cubiertos ? ` + ${d.cubiertos} adicionales que pagaste` : "") +
    `) y hoy tienes ${d.total}. Los ${d.porCobrar} de más valen ${pesos(d.precio)} c/u al mes: ` +
    `${pesos(d.valor)} este mes. Mientras los tengas, se cobran cada mes; si eliminas los que ya no necesitas, no se cobran.`;
  const { sendPushToUser } = await import("./push");
  await sendPushToUser(userId, { title: titulo, body: cuerpo, url: "/dashboard/suscripcion", tag: "cobro-adicionales" });
  const { sendMail } = await import("./mailer");
  await sendMail({
    to: email,
    subject: titulo.replace("📋 ", ""),
    text: `${cuerpo}\n\nPagar: ${d.url}`,
    html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#222;max-width:560px">
      <p>${cuerpo}</p>
      <table style="border-collapse:collapse;margin:12px 0;font-size:14px">
        <tr><td style="padding:4px 12px 4px 0">Procesos incluidos en tu plan</td><td><b>${d.incluidos}</b></td></tr>
        ${d.cubiertos ? `<tr><td style="padding:4px 12px 4px 0">Adicionales ya pagados con tu plan</td><td><b>${d.cubiertos}</b></td></tr>` : ""}
        <tr><td style="padding:4px 12px 4px 0">Procesos que tienes hoy</td><td><b>${d.total}</b></td></tr>
        <tr><td style="padding:4px 12px 4px 0">Adicionales por cobrar este mes</td><td><b>${d.porCobrar} × ${pesos(d.precio)}</b></td></tr>
        <tr><td style="padding:4px 12px 4px 0">Total</td><td><b>${pesos(d.valor)}</b></td></tr>
      </table>
      <p><a href="${d.url}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Pagar ${pesos(d.valor)}</a></p>
      <p style="color:#666;font-size:13px">Puedes pagar con tarjeta, PSE, Nequi o Botón Bancolombia a través de Bold.</p>
    </div>`,
  });
}

/**
 * Después de agregar procesos: si pasó del límite (o tiene más adicionales que
 * la última vez), se le avisa con el valor que se sumará a su próximo pago.
 */
export async function avisarProcesosAdicionales(userId: string) {
  try {
    await ensureSchema();
    const uso = await usoProcesos(userId);
    if (!uso.limitado) return;
    const [r] = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT "adicionalesAvisados" AS n FROM "User" WHERE id = $1`,
      userId,
    );
    const avisados = r?.n ?? 0;
    // Si borró procesos, se baja el contador para volver a avisar cuando suba.
    if (uso.adicionales !== avisados) {
      await prisma.$executeRawUnsafe(
        `UPDATE "User" SET "adicionalesAvisados" = $2 WHERE id = $1`,
        userId,
        uso.adicionales,
      );
    }
    if (uso.adicionales <= avisados) return;
    const sub = await getSuscripcion(userId);
    const pesos = (n: number) => `$${n.toLocaleString("es-CO")}`;
    const { sendPushToUser } = await import("./push");
    // Pagó varios meses: solo cuentan los que pasan de lo que ya pagó, y se cobran mes a mes.
    const pp = uso.prepago;
    if (pp && pp.porCobrar === 0) return;
    await sendPushToUser(userId, {
      title: pp
        ? `📋 Tienes ${pp.porCobrar} proceso(s) más de los que pagaste`
        : `📋 Tienes ${uso.adicionales} proceso(s) adicional(es)`,
      body: pp
        ? `Tu plan de ${pp.meses} meses cubre ${uso.incluidos + pp.cubiertos} procesos y llevas ${uso.total}. ` +
          `Los ${pp.porCobrar} de más valen ${pesos(uso.precioAdicional)} c/u al mes (${pesos(pp.valorCorte)}/mes) ` +
          `y se cobran cada mes` +
          (pp.proximoCorte ? `; el próximo cobro es el ${fechaCorta(pp.proximoCorte)}.` : `, junto con tu renovación.`)
        : `Tu plan incluye ${uso.incluidos} procesos y llevas ${uso.total}. Cada adicional vale ` +
          `${pesos(uso.precioAdicional)} al mes: ${pesos(uso.valorMes)}/mes en total. ` +
          (sub.estado === "prueba"
            ? "Durante tu prueba gratis no se cobra; se sumará a tu primer pago."
            : "Se sumará a tu próximo pago."),
      url: "/dashboard/suscripcion",
      tag: "procesos-adicionales",
    });
  } catch (e) {
    console.error("[suscripcion] aviso adicionales", e);
  }
}

// ---------- Estado de la suscripción ----------
/** "socio": socio de Estradox (User.socio): acceso sin cobro y portal de socios. */
export type EstadoSub = "admin" | "socio" | "prueba" | "activa" | "vencida";
export type Suscripcion = {
  estado: EstadoSub;
  /** Hasta cuándo tiene acceso (fin de la prueba o del último pago). */
  accesoHasta: Date | null;
  trialEndsAt: Date | null;
  paidUntil: Date | null;
  diasRestantes: number;
};

type FilaSub = {
  id: string;
  role: string;
  socio: boolean;
  createdAt: Date;
  trialEndsAt: Date | null;
  paidUntil: Date | null;
};

function calcular(u: FilaSub, diasPrueba: number): Suscripcion & { trialNuevo: boolean } {
  let trial = u.trialEndsAt ? new Date(u.trialEndsAt) : null;
  let trialNuevo = false;
  if (!trial) {
    const inicio = new Date(Math.max(new Date(u.createdAt).getTime(), LANZAMIENTO.getTime()));
    trial = new Date(inicio.getTime() + diasPrueba * DIA_MS);
    trialNuevo = true;
  }
  const paid = u.paidUntil ? new Date(u.paidUntil) : null;
  const hasta = new Date(Math.max(trial.getTime(), paid?.getTime() ?? 0));
  const ahora = Date.now();
  const diasRestantes = Math.max(0, Math.ceil((hasta.getTime() - ahora) / DIA_MS));
  let estado: EstadoSub;
  if (u.role === "admin") estado = "admin";
  else if (u.socio) estado = "socio";
  else if (paid && paid.getTime() > ahora) estado = "activa";
  else if (trial.getTime() > ahora) estado = "prueba";
  else estado = "vencida";
  return { estado, accesoHasta: hasta, trialEndsAt: trial, paidUntil: paid, diasRestantes, trialNuevo };
}

async function filas(where: string, params: unknown[]): Promise<FilaSub[]> {
  await ensureSchema();
  return prisma.$queryRawUnsafe<FilaSub[]>(
    `SELECT id, role, coalesce(socio, false) AS socio, "createdAt", "trialEndsAt", "paidUntil" FROM "User" ${where}`,
    ...params,
  );
}

/** Estado de un usuario. La primera vez fija el fin de su prueba gratis. */
export async function getSuscripcion(userId: string): Promise<Suscripcion> {
  try {
    const [u] = await filas(`WHERE id = $1`, [userId]);
    if (!u) return { estado: "vencida", accesoHasta: null, trialEndsAt: null, paidUntil: null, diasRestantes: 0 };
    const { diasPrueba } = await getPlan();
    const { trialNuevo, ...s } = calcular(u, diasPrueba);
    if (trialNuevo && s.trialEndsAt) {
      await prisma.$executeRawUnsafe(
        `UPDATE "User" SET "trialEndsAt" = $1 WHERE id = $2 AND "trialEndsAt" IS NULL`,
        s.trialEndsAt,
        userId,
      );
    }
    return s;
  } catch (e) {
    // Si algo falla al leer la suscripción no se bloquea al usuario.
    console.error("[suscripcion] error leyendo estado", e);
    return { estado: "prueba", accesoHasta: null, trialEndsAt: null, paidUntil: null, diasRestantes: 0 };
  }
}

export function tieneAcceso(s: Suscripcion) {
  return s.estado !== "vencida";
}

/** Ids de usuarios con acceso (para que el cron no consulte procesos vencidos). */
export async function usuariosConAcceso(): Promise<Set<string>> {
  const { diasPrueba } = await getPlan();
  const us = await filas("", []);
  return new Set(us.filter((u) => calcular(u, diasPrueba).estado !== "vencida").map((u) => u.id));
}

/** Todos los usuarios con su estado (reporte del root). */
export async function suscripcionesDeTodos() {
  const { diasPrueba } = await getPlan();
  const us = await filas("", []);
  return new Map(us.map((u) => [u.id, calcular(u, diasPrueba)]));
}

/**
 * Suma acceso desde que termina el actual (o desde hoy si ya venció): días
 * (regalo del root) o meses calendario (pago de un paquete).
 */
export async function extenderAcceso(userId: string, cantidad: { dias?: number; meses?: number }) {
  const s = await getSuscripcion(userId);
  const hasta = new Date(Math.max(Date.now(), s.accesoHasta?.getTime() ?? 0));
  if (cantidad.meses) hasta.setUTCMonth(hasta.getUTCMonth() + cantidad.meses);
  if (cantidad.dias) hasta.setTime(hasta.getTime() + cantidad.dias * DIA_MS);
  await prisma.$executeRawUnsafe(
    `UPDATE "User" SET "paidUntil" = $1 WHERE id = $2`,
    hasta,
    userId,
  );
}

/** El root termina el acceso de un usuario de inmediato (prueba y plan). */
export async function terminarAcceso(userId: string) {
  await ensureSchema();
  await prisma.$executeRawUnsafe(
    `UPDATE "User" SET "trialEndsAt" = now() - interval '1 minute', "paidUntil" = NULL WHERE id = $1`,
    userId,
  );
}

// ---------- Pagos con Bold ----------
async function bold(path: string, init?: RequestInit) {
  const r = await fetch(`${BOLD_API}${path}`, {
    ...init,
    headers: {
      Authorization: `x-api-key ${process.env.BOLD_API_KEY ?? ""}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Bold ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return j as Record<string, unknown>;
}

/** Crea un link de pago de Bold para el plan mensual y devuelve su URL. */
export async function crearLinkDePago(user: { id: string; email: string }, meses: MesesPaquete) {
  if (!boldConfigurado()) throw new Error("Los pagos aún no están configurados.");
  await ensureSchema();
  const plan = await getPlan();
  const base = plan.paquetes.find((p) => p.meses === meses)?.precio ?? plan.precio;
  // Procesos adicionales (sobre los incluidos) por cada mes del paquete, más los
  // meses de adicionales que quedaron sin cobrar (por no llegar al mínimo de Bold).
  const uso = await usoProcesos(user.id);
  const atrasados = await adicionalesSinCobrar(user.id);
  const extra = uso.valorMes * meses + atrasados.valor;
  const precio = base + extra;
  const plazo = meses === 1 ? "Plan 1 mes" : `Plan ${meses} meses`;
  const link = await crearLinkBold({
    email: user.email,
    valor: precio,
    descripcion: uso.adicionales
      ? `Estradox - ${plazo} + ${uso.adicionales} proceso(s) adicional(es)`
      : atrasados.valor
        ? `Estradox - ${plazo} + adicionales de meses anteriores`
        : `Estradox - ${plazo}`,
  });
  await prisma.$executeRawUnsafe(
    `INSERT INTO "BoldPayment" (id, "userId", amount, status, url, meses, tipo, adicionales)
     VALUES ($1, $2, $3, 'ACTIVE', $4, $5, 'plan', $6)`,
    link.id,
    user.id,
    precio,
    link.url,
    meses,
    uso.adicionales,
  );
  if (atrasados.cortes.length) {
    await prisma.$executeRawUnsafe(
      `UPDATE "AdicionalMes" SET "paymentId" = $2 WHERE "userId" = $1 AND corte = ANY($3::timestamptz[])`,
      user.id,
      link.id,
      atrasados.cortes,
    );
  }
  return link.url;
}

async function crearLinkBold(d: { email: string; valor: number; descripcion: string }) {
  const j = await bold("/online/link/v1", {
    method: "POST",
    body: JSON.stringify({
      amount_type: "CLOSE",
      amount: { currency: "COP", total_amount: d.valor, tip_amount: 0 },
      description: d.descripcion,
      callback_url: `${APP_URL}/dashboard/suscripcion?pago=1`,
      payer_email: d.email,
    }),
  });
  const payload = (j.payload ?? {}) as { payment_link?: string; url?: string };
  if (!payload.payment_link || !payload.url) {
    throw new Error(`Bold no devolvió el link: ${JSON.stringify(j).slice(0, 300)}`);
  }
  return { id: payload.payment_link, url: payload.url };
}

/**
 * Consulta en Bold el estado de un link y, si está pagado, suma los días.
 * Es idempotente: un mismo pago nunca se acredita dos veces. El acceso solo se
 * da con lo que responde el API de Bold (no se confía en el webhook a ciegas).
 */
export async function confirmarPago(
  linkId: string,
  /**
   * Webhook SALE_APPROVED recibido para este link: "real" si vino firmado con la
   * llave secreta; "prueba" si vino firmado con llave vacía (modo de pruebas).
   */
  webhook?: { firma: "real" | "prueba"; monto: number | null; paymentId: string | null },
): Promise<boolean> {
  await ensureSchema();
  const [pago] = await prisma.$queryRawUnsafe<
    { id: string; userId: string; status: string; amount: number; meses: number; tipo: string }[]
  >(`SELECT id, "userId", status, amount, meses, tipo FROM "BoldPayment" WHERE id = $1`, linkId);
  if (!pago || pago.status === "PAID") return false;

  const j = await bold(`/online/link/v1/${encodeURIComponent(linkId)}`);
  const info = ((j.payload as Record<string, unknown>) ?? j) as {
    status?: string;
    transaction_id?: string;
    is_sandbox?: boolean;
  };
  let status = String(info.status ?? "");
  await logBold("consulta", {
    link: linkId,
    status,
    is_sandbox: info.is_sandbox,
    webhook: webhook ?? null,
  });

  // En modo de pruebas Bold deja el link "PROCESSING"; el pago se confirma con
  // el webhook. Uno firmado con la llave secreta es prueba suficiente; uno de
  // pruebas (llave vacía) solo vale si el API dice que el link es de pruebas.
  if (status !== "PAID" && webhook && (status === "PROCESSING" || status === "ACTIVE")) {
    const montoOk = webhook.monto == null || webhook.monto === pago.amount;
    if (montoOk && (webhook.firma === "real" || info.is_sandbox === true)) {
      status = "PAID";
      info.transaction_id = info.transaction_id ?? webhook.paymentId ?? undefined;
    }
  }

  if (status !== "PAID") {
    if (status && status !== pago.status) {
      await prisma.$executeRawUnsafe(
        `UPDATE "BoldPayment" SET status = $1 WHERE id = $2 AND status <> 'PAID'`,
        status,
        linkId,
      );
    }
    return false;
  }
  const marcado = await prisma.$executeRawUnsafe(
    `UPDATE "BoldPayment" SET status = 'PAID', "paidAt" = now(), "paymentId" = $1
     WHERE id = $2 AND status <> 'PAID'`,
    info.transaction_id ?? null,
    linkId,
  );
  if (marcado !== 1) return false; // otro proceso ya lo acreditó
  // El cobro mensual de adicionales no suma acceso: solo lo paga.
  if (pago.tipo !== "adicionales") await extenderAcceso(pago.userId, { meses: pago.meses || 1 });
  console.log(`[bold] pago ${linkId} acreditado a ${pago.userId}`);
  return true;
}

/** Revisa los links pendientes recientes del usuario (al volver del checkout). */
export async function verificarPagosPendientes(userId: string) {
  if (!boldConfigurado()) return;
  await ensureSchema();
  const pendientes = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM "BoldPayment"
     WHERE "userId" = $1 AND status IN ('ACTIVE', 'PROCESSING')
       AND ("createdAt" > now() - interval '3 days' OR (tipo = 'adicionales' AND "createdAt" > now() - interval '35 days'))
     ORDER BY "createdAt" DESC LIMIT 5`,
    userId,
  );
  for (const p of pendientes) {
    await confirmarPago(p.id).catch((e) => console.error("[bold] verificar", e));
  }
}

/**
 * Respaldo del webhook (cron horario): revisa en Bold todos los links
 * pendientes de los últimos 3 días, por si el usuario pagó y no volvió.
 */
export async function verificarTodosLosPagosPendientes(): Promise<number> {
  if (!boldConfigurado()) return 0;
  await ensureSchema();
  const pendientes = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM "BoldPayment"
     WHERE status IN ('ACTIVE', 'PROCESSING')
       AND ("createdAt" > now() - interval '3 days' OR (tipo = 'adicionales' AND "createdAt" > now() - interval '35 days'))
     ORDER BY "createdAt" DESC LIMIT 50`,
  );
  let acreditados = 0;
  for (const p of pendientes) {
    if (await confirmarPago(p.id).catch(() => false)) acreditados++;
  }
  return acreditados;
}

export async function pagosDeUsuario(userId: string) {
  await ensureSchema();
  return prisma.$queryRawUnsafe<
    { id: string; amount: number; status: string; createdAt: Date; paidAt: Date | null; meses: number; tipo: string; adicionales: number | null }[]
  >(
    `SELECT id, amount, status, "createdAt", "paidAt", meses, tipo, adicionales FROM "BoldPayment"
     WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 20`,
    userId,
  );
}

export async function totalPagosAprobados() {
  await ensureSchema();
  const [r] = await prisma.$queryRawUnsafe<{ n: bigint; total: bigint | null }[]>(
    `SELECT count(*) AS n, sum(amount) AS total FROM "BoldPayment" WHERE status = 'PAID'`,
  );
  return { pagos: Number(r?.n ?? 0), total: Number(r?.total ?? 0) };
}

// ---------- Avisos de vencimiento (cron horario) ----------
/**
 * Usuarios a avisar: "por vencer" (quedan ≤ 3 días) y "vencida" (ya expiró).
 * Cada aviso se manda una vez por fecha de vencimiento.
 */
export async function avisosDeVencimientoPendientes() {
  const { diasPrueba } = await getPlan();
  await ensureSchema();
  const us = await prisma.$queryRawUnsafe<
    (FilaSub & { subNoticeFor: Date | null; subExpiredFor: Date | null })[]
  >(
    `SELECT id, role, "createdAt", "trialEndsAt", "paidUntil", "subNoticeFor", "subExpiredFor"
     FROM "User" WHERE role <> 'admin' AND "emailVerified" IS NOT NULL`,
  );
  const porVencer: { id: string; hasta: Date }[] = [];
  const vencidos: { id: string; hasta: Date }[] = [];
  const ahora = Date.now();
  for (const u of us) {
    const s = calcular(u, diasPrueba);
    if (!s.accesoHasta) continue;
    const hasta = s.accesoHasta;
    const iguales = (d: Date | null) => !!d && Math.abs(new Date(d).getTime() - hasta.getTime()) < 60_000;
    if (s.estado === "vencida") {
      // Solo avisa vencimientos recientes (no a cuentas abandonadas hace meses).
      if (!iguales(u.subExpiredFor) && ahora - hasta.getTime() < 7 * DIA_MS) {
        vencidos.push({ id: u.id, hasta });
      }
    } else if (hasta.getTime() - ahora <= 3 * DIA_MS && !iguales(u.subNoticeFor)) {
      porVencer.push({ id: u.id, hasta });
    }
  }
  return { porVencer, vencidos };
}

export async function marcarAviso(userId: string, tipo: "porVencer" | "vencida", hasta: Date) {
  const col = tipo === "porVencer" ? "subNoticeFor" : "subExpiredFor";
  await prisma.$executeRawUnsafe(`UPDATE "User" SET "${col}" = $1 WHERE id = $2`, hasta, userId);
}

// ---------- Oferta relámpago del día 15 ----------
// A mitad de la prueba gratis, si Estradox ya le avisó varias actuaciones nuevas
// al abogado, se le ofrece el plan de 12 meses. Como el tiempo pagado se suma
// desde que termina la prueba, los días gratis que le quedan quedan al final.
const DIA_OFERTA = 15;
const MIN_ALERTAS = 5;

export type OfertaRelampago = {
  precio: number;
  ahorro: number;
  diasUsados: number;
  diasRestantes: number;
  alertas: number;
};

export async function ofertaRelampago(
  userId: string,
  sub: Suscripcion,
): Promise<OfertaRelampago | null> {
  if (sub.estado !== "prueba" || !sub.trialEndsAt) return null;
  try {
    const plan = await getPlan();
    const inicio = sub.trialEndsAt.getTime() - plan.diasPrueba * DIA_MS;
    const diasUsados = Math.floor((Date.now() - inicio) / DIA_MS);
    if (diasUsados < DIA_OFERTA) return null;

    // Alertas: actuaciones que la revisión diaria encontró después de agregar
    // el proceso (las del historial inicial no cuentan).
    const [r] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM "Actuacion" a
       JOIN "Case" c ON c.id = a."caseId"
       WHERE c."userId" = $1 AND a."createdAt" > c."createdAt" + interval '10 minutes'`,
      userId,
    );
    const alertas = Number(r?.n ?? 0);
    if (alertas < MIN_ALERTAS) return null;

    const anual = plan.paquetes.find((p) => p.meses === 12)?.precio;
    if (!anual) return null;
    return {
      precio: anual,
      ahorro: plan.precio * 12 - anual,
      diasUsados,
      diasRestantes: sub.diasRestantes,
      alertas,
    };
  } catch {
    return null;
  }
}
