"use client";

import { useState } from "react";
import { corregirNombreAction } from "@/app/actions";
import { Icon } from "./icon";

/**
 * Aviso para un registro con datos que parecen de relleno: la cuenta puede ser
 * eliminada (el root lo revisa y decide). Si el problema es el nombre, se puede
 * corregir aquí mismo; si es el correo, hay que registrarse con el real.
 */
export function SospechosoAviso({ nombreMal, correoMal }: { nombreMal: boolean; correoMal: boolean }) {
  const [show, setShow] = useState(true);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);

  if (!show) return null;

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await corregirNombreAction(first, last).catch(() => ({ error: "No se pudo guardar." }));
    setBusy(false);
    if ("ok" in r && r.ok) {
      setMsg({ ok: r.ok });
      if (!("sigue" in r && r.sigue)) setTimeout(() => setShow(false), 2_000);
    } else {
      setMsg({ error: ("error" in r && r.error) || "No se pudo guardar." });
    }
  };

  return (
    <div className="ios-bubble sospechoso-bubble" role="alertdialog" aria-label="Registro sospechoso">
      <button className="ios-bubble-close" onClick={() => setShow(false)} aria-label="Cerrar">
        <Icon name="close" size={16} />
      </button>
      <div className="ios-bubble-title">⚠️ Tu cuenta será eliminada</div>
      <div className="ios-bubble-text">
        {nombreMal && correoMal
          ? "Tu nombre y tu correo no parecen reales."
          : nombreMal
            ? "El nombre con el que te registraste no parece real."
            : "El correo con el que te registraste no parece real."}{" "}
        Las cuentas con datos sospechosos se eliminan.
        {correoMal && " Si tu correo es otro, regístrate de nuevo con tu correo real."}
      </div>
      {nombreMal && !msg?.ok && (
        <form onSubmit={guardar} style={{ display: "grid", gap: 8, marginTop: 10 }}>
          <input placeholder="Nombre" value={first} onChange={(e) => setFirst(e.target.value)} required />
          <input placeholder="Apellido" value={last} onChange={(e) => setLast(e.target.value)} required />
          <button className="btn btn-pulse" disabled={busy}>
            {busy ? "Guardando…" : "Corregir mis datos"}
          </button>
        </form>
      )}
      {msg?.error && <div className="error small" style={{ marginTop: 8 }}>{msg.error}</div>}
      {msg?.ok && <div className="ok small" style={{ marginTop: 8 }}>{msg.ok}</div>}
    </div>
  );
}
