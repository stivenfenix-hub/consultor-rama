import { listUsers } from "@/lib/admin";
import { getWhatsappPorUsuario } from "@/lib/accounts";
import { StatTile } from "@/components/charts";
import { EliminarUsuario } from "./eliminar-usuario";
import { motivosSospecha } from "@/lib/sospechoso";
import { resumenCargasPorUsuario } from "@/lib/sync";

function fmt(d: Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-CO", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "America/Bogota",
  });
}

export default async function UsuariosAdmin() {
  const [users, whatsapp, cargas] = await Promise.all([
    listUsers(),
    getWhatsappPorUsuario(),
    resumenCargasPorUsuario().catch(() => new Map<string, { cargas: number; conError: number; reintentos: number }>()),
  ]);
  const sospechas = new Map<string, string[]>();
  for (const u of users) {
    const m = u.role === "admin" ? [] : motivosSospecha(u);
    if (m.length > 0) sospechas.set(u.id, m);
  }
  const sospechosos = users.filter((u) => sospechas.has(u.id));
  const now = Date.now();
  const activos = users.filter(
    (u) =>
      u.lastLoginAt &&
      now - new Date(u.lastLoginAt).getTime() < 30 * 24 * 60 * 60 * 1000,
  ).length;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Usuarios</h1>
      </div>

      <section className="stat-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <StatTile label="Total" value={users.length} />
        <StatTile label="Activos (30 días)" value={activos} accent="var(--green)" />
        <StatTile
          label="Verificados"
          value={users.filter((u) => u.emailVerified).length}
        />
      </section>

      {sospechosos.length > 0 && (
        <div className="card">
          <h2>⚠️ Registros sospechosos por revisar</h2>
          <p className="muted small" style={{ marginTop: 0 }}>
            Sus datos parecen de relleno. Ya se les avisó que la cuenta puede ser eliminada (pueden
            corregir su nombre). Nada se borra solo: revísalos y elimínalos si lo apruebas.
          </p>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {sospechosos.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name ?? "—"}</td>
                    <td className="muted">{u.email}</td>
                    <td className="muted small">{sospechas.get(u.id)!.join("; ")}</td>
                    <td className="muted">{fmt(u.createdAt)}</td>
                    <td>
                      <EliminarUsuario id={u.id} email={u.email} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Correo</th>
                <th>WhatsApp</th>
                <th>Rol</th>
                <th>Verificado</th>
                <th>Procesos</th>
                <th title="Veces que intentó agregar procesos (desde el 28 de oct)">Intentos de carga</th>
                <th>Último acceso</th>
                <th>Registro</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    {u.name ?? "—"}
                    {sospechas.has(u.id) && (
                      <div className="badge warn" title={sospechas.get(u.id)!.join("; ")} style={{ marginTop: 4 }}>
                        ⚠️ Sospechoso
                      </div>
                    )}
                  </td>
                  <td className="muted">{u.email}</td>
                  <td>
                    {whatsapp.get(u.id) ? (
                      <a
                        href={`https://wa.me/${whatsapp.get(u.id)!.replace("+", "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {whatsapp.get(u.id)}
                      </a>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    {u.role === "admin" ? (
                      <span className="badge new">admin</span>
                    ) : (
                      <span className="badge">usuario</span>
                    )}
                  </td>
                  <td>{u.emailVerified ? "✓" : "—"}</td>
                  <td>{u._count.cases}</td>
                  <td className="small">
                    {(() => {
                      const c = cargas.get(u.id);
                      if (!c || (c.cargas === 0 && c.reintentos === 0)) return <span className="muted">—</span>;
                      return (
                        <>
                          {c.cargas}
                          {c.conError > 0 && <span className="badge warn" style={{ marginLeft: 4 }}>{c.conError} con falla</span>}
                          {c.reintentos > 0 && <span className="badge reciente" style={{ marginLeft: 4 }}>{c.reintentos} reintentando</span>}
                        </>
                      );
                    })()}
                  </td>
                  <td className="muted">{fmt(u.lastLoginAt)}</td>
                  <td className="muted">{fmt(u.createdAt)}</td>
                  <td>
                    {u.role !== "admin" && <EliminarUsuario id={u.id} email={u.email} />}
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
