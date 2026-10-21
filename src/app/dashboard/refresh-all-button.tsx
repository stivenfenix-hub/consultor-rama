"use client";

import { useTransition } from "react";
import { actualizarTodosAction } from "@/app/actions";
import { Icon } from "@/components/icon";

export function RefreshAllButton() {
  const [pending, startTransition] = useTransition();
  return (
    <button
      className="btn secondary"
      disabled={pending}
      onClick={() => startTransition(() => actualizarTodosAction())}
      title="Consulta la Rama y actualiza todos tus procesos"
    >
      {pending ? "Actualizando…" : <><Icon name="refresh" /> Actualizar todos</>}
    </button>
  );
}
