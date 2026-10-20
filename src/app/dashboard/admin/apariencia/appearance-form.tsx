"use client";

import { useActionState, useState } from "react";
import { updateAppearanceAction, resetLogoAction } from "@/app/actions";

type S = {
  brandName: string;
  logoDataUrl: string | null;
  emailLogoDataUrl: string | null;
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

function LogoUpload({
  field,
  title,
  hint,
  current,
  previewBg,
  which,
}: {
  field: string;
  title: string;
  hint: string;
  current: string | null;
  previewBg: string;
  which: "platform" | "email";
}) {
  const [preview, setPreview] = useState<string | null>(current);
  const fallback = "/logo-estradox.png";
  return (
    <div style={{ marginTop: 14 }}>
      <label className="small muted">{title}</label>
      <div className="row wrap" style={{ gap: 14, marginTop: 6 }}>
        <div
          style={{
            background: previewBg,
            borderRadius: 8,
            padding: 10,
            minWidth: 170,
            minHeight: 54,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "1px solid var(--border)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview ?? fallback}
            alt="logo"
            style={{ maxHeight: 36, maxWidth: 220 }}
          />
        </div>
        <input
          type="file"
          name={field}
          accept="image/png,image/jpeg,image/svg+xml"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setPreview(URL.createObjectURL(f));
          }}
        />
        {current && (
          <button
            type="button"
            className="btn danger small"
            onClick={() => {
              resetLogoAction(which);
              setPreview(null);
            }}
          >
            Quitar
          </button>
        )}
      </div>
      <p className="muted small" style={{ marginTop: 6 }}>
        {hint}
      </p>
    </div>
  );
}

export function AppearanceForm({ settings }: { settings: S }) {
  const [state, formAction, pending] = useActionState(
    updateAppearanceAction,
    {},
  );

  return (
    <form action={formAction}>
      <div className="card">
        <h2>Marca y logos</h2>
        <label className="small muted">Nombre de la marca</label>
        <input
          type="text"
          name="brandName"
          defaultValue={settings.brandName}
          style={{ maxWidth: 320 }}
        />

        <LogoUpload
          field="logo"
          which="platform"
          title="Logo de la plataforma (se ve sobre el tema oscuro — usa letra clara)"
          hint="Aparece en el menú y en las pantallas de la app."
          current={settings.logoDataUrl}
          previewBg="var(--bg)"
        />

        <LogoUpload
          field="emailLogo"
          which="email"
          title="Logo para los correos (se ve sobre fondo blanco — usa tu logo oscuro)"
          hint="Aparece en los correos de verificación, reset y notificaciones."
          current={settings.emailLogoDataUrl}
          previewBg="#fff"
        />
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
