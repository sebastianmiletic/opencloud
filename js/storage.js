/** Storage Module — Supabase-backed with in-memory state */
import {
  fetchCollection, syncCollection, addToCollection as syncAddCollection, removeFromCollection as syncRemoveCollection,
  fetchWatchHistory, syncWatchHistory, addWatchHistory as syncAddHistory, removeWatchHistory as syncRemoveHistory,
  fetchWatchProgress, saveWatchProgress as syncSaveProgress,
  fetchUserSettings, saveUserSettings as syncSaveSettings,
  fetchFolders, saveFolders as syncSaveFolders,
  fetchWatchSessions, recordWatchSession as syncRecordSession,
  updateProfile, fetchDataTombstones, syncDataTombstones, clearDataTombstone, backupMyUserData
} from './sync.js';
import { getCurrentAuthUser } from './auth.js';
import {
  setUserCollection, setUserHistory, setWatchProgress, setUserFolders
} from './state.js';
import { episodeProgressKey } from './playback-progress.js';
import { inferProgressMediaType, mergeDataItems, mergeProgressMaps, mergeTombstones, newerThanTombstone } from './data-merge.js';

/* Lazy imports to avoid circular deps */
let _api = null;
async function getAPI() {
  if (!_api) {
    const [{ fetchWithAuth }, { BASE_URL }] = await Promise.all([
      import('./api.js'),
      import('./config.js')
    ]);
    _api = { fetchWithAuth, BASE_URL };
  }
  return _api;
}

// In-memory state cache (hydrated from Supabase on login)
let _cache = {
  collection: [],
  history: [],
  progress: {},
  folders: [],
  settings: null,
  profile: null,
  tombstones: []
};

const LOCAL_PREFIX = 'oc_local_';
const ACCOUNT_PREFIX = 'oc_user_';
const _progressSyncChains = new Map();
let _activeLocalPrefix = null;
let _pendingLegacyMigrationKey = null;

function readLocalJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch (e) {
    return fallback;
  }
}

function loadLocalCache(userId) {
  _activeLocalPrefix = userId ? `${ACCOUNT_PREFIX}${userId}_` : null;
  _pendingLegacyMigrationKey = null;
  if (!_activeLocalPrefix) {
    _cache = { collection: [], history: [], progress: {}, folders: [], settings: null, profile: null, tombstones: [] };
    return;
  }

  _cache.collection = readLocalJson(_activeLocalPrefix + 'collection', []);
  _cache.history = readLocalJson(_activeLocalPrefix + 'history', []);
  _cache.progress = readLocalJson(_activeLocalPrefix + 'progress', {});
  _cache.folders = readLocalJson(_activeLocalPrefix + 'folders', []);
  _cache.settings = readLocalJson(_activeLocalPrefix + 'settings', null);
  _cache.tombstones = readLocalJson(_activeLocalPrefix + 'tombstones', []);

  // One-time import of the old unscoped cache, but only for the account that created it.
  const migrationKey = _activeLocalPrefix + 'legacy_imported_v1';
  const legacyIdentity = readLocalJson(LOCAL_PREFIX + 'identity', null);
  if (!localStorage.getItem(migrationKey) && legacyIdentity?.id === userId) {
    _cache.collection = mergeDataItems(
      _cache.collection,
      readLocalJson(LOCAL_PREFIX + 'collection', []),
      { timestampField: 'added_at', dataType: 'collection', tombstones: _cache.tombstones }
    );
    _cache.history = mergeDataItems(
      _cache.history,
      readLocalJson(LOCAL_PREFIX + 'history', []),
      { timestampField: 'watched_at', dataType: 'history', tombstones: _cache.tombstones }
    );
    _cache.progress = { ...readLocalJson(LOCAL_PREFIX + 'progress', {}), ..._cache.progress };
    _cache.folders = [...new Set([...readLocalJson(LOCAL_PREFIX + 'folders', []), ..._cache.folders])];
    _cache.settings = _cache.settings || readLocalJson(LOCAL_PREFIX + 'settings', null);
    _pendingLegacyMigrationKey = migrationKey;
  }
}

