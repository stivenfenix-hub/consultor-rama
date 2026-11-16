import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { documentoDe, firmantesDe } from "@/lib/firmas";
import { leerArchivo } from "@/lib/firma-storage";

// Fotos de identidad de un firmante (cédula y selfie). Solo para el abogado
// dueño del documento: son datos sensibles y no se muestran en ninguna página pública.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const doc = await documentoDe(user.id, id);
  if (!doc) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const f = (await firmantesDe(doc.id)).find((x) => x.id === req.nextUrl.searchParams.get("f"));
  const tipo = req.nextUrl.searchParams.get("tipo");
  const clave =
    tipo === "frente" ? f?.cedulaFrenteUrl : tipo === "reverso" ? f?.cedulaReversoUrl : tipo === "selfie" ? f?.selfieUrl : null;
  const datos = clave ? await leerArchivo(clave).catch(() => null) : null;
  if (!datos) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  return new NextResponse(new Uint8Array(datos), {
    headers: {
      "Content-Type": clave!.endsWith(".png") ? "image/png" : "image/jpeg",
      "Cache-Control": "private, no-store",
    },
  });
}
