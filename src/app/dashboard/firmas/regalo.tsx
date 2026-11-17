"use client";

import Link from "next/link";
import { useState } from "react";

const pesos = (n: number) => `$${n.toLocaleString("es-CO")}`;
const COLORES = ["#a855f7", "#22c55e", "#facc15", "#38bdf8", "#f472b6", "#fb923c"];

/**
 * Bienvenida de Firma electrónica para quien aún no ha enviado nada: un regalo
 * que se abre (con confeti) y revela que su primera firma es gratis.
 */
export function RegaloPrimeraFirma({ precioMax }: { precioMax: number }) {
  const [abierto, setAbierto] = useState(false);

  return (
    <div className={`card regalo ${abierto ? "abierto" : ""}`}>
      <span className="regalo-cinta">🎁 Regalo de bienvenida</span>

      {!abierto ? (
        <>
          <button type="button" className="regalo-caja" onClick={() => setAbierto(true)} aria-label="Abrir el regalo">
            <span className="regalo-tapa">🎀</span>
            <span className="regalo-cuerpo">🎁</span>
          </button>
          <h2>Tienes un regalo esperándote</h2>
          <p className="muted">Tócalo para abrirlo.</p>
          <button type="button" className="btn btn-pulse" onClick={() => setAbierto(true)}>
            Abrir mi regalo
          </button>
        </>
      ) : (
        <>
          <div className="regalo-confeti" aria-hidden>
            {Array.from({ length: 28 }, (_, i) => (
              <i
                key={i}
                style={{
                  left: `${(i * 37) % 100}%`,
                  background: COLORES[i % COLORES.length],
                  animationDelay: `${(i % 7) * 0.08}s`,
                  transform: `rotate(${i * 29}deg)`,
                }}
              />
            ))}
          </div>
          <div className="regalo-precio">
            <s>{pesos(precioMax)}</s>
            <b>GRATIS</b>
          </div>
          <h2>¡Tu primera firma electrónica es gratis!</h2>
          <p className="muted">
            Pruébala sin pagar nada, incluso con el nivel más completo: <b>código + cédula + rostro</b>. Envía un poder o
            un contrato y mira cómo tu cliente lo firma desde el celular en minutos.
          </p>
          <ol className="regalo-pasos">
            <li>
              <span>1</span>Sube un PDF o usa una plantilla
            </li>
            <li>
              <span>2</span>Tu cliente firma desde el celular
            </li>
            <li>
              <span>3</span>Recibes el PDF sellado con su certificado
            </li>
          </ol>
          <Link prefetch={false} href="/dashboard/firmas/nuevo" className="btn btn-pulse regalo-cta">
            Enviar mi primera firma gratis →
          </Link>
        </>
      )}
    </div>
  );
}
