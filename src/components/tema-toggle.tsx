"use client";

import { useEffect, useState } from "react";

export type Tema = "oscuro" | "claro";
export const CLAVE_TEMA = "estradox-tema";
const COLOR_BARRA: Record<Tema, string> = { oscuro: "#0a0820", claro: "#f3f2fa" };
const EVENTO = "estradox-tema";

/** Aplica el tema en <html> y en la barra del navegador del celular. */
export function aplicarTema(t: Tema) {
  if (t === "claro") document.documentElement.dataset.tema = "claro";
  else delete document.documentElement.dataset.tema;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", COLOR_BARRA[t]);
}

/** Estado del tema compartido: si se cambia en un selector, el otro se entera. */
function useTema() {
  const [tema, setTema] = useState<Tema>("oscuro");

  useEffect(() => {
    const leer = () => setTema(document.documentElement.dataset.tema === "claro" ? "claro" : "oscuro");
    leer();
    window.addEventListener(EVENTO, leer);
    return () => window.removeEventListener(EVENTO, leer);
  }, []);

  const elegir = (t: Tema) => {
    setTema(t);
    aplicarTema(t);
    try {
      localStorage.setItem(CLAVE_TEMA, t);
    } catch {
      /* sin almacenamiento: solo dura esta visita */
    }
    window.dispatchEvent(new Event(EVENTO));
  };

  return { tema, elegir };
}

/**
 * Apariencia de la plataforma: "Día" (claro) o "Noche" (oscuro, el de siempre).
 * Se guarda en este dispositivo.
 */
export function TemaToggle() {
  const { tema, elegir } = useTema();

  return (
    <div>
      <div className="tema-titulo">Apariencia</div>
      <div className="tema-toggle" role="group" aria-label="Apariencia de la plataforma" style={{ marginTop: 8 }}>
        <button
          type="button"
          className={tema === "claro" ? "on" : ""}
          aria-pressed={tema === "claro"}
          onClick={() => elegir("claro")}
          title="Fondo claro, ideal de día o con mucha luz"
        >
          ☀️ Día
        </button>
        <button
          type="button"
          className={tema === "oscuro" ? "on" : ""}
          aria-pressed={tema === "oscuro"}
          onClick={() => elegir("oscuro")}
          title="Fondo oscuro, descansa la vista de noche"
        >
          🌙 Noche
        </button>
      </div>
    </div>
  );
}

/** Versión compacta (solo íconos) para la barra de arriba del celular, junto a la campana. */
export function TemaIconos() {
  const { tema, elegir } = useTema();

  return (
    <div className="tema-toggle tema-iconos" role="group" aria-label="Apariencia: día o noche">
      <button
        type="button"
        className={tema === "claro" ? "on" : ""}
        aria-pressed={tema === "claro"}
        aria-label="Día (fondo claro)"
        title="Día"
        onClick={() => elegir("claro")}
      >
        ☀️
      </button>
      <button
        type="button"
        className={tema === "oscuro" ? "on" : ""}
        aria-pressed={tema === "oscuro"}
        aria-label="Noche (fondo oscuro)"
        title="Noche"
        onClick={() => elegir("oscuro")}
      >
        🌙
      </button>
    </div>
  );
}
