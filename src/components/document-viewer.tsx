"use client";

import { MSG_RAMA_DOCUMENTO } from "@/lib/aviso-rama";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icon";

// pdf.js desde CDN: Chrome Android (y la app instalada) no muestra PDFs dentro
// de la página, así que cada hoja se dibuja en un <canvas>.
const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168";

type PdfJs = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (src: { data: ArrayBuffer }) => { promise: Promise<PdfDoc> };
};
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage> };
type PdfPage = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }) => { promise: Promise<void> };
};

let pdfjsPromise: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = import(/* webpackIgnore: true */ `${PDFJS}/pdf.min.mjs`).then(
      (m: PdfJs) => {
        m.GlobalWorkerOptions.workerSrc = `${PDFJS}/pdf.worker.min.mjs`;
        return m;
      },
    );
  }
  return pdfjsPromise;
}

export type ViewerDoc = { id: string; nombre: string; tipo: string | null };

/**
 * Descarga el archivo vía blob + <a download>. Funciona también en la app
 * instalada (PWA), donde abrir el enlace en otra pestaña se queda colgado.
 */
export async function descargarDocumento(doc: ViewerDoc, data?: ArrayBuffer) {
  const buf: ArrayBuffer =
    data ??
    (await fetch(`/api/documento/${doc.id}`).then((r): Promise<ArrayBuffer> => {
      if (!r.ok) throw new Error("No se pudo descargar el documento.");
      return r.arrayBuffer();
    }));
  const ext = (doc.tipo || "pdf").toLowerCase();
  const url = URL.createObjectURL(
    new Blob([buf], { type: ext === "pdf" ? "application/pdf" : "application/octet-stream" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `${doc.nombre.replace(/[^\w.\-]+/g, "_")}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function DocumentViewer({
  doc,
  onClose,
}: {
  doc: ViewerDoc;
  onClose: () => void;
}) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const dataRef = useRef<ArrayBuffer | null>(null);
  const [estado, setEstado] = useState<"cargando" | "listo" | "error" | "noPdf">(
    "cargando",
  );
  const [paginas, setPaginas] = useState(0);
  const [descargando, setDescargando] = useState(false);

  // Bloquea el scroll del fondo y cierra con Escape.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const res = await fetch(`/api/documento/${doc.id}?inline=1`);
        if (!res.ok) throw new Error();
        const buf = await res.arrayBuffer();
        if (cancelado) return;
        dataRef.current = buf;

        // Firma "%PDF": si no es PDF, solo se ofrece la descarga.
        const head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
        if (String.fromCharCode(...head) !== "%PDF") {
          setEstado("noPdf");
          return;
        }

        const pdfjs = await loadPdfJs();
        // pdf.js transfiere el buffer al worker; se le pasa una copia.
        const pdf = await pdfjs.getDocument({ data: buf.slice(0) }).promise;
        if (cancelado) return;
        setPaginas(pdf.numPages);
        setEstado("listo");

        const cont = pagesRef.current;
        if (!cont) return;
        const ancho = cont.clientWidth;
        const dpr = window.devicePixelRatio || 1;
        for (let n = 1; n <= pdf.numPages; n++) {
          if (cancelado) return;
          const page = await pdf.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const escala = ancho / base.width;
          const vp = page.getViewport({ scale: escala * dpr });
          const canvas = document.createElement("canvas");
          canvas.width = vp.width;
          canvas.height = vp.height;
          canvas.style.width = "100%";
          canvas.className = "viewer-page";
          cont.appendChild(canvas);
          const ctx = canvas.getContext("2d");
          if (ctx) await page.render({ canvasContext: ctx, viewport: vp }).promise;
        }
      } catch {
        if (!cancelado) setEstado("error");
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [doc.id]);

  async function descargar() {
    setDescargando(true);
    try {
      await descargarDocumento(doc, dataRef.current ?? undefined);
    } catch {
      alert(MSG_RAMA_DOCUMENTO);
    } finally {
      setDescargando(false);
    }
  }

  return (
    <div className="viewer-overlay" role="dialog" aria-modal="true">
      <div className="viewer-head">
        <button className="btn secondary small" onClick={onClose}>
          <Icon name="close" size={16} /> Cerrar
        </button>
        <div className="viewer-title" title={doc.nombre}>
          {doc.nombre}
          {paginas > 0 && (
            <span className="muted small">
              {" "}
              · {paginas} {paginas === 1 ? "página" : "páginas"}
            </span>
          )}
        </div>
        <button className="btn small" onClick={descargar} disabled={descargando}>
          {descargando ? "Descargando…" : <><Icon name="download" size={16} /> Descargar</>}
        </button>
      </div>
      <div className="viewer-body">
        {estado === "cargando" && (
          <p className="muted small viewer-msg">
            Cargando documento desde la Rama Judicial…
          </p>
        )}
        {estado === "error" && (
          <p className="aviso-rama viewer-msg">ℹ️ {MSG_RAMA_DOCUMENTO}</p>
        )}
        {estado === "noPdf" && (
          <p className="muted small viewer-msg">
            Este archivo no es un PDF y no se puede previsualizar. Usa el botón
            Descargar.
          </p>
        )}
        <div ref={pagesRef} className="viewer-pages" />
      </div>
    </div>
  );
}
