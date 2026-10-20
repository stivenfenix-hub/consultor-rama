"use client";

import { useEffect, useState } from "react";

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function NotificationsToggle() {
  const [supported, setSupported] = useState(true);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const ok =
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    setSupported(ok);
    if (!ok) return;
    navigator.serviceWorker.ready
      .then(async (reg) => {
        const sub = await reg.pushManager.getSubscription();
        setSubscribed(!!sub);
      })
      .catch(() => {});
  }, []);

  const activar = async () => {
    setBusy(true);
    setMsg(null);
    try {
      if (!VAPID) {
        setMsg("Falta configurar la clave pública de notificaciones (VAPID).");
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setMsg("No diste permiso de notificaciones.");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID),
      });
      const r = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sub),
      });
      if (r.ok) {
        setSubscribed(true);
        setMsg("¡Notificaciones activadas en este dispositivo!");
      } else {
        setMsg("No se pudo guardar la suscripción.");
      }
    } catch (e) {
      setMsg(
        "No se pudieron activar. " + (e instanceof Error ? e.message : ""),
      );
    } finally {
      setBusy(false);
    }
  };

  const desactivar = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setSubscribed(false);
      setMsg("Notificaciones desactivadas en este dispositivo.");
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
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
          {busy ? "Activando..." : "🔔 Activar notificaciones"}
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