function persistLocalCache() {
  if (!_activeLocalPrefix) return;
  try {
    localStorage.setItem(_activeLocalPrefix + 'collection', JSON.stringify(_cache.collection));
    localStorage.setItem(_activeLocalPrefix + 'history', JSON.stringify(_cache.history));
    localStorage.setItem(_activeLocalPrefix + 'progress', JSON.stringify(_cache.progress));
    localStorage.setItem(_activeLocalPrefix + 'folders', JSON.stringify(_cache.folders));
    localStorage.setItem(_activeLocalPrefix + 'tombstones', JSON.stringify(_cache.tombstones));
    if (_cache.settings) localStorage.setItem(_activeLocalPrefix + 'settings', JSON.stringify(_cache.settings));
    if (_pendingLegacyMigrationKey) {
      localStorage.setItem(_pendingLegacyMigrationKey, new Date().toISOString());
      _pendingLegacyMigrationKey = null;
    }
  } catch (e) {
    console.warn('[Storage] local cache persistence failed:', e);
  }
}

function getUserId() {
  return getCurrentAuthUser()?.id || null;
}

async function syncProgressInOrder(userId, item) {
  const key = `${userId}:${item.id}`;
  const previous = _progressSyncChains.get(key) || Promise.resolve();
  const current = previous
    .catch(() => {})
    .then(() => syncSaveProgress(userId, item));
  _progressSyncChains.set(key, current);
  try {
    return await current;
  } finally {
    if (_progressSyncChains.get(key) === current) _progressSyncChains.delete(key);
  }
}

/* ─── Init ─── */
export async function initStorage() {
  const userId = getUserId();
  // Personal caches are account-scoped so signing between accounts cannot mix data.
  loadLocalCache(userId);
  if (!userId) {
    setUserCollection(_cache.collection);
    setUserHistory(_cache.history);
    setWatchProgress(_cache.progress);
    setUserFolders(_cache.folders);
    return;
  }

  const results = await Promise.allSettled([
    fetchCollection(userId),
    fetchWatchHistory(userId),
    fetchWatchProgress(userId),
    fetchUserSettings(userId),
    fetchDataTombstones(userId),
    backupMyUserData()
  ]);

  const [collectionRes, historyRes, progressRes, settingsRes, tombstonesRes] = results;

  const collection = collectionRes.status === 'fulfilled' ? collectionRes.value : [];
  const history    = historyRes.status    === 'fulfilled' ? historyRes.value    : [];
  const progress   = progressRes.status   === 'fulfilled' ? progressRes.value   : {};
  const settings   = settingsRes.status   === 'fulfilled' ? settingsRes.value   : null;
  const remoteTombstones = tombstonesRes.status === 'fulfilled' ? tombstonesRes.value : [];

  _cache.tombstones = mergeTombstones(_cache.tombstones, remoteTombstones);
  _cache.collection = mergeDataItems(_cache.collection, collection, {
    timestampField: 'added_at', dataType: 'collection', tombstones: _cache.tombstones
  }).filter(item => item.title && item.title !== 'Unknown');
  _cache.history = mergeDataItems(_cache.history, history, {
    timestampField: 'watched_at', dataType: 'history', tombstones: _cache.tombstones
  }).filter(item => !!item.id);

  // Repair either side from the union. These operations never clear a table first.
  await Promise.allSettled([
    syncDataTombstones(userId, _cache.tombstones),
    syncCollection(userId, _cache.collection),
    syncWatchHistory(userId, _cache.history)
  ]);

  // A later explicit re-add supersedes and clears an older deletion marker.
  const staleTombstones = _cache.tombstones.filter(tombstone => {
    const items = tombstone.data_type === 'collection' ? _cache.collection : _cache.history;
    const field = tombstone.data_type === 'collection' ? 'added_at' : 'watched_at';
    const item = items.find(candidate => Number(candidate.id) === Number(tombstone.tmdb_id)
      && candidate.media_type === tombstone.media_type);
    return item && newerThanTombstone(item, field, tombstone);
  });
  await Promise.allSettled(staleTombstones.map(tombstone => clearDataTombstone(
    userId, tombstone.data_type, tombstone.tmdb_id, tombstone.media_type
  )));
  if (staleTombstones.length) {
    const staleKeys = new Set(staleTombstones.map(t => `${t.data_type}:${t.tmdb_id}:${t.media_type}`));
    _cache.tombstones = _cache.tombstones.filter(t => !staleKeys.has(`${t.data_type}:${t.tmdb_id}:${t.media_type}`));
  }

  _cache.progress = mergeProgressMaps(_cache.progress, progress);
  await Promise.allSettled(Object.entries(_cache.progress).map(([id, item]) => {
    const mediaType = inferProgressMediaType({ ...item, id }, _cache.history, _cache.collection);
    item.mediaType = mediaType;
    return syncProgressInOrder(userId, {
      id,
      media_type: mediaType,
      season: item.season ?? null,
      episode: item.episode ?? null,
      progress_seconds: Math.max(0, Math.round(Number(item.playbackSeconds ?? item.progress_seconds) || 0)),
      duration_seconds: Math.max(0, Math.round(Number(item.durationSeconds) || 0)),
      episodes: item.episodes || {}
    });
  }));
  if (settings) {
    _cache.settings = settings || { device: 'laptop', provider: 'videasy', autoPlay: true, folders: [] };
    _cache.folders = settings?.folders || [];
  }

  persistLocalCache();

  setUserCollection(_cache.collection);
  setUserHistory(_cache.history);
  setWatchProgress(_cache.progress);
  setUserFolders(_cache.folders);
}

