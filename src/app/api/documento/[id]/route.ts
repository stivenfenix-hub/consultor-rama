import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getSuscripcion, tieneAcceso } from "@/lib/subscription";
import { MSG_RAMA_DOC_RESTRINGIDO, MSG_RAMA_DOCUMENTO } from "@/lib/aviso-rama";

// Descarga un documento de la Rama a través del backend (proxy), porque el
// API de la Rama usa el puerto :448 y bloquea CORS. Solo entrega documentos
// que pertenecen a un proceso del usuario autenticado.
export const dynamic = "force-dynamic";

const BASE =
  process.env.RAMA_API_BASE ??
  "https://consultaprocesos.ramajudicial.gov.co:448/api/v2";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!tieneAcceso(await getSuscripcion(user.id))) {
    return NextResponse.json({ error: "Tu acceso venció. Renueva tu plan." }, { status: 402 });
  }

  // El documento debe pertenecer a un proceso del usuario.
  const doc = await prisma.documento.findFirst({
    where: { idRegDocumento: id, case: { userId: user.id } },
  });
  if (!doc) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }

  // Máximo 40 s esperando que la Rama empiece a responder: Hostinger corta y
  // puede reiniciar la app con peticiones de más de 120 s.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 40_000);
  let upstream: Response | null = null;
  try {
    upstream = await fetch(`${BASE}/Descarga/Documento/${id}`, {
      cache: "no-store",
      signal: ctrl.signal,
    });
  } catch {
    upstream = null;
  } finally {
    clearTimeout(timer);
  }
  // 403 = el juzgado no autorizó la descarga (no es una caída: no sirve reintentar).
  if (upstream?.status === 403) {
    return NextResponse.json({ error: MSG_RAMA_DOC_RESTRINGIDO }, { status: 403 });
  }
  if (!upstream || !upstream.ok || !upstream.body) {
    return NextResponse.json({ error: MSG_RAMA_DOCUMENTO }, { status: 503 });
  }

  const contentType =
    upstream.headers.get("content-type") ?? "application/octet-stream";
  // ?inline=1 lo usa el visor integrado (vista previa sin descargar).
  const inline = req.nextUrl.searchParams.get("inline") === "1";
  const filename = `${(doc.nombre ?? "documento").replace(/[^\w.\-]+/g, "_")}.${doc.tipo || "pdf"}`;

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "content-type": contentType,
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
