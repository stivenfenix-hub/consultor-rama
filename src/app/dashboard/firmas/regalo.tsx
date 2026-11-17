"use client";

import Link from "next/link";
import { useState } from "react";

const pesos = (n: number) => `$${n.toLocaleString("es-CO")}`;
const COLORES = ["#a855f7", "#22c55e", "#facc15", "#38bdf8", "#f472b6", "#fb923c"];

/**
 * Bienvenida de Firma electrónica para quien aún no ha enviado nada: un regalo
 * que se abre (con confeti) y revela que su primera firma es gratis.
 */
export function RegaloPrimeraFirma({
  precioMax,
  procesos,
  meta,
}: {
  precioMax: number;
  /** Procesos cargados si el regalo aún está bloqueado (null = ya desbloqueado). */
  procesos: number | null;
  meta: number;
}) {
  const [abierto, setAbierto] = useState(false);

  if (procesos !== null) {
    const faltan = Math.max(0, meta - procesos);
    return (
      <div className="card regalo bloqueado">
        <span className="regalo-cinta">🎁 Regalo de bienvenida</span>
        <div className="regalo-caja quieta" aria-hidden>
          <span className="regalo-cuerpo">🎁</span>
          <span className="regalo-candado">🔒</span>
        </div>
        <h2>Tu primera firma electrónica puede ser gratis</h2>
        <p className="muted">
          Carga <b>{meta} procesos</b> en Estradox y desbloqueas una firma gratis (valor {pesos(precioMax)}), incluso con
          cédula y rostro. Te {faltan === 1 ? "falta 1 proceso" : `faltan ${faltan} procesos`}.
        </p>
        <div className="regalo-progreso" role="progressbar" aria-valuemin={0} aria-valuemax={meta} aria-valuenow={procesos}>
          {Array.from({ length: meta }, (_, i) => (
            <span key={i} className={i < procesos ? "lleno" : ""}>
              {i < procesos ? "✓" : i + 1}
            </span>
          ))}
        </div>
        <p className="muted small">
          {procesos} de {meta} procesos
        </p>
        <div className="row wrap" style={{ gap: 8, justifyContent: "center" }}>
          <Link prefetch={false} href="/dashboard/procesos" className="btn btn-pulse regalo-cta">
            Agregar mis procesos →
          </Link>
          <Link prefetch={false} href="/dashboard/firmas/nuevo" className="btn secondary">
            Prefiero pagar y enviar ya
          </Link>
        </div>
      </div>
    );
  }

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
