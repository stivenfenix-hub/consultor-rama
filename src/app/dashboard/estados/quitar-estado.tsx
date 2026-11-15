"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { quitarDeEstadosAction } from "@/app/actions";

/** Botón para dejar de vigilar un radicado en estados electrónicos. */
export function QuitarDeEstados({
  radicado,
  enRama,
  volverA,
}: {
  radicado: string;
  enRama: boolean;
  /** A dónde ir después de quitarlo (p. ej. desde su propia página). */
  volverA?: string;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      className="btn secondary small"
      disabled={pending}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const aviso = enRama
          ? "¿Quitar este radicado de Estados electrónicos (Publicaciones Procesales)? El proceso sigue en tu lista de la Rama; solo dejamos de buscarlo en los estados."
          : "¿Quitar este radicado? Dejamos de buscarlo en los estados del juzgado y se borra lo encontrado.";
        if (!confirm(aviso)) return;
        start(async () => {
          const r = await quitarDeEstadosAction(radicado);
          if (r.error) alert(r.error);
          else if (volverA) router.push(volverA);
        });
      }}
    >
      {pending ? "Quitando…" : "Quitar de estados"}
    </button>
  );
}
