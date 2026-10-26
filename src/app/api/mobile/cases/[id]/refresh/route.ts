import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { marcarActualizacionProceso, proximaActualizacionProceso } from "@/lib/limits";
import { esProcesoPrivado, MSG_PRIVADO, revisarProcesoManual } from "@/lib/sync-queue";
import { jsonError, withMobileUser } from "@/lib/mobile";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST -> { ok, nuevas }. Actualización manual: una vez por día (el admin sin límite).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withMobileUser(req, async (user) => {
    const caso = await prisma.case.findFirst({ where: { id, userId: user.id } });
    if (!caso) return jsonError("Proceso no encontrado.", 404);
    if (await proximaActualizacionProceso(id, user.role === "admin")) {
      return jsonError("Este proceso ya se actualizó hoy. Podrás hacerlo de nuevo mañana.", 429);
    }
    try {
      const r = await revisarProcesoManual(id);
      await marcarActualizacionProceso(id); // solo cuenta si funcionó
      return NextResponse.json({ ok: "Proceso actualizado.", nuevas: r.nuevas });
    } catch (err) {
      // el error queda guardado en caso.lastError; no se gasta el intento del día
      if (esProcesoPrivado(err)) return jsonError(MSG_PRIVADO, 422);
      return jsonError("La Rama Judicial no respondió. Intenta de nuevo en un rato.", 502);
    }
  });
}
