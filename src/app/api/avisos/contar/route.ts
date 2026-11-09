import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { contarAvisosNoLeidos, marcarAvisosDeRuta } from "@/lib/push";

export const dynamic = "force-dynamic";

// Contador de la campana. Corre en cada cambio de página: es una ruta y no una
// acción de servidor para no hacer esperar la navegación.
// POST { ruta? } -> { n }. Con `ruta`, los avisos de esa página quedan leídos.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ n: 0 });
  const { ruta } = (await req.json().catch(() => ({}))) as { ruta?: unknown };
  if (typeof ruta === "string" && ruta) await marcarAvisosDeRuta(user.id, ruta).catch(() => {});
  // El root recibe muchos avisos: su campana cuenta solo los últimos 10.
  const n = await contarAvisosNoLeidos(user.id, user.role === "admin" ? 10 : undefined).catch(() => 0);
  return NextResponse.json({ n }, { headers: { "Cache-Control": "no-store" } });
}
