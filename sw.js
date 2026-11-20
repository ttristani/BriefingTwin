// Service worker : appli disponible hors ligne, données toujours prises sur le réseau en priorité.
const CACHE = 'briefing-v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'engine.js', 'manifest.webmanifest',
  'data/programme.json', 'data/minima.json', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Réseau d'abord (données fraîches), cache en secours hors ligne
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok && url.origin === location.origin) {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(e.request.url.split('?')[0], copy));
      }
      return r;
    }).catch(() => caches.match(e.request.url.split('?')[0]).then(r => r || caches.match(e.request)))
  );
});
