"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cerrarCargaAction } from "@/app/actions";
import { Icon } from "@/components/icon";

type Carga = {
  id: number;
  total: number;
  listos: number;
  estado: "cargando" | "listo";
  ok: string | null;
  error: string | null;
};

/**
 * Avance de las cargas en segundo plano. Mientras alguna está cargando, la
 * página se refresca sola cada 4 s; al terminar muestra el resultado.
 */
export function CargaAviso({ cargas }: { cargas: Carga[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const cargando = cargas.some((c) => c.estado === "cargando");

  useEffect(() => {
    if (!cargando) return;
    const t = setInterval(() => router.refresh(), 4_000);
    return () => clearInterval(t);
  }, [cargando, router]);

  return (
    <>
      {cargas.map((c) =>
        c.estado === "cargando" ? (
          <div key={c.id} className="carga-aviso cargando">
            <div className="carga-spin" aria-hidden />
            <div style={{ flex: 1 }}>
              <b>Cargando tus procesos desde la Rama Judicial…</b>
              <div className="small muted">
                {c.listos} de {c.total} listo(s). Puedes seguir usando Estradox: te avisamos al terminar.
              </div>
              <div className="carga-barra">
                <div style={{ width: `${Math.max(6, (c.listos / Math.max(c.total, 1)) * 100)}%` }} />
              </div>
            </div>
          </div>
        ) : (
          <div key={c.id} className={`carga-aviso ${c.ok ? "listo" : "falla"}`}>
            <Icon name={c.ok ? "check" : "alert"} size={22} />
            <div style={{ flex: 1 }}>
              <b>{c.ok ? "¡Tus procesos ya están cargados! Ya puedes revisarlos." : "No pudimos cargar tus procesos"}</b>
              {c.ok && <div className="small">{c.ok}</div>}
              {c.error && <div className="small error" style={{ margin: "4px 0 0" }}>{c.error}</div>}
            </div>
            <button
              className="btn secondary small"
              disabled={pending}
              onClick={() => start(() => cerrarCargaAction(c.id))}
            >
              Entendido
            </button>
          </div>
        ),
      )}
    </>
  );
}
