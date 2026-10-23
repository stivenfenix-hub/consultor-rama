"use client";

import { useActionState, useEffect, useState } from "react";
import { pagarSuscripcionAction } from "@/app/actions";

const pesos = (n: number) => `$${n.toLocaleString("es-CO")}`;
const CLAVE = "estradox_oferta_15";
const OCULTAR_MS = 3 * 24 * 60 * 60 * 1000; // "Ahora no" la oculta 3 días

/** Oferta relámpago del día 15 de la prueba: plan de 12 meses. */
export function FlashOffer({
  precio,
  ahorro,
  diasUsados,
  diasRestantes,
}: {
  precio: number;
  ahorro: number;
  diasUsados: number;
  diasRestantes: number;
}) {
  const [state, formAction, pending] = useActionState(pagarSuscripcionAction, {});
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let oculta = false;
    try {
      oculta = Date.now() - Number(localStorage.getItem(CLAVE) ?? 0) < OCULTAR_MS;
    } catch {}
    setVisible(!oculta);
  }, []);

  if (!visible) return null;

  const semanas = Math.max(2, Math.floor(diasUsados / 7));
  return (
    <div className="flash-offer" role="region" aria-label="Oferta especial">
      <div className="flash-offer-tag">⚡ Oferta relámpago</div>
      <div className="flash-offer-title">
        ¿Te ha servido Estradox estas {semanas} semanas?
      </div>
      <div className="flash-offer-text">
        Asegura todo tu año judicial hoy por <b>{pesos(precio)}</b>{" "}
        <span className="plan-ahorro">(Ahorras {pesos(ahorro)})</span> y te sumamos tus{" "}
        <b>{diasRestantes} días gratis restantes</b> al final del año.
      </div>
      <form action={formAction} className="row wrap" style={{ gap: 10, marginTop: 12 }}>
        <input type="hidden" name="meses" value={12} />
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Abriendo pago seguro…" : `Asegurar mi año por ${pesos(precio)}`}
        </button>
        <button
          className="btn secondary"
          type="button"
          onClick={() => {
            try {
              localStorage.setItem(CLAVE, String(Date.now()));
            } catch {}
            setVisible(false);
          }}
        >
          Ahora no
        </button>
      </form>
      {state.error && <div className="error">{state.error}</div>}
    </div>
  );
}
