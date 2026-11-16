import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";

/**
 * Firma digital corporativa (.p12) y estampa cronológica (TSA RFC 3161).
 *
 * Es el punto de conexión con la entidad de certificación acreditada por la
 * ONAC (Andes SCD, GSE, etc.). Todo se configura con variables de entorno:
 *
 *   CERT_P12_PATH, CERT_P12_PASSWORD   certificado de firma digital de Estradox
 *   TSA_URL, TSA_USERNAME, TSA_PASSWORD   servidor de estampa cronológica
 *
 * Si no están configuradas, funciona en MODO DESARROLLO: el PDF queda con las
 * firmas, el certificado de auditoría y sus huellas SHA-256 (la trazabilidad
 * propia de Estradox), pero sin firma digital ni estampa de una entidad
 * acreditada. Así el flujo completo se puede probar sin certificado.
 */

export type ResultadoSello = {
  pdf: Uint8Array;
  /** "p12" = firmado digitalmente con el certificado; "desarrollo" = sin certificado. */
  modo: "p12" | "desarrollo";
  /** Sujeto del certificado usado (CN), si hubo firma digital. */
  certificado: string | null;
  /** Estampa cronológica de la entidad (token RFC 3161 en base64), si hubo TSA. */
  tsa: { url: string; token: string; huella: string } | null;
  /** Por qué no se aplicó algo (queda en la bitácora). */
  avisos: string[];
};

export function configSello() {
  return {
    p12: process.env.CERT_P12_PATH?.trim() || null,
    p12Clave: process.env.CERT_P12_PASSWORD ?? "",
    tsaUrl: process.env.TSA_URL?.trim() || null,
    tsaUsuario: process.env.TSA_USERNAME?.trim() || null,
    tsaClave: process.env.TSA_PASSWORD ?? "",
  };
}

/** Qué se va a aplicar con la configuración actual (para pintarlo en el certificado antes de sellar). */
export function planSello(): { modo: "p12" | "desarrollo"; tsa: boolean } {
  const c = configSello();
  return { modo: c.p12 ? "p12" : "desarrollo", tsa: !!c.tsaUrl };
}

/**
 * Aplica la firma digital del .p12 al PDF y pide la estampa cronológica.
 * Sin configuración devuelve el mismo PDF (modo desarrollo).
 */
