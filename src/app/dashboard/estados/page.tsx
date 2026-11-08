import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { EstadoBotones } from "@/components/estado-botones";
import {
  estadosActivo,
  hallazgosDelUsuario,
  marcarHallazgosVistos,
  totalHallazgos,
  vigiladosDelUsuario,
} from "@/lib/estados";
import { Paginador, POR_PAGINA, paginaDe } from "@/components/paginador";
import { QuitarDeEstados } from "./quitar-estado";

const TZ = "America/Bogota";
const fecha = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString("es-CO", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }) : "—";
const hora = (d: Date | null | undefined) =>
  d ? new Date(d).toLocaleString("es-CO", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" }) : "aún no";
const corto = (r: string) => `${r.slice(12, 16)}-${r.slice(16, 21)}`;

/** Estados electrónicos: en qué publicaciones de los juzgados salieron sus radicados. */
export default async function EstadosPage({
  searchParams,
}: {
  /** p: página de "Dónde salieron"; pv: página de "Radicados vigilados" (de a 20). */
  searchParams: Promise<{ p?: string; pv?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await estadosActivo(user.id))) redirect("/dashboard/procesos");
  const sp = await searchParams;

  const total = await totalHallazgos(user.id);
  const pagH = paginaDe(sp.p, total);
  const [hallazgos, todosVigilados, casos] = await Promise.all([
    hallazgosDelUsuario(user.id, POR_PAGINA, pagH.desde),
    vigiladosDelUsuario(user.id),
    prisma.case.findMany({ where: { userId: user.id }, select: { id: true, radicado: true } }),
  ]);
  const pagV = paginaDe(sp.pv, todosVigilados.length);
  const vigilados = todosVigilados.slice(pagV.desde, pagV.desde + POR_PAGINA);
  const href = (p: number, pv: number) => {
    const s = new URLSearchParams();
    if (p > 1) s.set("p", String(p));
    if (pv > 1) s.set("pv", String(pv));
    const t = s.toString();
    return `/dashboard/estados${t ? `?${t}` : ""}`;
  };
  await marcarHallazgosVistos(user.id);
  const casoDe = new Map(casos.map((c) => [c.radicado, c.id]));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Estados electrónicos</h1>
          <p className="muted small" style={{ margin: 0 }}>
            Revisamos las publicaciones de los juzgados de tus radicados (Publicaciones Procesales de la Rama
            Judicial) y te mostramos dónde aparecen, aunque el proceso no esté en la Consulta Nacional.
          </p>
        </div>
      </div>

      <div className="card">
        <h2>Dónde salieron tus procesos ({total})</h2>
        {hallazgos.length === 0 ? (
          <p className="muted small">
            Todavía no encontramos tus radicados en los estados revisados. Cada noche revisamos el último estado
            que publica cada juzgado y te avisamos apenas aparezcan.
          </p>
        ) : (
          hallazgos.map((h) => (
            <div key={h.id} className="case" style={{ cursor: "default" }}>
              <div className="row wrap">
                {casoDe.has(h.radicado) ? (
                  <Link href={`/dashboard/procesos/${casoDe.get(h.radicado)}`} className="radicado">
                    {h.radicado}
                  </Link>
                ) : (
                  <span className="radicado">{h.radicado}</span>
                )}
                {!h.visto && <span className="badge new">nuevo</span>}
                <div className="spacer" />
                <span className="muted small">{fecha(h.fecha)}</span>
              </div>
              <div style={{ marginTop: 6 }}>
                <b>{h.titulo}</b>
              </div>
              {h.extracto && (
                <div className="muted small" style={{ marginTop: 4 }}>
                  …{h.extracto}…
                </div>
              )}
              <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
                <EstadoBotones hallazgoId={h.id} archivo={h.archivo} url={h.url} />
              </div>
            </div>
          ))
        )}
        <Paginador pagina={pagH.pagina} paginas={pagH.paginas} hrefDe={(p) => href(p, pagV.pagina)} />
      </div>

      <div className="card">
        <h2>Radicados vigilados ({todosVigilados.length})</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Buscamos cada radicado como lo escriben los juzgados (completo o año-número, p. ej. 2026-00894). Si ya
          no quieres seguir uno, quítalo; si lo vuelves a agregar en Procesos, se vigila otra vez.
        </p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Radicado</th>
                <th>Juzgado</th>
                <th>Última revisión</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {vigilados.map((v) => (
                <tr key={v.radicado}>
                  <td className="radicado">
                    {v.radicado} <span className="muted small">({corto(v.radicado)})</span>
                  </td>
                  <td className="muted">{v.juzgado ?? v.despacho}</td>
                  <td className="small">
                    {hora(v.revisadoAt)}
                  </td>
                  <td>
                    <QuitarDeEstados radicado={v.radicado} enRama={casoDe.has(v.radicado)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Paginador pagina={pagV.pagina} paginas={pagV.paginas} hrefDe={(pv) => href(pagH.pagina, pv)} />
      </div>
    </div>
  );
}
