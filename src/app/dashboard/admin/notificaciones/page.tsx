import { prisma } from "@/lib/db";
import { PromoForm } from "./promo-form";
import { eventosPush } from "@/lib/push";

export default async function NotificacionesAdmin() {
  const dispositivos = await prisma.pushSubscription.count();
  const [subs, eventos] = await Promise.all([
    prisma.pushSubscription.findMany({
      orderBy: { createdAt: "desc" },
      include: { user: { select: { email: true } } },
    }),
    eventosPush(),
  ]);
  const usuarios = await prisma.pushSubscription
    .findMany({ distinct: ["userId"], select: { userId: true } })
    .then((r) => r.length);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Enviar notificación</h1>
      </div>
      <p className="muted small" style={{ marginTop: -8, marginBottom: 16 }}>
        Usuarios con notificaciones activas: <b>{usuarios}</b> usuario(s),{" "}
        <b>{dispositivos}</b> dispositivo(s). Se envía a todos, menos a quienes
        desactivaron las ofertas en Configuración.
      </p>
      <div className="card" style={{ maxWidth: 520 }}>
        <PromoForm />
      </div>

      <div className="card">
        <h2>Dispositivos suscritos</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Id</th>
                <th>Usuario</th>
                <th>Servicio</th>
                <th>Suscrito</th>
              </tr>
            </thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s.id}>
                  <td className="muted small">{s.id.slice(-6)}</td>
                  <td className="small">{s.user.email}</td>
                  <td className="small">{new URL(s.endpoint).host}</td>
                  <td className="muted small">
                    {new Date(s.createdAt).toLocaleString("es-CO", { timeZone: "America/Bogota" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Últimos envíos</h2>
        {eventos.length === 0 ? (
          <p className="muted small">Aún no hay envíos registrados.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Dispositivo</th>
                  <th>Respuesta</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {eventos.map((e) => (
                  <tr key={e.id}>
                    <td className="muted small" style={{ whiteSpace: "nowrap" }}>
                      {new Date(e.createdAt).toLocaleString("es-CO", { timeZone: "America/Bogota" })}
                    </td>
                    <td className="small">{e.subId.slice(-6)}</td>
                    <td>{e.status ?? "—"}</td>
                    <td className="small" style={{ wordBreak: "break-all", maxWidth: 420 }}>{e.detalle}</td>
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
