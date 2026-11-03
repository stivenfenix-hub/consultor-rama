import "server-only";
import { prisma } from "./db";
import { subirADrive } from "./drive";

// ---------- Portal socios: contabilidad de la sociedad ----------
// Cada socio sube sus comprobantes (transferencias, tiquetes, facturas, pagos
// de servicios para Estradox). Gemini lee monto, fecha, a quién se pagó y el
// concepto; el socio revisa y confirma. Solo lo confirmado suma. Los ingresos
// de la plataforma salen solos de los pagos aprobados de Bold. El archivo se
// guarda en la base solo hasta subirlo al Google Drive del root.
//
// Variables: GEMINI_API_KEY (obligatoria para leer comprobantes) y
// GEMINI_MODEL (opcional, por defecto gemini-2.5-flash).

export const TIPOS = {
  gasto: "Gasto pagado por el socio",
  aporte: "Aporte de dinero a Estradox",
  ingreso: "Ingreso (fuera de Bold)",
} as const;
export type TipoMov = keyof typeof TIPOS;
export const esTipo = (t: string): t is TipoMov => t in TIPOS;

export const MAX_ARCHIVO = 10 * 1024 * 1024; // 10 MB
export const MIMES_OK = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

let listo = false;
async function asegurar() {
  if (listo) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "SocioMovimiento" (
      id SERIAL PRIMARY KEY,
      "socioId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL DEFAULT 'gasto',
      fecha DATE,
      monto BIGINT,
      concepto TEXT,
      proveedor TEXT,
      medio TEXT,
      referencia TEXT,
      nota TEXT,
      estado TEXT NOT NULL DEFAULT 'procesando',
      "iaError" TEXT,
      ia JSONB,
      "archivoNombre" TEXT,
      "archivoTipo" TEXT,
      archivo BYTEA,
      "driveId" TEXT,
      "driveUrl" TEXT,
      "driveError" TEXT,
      "creadoPor" TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  listo = true;
}

// ---------- Lectura del comprobante con Gemini ----------
type Lectura = {
  fecha: string | null;
  monto: number | null;
  moneda: string | null;
  concepto: string | null;
  proveedor: string | null;
  medio: string | null;
  referencia: string | null;
  tipo: TipoMov | null;
};

export function iaConfigurada() {
  return !!process.env.GEMINI_API_KEY;
}

const PROMPT = `Eres contador. Este archivo es un comprobante de pago relacionado con la empresa Estradox
(transferencia bancaria, Nequi/Daviplata, tiquete, factura, recibo o pago de un servicio).
Extrae los datos y responde SOLO el JSON pedido:
- fecha: fecha del pago en formato AAAA-MM-DD (null si no aparece).
- monto: valor total pagado como número entero en pesos colombianos, sin puntos ni símbolos (null si no se ve).
- moneda: "COP" salvo que diga claramente otra.
- concepto: qué se pagó, corto (ej. "Hosting Hostinger", "Tiquete Bogotá-Medellín", "Transferencia a Juan").
- proveedor: a quién se le pagó o quién recibe (empresa o persona).
- medio: medio de pago (transferencia, tarjeta, Nequi, Daviplata, efectivo, PSE...).
- referencia: número de transacción, factura o aprobación si aparece.
- tipo: "gasto" si es un pago a un tercero por un bien o servicio; "aporte" si es dinero transferido a
  la cuenta de Estradox o a otro socio como inversión; "ingreso" si es dinero que recibió Estradox.`;

async function leerConGemini(mime: string, datos: Buffer): Promise<Lectura> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Falta GEMINI_API_KEY en el servidor.");
  const modelo = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const nullable = (type: string) => ({ type, nullable: true });
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({
      contents: [{ parts: [{ inline_data: { mime_type: mime, data: datos.toString("base64") } }, { text: PROMPT }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            fecha: nullable("string"),
            monto: nullable("number"),
            moneda: nullable("string"),
            concepto: nullable("string"),
            proveedor: nullable("string"),
            medio: nullable("string"),
            referencia: nullable("string"),
            tipo: { type: "string", enum: ["gasto", "aporte", "ingreso"], nullable: true },
          },
        },
      },
    }),
  });
  const j = (await r.json().catch(() => ({}))) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    error?: { message?: string };
  };
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${j.error?.message ?? ""}`.slice(0, 300));
  const texto = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  const l = JSON.parse(texto) as Lectura;
  const fecha = l.fecha && /^\d{4}-\d{2}-\d{2}$/.test(l.fecha) ? l.fecha : null;
  const monto = typeof l.monto === "number" && Number.isFinite(l.monto) ? Math.round(l.monto) : null;
  return { ...l, fecha, monto, tipo: l.tipo && esTipo(l.tipo) ? l.tipo : null };
}

// ---------- Movimientos ----------
/** Guarda el comprobante y lo procesa en segundo plano (IA + Drive). */
export async function crearDesdeComprobante(
  socioId: string,
  creadoPor: string,
  archivo: { nombre: string; tipo: string; datos: Buffer },
  nota: string | null,
) {
  await asegurar();
  const [r] = await prisma.$queryRawUnsafe<{ id: number }[]>(
    `INSERT INTO "SocioMovimiento" ("socioId", "creadoPor", nota, "archivoNombre", "archivoTipo", archivo, estado)
     VALUES ($1, $2, $3, $4, $5, $6, 'procesando') RETURNING id`,
    socioId,
    creadoPor,
    nota,
    archivo.nombre,
    archivo.tipo,
    archivo.datos,
  );
  return r.id;
}

/** Lee con la IA un movimiento recién subido; queda "por revisar". */
export async function procesarComprobante(id: number) {
  await asegurar();
  const [m] = await prisma.$queryRawUnsafe<{ archivo: Buffer | null; archivoTipo: string | null }[]>(
    `SELECT archivo, "archivoTipo" FROM "SocioMovimiento" WHERE id = $1`,
    id,
  );
  if (!m?.archivo) return;
  try {
    const l = await leerConGemini(m.archivoTipo ?? "application/pdf", Buffer.from(m.archivo));
    await prisma.$executeRawUnsafe(
      `UPDATE "SocioMovimiento" SET estado = 'revisar', "iaError" = NULL, ia = $2::jsonb,
         fecha = coalesce($3::date, fecha), monto = coalesce($4::bigint, monto), concepto = coalesce($5, concepto),
         proveedor = coalesce($6, proveedor), medio = coalesce($7, medio), referencia = coalesce($8, referencia),
         tipo = coalesce($9, tipo)
       WHERE id = $1`,
      id,
      JSON.stringify(l),
      l.fecha,
      l.monto,
      l.concepto,
      l.proveedor,
      l.medio,
      l.referencia,
      l.tipo,
    );
  } catch (e) {
    await prisma.$executeRawUnsafe(
      `UPDATE "SocioMovimiento" SET estado = 'revisar', "iaError" = $2 WHERE id = $1`,
      id,
      (e instanceof Error ? e.message : String(e)).slice(0, 300),
    );
  }
  await subirMovimientoADrive(id).catch(() => {});
}

/** Sube el archivo a Drive (con nombre ordenable) y lo borra de la base. */
async function subirMovimientoADrive(id: number) {
  const [m] = await prisma.$queryRawUnsafe<
    {
      archivo: Buffer | null;
      archivoTipo: string | null;
      archivoNombre: string | null;
      fecha: Date | null;
      monto: bigint | null;
      concepto: string | null;
      socio: string;
    }[]
  >(
    `SELECT m.archivo, m."archivoTipo", m."archivoNombre", m.fecha, m.monto, m.concepto,
            coalesce(nullif(trim(coalesce(u."firstName",'') || ' ' || coalesce(u."lastName",'')), ''), u.name, u.email) AS socio
     FROM "SocioMovimiento" m JOIN "User" u ON u.id = m."socioId" WHERE m.id = $1`,
    id,
  );
  if (!m?.archivo) return;
  const ext = (m.archivoNombre?.match(/\.[a-z0-9]{2,5}$/i)?.[0] ?? "").toLowerCase();
  const nombre = [
    m.fecha ? new Date(m.fecha).toISOString().slice(0, 10) : "sin-fecha",
    m.socio,
    m.monto != null ? `$${Number(m.monto).toLocaleString("es-CO")}` : null,
    m.concepto?.slice(0, 60),
    `#${id}`,
  ]
    .filter(Boolean)
    .join(" - ")
    .replace(/[\\/:*?"<>|]/g, "-");
  try {
    const r = await subirADrive(nombre + ext, m.archivoTipo ?? "application/octet-stream", Buffer.from(m.archivo));
    if (!r) return; // Drive aún no conectado: se queda en la base y se sube después.
    await prisma.$executeRawUnsafe(
      `UPDATE "SocioMovimiento" SET "driveId" = $2, "driveUrl" = $3, "driveError" = NULL, archivo = NULL WHERE id = $1`,
      id,
      r.id,
      r.url,
    );
  } catch (e) {
    await prisma.$executeRawUnsafe(
      `UPDATE "SocioMovimiento" SET "driveError" = $2 WHERE id = $1`,
      id,
      (e instanceof Error ? e.message : String(e)).slice(0, 300),
    );
    throw e;
  }
}

/** Cron / al conectar Drive: sube los archivos que siguen en la base (máx. 5 por vez). */
export async function subirPendientesADrive() {
  await asegurar();
  const filas = await prisma.$queryRawUnsafe<{ id: number }[]>(
    `SELECT id FROM "SocioMovimiento" WHERE archivo IS NOT NULL AND estado <> 'procesando' ORDER BY id LIMIT 5`,
  );
  let n = 0;
  for (const f of filas) {
    try {
      await subirMovimientoADrive(f.id);
      n++;
    } catch {
      break; // Drive falló: se reintenta en la próxima corrida.
    }
  }
  return n;
}

/** Movimiento sin archivo (efectivo, algo sin comprobante). */
export async function crearManual(
  socioId: string,
  creadoPor: string,
  d: { tipo: TipoMov; fecha: string; monto: number; concepto: string; proveedor: string | null; medio: string | null },
) {
  await asegurar();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "SocioMovimiento" ("socioId", "creadoPor", tipo, fecha, monto, concepto, proveedor, medio, estado)
     VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, 'confirmado')`,
    socioId,
    creadoPor,
    d.tipo,
    d.fecha,
    d.monto,
    d.concepto,
    d.proveedor,
    d.medio,
  );
}

/** El socio revisa lo que leyó la IA, corrige y confirma (solo lo confirmado suma). */
export async function confirmarMovimiento(
  id: number,
  d: { tipo: TipoMov; fecha: string; monto: number; concepto: string; proveedor: string | null; medio: string | null; socioId: string },
) {
  await asegurar();
  await prisma.$executeRawUnsafe(
    `UPDATE "SocioMovimiento" SET tipo = $2, fecha = $3::date, monto = $4, concepto = $5, proveedor = $6, medio = $7,
       "socioId" = $8, estado = 'confirmado' WHERE id = $1`,
    id,
    d.tipo,
    d.fecha,
    d.monto,
    d.concepto,
    d.proveedor,
    d.medio,
    d.socioId,
  );
}

export async function borrarMovimiento(id: number) {
  await asegurar();
  await prisma.$executeRawUnsafe(`DELETE FROM "SocioMovimiento" WHERE id = $1`, id);
}

export async function movimiento(id: number) {
  await asegurar();
  const [m] = await prisma.$queryRawUnsafe<
    { id: number; socioId: string; creadoPor: string | null; archivo: Buffer | null; archivoTipo: string | null; archivoNombre: string | null; driveUrl: string | null }[]
  >(
    `SELECT id, "socioId", "creadoPor", archivo, "archivoTipo", "archivoNombre", "driveUrl" FROM "SocioMovimiento" WHERE id = $1`,
    id,
  );
  return m ?? null;
}

export type MovVista = {
  id: number;
  socioId: string;
  socio: string;
  tipo: TipoMov;
  fecha: Date | null;
  monto: number | null;
  concepto: string | null;
  proveedor: string | null;
  medio: string | null;
  referencia: string | null;
  nota: string | null;
  estado: "procesando" | "revisar" | "confirmado";
  iaError: string | null;
  archivoNombre: string | null;
  tieneArchivo: boolean;
  driveUrl: string | null;
  driveError: string | null;
  createdAt: Date;
};

export async function listarMovimientos(desde: number, cantidad: number, socioId?: string) {
  await asegurar();
  const filtro = socioId ? `WHERE m."socioId" = $3` : "";
  const filas = await prisma.$queryRawUnsafe<(Omit<MovVista, "monto"> & { monto: bigint | null })[]>(
    `SELECT m.id, m."socioId",
            coalesce(nullif(trim(coalesce(u."firstName",'') || ' ' || coalesce(u."lastName",'')), ''), u.name, u.email) AS socio,
            m.tipo, m.fecha, m.monto, m.concepto, m.proveedor, m.medio, m.referencia, m.nota, m.estado, m."iaError",
            m."archivoNombre", (m.archivo IS NOT NULL) AS "tieneArchivo", m."driveUrl", m."driveError", m."createdAt"
     FROM "SocioMovimiento" m JOIN "User" u ON u.id = m."socioId" ${filtro}
     ORDER BY (m.estado = 'confirmado'), m.fecha DESC NULLS FIRST, m.id DESC
     LIMIT $1 OFFSET $2`,
    ...(socioId ? [cantidad, desde, socioId] : [cantidad, desde]),
  );
  const [t] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n FROM "SocioMovimiento" m ${socioId ? `WHERE m."socioId" = $1` : ""}`,
    ...(socioId ? [socioId] : []),
  );
  return {
    movimientos: filas.map((f) => ({ ...f, monto: f.monto == null ? null : Number(f.monto) })) as MovVista[],
    total: Number(t?.n ?? 0),
  };
}

