import type { Metadata, Viewport } from "next";
import { getSiteSettings } from "@/lib/settings";
import { LOGOS } from "@/lib/marca";
import { IosInstallBubble } from "@/components/ios-install-bubble";
import { MetaPixel } from "@/components/meta-pixel";
import { getCurrentUser } from "@/lib/auth";
import { coincidenciasPixel } from "@/lib/meta-registro";
import "./globals.css";
import "./firma.css";

const BASE_METADATA: Metadata = {
  title: "Estradox",
  description: "Seguimiento de procesos judiciales en tiempo real",
  appleWebApp: {
    capable: true,
    title: "Estradox",
    statusBarStyle: "black-translucent",
  },
};

// Favicon publicado con el sitio (ver lib/marca.ts).
export const metadata: Metadata = {
  ...BASE_METADATA,
  icons: {
    icon: LOGOS.favicon,
    apple: "/icon-512.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0820",
  // Sin zoom en el celular.
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const s = await getSiteSettings();
  // Coincidencias avanzadas del Píxel para quien tiene sesión (datos ya cifrados).
  const usuario = await getCurrentUser().catch(() => null);
  const am = usuario ? await coincidenciasPixel(usuario.id).catch(() => null) : null;
  // Tema configurable por el admin (sobrescribe los tokens de globals.css).
  const theme = `:root{
    --bg:${s.colorBg} !important;
    --panel:${s.colorPanel} !important;
    --accent:${s.colorAccent} !important;
    --accent-2:${s.colorAccent2} !important;
    --brand-grad:linear-gradient(135deg, ${s.colorAccent} 0%, ${s.colorAccent2} 100%) !important;
  }`;
  return (
    // suppressHydrationWarning: el script de abajo pone data-tema antes de que React cargue.
    <html lang="es" suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: theme }} />
        {/* Modo día/noche guardado en este dispositivo: se aplica antes de pintar (sin parpadeo). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("estradox-tema")==="claro"){document.documentElement.dataset.tema="claro";}}catch(e){}`,
          }}
        />
      </head>
      <body>
        {children}
        <IosInstallBubble />
        <MetaPixel am={am} />
      </body>
    </html>
  );
}
