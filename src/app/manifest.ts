import type { MetadataRoute } from "next";

// Manifiesto de la app instalable. Next lo sirve en /manifest.webmanifest con el
// tipo correcto (application/manifest+json): con text/plain o con íconos cuyo
// tamaño no coincide, Chrome Android no crea la app (WebAPK) sino un acceso
// directo que muestra la notificación "Presiona para copiar la URL".
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Estradox",
    short_name: "Estradox",
    description: "Seguimiento de procesos judiciales en tiempo real",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0820",
    theme_color: "#0a0820",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
