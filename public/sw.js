// Service worker: makes Scrap Express installable as an app and keeps it
// usable on a weak connection.
//  - Pages: always fetched fresh (they can hold account details); if there
//    is no connection, the offline page is shown instead.
//  - CSS/JS: fresh when online, last saved copy when offline.
//  - Images, icons, fonts: served from the saved copy, refreshed in the background.
//  - /api/ (requests, quotes, uploads, admin) is never cached.
// Bump CACHE_VERSION whenever the list of pre-saved files changes.
const CACHE_VERSION = 'v1';
const STATIC_CACHE = `se-static-${CACHE_VERSION}`;
const PRECACHE = [
  '/offline.html',
  '/css/style.css',
  '/js/main.js',
  '/icons/icon-192.png',
  '/icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('se-') && n !== STATIC_CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) (await caches.open(STATIC_CACHE)).put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function staleWhileRevalidate(event) {
  const { request } = event;
  const cached = await caches.match(request);
  const refresh = fetch(request).then(async (response) => {
    if (response.ok || response.type === 'opaque') (await caches.open(STATIC_CACHE)).put(request, response.clone());
    return response;
  });
  if (cached) {
    event.waitUntil(refresh.catch(() => {}));
    return cached;
  }
  return refresh;
}

// ---- Push notifications (sent by lib/push.js) ----
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (err) { data = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Scrap Express', {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag: data.tag,
    renotify: Boolean(data.tag),
    data: { url: data.url || '/' },
  }));
});

// Tapping a notification opens the page it's about, reusing an open app
// window when there is one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
    if (open) {
      await open.focus();
      return open.navigate(target);
    }
    return self.clients.openWindow(target);
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  if (sameOrigin && url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/offline.html')));
    return;
  }

  if (sameOrigin && /\.(css|js)$/.test(url.pathname)) {
    event.respondWith(networkFirst(request));
    return;
  }

  const isAsset = sameOrigin
    ? /^\/(icons|images)\//.test(url.pathname) || /\.(png|jpe?g|webp|svg|ico)$/.test(url.pathname)
    : /^(fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname);
  if (isAsset) event.respondWith(staleWhileRevalidate(event));
});
