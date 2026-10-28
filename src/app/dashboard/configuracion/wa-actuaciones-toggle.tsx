"use client";

import { useState, useTransition } from "react";
import { waActuacionesAction } from "@/app/actions";

/** Actuaciones nuevas por WhatsApp: solo si el abogado lo activa. */
export function WaActuacionesToggle({ initial, whatsapp }: { initial: boolean; whatsapp: string | null }) {
  const [activo, setActivo] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div style={{ marginTop: 14 }}>
      <label className="check small">
        <input
          type="checkbox"
          checked={activo}
          disabled={pending || !whatsapp}
          onChange={(e) => {
            const valor = e.target.checked;
            setActivo(valor);
            start(async () => {
              const r = await waActuacionesAction(valor);
              setMsg(r.ok ?? r.error ?? null);
            });
          }}
        />
        <span>
          Recibir las <b>actuaciones nuevas</b> de mis procesos por WhatsApp
          {whatsapp ? ` (${whatsapp})` : ""}.
        </span>
      </label>
      {!whatsapp && (
        <p className="muted small" style={{ margin: "6px 0 0" }}>
          Primero registra tu número de WhatsApp arriba.
        </p>
      )}
      {msg && <div className="ok">{msg}</div>}
    </div>
  );
}
