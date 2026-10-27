"use client";

import { useState, useTransition } from "react";
import { eliminarUsuarioAction } from "@/app/actions";

export function EliminarUsuario({ id, email }: { id: string; email: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        className="btn danger small"
        disabled={pending}
        onClick={() => {
          const ok = confirm(
            `¿Eliminar a ${email}?\n\nSe borran su cuenta, sus procesos y todo su historial. No se puede deshacer.`,
          );
          if (!ok) return;
          setError(null);
          start(async () => {
            const r = await eliminarUsuarioAction(id);
            if (r.error) setError(r.error);
          });
        }}
      >
        {pending ? "Eliminando…" : "Eliminar"}
      </button>
      {error && <div className="error small">{error}</div>}
    </>
  );
}
