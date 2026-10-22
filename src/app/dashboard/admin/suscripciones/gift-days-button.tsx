"use client";

import { useTransition } from "react";
import { regalarDiasAction } from "@/app/actions";

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
