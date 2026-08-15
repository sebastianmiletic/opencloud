/** Open Cloud Service Worker — auto-update from GitHub raw */
const CACHE_NAME = 'openccloud-v3.6.2';
const GITHUB_RAW = 'https://raw.githubusercontent.com/sebastianmiletic/opencloud/main/';

/* Only static files that exist in the repo (env.js is server-generated) */
const FILES_TO_CACHE = [
  '/',
  '/index.html',
  '/styles.css',
  '/beta.css',
  '/js/main.js',
  '/js/auth.js',
  '/js/dev-panel.js',
  '/js/dev-panel-policy.js',
  '/js/api.js',
  '/js/ui.js',
  '/js/player.js',
  '/js/config.js',
  '/js/settings.js',
  '/js/storage.js',
  '/js/sync.js',
  '/js/state.js',
  '/js/hero.js',
  '/js/blocker.js',
  '/js/utils.js',
  '/js/accounts.js',
  '/js/supabase.js'
];

/* Install: cache static files one-by-one so one failure doesn't break everything */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const url of FILES_TO_CACHE) {
        try {
          await cache.add(url);
        } catch (e) {
          console.warn('[SW] failed to cache', url, e.message);
        }
      }
    })
  );
  self.skipWaiting();
});

/* Activate: claim clients immediately */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

/*
  Fetch strategy:
  - For same-origin GET requests: try cache first, then network.
    If both fail, return an empty 404 Response so the browser doesn't crash.
  - For everything else (POST, cross-origin, etc.): pass through to network.
*/
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only intercept same-origin GET requests
  if (request.method !== 'GET' || !new URL(request.url).origin.includes(self.location.origin)) {
    return; // let browser handle it normally
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) {
        // Return cached copy immediately, but also refresh in background
        fetch(request)
          .then((networkRes) => {
            if (networkRes.ok) cache.put(request, networkRes.clone());
          })
          .catch(() => {});
        return cached;
      }

      // Not in cache — fetch from network
      try {
        const networkRes = await fetch(request);
        if (networkRes.ok) {
          cache.put(request, networkRes.clone());
        }
        return networkRes;
      } catch (err) {
        // Network failed and nothing in cache — return graceful 404
        console.warn('[SW] network failed for', request.url);
        return new Response('', { status: 404, statusText: 'Not Found' });
      }
    })()
  );
});

/* Message handler for in-app updates */
self.addEventListener('message', async (event) => {
  if (event.data?.type === 'UPDATE_CACHE') {
    const files = event.data.files || [];
    const sha   = event.data.sha || '';
    if (!files.length || !sha) {
      event.source.postMessage({ type: 'UPDATE_STATUS', ok: false, error: 'No files or SHA' });
      return;
    }

    const cache = await caches.open(CACHE_NAME);
    let updated = 0;
    let failed  = 0;

    for (const file of files) {
      const url = GITHUB_RAW + file;
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const blob = await res.blob();
        await cache.put('/' + file, new Response(blob, {
          headers: { 'Content-Type': guessType(file) }
        }));
        updated++;
      } catch (err) {
        failed++;
        console.warn('[SW] update fetch failed for', file, err.message);
      }
    }

    // Also update index.html if it changed
    if (files.includes('index.html')) {
      try {
        const res = await fetch(GITHUB_RAW + 'index.html', { cache: 'no-store' });
        if (res.ok) {
          const blob = await res.blob();
          await cache.put('/', new Response(blob, { headers: { 'Content-Type': 'text/html' } }));
          await cache.put('/index.html', new Response(blob, { headers: { 'Content-Type': 'text/html' } }));
        }
      } catch (e) {}
    }

    event.source.postMessage({ type: 'UPDATE_STATUS', ok: true, updated, failed, sha });
  }
});

function guessType(file) {
  if (file.endsWith('.js')) return 'application/javascript';
  if (file.endsWith('.css')) return 'text/css';
  if (file.endsWith('.html')) return 'text/html';
  if (file.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}
