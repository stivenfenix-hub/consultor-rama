"use client";

import { useActionState } from "react";
import { deleteAccountAction } from "@/app/actions";

export function DeleteAccountForm() {
  const [state, formAction, pending] = useActionState(deleteAccountAction, {});

  return (
    <form
      action={formAction}
      style={{ marginTop: 8 }}
      onSubmit={(e) => {
        if (!confirm("¿Eliminar tu cuenta? Se borran tus procesos y datos, y no se puede deshacer.")) {
          e.preventDefault();
        }
      }}
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        Se eliminan tu cuenta, tus procesos, actuaciones y documentos guardados. No se puede deshacer.
      </p>
      <label className="small muted" htmlFor="delete-password">Confirma con tu contraseña</label>
      <input id="delete-password" name="password" type="password" required placeholder="••••••••" />
      <div style={{ height: 14 }} />
      <button className="btn danger" type="submit" disabled={pending}>
        {pending ? "Eliminando..." : "Eliminar mi cuenta"}
      </button>
      {state.error && <div className="error">{state.error}</div>}
    </form>
  );
}
