"use client";

import { useActionState, useEffect, useRef } from "react";
import { changePasswordAction } from "@/app/actions";

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changePasswordAction, {});
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);

  return (
    <form ref={ref} action={formAction} style={{ marginTop: 8 }}>
      <label className="small muted" htmlFor="current">Contraseña actual</label>
      <input id="current" name="current" type="password" required placeholder="••••••••" />
      <div style={{ height: 10 }} />
      <label className="small muted" htmlFor="password">Nueva contraseña</label>
      <input id="password" name="password" type="password" required autoComplete="new-password" placeholder="Mínimo 8, con letras y números" />
      <div style={{ height: 10 }} />
      <label className="small muted" htmlFor="password2">Repetir nueva contraseña</label>
      <input id="password2" name="password2" type="password" required autoComplete="new-password" placeholder="Escríbela de nuevo" />
      <div style={{ height: 14 }} />
      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Guardando..." : "Actualizar contraseña"}
      </button>
      {state.error && <div className="error">{state.error}</div>}
      {state.ok && <div className="ok">{state.ok}</div>}
    </form>
  );
}
