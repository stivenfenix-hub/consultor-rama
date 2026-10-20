"use client";

import { useEffect, useState } from "react";
import { pushSupported, subscribeToPush } from "@/lib/push-client";

/**
 * Aviso que, al entrar, pregunta si quiere activar notificaciones.
 * Se muestra una sola vez: si ya decidió (permiso dado/negado) o ya lo cerró,
 * no vuelve a aparecer.
 */
export function NotificationsPrompt() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    try {
      if (!pushSupported()) return;
      if (localStorage.getItem("estradox_notif_asked") === "1") return;
      // Solo si aún no ha decidido (ni concedido ni bloqueado).
      if (Notification.permission !== "default") return;
      setShow(true);
    } catch {
      // ignore
    }
  }, []);

  if (!show) return null;

  const marcar = () => {
    try {
      localStorage.setItem("estradox_notif_asked", "1");
    } catch {
      // ignore
    }
  };

  const dismiss = () => {
    marcar();
    setShow(false);
  };

  const activar = async () => {
    setBusy(true);
    const r = await subscribeToPush();
    marcar();
    if (r === "ok") {
      setMsg("¡Listo! Te avisaremos de las novedades.");
      setTimeout(() => setShow(false), 1500);
    } else if (r === "denied") {
      setMsg("Sin problema, puedes activarlas luego en Configuración.");
      setTimeout(() => setShow(false), 2000);
    } else {
      setShow(false);
    }
    setBusy(false);
  };

  return (
    <div className="ios-bubble" role="dialog" aria-label="Activar notificaciones">
      <button className="ios-bubble-close" onClick={dismiss} aria-label="Cerrar">
        ✕
      </button>
      <div className="ios-bubble-title">🔔 ¿Activar notificaciones?</div>
      <div className="ios-bubble-text">
        Te avisamos apenas haya <b>actuaciones nuevas</b> en tus procesos.
      </div>
      {msg ? (
        <div className="ok small" style={{ marginTop: 8 }}>
          {msg}
        </div>
      ) : (
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <button className="btn" onClick={activar} disabled={busy}>
            {busy ? "Activando…" : "Activar"}
          </button>
          <button className="btn secondary" onClick={dismiss} disabled={busy}>
            Ahora no
          </button>
        </div>
      )}
    </div>
  );
}
