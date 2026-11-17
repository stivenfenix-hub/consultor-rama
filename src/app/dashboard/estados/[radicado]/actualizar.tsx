"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { actualizarEstadoRadicadoAction } from "./actions";

/**
 * "Actualizar" de un radicado que solo está en estados: pide la revisión del
 * juzgado y la página se vuelve a consultar sola hasta que termine.
 */
export function ActualizarEstado({
  radicado,
  revisadoAt,
  pendienteDesde,
}: {
  radicado: string;
  revisadoAt: string | null;
  /** Ya hay una revisión pedida y sin terminar (al recargar la página). */
  pendienteDesde: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [buscando, setBuscando] = useState<number | null>(pendienteDesde ? new Date(pendienteDesde).getTime() : null);
  const [msg, setMsg] = useState<string | null>(null);

  // Mientras busca, revisa la página cada 15 s (hasta 10 minutos).
  useEffect(() => {
    if (!buscando) return;
    if (revisadoAt && new Date(revisadoAt).getTime() >= buscando - 1000) {
      setBuscando(null);
      setMsg("✓ Listo: revisamos los estados del juzgado.");
      return;
    }
    if (Date.now() - buscando > 10 * 60_000) {
      setBuscando(null);
      setMsg("Sigue en cola: en unos momentos te notificamos si sale algo nuevo.");
      return;
    }
    const t = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(t);
  }, [buscando, revisadoAt, router]);

  return (
    <div className="estado-actualizar">
      <button
        type="button"
        className="btn secondary"
        disabled={pending || !!buscando}
        onClick={() =>
          start(async () => {
            setMsg(null);
            const r = await actualizarEstadoRadicadoAction(radicado);
            if (r.error) return setMsg(r.error);
            if (r.reciente) {
              setMsg("✓ Listo: el juzgado se revisó hace pocos minutos; ya tienes lo más reciente.");
              router.refresh();
              return;
            }
            setBuscando(Date.now());
          })
        }
      >
        <Icon name="refresh" size={16} /> {pending ? "Pidiendo…" : buscando ? "Buscando…" : "Actualizar"}
      </button>
      {buscando && (
        <div className="small" role="status">
          <div className="firma-lector-barra indeterminada" aria-hidden style={{ margin: "8px 0 4px" }}>
            <div />
          </div>
          Buscando en los estados electrónicos del juzgado… Puede tardar unos minutos; puedes salir de esta página y te
          notificamos si hay algo nuevo.
        </div>
      )}
      {msg && <div className="small" style={{ marginTop: 6 }}>{msg}</div>}
    </div>
  );
}
