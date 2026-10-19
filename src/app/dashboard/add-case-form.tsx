"use client";

import { useActionState, useEffect, useRef } from "react";
import { agregarProcesoAction } from "@/app/actions";

export function AddCaseForm() {
  const [state, formAction, pending] = useActionState(agregarProcesoAction, {});
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);

  return (
    <form ref={ref} action={formAction}>
      <div className="row wrap">
        <div style={{ flex: 1, minWidth: 260 }}>
          <input
            name="radicado"
            type="text"
            inputMode="numeric"
            placeholder="11001020300020200000100 (23 digitos)"
            required
          />
        </div>
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Consultando Rama..." : "Agregar"}
        </button>
      </div>
      {pending && (
        <div className="muted small" style={{ marginTop: 8 }}>
          La Rama Judicial suele tardar varios segundos, espera un momento…
        </div>
      )}
      {state.error && <div className="error">{state.error}</div>}
      {state.ok && <div className="ok">{state.ok}</div>}
    </form>
  );
}
