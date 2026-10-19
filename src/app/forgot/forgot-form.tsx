"use client";

import { useActionState } from "react";
import { forgotAction } from "@/app/actions";

export function ForgotForm() {
  const [state, formAction, pending] = useActionState(forgotAction, {});

  if (state.ok) return <div className="ok" style={{ marginTop: 16 }}>{state.ok}</div>;

  return (
    <form action={formAction} style={{ marginTop: 16 }}>
      <label className="small muted" htmlFor="email">Correo</label>
      <input id="email" name="email" type="email" required placeholder="abogado@ejemplo.com" />
      <div style={{ height: 14 }} />
      <button className="btn" type="submit" disabled={pending} style={{ width: "100%", justifyContent: "center" }}>
        {pending ? "Enviando..." : "Enviar enlace"}
      </button>
      {state.error && <div className="error">{state.error}</div>}
    </form>
  );
}
