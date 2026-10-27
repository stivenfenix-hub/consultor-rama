"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "./icon";

// Páginas donde no se muestra la burbuja (en medio de registro o recuperación).
// En /login sí: es lo primero que ve quien entra desde el navegador del celular.
const SIN_BURBUJA = ["/register", "/forgot", "/reset", "/verify", "/completar-registro"];
// Si Chrome no ofrece su instalación en este tiempo, se dan instrucciones manuales.
const ESPERA_PROMPT_MS = 4000;
const OCULTAR_MS = 24 * 60 * 60 * 1000; // "Cerrar" la oculta 1 día

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
  const [android, setAndroid] = useState(false);
  // Android con la app ya instalada pero abierto en el navegador.
  const [instalada, setInstalada] = useState(false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    let dismissed = false;
    let standalone = false;
    try {
      // "Cerrar" la oculta por OCULTAR_MS (antes era para siempre: valor "1").
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

    // Android: si la app ya está instalada se invita a abrirla, siempre (no
    // depende de "Cerrar": al instalar también se guarda esa marca, y el
    // navegador y la app comparten el almacenamiento). Si no está instalada y
    // Chrome no lanza beforeinstallprompt (poco uso del sitio, Samsung Internet,
    // etc.), se muestran los pasos del menú ⋮.
    let espera: ReturnType<typeof setTimeout> | undefined;
    if (!standalone && /android/i.test(navigator.userAgent)) {
      (async () => {
        try {
          const nav = navigator as unknown as {
            getInstalledRelatedApps?: () => Promise<unknown[]>;
          };
          if (nav.getInstalledRelatedApps && (await nav.getInstalledRelatedApps()).length) {
            setInstalada(true);
            setShow(true);
            return;
          }
        } catch {
          // ignore
        }
        if (dismissed) return;
        espera = setTimeout(() => {
          setAndroid(true);
          setShow(true);
        }, ESPERA_PROMPT_MS);
      })();
    }

    const onBIP = (e: Event) => {
      e.preventDefault();
      clearTimeout(espera);
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
      clearTimeout(espera);
      window.removeEventListener("beforeinstallprompt", onBIP);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!show || SIN_BURBUJA.some((p) => pathname.startsWith(p))) return null;

  const close = () => {
    // "Ya tienes la app": se oculta solo por esta visita.
    if (instalada) return setShow(false);
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
      <div className="ios-bubble-title">
        <Icon name="phone" /> {instalada ? "Ya tienes la app" : "Instala Estradox"}
      </div>

      {instalada ? (
        <div className="ios-bubble-text">
          Úsala desde la app: es más rápida y te llegan las notificaciones. Ábrela con
          el ícono de <b>Estradox</b> en tu pantalla de inicio, o toca el menú <b>⋮</b>{" "}
          y elige <b>“Abrir en la app”</b>.
        </div>
      ) : deferred ? (
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
          así.) ¿Ya la instalaste? Ábrela desde el ícono de <b>Estradox</b>.
        </div>
      ) : android ? (
        <div className="ios-bubble-text">
          Toca el menú <b>⋮</b> del navegador (arriba a la derecha) y elige{" "}
          <b>“Instalar app”</b> o <b>“Agregar a la pantalla principal”</b>.
        </div>
      ) : null}
    </div>
  );
}
