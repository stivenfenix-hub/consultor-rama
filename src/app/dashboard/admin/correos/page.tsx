import { getWelcomeTemplate } from "@/lib/welcome-email";
import { WelcomeForm } from "./welcome-form";

export default async function CorreosAdmin() {
  const t = await getWelcomeTemplate();
  return (
    <div className="page">
      <div className="page-head">
        <h1>Correo de bienvenida</h1>
      </div>
      <p className="muted small" style={{ marginTop: -8, marginBottom: 16 }}>
        Se envía automáticamente cuando un abogado activa su cuenta (al confirmar
        su correo).
      </p>
      <div className="card" style={{ maxWidth: 760 }}>
        <WelcomeForm template={t} />
      </div>
    </div>
  );
}
