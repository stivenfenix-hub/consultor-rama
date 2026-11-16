import "server-only";
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { prisma } from "./db";

/**
 * Firma Electrónica (Ley 527 de 1999, Decreto 2364 de 2012, art. 5 Ley 2213 de 2022).
 *
 * Datos y reglas del módulo: documentos, firmantes y bitácora de auditoría.
 * Como el resto de Estradox, las tablas se crean solas (CREATE TABLE IF NOT
 * EXISTS) la primera vez que se usan: no hay migraciones que correr.
 *
 *   FirmaDocumento  = signature_documents
 *   FirmaFirmante   = document_signers
 *   FirmaAuditoria  = signature_audit_logs
 */

export type EstadoDocumento = "DRAFT" | "PENDING" | "PARTIALLY_SIGNED" | "COMPLETED" | "REJECTED" | "EXPIRED";
export type EstadoFirmante = "PENDING" | "VIEWED" | "SIGNED" | "REJECTED";
export type EventoFirma =
  | "CREATED"
  | "SENT_EMAIL"
  | "SENT_WHATSAPP"
  | "LINK_OPENED"
  | "OTP_SENT"
  | "OTP_VERIFIED"
  | "OTP_FAILED"
  | "DOCUMENT_VIEWED"
  | "SIGNED"
  | "REJECTED"
  | "REMINDER_SENT"
  | "SEALED_PDF_GENERATED"
  | "IDENTITY_VERIFIED"
  | "IDENTITY_INCONCLUSIVE";
export type TipoDoc = "CC" | "CE" | "NIT" | "PAS";
export const TIPOS_DOC: Record<TipoDoc, string> = {
  CC: "Cédula de ciudadanía",
  CE: "Cédula de extranjería",
  NIT: "NIT",
  PAS: "Pasaporte",
};

/** Posición relativa de la firma en la página (0 a 1, origen arriba a la izquierda). */
export type PosicionFirma = { page: number; x: number; y: number; width: number; height: number };

export const ESTADOS_DOC: Record<EstadoDocumento, string> = {
  DRAFT: "Borrador",
  PENDING: "Enviado",
  PARTIALLY_SIGNED: "Firmado en parte",
  COMPLETED: "Completado",
  REJECTED: "Rechazado",
  EXPIRED: "Vencido",
};
export const ESTADOS_FIRMANTE: Record<EstadoFirmante, string> = {
  PENDING: "Pendiente",
  VIEWED: "Lo abrió",
  SIGNED: "Firmó",
  REJECTED: "Rechazó",
};
export const EVENTOS: Record<EventoFirma, string> = {
  CREATED: "Documento creado",
  SENT_EMAIL: "Enlace enviado por correo",
  SENT_WHATSAPP: "Enlace enviado por WhatsApp",
  LINK_OPENED: "Abrió el enlace",
  OTP_SENT: "Código de verificación enviado",
  OTP_VERIFIED: "Código verificado (identidad confirmada)",
  OTP_FAILED: "Código incorrecto",
  DOCUMENT_VIEWED: "Leyó el documento",
  SIGNED: "Firmó el documento",
  REJECTED: "Rechazó el documento",
  REMINDER_SENT: "Recordatorio enviado",
  SEALED_PDF_GENERATED: "PDF sellado y certificado generado",
  IDENTITY_VERIFIED: "Identidad verificada (cédula y rostro)",
  IDENTITY_INCONCLUSIVE: "Verificación de identidad no concluyente",
};

/**
 * Cuánto se le pide al firmante para probar quién es (lo elige el abogado):
 *   otp         código de 6 dígitos al correo o WhatsApp
 *   cedula      + fotos de la cédula (frente y reverso) y lectura del número
 *   biometrica  + selfie con prueba de vida comparada con la foto de la cédula
 */
export type NivelVerificacion = "otp" | "cedula" | "biometrica";
export const NIVELES: Record<NivelVerificacion, { t: string; d: string }> = {
  otp: { t: "Solo código", d: "Código de 6 dígitos al correo o WhatsApp." },
  cedula: { t: "Código + cédula", d: "Además, fotos de la cédula por ambos lados; leemos el número y lo comparamos." },
  biometrica: {
    t: "Código + cédula + rostro",
    d: "Además, una selfie con prueba de vida que se compara con la foto de la cédula.",
  },
};
export const esNivel = (n: unknown): n is NivelVerificacion => n === "otp" || n === "cedula" || n === "biometrica";

