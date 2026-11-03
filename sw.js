// Offline Progressive Web App Service Worker for PDF Editor PRO.
// - Pre-caches the local app shell on install.
// - Uses Network-First (with offline cache fallback) for same-origin app assets so updates load immediately.
// - Uses Cache-First for pinned immutable CDN libraries & fonts (pdf.js, pdf-lib, fontkit, DejaVu, QPDF, etc.).
// - Strictly bypasses account/API requests (e.g. vetviral.com) and non-GET requests.

const SHELL_CACHE = 'pdf-editor-shell-v1';
const CDN_CACHE = 'pdf-editor-cdn-v1';

const IMMUTABLE_CDN_HOSTS = new Set([
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'cdn.sheetjs.com',
]);

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/app.js',
  './src/dom.js',
  './src/store.js',
  './src/ribbon.js',
  './src/ribbonbar.js',
  './src/ribbon.css',
  './src/quicktools.js',
  './src/inline-edit.js',
  './src/inline-edit.css',
  './src/form-builder.js',
  './src/form-builder.css',
  './src/measure.js',
  './src/measure.css',
  './src/compare.js',
  './src/compare.css',
  './src/batch.js',
  './src/batch.css',
  './src/workspace-storage.js',
  './src/workspace-storage.css',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS).catch(() => {}))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== CDN_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Cache-first for pinned third-party static libraries and Unicode fonts
  if (IMMUTABLE_CDN_HOSTS.has(url.hostname)) {
    event.respondWith(
      caches.open(CDN_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const fresh = await fetch(request);
        if (fresh && (fresh.ok || fresh.type === 'opaque')) {
          cache.put(request, fresh.clone());
        }
        return fresh;
      }),
    );
    return;
  }

  // Only handle same-origin app shell files; bypass external API calls (e.g. vetviral.com)
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        return cached || caches.match('./index.html');
      }),
  );
});
