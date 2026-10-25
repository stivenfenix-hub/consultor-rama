"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ejecutarColaAction } from "@/app/actions";
import { Icon } from "@/components/icon";

/** Lanza una corrida de la cola (unos 4 minutos, en segundo plano). */
export function RunSyncButton() {
  const [pending, start] = useTransition();
  const [lanzada, setLanzada] = useState(false);
  const router = useRouter();
  return (
    <div className="row wrap" style={{ gap: 10, alignItems: "center", marginTop: 10 }}>
      <button
        className="btn secondary"
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await ejecutarColaAction();
            setLanzada(true);
          })
        }
      >
        <Icon name="refresh" /> {pending ? "Lanzando…" : "Ejecutar corrida ahora"}
      </button>
      {lanzada && (
        <span className="muted small">
          Corriendo en segundo plano (unos 4 minutos).{" "}
          <button className="btn secondary" type="button" onClick={() => router.refresh()}>
            Ver avance
          </button>
        </span>
      )}
    </div>
  );
}
