import { NextRequest, NextResponse } from "next/server";
import { auditar, origenDe } from "@/lib/firmas";
import { accesoFirmante } from "@/lib/firma-portal";
import { leerArchivo } from "@/lib/firma-storage";

// El PDF para el firmante: el original mientras se firma (solo después del
// OTP) y el sellado cuando ya firmaron todos.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const a = await accesoFirmante(token);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.estado });
  const { firmante: f, doc } = a;

  const firmado = req.nextUrl.searchParams.get("tipo") === "firmado";
  let clave: string | null;
  if (firmado) {
    // Quien firmó puede bajar el resultado con su enlace personal.
    if (doc.estado !== "COMPLETED" || f.estado !== "SIGNED") {
      return NextResponse.json({ error: "El documento aún no está firmado por todos." }, { status: 404 });
    }
    clave = doc.firmadoUrl;
  } else {
    if (!a.verificado) {
      return NextResponse.json({ error: "Primero confirme su identidad con el código." }, { status: 401 });
    }
    clave = doc.originalUrl;
  }
  const datos = clave ? await leerArchivo(clave).catch(() => null) : null;
  if (!datos) return NextResponse.json({ error: "Archivo no disponible." }, { status: 404 });

  if (!firmado && req.nextUrl.searchParams.get("leer") === "1") {
    await auditar(doc.id, "DOCUMENT_VIEWED", { firmanteId: f.id, ...origenDe(req.headers) });
  }
  const base = doc.titulo.replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 80) || "documento";
  const nombre = encodeURIComponent(`${base}${firmado ? " (firmado)" : ""}.pdf`);
  return new NextResponse(new Uint8Array(datos), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${firmado ? "attachment" : "inline"}; filename="documento.pdf"; filename*=UTF-8${"''"}${nombre}`,
      "Cache-Control": "private, no-store",
    },
  });
}
