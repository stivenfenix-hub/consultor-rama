import { after, NextRequest, NextResponse } from "next/server";
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

  // El proxy de Hostinger corta las peticiones a los 60 s, así que se responde
  // de inmediato y la sincronización sigue en segundo plano.
  after(async () => {
    const inicio = Date.now();
    try {
      const resultados = await sincronizarTodos();
      const nuevas = resultados.reduce((n, r) => n + (r.nuevas ?? 0), 0);
      console.log(
        `[cron] fin: ${resultados.length} procesos, ${nuevas} actuaciones nuevas, ` +
          `${resultados.filter((r) => !r.ok).length} fallidos, ${Date.now() - inicio} ms`,
      );
    } catch (e) {
      console.error("[cron] error", e);
    }
  });
  return NextResponse.json(
    { ok: true, mensaje: "Sincronización iniciada en segundo plano." },
    { status: 202 },
  );
}

export const GET = handle;
export const POST = handle;
