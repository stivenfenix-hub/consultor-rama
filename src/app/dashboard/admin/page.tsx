import Link from "next/link";
import { getAdminStats } from "@/lib/admin";
import { StatTile } from "@/components/charts";

export default async function AdminDashboard() {
  const s = await getAdminStats();

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

      <section className="card">
        <h2>Accesos rápidos</h2>
        <div className="row wrap" style={{ gap: 10, marginTop: 8 }}>
          <Link href="/dashboard/admin/usuarios" className="btn secondary">
            👥 Ver usuarios
          </Link>
          <Link href="/dashboard/admin/apariencia" className="btn secondary">
            🎨 Apariencia del sitio
          </Link>
        </div>
      </section>
    </div>
  );
}