/* ─── Collections ─── */
export function getUserCollection() {
  return _cache.collection;
}

export async function saveUserCollection(items) {
  _cache.collection = items;
  setUserCollection(items);
  persistLocalCache();
  const userId = getUserId();
  if (userId) return syncCollection(userId, items);
  return true;
}

export async function addToUserCollection(item) {
  const userId = getUserId();
  if (!userId) return false;
  const normalized = {
    id: item.id,
    media_type: item.media_type,
    title: item.title || item.name || 'Unknown',
    year: item.year || (item.release_date || item.first_air_date || '').slice(0, 4) || null,
    poster_path: item.poster_path || null,
    vote_average: item.vote_average != null ? item.vote_average : null,
    added_at: item.added_at || new Date().toISOString(),
    folder: item.folder || null
  };
  _cache.tombstones = _cache.tombstones.filter(t => !(t.data_type === 'collection'
    && Number(t.tmdb_id) === Number(normalized.id) && t.media_type === normalized.media_type));
  // Optimistic update — memory + state first, guaranteed instant
  const exists = _cache.collection.findIndex(i => i.id === normalized.id && i.media_type === normalized.media_type);
  if (exists >= 0) _cache.collection[exists] = normalized;
  else _cache.collection.unshift(normalized);
  setUserCollection([..._cache.collection]);
  persistLocalCache();

  // Supabase fire-and-forget with silent error handling
  try {
    await syncAddCollection(userId, normalized);
  } catch (err) {
    console.error('[Storage] addToUserCollection Supabase failed:', err);
  }
  return true;
}

export async function removeFromUserCollection(tmdbId, mediaType) {
  const userId = getUserId();
  if (!userId) return false;
  const deletedAt = new Date().toISOString();
  _cache.tombstones = mergeTombstones(_cache.tombstones, [{
    data_type: 'collection', tmdb_id: tmdbId, media_type: mediaType, deleted_at: deletedAt
  }]);
  // Optimistic — remove from local immediately
  _cache.collection = _cache.collection.filter(i => !(i.id === tmdbId && i.media_type === mediaType));
  setUserCollection([..._cache.collection]);
  persistLocalCache();

  // Supabase in background
  try {
    await syncRemoveCollection(userId, tmdbId, mediaType);
  } catch (err) {
    console.error('[Storage] removeFromUserCollection Supabase failed:', err);
  }
  return true;
}

/* ─── History ─── */
export function getUserHistory() {
  return _cache.history;
}

export async function saveUserHistory(items) {
  const userId = getUserId();
  if (!Array.isArray(items)) return false;
  _cache.history = items;
  setUserHistory(items);
  persistLocalCache();
  if (!userId) return false;
  return syncWatchHistory(userId, items);
}

export async function addToUserHistory(item) {
  const userId = getUserId();
  if (!userId) return false;
  const entry = {
    id: item.id,
    media_type: item.media_type,
    title: item.title || item.name || 'Unknown',
    season: item.season || null,
    episode: item.episode || null,
    duration_watched: item.duration_watched || 0,
    poster_path: item.poster_path || null,
    vote_average: item.vote_average != null ? item.vote_average : null,
    year: item.year || (item.release_date || item.first_air_date || '').slice(0, 4) || null,
    watched_at: new Date().toISOString()
  };
  _cache.tombstones = _cache.tombstones.filter(t => !(t.data_type === 'history'
    && Number(t.tmdb_id) === Number(entry.id) && t.media_type === entry.media_type));
  // Deduplicate without truncating the user's history.
  _cache.history = _cache.history.filter(h => !(h.id === entry.id && h.media_type === entry.media_type));
  _cache.history.unshift(entry);
  setUserHistory([..._cache.history]);
  persistLocalCache();

  // Supabase in background with silent failure
  try {
    await syncAddHistory(userId, entry);
  } catch (err) {
    console.error('[Storage] addToUserHistory Supabase failed:', err);
  }
  return true;
}

