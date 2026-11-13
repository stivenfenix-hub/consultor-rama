"use client";

import { useTransition } from "react";
import { quitarDeEstadosAction } from "@/app/actions";

/** Botón para dejar de vigilar un radicado en estados electrónicos. */
export function QuitarDeEstados({ radicado, enRama }: { radicado: string; enRama: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn secondary small"
      disabled={pending}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const aviso = enRama
          ? "¿Quitar este radicado de Publicaciones Procesales? El proceso sigue en tu lista de la Rama; solo dejamos de buscarlo en los estados."
          : "¿Quitar este radicado? Dejamos de buscarlo en los estados del juzgado y se borra lo encontrado.";
        if (!confirm(aviso)) return;
        start(async () => {
          const r = await quitarDeEstadosAction(radicado);
          if (r.error) alert(r.error);
        });
      }}
    >
      {pending ? "Quitando…" : "Quitar de estados"}
    </button>
  );
}
