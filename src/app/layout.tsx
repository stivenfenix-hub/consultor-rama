import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Consultor de Procesos",
  description: "Seguimiento de procesos judiciales desde el API de la Rama Judicial",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
