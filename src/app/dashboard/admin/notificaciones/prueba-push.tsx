"use client";

import { useState, useTransition } from "react";
import { pruebaPushAction } from "@/app/actions";

export function PruebaPush() {
  const [pending, start] = useTransition();
  const [r, setR] = useState<{ ok?: string; error?: string } | null>(null);
  return (
    <div className="card">
      <h2>Probar notificaciones</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        Te envía una notificación solo a ti, a todos tus dispositivos suscritos, para confirmar que te llegan.
      </p>
      <button
        className="btn"
        disabled={pending}
        onClick={() => start(async () => setR(await pruebaPushAction()))}
      >
        {pending ? "Enviando…" : "Enviarme una prueba"}
      </button>
      {r?.ok && <div className="ok small" style={{ marginTop: 8 }}>{r.ok}</div>}
      {r?.error && <div className="error small" style={{ marginTop: 8 }}>{r.error}</div>}
    </div>
  );
}
