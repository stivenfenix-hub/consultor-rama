"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "./icon";

// Páginas de acceso donde no se muestra la burbuja.
const SIN_BURBUJA = ["/login", "/register", "/forgot", "/reset", "/verify"];
const OCULTAR_MS = 7 * 24 * 60 * 60 * 1000;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};

/**
 * Invitación a instalar Estradox como app.
 * - Android / Chrome / Edge: botón "Instalar app" (instalación nativa de un toque).
 * - iPhone/iPad: instrucciones manuales (Apple no permite instalar por API).
 * No se muestra si ya está instalada (standalone), si el usuario la cerró, ni
 * en las páginas de acceso (login, registro, etc.).
 */
export function IosInstallBubble() {
  const pathname = usePathname();
  const [show, setShow] = useState(false);
  const [ios, setIos] = useState(false);
  const [chrome, setChrome] = useState(false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    let dismissed = false;
    let standalone = false;
    try {
      // "Cerrar" la oculta 7 días (antes era para siempre: valor "1").
      dismissed =
        Date.now() - Number(localStorage.getItem("estradox_pwa") ?? 0) < OCULTAR_MS;
      standalone =
        (navigator as unknown as { standalone?: boolean }).standalone === true ||
        window.matchMedia("(display-mode: standalone)").matches;
      const ua = navigator.userAgent || "";
      const isIOS =
        (/iphone|ipad|ipod/i.test(ua) ||
          // iPad con iPadOS se presenta como Mac
          (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) &&
        !(window as unknown as { MSStream?: unknown }).MSStream;
      if (!standalone && !dismissed && isIOS) {
        setIos(true);
        setChrome(/crios/i.test(ua));
        setShow(true);
      }
    } catch {
      // ignore
    }

    const onBIP = (e: Event) => {
      e.preventDefault();
      if (standalone || dismissed) return;
      setDeferred(e as BeforeInstallPromptEvent);
      setShow(true);
    };
    const onInstalled = () => {
      try {
        localStorage.setItem("estradox_pwa", String(Date.now()));
      } catch {
        // ignore
      }
      setShow(false);
    };
    window.addEventListener("beforeinstallprompt", onBIP);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBIP);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!show || SIN_BURBUJA.some((p) => pathname.startsWith(p))) return null;

  const close = () => {
    try {
      localStorage.setItem("estradox_pwa", String(Date.now()));
    } catch {
      // ignore
    }
    setShow(false);
  };

  const install = async () => {
    if (!deferred) return;
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } catch {
      // ignore
    }
    setDeferred(null);
    close();
  };

  return (
    <div className="ios-bubble" role="dialog" aria-label="Instalar app">
      <button className="ios-bubble-close" onClick={close} aria-label="Cerrar">
        <Icon name="close" size={16} />
      </button>
      <div className="ios-bubble-title"><Icon name="phone" /> Instala Estradox</div>

      {deferred ? (
        <>
          <div className="ios-bubble-text">
            Instálala para abrirla como app, en su propia ventana y sin barras
            del navegador.
          </div>
          <button
            className="btn"
            style={{ marginTop: 10 }}
            onClick={install}
          >
            <Icon name="download" /> Instalar app
          </button>
        </>
      ) : ios ? (
        <div className="ios-bubble-text">
          {chrome ? "En Chrome pulsa" : "En Safari pulsa"}{" "}
          {!chrome && <b>“⋯”</b>}
          {!chrome && " y luego "}
          <b>
            Compartir{" "}
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ verticalAlign: "-2px" }}
            >
              <path d="M12 15V3" />
              <path d="M8 7l4-4 4 4" />
              <path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" />
            </svg>
          </b>{" "}
          {chrome && "(arriba, junto a la dirección)"} y elige{" "}
          <b>“Agregar a inicio”</b>. (En iPhone, Apple solo permite instalarla
          así.)
        </div>
      ) : null}
    </div>
  );
}
