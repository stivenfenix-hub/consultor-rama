"use client";

import { useActionState, useRef, useEffect } from "react";
import { enviarPromoAction } from "@/app/actions";

export function PromoForm() {
  const [state, formAction, pending] = useActionState(enviarPromoAction, {});
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);

  return (
    <form ref={ref} action={formAction}>
      <label className="small muted" htmlFor="title">
        Título
      </label>
      <input id="title" name="title" type="text" required maxLength={80} placeholder="¡Nueva función en Estradox!" />

      <div style={{ height: 10 }} />
      <label className="small muted" htmlFor="body">
        Mensaje
      </label>
      <textarea
        id="body"
        name="body"
        required
        maxLength={300}
        rows={3}
        placeholder="Cuéntales la novedad o promoción…"
        style={{
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

      <div style={{ height: 10 }} />
      <label className="small muted" htmlFor="url">
        Enlace al tocar (opcional)
      </label>
      <input id="url" name="url" type="url" placeholder="https://… (por defecto abre el panel)" />

      <div style={{ height: 14 }} />
      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Enviando…" : "📣 Enviar a todos"}
      </button>
      {state.error && <div className="error">{state.error}</div>}
      {state.ok && <div className="ok">{state.ok}</div>}
    </form>
  );
}