/** Resultado de la verificación de identidad (lo que queda como evidencia). */
export type ResultadoIdentidad = {
  nivel: NivelVerificacion;
  /** verificada = todo coincide; no_concluyente = alguna comprobación automática no coincidió. */
  estado: "verificada" | "no_concluyente";
  /** Dónde se hizo la comparación: "estradox" (en el dispositivo) o el proveedor externo. */
  motor: string;
  numeroLeido: string | null;
  numeroCoincide: boolean | null;
  /** Similitud facial 0-1 (1 = idéntico) y si supera el umbral. */
  similitud: number | null;
  rostroCoincide: boolean | null;
  vida: { parpadeo: boolean; giro: boolean } | null;
  intentos: number;
  huellas: Record<string, string>;
};

/** Resumen en una línea (detalle del abogado y certificado). */
export function resumenIdentidad(r: ResultadoIdentidad | null): string | null {
  if (!r) return null;
  const partes = [
    r.numeroCoincide === null ? "cédula aportada" : r.numeroCoincide ? "número de cédula coincide" : "número de cédula no legible o distinto",
  ];
  if (r.nivel === "biometrica") {
    partes.push(
      r.similitud === null
        ? "comparación facial sin resultado"
        : `rostro ${r.rostroCoincide ? "coincide" : "no coincide"} con la cédula (${Math.round(r.similitud * 100)} %)`,
    );
    if (r.vida) partes.push(r.vida.giro ? "prueba de vida superada" : "prueba de vida incompleta");
  }
  return `${r.estado === "verificada" ? "Identidad verificada" : "Identidad no concluyente"}: ${partes.join(" · ")}`;
}

/** El enlace de firma vence a los 30 días. */
export const DIAS_VIGENCIA = 30;
export const OTP_MINUTOS = 10;
export const OTP_MAX_INTENTOS = 5;

