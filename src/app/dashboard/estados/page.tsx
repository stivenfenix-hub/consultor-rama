import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Icon } from "@/components/icon";
import { estadosActivo, hallazgosDelUsuario, marcarHallazgosVistos, vigiladosDelUsuario } from "@/lib/estados";

const TZ = "America/Bogota";
const fecha = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString("es-CO", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }) : "—";
const hora = (d: Date | null | undefined) =>
  d ? new Date(d).toLocaleString("es-CO", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" }) : "aún no";
const corto = (r: string) => `${r.slice(12, 16)}-${r.slice(16, 21)}`;

/** Estados electrónicos: en qué publicaciones de los juzgados salieron sus radicados. */
export default async function EstadosPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await estadosActivo(user.id))) redirect("/dashboard/procesos");

  const [hallazgos, vigilados, casos] = await Promise.all([
    hallazgosDelUsuario(user.id),
    vigiladosDelUsuario(user.id),
    prisma.case.findMany({ where: { userId: user.id }, select: { id: true, radicado: true } }),
  ]);
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
        <h2>Dónde salieron tus procesos ({hallazgos.length})</h2>
        {hallazgos.length === 0 ? (
          <p className="muted small">
            Todavía no encontramos tus radicados en los estados de los últimos 30 días. Revisamos cada juzgado
            varias veces al día y te avisamos apenas aparezcan.
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
              {h.url && (
                <a href={h.url} target="_blank" rel="noopener noreferrer" className="small" style={{ display: "inline-block", marginTop: 6 }}>
                  <Icon name="download" size={14} /> {h.archivo ?? "Ver publicación"}
                </a>
              )}
            </div>
          ))
        )}
      </div>

      <div className="card">
        <h2>Radicados vigilados ({vigilados.length})</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Buscamos cada radicado como lo escriben los juzgados (completo o año-número, p. ej. 2026-00894).
        </p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Radicado</th>
                <th>Juzgado (código)</th>
                <th>Última revisión</th>
              </tr>
            </thead>
            <tbody>
              {vigilados.map((v) => (
                <tr key={v.radicado}>
                  <td className="radicado">
                    {v.radicado} <span className="muted small">({corto(v.radicado)})</span>
                  </td>
                  <td className="muted">{v.despacho}</td>
                  <td className="small">
                    {hora(v.revisadoAt)}
                    {v.ultimoError && <div className="muted">El portal no respondió; lo reintentamos.</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
