"use client";

import { useState, useTransition } from "react";
import { limpiarLogosBdAction } from "@/app/actions";

export function LimpiarLogos() {
  const [pending, start] = useTransition();
  const [r, setR] = useState<{ ok?: string; error?: string } | null>(null);
  return (
    <div style={{ marginTop: 12 }}>
      <button
        className="btn secondary small"
        disabled={pending}
        onClick={() => {
          if (!confirm("¿Borrar de Supabase las copias viejas de los logos e íconos? Ya están publicadas como archivos en Hostinger.")) return;
          start(async () => setR(await limpiarLogosBdAction()));
        }}
      >
        {pending ? "Borrando…" : "Borrar logos viejos de Supabase"}
      </button>
      {r?.ok && <div className="ok small" style={{ marginTop: 6 }}>{r.ok}</div>}
      {r?.error && <div className="error small" style={{ marginTop: 6 }}>{r.error}</div>}
    </div>
  );
}
