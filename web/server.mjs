import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sportsUpstream } from '../js/sports-data.js';

const project = fileURLToPath(new URL('../', import.meta.url));
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.webp': 'image/webp' };

export function publicConfig(env, version) {
  return { TMDB_API_BASE: '/api/tmdb', OMDB_API_BASE: '/api/omdb',
    SUPABASE_URL: env.SUPABASE_URL || '', SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY || '',
    APP_VERSION: version, APP_PLATFORM: 'web', APP_ARCHITECTURE: 'browser' };
}

export function upstreamFor(url, env) {
  let upstream;
  const headers = { Accept: 'application/json' };
  if (url.pathname.startsWith('/api/tmdb/')) {
    const route = url.pathname.slice('/api/tmdb'.length);
    // Read-only catalog routes, never arbitrary destinations or account APIs.
    if (!/^\/(movie|tv|search|discover|trending|genre|collection|person|configuration)(\/[a-zA-Z0-9_-]+)*$/.test(route)) return null;
    upstream = new URL(`https://api.themoviedb.org/3${route}`);
    headers.Authorization = `Bearer ${env.TMDB_BEARER_TOKEN}`;
  } else if (url.pathname === '/api/omdb') {
    upstream = new URL('https://www.omdbapi.com/');
  } else if (url.pathname === '/api/sports') {
    upstream = sportsUpstream(url.searchParams.get('resource'), Object.fromEntries(url.searchParams));
    return upstream ? { url: upstream, headers: { ...headers, 'Accept-Language': 'en' } } : null;
  } else return null;
  for (const [key, value] of url.searchParams) {
    if (!['api_key', 'apikey', 'access_token', 'callback'].includes(key.toLowerCase())) upstream.searchParams.append(key, value);
  }
  if (url.pathname === '/api/omdb') upstream.searchParams.set('apikey', env.OMDB_API_KEY);
  return { url: upstream, headers };
}

export function createWebServer({ env = process.env, root = path.join(project, 'web-dist'), version = 'web', fetchImpl = fetch } = {}) {
  const cache = new Map();
  let inFlight = 0;
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    const send = (status, body, type = 'application/json', caching = 'no-store') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': caching });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    try {
      if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); return send(405, '{}'); }
      if ((req.url || '').length > 4096) return send(414, '{}');
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/healthz') return send(200, '{"ok":true}');
      if (url.pathname === '/env.js') return send(200, `window.ENV = ${JSON.stringify(publicConfig(env, version))};`, 'application/javascript');
      if (url.pathname.startsWith('/api/')) {
        const upstream = upstreamFor(url, env);
        if (!upstream) return send(404, '{}');
        const key = upstream.url.href;
        const sports = url.pathname === '/api/sports';
        const cacheable = !sports || url.searchParams.get('resource') === 'schedule';
        const caching = cacheable ? `public, max-age=${sports ? 15 : 60}` : 'no-store';
        const cached = cacheable && cache.get(key);
        if (cached && cached.expires > Date.now()) return send(200, cached.body, 'application/json', caching);
        if (inFlight >= 24) { res.setHeader('Retry-After', '5'); return send(429, '{"error":"Busy. Retry shortly."}'); }
        inFlight++;
        try {
          const response = await fetchImpl(upstream.url, { headers: upstream.headers, redirect: 'error', signal: AbortSignal.timeout(15000) });
          if (!response.ok) return send(response.status, '{"error":"Catalog request failed"}');
          const body = await response.text();
          if (sports && body.length > 3 * 1024 * 1024) throw new Error('Oversized sports response');
          const parsed = JSON.parse(body);
          if (cacheable && (!sports || parsed.status === 200)) {
            if (cache.size >= 500) cache.delete(cache.keys().next().value);
            cache.set(key, { body, expires: Date.now() + (sports ? 15000 : 60000) });
          }
          return send(200, body, 'application/json', sports && parsed.status !== 200 ? 'no-store' : caching);
        } catch { return send(502, '{"error":"Catalog temporarily unavailable"}'); }
        finally { inFlight--; }
      }
      const pathname = decodeURIComponent(url.pathname);
      // Publish only build artifacts. Never serve repo files, dotfiles or maps.
      if (pathname.split('/').some(part => part.startsWith('.')) || pathname.endsWith('.map')) return send(404, '{}');
      const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!file.startsWith(path.resolve(root) + path.sep)) return send(404, '{}');
      if (!(await stat(file)).isFile()) return send(404, '{}');
      const body = await readFile(file);
      const caching = pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
      send(200, body, mime[path.extname(file)] || 'application/octet-stream', caching);
    } catch { send(404, '{}'); }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const required = ['TMDB_BEARER_TOKEN', 'OMDB_API_KEY', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'];
  if (required.some(key => !process.env[key])) throw new Error('Missing configuration: ' + required.filter(key => !process.env[key]).join(', '));
  const pkg = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8'));
  const server = createWebServer({ version: pkg.version });
  server.listen(Number(process.env.PORT || 10000), '0.0.0.0', () => console.log('OpenCloud web server ready'));
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}
