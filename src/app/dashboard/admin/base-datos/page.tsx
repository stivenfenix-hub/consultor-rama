import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Diagnóstico de Supabase (solo lectura): tamaño de la base y de cada tabla,
 * conexiones abiertas y las consultas que más datos devuelven (egress).
 */

const mb = (b: number | bigint) => `${(Number(b) / 1024 / 1024).toFixed(2)} MB`;
const kb = (b: number) => (b > 1024 * 1024 ? mb(b) : `${(b / 1024).toFixed(0)} KB`);

async function intentar<T>(f: () => Promise<T>): Promise<T | null> {
  try {
    return await f();
  } catch {
    return null;
  }
}

export default async function BaseDatosPage() {
  await requireAdmin();
  const [tam, tablas, conexiones, maxConn, consultas] = await Promise.all([
    intentar(() =>
      prisma.$queryRawUnsafe<{ b: bigint }[]>(`SELECT pg_database_size(current_database()) AS b`),
    ),
    intentar(() =>
      prisma.$queryRawUnsafe<{ tabla: string; filas: bigint; total: bigint; datos: bigint }[]>(
        `SELECT relname AS tabla, n_live_tup AS filas,
                pg_total_relation_size(relid) AS total, pg_relation_size(relid) AS datos
         FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC`,
      ),
    ),
    intentar(() =>
      prisma.$queryRawUnsafe<{ estado: string | null; app: string | null; n: bigint }[]>(
        `SELECT state AS estado, application_name AS app, count(*) AS n
         FROM pg_stat_activity WHERE datname = current_database()
         GROUP BY state, application_name ORDER BY n DESC`,
      ),
    ),
    intentar(() => prisma.$queryRawUnsafe<{ v: string }[]>(`SELECT current_setting('max_connections') AS v`)),
    intentar(() =>
      prisma.$queryRawUnsafe<
        { consulta: string; llamadas: bigint; filas: bigint; ms: number; mbLeidos: number }[]
      >(
        `SELECT left(regexp_replace(query, '\\s+', ' ', 'g'), 220) AS consulta,
                calls AS llamadas, rows AS filas, round(total_exec_time::numeric, 0)::float AS ms,
                round((shared_blks_hit + shared_blks_read) * 8 / 1024.0, 1)::float AS "mbLeidos"
         FROM extensions.pg_stat_statements
         WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
         ORDER BY rows DESC LIMIT 15`,
      ),
    ),
  ]);

  // Cómo se conecta Estradox (sin usuario ni contraseña).
  let conexion = "—";
  try {
    const u = new URL(process.env.DATABASE_URL ?? "");
    const p = u.searchParams;
    conexion = [
      u.hostname.includes("pooler") ? "pooler de Supabase" : u.hostname.includes("supabase") ? "conexión directa" : u.hostname,
      `puerto ${u.port || "5432"} (${u.port === "6543" ? "modo transacción" : "modo sesión"})`,
      `pgbouncer=${p.get("pgbouncer") ?? "no"}`,
      `connection_limit=${p.get("connection_limit") ?? "por defecto de Prisma"}`,
      `pool_timeout=${p.get("pool_timeout") ?? "10 s"}`,
    ].join(" · ");
  } catch {}

  const totalTablas =(tablas ?? []).reduce((s, t) => s + Number(t.total), 0);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Base de datos (Supabase)</h1>
      </div>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Tamaño</h2>
        <p style={{ margin: 0 }}>
          Base completa: <b>{tam ? mb(tam[0].b) : "—"}</b> de 500 MB del plan gratis · tablas de Estradox:{" "}
          <b>{mb(totalTablas)}</b>
        </p>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Tablas</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Tabla</th>
                <th>Filas</th>
                <th>Tamaño total</th>
                <th>Solo datos</th>
              </tr>
            </thead>
            <tbody>
              {(tablas ?? []).map((t) => (
                <tr key={t.tabla}>
                  <td style={{ fontFamily: "monospace" }}>{t.tabla}</td>
                  <td>{Number(t.filas).toLocaleString("es-CO")}</td>
                  <td>{kb(Number(t.total))}</td>
                  <td className="muted">{kb(Number(t.datos))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Conexiones abiertas</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Estradox se conecta por: <b>{conexion}</b>
          <br />
          Máximo del servidor: {maxConn?.[0]?.v ?? "—"}
        </p>
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {(conexiones ?? []).map((c, i) => (
                <tr key={i}>
                  <td>{c.app || "—"}</td>
                  <td className="muted">{c.estado ?? "—"}</td>
                  <td>{Number(c.n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Consultas que más filas devuelven</h2>
        {!consultas ? (
          <p className="muted small">No se pudo leer pg_stat_statements.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Consulta</th>
                  <th>Veces</th>
                  <th>Filas</th>
                  <th>Tiempo total</th>
                </tr>
              </thead>
              <tbody>
                {consultas.map((q, i) => (
                  <tr key={i}>
                    <td className="small" style={{ fontFamily: "monospace", maxWidth: 520 }}>{q.consulta}</td>
                    <td>{Number(q.llamadas).toLocaleString("es-CO")}</td>
                    <td>{Number(q.filas).toLocaleString("es-CO")}</td>
                    <td className="muted">{Math.round(q.ms / 1000)} s</td>
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
