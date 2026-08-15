import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const storage = await readFile(new URL('../js/storage.js', import.meta.url), 'utf8');
const sync = await readFile(new URL('../js/sync.js', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/202608150004_lossless_user_data_sync.sql', import.meta.url), 'utf8');

test('history saves are non-destructive and uncapped', () => {
  const body = storage.match(/export async function saveUserHistory\(items\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(body, /syncWatchHistory\(userId, items\)/);
  assert.doesNotMatch(body, /delete\(|slice\(0,\s*(50|200)\)/);
  assert.doesNotMatch(storage, /_cache\.history\.length\s*>\s*200/);
});

test('local personal data is account-scoped and old cache import verifies identity', () => {
  assert.match(storage, /ACCOUNT_PREFIX = 'oc_user_'/);
  assert.match(storage, /legacyIdentity\?\.id === userId/);
});

test('database distinguishes media types and preserves deletion intent and backups', () => {
  assert.match(migration, /unique \(user_id, tmdb_id, media_type\)/i);
  assert.match(migration, /create table if not exists public\.user_data_tombstones/i);
  assert.match(migration, /create table if not exists private\.user_data_backups/i);
  assert.match(sync, /onConflict: 'user_id,tmdb_id,media_type'/);
});
