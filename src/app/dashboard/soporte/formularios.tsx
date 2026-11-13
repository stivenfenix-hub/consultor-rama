"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { crearCasoAction, responderAction, type EstadoForm } from "./actions";

const TIPOS: { id: string; label: string; emoji: string; ayuda: string }[] = [
  { id: "ayuda", label: "Pregunta o ayuda", emoji: "❓", ayuda: "¿Cómo hago…? ¿Dónde veo…?" },
  { id: "problema", label: "Algo no funciona", emoji: "🛠️", ayuda: "Un error, algo que no carga o no llegó" },
  { id: "sugerencia", label: "Sugerencia", emoji: "💡", ayuda: "Una idea para mejorar Estradox" },
  { id: "peticion", label: "Petición", emoji: "📝", ayuda: "Solicitar algo (cambio de datos, factura…)" },
  { id: "queja", label: "Queja o reclamo", emoji: "⚠️", ayuda: "Algo con lo que no estás conforme" },
];

function Enviar({ texto, enviando }: { texto: string; enviando: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn" type="submit" disabled={pending}>
      {pending ? enviando : texto}
    </button>
  );
}

/** Formulario de caso nuevo: tipo (tarjetas), asunto y mensaje. */
export function NuevoCaso() {
  const [state, action] = useActionState<EstadoForm, FormData>(crearCasoAction, {});
  const [tipo, setTipo] = useState("ayuda");
  return (
    <form action={action} className="soporte-form">
      <div className="small muted" style={{ marginBottom: 6 }}>
        ¿De qué se trata?
      </div>
      <div className="soporte-tipos" role="radiogroup" aria-label="Tipo de mensaje">
        {TIPOS.map((t) => (
          <label key={t.id} className={`soporte-tipo ${tipo === t.id ? "activo" : ""}`}>
            <input
              type="radio"
              name="tipo"
              value={t.id}
              checked={tipo === t.id}
              onChange={() => setTipo(t.id)}
            />
            <span className="soporte-tipo-emoji" aria-hidden>
              {t.emoji}
            </span>
            <span>
              <b>{t.label}</b>
              <span className="muted small" style={{ display: "block" }}>
                {t.ayuda}
              </span>
            </span>
          </label>
        ))}
      </div>
      <label className="small muted" htmlFor="asunto" style={{ display: "block", marginTop: 12 }}>
        Asunto
      </label>
      <input id="asunto" name="asunto" maxLength={140} required placeholder="En pocas palabras, ¿qué pasa?" />
      <label className="small muted" htmlFor="texto" style={{ display: "block", marginTop: 12 }}>
        Mensaje
      </label>
      <textarea
        id="texto"
        name="texto"
        rows={5}
        maxLength={5000}
        required
        placeholder="Cuéntanos con detalle. Si es sobre un proceso, incluye el radicado."
      />
      {state.error && <div className="error small">{state.error}</div>}
      <div style={{ marginTop: 12 }}>
        <Enviar texto="Enviar mensaje" enviando="Enviando…" />
      </div>
    </form>
  );
}

/** Caja para responder en una conversación (abogado o root). */
export function Responder({
  id,
  lado,
  placeholder,
}: {
  id: number;
  lado: "usuario" | "soporte";
  placeholder: string;
}) {
  const [state, action] = useActionState<EstadoForm, FormData>(responderAction, {});
  const form = useRef<HTMLFormElement>(null);
  const [enviado, setEnviado] = useState(0);
  useEffect(() => {
    if (enviado && !state.error) form.current?.reset();
  }, [state, enviado]);
  return (
    <form ref={form} action={(fd) => (setEnviado((n) => n + 1), action(fd))} className="soporte-responder">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="lado" value={lado} />
      <textarea name="texto" rows={3} maxLength={5000} required placeholder={placeholder} />
      {state.error && <div className="error small">{state.error}</div>}
      <div className="row wrap" style={{ gap: 8, marginTop: 8, alignItems: "center" }}>
        <Enviar texto={lado === "soporte" ? "Responder" : "Enviar"} enviando="Enviando…" />
        {lado === "soporte" && (
          <label className="small muted row" style={{ gap: 6, alignItems: "center" }}>
            <input type="checkbox" name="cerrar" value="1" /> Marcar como resuelto
          </label>
        )}
      </div>
    </form>
  );
}
