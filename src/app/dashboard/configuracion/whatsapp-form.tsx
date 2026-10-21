"use client";

import { useActionState } from "react";
import { updateWhatsappAction } from "@/app/actions";

export function WhatsappForm({ current }: { current: string | null }) {
  const [state, formAction, pending] = useActionState(updateWhatsappAction, {});

  return (
    <form action={formAction} style={{ marginTop: 8 }}>
      <label className="small muted" htmlFor="whatsapp">Número de WhatsApp</label>
      <input
        id="whatsapp"
        name="whatsapp"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        required
        defaultValue={current ?? ""}
        placeholder="300 123 4567"
      />
      <div style={{ height: 14 }} />
      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Guardando..." : current ? "Actualizar WhatsApp" : "Guardar WhatsApp"}
      </button>
      {state.error && <div className="error">{state.error}</div>}
      {state.ok && <div className="ok">{state.ok}</div>}
    </form>
  );
}
