const PLACEHOLDER_TITLES = new Set(['', 'unknown', 'untitled']);

export function dataItemKey(item) {
  if (!item || item.id == null || !item.media_type) return null;
  return `${Number(item.id)}::${item.media_type}`;
}

function timestamp(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function useful(value, field) {
  if (value == null || value === '') return false;
  if (field === 'title') return !PLACEHOLDER_TITLES.has(String(value).trim().toLowerCase());
  if (field === 'vote_average' || field === 'duration_watched') return Number(value) > 0;
  return true;
}

function richerItem(older, newer, timestampField) {
  const merged = { ...older, ...newer };
  for (const field of ['title', 'year', 'poster_path', 'vote_average', 'folder']) {
    if (!useful(merged[field], field)) {
      const fallback = useful(newer[field], field) ? newer[field] : older[field];
      if (fallback != null) merged[field] = fallback;
    }
  }
  merged.duration_watched = Math.max(
    Number(older.duration_watched) || 0,
    Number(newer.duration_watched) || 0
  );
  if (timestamp(older[timestampField]) > timestamp(newer[timestampField])) {
    merged[timestampField] = older[timestampField];
  }
  return merged;
}

export function mergeDataItems(localItems, remoteItems, {
  timestampField,
  dataType,
  tombstones = []
}) {
  const merged = new Map();
  for (const item of [...(localItems || []), ...(remoteItems || [])]) {
    const key = dataItemKey(item);
    if (!key) continue;
    const normalized = { ...item, id: Number(item.id) };
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, normalized);
      continue;
    }
    const existingTime = timestamp(existing[timestampField]);
    const candidateTime = timestamp(normalized[timestampField]);
    const newer = candidateTime >= existingTime ? normalized : existing;
    const older = newer === normalized ? existing : normalized;
    merged.set(key, richerItem(older, newer, timestampField));
  }

  const deleted = new Map();
  for (const tombstone of tombstones || []) {
    if (tombstone?.data_type !== dataType) continue;
    const key = dataItemKey({ id: tombstone.tmdb_id ?? tombstone.id, media_type: tombstone.media_type });
    if (!key) continue;
    const previous = deleted.get(key);
    if (!previous || timestamp(tombstone.deleted_at) > timestamp(previous.deleted_at)) {
      deleted.set(key, tombstone);
    }
  }

  return [...merged.entries()]
    .filter(([key, item]) => {
      const tombstone = deleted.get(key);
      return !tombstone || timestamp(item[timestampField]) > timestamp(tombstone.deleted_at);
    })
    .map(([, item]) => item)
    .sort((a, b) => timestamp(b[timestampField]) - timestamp(a[timestampField]));
}

export function mergeTombstones(...groups) {
  const merged = new Map();
  for (const tombstone of groups.flat()) {
    const key = tombstone && `${tombstone.data_type}::${dataItemKey({
      id: tombstone.tmdb_id ?? tombstone.id,
      media_type: tombstone.media_type
    })}`;
    if (!key || key.endsWith('::null')) continue;
    const previous = merged.get(key);
    if (!previous || timestamp(tombstone.deleted_at) > timestamp(previous.deleted_at)) {
      merged.set(key, {
        data_type: tombstone.data_type,
        tmdb_id: Number(tombstone.tmdb_id ?? tombstone.id),
        media_type: tombstone.media_type,
        deleted_at: tombstone.deleted_at
      });
    }
  }
  return [...merged.values()];
}

export function newerThanTombstone(item, timestampField, tombstone) {
  return timestamp(item?.[timestampField]) > timestamp(tombstone?.deleted_at);
}

export function mergeProgressMaps(localProgress, remoteProgress) {
  const merged = {};
  const ids = new Set([...Object.keys(localProgress || {}), ...Object.keys(remoteProgress || {})]);
  for (const id of ids) {
    const local = localProgress?.[id] || {};
    const remote = remoteProgress?.[id] || {};
    const localTime = timestamp(local.updated_at);
    const remoteTime = timestamp(remote.updated_at);
    const newer = localTime > remoteTime ? local : remote;
    const older = newer === local ? remote : local;
    const episodes = { ...(older.episodes || {}) };
    for (const [key, candidate] of Object.entries(newer.episodes || {})) {
      const existing = episodes[key];
      episodes[key] = !existing || timestamp(candidate.updated_at) >= timestamp(existing.updated_at)
        ? { ...existing, ...candidate }
        : { ...candidate, ...existing };
    }
    merged[id] = {
      ...older,
      ...newer,
      episodes,
      playbackSeconds: Number(newer.playbackSeconds ?? newer.progress_seconds
        ?? older.playbackSeconds ?? older.progress_seconds) || 0
    };
  }
  return merged;
}
