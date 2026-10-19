import { NextRequest, NextResponse } from "next/server";
import { sincronizarTodos } from "@/lib/sync";

/**
 * Endpoint que refresca todos los procesos. Lo dispara un scheduler cada 24h.
 *
 * Protegido por CRON_SECRET: el scheduler debe mandar
 *   Authorization: Bearer <CRON_SECRET>
 *
 * Opciones para dispararlo cada 24h:
 *   - Vercel Cron (ver vercel.json)
 *   - Un worker local: `npm run cron` (usa scripts/cron-worker.ts)
 *   - Programador de tareas de Windows / cron de Linux haciendo curl
 */

export const maxDuration = 300; // segundos (la Rama es lenta)
export const dynamic = "force-dynamic";

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const resultados = await sincronizarTodos();
  const nuevas = resultados.reduce((n, r) => n + (r.nuevas ?? 0), 0);
  return NextResponse.json({
    ok: true,
    procesos: resultados.length,
    actuacionesNuevas: nuevas,
    fallidos: resultados.filter((r) => !r.ok).length,
  });
}

export const GET = handle;
export const POST = handle;
