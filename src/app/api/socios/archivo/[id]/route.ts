import { NextRequest, NextResponse } from "next/server";
import { usuarioSocio } from "@/lib/socios-acceso";
import { archivoDeMovimiento, movimiento } from "@/lib/socios";

export const dynamic = "force-dynamic";

/** Ver el comprobante: desde el servidor mientras no se ha subido a Drive; luego, en Drive. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await usuarioSocio())) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const id = Number((await params).id);
  const m = await movimiento(id);
  if (!m) return NextResponse.json({ error: "No existe" }, { status: 404 });
  if (m.driveUrl) return NextResponse.redirect(m.driveUrl);
  const datos = await archivoDeMovimiento(id);
  if (!datos) return NextResponse.json({ error: "Sin archivo" }, { status: 404 });
  return new NextResponse(new Uint8Array(datos), {
    headers: {
      "Content-Type": m.archivoTipo ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="${encodeURIComponent(m.archivoNombre ?? "comprobante")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
