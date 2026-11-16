import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { documentoDe } from "@/lib/firmas";
import { leerArchivo } from "@/lib/firma-storage";

// PDF de un documento del abogado: el original o, si ya está completo, el sellado.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const doc = await documentoDe(user.id, id);
  if (!doc) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const firmado = req.nextUrl.searchParams.get("tipo") === "firmado";
  const clave = firmado ? doc.firmadoUrl : doc.originalUrl;
  if (!clave) return NextResponse.json({ error: "El documento aún no está firmado por todos." }, { status: 404 });
  const datos = await leerArchivo(clave).catch(() => null);
  if (!datos) return NextResponse.json({ error: "Archivo no disponible." }, { status: 404 });

  const nombre = `${doc.titulo.replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 80) || "documento"}${firmado ? " (firmado)" : ""}.pdf`;
  const inline = req.nextUrl.searchParams.get("inline") === "1";
  return new NextResponse(new Uint8Array(datos), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(nombre)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
