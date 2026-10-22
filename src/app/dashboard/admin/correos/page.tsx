import { getEmailTemplate } from "@/lib/auto-emails";
import { EmailTemplateForm } from "./email-template-form";

export default async function CorreosAdmin() {
  const [welcome, reminder] = await Promise.all([
    getEmailTemplate("welcome"),
    getEmailTemplate("reminder"),
  ]);
  return (
    <div className="page">
      <div className="page-head">
        <h1>Correos automáticos</h1>
      </div>

      <div className="card" style={{ maxWidth: 760 }}>
        <h2>1. Bienvenida</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Se envía cuando el abogado activa su cuenta (al confirmar su correo).
        </p>
        <EmailTemplateForm kind="welcome" template={welcome} />
      </div>

      <div className="card" style={{ maxWidth: 760 }}>
        <h2>2. Recordatorio: aún no sube procesos</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Se envía una sola vez, 24 horas después de activar la cuenta, solo si
          el abogado todavía no ha cargado ningún radicado.
        </p>
        <EmailTemplateForm kind="reminder" template={reminder} />
      </div>
    </div>
  );
}