export async function removeFromUserHistory(tmdbId, mediaType) {
  const userId = getUserId();
  if (!userId) return false;
  const deletedAt = new Date().toISOString();
  _cache.tombstones = mergeTombstones(_cache.tombstones, [{
    data_type: 'history', tmdb_id: tmdbId, media_type: mediaType, deleted_at: deletedAt
  }]);
  _cache.history = _cache.history.filter(h => !(h.id === tmdbId && h.media_type === mediaType));
  setUserHistory([..._cache.history]);

  // Also remove progress
  delete _cache.progress[tmdbId];
  setWatchProgress({ ..._cache.progress });
  persistLocalCache();

  try {
    await syncRemoveHistory(userId, tmdbId, mediaType);
    await syncSaveProgress(userId, { id: tmdbId, media_type: mediaType, progress_seconds: 0 });
  } catch (err) {
    console.error('[Storage] removeFromUserHistory Supabase failed:', err);
  }
  return true;
}

/* ─── Background Metadata Hydration ─── */
async function _hydrateItems(items, type) {
  const { fetchWithAuth, BASE_URL } = await getAPI();
  const batchSize = 5;
  let changed = false;
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.all(batch.map(async (item) => {
      try {
        const url = `${BASE_URL}/${item.media_type}/${item.id}?language=en-US`;
        const data = await fetchWithAuth(url);
        if (data) {
          const newPoster = data.poster_path || item.poster_path || null;
          const newRating = data.vote_average != null ? data.vote_average : item.vote_average;
          const newYear = item.year || (data.release_date || data.first_air_date || '').slice(0, 4) || null;
          const newTitle = item.title || data.title || data.name || 'Unknown';
          if (newPoster !== item.poster_path || newRating !== item.vote_average || newYear !== item.year) {
            item.poster_path = newPoster;
            item.vote_average = newRating;
            item.year = newYear;
            item.title = newTitle;
            changed = true;
          }
        }
      } catch (e) { /* skip failed fetches */ }
    }));
  }
  return changed;
}

export async function hydrateHistoryMetadata() {
  const thin = _cache.history.filter(h =>
    !h.poster_path ||
    h.vote_average == null ||
    h.vote_average === 0
  );
  if (!thin.length) return;
  const changed = await _hydrateItems(thin, 'history');
  if (changed) {
    setUserHistory([..._cache.history]);
    persistLocalCache();
  }
}

export async function hydrateCollectionMetadata() {
  const thin = _cache.collection.filter(c =>
    !c.poster_path ||
    c.vote_average == null ||
    c.vote_average === 0
  );
  if (!thin.length) return;
  const changed = await _hydrateItems(thin, 'collection');
  if (changed) {
    setUserCollection([..._cache.collection]);
    persistLocalCache();
  }
}

/* ─── Progress ─── */
export function getWatchProgress() {
  return _cache.progress;
}

export async function saveWatchProgress(data) {
  _cache.progress = { ..._cache.progress, ...data };
  setWatchProgress(_cache.progress);
  persistLocalCache();
  return true;
}

