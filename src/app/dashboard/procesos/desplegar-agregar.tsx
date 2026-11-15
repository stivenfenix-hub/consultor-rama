"use client";

import { useState, type ReactNode } from "react";

/**
 * Con procesos ya cargados, el formulario de agregar (y la tarjeta de estados)
 * van ocultos tras el botón "+ Agregar proceso" para una vista limpia.
 */
export function DesplegarAgregar({ abierto, children }: { abierto: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(abierto);
  return (
    <>
      <div className="row" style={{ marginBottom: open ? 12 : 4 }}>
        <button
          type="button"
          className={`btn ${open ? "secondary" : ""}`}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Ocultar" : "+ Agregar proceso"}
        </button>
      </div>
      {open && children}
    </>
  );
}
