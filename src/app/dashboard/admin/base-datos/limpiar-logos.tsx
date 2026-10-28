"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { limpiarLogosBdAction } from "@/app/actions";

/**
 * Borra las copias viejas de los logos en Supabase. Confirma en la misma
 * pantalla (sin confirm() del navegador) y nunca falla en silencio: si la
 * página quedó de una versión anterior, pide recargar.
 */
export function LimpiarLogos({ kb }: { kb: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirmar, setConfirmar] = useState(false);
  const [r, setR] = useState<{ ok?: string; error?: string } | null>(null);

  if (kb === 0 && !r) {
    return <p className="ok small" style={{ marginTop: 10 }}>✅ Supabase ya no guarda logos ni íconos.</p>;
  }

  const borrar = () =>
    start(async () => {
      try {
        setR(await limpiarLogosBdAction());
        router.refresh();
      } catch {
        setR({ error: "No se pudo borrar. Recarga la página e inténtalo de nuevo." });
      }
      setConfirmar(false);
    });

  return (
    <div style={{ marginTop: 12 }}>
      {kb > 0 && (
        <p className="small muted" style={{ margin: "0 0 8px" }}>
          Logos viejos guardados en Supabase: <b>{kb} KB</b> (ya no se usan).
        </p>
      )}
      {!confirmar ? (
        <button className="btn secondary small" disabled={pending} onClick={() => setConfirmar(true)}>
          Borrar logos viejos de Supabase
        </button>
      ) : (
        <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
          <span className="small">¿Seguro? Ya están publicados como archivos en Hostinger.</span>
          <button className="btn danger small" disabled={pending} onClick={borrar}>
            {pending ? "Borrando…" : "Sí, borrar"}
          </button>
          <button className="btn secondary small" disabled={pending} onClick={() => setConfirmar(false)}>
            Cancelar
          </button>
        </div>
      )}
      {r?.ok && <div className="ok small" style={{ marginTop: 6 }}>{r.ok}</div>}
      {r?.error && <div className="error small" style={{ marginTop: 6 }}>{r.error}</div>}
    </div>
  );
}
