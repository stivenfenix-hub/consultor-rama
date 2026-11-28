"use client";

import { useState, useTransition } from "react";

/**
 * Botón de acción con confirmación en dos pasos (28 nov 2026): el primer clic
 * no ejecuta nada, solo muestra "¿Seguro?" con "Sí" y "Cancelar" en la misma
 * fila. Reemplaza al confirm() del navegador, que se acepta sin leer o queda
 * bloqueado ("no permitir más diálogos") y entonces ejecuta de una.
 */
export function BotonConfirmar({
  texto,
  pregunta,
  confirmar,
  accion,
  peligro = false,
  title,
}: {
  /** Texto del botón ("Eliminar"). */
  texto: string;
  /** Qué va a pasar, en una o dos frases. */
  pregunta: string;
  /** Texto del botón que ejecuta ("Sí, eliminar"). */
  confirmar: string;
  accion: () => Promise<{ error?: string } | void>;
  peligro?: boolean;
  title?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!abierto) {
    return (
      <>
        <button
          type="button"
          className={`btn ${peligro ? "danger" : "secondary"} small`}
          disabled={pending}
          title={title}
          onClick={() => {
            setError(null);
            setAbierto(true);
          }}
        >
          {pending ? "Guardando…" : texto}
        </button>
        {error && <div className="error small">{error}</div>}
      </>
    );
  }

  return (
    <div
      role="alertdialog"
      aria-label={pregunta}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: 8,
        border: `1px solid ${peligro ? "var(--red, #dc2626)" : "var(--border, #ddd)"}`,
        borderRadius: 8,
        maxWidth: 260,
        whiteSpace: "normal",
      }}
    >
      <span className="small">
        <b>¿Seguro?</b> {pregunta}
      </span>
      <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
        <button
          type="button"
          className={`btn ${peligro ? "danger" : ""} small`}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await accion();
              setAbierto(false);
              if (r && r.error) setError(r.error);
            })
          }
        >
          {pending ? "Guardando…" : confirmar}
        </button>
        <button type="button" className="btn secondary small" disabled={pending} autoFocus onClick={() => setAbierto(false)}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
