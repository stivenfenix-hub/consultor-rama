import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { marcarVistas } from "@/lib/sync";
import { jsonError, withMobileUser } from "@/lib/mobile";

export const dynamic = "force-dynamic";

// POST -> { ok }. Marca como vistas todas las actuaciones del proceso.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withMobileUser(req, async (user) => {
    const caso = await prisma.case.findFirst({ where: { id, userId: user.id } });
    if (!caso) return jsonError("Proceso no encontrado.", 404);
    await marcarVistas(id);
    return NextResponse.json({ ok: true });
  });
}
