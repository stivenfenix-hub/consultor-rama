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

/** Avance de la lectura: qué está haciendo y cuánto lleva (0 a 100). */
export type Avance = { etapa: string; pct: number };

/** Texto completo del documento (con OCR si es escaneado). */
export async function leerTextoDocumento(docId: string, avance: (a: Avance) => void = () => {}): Promise<string> {
  avance({ etapa: "Abriendo el documento…", pct: 5 });
  const r = await fetch(`/api/firmas/${docId}/pdf?inline=1`, { cache: "no-store" });
  if (!r.ok) throw new Error("No pudimos leer el documento.");
  const lib = await loadPdfJs();
  const pdf: Any = await lib.getDocument({ data: await r.arrayBuffer() }).promise;

  const paginas: string[] = [];
  const totalTexto = Math.min(pdf.numPages, MAX_PAGINAS_TEXTO);
  for (let n = 1; n <= totalTexto; n++) {
    avance({ etapa: `Leyendo la página ${n} de ${totalTexto}…`, pct: 10 + Math.round((n / totalTexto) * 60) });
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
  if (texto.replace(/\s/g, "").length > 80 * Math.min(pdf.numPages, 3)) {
    avance({ etapa: "Buscando a los firmantes…", pct: 90 });
    return texto;
  }

  // Escaneado: OCR de las primeras páginas (más lento: el avance es por página).
  avance({ etapa: "Es un documento escaneado: preparando el lector de texto…", pct: 8 });
  const T = await cargarTesseract();
  const totalOcr = Math.min(pdf.numPages, MAX_PAGINAS_OCR);
  let actual = 1;
  const worker = await T.createWorker("spa", 1, {
    logger: (m: { status?: string; progress?: number }) => {
      if (m.status === "recognizing text" && typeof m.progress === "number") {
        avance({
          etapa: `Leyendo la página escaneada ${actual} de ${totalOcr}…`,
          pct: 15 + Math.round(((actual - 1 + m.progress) / totalOcr) * 75),
        });
      }
    },
  });
  try {
    const ocr: string[] = [];
    for (let n = 1; n <= totalOcr; n++) {
      actual = n;
      avance({ etapa: `Leyendo la página escaneada ${n} de ${totalOcr}…`, pct: 15 + Math.round(((n - 1) / totalOcr) * 75) });
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
    avance({ etapa: "Buscando a los firmantes…", pct: 95 });
    return ocr.join("\n");
  } finally {
    await worker.terminate().catch(() => {});
  }
}
