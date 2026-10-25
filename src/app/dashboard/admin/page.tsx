import Link from "next/link";
import { getAdminStats } from "@/lib/admin";
import { StatTile } from "@/components/charts";
import { Icon } from "@/components/icon";
import { estadoSincronizacion } from "@/lib/sync-queue";
import { RunSyncButton } from "./run-sync-button";

const TZ = "America/Bogota";
const hora = (d: Date | string | null) =>
  d
    ? new Date(d).toLocaleString("es-CO", { timeZone: TZ, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
    : "—";

export default async function AdminDashboard() {
  const [s, sync] = await Promise.all([getAdminStats(), estadoSincronizacion().catch(() => null)]);
  const cola = sync?.ultimaCorrida?.cola as
    | string
    | { revisados: number; actuacionesNuevas: number; consultas: number }
    | undefined;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Panel de administración</h1>
      </div>

      <section className="stat-grid">
        <StatTile label="Usuarios totales" value={s.totalUsuarios} />
        <StatTile
          label="Activos (30 días)"
          value={s.activos30}
          accent="var(--green)"
        />
        <StatTile label="Verificados" value={s.verificados} />
        <StatTile label="Nuevos este mes" value={s.nuevosMes} accent="var(--accent)" />
      </section>

      <section className="stat-grid">
        <StatTile label="Procesos totales" value={s.totalProcesos} />
        <StatTile label="Actuaciones totales" value={s.totalActuaciones} />
        <StatTile label="Administradores" value={s.admins} />
        <StatTile
          label="No verificados"
          value={s.totalUsuarios - s.verificados}
          accent={s.totalUsuarios - s.verificados > 0 ? "var(--amber)" : undefined}
        />
      </section>

      {sync && (
        <section className="card">
          <h2>Sincronización nocturna</h2>
          <p className="muted small" style={{ marginTop: 0 }}>
            Revisa los procesos de 8:00 p.m. a 6:45 a.m. y envía el resumen a las 7:00 a.m.
            Noche actual desde {hora(sync.desde)}.
          </p>
          <div className="stat-grid">
            <StatTile label="Revisados esta noche" value={`${sync.revisados} / ${sync.total}`} accent="var(--green)" />
            <StatTile label="Por revisar ahora" value={sync.pendientes} />
            <StatTile
              label="Con error"
              value={sync.errores + sync.bloqueados}
              accent={sync.errores + sync.bloqueados > 0 ? "var(--amber)" : undefined}
            />
            <StatTile label="Avisos para las 7 a.m." value={sync.avisosPendientes} accent="var(--accent)" />
          </div>
          <p className="small" style={{ marginBottom: 0 }}>
            Última corrida: <b>{hora(sync.ultimaCorridaAt)}</b>
            {typeof cola === "string" && <span className="muted"> · {cola}</span>}
            {typeof cola === "object" && (
              <span className="muted">
                {" "}· {cola.revisados} revisados,{" "}
                {cola.actuacionesNuevas} actuaciones nuevas,{" "}
                {cola.consultas} consultas a la Rama
              </span>
            )}
          </p>
          <RunSyncButton />
          {sync.pausaHasta && (
            <div className="error small">
              La Rama Judicial pidió frenar las consultas. Se reanuda a las {hora(sync.pausaHasta)}.
            </div>
          )}
          {sync.fallidos.length > 0 && (
            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Radicado</th>
                    <th>Intentos</th>
                    <th>Próximo intento</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {sync.fallidos.map((f) => (
                    <tr key={f.radicado}>
                      <td style={{ fontFamily: "monospace" }}>{f.radicado}</td>
                      <td>{f.intentos}</td>
                      <td className="muted">{hora(f.proxima)}</td>
                      <td className="muted small">{f.error ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section className="card">
        <h2>Accesos rápidos</h2>
        <div className="row wrap" style={{ gap: 10, marginTop: 8 }}>
          <Link href="/dashboard/admin/usuarios" className="btn secondary">
            <Icon name="users" /> Ver usuarios
          </Link>
          <Link href="/dashboard/admin/apariencia" className="btn secondary">
            <Icon name="palette" /> Apariencia del sitio
          </Link>
        </div>
      </section>
    </div>
  );
}
