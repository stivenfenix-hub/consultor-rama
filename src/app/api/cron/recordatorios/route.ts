import { NextRequest, NextResponse } from "next/server";
import { enviarRecordatoriosPendientes } from "@/lib/auto-emails";

/**
 * Envía el correo de recordatorio a quienes activaron su cuenta hace 24 h y aún
 * no tienen procesos. Es liviano (no consulta la Rama): pensado para un cron
 * cada hora, así el correo llega cerca de las 24 h exactas.
 * Protegido igual que /api/cron/refresh: Authorization: Bearer <CRON_SECRET>.
 */
export const dynamic = "force-dynamic";

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const enviados = await enviarRecordatoriosPendientes();
  return NextResponse.json({ ok: true, recordatoriosEnviados: enviados });
}

export const GET = handle;
export const POST = handle;
