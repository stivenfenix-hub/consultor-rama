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
}: {
  src: string;
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
  return (
    <div className="pdf-paginas">
      {Array.from({ length: pdf.numPages }, (_, i) => (
        <Pagina key={i} pdf={pdf} n={i + 1} sobre={sobre} alClic={alClic} total={pdf.numPages} />
      ))}
    </div>
  );
}

function Pagina({
  pdf,
  n,
  total,
  sobre,
  alClic,
}: {
  pdf: PdfDoc;
  n: number;
  total: number;
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
  }, [pdf, n]);

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
