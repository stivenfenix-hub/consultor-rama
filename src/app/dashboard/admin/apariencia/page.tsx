import { getSiteSettings } from "@/lib/settings";
import { AppearanceForm } from "./appearance-form";

export default async function AparienciaPage() {
  const s = await getSiteSettings();
  return (
    <div className="page">
      <div className="page-head">
        <h1>Apariencia del sitio</h1>
      </div>
      <p className="muted small" style={{ marginTop: -8, marginBottom: 16 }}>
        Los cambios se aplican a toda la plataforma para todos los usuarios.
      </p>
      <AppearanceForm
        settings={{
          brandName: s.brandName,
          logoDataUrl: s.logoDataUrl,
          emailLogoDataUrl: s.emailLogoDataUrl,
          byLogoDataUrl: s.byLogoDataUrl,
          byUrl: s.byUrl,
          notifIconDataUrl: s.notifIconDataUrl,
          notifBadgeDataUrl: s.notifBadgeDataUrl,
          colorAccent: s.colorAccent,
          colorAccent2: s.colorAccent2,
          colorBg: s.colorBg,
          colorPanel: s.colorPanel,
        }}
      />
    </div>
  );
}
