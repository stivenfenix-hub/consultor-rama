import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import QRCode from "qrcode";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fechaHoraCo, limpiar, partir } from "./texto";

/**
 * Sellado del documento: estampa cada firma en su sitio y anexa al final el
 * "Certificado de Auditoría y Evidencia Digital - Estradox".
 * Es código puro (recibe datos y devuelve bytes): no toca la base ni el disco.
 */

export const sha256Hex = (b: Uint8Array | Buffer) => createHash("sha256").update(b).digest("hex");

export type FirmaParaSellar = {
  nombre: string;
  tipoDoc: string;
  numDoc: string;
  email: string | null;
  telefono: string | null;
  /** PNG de la firma (dibujada o tipográfica). */
  imagen: Uint8Array;
  tipoFirma: string | null;
  posicion: { page: number; x: number; y: number; width: number; height: number };
  firmadoAt: Date;
  otpVerificadoAt: Date | null;
  ip: string | null;
  /** Resumen de la verificación de identidad (cédula / rostro), si el documento la pidió. */
  identidad?: string | null;
  /** Foto del firmante en blanco y negro (PNG 3:4), si hizo verificación con rostro. */
  foto?: Uint8Array | null;
};

export type EventoCertificado = {
  fecha: Date;
  evento: string;
  quien: string;
  ip: string | null;
};

export type DatosCertificado = {
  id: string;
  titulo: string;
  radicado: string | null;
  abogado: string;
  creado: Date;
  originalSha256: string;
  urlVerificar: string;
  firmas: FirmaParaSellar[];
  eventos: EventoCertificado[];
  /** Texto del recuadro de sello (modo de firma digital y estampa de tiempo). */
  selloTexto: string[];
};

const MORADO = rgb(0.42, 0.17, 0.96);
const TINTA = rgb(0.09, 0.08, 0.2);
const GRIS = rgb(0.4, 0.4, 0.48);
const LINEA = rgb(0.85, 0.84, 0.92);
const FONDO = rgb(0.96, 0.95, 0.99);

/** Logo de Estradox (letra clara, para el encabezado oscuro del certificado). */
let logoBytes: Promise<Uint8Array | null> | null = null;
function logoPlataforma() {
  logoBytes ??= readFile(path.join(process.cwd(), "public", "marca", "logo.png")).catch(() => null);
  return logoBytes;
}

/**
 * Marca de agua de seguridad encima de la firma (como en los billetes): ondas
 * finas tipo guilloche, microtexto "FIRMADO ELECTRÓNICAMENTE · ESTRADOX" con el
 * código del documento y un sello redondo. Es tenue, así que la firma se sigue
 * viendo, pero no se puede recortar la firma "limpia" para pegarla en otro lado.
 */
