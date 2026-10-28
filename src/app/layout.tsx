import type { Metadata, Viewport } from "next";
import { getSiteSettings } from "@/lib/settings";
import { LOGOS } from "@/lib/marca";
import { IosInstallBubble } from "@/components/ios-install-bubble";
import { MetaPixel } from "@/components/meta-pixel";
import "./globals.css";

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
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const s = await getSiteSettings();
  // Tema configurable por el admin (sobrescribe los tokens de globals.css).
  const theme = `:root{
    --bg:${s.colorBg} !important;
    --panel:${s.colorPanel} !important;
    --accent:${s.colorAccent} !important;
    --accent-2:${s.colorAccent2} !important;
    --brand-grad:linear-gradient(135deg, ${s.colorAccent} 0%, ${s.colorAccent2} 100%) !important;
  }`;
  return (
    <html lang="es">
      <head>
        <style dangerouslySetInnerHTML={{ __html: theme }} />
      </head>
      <body>
        {children}
        <IosInstallBubble />
        <MetaPixel />
      </body>
    </html>
  );
}
