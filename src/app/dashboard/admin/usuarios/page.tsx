import { listUsers } from "@/lib/admin";
import { getWhatsappPorUsuario } from "@/lib/accounts";
import { StatTile } from "@/components/charts";

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
  const [users, whatsapp] = await Promise.all([listUsers(), getWhatsappPorUsuario()]);
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
                <th>Último acceso</th>
                <th>Registro</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.name ?? "—"}</td>
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
                  <td className="muted">{fmt(u.lastLoginAt)}</td>
                  <td className="muted">{fmt(u.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
