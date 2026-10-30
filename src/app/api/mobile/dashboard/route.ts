import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getDashboardStats } from "@/lib/dashboard";
import { estadoActualizarTodos, sinLimiteManual } from "@/lib/limits";
import { withMobileUser } from "@/lib/mobile";

export const dynamic = "force-dynamic";

// GET -> { stats, refreshAll, recientes }
export async function GET(req: NextRequest) {
  return withMobileUser(req, async (user) => {
    const [stats, refreshAll, recientes] = await Promise.all([
      getDashboardStats(user.id),
      estadoActualizarTodos(user.id, await sinLimiteManual(user)),
      prisma.case.findMany({
        where: { userId: user.id },
        orderBy: { lastActuacionDate: "desc" },
        take: 8,
        include: { actuaciones: { orderBy: { fechaActuacion: "desc" }, take: 1 } },
      }),
    ]);
    return NextResponse.json({
      stats,
      refreshAll,
      recientes: recientes.map((c) => ({
        id: c.id,
        radicado: c.radicado,
        lastActuacionDate: c.lastActuacionDate,
        ultimaActuacion: c.actuaciones[0]?.actuacion ?? null,
        unseenCount: c.unseenCount,
      })),
    });
  });
}
