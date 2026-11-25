"use client";

import { useTransition } from "react";
import { extenderPruebaAction, regalarDiasAction, terminarAccesoAction } from "@/app/actions";

/** +15 días de prueba gratis (sigue en prueba, no cuenta como pago). */
export function ExtendTrialButton({ userId, nombre }: { userId: string; nombre?: string | null }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      className="btn secondary small"
      disabled={pending}
      title="Suma 15 días a la prueba gratis (desde hoy si ya venció)"
      onClick={() => {
        if (!confirm(`¿Extender 15 días la prueba gratis${nombre ? ` de ${nombre}` : ""}?`)) return;
        startTransition(() => extenderPruebaAction(userId));
      }}
    >
      {pending ? "…" : "+15 días prueba"}
    </button>
  );
}

export function GiftDaysButton({ userId }: { userId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      className="btn secondary small"
      disabled={pending}
      onClick={() => {
        if (!confirm("¿Regalar 30 días de acceso a este usuario?")) return;
        startTransition(() => regalarDiasAction(userId, 30));
      }}
    >
      {pending ? "…" : "+30 días"}
    </button>
  );
}

export function EndAccessButton({ userId }: { userId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      className="btn danger small"
      disabled={pending}
      onClick={() => {
        if (!confirm("¿Terminar el acceso de este usuario ahora? Solo podrá ver la página de pago.")) return;
        startTransition(() => terminarAccesoAction(userId));
      }}
    >
      {pending ? "…" : "Terminar acceso"}
    </button>
  );
}
