import "server-only";
import webpush from "web-push";
import { prisma } from "./db";

const PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const PRIVATE = process.env.VAPID_PRIVATE_KEY;
const SUBJECT =
  process.env.VAPID_SUBJECT || "mailto:notificaciones@lexaroabogados.com";

let configured = false;
function ensure(): boolean {
  if (configured) return true;
  if (!PUBLIC || !PRIVATE) return false;
  webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE);
  configured = true;
  return true;
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

type Sub = { id: string; endpoint: string; p256dh: string; auth: string };

async function sendToSubs(subs: Sub[], payload: PushPayload) {
  if (!ensure()) {
    console.warn("[push] VAPID no configurado (faltan claves).");
    return { sent: 0, failed: 0 };
  }
  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
      );
      sent++;
    } catch (err) {
      failed++;
      const code = (err as { statusCode?: number })?.statusCode;
      // Suscripción vencida o inválida: eliminarla.
      if (code === 404 || code === 410) {
        await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
      }
    }
  }
  return { sent, failed };
}

export async function sendPushToUser(userId: string, payload: PushPayload) {
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  return sendToSubs(subs, payload);
}

export async function sendPushToAll(payload: PushPayload) {
  const subs = await prisma.pushSubscription.findMany();
  return sendToSubs(subs, payload);
}
