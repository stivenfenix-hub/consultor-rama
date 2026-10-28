"use client";

import { useActionState, useState } from "react";
import { updateAppearanceAction } from "@/app/actions";
import { LOGOS } from "@/lib/marca";

type S = {
  brandName: string;
  byUrl: string;
  colorAccent: string;
  colorAccent2: string;
  colorBg: string;
  colorPanel: string;
};

function ColorField({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue: string;
}) {
  const [val, setVal] = useState(defaultValue);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label className="small muted">{label}</label>
      <div className="row" style={{ gap: 8 }}>
        <input
          type="color"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          style={{
            width: 44,
            height: 38,
            padding: 2,
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--panel-2)",
          }}
          aria-label={label}
        />
        <input
          type="text"
          name={name}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          style={{ maxWidth: 120 }}
        />
      </div>
    </div>
  );
}

// Logos publicados con el sitio (public/marca): solo se muestran.
const LOGOS_VISTA: { src: string; t: string; bg: string }[] = [
  { src: LOGOS.plataforma, t: "Plataforma (menú y app)", bg: "var(--bg)" },
  { src: LOGOS.correo, t: "Correos", bg: "#fff" },
  { src: LOGOS.by, t: "By (UNOR)", bg: "var(--bg)" },
  { src: LOGOS.notifIcono, t: "Ícono de notificaciones", bg: "var(--bg)" },
  { src: LOGOS.notifBadge, t: "Badge de notificaciones", bg: "#3b3366" },
  { src: LOGOS.favicon, t: "Favicon", bg: "var(--bg)" },
];

export function AppearanceForm({ settings }: { settings: S }) {
  const [state, formAction, pending] = useActionState(
    updateAppearanceAction,
    {},
  );

  return (
    <form action={formAction}>
      <div className="card">
        <h2>Marca y logos</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Los logos se publican con el sitio en Hostinger (carpeta public/marca), no en la base de datos.
          Para cambiar uno, pídelo y se publica la nueva versión.
        </p>
        <div className="row wrap" style={{ gap: 12, margin: "8px 0 14px" }}>
          {LOGOS_VISTA.map((l) => (
            <div key={l.t} style={{ display: "grid", gap: 4 }}>
              <div
                style={{
                  background: l.bg,
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 10,
                  minWidth: 150,
                  minHeight: 54,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={l.src} alt={l.t} style={{ maxHeight: 36, maxWidth: 200 }} />
              </div>
              <span className="small muted">{l.t}</span>
            </div>
          ))}
        </div>
        <label className="small muted">Nombre de la marca</label>
        <input
          type="text"
          name="brandName"
          defaultValue={settings.brandName}
          style={{ maxWidth: 320 }}
        />



        <div style={{ marginTop: 10 }}>
          <label className="small muted">Enlace del logo &quot;By&quot;</label>
          <input
            type="url"
            name="byUrl"
            defaultValue={settings.byUrl}
            placeholder="https://unorgroup.com"
            style={{ maxWidth: 320 }}
          />
        </div>


      </div>

      <div className="card">
        <h2>Colores</h2>
        <div className="row wrap" style={{ gap: 20, marginTop: 8 }}>
          <ColorField name="colorAccent" label="Acento (violeta)" defaultValue={settings.colorAccent} />
          <ColorField name="colorAccent2" label="Acento 2 (azul)" defaultValue={settings.colorAccent2} />
          <ColorField name="colorBg" label="Fondo" defaultValue={settings.colorBg} />
          <ColorField name="colorPanel" label="Panel" defaultValue={settings.colorPanel} />
        </div>
      </div>

      <div className="row" style={{ gap: 12 }}>
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Guardando..." : "Guardar cambios"}
        </button>
        {state.error && <span className="error">{state.error}</span>}
        {state.ok && <span className="ok">{state.ok}</span>}
      </div>
    </form>
  );
}
