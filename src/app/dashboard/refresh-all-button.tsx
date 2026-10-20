"use client";

import { useTransition } from "react";
import { actualizarTodosAction } from "@/app/actions";

export function RefreshAllButton() {
  const [pending, startTransition] = useTransition();
  return (
    <button
      className="btn secondary"
      disabled={pending}
      onClick={() => startTransition(() => actualizarTodosAction())}
      title="Consulta la Rama y actualiza todos tus procesos"
    >
      {pending ? "Actualizando…" : "↻ Actualizar todos"}
    </button>
  );
}
