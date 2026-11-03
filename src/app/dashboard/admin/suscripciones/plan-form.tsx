"use client";

import { useActionState } from "react";
import { savePlanAction } from "@/app/actions";

type Paquete = { meses: number; precio: number };

export function PlanForm({
  paquetes,
  diasPrueba,
  procesosIncluidos,
  precioAdicional,
}: {
  paquetes: Paquete[];
  diasPrueba: number;
  procesosIncluidos: number;
  precioAdicional: number;
}) {
  const [state, formAction, pending] = useActionState(savePlanAction, {});
  return (
    <form action={formAction}>
      <div className="row wrap" style={{ gap: 12 }}>
        {paquetes.map((p) => (
          <div key={p.meses} style={{ flex: 1, minWidth: 130 }}>
            <label className="small muted" htmlFor={`p${p.meses}`}>
              {p.meses === 1 ? "1 mes" : `${p.meses} meses`} (COP)
            </label>
            <input
              id={`p${p.meses}`}
              name={`p${p.meses}`}
              type="number"
              min={1000}
              step={100}
              required
              defaultValue={p.precio}
            />
          </div>
        ))}
      </div>
      <div style={{ height: 10 }} />
      <div style={{ maxWidth: 200 }}>
        <label className="small muted" htmlFor="diasPrueba">Días de prueba gratis</label>
        <input id="diasPrueba" name="diasPrueba" type="number" min={0} max={365} required defaultValue={diasPrueba} />
      </div>
      <div className="row wrap" style={{ gap: 12, marginTop: 10 }}>
        <div style={{ maxWidth: 200 }}>
          <label className="small muted" htmlFor="procesosIncluidos">Procesos incluidos en el plan</label>
          <input id="procesosIncluidos" name="procesosIncluidos" type="number" min={1} max={100000} required defaultValue={procesosIncluidos} />
        </div>
        <div style={{ maxWidth: 220 }}>
          <label className="small muted" htmlFor="precioAdicional">Proceso adicional (COP por mes)</label>
          <input id="precioAdicional" name="precioAdicional" type="number" min={0} step={1} required defaultValue={precioAdicional} />
        </div>
      </div>
      <div className="muted small" style={{ marginTop: 6 }}>
        El límite de procesos aplica solo a quienes se registraron desde el 3 de noviembre de 2026; los
        anteriores siguen ilimitados. Los adicionales se suman al valor de cada paquete × sus meses.
      </div>
      <div className="muted small" style={{ marginTop: 6 }}>
        El ahorro y el valor mensual equivalente de cada paquete se calculan solos frente al
        precio de 1 mes. El cambio de días de prueba aplica a quienes empiecen su prueba de
        ahora en adelante.
      </div>
      <button className="btn" type="submit" disabled={pending} style={{ marginTop: 12 }}>
        {pending ? "Guardando..." : "Guardar precios"}
      </button>
      {state.error && <div className="error">{state.error}</div>}
      {state.ok && <div className="ok">{state.ok}</div>}
    </form>
  );
}
