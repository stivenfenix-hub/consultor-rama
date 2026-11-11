"use client";

import { useState } from "react";
import { DocButtons, DocumentViewer, type ViewerDoc } from "./document-viewer";

const PAGINA = "Página de la publicación";

type Doc = { nombre: string; url: string };

/**
 * "Ver PDF" y "Descargar" de cada documento de un estado electrónico (la
 * planilla y los autos del radicado). Si el juzgado escribió el estado en la
 * página (sin archivo), solo se enlaza la publicación.
 */
export function EstadoBotones({ hallazgoId, documentos }: { hallazgoId: number; documentos: Doc[] }) {
  const [visor, setVisor] = useState<ViewerDoc | null>(null);
  if (documentos.length === 0) return null;
  const varios = documentos.length > 1;
  return (
    <>
      <div style={{ display: "grid", gap: 8 }}>
        {documentos.map((d, i) => {
          if (!d.nombre || d.nombre === PAGINA) {
            return (
              <a key={i} className="btn secondary small" href={d.url} target="_blank" rel="noopener noreferrer">
                Ver estado
              </a>
            );
          }
          const ext =
            /\.(pdf|docx?|xlsx?|rtf)\b/i.exec(`${d.nombre} ${decodeURIComponentSeguro(d.url)}`)?.[1]?.toLowerCase() ??
            "pdf";
          const nombre = d.nombre.replace(/\.[a-z0-9]{2,5}$/i, "");
          const doc: ViewerDoc = {
            id: `estado-${hallazgoId}-${i}`,
            nombre,
            tipo: ext,
            ruta: `/api/estado-archivo/${hallazgoId}?doc=${i}`,
          };
          return (
            <div key={i} className="row wrap" style={{ gap: 8, alignItems: "center" }}>
              {varios && (
                <span className="small" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                  📄 {nombre}
                </span>
              )}
              <DocButtons doc={doc} onVer={setVisor} etiqueta={ext === "pdf" ? "Ver PDF" : "Ver"} />
            </div>
          );
        })}
      </div>
      {visor && <DocumentViewer doc={visor} onClose={() => setVisor(null)} />}
    </>
  );
}

function decodeURIComponentSeguro(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
