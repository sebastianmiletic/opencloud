/** Storage Module — Supabase-backed with in-memory state */
import {
  fetchCollection, addToCollection as syncAddCollection, removeFromCollection as syncRemoveCollection,
  fetchWatchHistory, addWatchHistory as syncAddHistory, removeWatchHistory as syncRemoveHistory,
  fetchWatchProgress, saveWatchProgress as syncSaveProgress,
  fetchUserSettings, saveUserSettings as syncSaveSettings,
  fetchFolders, saveFolders as syncSaveFolders,
  fetchWatchSessions, recordWatchSession as syncRecordSession,
  updateProfile
} from './sync.js';
import { getCurrentAuthUser, getSupabaseClient } from './auth.js';
import {
  setUserCollection, setUserHistory, setWatchProgress, setUserFolders
} from './state.js';
import { episodeProgressKey } from './playback-progress.js';

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
  profile: null
};

const LOCAL_PREFIX = 'oc_local_';
const _progressSyncChains = new Map();

function loadLocalCache() {
  try { _cache.collection = JSON.parse(localStorage.getItem(LOCAL_PREFIX + 'collection')) || []; } catch (e) { _cache.collection = []; }
  try { _cache.history = JSON.parse(localStorage.getItem(LOCAL_PREFIX + 'history')) || []; } catch (e) { _cache.history = []; }
  try { _cache.progress = JSON.parse(localStorage.getItem(LOCAL_PREFIX + 'progress')) || {}; } catch (e) { _cache.progress = {}; }
  try { _cache.folders = JSON.parse(localStorage.getItem(LOCAL_PREFIX + 'folders')) || []; } catch (e) { _cache.folders = []; }
  try { _cache.settings = JSON.parse(localStorage.getItem(LOCAL_PREFIX + 'settings')) || null; } catch (e) { _cache.settings = null; }
}

