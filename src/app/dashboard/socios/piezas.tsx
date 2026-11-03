"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  borrarMovimientoAction,
  confirmarMovimientoAction,
  movimientoManualAction,
} from "@/app/actions";

type Socio = { id: string; nombre: string };
const TIPOS = [
  ["gasto", "Gasto pagado por el socio"],
  ["aporte", "Aporte de dinero a Estradox"],
  ["ingreso", "Ingreso (fuera de Bold)"],
] as const;
const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });

/** Subir comprobantes (PDF o fotos); la IA los lee y quedan "por revisar". */
export function SubirComprobantes({ socios, esRoot, yo }: { socios: Socio[]; esRoot: boolean; yo: string }) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviando(true);
    setMsg({});
    try {
      const r = await fetch("/api/socios/comprobante", { method: "POST", body: new FormData(e.currentTarget) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setMsg({ error: j.error ?? "No se pudo subir." });
      else {
        setMsg({ ok: `Subido(s) ${j.ids?.length ?? 1}. La IA los está leyendo; en unos segundos aparecen para revisar.` });
        ref.current?.reset();
        router.refresh();
      }
    } catch {
      setMsg({ error: "No se pudo subir. Revisa tu conexión." });
    }
    setEnviando(false);
  }

  return (
    <form ref={ref} onSubmit={enviar}>
      <label className="small muted" htmlFor="archivo">Comprobantes (PDF o fotos, hasta 10 MB c/u)</label>
      <input id="archivo" name="archivo" type="file" accept="application/pdf,image/*" multiple required />
      <div className="row wrap" style={{ gap: 10, marginTop: 10 }}>
        {esRoot && (
          <div style={{ minWidth: 180 }}>
            <label className="small muted" htmlFor="socioId">Lo pagó</label>
            <select id="socioId" name="socioId" defaultValue={yo}>
              {socios.map((s) => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </select>
          </div>
        )}
        <div style={{ flex: 1, minWidth: 200 }}>
          <label className="small muted" htmlFor="nota">Nota (opcional)</label>
          <input id="nota" name="nota" placeholder="Ej. dominio estradox.com 1 año" />
        </div>
      </div>
      <button className="btn" type="submit" disabled={enviando} style={{ marginTop: 12 }}>
        {enviando ? "Subiendo…" : "Subir y leer con IA"}
      </button>
      {msg.ok && <div className="ok">{msg.ok}</div>}
      {msg.error && <div className="error">{msg.error}</div>}
    </form>
  );
}

/** Mientras haya comprobantes "leyendo", la página se refresca sola. */
export function RefrescoMientrasLee({ activo }: { activo: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!activo) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [activo, router]);
  return null;
}

type Datos = {
  id?: number;
  tipo: string;
  fecha: string;
  monto: number | null;
  concepto: string;
  proveedor: string;
  medio: string;
  socioId: string;
};

/** Formulario de un movimiento: confirmar lo que leyó la IA, o agregar uno a mano. */
export function FormMovimiento({
  datos,
  socios,
  esRoot,
  boton,
}: {
  datos: Datos;
  socios: Socio[];
  esRoot: boolean;
  boton: string;
}) {
  const [state, action, pending] = useActionState(
    datos.id ? confirmarMovimientoAction : movimientoManualAction,
    {},
  );
  return (
    <form action={action} className="small" style={{ marginTop: 8 }}>
      {datos.id && <input type="hidden" name="id" value={datos.id} />}
      <div className="row wrap" style={{ gap: 8 }}>
        <div style={{ minWidth: 150, flex: 1 }}>
          <label className="muted">Tipo</label>
          <select name="tipo" defaultValue={datos.tipo}>
            {TIPOS.map(([v, t]) => (
              <option key={v} value={v}>{t}</option>
            ))}
          </select>
        </div>
        <div style={{ minWidth: 130 }}>
          <label className="muted">Fecha</label>
          <input name="fecha" type="date" required defaultValue={datos.fecha || hoy()} />
        </div>
        <div style={{ minWidth: 130 }}>
          <label className="muted">Valor (COP)</label>
          <input name="monto" inputMode="numeric" required defaultValue={datos.monto ?? ""} placeholder="120000" />
        </div>
        {esRoot && (
          <div style={{ minWidth: 150 }}>
            <label className="muted">Socio</label>
            <select name="socioId" defaultValue={datos.socioId}>
              {socios.map((s) => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="row wrap" style={{ gap: 8, marginTop: 6 }}>
        <div style={{ flex: 2, minWidth: 180 }}>
          <label className="muted">Concepto</label>
          <input name="concepto" required defaultValue={datos.concepto} placeholder="Hosting Hostinger" />
        </div>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label className="muted">A quién se pagó</label>
          <input name="proveedor" defaultValue={datos.proveedor} />
        </div>
        <div style={{ minWidth: 120 }}>
          <label className="muted">Medio</label>
          <input name="medio" defaultValue={datos.medio} placeholder="Transferencia" />
        </div>
      </div>
      <button className="btn small" type="submit" disabled={pending} style={{ marginTop: 8 }}>
        {pending ? "Guardando…" : boton}
      </button>
      {state.error && <div className="error">{state.error}</div>}
      {state.ok && <div className="ok">{state.ok}</div>}
    </form>
  );
}

export function BorrarMovimiento({ id }: { id: number }) {
  const [pending, start] = useTransition();
  return (
    <button
      className="btn secondary small"
      disabled={pending}
      onClick={() => {
        if (!confirm("¿Borrar este movimiento? (El archivo en Drive se conserva.)")) return;
        start(async () => {
          const r = await borrarMovimientoAction(id);
          if (r.error) alert(r.error);
        });
      }}
    >
      {pending ? "Borrando…" : "Borrar"}
    </button>
  );
}
