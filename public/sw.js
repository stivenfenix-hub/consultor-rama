// Service worker mínimo: habilita que la app sea instalable (PWA).
// No cachea nada agresivamente; deja pasar las peticiones a la red.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {
  // Sin respondWith => el navegador maneja la petición normalmente (red).
});
