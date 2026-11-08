"use client";

import { useState } from "react";
import { DocButtons, DocumentViewer, type ViewerDoc } from "./document-viewer";

const PAGINA = "Página de la publicación";

/**
 * "Ver PDF" y "Descargar" del archivo de un estado electrónico. Si el juzgado
 * escribió el estado en la página (sin archivo), solo se enlaza la publicación.
 */
export function EstadoBotones({
  hallazgoId,
  archivo,
  url,
}: {
  hallazgoId: number;
  archivo: string | null;
  url: string | null;
}) {
  const [visor, setVisor] = useState<ViewerDoc | null>(null);
  if (!url) return null;
  if (!archivo || archivo === PAGINA) {
    return (
      <a className="btn secondary small" href={url} target="_blank" rel="noopener noreferrer">
        Ver estado
      </a>
    );
  }
  const ext = /\.(pdf|docx?|xlsx?|rtf)\b/i.exec(`${archivo} ${decodeURIComponentSeguro(url)}`)?.[1]?.toLowerCase() ?? "pdf";
  const doc: ViewerDoc = {
    id: `estado-${hallazgoId}`,
    nombre: archivo.replace(/\.[a-z0-9]{2,5}$/i, ""),
    tipo: ext,
    ruta: `/api/estado-archivo/${hallazgoId}`,
  };
  return (
    <>
      <DocButtons doc={doc} onVer={setVisor} etiqueta={ext === "pdf" ? "Ver PDF" : "Ver"} />
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
