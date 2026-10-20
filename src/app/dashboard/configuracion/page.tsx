import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { ChangePasswordForm } from "./change-password-form";
import { NotificationsToggle } from "./notifications-toggle";

export default async function ConfiguracionPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="page">
      <div className="page-head">
        <h1>Configuración</h1>
      </div>

      <div className="card">
        <h2>Mi cuenta</h2>
        <dl className="small" style={{ margin: 0 }}>
          <div style={{ display: "flex", gap: 8, padding: "4px 0" }}>
            <dt className="muted" style={{ minWidth: 140 }}>Nombre</dt>
            <dd style={{ margin: 0 }}>{user.name ?? "—"}</dd>
          </div>
          <div style={{ display: "flex", gap: 8, padding: "4px 0" }}>
            <dt className="muted" style={{ minWidth: 140 }}>Correo</dt>
            <dd style={{ margin: 0 }}>{user.email}</dd>
          </div>
        </dl>
      </div>

      <div className="card">
        <h2>Notificaciones</h2>
        <NotificationsToggle />
      </div>

      <div className="card" style={{ maxWidth: 460 }}>
        <h2>Cambiar contraseña</h2>
        <ChangePasswordForm />
      </div>
    </div>
  );
}