let listo: Promise<void> | null = null;
export function asegurarTablasFirma() {
  listo ??= (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "FirmaDocumento" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
        radicado TEXT,
        titulo TEXT NOT NULL,
        estado TEXT NOT NULL DEFAULT 'DRAFT',
        paginas INTEGER NOT NULL DEFAULT 1,
        "originalUrl" TEXT NOT NULL,
        "originalSha256" TEXT NOT NULL,
        "firmadoUrl" TEXT,
        "firmadoSha256" TEXT,
        "otpCorreo" BOOLEAN NOT NULL DEFAULT true,
        "otpWhatsapp" BOOLEAN NOT NULL DEFAULT false,
        sello JSONB,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "enviadoAt" TIMESTAMPTZ,
        "completedAt" TIMESTAMPTZ
      )`);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "FirmaFirmante" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "documentoId" UUID NOT NULL REFERENCES "FirmaDocumento"(id) ON DELETE CASCADE,
        nombre TEXT NOT NULL,
        "tipoDoc" TEXT NOT NULL DEFAULT 'CC',
        "numDoc" TEXT NOT NULL,
        email TEXT,
        telefono TEXT,
        orden INTEGER NOT NULL DEFAULT 1,
        token TEXT NOT NULL UNIQUE,
        "otpHash" TEXT,
        "otpExpira" TIMESTAMPTZ,
        "otpIntentos" INTEGER NOT NULL DEFAULT 0,
        "otpVerificadoAt" TIMESTAMPTZ,
        "firmaUrl" TEXT,
        "tipoFirma" TEXT,
        posicion JSONB,
        estado TEXT NOT NULL DEFAULT 'PENDING',
        motivo TEXT,
        "firmadoAt" TIMESTAMPTZ
      )`);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "FirmaAuditoria" (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "documentoId" UUID NOT NULL REFERENCES "FirmaDocumento"(id) ON DELETE CASCADE,
        "firmanteId" UUID REFERENCES "FirmaFirmante"(id) ON DELETE SET NULL,
        evento TEXT NOT NULL,
        ip TEXT,
        "userAgent" TEXT,
        metadata JSONB,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "FirmaDocumento_user" ON "FirmaDocumento" ("userId", "createdAt" DESC)`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "FirmaFirmante_doc" ON "FirmaFirmante" ("documentoId", orden)`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "FirmaAuditoria_doc" ON "FirmaAuditoria" ("documentoId", "createdAt")`,
    );
    // Verificación de identidad (cédula y reconocimiento facial).
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "FirmaDocumento" ADD COLUMN IF NOT EXISTS verificacion TEXT NOT NULL DEFAULT 'otp'`,
    );
    for (const col of [
      `"cedulaFrenteUrl" TEXT`,
      `"cedulaReversoUrl" TEXT`,
      `"selfieUrl" TEXT`,
      `identidad JSONB`,
      `"identidadAt" TIMESTAMPTZ`,
    ]) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "FirmaFirmante" ADD COLUMN IF NOT EXISTS ${col}`);
    }
  })().catch((e) => {
    listo = null;
    throw e;
  });
  return listo;
}

// ---------- Utilidades de seguridad ----------

const SECRETO = () => process.env.SESSION_SECRET ?? "dev-secret-inseguro";
export const esUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
export const esToken = (s: string) => /^[A-Za-z0-9_-]{43}$/.test(s);
export const sha256 = (b: Uint8Array | Buffer | string) => createHash("sha256").update(b).digest("hex");
/** Token del enlace de firma: 256 bits aleatorios (no adivinable). */
export const nuevoToken = () => randomBytes(32).toString("base64url");
export const nuevoOtp = () => String(randomInt(0, 1_000_000)).padStart(6, "0");
/** El código no se guarda: solo su HMAC atado al firmante. */
export const hashOtp = (firmanteId: string, codigo: string) =>
  createHmac("sha256", SECRETO()).update(`otp:${firmanteId}:${codigo}`).digest("hex");

/** Cookie que prueba que este navegador ya pasó el OTP de ese firmante (30 min). */
export const cookieFirma = (firmanteId: string) => `firma_${firmanteId.replace(/-/g, "")}`;
export function sellarSesion(firmanteId: string, minutos = 30) {
  const exp = Date.now() + minutos * 60_000;
  const mac = createHmac("sha256", SECRETO()).update(`sesion:${firmanteId}:${exp}`).digest("hex");
  return `${exp}.${mac}`;
}
export function sesionValida(firmanteId: string, valor: string | undefined) {
  if (!valor) return false;
  const [exp, mac] = valor.split(".");
  if (!exp || !mac || Number(exp) < Date.now()) return false;
  const bueno = createHmac("sha256", SECRETO()).update(`sesion:${firmanteId}:${exp}`).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(mac, "hex"), Buffer.from(bueno, "hex"));
  } catch {
    return false;
  }
}

/** IP y navegador de quien hace la petición (para la bitácora). */
export function origenDe(h: Headers) {
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || h.get("cf-connecting-ip") || null;
  return { ip, userAgent: h.get("user-agent")?.slice(0, 400) ?? null };
}

// ---------- Tipos de lectura ----------

export type Documento = {
  id: string;
  userId: string;
  radicado: string | null;
  titulo: string;
  estado: EstadoDocumento;
  paginas: number;
  originalUrl: string;
  originalSha256: string;
  firmadoUrl: string | null;
  firmadoSha256: string | null;
  otpCorreo: boolean;
  otpWhatsapp: boolean;
  verificacion: NivelVerificacion;
  sello: Record<string, unknown> | null;
  createdAt: Date;
  enviadoAt: Date | null;
  completedAt: Date | null;
};
export type Firmante = {
  id: string;
  documentoId: string;
  nombre: string;
  tipoDoc: TipoDoc;
  numDoc: string;
  email: string | null;
  telefono: string | null;
  orden: number;
  token: string;
  otpHash: string | null;
  otpExpira: Date | null;
  otpIntentos: number;
  otpVerificadoAt: Date | null;
  firmaUrl: string | null;
  tipoFirma: string | null;
  posicion: PosicionFirma | null;
  estado: EstadoFirmante;
  motivo: string | null;
  firmadoAt: Date | null;
  cedulaFrenteUrl: string | null;
  cedulaReversoUrl: string | null;
  selfieUrl: string | null;
  identidad: ResultadoIdentidad | null;
  identidadAt: Date | null;
};
export type Auditoria = {
  id: string;
  documentoId: string;
  firmanteId: string | null;
  evento: EventoFirma;
  ip: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};

// ---------- Bitácora ----------

export async function auditar(
  documentoId: string,
  evento: EventoFirma,
  o: { firmanteId?: string | null; ip?: string | null; userAgent?: string | null; metadata?: unknown } = {},
) {
  await asegurarTablasFirma();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "FirmaAuditoria" ("documentoId", "firmanteId", evento, ip, "userAgent", metadata)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb)`,
    documentoId,
    o.firmanteId ?? null,
    evento,
    o.ip ?? null,
    o.userAgent ?? null,
    o.metadata === undefined ? null : JSON.stringify(o.metadata),
  );
}

