import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { excelReporte, fechaBogotaHace, filasSinProcesosDelDia } from "@/lib/reporte-whatsapp";

export const dynamic = "force-dynamic";

// GET ?fecha=AAAA-MM-DD (por defecto, ayer) -> Excel de los registrados ese día
// que no han cargado procesos. Solo root.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const q = req.nextUrl.searchParams.get("fecha") ?? "";
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : fechaBogotaHace(1);
  const excel = await excelReporte(await filasSinProcesosDelDia(fecha));
  return new NextResponse(new Uint8Array(excel), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="sin-procesos-${fecha}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
