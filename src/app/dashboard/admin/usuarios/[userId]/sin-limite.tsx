"use client";

import { useState, useTransition } from "react";
import { estadosActivoAction, sinLimiteManualAction, socioAction } from "@/app/actions";

const OPCIONES = {
  socio: {
    accion: socioAction,
    texto: "Socio de Estradox",
    ayuda: "(no se le cobra el servicio y entra al Portal de socios)",
  },
  sinLimite: {
    accion: sinLimiteManualAction,
    texto: "Sin límite de actualizaciones manuales",
    ayuda: '(puede actualizar cada proceso y "todos" cuando quiera)',
  },
  estados: {
    accion: estadosActivoAction,
    texto: "Vigilar estados electrónicos (en prueba)",
    ayuda: "(busca sus radicados en los estados que publica cada juzgado, aunque no estén en la Consulta Nacional)",
  },
};

export function Interruptor({ userId, valor, tipo }: { userId: string; valor: boolean; tipo: keyof typeof OPCIONES }) {
  const [activo, setActivo] = useState(valor);
  const [pending, start] = useTransition();
  const o = OPCIONES[tipo];

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
            const r = await o.accion(userId, v);
            if (r.error) setActivo(!v);
          });
        }}
      />
      <span>
        {o.texto} <span className="muted small">{o.ayuda}</span>
      </span>
    </label>
  );
}
