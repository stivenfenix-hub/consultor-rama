"use client";

import { useActionState } from "react";
import { loginAction } from "@/app/actions";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, {});

  return (
    <form action={formAction} style={{ marginTop: 16 }}>
      <label className="small muted" htmlFor="name">
        Nombre (opcional)
      </label>
      <input id="name" name="name" type="text" placeholder="Dra. Ana Perez" />
      <div style={{ height: 10 }} />
      <label className="small muted" htmlFor="email">
        Correo
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        placeholder="abogado@ejemplo.com"
      />
      <div style={{ height: 14 }} />
      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Ingresando..." : "Ingresar"}
      </button>
      {state.error && <div className="error">{state.error}</div>}
    </form>
  );
}
