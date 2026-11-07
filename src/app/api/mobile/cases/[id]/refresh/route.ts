import { after, NextRequest, NextResponse } from "next/server";
import { MSG_RAMA_ACTUALIZAR } from "@/lib/aviso-rama";
import { reintentarActualizacion } from "@/lib/reintentar-actualizacion";
import { textoPrivado } from "@/lib/textos-estados";
import { prisma } from "@/lib/db";
import { marcarActualizacionProceso, proximaActualizacionProceso, sinLimiteManual } from "@/lib/limits";
import { esProcesoPrivado, revisarProcesoManual } from "@/lib/sync-queue";
import { jsonError, withMobileUser } from "@/lib/mobile";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST -> { ok, nuevas }. Actualización manual: una vez por día (el admin sin límite).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withMobileUser(req, async (user) => {
    const caso = await prisma.case.findFirst({ where: { id, userId: user.id } });
    if (!caso) return jsonError("Proceso no encontrado.", 404);
    if (await proximaActualizacionProceso(id, await sinLimiteManual(user))) {
      return jsonError("Este proceso ya se actualizó hoy. Podrás hacerlo de nuevo mañana.", 429);
    }
    try {
      const r = await revisarProcesoManual(id);
      await marcarActualizacionProceso(id); // solo cuenta si funcionó
      return NextResponse.json({ ok: "Proceso actualizado.", nuevas: r.nuevas });
    } catch (err) {
      // el error queda guardado en caso.lastError; no se gasta el intento del día
      if (esProcesoPrivado(err)) {
        // No es un error: se le explica que lo vigilamos en estados electrónicos.
        const { estadosActivo } = await import("@/lib/estados");
        return NextResponse.json({ ok: textoPrivado(await estadosActivo(user.id)), nuevas: 0 });
      }
      // Sin error para el abogado: se reintenta solo y se le notifica al quedar listo.
      after(() => reintentarActualizacion(id, user.id, caso.radicado));
      return NextResponse.json({ ok: MSG_RAMA_ACTUALIZAR, nuevas: 0 });
    }
  });
}
