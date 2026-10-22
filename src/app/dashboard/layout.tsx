import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getSiteSettings } from "@/lib/settings";
import { getSuscripcion, tieneAcceso } from "@/lib/subscription";
import { logoutAction } from "@/app/actions";
import { AppShell } from "./sidebar";

// Páginas que se pueden abrir aunque el acceso esté vencido.
const SIEMPRE_DISPONIBLES = ["/dashboard/suscripcion", "/dashboard/configuracion"];

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [settings, sub, h] = await Promise.all([
    getSiteSettings(),
    getSuscripcion(user.id),
    headers(),
  ]);
  const pathname = h.get("x-pathname") ?? "";
  const libre = SIEMPRE_DISPONIBLES.some((p) => pathname.startsWith(p));

  let contenido = children;
  if (!tieneAcceso(sub) && !libre) {
    contenido = (
      <div className="page">
        <div className="card" style={{ maxWidth: 520, margin: "40px auto", textAlign: "center" }}>
          <h1>Tu acceso venció</h1>
          <p className="muted">
            Tus procesos siguen guardados, pero dejamos de revisarlos en la Rama
            Judicial. Renueva tu plan para seguir recibiendo alertas.
          </p>
          <Link href="/dashboard/suscripcion" className="btn" style={{ marginTop: 10 }}>
            Renovar mi plan
          </Link>
        </div>
      </div>
    );
  }

  // Aviso arriba: días de prueba restantes o plan por vencer.
  let aviso: React.ReactNode = null;
  if (!pathname.startsWith("/dashboard/suscripcion")) {
    if (sub.estado === "prueba") {
      aviso = (
        <>
          Prueba gratis: te quedan <b>{sub.diasRestantes} día(s)</b>.{" "}
          <Link href="/dashboard/suscripcion">Suscribirme</Link>
        </>
      );
    } else if (sub.estado === "activa" && sub.diasRestantes <= 5) {
      aviso = (
        <>
          Tu plan vence en <b>{sub.diasRestantes} día(s)</b>.{" "}
          <Link href="/dashboard/suscripcion">Renovar</Link>
        </>
      );
    }
  }

  return (
    <AppShell
      userLabel={user.name ?? user.email}
      logoUrl={settings.logoDataUrl ?? "/logo-estradox.png"}
      byLogoUrl={settings.byLogoDataUrl ?? "/unor-logo.png"}
      byUrl={settings.byUrl}
      isAdmin={user.role === "admin"}
      logoutAction={logoutAction}
    >
      {aviso && <div className="sub-banner">{aviso}</div>}
      {contenido}
    </AppShell>
  );
}
