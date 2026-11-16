"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { eliminarBorradorAction, recordarAction } from "./actions";

/** Refresca la página cada pocos segundos mientras haya firmas pendientes (trazabilidad en vivo). */
export function EnVivo({ cada = 8 }: { cada?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, cada * 1000);
    return () => clearInterval(t);
  }, [router, cada]);
  return (
    <span className="firma-envivo" title="Se actualiza solo">
      <i /> En vivo
    </span>
  );
}

export function Recordar({ id }: { id: string }) {
  const [r, setR] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button
        type="button"
        className="btn secondary small"
        disabled={pending}
        onClick={() => start(async () => setR(await recordarAction(id)))}
      >
        <Icon name="bell" size={14} /> {pending ? "Enviando…" : "Enviar recordatorio"}
      </button>
      {r && <span className={`small ${r.error ? "error" : "ok"}`}>{r.error ?? r.ok}</span>}
    </>
  );
}

export function EliminarBorrador({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn secondary small"
      disabled={pending}
      onClick={() => {
        if (!confirm("¿Eliminar este borrador? No se ha enviado a nadie.")) return;
        start(async () => {
          const r = await eliminarBorradorAction(id);
          if (r.error) alert(r.error);
          else router.push("/dashboard/firmas");
        });
      }}
    >
      {pending ? "Eliminando…" : "Eliminar borrador"}
    </button>
  );
}

/** Copia el enlace personal de un firmante (para enviárselo por otro medio). */
export function CopiarEnlace({ url }: { url: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      className="btn secondary small"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopiado(true);
          setTimeout(() => setCopiado(false), 2000);
        } catch {
          prompt("Copia el enlace:", url);
        }
      }}
    >
      {copiado ? "✓ Copiado" : "Copiar enlace"}
    </button>
  );
}
