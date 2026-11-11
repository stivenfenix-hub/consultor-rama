import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getSuscripcion, tieneAcceso } from "@/lib/subscription";
import { archivoDeHallazgo } from "@/lib/estados";
import { MSG_RAMA_DOCUMENTO } from "@/lib/aviso-rama";

// Entrega el archivo de un estado electrónico a través del backend (para el
// visor y la descarga). Solo archivos de un hallazgo del usuario autenticado.
export const dynamic = "force-dynamic";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!tieneAcceso(await getSuscripcion(user.id))) {
    return NextResponse.json({ error: "Tu acceso venció. Renueva tu plan." }, { status: 402 });
  }
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const doc = Math.max(0, Math.floor(Number(req.nextUrl.searchParams.get("doc")) || 0));
  const archivo = await archivoDeHallazgo(user.id, Number(id), doc);
  if (!archivo) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  // Máximo 40 s esperando que el portal empiece a responder (Hostinger corta las peticiones largas).
  let upstream: Response | null = null;
  try {
    upstream = await fetch(archivo.url, {
      cache: "no-store",
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(40_000),
    });
  } catch {
    upstream = null;
  }
  if (!upstream || !upstream.ok || !upstream.body) {
    return NextResponse.json({ error: MSG_RAMA_DOCUMENTO }, { status: 503 });
  }

  const inline = req.nextUrl.searchParams.get("inline") === "1";
  const filename = archivo.archivo.replace(/[^\w.\-]+/g, "_");
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
