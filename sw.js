/** Open Cloud Service Worker — Always fetch fresh app files */

self.addEventListener('install', event => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Only intercept local requests
  const isLocal = url.hostname === 'localhost' || url.hostname === '';
  if (!isLocal) return; // Let external requests pass through

  // Always fetch fresh copies of code/assets — never cache
  const isCodeFile = /\.(js|css|html|json)$/.test(url.pathname);
  const isNoCachePath = url.pathname === '/env.js' || url.pathname.startsWith('/env.js');

  if (isCodeFile || isNoCachePath) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).catch(() => {
        // If offline, fall back to cache so the app still works
        return caches.match(event.request);
      })
    );
  }
});