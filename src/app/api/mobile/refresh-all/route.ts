import { NextRequest, NextResponse, after } from "next/server";
import { ejecutarActualizarTodos, reservarActualizarTodos, sinLimiteManual } from "@/lib/limits";
import { jsonError, withMobileUser } from "@/lib/mobile";

export const dynamic = "force-dynamic";

// POST -> { ok }. "Actualizar todos": una vez por semana, en segundo plano y por tandas.
export async function POST(req: NextRequest) {
  return withMobileUser(req, async (user) => {
    const error = await reservarActualizarTodos(user.id, await sinLimiteManual(user));
    if (error) return jsonError(error, 429);
    after(() => ejecutarActualizarTodos(user.id));
    return NextResponse.json({
      ok: "Actualización iniciada en segundo plano. Te avisaremos si hay actuaciones nuevas.",
    });
  });
}
