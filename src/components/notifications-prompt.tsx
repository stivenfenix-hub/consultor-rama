"use client";

import { useEffect, useState } from "react";
import { isSubscribed, pushSupported, subscribeToPush } from "@/lib/push-client";
import { Icon } from "./icon";

/**
 * Aviso para activar notificaciones.
 * - App instalada (standalone): insiste. Aparece en cada apertura, recarga o
 *   ingreso mientras las notificaciones no estén activas; "Cerrar" solo la oculta
 *   hasta la próxima vez.
 * - En el navegador: una sola vez (ahí la prioridad es la burbuja de instalar).
 * Si el permiso está bloqueado, el navegador ya no deja preguntar: se explica
 * cómo activarlas en los ajustes del celular.
 */
export function NotificationsPrompt() {
  const [show, setShow] = useState(false);
  const [bloqueado, setBloqueado] = useState(false);
  const [ios, setIos] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        if (!pushSupported()) return;
        const standalone =
          (navigator as unknown as { standalone?: boolean }).standalone === true ||
          window.matchMedia("(display-mode: standalone)").matches;
        const permiso = Notification.permission;
        if (permiso === "granted" && (await isSubscribed())) return; // ya activas
        if (!standalone) {
          if (localStorage.getItem("estradox_notif_asked") === "1") return;
          if (permiso !== "default") return;
        }
        setBloqueado(permiso === "denied");
        setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
        setShow(true);
      } catch {
        // ignore
      }
    })();
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
      if (Notification.permission === "denied") setBloqueado(true);
      else setMsg("Sin problema, puedes activarlas luego en Configuración.");
    } else {
      setMsg("No se pudieron activar. Inténtalo de nuevo en Configuración.");
    }
    setBusy(false);
  };

  return (
    <div className="ios-bubble" role="dialog" aria-label="Activar notificaciones">
      <button className="ios-bubble-close" onClick={dismiss} aria-label="Cerrar">
        <Icon name="close" size={16} />
      </button>
      <div className="ios-bubble-title"><Icon name="bell" /> Activa las notificaciones</div>
      {bloqueado ? (
        <div className="ios-bubble-text">
          Están bloqueadas y así no te enteras de las <b>actuaciones nuevas</b>.{" "}
          {ios ? (
            <>Ve a <b>Ajustes → Notificaciones → Estradox</b> y activa <b>Permitir notificaciones</b>.</>
          ) : (
            <>
              Mantén presionado el ícono de Estradox → <b>Info de la app</b> →{" "}
              <b>Notificaciones</b> y actívalas.
            </>
          )}
        </div>
      ) : (
        <>
          <div className="ios-bubble-text">
            Te avisamos apenas haya <b>actuaciones nuevas</b> en tus procesos.
          </div>
          {msg ? (
            <div className="ok small" style={{ marginTop: 8 }}>
              {msg}
            </div>
          ) : (
            <div className="row" style={{ gap: 8, marginTop: 10 }}>
              <button className={`btn ${busy ? "" : "btn-pulse"}`} onClick={activar} disabled={busy}>
                {busy ? "Activando…" : "Activar"}
              </button>
              <button className="btn secondary" onClick={dismiss} disabled={busy}>
                Ahora no
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
