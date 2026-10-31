"use client";

import { useState, useTransition } from "react";
import { revisarEstadosAhoraAction } from "@/app/actions";

/** Root: corre la revisión de estados ya (todos los usuarios en prueba), sin esperar la noche. */
export function RevisarEstadosAhora() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div style={{ marginTop: 8 }}>
      <button
        className="btn small"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await revisarEstadosAhoraAction();
            setMsg(r.ok ?? r.error ?? null);
          })
        }
      >
        {pending ? "Iniciando…" : "Revisar estados ahora"}
      </button>
      {msg && <div className="muted small" style={{ marginTop: 4 }}>{msg}</div>}
    </div>
  );
}
