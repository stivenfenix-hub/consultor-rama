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
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <textarea
          name="radicado"
          required
          rows={2}
          aria-describedby="radicado-ayuda"
          placeholder="Escribe o pega el radicado"
          style={{
            fontFamily: "inherit",
            width: "100%",
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
            color: "var(--text)",
            borderRadius: 8,
            padding: "10px 12px",
            fontSize: 15,
            resize: "vertical",
          }}
        />
        {/* La explicación va fuera del campo: en el celular el placeholder se cortaba. */}
        <div id="radicado-ayuda" className="muted small" style={{ marginTop: -4 }}>
          Radicado de 23 dígitos. Puedes pegar varios, separados por coma, espacio o
          una línea cada uno.
        </div>
        <button
          className="btn"
          type="submit"
          disabled={pending}
          style={{ alignSelf: "flex-start" }}
        >
          {pending ? "Consultando Rama..." : "Agregar"}
        </button>
      </div>
      {pending && (
        <div className="muted small" style={{ marginTop: 8 }}>
          La Rama Judicial suele tardar varios segundos por proceso; con varios
          radicados puede tomar más, espera un momento…
        </div>
      )}
      {state.error && <div className="error">{state.error}</div>}
      {state.ok && <div className="ok">{state.ok}</div>}
    </form>
  );
}
