import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { jsonError, withMobileUser } from "@/lib/mobile";

// Descarga un documento de la Rama a través del backend (igual que
// /api/documento/[id], pero autenticado con el token de la app).
export const dynamic = "force-dynamic";

const BASE =
  process.env.RAMA_API_BASE ??
  "https://consultaprocesos.ramajudicial.gov.co:448/api/v2";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withMobileUser(req, async (user) => {
    // El documento debe pertenecer a un proceso del usuario.
    const doc = await prisma.documento.findFirst({
      where: { idRegDocumento: id, case: { userId: user.id } },
    });
    if (!doc) return jsonError("No encontrado", 404);

    const upstream = await fetch(`${BASE}/Descarga/Documento/${id}`, { cache: "no-store" });
    if (!upstream.ok || !upstream.body) {
      return jsonError("No se pudo descargar el documento de la Rama.", 502);
    }
    const filename = `${(doc.nombre ?? "documento").replace(/[^\w.\-]+/g, "_")}.${doc.tipo || "pdf"}`;
    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  });
}
