// === CuidaBem - Service Worker v2 ===
const CACHE_NAME = "meu remedio";
const FILES_TO_CACHE = [
  "/index.html",
  "/style.css",
  "/app.js",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png"
];

// Instala o SW e adiciona arquivos ao cache
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(FILES_TO_CACHE))
  );
  self.skipWaiting();
});

// Ativa e remove caches antigos
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => (k !== CACHE_NAME ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

// Responde com cache ou rede
self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(resp => resp || fetch(event.request))
  );
});

// Mostra notificações locais
self.addEventListener("message", event => {
  const data = event.data;
  if (!data) return;
  if (data.type === "SHOW_NOTIFICATION") {
    self.registration.showNotification(data.title || "Lembrete CuidaBem", {
      body: data.body || "",
      icon: data.icon || "/icon-192.png",
      vibrate: [200, 100, 200],
      badge: "/icon-192.png",
      requireInteraction: true
    });
  }
});

// Clique na notificação
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window" }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes("index.html") && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow("/index.html");
    })
  );
});