export async function syncWatchProgressItem(tmdbId, mediaType, season, episode, progressSeconds) {
  const sid = String(tmdbId);
  const existing = _cache.progress[sid] || {};
  const seconds = Math.max(0, Math.round(Number(progressSeconds) || 0));
  const updatedAt = new Date().toISOString();
  const episodeKey = mediaType === 'tv' ? episodeProgressKey(season, episode) : null;
  const exactLocalSeconds = Number(
    episodeKey
      ? existing.episodes?.[episodeKey]?.playbackSeconds
      : existing.playbackSeconds
  );
  const localSeconds = Number.isFinite(exactLocalSeconds) && Math.abs(exactLocalSeconds - seconds) < 1
    ? exactLocalSeconds
    : seconds;
  const selectedDuration = Math.max(0, Number(
    episodeKey
      ? existing.episodes?.[episodeKey]?.durationSeconds
      : existing.durationSeconds
  ) || 0);
  const next = {
    ...existing,
    mediaType,
    season,
    episode,
    playbackSeconds: localSeconds,
    progress_seconds: seconds,
    durationSeconds: selectedDuration,
    elapsedMinutes: mediaType === 'tv' ? localSeconds / 60 : existing.elapsedMinutes,
    episodeRuntime: mediaType === 'tv' && selectedDuration > 0 ? selectedDuration / 60 : null,
    updated_at: updatedAt
  };
  if (mediaType === 'tv') {
    next.episodes = {
      ...(existing.episodes || {}),
      [episodeKey]: {
        ...(existing.episodes?.[episodeKey] || {}),
        playbackSeconds: localSeconds,
        progress_seconds: seconds,
        updated_at: updatedAt
      }
    };
  }
  _cache.progress[sid] = next;
  setWatchProgress(_cache.progress);
  persistLocalCache();
  const userId = getUserId();
  if (!userId) return true;
  await syncProgressInOrder(userId, {
    id: tmdbId, media_type: mediaType, season, episode, progress_seconds: seconds,
    duration_seconds: Math.max(0, Math.round(Number(next.durationSeconds) || 0)),
    episodes: next.episodes || {}
  });
  return true;
}

/* ─── Folders ─── */
export function getUserFolders() {
  return _cache.folders;
}

export async function saveUserFolders(folders) {
  _cache.folders = folders;
  setUserFolders(folders);
  persistLocalCache();
  const userId = getUserId();
  if (!userId) return true;
  await syncSaveFolders(userId, folders);
  return true;
}

/* ─── Settings ─── */
export function getSettings() {
  return _cache.settings || { device: 'laptop', provider: 'vidsrccc', autoPlay: true, beta_ui: false, folders: [] };
}

export async function saveSettings(settings) {
  _cache.settings = { ..._cache.settings, ...settings };
  persistLocalCache();
  const userId = getUserId();
  if (userId) {
    await syncSaveSettings(userId, _cache.settings);
  }
  return true;
}

/* ─── Profile ─── */
export function getLocalProfile() {
  return _cache.profile || {};
}

export async function saveLocalProfile(profile) {
  _cache.profile = { ..._cache.profile, ...profile };
  persistLocalCache();
  const userId = getUserId();
  if (userId) {
    const updates = {};
    if (profile.username !== undefined) updates.username = profile.username;
    if (profile.avatar_url !== undefined) updates.avatar_url = profile.avatar_url;
    if (profile.avatar_color !== undefined) updates.avatar_color = profile.avatar_color;
    if (Object.keys(updates).length > 0) {
      await updateProfile(userId, updates);
    }
  }
  return true;
}

/* ─── Watch Sessions ─── */
export async function recordWatchSession(session) {
  const userId = getUserId();
  if (!userId) return false;
  await syncRecordSession(userId, session);
  return true;
}

export async function getWatchSessions(days = 365) {
  const userId = getUserId();
  if (!userId) return [];
  return await fetchWatchSessions(userId, days);
}

/* ─── OMDB Cache (non-user data, can stay local) ─── */
export function getOMDBCache() {
  try {
    return JSON.parse(localStorage.getItem('openccloud_omdb_cache')) || {};
  } catch (e) {
    return {};
  }
}

export function setOMDBCache(key, value) {
  const cache = getOMDBCache();
  cache[key] = { value, ts: Date.now() };
  localStorage.setItem('openccloud_omdb_cache', JSON.stringify(cache));
}

/* ─── Old local account helpers (deprecated, keep for compatibility) ─── */
export function getAccounts() { return []; }
export function saveAccounts(data) {}
export function getCurrentUser() { return getCurrentAuthUser()?.email?.split('@')[0] || 'User'; }
export function setCurrentUser(user) {}

/* ─── Privacy reset (one-time cleanup of old localStorage) ─── */
const PRIVACY_RESET_KEY = 'openccloud_privacy_reset_v3';
export function runOneTimePrivacyReset() {
  if (localStorage.getItem(PRIVACY_RESET_KEY)) return;
  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('openccloud_user_')) keysToRemove.push(key);
  }
  keysToRemove.forEach(key => localStorage.removeItem(key));
  localStorage.removeItem('openccloud_accounts');
  localStorage.removeItem('openccloud_current_user');
  localStorage.setItem(PRIVACY_RESET_KEY, new Date().toISOString());
}
