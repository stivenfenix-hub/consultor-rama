import type { Metadata, Viewport } from "next";
import { getSiteSettings } from "@/lib/settings";
import { IosInstallBubble } from "@/components/ios-install-bubble";
import "./globals.css";

export const metadata: Metadata = {
  title: "Estradox",
  description: "Seguimiento de procesos judiciales en tiempo real",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Estradox",
    statusBarStyle: "black-translucent",
  },
  icons: { apple: "/icon-512.png" },
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
      </body>
    </html>
  );
}
