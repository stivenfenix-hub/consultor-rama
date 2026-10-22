"use client";

import { useTransition } from "react";
import { regalarDiasAction, terminarAccesoAction } from "@/app/actions";

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
