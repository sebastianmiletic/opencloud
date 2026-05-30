/** Open Cloud Service Worker — auto-update from GitHub raw */
const CACHE_NAME = 'openccloud-v1';
const GITHUB_RAW = 'https://raw.githubusercontent.com/sebastianmiletic/opencloud/main/';

const FILES_TO_CACHE = [
  '/',
  '/index.html',
  '/styles.css',
  '/beta.css',
  '/js/main.js',
  '/js/auth.js',
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
  '/js/supabase.js',
  '/env.js'
];

/* Install: cache all core files */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(FILES_TO_CACHE);
    }).catch(() => {})
  );
  self.skipWaiting();
});

/* Activate: claim clients immediately */
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/* Fetch: serve from cache, fall back to network */
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});

/* Message handler for updates */
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
