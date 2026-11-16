import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getDashboardStats } from "@/lib/dashboard";
import { Donut, StatTile, BucketBar } from "@/components/charts";
import { OpenInChrome } from "./open-in-chrome";
import { estadosActivo, soloEnEstados } from "@/lib/estados";

function fmt(d: Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-CO", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "America/Bogota",
  });
}

// Las fechas de los estados se guardan como día (sin hora).
function fmtUTC(d: Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-CO", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

/** Una fila de "Procesos con actuación reciente": de la Rama o de un estado electrónico. */
type Reciente = {
  radicado: string;
  href: string;
  fecha: string;
  orden: number;
  texto: string;
  deEstado: boolean;
  soloEstados: boolean;
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ verificado?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { verificado } = await searchParams;

  const stats = await getDashboardStats(user.id);

  // Último estado electrónico de cada radicado (también los que no están en la Rama).
  const solo = (await estadosActivo(user.id).catch(() => false)) ? await soloEnEstados(user.id).catch(() => []) : [];
  const estadoDe = new Map(solo.filter((s) => s.ultimo).map((s) => [s.radicado, s.ultimo!] as const));

  // Una fila por radicado: de sus registros (uno por sistema de la Rama) se
  // muestra el de la actuación más reciente.
  const registros = await prisma.case.findMany({
    where: { userId: user.id },
    orderBy: [{ lastActuacionDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: 20,
    include: {
      actuaciones: { orderBy: { fechaActuacion: "desc" }, take: 1 },
    },
  });
  const vistos = new Set<string>();
  const filas: Reciente[] = registros
    .filter((c) => !vistos.has(c.radicado) && !!vistos.add(c.radicado))
    .map((c) => {
      // Si salió en un estado el mismo día o después, ese es en realidad lo último (como en Procesos).
      const est = estadoDe.get(c.radicado);
      const diaAct = c.lastActuacionDate
        ? new Date(c.lastActuacionDate).toLocaleDateString("en-CA", { timeZone: "America/Bogota" })
        : "";
      const diaEst = est?.fecha ? new Date(est.fecha).toISOString().slice(0, 10) : "";
      const usarEstado = !!est && (!diaAct || (!!diaEst && diaEst >= diaAct));
      return usarEstado
        ? {
            radicado: c.radicado,
            href: `/dashboard/procesos/${c.id}`,
            fecha: fmtUTC(est!.fecha),
            orden: est!.fecha ? new Date(est!.fecha).getTime() : 0,
            texto: est!.titulo,
            deEstado: true,
            soloEstados: false,
          }
        : {
            radicado: c.radicado,
            href: `/dashboard/procesos/${c.id}`,
            fecha: fmt(c.lastActuacionDate),
            orden: c.lastActuacionDate ? new Date(c.lastActuacionDate).getTime() : 0,
            texto: c.actuaciones[0]?.actuacion ?? "—",
            deEstado: false,
            soloEstados: false,
          };
    });
  // Los que por ahora solo están en estados electrónicos (no en la Consulta Nacional).
  for (const s of solo) {
    if (s.caseId) continue;
    filas.push({
      radicado: s.radicado,
      href: `/dashboard/estados/${s.radicado}`,
      fecha: s.ultimo ? fmtUTC(s.ultimo.fecha) : "—",
      orden: s.ultimo?.fecha ? new Date(s.ultimo.fecha).getTime() : 0,
      texto: s.ultimo?.titulo ?? "Aún no sale en los estados del juzgado",
      deEstado: !!s.ultimo,
      soloEstados: true,
    });
  }
  const recientes = filas.sort((a, b) => b.orden - a.orden).slice(0, 8);

  return (
    <div className="page">
      {verificado && (
        <div className="ok" style={{ marginBottom: 14 }}>
          ¡Correo verificado! Bienvenido a Estradox. Agrega tu primer proceso para empezar.
          <OpenInChrome />
        </div>
      )}
      <div className="page-head wrap">
        <h1>Dashboard</h1>
        <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
          {/* Sin procesos todavía: el botón late para invitar a agregar el primero. */}
          <Link
            prefetch={false}
            href="/dashboard/procesos?agregar=1"
            className={`btn ${stats.totalProcesos === 0 ? "btn-pulse" : ""}`}
          >
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


      {/* Tabla de recientes: actuaciones de la Rama y estados electrónicos, todo junto. */}
      <section className="card">
        <div className="row">
          <h2 style={{ margin: 0 }}>Procesos con actuación reciente</h2>
          <div className="spacer" />
          <Link prefetch={false} href="/dashboard/procesos" className="small">
            Ver todos
          </Link>
        </div>
        {recientes.length === 0 ? (
          <p className="muted small" style={{ marginTop: 12 }}>
            Aún no sigues procesos.{" "}
            <Link prefetch={false} href="/dashboard/procesos?agregar=1">Agrega el primero</Link>.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Radicado</th>
                  <th>Fecha</th>
                  <th>Última actuación</th>
                </tr>
              </thead>
              <tbody>
                {recientes.map((r) => (
                  <tr key={r.radicado}>
                    <td>
                      <Link prefetch={false} href={r.href} className="radicado">
                        {r.radicado}
                      </Link>
                      {r.soloEstados && (
                        <span className="badge" style={{ marginLeft: 6 }}>solo en estados</span>
                      )}
                    </td>
                    <td className="muted">{r.fecha}</td>
                    <td>
                      {r.texto}
                      {r.deEstado && <div className="muted small">Estado electrónico</div>}
                    </td>
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