// ---------- Totales ----------
export async function resumenSociedad() {
  await asegurar();
  const socios = await prisma.$queryRawUnsafe<{ id: string; nombre: string }[]>(
    `SELECT id, coalesce(nullif(trim(coalesce("firstName",'') || ' ' || coalesce("lastName",'')), ''), name, email) AS nombre
     FROM "User" WHERE role = 'admin' OR socio ORDER BY role = 'admin' DESC, "createdAt"`,
  );
  const sumas = await prisma.$queryRawUnsafe<{ socioId: string; tipo: string; total: bigint }[]>(
    `SELECT "socioId", tipo, coalesce(sum(monto), 0) AS total FROM "SocioMovimiento"
     WHERE estado = 'confirmado' GROUP BY "socioId", tipo`,
  );
  const [pend] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n FROM "SocioMovimiento" WHERE estado <> 'confirmado'`,
  );
  // Ingresos de la plataforma: pagos aprobados de Bold.
  let bold = 0;
  try {
    const [b] = await prisma.$queryRawUnsafe<{ t: bigint }[]>(
      `SELECT coalesce(sum(amount), 0) AS t FROM "BoldPayment" WHERE status = 'PAID'`,
    );
    bold = Number(b?.t ?? 0);
  } catch {
    // tabla aún no creada
  }
  const de = (socioId: string, tipo: string) =>
    Number(sumas.find((s) => s.socioId === socioId && s.tipo === tipo)?.total ?? 0);
  const porSocio = socios.map((s) => ({
    ...s,
    gastos: de(s.id, "gasto"),
    aportes: de(s.id, "aporte"),
    invertido: de(s.id, "gasto") + de(s.id, "aporte"),
    ingresos: de(s.id, "ingreso"),
  }));
  const invertido = porSocio.reduce((n, s) => n + s.invertido, 0);
  const ingresosManuales = porSocio.reduce((n, s) => n + s.ingresos, 0);
  // Reparto 50/50 (partes iguales entre los socios): cuánto le falta a cada uno para igualar.
  const parte = socios.length ? invertido / socios.length : 0;
  return {
    porSocio: porSocio.map((s) => ({ ...s, diferencia: Math.round(s.invertido - parte) })),
    invertido,
    ingresosBold: bold,
    ingresosManuales,
    ingresos: bold + ingresosManuales,
    resultado: bold + ingresosManuales - invertido,
    porRevisar: Number(pend?.n ?? 0),
  };
}
