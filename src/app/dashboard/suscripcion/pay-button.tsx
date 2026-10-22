"use client";

import { useActionState } from "react";
import { pagarSuscripcionAction } from "@/app/actions";

export function PayButton({ label }: { label: string }) {
  const [state, formAction, pending] = useActionState(pagarSuscripcionAction, {});
  return (
    <form action={formAction} style={{ marginTop: 12 }}>
      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Abriendo pago seguro…" : label}
      </button>
      {state.error && <div className="error">{state.error}</div>}
    </form>
  );
}
