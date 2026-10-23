import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getSiteSettings } from "@/lib/settings";
import { boldConfigurado, getSuscripcion, ofertaRelampago, tieneAcceso } from "@/lib/subscription";
import { FlashOffer } from "@/components/flash-offer";
import { logoutAction } from "@/app/actions";
import { AppShell } from "./sidebar";

// Con el acceso vencido solo se puede abrir la página de pago.
const PAGINA_PAGO = "/dashboard/suscripcion";

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
  const vencida = !tieneAcceso(sub);
  if (vencida && !pathname.startsWith(PAGINA_PAGO)) redirect(PAGINA_PAGO);

  // Oferta relámpago del día 15 (reemplaza el aviso de días de prueba).
  const oferta =
    boldConfigurado() && !pathname.startsWith(PAGINA_PAGO)
      ? await ofertaRelampago(user.id, sub)
      : null;

  // Aviso arriba: días de prueba restantes o plan por vencer.
  let aviso: React.ReactNode = null;
  if (oferta) {
    aviso = null;
  } else if (!pathname.startsWith("/dashboard/suscripcion")) {
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
      soloPago={vencida}
      logoutAction={logoutAction}
    >
      {oferta && (
        <FlashOffer
          precio={oferta.precio}
          ahorro={oferta.ahorro}
          diasUsados={oferta.diasUsados}
          diasRestantes={oferta.diasRestantes}
        />
      )}
      {aviso && <div className="sub-banner">{aviso}</div>}
      {children}
    </AppShell>
  );
}
