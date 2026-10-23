"use client";

import { useActionState, useState } from "react";
import { pagarSuscripcionAction } from "@/app/actions";

type Paquete = { meses: number; precio: number };

const pesos = (n: number) => `$${n.toLocaleString("es-CO")}`;
const porcentaje = (n: number) => `${Math.round(n * 10) / 10}`.replace(".", ",");

// Insignias de los paquetes destacados.
const BADGE: Record<number, string> = { 6: "⚡ MÁS POPULAR", 12: "🔥 MEJOR VALOR" };
const DESTACADO = 6;

export function PricingCards({
  paquetes,
  accion,
}: {
  paquetes: Paquete[];
  /** "Pagar" (renovar/suscribirse) o "Reactivar" cuando el acceso venció. */
  accion: string;
}) {
  const [state, formAction, pending] = useActionState(pagarSuscripcionAction, {});
  const [elegido, setElegido] = useState<number | null>(null);
  const mensual = paquetes.find((p) => p.meses === 1)?.precio ?? 0;

  return (
    <>
      <div className="plan-grid">
        {paquetes.map((p) => {
          const sinDescuento = mensual * p.meses;
          const ahorro = sinDescuento - p.precio;
          const pct = sinDescuento > 0 ? (ahorro / sinDescuento) * 100 : 0;
          return (
            <form
              key={p.meses}
              action={formAction}
              onSubmit={() => setElegido(p.meses)}
              className={`plan-card ${p.meses === DESTACADO ? "destacado" : ""}`}
            >
              {BADGE[p.meses] && <span className="plan-badge">{BADGE[p.meses]}</span>}
              <input type="hidden" name="meses" value={p.meses} />
              <div className="plan-meses">
                {p.meses} {p.meses === 1 ? "mes" : "meses"}
              </div>
              <div className="plan-precio">
                {pesos(p.precio)} <span className="muted small">COP</span>
              </div>
              {p.meses > 1 ? (
                <>
                  <div className="muted small">Equivale a {pesos(Math.floor(p.precio / p.meses))}/mes</div>
                  {ahorro > 0 && (
                    <div className="plan-ahorro">
                      Ahorras {pesos(ahorro)} ({porcentaje(pct)}%)
                    </div>
                  )}
                </>
              ) : (
                <div className="muted small">Pago mes a mes</div>
              )}
              <button
                className={`btn ${p.meses === DESTACADO ? "" : "secondary"}`}
                type="submit"
                disabled={pending}
                style={{ width: "100%", justifyContent: "center", marginTop: 12 }}
              >
                {pending && elegido === p.meses ? "Abriendo pago seguro…" : accion}
              </button>
            </form>
          );
        })}
      </div>
      {state.error && <div className="error">{state.error}</div>}
    </>
  );
}