function marcaSeguridad(pagina: PDFPage, font: PDFFont, negrita: PDFFont, c: { x: number; y: number; w: number; h: number }, codigo: string) {
  const { x, y, w, h } = c;
  // 1) Ondas guilloche (dos familias cruzadas).
  const ondas = Math.max(3, Math.round(h / 7));
  for (let k = 0; k < ondas; k++) {
    for (const fase of [0, Math.PI]) {
      const base = (h / (ondas + 1)) * (k + 1);
      const amp = Math.min(3.2, h / (ondas * 2.2));
      const pasos = Math.max(24, Math.round(w / 3));
      let d = "";
      for (let i = 0; i <= pasos; i++) {
        const px = (w * i) / pasos;
        const py = base + amp * Math.sin((px / w) * Math.PI * 6 + fase + k * 0.9);
        d += `${i ? "L" : "M"}${px.toFixed(2)} ${(-py).toFixed(2)} `;
      }
      pagina.drawSvgPath(d, { x, y, borderColor: MORADO, borderWidth: 0.35, borderOpacity: fase ? 0.16 : 0.22 });
    }
  }
  // 2) Microtexto repetido (renglones dentro del recuadro).
  const micro = limpiar(`FIRMADO ELECTRÓNICAMENTE · ESTRADOX · ${codigo} · `);
  const tam = 3.1;
  const ancho = font.widthOfTextAtSize(micro, tam);
  let fila = 0;
  for (let yy = y + 2; yy < y + h - 3; yy += 7, fila++) {
    let linea = "";
    const desfase = fila % 2 ? micro.slice(Math.floor(micro.length / 2)) : "";
    while (font.widthOfTextAtSize(desfase + linea + micro, tam) < w) linea += micro;
    const resto = desfase + linea;
    let txt = resto;
    // Completa hasta el borde sin pasarse.
    for (const ch of micro) {
      if (font.widthOfTextAtSize(txt + ch, tam) > w - 1) break;
      txt += ch;
    }
    if (ancho > 0) pagina.drawText(txt, { x: x + 0.5, y: yy, size: tam, font, color: MORADO, opacity: 0.2 });
  }
  // 3) Sello redondo en la esquina superior derecha.
  const r = Math.min(13, h * 0.32, w * 0.12);
  if (r >= 6) {
    const cx = x + w - r - 2;
    const cy = y + h - r - 2;
    pagina.drawCircle({ x: cx, y: cy, size: r, borderColor: MORADO, borderWidth: 0.9, borderOpacity: 0.55, color: rgb(1, 1, 1), opacity: 0.25 });
    pagina.drawCircle({ x: cx, y: cy, size: r - 2.2, borderColor: MORADO, borderWidth: 0.4, borderOpacity: 0.45 });
    // Chulo.
    pagina.drawSvgPath(`M${-r * 0.42} 0 L${-r * 0.12} ${r * 0.32} L${r * 0.45} ${-r * 0.35}`, {
      x: cx,
      y: cy,
      borderColor: MORADO,
      borderWidth: 1.3,
      borderOpacity: 0.7,
    });
    const s = "ESTRADOX";
    const ts = Math.min(3.4, (r * 1.5) / Math.max(negrita.widthOfTextAtSize(s, 1), 1));
    pagina.drawText(s, { x: cx - negrita.widthOfTextAtSize(s, ts) / 2, y: cy - r * 0.72, size: ts, font: negrita, color: MORADO, opacity: 0.7 });
  }
}

