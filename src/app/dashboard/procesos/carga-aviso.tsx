"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cerrarCargaAction } from "@/app/actions";
import { Icon } from "@/components/icon";

type Carga = {
  id: number;
  total: number;
  listos: number;
  estado: "cargando" | "listo";
  ok: string | null;
  error: string | null;
  detalle?: string | null;
};

/**
 * Avance de las cargas en segundo plano. Mientras alguna está cargando, la
 * página se refresca sola cada 4 s; al terminar muestra el resultado.
 */
export function CargaAviso({
  cargas,
  reintentos = [],
  esAdmin = false,
  estados = false,
}: {
  cargas: Carga[];
  reintentos?: { radicado: string; intentos: number }[];
  esAdmin?: boolean;
  /** El abogado está en la prueba de estados electrónicos. */
  estados?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const cargando = cargas.some((c) => c.estado === "cargando");

  useEffect(() => {
    if (!cargando) return;
    const t = setInterval(() => router.refresh(), 4_000);
    return () => clearInterval(t);
  }, [cargando, router]);

  return (
    <>
      {reintentos.length > 0 && (
        <div className="carga-aviso cargando">
          <div className="carga-spin" aria-hidden />
          <div style={{ flex: 1 }}>
            <b>Reintentando automáticamente</b>
            <div className="small muted">
              La Rama Judicial no respondió para{" "}
              {reintentos.map((r) => r.radicado).join(", ")}. Lo seguimos intentando solos y te
              avisamos cuando quede cargado; no tienes que volver a agregarlo.
            </div>
          </div>
        </div>
      )}
      {cargas.map((c) => {
        if (c.estado === "cargando") {
          return (
            <div key={c.id} className="carga-aviso cargando">
              <div className="carga-spin" aria-hidden />
              <div style={{ flex: 1 }}>
                <b>Cargando tus procesos desde la Rama Judicial…</b>
                <div className="small muted">
                  {c.listos} de {c.total} listo(s). Puedes seguir usando Estradox: te avisamos al terminar.
                </div>
                <div className="carga-barra">
                  <div style={{ width: `${Math.max(6, (c.listos / Math.max(c.total, 1)) * 100)}%` }} />
                </div>
              </div>
            </div>
          );
        }

        // Los radicados que la Consulta Nacional no tiene no son una falla: se
        // explican aparte (y a los abogados en prueba se les dice que se buscan en estados).
        const m = c.error?.match(/No existen en la Rama Judicial: ([^.]*)\./);
        const noExisten = m ? m[1].split(/,\s*/).filter(Boolean) : [];
        const resto = (m ? c.error!.replace(m[0], "") : c.error ?? "").trim();
        const fallaRama = /no respondi|interrumpi/i.test(resto);

        const clase = c.ok ? "listo" : resto ? "falla" : estados ? "estados" : "falla";
        const titulo = c.ok
          ? "¡Tus procesos ya están cargados! Ya puedes revisarlos."
          : resto
            ? "La Rama Judicial no respondió todavía"
            : estados
              ? "Lo buscaremos en los estados electrónicos"
              : "No encontramos este radicado en la Rama Judicial";

        return (
          <div key={c.id} className={`carga-aviso ${clase}`}>
            <Icon name={c.ok ? "check" : clase === "estados" ? "bell" : "alert"} size={22} />
            <div style={{ flex: 1 }}>
              <b>{titulo}</b>
              {c.ok && <div className="small">{c.ok}</div>}
              {resto && (
                <div className="small aviso-rama" style={{ margin: "6px 0 0" }}>
                  ℹ️ {resto}
                  {fallaRama && " Es una falla temporal de la plataforma de la Rama, no de Estradox."}
                </div>
              )}
              {noExisten.length > 0 && (
                <div className="small" style={{ marginTop: 6 }}>
                  {estados ? (
                    <>
                      {noExisten.length === 1 ? "El radicado " : "Los radicados "}
                      <b>{noExisten.join(", ")}</b>{" "}
                      {noExisten.length === 1 ? "no aparece" : "no aparecen"} en la Consulta Nacional de la Rama
                      Judicial, pero muchos juzgados solo los publican en sus <b>estados electrónicos</b>. Los
                      revisamos automáticamente: si aparece, te notificamos y lo verás aquí en Procesos.
                    </>
                  ) : (
                    <>
                      La Consulta Nacional de la Rama Judicial no tiene{" "}
                      {noExisten.length === 1 ? "el radicado" : "los radicados"} <b>{noExisten.join(", ")}</b>.
                      Revisa que el número esté bien escrito.
                    </>
                  )}
                </div>
              )}
              {esAdmin && c.detalle && (
                <pre className="small muted" style={{ whiteSpace: "pre-wrap", margin: "6px 0 0" }}>{c.detalle}</pre>
              )}
            </div>
            <button
              className="btn secondary small"
              disabled={pending}
              onClick={() => start(() => cerrarCargaAction(c.id))}
            >
              Entendido
            </button>
          </div>
        );
      })}
    </>
  );
}
