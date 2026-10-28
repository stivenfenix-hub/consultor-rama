import { NextRequest, NextResponse } from "next/server";
import { LOGOS, urlAbsoluta } from "@/lib/marca";

// Ruta antigua de los logos: los correos ya enviados y las apps instaladas aún
// apuntan aquí. Ahora solo redirige al archivo publicado (no toca la base).
const RUTAS: Record<string, string> = {
  logo: LOGOS.plataforma,
  email: LOGOS.correo,
  by: LOGOS.by,
  "notif-icon": LOGOS.notifIcono,
  "notif-badge": LOGOS.notifBadge,
  favicon: LOGOS.favicon,
};

export async function GET(_req: NextRequest, { params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  const destino = RUTAS[type] ?? LOGOS.plataforma;
  // req.url es la dirección interna del servidor detrás del proxy: se usa la pública.
  return NextResponse.redirect(urlAbsoluta(destino), {
    status: 308,
    headers: { "cache-control": "public, max-age=86400" },
  });
}
