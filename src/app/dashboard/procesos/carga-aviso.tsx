"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cerrarCargaAction } from "@/app/actions";
import { Icon } from "@/components/icon";
import { separarEstados, separarSegundoPlano, textoSegundoPlano } from "@/lib/textos-estados";

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
            <b>Terminando de cargar en segundo plano</b>
            <div className="small muted">{textoSegundoPlano(reintentos.map((r) => r.radicado))}</div>
          </div>
        </div>
      )}
      {cargas.map((c) => {
        if (c.estado === "cargando") {
          return (
            <div key={c.id} className="carga-aviso cargando">
              <div className="carga-spin" aria-hidden />
              <div style={{ flex: 1 }}>
                <b>Cargando tus procesos…</b>
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
        // Las fallas de la Rama NUNCA se muestran: esos radicados se siguen
        // cargando solos y se le notifica. Solo se muestra como error lo del
        // abogado (radicados sin 23 dígitos).
        const { radicados: noExisten, resto: sinEstados } = separarEstados(c.error);
        const { radicados: enProceso, resto } = separarSegundoPlano(sinEstados);

        const clase = c.ok ? "listo" : resto ? "falla" : enProceso.length ? "cargando" : estados ? "estados" : "falla";
        const titulo = c.ok
          ? "¡Tus procesos ya están cargados! Ya puedes revisarlos."
          : resto
            ? "Revisa estos radicados"
            : enProceso.length
              ? "Estamos terminando de cargar tus procesos"
              : estados
                ? "Lo vigilamos con Estados electrónicos (Publicaciones Procesales)"
                : "No encontramos este radicado en la Rama Judicial";

        return (
          <div key={c.id} className={`carga-aviso ${clase}`}>
            <Icon name={c.ok ? "check" : clase === "estados" || clase === "cargando" ? "bell" : "alert"} size={22} />
            <div style={{ flex: 1 }}>
              <b>{titulo}</b>
              {c.ok && <div className="small">{c.ok}</div>}
              {enProceso.length > 0 && (
                <div className="small" style={{ marginTop: 6 }}>
                  ⏳ {textoSegundoPlano(enProceso)}
                </div>
              )}
              {resto && (
                <div className="small error" style={{ margin: "6px 0 0" }}>
                  {resto}
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
                      vigilamos con <b>Estados electrónicos (Publicaciones Procesales)</b>, el portal donde los juzgados publican sus estados
                      (aunque el proceso no esté en la Consulta o sea privado), con la tecnología de IA de Estradox:
                      cada noche revisamos el último estado del juzgado, extraemos la información y te avisamos cuando{" "}
                      {noExisten.length === 1 ? "aparezca" : "aparezcan"}. {noExisten.length === 1 ? "Lo" : "Los"} ves
                      en <b>&quot;En Estados electrónicos (Publicaciones Procesales)&quot;</b>, más abajo.
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
