"use client";

import { useActionState, useEffect, useRef } from "react";
import { agregarProcesoAction } from "@/app/actions";

export function AddCaseForm({ max }: { max: number }) {
  const [state, formAction, pending] = useActionState(agregarProcesoAction, {});
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    // Si alguno falló se deja el texto para que pueda corregirlo o reintentar.
    if (state.ok && !state.error) ref.current?.reset();
  }, [state]);

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
          <div style={{ marginTop: 4 }}>
            📋 <b>Máximo {max} procesos por vez.</b> Si tienes más, agrégalos en varias tandas.
          </div>
        </div>
        <button
          className="btn"
          type="submit"
          disabled={pending}
          style={{ alignSelf: "flex-start" }}
        >
          {pending ? "Enviando…" : "Agregar"}
        </button>
      </div>
      {state.error && <div className="error">{state.error}</div>}
      {state.ok && <div className="ok">{state.ok}</div>}
    </form>
  );
}
