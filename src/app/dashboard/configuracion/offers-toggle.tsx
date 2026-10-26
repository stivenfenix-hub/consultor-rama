"use client";

import { useState, useTransition } from "react";
import { updateOfertasAction } from "@/app/actions";

/** Permiso opcional de ofertas y boletines: se activa o retira cuando quiera. */
export function OffersToggle({ initial }: { initial: boolean }) {
  const [activo, setActivo] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div>
      <label className="check small">
        <input
          type="checkbox"
          checked={activo}
          disabled={pending}
          onChange={(e) => {
            const valor = e.target.checked;
            setActivo(valor);
            start(async () => {
              const r = await updateOfertasAction(valor);
              setMsg(r.ok ?? r.error ?? null);
            });
          }}
        />
        <span>Quiero recibir ofertas, novedades y boletines de Estradox.</span>
      </label>
      <p className="muted small" style={{ margin: "8px 0 0" }}>
        Los avisos de tus procesos y de tu suscripción te seguirán llegando igual.
      </p>
      {msg && <div className="ok">{msg}</div>}
    </div>
  );
}
