import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { detalleCargasUsuario } from "@/lib/sync";
import { sinLimiteManual } from "@/lib/limits";
import { SinLimite } from "./sin-limite";

const hora = (d: Date | null) =>
  d ? new Date(d).toLocaleString("es-CO", { timeZone: "America/Bogota" }) : "—";

/** Root: qué pasó con cada carga de procesos de un usuario (para dar soporte). */
export default async function CargasUsuario({ params }: { params: Promise<{ userId: string }> }) {
  const admin = await getCurrentUser();
  if (admin?.role !== "admin") redirect("/dashboard");
  const { userId } = await params;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, firstName: true, lastName: true, role: true },
  });
  if (!user) notFound();
  const [{ cargas, reintentos, procesos }, libre] = await Promise.all([
    detalleCargasUsuario(userId),
    sinLimiteManual({ id: userId, role: user.role }),
  ]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Link href="/dashboard/admin/usuarios" className="small muted">← Usuarios</Link>
          <h1 style={{ marginTop: 4 }}>
            {[user.firstName, user.lastName].filter(Boolean).join(" ") || user.email}
          </h1>
          <p className="muted small" style={{ margin: 0 }}>{user.email}</p>
        </div>
      </div>

      {user.role !== "admin" && (
        <div className="card">
          <SinLimite userId={userId} valor={libre} />
        </div>
      )}

      <div className="card">
        <h2>Procesos en su lista ({procesos.length})</h2>
        {procesos.length === 0 ? (
          <p className="muted small">No tiene procesos.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Radicado</th><th>Sistema</th><th>Actuaciones</th><th>Error</th></tr></thead>
              <tbody>
                {procesos.map((p) => (
                  <tr key={p.id}>
                    <td className="radicado">{p.radicado}</td>
                    <td className="muted">{p.ubicacion?.replace(/^Software:\s*/i, "") ?? "—"}</td>
                    <td>{p.actuaciones}</td>
                    <td className="small">{p.lastError ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Reintentos automáticos ({reintentos.length})</h2>
        {reintentos.length === 0 ? (
          <p className="muted small">Ninguno pendiente.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Radicado</th><th>Intentos</th><th>Próximo</th><th>Último error</th></tr></thead>
              <tbody>
                {reintentos.map((r) => (
                  <tr key={r.radicado}>
                    <td className="radicado">{r.radicado}</td>
                    <td>{r.intentos}</td>
                    <td className="muted">{hora(r.proximoAt)}</td>
                    <td className="small">{r.ultimoError ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Cargas ({cargas.length})</h2>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Fecha</th><th>Radicados</th><th>Resultado</th><th>Detalle técnico</th></tr></thead>
            <tbody>
              {cargas.map((c) => (
                <tr key={c.id}>
                  <td className="muted">{hora(c.createdAt)}</td>
                  <td className="small" style={{ wordBreak: "break-all" }}>
                    {c.radicados ?? `${c.total} (no se guardaba cuáles)`}
                  </td>
                  <td className="small">
                    {c.ok && <div>{c.ok}</div>}
                    {c.error && <div className="error">{c.error}</div>}
                    {!c.ok && !c.error && <span className="muted">{c.estado}</span>}
                  </td>
                  <td className="small muted" style={{ whiteSpace: "pre-wrap" }}>{c.detalle ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
