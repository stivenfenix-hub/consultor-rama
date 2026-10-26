"use client";

import { useActionState } from "react";
import { completarRegistroAction } from "@/app/actions";

export function CompleteForm() {
  const [state, formAction, pending] = useActionState(completarRegistroAction, {});
  return (
    <form action={formAction} style={{ marginTop: 16 }}>
      <label className="small muted" htmlFor="whatsapp">WhatsApp</label>
      <input
        id="whatsapp"
        name="whatsapp"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        required
        autoFocus
        placeholder="300 123 4567"
        className={state.error ? "input-error" : undefined}
      />
      <div style={{ height: 14 }} />
      <button className="btn" type="submit" disabled={pending} style={{ width: "100%", justifyContent: "center" }}>
        {pending ? "Guardando..." : "Entrar a Estradox"}
      </button>
      {state.error && <div className="error">{state.error}</div>}
    </form>
  );
}
