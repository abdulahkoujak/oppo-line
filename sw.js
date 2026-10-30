// Service worker: turns a push from Oppo into a "calling" notification,
// and keeps the app shell cached so the icon opens fast.
const CACHE = 'oppo-line-v2';
const SHELL = [
  './',
  'index.html',
  'app.css',
  'app.js',
  'config.js',
  'dial.js',
  'push.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
];

// Cache each file on its own: one missing file must never stop the worker
// from installing, because push notifications depend on it.
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(SHELL.map((path) => cache.add(path)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Network first so updates land right away; cache only as an offline fallback.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit ?? Response.error())),
  );
});

/** @param {PushMessageData|null} data */
function readPayload(data) {
  if (!data) return {};
  try {
    return data.json();
  } catch {
    return { body: data.text() };
  }
}

self.addEventListener('push', (event) => {
  const payload = readPayload(event.data);
  const reason = typeof payload.body === 'string' ? payload.body.slice(0, 300) : '';
  const ts = typeof payload.ts === 'string' ? payload.ts : new Date().toISOString();
  event.waitUntil(
    self.registration.showNotification(payload.title || 'Oppo is calling', {
      body: reason || 'Tap to answer',
      tag: 'oppo-call',
      renotify: true,
      requireInteraction: true,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      data: { reason, ts },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { reason = '', ts = '' } = event.notification.data ?? {};
  const url = new URL(self.registration.scope);
  url.searchParams.set('incoming', '1');
  if (reason) url.searchParams.set('reason', reason);
  if (ts) url.searchParams.set('ts', ts);

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((client) => client.url.startsWith(self.registration.scope));
    if (open) {
      open.postMessage({ type: 'incoming', reason, ts });
      return open.focus();
    }
    return self.clients.openWindow(url.href);
  })());
});