export async function auditoriaDe(documentoId: string): Promise<Auditoria[]> {
  await asegurarTablasFirma();
  return prisma.$queryRawUnsafe<Auditoria[]>(
    `SELECT * FROM "FirmaAuditoria" WHERE "documentoId" = $1::uuid ORDER BY "createdAt", id`,
    documentoId,
  );
}

// ---------- Documentos ----------

export async function crearDocumento(d: {
  id: string;
  userId: string;
  titulo: string;
  radicado: string | null;
  paginas: number;
  originalUrl: string;
  originalSha256: string;
}) {
  await asegurarTablasFirma();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "FirmaDocumento" (id, "userId", titulo, radicado, paginas, "originalUrl", "originalSha256")
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)`,
    d.id,
    d.userId,
    d.titulo,
    d.radicado,
    d.paginas,
    d.originalUrl,
    d.originalSha256,
  );
}

/** Marca como vencidos los enviados hace más de DIAS_VIGENCIA sin completar. */
async function vencerViejos() {
  await prisma.$executeRawUnsafe(
    `UPDATE "FirmaDocumento" SET estado = 'EXPIRED'
     WHERE estado IN ('PENDING', 'PARTIALLY_SIGNED') AND "enviadoAt" < now() - ($1 || ' days')::interval`,
    String(DIAS_VIGENCIA),
  );
}

export async function documentoPorId(id: string): Promise<Documento | null> {
  if (!esUuid(id)) return null;
  await asegurarTablasFirma();
  await vencerViejos();
  const [d] = await prisma.$queryRawUnsafe<Documento[]>(`SELECT * FROM "FirmaDocumento" WHERE id = $1::uuid`, id);
  return d ?? null;
}

/** El documento, solo si es de ese abogado. */
export async function documentoDe(userId: string, id: string): Promise<Documento | null> {
  const d = await documentoPorId(id);
  return d && d.userId === userId ? d : null;
}

export type DocumentoLista = Documento & { firmantes: number; firmados: number };
export async function listarDocumentos(
  userId: string,
  f: { estado?: string; q?: string; limite: number; desde: number },
): Promise<{ docs: DocumentoLista[]; total: number; porEstado: Record<string, number> }> {
  await asegurarTablasFirma();
  await vencerViejos();
  const cond: string[] = [`d."userId" = $1`];
  const args: unknown[] = [userId];
  if (f.estado && f.estado in ESTADOS_DOC) {
    args.push(f.estado);
    cond.push(`d.estado = $${args.length}`);
  }
  if (f.q) {
    args.push(`%${f.q}%`);
    cond.push(
      `(d.titulo ILIKE $${args.length} OR d.radicado ILIKE $${args.length} OR EXISTS (
         SELECT 1 FROM "FirmaFirmante" s WHERE s."documentoId" = d.id AND s.nombre ILIKE $${args.length}))`,
    );
  }
  const where = cond.join(" AND ");
  const [t] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n FROM "FirmaDocumento" d WHERE ${where}`,
    ...args,
  );
  const docs = await prisma.$queryRawUnsafe<(Documento & { firmantes: bigint; firmados: bigint })[]>(
    `SELECT d.*,
            (SELECT count(*) FROM "FirmaFirmante" s WHERE s."documentoId" = d.id) AS firmantes,
            (SELECT count(*) FROM "FirmaFirmante" s WHERE s."documentoId" = d.id AND s.estado = 'SIGNED') AS firmados
     FROM "FirmaDocumento" d WHERE ${where}
     ORDER BY d."createdAt" DESC LIMIT ${Number(f.limite)} OFFSET ${Number(f.desde)}`,
    ...args,
  );
  const cuentas = await prisma.$queryRawUnsafe<{ estado: string; n: bigint }[]>(
    `SELECT estado, count(*) AS n FROM "FirmaDocumento" WHERE "userId" = $1 GROUP BY estado`,
    userId,
  );
  return {
    docs: docs.map((d) => ({ ...d, firmantes: Number(d.firmantes), firmados: Number(d.firmados) })),
    total: Number(t?.n ?? 0),
    porEstado: Object.fromEntries(cuentas.map((c) => [c.estado, Number(c.n)])),
  };
}