/** Estampa las firmas sobre el PDF original y devuelve el documento (aún sin certificado). */
export async function estamparFirmas(original: Uint8Array, firmas: FirmaParaSellar[], codigo = ""): Promise<PDFDocument> {
  const doc = await PDFDocument.load(original, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  const paginas = doc.getPages();
  for (const f of firmas) {
    const pagina = paginas[Math.min(Math.max(f.posicion.page, 1), paginas.length) - 1];
    const { width: W, height: H } = pagina.getSize();
    // Recuadro elegido por el abogado (coordenadas relativas, origen arriba-izquierda).
    const cajaX = f.posicion.x * W;
    const cajaW = f.posicion.width * W;
    const cajaH = f.posicion.height * H;
    const cajaY = H - f.posicion.y * H - cajaH;
    // La imagen se ajusta dentro del recuadro sin deformarse, dejando abajo la leyenda.
    const png = await doc.embedPng(f.imagen);
    const leyenda = 15;
    const escala = Math.min(cajaW / png.width, Math.max(cajaH - leyenda, 10) / png.height);
    const w = png.width * escala;
    const h = png.height * escala;
    pagina.drawImage(png, { x: cajaX + (cajaW - w) / 2, y: cajaY + leyenda + (cajaH - leyenda - h) / 2, width: w, height: h });
    // Encima de la firma (no debajo): así no se puede separar una de la otra.
    marcaSeguridad(pagina, font, negrita, { x: cajaX, y: cajaY + leyenda - 1, w: cajaW, h: cajaH - leyenda + 1 }, codigo);
    const t1 = limpiar(`Firmado electrónicamente: ${f.nombre}`);
    const t2 = limpiar(`${f.tipoDoc} ${f.numDoc} · ${fechaHoraCo(f.firmadoAt)} (Colombia)`);
    const tam = Math.min(6.5, (cajaW / Math.max(font.widthOfTextAtSize(t1, 1), font.widthOfTextAtSize(t2, 1))) * 0.98);
    pagina.drawText(t1, { x: cajaX, y: cajaY + 7.5, size: tam, font, color: MORADO });
    pagina.drawText(t2, { x: cajaX, y: cajaY + 0.5, size: tam, font, color: GRIS });
  }
  return doc;
}

/** Anexa el certificado (una o más páginas carta) al final del documento. */
export async function anexarCertificado(doc: PDFDocument, d: DatosCertificado, hashFirmado: string) {
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const logoPng = await logoPlataforma();
  const logo = logoPng ? await doc.embedPng(logoPng).catch(() => null) : null;
  const W = 612;
  const H = 792;
  const M = 44;
  const util = W - M * 2;
  let pagina!: PDFPage;
  let y = 0;
  let hoja = 0;

  const cabecera = () => {
    pagina = doc.addPage([W, H]);
    hoja++;
    pagina.drawRectangle({ x: 0, y: H - 70, width: W, height: 70, color: TINTA });
    pagina.drawRectangle({ x: 0, y: H - 73, width: W, height: 3, color: MORADO });
    if (logo) {
      // Logo de la plataforma (el mismo del menú), alto fijo.
      const alto = 22;
      pagina.drawImage(logo, { x: M, y: H - 40, width: (logo.width / logo.height) * alto, height: alto });
    } else {
      pagina.drawText("ESTRADOX", { x: M, y: H - 34, size: 17, font: negrita, color: rgb(1, 1, 1) });
    }
    pagina.drawText("Firma Electrónica", { x: M, y: H - 50, size: 9, font: normal, color: rgb(0.8, 0.78, 0.95) });
    const t = limpiar("Certificado de Auditoría y Evidencia Digital");
    pagina.drawText(t, { x: W - M - negrita.widthOfTextAtSize(t, 12.5), y: H - 36, size: 12.5, font: negrita, color: rgb(1, 1, 1) });
    const s = hoja === 1 ? "Estradox" : limpiar(`Estradox · continuación (hoja ${hoja})`);
    pagina.drawText(s, { x: W - M - normal.widthOfTextAtSize(s, 9), y: H - 51, size: 9, font: normal, color: rgb(0.8, 0.78, 0.95) });
    y = H - 96;
  };
  const cabe = (alto: number) => {
    if (y - alto < 60) cabecera();
  };
  const titulo = (t: string) => {
    cabe(40);
    y -= 6;
    pagina.drawText(limpiar(t).toUpperCase(), { x: M, y, size: 8.5, font: negrita, color: MORADO });
    pagina.drawLine({ start: { x: M, y: y - 5 }, end: { x: W - M, y: y - 5 }, thickness: 0.7, color: LINEA });
    y -= 20;
  };
  const dato = (k: string, v: string, f: PDFFont = normal, tam = 9, x = M, ancho = util) => {
    const lineas = partir(v, f, tam, ancho - 108);
    cabe(lineas.length * 12 + 2);
    pagina.drawText(limpiar(k), { x, y, size: 8.5, font: negrita, color: GRIS });
    for (const l of lineas) {
      pagina.drawText(l, { x: x + 108, y, size: tam, font: f, color: TINTA });
      y -= 12;
    }
    y -= 2;
  };

  cabecera();

  // --- Identificación + QR ---
  const qr = await doc.embedPng(await QRCode.toBuffer(d.urlVerificar, { margin: 1, width: 300, errorCorrectionLevel: "M" }));
  const QR = 96;
  const yQr = y + 6;
  pagina.drawImage(qr, { x: W - M - QR, y: yQr - QR, width: QR, height: QR });
  const tq = limpiar("Escanee para verificar");
  pagina.drawText(tq, { x: W - M - QR + (QR - normal.widthOfTextAtSize(tq, 7)) / 2, y: yQr - QR - 9, size: 7, font: normal, color: GRIS });
  const izq = util - QR - 16;
  titulo("Documento");
  dato("ID único", d.id, mono, 8.5, M, izq);
  dato("Título", d.titulo, normal, 9, M, izq);
  if (d.radicado) dato("Radicado", d.radicado, mono, 8.5, M, izq);
  dato("Enviado por", d.abogado, normal, 9, M, izq);
  dato("Creado", `${fechaHoraCo(d.creado)} (hora de Colombia)`, normal, 9, M, izq);
  dato("Verificación", d.urlVerificar, normal, 8, M, izq);
  y = Math.min(y, yQr - QR - 18);

  // --- Huellas ---
  titulo("Integridad (huellas SHA-256)");
  dato("Original", d.originalSha256, mono, 8);
  dato("Con firmas", hashFirmado, mono, 8);
  for (const l of partir(
    "\"Original\" es la huella del PDF tal como lo subió el abogado. \"Con firmas\" es la huella del documento con las firmas estampadas, antes de anexar este certificado. La huella del archivo final completo (con este certificado y el sello) se consulta en la página de verificación: si el archivo cambia en un solo byte, la huella ya no coincide.",
    normal,
    7.5,
    util,
  )) {
    cabe(10);
    pagina.drawText(l, { x: M, y, size: 7.5, font: normal, color: GRIS });
    y -= 9.5;
  }
  y -= 4;

  // --- Firmantes ---
  titulo(`Firmantes (${d.firmas.length})`);
  for (const [i, f] of d.firmas.entries()) {
    // Con verificación de identidad, el resumen va en renglones extra (en morado).
    const ident = f.identidad ? partir(f.identidad, normal, 8, util - 120 - 34).slice(0, 3) : [];
    // Con foto, la columna derecha lleva la foto (3:4) encima de la firma, como en las notarías.
    const foto = f.foto ? await doc.embedPng(f.foto).catch(() => null) : null;
    const FW = 66;
    const FH = 88;
    const ALTO = Math.max(74 + ident.length * 11, foto ? FH + 54 + 34 : 0);
    cabe(ALTO + 8);
    pagina.drawRectangle({ x: M, y: y - ALTO + 10, width: util, height: ALTO, color: FONDO, borderColor: LINEA, borderWidth: 0.7 });
    const png = await doc.embedPng(f.imagen);
    const cw = 120;
    const ch = 54;
    if (foto) {
      const fx = W - M - cw - 10 + (cw - FW) / 2;
      const fy = y - ALTO + 20 + ch + 12;
      pagina.drawRectangle({ x: fx - 2, y: fy - 2, width: FW + 4, height: FH + 4, color: rgb(1, 1, 1), borderColor: LINEA, borderWidth: 0.5 });
      pagina.drawImage(foto, { x: fx, y: fy, width: FW, height: FH });
      const lf = "Foto de verificación";
      pagina.drawText(lf, { x: fx + FW / 2 - normal.widthOfTextAtSize(lf, 6) / 2, y: fy - 9, size: 6, font: normal, color: GRIS });
    }
    const e = Math.min(cw / png.width, ch / png.height);
    pagina.drawRectangle({ x: W - M - cw - 10, y: y - ALTO + 20, width: cw, height: ch, color: rgb(1, 1, 1), borderColor: LINEA, borderWidth: 0.5 });
    pagina.drawImage(png, {
      x: W - M - cw - 10 + (cw - png.width * e) / 2,
      y: y - ALTO + 20 + (ch - png.height * e) / 2,
      width: png.width * e,
      height: png.height * e,
    });
    const x = M + 10;
    let yy = y - 4;
    const ancho = util - cw - 34;
    pagina.drawText(partir(`${i + 1}. ${f.nombre}`, negrita, 10, ancho)[0] ?? "", { x, y: yy, size: 10, font: negrita, color: TINTA });
    yy -= 13;
    const filas = [
      `${f.tipoDoc} ${f.numDoc}`,
      [f.email, f.telefono ? `WhatsApp ${f.telefono}` : null].filter(Boolean).join(" · ") || "-",
      `Identidad verificada con código (OTP): ${fechaHoraCo(f.otpVerificadoAt)}`,
      `Firmó: ${fechaHoraCo(f.firmadoAt)} · IP ${f.ip ?? "-"} · ${f.tipoFirma === "tipografica" ? "firma tipográfica" : "firma dibujada"}`,
    ];
    for (const t of filas) {
      pagina.drawText(partir(t, normal, 8, ancho)[0] ?? "", { x, y: yy, size: 8, font: normal, color: GRIS });
      yy -= 11;
    }
    for (const t of ident) {
      pagina.drawText(t, { x, y: yy, size: 8, font: normal, color: MORADO });
      yy -= 11;
    }
    y -= ALTO + 6;
  }

  // --- Trazabilidad ---
  titulo("Trazabilidad (hora de Colombia, UTC-5)");
  const cols = [M, M + 122, M + 300, M + 430];
  const fila = (c: string[], f: PDFFont, color = TINTA) => {
    const partes = [
      partir(c[0], f, 7.5, 116),
      partir(c[1], f, 7.5, 172),
      partir(c[2], f, 7.5, 124),
      partir(c[3], f, 7.5, W - M - cols[3]),
    ];
    const n = Math.max(...partes.map((p) => p.length));
    cabe(n * 9.5 + 5);
    partes.forEach((p, i) => p.forEach((l, j) => pagina.drawText(l, { x: cols[i], y: y - j * 9.5, size: 7.5, font: f, color })));
    y -= n * 9.5 + 3;
    pagina.drawLine({ start: { x: M, y: y + 1 }, end: { x: W - M, y: y + 1 }, thickness: 0.4, color: LINEA });
    y -= 5;
  };
  fila(["Fecha y hora", "Evento", "Quién", "IP"], negrita, GRIS);
  for (const e of d.eventos) fila([fechaHoraCo(e.fecha), e.evento, e.quien, e.ip ?? "-"], normal);

  // --- Sello + base legal ---
  const ALTO_SELLO = 26 + d.selloTexto.length * 11;
  cabe(ALTO_SELLO + 70);
  y -= 6;
  pagina.drawRectangle({ x: M, y: y - ALTO_SELLO + 8, width: util, height: ALTO_SELLO, borderColor: MORADO, borderWidth: 1, color: rgb(1, 1, 1) });
  pagina.drawText(limpiar("SELLO DE INTEGRIDAD ESTRADOX"), { x: M + 10, y: y - 6, size: 8.5, font: negrita, color: MORADO });
  let ys = y - 19;
  for (const l of d.selloTexto) {
    pagina.drawText(partir(l, normal, 8, util - 20)[0] ?? "", { x: M + 10, y: ys, size: 8, font: normal, color: TINTA });
    ys -= 11;
  }
  y -= ALTO_SELLO + 8;
  for (const l of partir(
    "Base legal: Ley 527 de 1999 (mensajes de datos y equivalencia funcional de la firma), Decreto 2364 de 2012 (firma electrónica: confiable y apropiada cuando los datos de creación corresponden exclusivamente al firmante y se puede detectar cualquier alteración posterior) y artículo 5 de la Ley 2213 de 2022 (poderes conferidos mediante mensaje de datos). Cada firmante confirmó su identidad con un código de un solo uso enviado a su correo o WhatsApp y aceptó expresamente firmar por este medio.",
    normal,
    7.5,
    util,
  )) {
    cabe(10);
    pagina.drawText(l, { x: M, y, size: 7.5, font: normal, color: GRIS });
    y -= 9.5;
  }
}
