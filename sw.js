// Service worker: la app abre al instante y funciona sin señal con lo último que viste.
const SHELL = 'tasador-shell-v4';
const DATA = 'tasador-data-v1';
const FILES = ['./', 'index.html', 'styles.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/card-back.svg',
  'js/app.js', 'js/api.js', 'js/config.js', 'js/logic.js', 'js/scan.js', 'js/identify.js', 'js/chart.js', 'js/timeline.js', 'js/signals.js', 'js/photos.js', 'data/history/index.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => ![SHELL, DATA].includes(k)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;
  const isImage = url.host === 'assets.tcgdex.net';
  const isOcr = url.host === 'cdn.jsdelivr.net' || url.host.endsWith('tessdata.projectnaptha.com');

  // Imágenes de cartas y archivos del lector OCR: caché primero (no cambian).
  if (isImage || isOcr) {
    e.respondWith(caches.open(DATA).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
    return;
  }
  // Archivos de la app: red primero, caché si no hay señal.
  if (sameOrigin) {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req)));
  }
  // APIs de precios: la caché de la app (localStorage) ya se encarga.
});
