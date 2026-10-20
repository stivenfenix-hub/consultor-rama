import { NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getSiteSettings } from "@/lib/settings";

// Sirve el logo de la plataforma o el de los correos como imagen real (URL),
// para que funcione en clientes de correo que bloquean data URIs.
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ type: string }> },
) {
  const { type } = await params;
  const s = await getSiteSettings();
  const dataUrl = type === "email" ? s.emailLogoDataUrl : s.logoDataUrl;

  const m = dataUrl?.match(/^data:(.+?);base64,(.*)$/s);
  if (m) {
    const buf = Buffer.from(m[2], "base64");
    return new Response(new Uint8Array(buf), {
      headers: { "content-type": m[1], "cache-control": "no-cache" },
    });
  }

  // Por defecto: logo incluido en el proyecto
  const file = await readFile(
    path.join(process.cwd(), "public", "logo-estradox.png"),
  );
  return new Response(new Uint8Array(file), {
    headers: { "content-type": "image/png", "cache-control": "no-cache" },
  });
}
