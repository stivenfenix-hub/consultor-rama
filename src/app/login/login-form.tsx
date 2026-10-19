"use client";

import { useActionState } from "react";
import Link from "next/link";
import { loginAction, resendVerificationAction } from "@/app/actions";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, {});
  const [resendState, resendAction, resending] = useActionState(
    resendVerificationAction,
    {},
  );

  return (
    <>
      <form action={formAction} style={{ marginTop: 16 }}>
        <label className="small muted" htmlFor="email">
          Correo
        </label>
        <input id="email" name="email" type="email" required placeholder="abogado@ejemplo.com" />
        <div style={{ height: 10 }} />
        <label className="small muted" htmlFor="password">
          Contraseña
        </label>
        <input id="password" name="password" type="password" required placeholder="••••••••" />
        <div style={{ height: 14 }} />
        <button className="btn" type="submit" disabled={pending} style={{ width: "100%", justifyContent: "center" }}>
          {pending ? "Ingresando..." : "Ingresar"}
        </button>
        {state.error && <div className="error">{state.error}</div>}
      </form>

      {state.needsVerify && (
        <form action={resendAction} style={{ marginTop: 8 }}>
          <input type="hidden" name="email" value={state.needsVerify} />
          <button className="btn secondary small" type="submit" disabled={resending}>
            {resending ? "Enviando..." : "Reenviar correo de verificación"}
          </button>
          {resendState.ok && <div className="ok small">{resendState.ok}</div>}
        </form>
      )}

      <div className="row" style={{ marginTop: 16, justifyContent: "space-between" }}>
        <Link href="/forgot" className="small">
          ¿Olvidaste tu contraseña?
        </Link>
        <Link href="/register" className="small">
          Crear cuenta
        </Link>
      </div>
    </>
  );
}
