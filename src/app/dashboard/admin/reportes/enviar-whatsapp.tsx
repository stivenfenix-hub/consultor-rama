"use client";

import { useState, useTransition } from "react";
import { enviarSinProcesosWaAction } from "@/app/actions";

/** Envía la lista del día por WhatsApp. Pide un segundo clic antes de enviar. */
export function EnviarWhatsapp({ fecha, n }: { fecha: string; n: number }) {
  const [confirmando, setConfirmando] = useState(false);
  const [resultado, setResultado] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();

  if (resultado) {
    return <span className={`small ${resultado.error ? "error" : "ok"}`}>{resultado.error ?? resultado.ok}</span>;
  }
  return (
    <button
      type="button"
      className={`btn small ${confirmando ? "" : "secondary"}`}
      disabled={pending}
      onClick={() => {
        if (!confirmando) {
          setConfirmando(true);
          return;
        }
        start(async () => setResultado(await enviarSinProcesosWaAction(fecha)));
      }}
    >
      {pending ? "Enviando…" : confirmando ? `Confirmar envío a ${n}` : "Enviar por WhatsApp"}
    </button>
  );
}
