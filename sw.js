const CACHE = 'argon-pwa-v3.0';
const CORE = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];
const CDN = [
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.css',
  'https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.js',
  'https://unpkg.com/lucide@0.460.0',
  'https://cdn.jsdelivr.net/npm/apexcharts',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];
const NET_ONLY = ['supabase.co', 'script.google.com', 'script.googleusercontent.com'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.allSettled(CORE.map((u) => c.add(u)));
    await Promise.allSettled(CDN.map((u) => c.add(new Request(u, { mode: 'no-cors' }))));
  })());
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET' || NET_ONLY.some((h) => r.url.includes(h))) return;
  e.respondWith(
    fetch(r).then((res) => {
      if (res && (res.ok || res.type === 'opaque')) { const cl = res.clone(); caches.open(CACHE).then((c) => c.put(r, cl)); }
      return res;
    }).catch(() => caches.match(r))
  );
});
