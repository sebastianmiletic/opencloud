const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function escapeJs(value) {
  return JSON.stringify(String(value ?? ''));
}

function loadEnv(baseDir) {
  const envCandidates = [
    path.join(baseDir, '.env'),
    path.join(process.resourcesPath || '', '.env')
  ].filter(Boolean);

  for (const envPath of envCandidates) {
    if (!fs.existsSync(envPath)) continue;
    const env = {};
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const splitIndex = trimmed.indexOf('=');
      if (splitIndex === -1) continue;
      const key = trimmed.slice(0, splitIndex).trim();
      const value = trimmed.slice(splitIndex + 1).trim();
      env[key] = value;
    }
    return env;
  }

  return {};
}

function makeEnvScript(env) {
  return `window.ENV = {
  TMDB_BEARER_TOKEN: ${escapeJs(env.TMDB_BEARER_TOKEN)},
  OMDB_API_KEY: ${escapeJs(env.OMDB_API_KEY)},
  SUPABASE_URL: ${escapeJs(env.SUPABASE_URL)},
  SUPABASE_ANON_KEY: ${escapeJs(env.SUPABASE_ANON_KEY)}
};`;
}

function createOpenCloudServer({ baseDir, host = '127.0.0.1', port = 38475 }) {
  const rootDir = path.resolve(baseDir);

  const server = http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url || '/', `http://${host}`);
      const pathname = decodeURIComponent(requestUrl.pathname);

      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('X-Content-Type-Options', 'nosniff');

      if (pathname === '/env.js') {
        const env = loadEnv(rootDir);
        const payload = Buffer.from(makeEnvScript(env), 'utf8');
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Content-Length': payload.length
        });
        if (req.method !== 'HEAD') res.end(payload);
        else res.end();
        return;
      }

      const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const normalizedPath = path.normalize(relativePath);
      const filePath = path.join(rootDir, normalizedPath);

      if (!filePath.startsWith(rootDir)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }

      let stat;
      try {
        stat = await fsp.stat(filePath);
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }

      const resolvedFile = stat.isDirectory() ? path.join(filePath, 'index.html') : filePath;
      const ext = path.extname(resolvedFile).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const body = await fsp.readFile(resolvedFile);

      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': body.length
      });
      if (req.method !== 'HEAD') res.end(body);
      else res.end();
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Internal server error: ${error.message}`);
    }
  });

  return {
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          const address = server.address();
          resolve({
            host,
            port: address && typeof address === 'object' ? address.port : null,
            close: () =>
              new Promise((closeResolve, closeReject) => {
                server.close((error) => {
                  if (error) closeReject(error);
                  else closeResolve();
                });
              })
          });
        });
      });
    }
  };
}

module.exports = {
  createOpenCloudServer
};
