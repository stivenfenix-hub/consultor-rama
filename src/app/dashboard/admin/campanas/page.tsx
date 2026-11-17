import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import {
  ASUNTO_CORREO_FIRMA,
  CORREOS_CAMPANA_DIA,
  PLANTILLA_CORREO_FIRMA,
  PLANTILLA_WA_FIRMA,
  destinatariosFirma,
  resumenCorreos,
} from "@/lib/campanas";
import { estadoWhatsapp } from "@/lib/whatsapp";
import { CampanaFirma } from "./campana";

export const metadata = { title: "Campañas" };
export const dynamic = "force-dynamic";

/** Root: campañas por WhatsApp y correo que salen de a poco durante el día. */
export default async function Campanas() {
  const admin = await getCurrentUser();
  if (admin?.role !== "admin") redirect("/dashboard");
  const [{ lista, yaUsaron }, wa, correos] = await Promise.all([
    destinatariosFirma(),
    estadoWhatsapp().catch(() => []),
    resumenCorreos(),
  ]);
  const comercial = wa.find((e) => e.cuenta === "comercial");

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Campañas</h1>
          <p className="muted small" style={{ margin: 0 }}>
            Mensajes a grupos de abogados por WhatsApp y correo. No salen todos de una vez: se envían de a poco durante
            el día para no saturar ni parecer spam.
          </p>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>🎁 Firma electrónica gratis</h2>
        <p className="small" style={{ marginTop: 0 }}>
          Para los abogados con <b>al menos 1 proceso</b> que todavía <b>no han enviado ningún documento a firmar</b>{" "}
          (justo los que tienen la primera firma gratis). Hay <b>{lista.length}</b>; otros {yaUsaron} ya usaron la firma y
          no aparecen.
        </p>
        <div className="row wrap small" style={{ gap: 14 }}>
          <span>
            📱 WhatsApp comercial:{" "}
            {comercial?.numero ? (
              <b>
                {comercial.pendientes ?? 0} en cola · máx. {comercial.maxDia}/día
              </b>
            ) : (
              <span className="error">
                no vinculado (<Link prefetch={false} href="/dashboard/admin/whatsapp">vincular</Link>)
              </span>
            )}
          </span>
          <span>
            📧 Correos: <b>{correos.pendientes} en cola</b> · {correos.hoy} enviados hoy (máx. {CORREOS_CAMPANA_DIA}/día) ·{" "}
            {correos.enviados} en total{correos.fallidos ? ` · ${correos.fallidos} fallidos` : ""}
          </span>
        </div>
      </div>

      <CampanaFirma
        waVinculado={!!comercial?.numero}
        plantillas={{ whatsapp: PLANTILLA_WA_FIRMA, asunto: ASUNTO_CORREO_FIRMA, correo: PLANTILLA_CORREO_FIRMA }}
        usuarios={lista.map((u) => ({
          id: u.id,
          nombre: u.nombre,
          email: u.email,
          telefono: u.telefono,
          procesos: u.procesos,
          ultimoWa: u.ultimoWa ? new Date(u.ultimoWa).toISOString() : null,
          ultimoCorreo: u.ultimoCorreo ? new Date(u.ultimoCorreo).toISOString() : null,
        }))}
      />
    </div>
  );
}
