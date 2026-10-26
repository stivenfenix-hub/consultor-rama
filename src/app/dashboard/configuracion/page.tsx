import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import Link from "next/link";
import { getWhatsapp } from "@/lib/accounts";
import { getOfertas } from "@/lib/consent";
import { OffersToggle } from "./offers-toggle";
import { ChangePasswordForm } from "./change-password-form";
import { NotificationsToggle } from "./notifications-toggle";
import { WhatsappForm } from "./whatsapp-form";
import { DeleteAccountForm } from "./delete-account-form";

export default async function ConfiguracionPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [whatsapp, ofertas] = await Promise.all([getWhatsapp(user.id), getOfertas(user.id)]);

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

      <div className="card" style={{ maxWidth: 460 }}>
        <h2>WhatsApp</h2>
        {!whatsapp && (
          <p className="muted small" style={{ marginTop: 0 }}>
            Aún no has registrado tu número. Agrégalo para que podamos
            contactarte.
          </p>
        )}
        <WhatsappForm current={whatsapp} />
      </div>

      <div className="card">
        <h2>Notificaciones</h2>
        <NotificationsToggle />
      </div>

      <div className="card" style={{ maxWidth: 460 }}>
        <h2>Ofertas y boletines</h2>
        <OffersToggle initial={ofertas} />
        <p className="muted small" style={{ marginBottom: 0 }}>
          <Link href="/terminos" target="_blank">Términos y Condiciones</Link> ·{" "}
          <Link href="/privacidad" target="_blank">Política de Tratamiento de Datos</Link>
        </p>
      </div>

      <div className="card" style={{ maxWidth: 460 }}>
        <h2>Cambiar contraseña</h2>
        <ChangePasswordForm />
      </div>

      {user.role !== "admin" && (
        <div className="card" style={{ maxWidth: 460 }} id="eliminar-cuenta">
          <h2>Eliminar cuenta</h2>
          <DeleteAccountForm />
        </div>
      )}
    </div>
  );
}
