"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cerrarCargaAction } from "@/app/actions";
import { Icon } from "@/components/icon";
import { separarEstados } from "@/lib/textos-estados";

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
  /** El abogado tiene estados electrónicos activo. */
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
        const { radicados: noExisten, resto } = separarEstados(c.error);
        const fallaRama = /no respondi|interrumpi/i.test(resto);

        const clase = c.ok ? "listo" : resto ? "falla" : estados ? "estados" : "falla";
        const titulo = c.ok
          ? "¡Tus procesos ya están cargados! Ya puedes revisarlos."
          : resto
            ? "La Rama Judicial no respondió todavía"
            : estados
              ? "Lo vigilamos con Estados electrónicos"
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
                      {noExisten.length === 1 ? "no está" : "no están"} en la Consulta Nacional porque el juzgado
                      no sube sus actuaciones a la Rama Judicial. No te preocupes: {noExisten.length === 1 ? "lo" : "los"}{" "}
                      vigilamos con <b>Estados electrónicos</b>, la nueva tecnología de Estradox: cada noche revisamos
                      las publicaciones públicas del juzgado, extraemos la información y te avisamos cuando{" "}
                      {noExisten.length === 1 ? "aparezca" : "aparezcan"}. {noExisten.length === 1 ? "Lo" : "Los"} ves
                      en <b>&quot;En estados electrónicos&quot;</b>, más abajo.
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
