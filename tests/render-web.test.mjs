import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createWebServer, upstreamFor } from '../web/server.mjs';

test('Render serves build assets and public config without leaking server credentials', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'opencloud-web-'));
  await writeFile(path.join(root, 'index.html'), '<h1>OpenCloud</h1>');
  await writeFile(path.join(root, '.env'), 'secret');
  const env = { TMDB_BEARER_TOKEN: 'private-tmdb', OMDB_API_KEY: 'private-omdb', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'public-anon' };
  let requests = 0;
  const server = createWebServer({ root, env, fetchImpl: async (url, options) => {
    requests++;
    assert.equal(url.hostname, 'api.themoviedb.org');
    assert.equal(options.headers.Authorization, 'Bearer private-tmdb');
    return new Response('{"results":[]}');
  } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base + '/')).status, 200);
    const config = await (await fetch(base + '/env.js')).text();
    assert.ok(config.includes('public-anon'));
    assert.ok(!config.includes('private-'));
    assert.equal((await fetch(base + '/.env')).status, 404);
    assert.equal((await fetch(base + '/package.json')).status, 404);
    assert.equal((await fetch(base + '/api/tmdb/account')).status, 404);
    assert.equal((await fetch(base + '/api/tmdb/movie/550', { method: 'POST' })).status, 405);
    for (let i = 0; i < 2; i++) assert.equal((await fetch(base + '/api/tmdb/movie/550')).status, 200);
    assert.equal(requests, 1);
    assert.equal((await fetch(base + '/healthz')).status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true });
  }
});

test('sports proxy uses fixed public routes and never caches playback tokens', async () => {
  let requests = 0;
  const server = createWebServer({ fetchImpl: async (url, options) => {
    requests++;
    assert.equal(url.hostname, 'api.cameltv.live');
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.redirect, 'error');
    assert.equal(url.searchParams.has('url'), false);
    return new Response('{"status":200,"data":{"txSecret":"public-token"}}');
  } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base + '/api/sports?resource=account')).status, 404);
    assert.equal((await fetch(base + '/api/sports?resource=schedule&date=20260230')).status, 404);
    for (let i = 0; i < 2; i++) {
      const response = await fetch(base + '/api/sports?resource=token&streamName=sd-test&url=https://evil.test');
      assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    assert.equal(requests, 2);
    for (let i = 0; i < 2; i++) assert.equal((await fetch(base + '/api/sports?resource=schedule&date=20261006')).status, 200);
    assert.equal(requests, 3, 'schedules receive a short cache, tokens do not');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('catalog proxy has fixed destinations and owns authentication parameters', () => {
  const env = { OMDB_API_KEY: 'server-key' };
  assert.equal(upstreamFor(new URL('https://app/api/tmdb/https://evil.test'), env), null);
  const request = upstreamFor(new URL('https://app/api/omdb?apikey=attacker&callback=alert&t=Film'), env);
  assert.equal(request.url.hostname, 'www.omdbapi.com');
  assert.equal(request.url.searchParams.get('apikey'), 'server-key');
  assert.equal(request.url.searchParams.has('callback'), false);
});
