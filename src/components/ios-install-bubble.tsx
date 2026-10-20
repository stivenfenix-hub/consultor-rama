"use client";

import { useEffect, useState } from "react";

/**
 * Burbuja para iPhone (Safari) invitando a "Agregar a inicio" para usar
 * Estradox como app. No se muestra si ya está instalada (standalone) o si el
 * usuario la cerró antes.
 */
export function IosInstallBubble() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      const ua = navigator.userAgent || "";
      const isIOS =
        /iphone|ipad|ipod/i.test(ua) &&
        !(window as unknown as { MSStream?: unknown }).MSStream;
      const isStandalone =
        (navigator as unknown as { standalone?: boolean }).standalone === true ||
        window.matchMedia("(display-mode: standalone)").matches;
      // "Agregar a inicio" solo funciona en Safari (no Chrome/Firefox iOS).
      const isSafari = !/crios|fxios|edgios|opios/i.test(ua);
      const dismissed = localStorage.getItem("estradox_ios_pwa") === "1";
      if (isIOS && isSafari && !isStandalone && !dismissed) setShow(true);
    } catch {
      // ignore
    }
  }, []);

  if (!show) return null;

  const close = () => {
    try {
      localStorage.setItem("estradox_ios_pwa", "1");
    } catch {
      // ignore
    }
    setShow(false);
  };

  return (
    <div className="ios-bubble" role="dialog" aria-label="Instalar app">
      <button className="ios-bubble-close" onClick={close} aria-label="Cerrar">
        ✕
      </button>
      <div className="ios-bubble-title">📲 Instala Estradox en tu iPhone</div>
      <div className="ios-bubble-text">
        Úsala como app: pulsa{" "}
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
        en Safari y elige <b>“Agregar a inicio”</b>. Se abrirá en su propia
        ventana, sin barras.
      </div>
    </div>
  );
}
