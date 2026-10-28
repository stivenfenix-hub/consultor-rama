"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/icon";
import { useRouter } from "next/navigation";
import {
  refrescarProcesoAction,
  marcarVistasAction,
  eliminarProcesoAction,
} from "@/app/actions";

export function CaseActions({
  caseId,
  hasUnseen,
  actualizadoHoy,
}: {
  caseId: string;
  hasUnseen: boolean;
  /** Ya se actualizó manualmente hoy (límite: una vez por día). */
  actualizadoHoy: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [accion, setAccion] = useState<string>("");
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const router = useRouter();

  const run = (nombre: string, fn: () => Promise<unknown>) => {
    setAccion(nombre);
    startTransition(async () => {
      await fn();
      setAccion("");
    });
  };

  return (
    <div className="row wrap">
      <button
        className="btn"
        disabled={pending || actualizadoHoy}
        title={
          actualizadoHoy
            ? "Puedes actualizar cada proceso una vez por día. Disponible mañana."
            : "Consulta la Rama y actualiza este proceso (una vez por día)"
        }
        onClick={() =>
          run("refresh", async () => setMsg(await refrescarProcesoAction(caseId)))
        }
      >
        <Icon name="refresh" />
        {pending && accion === "refresh"
          ? "Actualizando…"
          : actualizadoHoy
            ? "Actualizado hoy"
            : "Actualizar"}
      </button>

      {hasUnseen && (
        <button
          className="btn secondary"
          disabled={pending}
          onClick={() => run("seen", () => marcarVistasAction(caseId))}
        >
          Marcar vistas
        </button>
      )}

      <button
        className="btn danger"
        disabled={pending}
        onClick={() => {
          if (!confirm("¿Eliminar este proceso de tu seguimiento? Se eliminan todos sus registros de la Rama (SIUGJ, Justicia XXI…).")) return;
          run("del", async () => {
            await eliminarProcesoAction(caseId);
            router.push("/dashboard/procesos");
          });
        }}
      >
        Eliminar
      </button>
      {msg.error && <span className="error small">{msg.error}</span>}
      {actualizadoHoy && !msg.ok && !msg.error && (
        <span className="muted small">Disponible de nuevo mañana</span>
      )}
    </div>
  );
}