function persistLocalCache() {
  try {
    localStorage.setItem(LOCAL_PREFIX + 'collection', JSON.stringify(_cache.collection));
    localStorage.setItem(LOCAL_PREFIX + 'history', JSON.stringify(_cache.history));
    localStorage.setItem(LOCAL_PREFIX + 'progress', JSON.stringify(_cache.progress));
    localStorage.setItem(LOCAL_PREFIX + 'folders', JSON.stringify(_cache.folders));
    if (_cache.settings) localStorage.setItem(LOCAL_PREFIX + 'settings', JSON.stringify(_cache.settings));
  } catch (e) {}
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
  // Always start with local data so the app works offline / in local mode
  loadLocalCache();

  const userId = getUserId();
  if (!userId) {
    setUserCollection(_cache.collection);
    setUserHistory(_cache.history);
    setWatchProgress(_cache.progress);
    setUserFolders(_cache.folders);
    return;
  }

  const results = await Promise.allSettled([
    fetchCollection(userId),
    fetchWatchHistory(userId, 200),
    fetchWatchProgress(userId),
    fetchUserSettings(userId)
  ]);

  const [collectionRes, historyRes, progressRes, settingsRes] = results;

  const collection = collectionRes.status === 'fulfilled' ? collectionRes.value : [];
  const history    = historyRes.status    === 'fulfilled' ? historyRes.value    : [];
  const progress   = progressRes.status   === 'fulfilled' ? progressRes.value   : {};
  const settings   = settingsRes.status   === 'fulfilled' ? settingsRes.value   : {};

  // If Supabase returned data, use it (it may be fresher from another device).
  // Otherwise keep the local cache.
  if (collection?.length > 0) {
    _cache.collection = (collection || []).filter(item => item && item.id && item.title && item.title !== 'Unknown');
  }

  // Merge Supabase history with local cache, preserving rich metadata.
  // Local cache has full poster/rating/year from TMDB; Supabase may strip these.
  const localHistoryMap = new Map();
  (_cache.history || []).forEach(h => {
    if (h?.id) localHistoryMap.set(`${h.id}::${h.media_type}`, h);
  });

  if (history?.length > 0) {
    const merged = [];
    const seen = new Set();
    (history || []).forEach(h => {
      const key = `${h.id}::${h.media_type}`;
      if (seen.has(key)) return;
      seen.add(key);
      const local = localHistoryMap.get(key);
      if (local) {
        // Keep the richer metadata from local cache, but use the latest watched_at
        const localDate = new Date(local.watched_at || 0);
        const remoteDate = new Date(h.watched_at || 0);
        merged.push({
          ...local,
          watched_at: remoteDate > localDate ? h.watched_at : local.watched_at,
          season: h.season ?? local.season ?? null,
          episode: h.episode ?? local.episode ?? null,
          duration_watched: h.duration_watched || local.duration_watched || 0,
          // Explicitly keep local poster/rating/year if Supabase stripped them
          poster_path: local.poster_path || h.poster_path || null,
          vote_average: local.vote_average != null ? local.vote_average : (h.vote_average != null ? h.vote_average : null),
          year: local.year || h.year || null,
          title: local.title || h.title || 'Unknown'
        });
      } else {
        // Item from another device — add it even if metadata is thin
        merged.push(h);
      }
    });
    _cache.history = merged.filter(h => !!h.id);
  }

  if (progress && Object.keys(progress).length > 0) {
    const mergedProgress = { ..._cache.progress };
    Object.entries(progress).forEach(([id, remote]) => {
      const local = mergedProgress[id] || {};
      const localTime = Date.parse(local.updated_at || '') || 0;
      const remoteTime = Date.parse(remote.updated_at || '') || 0;
      const newer = localTime > remoteTime ? local : remote;
      const older = newer === local ? remote : local;
      mergedProgress[id] = {
        ...older,
        ...newer,
        episodes: {
          ...(older.episodes || {}),
          ...(newer.episodes || {})
        }
      };
      if (localTime > remoteTime && local.mediaType) {
        syncProgressInOrder(userId, {
          id,
          media_type: local.mediaType,
          season: local.season ?? null,
          episode: local.episode ?? null,
          progress_seconds: Math.max(0, Math.round(Number(local.playbackSeconds ?? local.progress_seconds) || 0))
        }).catch(error => console.warn('[Storage] local progress recovery sync failed:', error));
      }
    });
    _cache.progress = mergedProgress;
  }
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
  // Optimistic — remove from local immediately
  _cache.collection = _cache.collection.filter(i => !(i.id === tmdbId && i.media_type === mediaType));
  setUserCollection([..._cache.collection]);
  persistLocalCache();

  // Supabase in background
  try {
    await syncRemoveCollection(userId, tmdbId);
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
  // Bulk save to Supabase (clear then re-insert)
  const supabase = getSupabaseClient();
  if (!supabase) return false;
  try {
    await supabase.from('watch_history').delete().eq('user_id', userId);
    const batch = items.slice(0, 50).map(item => ({
      user_id: userId,
      tmdb_id: Number(item.id) || 0,
      media_type: item.media_type,
      title: item.title,
      season: item.season || null,
      episode: item.episode || null,
      duration_watched: item.duration_watched || 0,
      poster_path: item.poster_path || null,
      vote_average: item.vote_average != null ? item.vote_average : null,
      year: item.year || null,
      watched_at: item.watched_at || new Date().toISOString()
    }));
    if (batch.length) {
      const { error } = await supabase.from('watch_history').insert(batch);
      if (error) {
        console.warn('[saveUserHistory] Full batch failed, retrying core columns:', error.message);
        const coreBatch = items.slice(0, 50).map(item => ({
          user_id: userId,
          tmdb_id: Number(item.id) || 0,
          media_type: item.media_type,
          title: item.title,
          season: item.season || null,
          episode: item.episode || null,
          duration_watched: item.duration_watched || 0,
          watched_at: item.watched_at || new Date().toISOString()
        }));
        const { error: coreError } = await supabase.from('watch_history').insert(coreBatch);
        if (coreError) throw coreError;
      }
    }
    return true;
  } catch (e) {
    console.error('[saveUserHistory] Supabase save failed:', e);
    return false;
  }
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
  // Deduplicate and cap — instant
  _cache.history = _cache.history.filter(h => !(h.id === entry.id && h.media_type === entry.media_type));
  _cache.history.unshift(entry);
  if (_cache.history.length > 200) _cache.history = _cache.history.slice(0, 200);
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
  _cache.history = _cache.history.filter(h => !(h.id === tmdbId && h.media_type === mediaType));
  setUserHistory([..._cache.history]);

  // Also remove progress
  delete _cache.progress[tmdbId];
  setWatchProgress({ ..._cache.progress });
  persistLocalCache();

  try {
    await syncRemoveHistory(userId, tmdbId);
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
  await syncProgressInOrder(userId, { id: tmdbId, media_type: mediaType, season, episode, progress_seconds: seconds });
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
