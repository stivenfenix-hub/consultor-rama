import { listUsers } from "@/lib/admin";
import { StatTile } from "@/components/charts";
import {
  boldConfigurado,
  getPlan,
  suscripcionesDeTodos,
  totalPagosAprobados,
} from "@/lib/subscription";
import { PlanForm } from "./plan-form";
import { GiftDaysButton } from "./gift-days-button";

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
  const [users, subs, plan, pagos] = await Promise.all([
    listUsers(),
    suscripcionesDeTodos(),
    getPlan(),
    totalPagosAprobados(),
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

      <div className="card" style={{ maxWidth: 520 }}>
        <h2>Plan</h2>
        <PlanForm precio={plan.precio} diasPrueba={plan.diasPrueba} />
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
                <th>Regalar días</th>
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
                    <td>{u.role !== "admin" && <GiftDaysButton userId={u.id} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
