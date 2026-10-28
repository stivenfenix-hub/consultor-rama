"use client";

import { useEffect, useState } from "react";
import { waActuacionesAction } from "@/app/actions";
import { Icon } from "./icon";

const CLAVE = "estradox_wa_prompt";
const OCULTAR_MS = 3 * 24 * 60 * 60 * 1000; // "Ahora no": vuelve a preguntar en 3 días

/**
 * Burbuja para activar las actuaciones nuevas por WhatsApp. Sale solo a quien
 * aún no ha decidido y tiene WhatsApp registrado, y nunca encima de otra
 * burbuja (instalar app, notificaciones): espera a que no haya ninguna.
 */
export function WhatsappPrompt({ whatsapp }: { whatsapp: string }) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    try {
      const t = Number(localStorage.getItem(CLAVE) ?? 0);
      if (t && Date.now() - t < OCULTAR_MS) return;
    } catch {
      // ignore
    }
    const timer = setTimeout(() => {
      if (!document.querySelector(".ios-bubble")) setShow(true);
    }, 6_000);
    return () => clearTimeout(timer);
  }, []);

  if (!show) return null;

  const ahoraNo = () => {
    try {
      localStorage.setItem(CLAVE, String(Date.now()));
    } catch {
      // ignore
    }
    setShow(false);
  };

  const activar = async () => {
    setBusy(true);
    const r = await waActuacionesAction(true).catch(() => ({ error: "No se pudo activar." }));
    setBusy(false);
    if ("ok" in r && r.ok) {
      setMsg(r.ok);
      setTimeout(() => setShow(false), 2_000);
    } else {
      setMsg(("error" in r && r.error) || "No se pudo activar.");
    }
  };

  return (
    <div className="ios-bubble" role="dialog" aria-label="Actuaciones por WhatsApp">
      <button className="ios-bubble-close" onClick={ahoraNo} aria-label="Cerrar">
        <Icon name="close" size={16} />
      </button>
      <div className="ios-bubble-title">
        <Icon name="phone" /> Tus actuaciones por WhatsApp
      </div>
      <div className="ios-bubble-text">
        ¿Quieres recibir las <b>actuaciones nuevas</b> de tus procesos también por WhatsApp al{" "}
        <b>{whatsapp}</b>?
      </div>
      {msg ? (
        <div className="ok small" style={{ marginTop: 8 }}>
          {msg}
        </div>
      ) : (
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <button className={`btn ${busy ? "" : "btn-pulse"}`} onClick={activar} disabled={busy}>
            {busy ? "Activando…" : "Sí, activar"}
          </button>
          <button className="btn secondary" onClick={ahoraNo} disabled={busy}>
            Ahora no
          </button>
        </div>
      )}
    </div>
  );
}
