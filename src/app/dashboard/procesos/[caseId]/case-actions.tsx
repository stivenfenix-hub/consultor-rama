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
}: {
  caseId: string;
  hasUnseen: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [accion, setAccion] = useState<string>("");
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
        disabled={pending}
        onClick={() => run("refresh", () => refrescarProcesoAction(caseId))}
      >
        {pending && accion === "refresh" ? "Actualizando…" : <><Icon name="refresh" /> Actualizar</>}
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
          if (!confirm("¿Eliminar este proceso de tu seguimiento?")) return;
          run("del", async () => {
            await eliminarProcesoAction(caseId);
            router.push("/dashboard/procesos");
          });
        }}
      >
        Eliminar
      </button>
    </div>
  );
}
