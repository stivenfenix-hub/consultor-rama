"use client";

import { loadPdfJs } from "@/components/document-viewer";

/**
 * Ubica sola la firma de cada firmante en un espacio en blanco del documento:
 *
 *   1. Busca dónde aparece su nombre o su número de documento (el último que
 *      aparece suele ser el bloque de firmas, al final).
 *   2. Mira la página dibujada (pdf.js) y busca, justo encima de ese nombre,
 *      un recuadro sin tinta: ni letras, ni líneas, ni sellos, ni imágenes.
 *   3. Si no encuentra el nombre, usa el espacio libre más bajo de la última página.
 *
 * Posiciones relativas (0 a 1) desde arriba a la izquierda, como el resto del asistente.
 */

export type Pos = { page: number; x: number; y: number; width: number; height: number };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

type Caja = { x: number; y: number; w: number; h: number }; // relativas
type Pagina = { n: number; tinta: (c: Caja) => number; textos: { s: string; caja: Caja }[] };

const plano = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

const MAX_PAGINAS = 30;
const ESCALA = 1.5;

async function leerPaginas(docId: string): Promise<Pagina[]> {
  const r = await fetch(`/api/firmas/${docId}/pdf?inline=1`, { cache: "no-store" });
  if (!r.ok) throw new Error("No pudimos leer el documento.");
  const lib = await loadPdfJs();
  const pdf: Any = await lib.getDocument({ data: await r.arrayBuffer() }).promise;
  const paginas: Pagina[] = [];
  for (let n = 1; n <= Math.min(pdf.numPages, MAX_PAGINAS); n++) {
    const page = await pdf.getPage(n);
    const vp = page.getViewport({ scale: ESCALA });
    const W = Math.ceil(vp.width);
    const H = Math.ceil(vp.height);
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) continue;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const px = ctx.getImageData(0, 0, W, H).data;

    // Tabla acumulada de "tinta" (píxeles no blancos) para medir cualquier recuadro al instante.
    const acum = new Uint32Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) {
      let fila = 0;
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const luz = px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11;
        if (luz < 215) fila++;
        acum[(y + 1) * (W + 1) + (x + 1)] = acum[y * (W + 1) + (x + 1)] + fila;
      }
    }
    const tinta = (c: Caja) => {
      const x0 = Math.max(0, Math.floor(c.x * W));
      const y0 = Math.max(0, Math.floor(c.y * H));
      const x1 = Math.min(W, Math.ceil((c.x + c.w) * W));
      const y1 = Math.min(H, Math.ceil((c.y + c.h) * H));
      if (x1 <= x0 || y1 <= y0) return 1;
      const s = acum[y1 * (W + 1) + x1] - acum[y0 * (W + 1) + x1] - acum[y1 * (W + 1) + x0] + acum[y0 * (W + 1) + x0];
      return s / ((x1 - x0) * (y1 - y0));
    };

    const tc = await page.getTextContent();
    const textos: Pagina["textos"] = [];
    for (const it of tc.items as { str?: string; transform: number[]; width: number; height: number }[]) {
      if (!it.str?.trim()) continue;
      const [x, yBase] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
      const alto = Math.abs(it.height || it.transform[3]) * ESCALA;
      const ancho = it.width * ESCALA;
      textos.push({ s: plano(it.str), caja: { x: x / W, y: (yBase - alto) / H, w: ancho / W, h: (alto * 1.2) / H } });
    }
    paginas.push({ n, tinta, textos });
  }
  return paginas;
}

/** Último lugar donde aparece la persona (nombre con al menos 2 palabras, o su número). */
function buscarAncla(paginas: Pagina[], nombre: string, numDoc: string): { n: number; caja: Caja } | null {
  const palabras = plano(nombre)
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !/^(del|las|los)$/.test(w));
  const num = numDoc.replace(/\D/g, "");
  let ancla: { n: number; caja: Caja; peso: number } | null = null;
  for (const p of paginas) {
    for (const t of p.textos) {
      const coinciden = palabras.filter((w) => t.s.includes(w)).length;
      const porNombre = palabras.length >= 2 && coinciden >= Math.min(2, palabras.length) && t.s.length < 90;
      const porNumero = num.length >= 5 && t.s.replace(/\D/g, "") === num;
      if (!porNombre && !porNumero) continue;
      // El nombre corto de una línea de firma pesa más que una mención dentro de un párrafo.
      const peso = porNombre ? 2 : 1;
      // Si en la misma línea van dos nombres ("MARÍA …      CARLOS …"), se toma el tramo de este.
      const clave = porNombre ? palabras.find((w) => t.s.includes(w))! : num;
      const idx = porNombre ? t.s.indexOf(clave) : 0;
      const caja = idx > 0 ? { ...t.caja, x: t.caja.x + (t.caja.w * idx) / t.s.length, w: t.caja.w * (1 - idx / t.s.length) } : t.caja;
      const despues = !ancla || p.n > ancla.n || (p.n === ancla.n && t.caja.y >= ancla.caja.y - 0.001);
      if (despues || (ancla && p.n === ancla.n && Math.abs(t.caja.y - ancla.caja.y) < 0.03 && peso > ancla.peso)) {
        ancla = { n: p.n, caja, peso };
      }
    }
  }
  // Si lo que quedó es el número (debajo del nombre), sube al nombre de esa misma firma.
  if (ancla && ancla.peso === 1) {
    const p = paginas.find((x) => x.n === ancla!.n)!;
    const arriba = p.textos.find(
      (t) =>
        t.caja.y < ancla!.caja.y &&
        ancla!.caja.y - t.caja.y < 0.04 &&
        Math.abs(t.caja.x - ancla!.caja.x) < 0.1 &&
        palabras.some((w) => t.s.includes(w)),
    );
    if (arriba) ancla = { ...ancla, caja: arriba.caja };
  }
  return ancla ? { n: ancla.n, caja: ancla.caja } : null;
}

