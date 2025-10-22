// service-worker.js (compatível com o app)
const CACHE_NAME = 'lembrete-medicamentos-v2';
const FILES_TO_CACHE = [
  'index.html',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'app.js',
  'style.css'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(FILES_TO_CACHE)).then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => (k !== CACHE_NAME) ? caches.delete(k) : null)))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  event.respondWith(caches.match(event.request).then(resp => resp || fetch(event.request)));
});

self.addEventListener('message', event => {
  const data = event.data;
  if(!data) return;
  if(data.type === 'SHOW_NOTIFICATION') {
    const title = data.title || 'Alerta';
    const body = data.body || '';
    const icon = data.icon || 'icons/icon-192.png';
    const options = {
      body,
      icon,
      badge: 'icons/icon-192.png',
      vibrate: [200,100,200],
      requireInteraction: true,
      data: data.data || {}
    };
    self.registration.showNotification(title, options);
  }
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('index.html') && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('index.html');
      return null;
    })
  );
});
