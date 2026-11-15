"use client";

import { useState, type ReactNode } from "react";

/**
 * Con procesos ya cargados, el formulario de agregar (y la tarjeta de estados)
 * van ocultos tras el botón "+ Agregar proceso", a la derecha del título.
 */
export function DesplegarAgregar({
  titulo,
  abierto,
  children,
}: {
  titulo: string;
  abierto: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(abierto);
  return (
    <>
      <div className="page-head">
        <h1>{titulo}</h1>
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
