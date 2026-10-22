"use client";

import { useActionState } from "react";
import { savePlanAction } from "@/app/actions";

export function PlanForm({ precio, diasPrueba }: { precio: number; diasPrueba: number }) {
  const [state, formAction, pending] = useActionState(savePlanAction, {});
  return (
    <form action={formAction}>
      <div className="row wrap" style={{ gap: 12 }}>
        <div style={{ flex: 1, minWidth: 150 }}>
          <label className="small muted" htmlFor="precio">Precio mensual (COP)</label>
          <input id="precio" name="precio" type="number" min={1000} step={100} required defaultValue={precio} />
        </div>
        <div style={{ flex: 1, minWidth: 150 }}>
          <label className="small muted" htmlFor="diasPrueba">Días de prueba gratis</label>
          <input id="diasPrueba" name="diasPrueba" type="number" min={0} max={365} required defaultValue={diasPrueba} />
        </div>
      </div>
      <div className="muted small" style={{ marginTop: 6 }}>
        El cambio de días de prueba aplica a quienes empiecen su prueba de ahora en adelante.
      </div>
      <button className="btn" type="submit" disabled={pending} style={{ marginTop: 12 }}>
        {pending ? "Guardando..." : "Guardar plan"}
      </button>
      {state.error && <div className="error">{state.error}</div>}
      {state.ok && <div className="ok">{state.ok}</div>}
    </form>
  );
}
