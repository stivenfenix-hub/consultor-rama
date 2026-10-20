import { prisma } from "@/lib/db";
import { PromoForm } from "./promo-form";

export default async function NotificacionesAdmin() {
  const dispositivos = await prisma.pushSubscription.count();
  const usuarios = await prisma.pushSubscription
    .findMany({ distinct: ["userId"], select: { userId: true } })
    .then((r) => r.length);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Enviar notificación</h1>
      </div>
      <p className="muted small" style={{ marginTop: -8, marginBottom: 16 }}>
        Envía una promoción o aviso a todos los usuarios que activaron
        notificaciones: <b>{usuarios}</b> usuario(s), <b>{dispositivos}</b>{" "}
        dispositivo(s).
      </p>
      <div className="card" style={{ maxWidth: 520 }}>
        <PromoForm />
      </div>
    </div>
  );
}
