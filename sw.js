const CACHE_NAME = 'argon-pwa-v3.0';
const CORE = ['./', './index.html', './manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Datos vivos: nunca desde caché
  if (/supabase\.co|script\.google|googleusercontent|generativelanguage/.test(url.hostname)) return;

  const put = (res) => {
    if (res && (res.ok || res.type === 'opaque')) {
      const cl = res.clone();
      caches.open(CACHE_NAME).then((c) => c.put(req, cl));
    }
    return res;
  };

  if (url.origin === self.location.origin) {
    e.respondWith(fetch(req).then(put).catch(() => caches.match(req)));
  } else {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then(put)));
  }
});
