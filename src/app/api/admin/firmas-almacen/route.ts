import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { estadoAlmacen } from "@/lib/firma-storage";

export const dynamic = "force-dynamic";

// Root: en qué carpeta guarda Firma Electrónica los PDF y fotos, y si puede
// escribir ahí. Sirve para confirmar en Hostinger que la carpeta queda fuera
// de la app (y no se borra al publicar).
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  return NextResponse.json(await estadoAlmacen());
}
