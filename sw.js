// Service Worker: App-Shell offline verfügbar machen.
const VERSION = 'v1';
const CACHE = `mosaik-studio-${VERSION}`;
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/app.js', 'js/colors.js', 'js/parts.js', 'js/mosaic.js', 'js/render.js', 'js/editor.js',
  'js/orderlist.js', 'js/instructions.js', 'js/storage.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('mosaik-studio-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Stale-while-revalidate: sofort aus dem Cache, im Hintergrund aktualisieren.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req).then(res => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => cached || (req.mode === 'navigate' ? cache.match('index.html') : Response.error()));
      return cached || network;
    })
  );
});
