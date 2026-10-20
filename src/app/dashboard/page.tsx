import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getDashboardStats } from "@/lib/dashboard";
import { Donut, StatTile, BucketBar } from "@/components/charts";
import { RefreshAllButton } from "./refresh-all-button";

function fmt(d: Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-CO", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "America/Bogota",
  });
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const stats = await getDashboardStats(user.id);

  const recientes = await prisma.case.findMany({
    where: { userId: user.id },
    orderBy: { lastActuacionDate: "desc" },
    take: 8,
    include: {
      actuaciones: { orderBy: { fechaActuacion: "desc" }, take: 1 },
    },
  });

  return (
    <div className="page">
      <div className="page-head wrap">
        <h1>Dashboard</h1>
        <div className="row" style={{ gap: 10 }}>
          <RefreshAllButton />
          <Link href="/dashboard/procesos" className="btn">
            + Agregar proceso
          </Link>
        </div>
      </div>

      {/* Tarjetas de resumen */}
      <section className="stat-grid">
        <StatTile label="Procesos activos" value={stats.totalProcesos} />
        <StatTile
          label="Actuaciones este mes"
          value={stats.actuacionesEsteMes}
          accent="var(--accent)"
        />
        <StatTile label="Procesos nuevos este mes" value={stats.nuevosEsteMes} />
        <StatTile
          label="Actuaciones sin ver"
          value={stats.sinVer}
          accent={stats.sinVer > 0 ? "var(--green)" : undefined}
        />
      </section>

      {/* Antigüedad de la última actuación */}
      <section className="card">
        <h2>Antigüedad de la última actuación</h2>
        <p className="muted small" style={{ marginTop: -6 }}>
          Procesos por tiempo desde su última actuación
        </p>
        <BucketBar
          items={[
            { label: "0–6 meses", value: stats.buckets.b0_6, color: "var(--green)" },
            { label: "6–12 meses", value: stats.buckets.b6_12, color: "var(--amber)" },
            { label: "Más de 12 meses", value: stats.buckets.b12, color: "var(--red)" },
            { label: "Sin actuación", value: stats.buckets.sin, color: "var(--muted)" },
          ]}
        />
      </section>

      {/* Gráficos */}
      <section className="chart-grid">
        <div className="card">
          <h2>Procesos por clase</h2>
          <Donut data={stats.porClase} />
        </div>
        <div className="card">
          <h2>Procesos por departamento</h2>
          <Donut data={stats.porDepartamento} />
        </div>
      </section>

      {/* Tabla de recientes */}
      <section className="card">
        <div className="row">
          <h2 style={{ margin: 0 }}>Procesos con actuación reciente</h2>
          <div className="spacer" />
          <Link href="/dashboard/procesos" className="small">
            Ver todos
          </Link>
        </div>
        {recientes.length === 0 ? (
          <p className="muted small" style={{ marginTop: 12 }}>
            Aún no sigues procesos.{" "}
            <Link href="/dashboard/procesos">Agrega el primero</Link>.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Radicado</th>
                  <th>Fecha última actuación</th>
                  <th>Última actuación</th>
                </tr>
              </thead>
              <tbody>
                {recientes.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link
                        href={`/dashboard/procesos/${c.id}`}
                        className="radicado"
                      >
                        {c.radicado}
                      </Link>
                    </td>
                    <td className="muted">{fmt(c.lastActuacionDate)}</td>
                    <td>{c.actuaciones[0]?.actuacion ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
