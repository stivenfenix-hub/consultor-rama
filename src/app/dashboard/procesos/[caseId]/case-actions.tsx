"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/icon";
import { esMensajeRama } from "@/lib/aviso-rama";
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
  esperaHasta = null,
}: {
  caseId: string;
  hasUnseen: boolean;
  /** Ya se actualizó manualmente hoy (límite: una vez por día). */
  actualizadoHoy: boolean;
  /** Límite general: no puede usar "Actualizar" en ningún radicado hasta esta hora (ISO). */
  esperaHasta?: string | null;
}) {
  const horaEspera = esperaHasta
    ? new Date(esperaHasta).toLocaleTimeString("es-CO", { timeZone: "America/Bogota", hour: "numeric", minute: "2-digit" })
    : null;
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
        disabled={pending || actualizadoHoy || !!horaEspera}
        title={
          horaEspera
            ? `Puedes usar «Actualizar» una vez cada 3 horas. Disponible a las ${horaEspera}.`
            : actualizadoHoy
            ? "Puedes actualizar cada proceso una vez por día. Disponible mañana."
            : "Consulta la Rama y los estados electrónicos del juzgado (una vez por día)"
        }
        onClick={() =>
          run("refresh", async () => {
            setMsg({});
            setMsg(await refrescarProcesoAction(caseId));
          })
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
          if (!confirm("¿Eliminar este proceso de tu seguimiento? Se eliminan todos sus registros de la Rama (SIUGJ, Justicia XXI…) y deja de vigilarse en Estados electrónicos (Publicaciones Procesales).")) return;
          run("del", async () => {
            await eliminarProcesoAction(caseId);
            router.push("/dashboard/procesos");
          });
        }}
      >
        Eliminar
      </button>
      {msg.ok && (
        <span className="ok small" role="status" style={{ flexBasis: "100%", maxWidth: 520 }}>
          ✓ {msg.ok}
        </span>
      )}
      {msg.error &&
        (esMensajeRama(msg.error) ? (
          <span className="aviso-rama small">ℹ️ {msg.error}</span>
        ) : (
          <span className="error small">{msg.error}</span>
        ))}
      {actualizadoHoy && !msg.ok && !msg.error && (
        <span className="muted small">Disponible de nuevo mañana</span>
      )}
      {!actualizadoHoy && horaEspera && !msg.ok && !msg.error && (
        <span className="muted small">Podrás actualizar de nuevo a las {horaEspera}</span>
      )}
    </div>
  );
}
