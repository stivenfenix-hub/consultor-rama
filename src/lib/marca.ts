/**
 * Logos de Estradox: archivos en public/marca que se publican con el sitio en
 * Hostinger. Antes se guardaban en base64 en Supabase y cada página los volvía
 * a descargar de la base (casi todo el egress). Para cambiar un logo se
 * reemplaza el archivo y se sube la versión (?v=) para que el navegador no
 * siga mostrando el anterior.
 */
const V = "1";

export const LOGOS = {
  /** Menú y pantallas de la app (letra clara, tema oscuro). */
  plataforma: `/marca/logo.png?v=${V}`,
  /** Correos (fondo blanco). */
  correo: `/marca/email.png?v=${V}`,
  /** Logo "By" (UNOR) del pie del login, el menú y los correos. */
  by: `/marca/by.png?v=${V}`,
  /** Ícono grande y badge de las notificaciones push (ver public/sw.js). */
  notifIcono: `/marca/notif-icon.png?v=${V}`,
  notifBadge: `/marca/notif-badge.png?v=${V}`,
  favicon: `/favicon.svg?v=${V}`,
} as const;

const APP_URL = process.env.APP_URL ?? "https://app.estradox.com";

/** URL absoluta (para los correos). */
export const urlAbsoluta = (ruta: string) => `${APP_URL}${ruta}`;
