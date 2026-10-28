// Helpers de notificaciones push para el navegador (cliente).
// Clave del build; si falta, se pide al servidor (/api/push/key).
const VAPID_BUILD = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

async function vapidKey(): Promise<string | null> {
  if (VAPID_BUILD) return VAPID_BUILD;
  try {
    const r = await fetch("/api/push/key");
    const j = (await r.json()) as { key: string | null };
    return j.key;
  } catch {
    return null;
  }
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function isSubscribed(): Promise<boolean> {
  if (!pushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    return !!(await reg.pushManager.getSubscription());
  } catch {
    return false;
  }
}

export type SubResult = "ok" | "denied" | "error" | "unsupported" | "nokey";

export async function subscribeToPush(): Promise<SubResult> {
  if (!pushSupported()) return "unsupported";
  const VAPID = await vapidKey();
  if (!VAPID) return "nokey";
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return "denied";
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID),
    });
    const r = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sub),
    });
    return r.ok ? "ok" : "error";
  } catch {
    return "error";
  }
}

/**
 * Con el permiso ya dado, se asegura de que el servidor tenga la suscripción
 * vigente de este dispositivo. El navegador puede cambiarla o vencerla sin
 * avisar (el servidor la borra al recibir 410) y entonces las push dejan de
 * llegar aunque todo se vea "activado": por eso se vuelve a enviar en cada
 * apertura, y si ya no existe se crea otra sin preguntar.
 */
export async function sincronizarSuscripcion(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const VAPID = await vapidKey();
      if (!VAPID) return false;
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID),
      });
    }
    const r = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sub),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function unsubscribeFromPush(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push/unsubscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      await sub.unsubscribe();
    }
  } catch {
    // ignore
  }
}
