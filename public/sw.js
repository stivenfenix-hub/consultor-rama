// Service worker: habilita instalación (PWA) y notificaciones push.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("fetch", () => {
  // Sin respondWith => el navegador maneja la petición normalmente (red).
});

// Muestra la notificación recibida.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Estradox";
  const options = {
    body: data.body || "",
    icon: "/marca/notif-icon.png?v=1",
    badge: "/marca/notif-badge.png?v=1",
    data: { url: data.url || "/dashboard" },
    tag: data.tag,
    renotify: !!data.tag,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// El navegador renovó o venció la suscripción: se crea otra y se le avisa al
// servidor (si no, las push dejan de llegar sin que nadie lo note).
self.addEventListener("pushsubscriptionchange", (event) => {
  const key =
    (event.oldSubscription && event.oldSubscription.options.applicationServerKey) || null;
  event.waitUntil(
    (async () => {
      let sub = event.newSubscription;
      if (!sub && key) {
        sub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        });
      }
      if (!sub) return;
      await fetch("/api/push/subscribe", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sub),
      });
    })().catch(() => {}),
  );
});

// Al tocar la notificación, abre/enfoca la app.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url =
    (event.notification.data && event.notification.data.url) || "/dashboard";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        for (const c of list) {
          if ("focus" in c) {
            c.navigate(url);
            return c.focus();
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(url);
      }),
  );
});
