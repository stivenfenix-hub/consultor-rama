"use client";

import { useEffect, useState } from "react";

export type Tema = "oscuro" | "claro";
export const CLAVE_TEMA = "estradox-tema";
const COLOR_BARRA: Record<Tema, string> = { oscuro: "#0a0820", claro: "#f3f2fa" };

/** Aplica el tema en <html> y en la barra del navegador del celular. */
export function aplicarTema(t: Tema) {
  if (t === "claro") document.documentElement.dataset.tema = "claro";
  else delete document.documentElement.dataset.tema;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", COLOR_BARRA[t]);
}

/**
 * Apariencia de la plataforma: "Día" (claro) o "Noche" (oscuro, el de siempre).
 * Se guarda en este dispositivo.
 */
export function TemaToggle() {
  const [tema, setTema] = useState<Tema>("oscuro");

  useEffect(() => {
    setTema(document.documentElement.dataset.tema === "claro" ? "claro" : "oscuro");
  }, []);

  const elegir = (t: Tema) => {
    setTema(t);
    aplicarTema(t);
    try {
      localStorage.setItem(CLAVE_TEMA, t);
    } catch {
      /* sin almacenamiento: solo dura esta visita */
    }
  };

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
