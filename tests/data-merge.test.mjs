import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeDataItems, mergeProgressMaps, mergeTombstones } from '../js/data-merge.js';

test('history merge keeps local-only, remote-only, newest time, and rich metadata', () => {
  const local = [
    { id: 1, media_type: 'movie', title: 'Local only', watched_at: '2026-08-01T00:00:00Z' },
    { id: 2, media_type: 'movie', title: 'Rich title', poster_path: '/poster.jpg', watched_at: '2026-08-01T00:00:00Z' }
  ];
  const remote = [
    { id: 2, media_type: 'movie', title: 'Unknown', watched_at: '2026-08-02T00:00:00Z' },
    { id: 3, media_type: 'tv', title: 'Remote only', watched_at: '2026-08-03T00:00:00Z' }
  ];
  const merged = mergeDataItems(local, remote, { timestampField: 'watched_at', dataType: 'history' });
  assert.deepEqual(merged.map(item => item.id), [3, 2, 1]);
  assert.equal(merged.find(item => item.id === 2).title, 'Rich title');
  assert.equal(merged.find(item => item.id === 2).poster_path, '/poster.jpg');
});

test('a deletion wins until the item is explicitly re-added later', () => {
  const tombstone = { data_type: 'collection', tmdb_id: 9, media_type: 'movie', deleted_at: '2026-08-02T00:00:00Z' };
  const deleted = mergeDataItems(
    [{ id: 9, media_type: 'movie', title: 'Old', added_at: '2026-08-01T00:00:00Z' }],
    [],
    { timestampField: 'added_at', dataType: 'collection', tombstones: [tombstone] }
  );
  assert.equal(deleted.length, 0);

  const restored = mergeDataItems(
    [{ id: 9, media_type: 'movie', title: 'New', added_at: '2026-08-03T00:00:00Z' }],
    [],
    { timestampField: 'added_at', dataType: 'collection', tombstones: [tombstone] }
  );
  assert.equal(restored.length, 1);
});

test('tombstones are deduplicated by type, media type, and id', () => {
  const merged = mergeTombstones(
    [{ data_type: 'history', tmdb_id: 5, media_type: 'tv', deleted_at: '2026-08-01T00:00:00Z' }],
    [{ data_type: 'history', tmdb_id: 5, media_type: 'tv', deleted_at: '2026-08-02T00:00:00Z' }]
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].deleted_at, '2026-08-02T00:00:00Z');
});

test('progress merge keeps local-only titles and episode checkpoints from both sides', () => {
  const merged = mergeProgressMaps(
    {
      1: { mediaType: 'tv', updated_at: '2026-08-02T00:00:00Z', episodes: { s1e1: { playbackSeconds: 50, updated_at: '2026-08-01T00:00:00Z' } } },
      2: { mediaType: 'movie', playbackSeconds: 90 }
    },
    {
      1: { mediaType: 'tv', updated_at: '2026-08-03T00:00:00Z', episodes: { s1e2: { playbackSeconds: 10, updated_at: '2026-08-03T00:00:00Z' } } },
      3: { mediaType: 'movie', playbackSeconds: 20 }
    }
  );
  assert.deepEqual(Object.keys(merged), ['1', '2', '3']);
  assert.deepEqual(Object.keys(merged[1].episodes).sort(), ['s1e1', 's1e2']);
});
