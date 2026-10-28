"use client";

import { useState, useTransition } from "react";
import { borrarEnvioPromoAction } from "@/app/actions";

export function BorrarEnvio({ clave, titulo }: { clave: string; titulo: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        className="btn danger small"
        disabled={pending}
        onClick={() => {
          if (!confirm(`¿Borrar "${titulo}"? Deja de verse en la campana de todos los usuarios.`)) return;
          start(async () => {
            const r = await borrarEnvioPromoAction(clave);
            setError(r.error ?? null);
          });
        }}
      >
        {pending ? "Borrando…" : "Borrar"}
      </button>
      {error && <div className="error small">{error}</div>}
    </>
  );
}
