"use client";

import { useState, useTransition } from "react";
import { sinLimiteManualAction } from "@/app/actions";

export function SinLimite({ userId, valor }: { userId: string; valor: boolean }) {
  const [activo, setActivo] = useState(valor);
  const [pending, start] = useTransition();

  return (
    <label className="row" style={{ gap: 8, cursor: "pointer" }}>
      <input
        type="checkbox"
        checked={activo}
        disabled={pending}
        style={{ width: "auto" }}
        onChange={(e) => {
          const v = e.target.checked;
          setActivo(v);
          start(async () => {
            const r = await sinLimiteManualAction(userId, v);
            if (r.error) setActivo(!v);
          });
        }}
      />
      <span>
        Sin límite de actualizaciones manuales{" "}
        <span className="muted small">(puede actualizar cada proceso y "todos" cuando quiera)</span>
      </span>
    </label>
  );
}
