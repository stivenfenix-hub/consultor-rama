import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { ADJUNTO_MAX_BYTES, guardarAdjuntoCampana } from "@/lib/campanas";

export const dynamic = "force-dynamic";

// POST (FormData "archivo") -> guarda el PDF que acompaña la campaña. Solo root.
// Es una ruta y no una acción de servidor porque estas aceptan como máximo 1 MB.
export async function POST(req: Request) {
  const admin = await getCurrentUser();
  if (!admin || admin.role !== "admin") {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const form = await req.formData().catch(() => null);
  const archivo = form?.get("archivo");
  if (!(archivo instanceof File)) return NextResponse.json({ error: "Elige un PDF." }, { status: 400 });
  if (archivo.size > ADJUNTO_MAX_BYTES) {
    return NextResponse.json({ error: "El PDF pesa más de 5 MB." }, { status: 400 });
  }
  const datos = Buffer.from(await archivo.arrayBuffer());
  if (datos.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return NextResponse.json({ error: "El archivo no es un PDF." }, { status: 400 });
  }
  const id = await guardarAdjuntoCampana(archivo.name, datos);
  return NextResponse.json({ id, nombre: archivo.name, bytes: datos.length });
}
