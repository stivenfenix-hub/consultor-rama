"use client";

import { useActionState, useEffect, useRef } from "react";
import { agregarProcesosAUsuarioAction } from "@/app/actions";

/** Root: agregar radicados a la cuenta de este usuario. */
export function AgregarRadicados({ userId, nombre, max }: { userId: string; nombre: string; max: number }) {
  const [state, action, pending] = useActionState(agregarProcesosAUsuarioAction, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={action}>
      <input type="hidden" name="userId" value={userId} />
      <textarea
        name="radicado"
        rows={3}
        required
        placeholder={`Pega los radicados de ${nombre} (uno por línea, o separados por coma o espacio)`}
      />
      <div className="muted small" style={{ marginTop: 4 }}>
        Radicados de 23 dígitos, máximo {max} por vez. Se cargan en su cuenta como si los agregara él: ve el avance
        en Procesos y le llega la notificación al terminar.
      </div>
      <button className="btn" type="submit" disabled={pending} style={{ marginTop: 10 }}>
        {pending ? "Enviando…" : "Agregar a su cuenta"}
      </button>
      {state.ok && <div className="ok small">{state.ok}</div>}
      {state.error && <div className="error small">{state.error}</div>}
    </form>
  );
}
