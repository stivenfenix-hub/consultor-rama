"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import {
  pushSupported,
  isSubscribed,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/push-client";

export function NotificationsToggle() {
  const [supported, setSupported] = useState(true);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const ok = pushSupported();
    setSupported(ok);
    if (ok) isSubscribed().then(setSubscribed);
  }, []);

  const activar = async () => {
    setBusy(true);
    setMsg(null);
    const r = await subscribeToPush();
    if (r === "ok") {
      setSubscribed(true);
      setMsg("¡Notificaciones activadas en este dispositivo!");
    } else if (r === "denied") {
      setMsg("No diste permiso de notificaciones.");
    } else if (r === "nokey") {
      setMsg("Falta configurar la clave pública de notificaciones (VAPID).");
    } else {
      setMsg("No se pudieron activar en este dispositivo.");
    }
    setBusy(false);
  };

  const desactivar = async () => {
    setBusy(true);
    setMsg(null);
    await unsubscribeFromPush();
    setSubscribed(false);
    setMsg("Notificaciones desactivadas en este dispositivo.");
    setBusy(false);
  };

  if (!supported) {
    return (
      <p className="muted small">
        Tu navegador no soporta notificaciones push. En iPhone, primero instala
        la app (Compartir → “Agregar a inicio”) y actívalas desde ahí.
      </p>
    );
  }

  return (
    <div>
      <p className="muted small" style={{ marginTop: -4 }}>
        Recibe un aviso cuando haya actuaciones nuevas en tus procesos.
      </p>
      {subscribed ? (
        <button className="btn secondary" onClick={desactivar} disabled={busy}>
          {busy ? "..." : "Desactivar notificaciones"}
        </button>
      ) : (
        <button className="btn" onClick={activar} disabled={busy}>
          {busy ? "Activando..." : <><Icon name="bell" /> Activar notificaciones</>}
        </button>
      )}
      {msg && (
        <div className="small" style={{ marginTop: 8 }}>
          {msg}
        </div>
      )}
    </div>
  );
}