// ---------- Firmantes ----------

export async function firmantesDe(documentoId: string): Promise<Firmante[]> {
  await asegurarTablasFirma();
  return prisma.$queryRawUnsafe<Firmante[]>(
    `SELECT * FROM "FirmaFirmante" WHERE "documentoId" = $1::uuid ORDER BY orden, nombre`,
    documentoId,
  );
}

export async function firmantePorToken(token: string): Promise<Firmante | null> {
  if (!esToken(token)) return null;
  await asegurarTablasFirma();
  const [s] = await prisma.$queryRawUnsafe<Firmante[]>(`SELECT * FROM "FirmaFirmante" WHERE token = $1`, token);
  return s ?? null;
}

export type FirmanteNuevo = {
  nombre: string;
  tipoDoc: TipoDoc;
  numDoc: string;
  email: string | null;
  telefono: string | null;
  posicion: PosicionFirma;
};

/** Reemplaza los firmantes de un borrador (paso 2 y 3 del asistente). */
export async function guardarFirmantes(documentoId: string, firmantes: FirmanteNuevo[]) {
  await asegurarTablasFirma();
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`DELETE FROM "FirmaFirmante" WHERE "documentoId" = $1::uuid`, documentoId);
    let orden = 1;
    for (const f of firmantes) {
      await tx.$executeRawUnsafe(
        `INSERT INTO "FirmaFirmante" ("documentoId", nombre, "tipoDoc", "numDoc", email, telefono, orden, token, posicion)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
        documentoId,
        f.nombre,
        f.tipoDoc,
        f.numDoc,
        f.email,
        f.telefono,
        orden++,
        nuevoToken(),
        JSON.stringify(f.posicion),
      );
    }
  });
}

/** Guarda la verificación de identidad del firmante (fotos + resultado). */
export async function guardarIdentidad(
  firmanteId: string,
  d: { frente: string; reverso: string; selfie: string | null; resultado: ResultadoIdentidad },
) {
  await prisma.$executeRawUnsafe(
    `UPDATE "FirmaFirmante" SET "cedulaFrenteUrl" = $2, "cedulaReversoUrl" = $3, "selfieUrl" = $4,
            identidad = $5::jsonb, "identidadAt" = now()
     WHERE id = $1::uuid AND estado IN ('PENDING', 'VIEWED')`,
    firmanteId,
    d.frente,
    d.reverso,
    d.selfie,
    JSON.stringify(d.resultado),
  );
}

export async function marcarEnviado(
  documentoId: string,
  otpCorreo: boolean,
  otpWhatsapp: boolean,
  verificacion: NivelVerificacion = "otp",
) {
  await prisma.$executeRawUnsafe(
    `UPDATE "FirmaDocumento" SET estado = 'PENDING', "enviadoAt" = now(), "otpCorreo" = $2, "otpWhatsapp" = $3,
            verificacion = $4
     WHERE id = $1::uuid`,
    documentoId,
    otpCorreo,
    otpWhatsapp,
    verificacion,
  );
}

export async function marcarVisto(firmanteId: string) {
  await prisma.$executeRawUnsafe(
    `UPDATE "FirmaFirmante" SET estado = 'VIEWED' WHERE id = $1::uuid AND estado = 'PENDING'`,
    firmanteId,
  );
}

export async function guardarOtp(firmanteId: string, hash: string) {
  await prisma.$executeRawUnsafe(
    `UPDATE "FirmaFirmante" SET "otpHash" = $2, "otpExpira" = now() + ($3 || ' minutes')::interval, "otpIntentos" = 0
     WHERE id = $1::uuid`,
    firmanteId,
    hash,
    String(OTP_MINUTOS),
  );
}

/** Suma un intento fallido y devuelve cuántos lleva. */
export async function otpFallido(firmanteId: string): Promise<number> {
  const [r] = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `UPDATE "FirmaFirmante" SET "otpIntentos" = "otpIntentos" + 1 WHERE id = $1::uuid RETURNING "otpIntentos" AS n`,
    firmanteId,
  );
  return r?.n ?? 0;
}

export async function otpVerificado(firmanteId: string) {
  await prisma.$executeRawUnsafe(
    `UPDATE "FirmaFirmante" SET "otpVerificadoAt" = now(), "otpHash" = NULL, "otpExpira" = NULL WHERE id = $1::uuid`,
    firmanteId,
  );
}

/**
 * Registra la firma. Solo si sigue pendiente (evita firmar dos veces) y deja
 * el documento como firmado en parte. Devuelve false si ya no se podía firmar.
 */
export async function registrarFirma(firmanteId: string, firmaUrl: string, tipoFirma: string): Promise<boolean> {
  const n = await prisma.$executeRawUnsafe(
    `UPDATE "FirmaFirmante" SET estado = 'SIGNED', "firmaUrl" = $2, "tipoFirma" = $3, "firmadoAt" = now()
     WHERE id = $1::uuid AND estado IN ('PENDING', 'VIEWED')`,
    firmanteId,
    firmaUrl,
    tipoFirma,
  );
  if (n === 0) return false;
  await prisma.$executeRawUnsafe(
    `UPDATE "FirmaDocumento" d SET estado = 'PARTIALLY_SIGNED'
     WHERE d.id = (SELECT "documentoId" FROM "FirmaFirmante" WHERE id = $1::uuid) AND d.estado = 'PENDING'`,
    firmanteId,
  );
  return true;
}

export async function registrarRechazo(firmanteId: string, motivo: string): Promise<boolean> {
  const n = await prisma.$executeRawUnsafe(
    `UPDATE "FirmaFirmante" SET estado = 'REJECTED', motivo = $2 WHERE id = $1::uuid AND estado IN ('PENDING', 'VIEWED')`,
    firmanteId,
    motivo.slice(0, 500),
  );
  if (n === 0) return false;
  await prisma.$executeRawUnsafe(
    `UPDATE "FirmaDocumento" d SET estado = 'REJECTED'
     WHERE d.id = (SELECT "documentoId" FROM "FirmaFirmante" WHERE id = $1::uuid)`,
    firmanteId,
  );
  return true;
}

/**
 * Toma el documento para sellarlo: solo uno gana si dos firmas llegan a la vez.
 * Devuelve true si todos firmaron y este proceso debe generar el PDF sellado.
 */
export async function tomarParaSellar(documentoId: string): Promise<boolean> {
  const n = await prisma.$executeRawUnsafe(
    `UPDATE "FirmaDocumento" d SET sello = '{"estado":"sellando"}'::jsonb
     WHERE d.id = $1::uuid AND d.estado IN ('PENDING', 'PARTIALLY_SIGNED') AND d.sello IS NULL
       AND NOT EXISTS (SELECT 1 FROM "FirmaFirmante" s WHERE s."documentoId" = d.id AND s.estado <> 'SIGNED')
       AND EXISTS (SELECT 1 FROM "FirmaFirmante" s WHERE s."documentoId" = d.id)`,
    documentoId,
  );
  return n > 0;
}

export async function soltarSello(documentoId: string) {
  await prisma.$executeRawUnsafe(
    `UPDATE "FirmaDocumento" SET sello = NULL WHERE id = $1::uuid AND estado <> 'COMPLETED'`,
    documentoId,
  );
}

export async function marcarCompletado(
  documentoId: string,
  firmadoUrl: string,
  firmadoSha256: string,
  sello: Record<string, unknown>,
) {
  await prisma.$executeRawUnsafe(
    `UPDATE "FirmaDocumento" SET estado = 'COMPLETED', "firmadoUrl" = $2, "firmadoSha256" = $3,
            sello = $4::jsonb, "completedAt" = now()
     WHERE id = $1::uuid`,
    documentoId,
    firmadoUrl,
    firmadoSha256,
    JSON.stringify(sello),
  );
}

export async function eliminarBorrador(userId: string, id: string) {
  if (!esUuid(id)) return 0;
  return prisma.$executeRawUnsafe(
    `DELETE FROM "FirmaDocumento" WHERE id = $1::uuid AND "userId" = $2 AND estado = 'DRAFT'`,
    id,
    userId,
  );
}

/** Nombre del abogado que envía (se le muestra al firmante). */
export async function nombreAbogado(userId: string) {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, firstName: true, lastName: true, email: true },
  });
  return [u?.firstName, u?.lastName].filter(Boolean).join(" ") || u?.name || u?.email || "Tu abogado";
}

/** Cédula a medias para pantallas públicas: ****5678. */
export const ocultarDoc = (n: string) => (n.length <= 4 ? "****" : `${"*".repeat(Math.min(n.length - 4, 6))}${n.slice(-4)}`);