export async function applyDigitalSignatureAndTSA(pdfBuffer: Uint8Array): Promise<ResultadoSello> {
  const c = configSello();
  const avisos: string[] = [];
  let pdf = pdfBuffer;
  let modo: ResultadoSello["modo"] = "desarrollo";
  let certificado: string | null = null;

  if (c.p12) {
    const r = await firmarConP12(pdf, c.p12, c.p12Clave);
    pdf = r.pdf;
    certificado = r.sujeto;
    modo = "p12";
  } else {
    avisos.push("Sin CERT_P12_PATH: no se aplicó firma digital (modo desarrollo).");
  }

  let tsa: ResultadoSello["tsa"] = null;
  if (c.tsaUrl) {
    // La estampa prueba que este archivo exacto existía en ese instante.
    // Si la entidad no responde, el documento se entrega igual y queda el aviso.
    try {
      const huella = createHash("sha256").update(pdf).digest();
      const token = await pedirEstampa(c.tsaUrl, huella, c.tsaUsuario, c.tsaClave);
      tsa = { url: c.tsaUrl, token: token.toString("base64"), huella: huella.toString("hex") };
    } catch (e) {
      avisos.push(`La estampa cronológica falló: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    avisos.push("Sin TSA_URL: no se pidió estampa cronológica (modo desarrollo).");
  }

  return { pdf, modo, certificado, tsa, avisos };
}

/** Firma PAdES básica (adbe.pkcs7.detached) con el certificado .p12. */
async function firmarConP12(pdf: Uint8Array, ruta: string, clave: string) {
  const [{ default: signpdf }, { pdflibAddPlaceholder }, { P12Signer }, forge] = await Promise.all([
    import("@signpdf/signpdf"),
    import("@signpdf/placeholder-pdf-lib"),
    import("@signpdf/signer-p12"),
    import("node-forge"),
  ]);
  const p12 = await readFile(ruta);
  const sujeto = sujetoDelP12(forge.default ?? forge, p12, clave);
  const doc = await PDFDocument.load(pdf);
  pdflibAddPlaceholder({
    pdfDoc: doc,
    reason: "Sello de integridad Estradox - Firma Electrónica",
    contactInfo: "soporte@estradox.com",
    name: sujeto ?? "Estradox",
    location: "Colombia",
    signatureLength: 16384,
  });
  // La firma necesita el PDF sin "object streams" para ubicar el hueco.
  const conHueco = await doc.save({ useObjectStreams: false });
  const firmado = await signpdf.sign(conHueco, new P12Signer(p12, { passphrase: clave }));
  return { pdf: new Uint8Array(firmado), sujeto };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sujetoDelP12(forge: any, p12: Buffer, clave: string): string | null {
  try {
    const asn1 = forge.asn1.fromDer(p12.toString("binary"));
    const bolsa = forge.pkcs12.pkcs12FromAsn1(asn1, clave);
    const certs = bolsa.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
    return certs[0]?.cert?.subject?.getField("CN")?.value ?? null;
  } catch {
    return null;
  }
}

// ---------- TSA (RFC 3161) ----------

/** Longitud DER. */
function derLen(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let x = n; x > 0; x >>= 8) bytes.unshift(x & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const der = (tag: number, ...partes: Buffer[]) => {
  const cuerpo = Buffer.concat(partes);
  return Buffer.concat([Buffer.from([tag]), derLen(cuerpo.length), cuerpo]);
};

/**
 * TimeStampReq: version 1, messageImprint (SHA-256 + huella), nonce y
 * certReq = TRUE (pide que el token traiga el certificado de la TSA).
 */
export function construirTimeStampReq(huellaSha256: Buffer, nonce = randomBytes(8)): Buffer {
  const OID_SHA256 = Buffer.from([0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]);
  const algoritmo = der(0x30, OID_SHA256, Buffer.from([0x05, 0x00]));
  const imprint = der(0x30, algoritmo, der(0x04, huellaSha256));
  // INTEGER positivo: si el primer bit está encendido se antepone 0x00.
  const n = nonce[0] & 0x80 ? Buffer.concat([Buffer.from([0]), nonce]) : nonce;
  return der(0x30, Buffer.from([0x02, 0x01, 0x01]), imprint, der(0x02, n), Buffer.from([0x01, 0x01, 0xff]));
}

/** Lee el PKIStatus de la TimeStampResp (0 = granted, 1 = grantedWithMods). */
export function estadoTimeStampResp(resp: Buffer): number {
  // SEQUENCE { PKIStatusInfo SEQUENCE { status INTEGER ... } ... }
  let i = 0;
  const saltarCabecera = () => {
    i++; // tag
    const l = resp[i++];
    if (l & 0x80) i += l & 0x7f;
  };
  saltarCabecera(); // TimeStampResp
  saltarCabecera(); // PKIStatusInfo
  if (resp[i] !== 0x02) throw new Error("respuesta de la TSA con formato inesperado");
  const largo = resp[i + 1];
  let v = 0;
  for (let k = 0; k < largo; k++) v = (v << 8) | resp[i + 2 + k];
  return v;
}

async function pedirEstampa(url: string, huella: Buffer, usuario: string | null, clave: string): Promise<Buffer> {
  const headers: Record<string, string> = { "Content-Type": "application/timestamp-query" };
  if (usuario) headers.Authorization = `Basic ${Buffer.from(`${usuario}:${clave}`).toString("base64")}`;
  const r = await fetch(url, {
    method: "POST",
    headers,
    body: new Uint8Array(construirTimeStampReq(huella)),
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`la TSA respondió ${r.status}`);
  const resp = Buffer.from(await r.arrayBuffer());
  const estado = estadoTimeStampResp(resp);
  if (estado !== 0 && estado !== 1) throw new Error(`la TSA rechazó la solicitud (estado ${estado})`);
  return resp;
}
