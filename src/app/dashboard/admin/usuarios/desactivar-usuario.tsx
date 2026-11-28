"use client";

import { useState, useTransition } from "react";
import { desactivarUsuarioAction, reactivarUsuarioAction } from "@/app/actions";

/** Desactivar (conserva todo) o reactivar una cuenta. Alternativa segura a eliminar. */
export function DesactivarUsuario({ id, email, desactivada }: { id: string; email: string; desactivada: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        className="btn secondary small"
        disabled={pending}
        title={
          desactivada
            ? "Vuelve a vigilar sus procesos, a escribirle y a dejarlo entrar"
            : "Deja de vigilar y de escribirle y no puede entrar. Se conservan procesos, pagos, firmas y autorización de datos."
        }
        onClick={() => {
          const ok = confirm(
            desactivada
              ? `¿Reactivar la cuenta de ${email}?\n\nVuelve a vigilar sus procesos, a recibir avisos y a poder entrar.`
              : `¿Desactivar la cuenta de ${email}?\n\nDeja de vigilar sus procesos, no se le escribe nada y no puede entrar. Se conserva todo (procesos, pagos, firmas y autorización de datos) y la puedes reactivar cuando quieras.`,
          );
          if (!ok) return;
          setError(null);
          start(async () => {
            const r = desactivada ? await reactivarUsuarioAction(id) : await desactivarUsuarioAction(id);
            if (r.error) setError(r.error);
          });
        }}
      >
        {pending ? "Guardando…" : desactivada ? "Reactivar" : "Desactivar"}
      </button>
      {error && <div className="error small">{error}</div>}
    </>
  );
}
