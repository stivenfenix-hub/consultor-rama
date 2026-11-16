"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";

/**
 * Compara un PDF que la persona tiene en su equipo con las huellas guardadas.
 * La huella se calcula en el navegador: el archivo no se sube a ninguna parte.
 */
export function Comparar({ original, firmado }: { original: string; firmado: string | null }) {
  const [r, setR] = useState<{ tipo: "firmado" | "original" | "ninguno"; hash: string; nombre: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function revisar(f: File) {
    setOcupado(true);
    try {
      const buf = await crypto.subtle.digest("SHA-256", await f.arrayBuffer());
      const hash = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
      setR({ tipo: hash === firmado ? "firmado" : hash === original ? "original" : "ninguno", hash, nombre: f.name });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div style={{ marginTop: 14 }}>
      <label className="firma-subir compacto">
        <input type="file" accept="application/pdf,.pdf" onChange={(e) => e.target.files?.[0] && revisar(e.target.files[0])} />
        <Icon name="shield" size={22} />
        <b>{ocupado ? "Calculando huella…" : "Compruebe su PDF: toque para elegirlo"}</b>
        <span className="muted small">El archivo no sale de su dispositivo: la huella se calcula aquí mismo.</span>
      </label>
      {r && (
        <div className={`firma-veredicto ${r.tipo === "ninguno" ? "no" : "si"}`}>
          <div className="firma-veredicto-icon">
            <Icon name={r.tipo === "ninguno" ? "alert" : "check"} size={22} />
          </div>
          <div>
            <b>
              {r.tipo === "firmado"
                ? "Coincide: es el PDF sellado auténtico"
                : r.tipo === "original"
                  ? "Coincide con el documento original (antes de las firmas)"
                  : "No coincide: este archivo no es el documento sellado"}
            </b>
            <p className="small" style={{ margin: "4px 0 0" }}>
              {r.tipo === "ninguno"
                ? "Fue modificado después de sellarlo, o es otro documento. No lo dé por auténtico."
                : `«${r.nombre}» no ha sido alterado.`}
            </p>
            <code className="small" style={{ wordBreak: "break-all" }}>{r.hash}</code>
          </div>
        </div>
      )}
    </div>
  );
}
