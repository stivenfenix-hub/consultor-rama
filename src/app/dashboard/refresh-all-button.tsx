"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { actualizarTodosAction } from "@/app/actions";
import { Icon } from "@/components/icon";

function fmtDisponible(iso: string) {
  return new Date(iso).toLocaleDateString("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Bogota",
  });
}

export function RefreshAllButton({
  enCurso,
  disponibleEn,
}: {
  enCurso: boolean;
  disponibleEn: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const router = useRouter();

  // Mientras corre en segundo plano, refresca la página cada 20 s para ver avances.
  useEffect(() => {
    if (!enCurso) return;
    const t = setInterval(() => router.refresh(), 20_000);
    return () => clearInterval(t);
  }, [enCurso, router]);

  const bloqueado = enCurso || !!disponibleEn;
  const titulo = enCurso
    ? "Tus procesos se están actualizando en segundo plano"
    : disponibleEn
      ? `Puedes actualizar todos una vez por semana. Disponible el ${fmtDisponible(disponibleEn)}.`
      : "Consulta la Rama y actualiza todos tus procesos (una vez por semana)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <button
        className="btn secondary"
        disabled={pending || bloqueado}
        title={titulo}
        onClick={() =>
          startTransition(async () => {
            setMsg(await actualizarTodosAction());
            router.refresh();
          })
        }
      >
        <Icon name="refresh" />
        {enCurso
          ? "Actualizando en segundo plano…"
          : pending
            ? "Iniciando…"
            : "Actualizar todos"}
      </button>
      {!enCurso && disponibleEn && !msg.ok && (
        <span className="muted small">
          Disponible el {fmtDisponible(disponibleEn)}
        </span>
      )}
      {msg.error && <span className="error small">{msg.error}</span>}
      {msg.ok && <span className="ok small">{msg.ok}</span>}
    </div>
  );
}
