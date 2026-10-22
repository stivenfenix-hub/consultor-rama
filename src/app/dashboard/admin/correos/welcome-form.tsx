"use client";

import { useActionState } from "react";
import { saveWelcomeAction } from "@/app/actions";

type Template = { subject: string; button: string; body: string };

export function WelcomeForm({ template }: { template: Template }) {
  const [state, formAction, pending] = useActionState(saveWelcomeAction, {});

  return (
    // key: al restaurar el original, el formulario se vuelve a montar con el texto nuevo
    <form action={formAction} key={JSON.stringify(template)}>
      <label className="small muted" htmlFor="subject">Asunto</label>
      <input id="subject" name="subject" type="text" required defaultValue={template.subject} />
      <div style={{ height: 12 }} />

      <label className="small muted" htmlFor="button">Texto del botón</label>
      <input id="button" name="button" type="text" required defaultValue={template.button} />
      <div className="muted small" style={{ marginTop: 4 }}>
        El botón lleva al abogado a la página para agregar sus procesos.
      </div>
      <div style={{ height: 12 }} />

      <label className="small muted" htmlFor="body">Cuerpo del correo</label>
      <textarea
        id="body"
        name="body"
        required
        rows={22}
        defaultValue={template.body}
        style={{
          width: "100%",
          background: "var(--panel-2)",
          border: "1px solid var(--border)",
          color: "var(--text)",
          borderRadius: 8,
          padding: "10px 12px",
          fontSize: 14,
          lineHeight: 1.5,
          resize: "vertical",
        }}
      />
      <div className="muted small" style={{ marginTop: 6, lineHeight: 1.6 }}>
        <b>{"{nombre}"}</b> = nombre del abogado · una línea que solo diga{" "}
        <b>[boton]</b> = el botón · <b>**texto**</b> = negrilla · deja una línea en
        blanco entre párrafos.
      </div>

      <div className="row wrap" style={{ gap: 10, marginTop: 16 }}>
        <button className="btn" type="submit" name="intent" value="save" disabled={pending}>
          {pending ? "Guardando..." : "Guardar"}
        </button>
        <button className="btn secondary" type="submit" name="intent" value="test" disabled={pending}>
          Guardar y enviarme una prueba
        </button>
        <button
          className="btn secondary"
          type="submit"
          name="intent"
          value="reset"
          formNoValidate
          disabled={pending}
          onClick={(e) => {
            if (!confirm("¿Restaurar el texto original del correo de bienvenida?")) e.preventDefault();
          }}
        >
          Restaurar original
        </button>
      </div>
      {state.error && <div className="error">{state.error}</div>}
      {state.ok && <div className="ok">{state.ok}</div>}
    </form>
  );
}
