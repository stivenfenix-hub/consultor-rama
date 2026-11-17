"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { loadPdfJs, type PdfDoc } from "./document-viewer";

/**
 * Dibuja todas las páginas de un PDF, una debajo de otra, en <canvas> (pdf.js),
 * para que se vea igual en computador y celular. Cada página es un contenedor
 * `position: relative`: `sobre` permite pintar encima (p. ej. los recuadros de
 * firma) usando porcentajes del tamaño de la página.
 */
export function PdfPaginas({
  src,
  sobre,
  alCargar,
  alClic,
  ampliable = false,
}: {
  src: string;
  /** Muestra los botones de zoom y permite pellizcar para acercar (lectura en el celular). */
  ampliable?: boolean;
  /** Contenido encima de cada página (1 = primera). */
  sobre?: (pagina: number) => ReactNode;
  alCargar?: (paginas: number) => void;
  /** Clic en una página: posición relativa (0-1) desde arriba a la izquierda. */
  alClic?: (pagina: number, x: number, y: number) => void;
}) {
  const [pdf, setPdf] = useState<PdfDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const avisar = useRef(alCargar);
  avisar.current = alCargar;

  useEffect(() => {
    let vivo = true;
    setPdf(null);
    setError(null);
    (async () => {
      try {
        const r = await fetch(src, { cache: "no-store" });
        if (!r.ok) {
          const j = await r.json().catch(() => null);
          throw new Error(typeof j?.error === "string" ? j.error : "No pudimos cargar el documento.");
        }
        const data = await r.arrayBuffer();
        const lib = await loadPdfJs();
        const doc = await lib.getDocument({ data }).promise;
        if (!vivo) return;
        setPdf(doc);
        avisar.current?.(doc.numPages);
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : "No pudimos cargar el documento.");
      }
    })();
    return () => {
      vivo = false;
    };
  }, [src]);

  if (error) return <div className="error small">{error}</div>;
  if (!pdf) return <div className="pdf-cargando muted small">Cargando documento…</div>;
  const paginas = (zoom: number) =>
    Array.from({ length: pdf.numPages }, (_, i) => (
      <Pagina key={i} pdf={pdf} n={i + 1} sobre={sobre} alClic={alClic} total={pdf.numPages} zoom={zoom} />
    ));
  if (!ampliable) return <div className="pdf-paginas">{paginas(1)}</div>;
  return <ConZoom>{paginas}</ConZoom>;
}

const NIVELES = [1, 1.5, 2, 2.5, 3];
const ZOOM_MAX = 3;

/**
 * Zoom para leer en el celular: botones − / + y pellizco con dos dedos (la app
 * bloquea el zoom del navegador). Las páginas se vuelven a dibujar al nuevo
 * tamaño para que la letra se vea nítida, y se puede mover de lado a lado.
 */
function ConZoom({ children }: { children: (zoom: number) => ReactNode }) {
  const [zoom, setZoom] = useState(1);
  const [dibujo, setDibujo] = useState(1); // zoom con el que se dibujan los canvas (tras el gesto)
  const caja = useRef<HTMLDivElement>(null);

  // Cambia el zoom manteniendo el centro de lo que se está leyendo.
  const aplicar = (z: number) => {
    const nuevo = Math.min(Math.max(z, 1), ZOOM_MAX);
    const el = caja.current;
    if (el) {
      const centro = (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth;
      requestAnimationFrame(() => {
        el.scrollLeft = centro * el.scrollWidth - el.clientWidth / 2;
      });
    }
    setZoom(nuevo);
  };

  useEffect(() => {
    const t = setTimeout(() => setDibujo(zoom), 250);
    return () => clearTimeout(t);
  }, [zoom]);

  // Pellizco con dos dedos.
  useEffect(() => {
    const el = caja.current;
    if (!el) return;
    let inicio: { d: number; z: number } | null = null;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const empieza = (e: TouchEvent) => {
      if (e.touches.length === 2) inicio = { d: dist(e.touches), z: zoomRef.current };
    };
    const mueve = (e: TouchEvent) => {
      if (!inicio || e.touches.length !== 2) return;
      e.preventDefault();
      aplicarRef.current((inicio.z * dist(e.touches)) / inicio.d);
    };
    const termina = (e: TouchEvent) => {
      if (e.touches.length < 2) inicio = null;
    };
    el.addEventListener("touchstart", empieza, { passive: true });
    el.addEventListener("touchmove", mueve, { passive: false });
    el.addEventListener("touchend", termina);
    return () => {
      el.removeEventListener("touchstart", empieza);
      el.removeEventListener("touchmove", mueve);
      el.removeEventListener("touchend", termina);
    };
  }, []);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const aplicarRef = useRef(aplicar);
  aplicarRef.current = aplicar;

  const siguiente = (dir: 1 | -1) => {
    const lista = dir > 0 ? NIVELES : [...NIVELES].reverse();
    return lista.find((n) => (dir > 0 ? n > zoom + 0.01 : n < zoom - 0.01)) ?? zoom;
  };

  return (
    <div className="pdf-zoom-marco">
      <div className="pdf-zoom-barra" role="toolbar" aria-label="Tamaño del documento">
        <button type="button" onClick={() => aplicar(siguiente(-1))} disabled={zoom <= 1} aria-label="Alejar">
          −
        </button>
        <button type="button" className="pdf-zoom-valor" onClick={() => aplicar(zoom > 1 ? 1 : 2)}>
          🔍 {Math.round(zoom * 100)} %
        </button>
        <button type="button" onClick={() => aplicar(siguiente(1))} disabled={zoom >= ZOOM_MAX} aria-label="Acercar">
          +
        </button>
      </div>
      <div className="pdf-zoom" ref={caja}>
        <div className="pdf-paginas" style={{ width: `${zoom * 100}%` }}>
          {children(dibujo)}
        </div>
      </div>
    </div>
  );
}

function Pagina({
  pdf,
  n,
  total,
  sobre,
  alClic,
  zoom = 1,
}: {
  pdf: PdfDoc;
  n: number;
  total: number;
  zoom?: number;
  sobre?: (pagina: number) => ReactNode;
  alClic?: (pagina: number, x: number, y: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [proporcion, setProporcion] = useState(792 / 612);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      if (!vivo || !canvas.current) return;
      setProporcion(base.height / base.width);
      // Nitidez: se dibuja al ancho real en pantalla por la densidad del dispositivo (tope para no gastar memoria).
      const anchoCss = canvas.current.parentElement?.clientWidth || 800;
      const escala = Math.min((anchoCss * Math.min(window.devicePixelRatio || 1, 2)) / base.width, 3);
      const vp = page.getViewport({ scale: escala });
      canvas.current.width = Math.round(vp.width);
      canvas.current.height = Math.round(vp.height);
      const ctx = canvas.current.getContext("2d");
      if (ctx) await page.render({ canvasContext: ctx, viewport: vp }).promise;
    })().catch(() => {});
    return () => {
      vivo = false;
    };
  }, [pdf, n, zoom]);

  return (
    <div className="pdf-pagina-caja">
      <div
        className="pdf-pagina"
        data-pagina={n}
        style={{ aspectRatio: `1 / ${proporcion}`, cursor: alClic ? "crosshair" : undefined }}
        onClick={
          alClic
            ? (e) => {
                const r = e.currentTarget.getBoundingClientRect();
                alClic(n, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
              }
            : undefined
        }
      >
        <canvas ref={canvas} />
        {sobre?.(n)}
      </div>
      <div className="pdf-pagina-num muted small">
        Página {n} de {total}
      </div>
    </div>
  );
}
