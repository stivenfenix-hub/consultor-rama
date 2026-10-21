import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Estado de la configuración del servidor. Solo indica si cada variable está
// definida (nunca su valor), salvo APP_URL, que es pública.
export const dynamic = "force-dynamic";

export async function GET() {
  let db = false;
  let ultimaSincronizacion: Date | null = null;
  try {
    const r = await prisma.case.aggregate({ _max: { lastSyncedAt: true } });
    ultimaSincronizacion = r._max.lastSyncedAt;
    db = true;
  } catch {}
  const set = (k: string) => !!process.env[k];
  return NextResponse.json({
    db,
    ultimaSincronizacion,
    appUrl: process.env.APP_URL ?? null,
    sessionSecret: set("SESSION_SECRET"),
    cronSecret: set("CRON_SECRET"),
    smtp: set("SMTP_HOST") && set("SMTP_USER") && set("SMTP_PASS"),
    smtpFrom: set("SMTP_FROM"),
    vapidPublic: set("NEXT_PUBLIC_VAPID_PUBLIC_KEY"),
    vapidPrivate: set("VAPID_PRIVATE_KEY"),
    vapidSubject: set("VAPID_SUBJECT"),
  });
}
