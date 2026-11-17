"use client";

import { loadPdfJs } from "@/components/document-viewer";

/**
 * Lee el documento subido y encuentra a las personas que aparecen con su
 * documento de identidad, para proponerlas como firmantes.
 *
 *   1. Texto del PDF con pdf.js (PDF normales y los Word convertidos).
 *   2. Si casi no hay texto (PDF escaneado), OCR con Tesseract (español).
 *
 * Todo corre en el navegador del abogado: el documento no sale a otro servicio.
 */

export { buscarPersonas, type Persona } from "./personas";

const TESSERACT = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

let tesseractPromesa: Promise<Any> | null = null;
function cargarTesseract(): Promise<Any> {
  tesseractPromesa ??= new Promise((ok, mal) => {
    const w = window as Any;
    if (w.Tesseract) return ok(w.Tesseract);
    const s = document.createElement("script");
    s.src = TESSERACT;
    s.onload = () => ok(w.Tesseract);
    s.onerror = () => {
      tesseractPromesa = null;
      mal(new Error("No se pudo cargar el lector de texto."));
    };
    document.head.appendChild(s);
  });
  return tesseractPromesa;
}

const MAX_PAGINAS_TEXTO = 30;
const MAX_PAGINAS_OCR = 6;

/** Texto completo del documento (con OCR si es escaneado). */
export async function leerTextoDocumento(docId: string): Promise<string> {
  const r = await fetch(`/api/firmas/${docId}/pdf?inline=1`, { cache: "no-store" });
  if (!r.ok) throw new Error("No pudimos leer el documento.");
  const lib = await loadPdfJs();
  const pdf: Any = await lib.getDocument({ data: await r.arrayBuffer() }).promise;

  const paginas: string[] = [];
  for (let n = 1; n <= Math.min(pdf.numPages, MAX_PAGINAS_TEXTO); n++) {
    const page = await pdf.getPage(n);
    const tc = await page.getTextContent();
    let linea = "";
    const partes: string[] = [];
    for (const it of tc.items as { str?: string; hasEOL?: boolean }[]) {
      linea += it.str ?? "";
      if (it.hasEOL) {
        partes.push(linea);
        linea = "";
      } else if (it.str && !it.str.endsWith(" ")) {
        linea += " ";
      }
    }
    if (linea) partes.push(linea);
    paginas.push(partes.join("\n"));
  }
  const texto = paginas.join("\n");
  if (texto.replace(/\s/g, "").length > 80 * Math.min(pdf.numPages, 3)) return texto;

  // Escaneado: OCR de las primeras páginas.
  const T = await cargarTesseract();
  const worker = await T.createWorker("spa");
  try {
    const ocr: string[] = [];
    for (let n = 1; n <= Math.min(pdf.numPages, MAX_PAGINAS_OCR); n++) {
      const page = await pdf.getPage(n);
      const vp = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = vp.width;
      canvas.height = vp.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const { data } = await worker.recognize(canvas);
      ocr.push(String(data.text ?? ""));
    }
    return ocr.join("\n");
  } finally {
    await worker.terminate().catch(() => {});
  }
}
