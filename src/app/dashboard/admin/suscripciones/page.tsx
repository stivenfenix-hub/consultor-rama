import { listUsers } from "@/lib/admin";
import { StatTile } from "@/components/charts";
import {
  boldConfigurado,
  eventosBold,
  getPlan,
  suscripcionesDeTodos,
  totalPagosAprobados,
} from "@/lib/subscription";
import { PlanForm } from "./plan-form";
import { EndAccessButton, GiftDaysButton } from "./gift-days-button";

const fecha = (d: Date | null) =>
  d
    ? new Date(d).toLocaleDateString("es-CO", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "America/Bogota",
      })
    : "—";

const ETIQUETA = {
  admin: <span className="badge new">admin</span>,
  prueba: <span className="badge">prueba</span>,
  activa: <span className="badge" style={{ color: "var(--green)" }}>activa</span>,
  vencida: <span className="badge" style={{ color: "var(--amber)" }}>vencida</span>,
};

export default async function SuscripcionesAdmin() {
  const [users, subs, plan, pagos, eventos] = await Promise.all([
    listUsers(),
    suscripcionesDeTodos(),
    getPlan(),
    totalPagosAprobados(),
    eventosBold(),
  ]);
  const cuenta = (e: string) => users.filter((u) => subs.get(u.id)?.estado === e).length;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Suscripciones</h1>
      </div>

      {!boldConfigurado() && (
        <div className="error" style={{ marginBottom: 12 }}>
          Falta configurar BOLD_API_KEY y BOLD_SECRET_KEY en las variables de entorno: los
          usuarios aún no pueden pagar.
        </div>
      )}

      <section className="stat-grid">
        <StatTile label="En prueba" value={cuenta("prueba")} />
        <StatTile label="Pagando" value={cuenta("activa")} accent="var(--green)" />
        <StatTile label="Vencidas" value={cuenta("vencida")} />
        <StatTile
          label={`Pagos aprobados ($${pagos.total.toLocaleString("es-CO")})`}
          value={pagos.pagos}
        />
      </section>

      <div className="card" style={{ maxWidth: 720 }}>
        <h2>Precios de los paquetes</h2>
        <PlanForm paquetes={plan.paquetes} diasPrueba={plan.diasPrueba} />
      </div>

      <div className="card">
        <h2>Usuarios</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Correo</th>
                <th>Estado</th>
                <th>Acceso hasta</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const s = subs.get(u.id);
                return (
                  <tr key={u.id}>
                    <td>{u.name ?? "—"}</td>
                    <td className="muted">{u.email}</td>
                    <td>{s ? ETIQUETA[s.estado] : "—"}</td>
                    <td className="muted">
                      {s?.estado === "admin" ? "—" : fecha(s?.accesoHasta ?? null)}
                    </td>
                    <td>
                      {u.role !== "admin" && (
                        <div className="row" style={{ gap: 6 }}>
                          <GiftDaysButton userId={u.id} />
                          {s?.estado !== "vencida" && <EndAccessButton userId={u.id} />}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Últimos eventos de Bold</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Webhooks recibidos y consultas al API de Bold (para revisar pagos).
        </p>
        {eventos.length === 0 ? (
          <p className="muted small">Aún no hay eventos.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {eventos.map((e) => (
                  <tr key={e.id}>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>
                      {new Date(e.createdAt).toLocaleString("es-CO", { timeZone: "America/Bogota" })}
                    </td>
                    <td>{e.tipo}</td>
                    <td className="small" style={{ wordBreak: "break-all", maxWidth: 520 }}>
                      {e.detalle}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
