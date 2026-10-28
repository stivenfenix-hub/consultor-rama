import { NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getFaviconDataUrl, getSiteSettings } from "@/lib/settings";

// Sirve el logo de la plataforma o el de los correos como imagen real (URL),
// para que funcione en clientes de correo que bloquean data URIs.
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ type: string }> },
) {
  const { type } = await params;
  const s = await getSiteSettings();
  const dataUrl =
    type === "favicon"
      ? await getFaviconDataUrl()
      : type === "email"
      ? s.emailLogoDataUrl
      : type === "by"
        ? s.byLogoDataUrl
        : type === "notif-icon"
          ? s.notifIconDataUrl
          : type === "notif-badge"
            ? s.notifBadgeDataUrl
            : s.logoDataUrl;

  const m = dataUrl?.match(/^data:(.+?);base64,(.*)$/s);
  if (m) {
    const buf = Buffer.from(m[2], "base64");
    return new Response(new Uint8Array(buf), {
      headers: { "content-type": m[1], "cache-control": cacheControl(req) },
    });
  }

  // Por defecto: archivo incluido en el proyecto según el tipo.
  if (type === "favicon") {
    const svg = await readFile(path.join(process.cwd(), "public", "favicon.svg"));
    return new Response(new Uint8Array(svg), {
      headers: { "content-type": "image/svg+xml", "cache-control": cacheControl(req) },
    });
  }
  const defaultFile =
    type === "by"
      ? "unor-logo.png"
      : type === "notif-badge"
        ? "badge.png"
        : type === "notif-icon"
          ? "icon-512.png"
          : "logo-estradox.png";
  const file = await readFile(
    path.join(process.cwd(), "public", defaultFile),
  );
  return new Response(new Uint8Array(file), {
    headers: { "content-type": "image/png", "cache-control": cacheControl(req) },
  });
}

// Con ?v= (la URL cambia cuando cambia el logo) se guarda un día en el
// navegador; sin versión, 10 minutos. Antes era no-cache y cada imagen
// consultaba la base de datos.
function cacheControl(req: NextRequest) {
  return req.nextUrl.searchParams.has("v")
    ? "public, max-age=86400, immutable"
    : "public, max-age=600";
}
