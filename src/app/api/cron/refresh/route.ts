import { after, NextRequest, NextResponse } from "next/server";
import { tick } from "@/lib/sync-queue";

/**
 * Cron de sincronización: se llama cada 5 minutos, todo el día.
 *   curl -H "Authorization: Bearer <CRON_SECRET>" .../api/cron/refresh
 *
 * El código decide qué hacer según la hora de Bogotá (ver lib/sync-queue.ts):
 * de 8 p.m. a 6:45 a.m. revisa procesos por lotes y desde las 7 a.m. envía el
 * resumen diario. Fuera de esos horarios la corrida no consulta la Rama.
 * Recordatorios, avisos de suscripción y pagos van en /api/cron/recordatorios.
 */

export const maxDuration = 300;
export const dynamic = "force-dynamic";

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  // El proxy de Hostinger corta las peticiones a los 60 s, así que se responde
  // de inmediato y la corrida sigue en segundo plano.
  after(async () => {
    try {
      const info = await tick();
      console.log("[cron]", JSON.stringify(info));
    } catch (e) {
      console.error("[cron] error", e);
    }
  });
  return NextResponse.json({ ok: true, mensaje: "Corrida iniciada en segundo plano." }, { status: 202 });
}

export const GET = handle;
export const POST = handle;