const MARGEN = 0.004; // aire alrededor del recuadro
const LIMPIO = 0.002; // máximo de tinta tolerada (polvo del escáner)

const choca = (a: Caja, b: Caja) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function libre(p: Pagina, c: Caja, ocupadas: Caja[]) {
  if (c.x < 0.02 || c.y < 0.02 || c.x + c.w > 0.98 || c.y + c.h > 0.98) return false;
  if (ocupadas.some((o) => choca(o, c))) return false;
  return p.tinta({ x: c.x - MARGEN, y: c.y - MARGEN, w: c.w + 2 * MARGEN, h: c.h + 2 * MARGEN }) <= LIMPIO;
}

/** Recuadro libre justo encima del nombre (subiendo poco a poco y corriéndose a los lados). */
function encimaDe(p: Pagina, ancla: Caja, w: number, h: number, ocupadas: Caja[]): Caja | null {
  for (const alto of [h, h * 0.8, h * 0.65]) {
    for (let sube = 0.004; sube <= 0.16; sube += 0.004) {
      const y = ancla.y - sube - alto;
      for (const dx of [0, -0.02, 0.02, -0.05, 0.05, -0.1, 0.1]) {
        const c = { x: ancla.x + dx, y, w, h: alto };
        if (libre(p, c, ocupadas)) return c;
      }
    }
  }
  return null;
}

/** Si encima no cabe: el primer hueco libre debajo del bloque del nombre (cédula, cargo…). */
function debajoDe(p: Pagina, ancla: Caja, w: number, h: number, ocupadas: Caja[]): Caja | null {
  for (const alto of [h, h * 0.8]) {
    for (let baja = 0.004; baja <= 0.2; baja += 0.004) {
      const y = ancla.y + ancla.h + baja;
      for (const dx of [0, -0.02, 0.02, -0.05, 0.05]) {
        const c = { x: ancla.x + dx, y, w, h: alto };
        if (libre(p, c, ocupadas)) return c;
      }
    }
  }
  return null;
}

/** El espacio libre más bajo de la página (para quien no aparece por nombre). */
function espacioLibre(p: Pagina, w: number, h: number, ocupadas: Caja[]): Caja | null {
  for (let y = 0.92 - h; y >= 0.05; y -= 0.005) {
    for (const x of [0.1, 0.55, 0.3]) {
      const c = { x, y, w, h };
      if (libre(p, c, ocupadas)) return c;
    }
  }
  return null;
}

/**
 * Posición sugerida para cada firmante (null si no se encontró un lugar limpio:
 * en ese caso el asistente deja la posición por defecto).
 */
export async function ubicarFirmas(
  docId: string,
  firmantes: { nombre: string; numDoc: string }[],
  tam: { width: number; height: number },
): Promise<(Pos | null)[]> {
  const paginas = await leerPaginas(docId);
  if (!paginas.length) return firmantes.map(() => null);
  const ocupadas = new Map<number, Caja[]>();
  const res: (Pos | null)[] = [];
  const sinAncla: number[] = [];
  firmantes.forEach((f, i) => {
    const ancla = buscarAncla(paginas, f.nombre, f.numDoc);
    if (!ancla) {
      res[i] = null;
      sinAncla.push(i);
      return;
    }
    const p = paginas.find((x) => x.n === ancla.n)!;
    const occ = ocupadas.get(p.n) ?? [];
    const c =
      encimaDe(p, ancla.caja, tam.width, tam.height, occ) ?? debajoDe(p, ancla.caja, tam.width, tam.height, occ);
    if (c) {
      occ.push(c);
      ocupadas.set(p.n, occ);
      res[i] = { page: p.n, x: c.x, y: c.y, width: c.w, height: c.h };
    } else {
      res[i] = null;
      sinAncla.push(i);
    }
  });
  // Los que no aparecen: hueco libre en la última página.
  const ultima = paginas[paginas.length - 1];
  for (const i of sinAncla) {
    const occ = ocupadas.get(ultima.n) ?? [];
    const c = espacioLibre(ultima, tam.width, tam.height, occ);
    if (c) {
      occ.push(c);
      ocupadas.set(ultima.n, occ);
      res[i] = { page: ultima.n, x: c.x, y: c.y, width: c.w, height: c.h };
    }
  }
  return res;
}
