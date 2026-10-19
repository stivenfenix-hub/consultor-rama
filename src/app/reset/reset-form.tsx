"use client";

import { useActionState } from "react";
import Link from "next/link";
import { resetAction } from "@/app/actions";

export function ResetForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(resetAction, {});

  if (state.ok) {
    return (
      <div style={{ marginTop: 16 }}>
        <div className="ok">{state.ok}</div>
        <p className="muted small" style={{ marginTop: 12 }}>
          <Link href="/login">Ir a iniciar sesión →</Link>
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} style={{ marginTop: 16 }}>
      <input type="hidden" name="token" value={token} />
      <label className="small muted" htmlFor="password">Nueva contraseña</label>
      <input id="password" name="password" type="password" required placeholder="Mínimo 8, con letras y números" />
      <div style={{ height: 14 }} />
      <button className="btn" type="submit" disabled={pending} style={{ width: "100%", justifyContent: "center" }}>
        {pending ? "Guardando..." : "Cambiar contraseña"}
      </button>
      {state.error && <div className="error">{state.error}</div>}
    </form>
  );
}
