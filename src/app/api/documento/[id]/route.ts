import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

// Descarga un documento de la Rama a través del backend (proxy), porque el
// API de la Rama usa el puerto :448 y bloquea CORS. Solo entrega documentos
// que pertenecen a un proceso del usuario autenticado.
export const dynamic = "force-dynamic";

const BASE =
  process.env.RAMA_API_BASE ??
  "https://consultaprocesos.ramajudicial.gov.co:448/api/v2";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  // El documento debe pertenecer a un proceso del usuario.
  const doc = await prisma.documento.findFirst({
    where: { idRegDocumento: id, case: { userId: user.id } },
  });
  if (!doc) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }

  const upstream = await fetch(`${BASE}/Descarga/Documento/${id}`, {
    cache: "no-store",
  });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: "No se pudo descargar el documento de la Rama." },
      { status: 502 },
    );
  }

  const contentType =
    upstream.headers.get("content-type") ?? "application/octet-stream";
  const filename = `${(doc.nombre ?? "documento").replace(/[^\w.\-]+/g, "_")}.${doc.tipo || "pdf"}`;

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "content-type": contentType,
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
