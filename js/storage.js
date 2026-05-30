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

  // Merge Supabase history with local backup metadata
  let backup = [];
  try {
    const raw = localStorage.getItem('oc_history_backup');
    if (raw) backup = JSON.parse(raw);
  } catch (e) { /* ignore */ }
  const backupMap = new Map();
  (Array.isArray(backup) ? backup : []).forEach(b => {
    if (b?.id) backupMap.set(`${b.id}::${b.media_type}`, b);
  });

  if (history?.length > 0) {
    const seen = new Set();
    _cache.history = (history || []).map(h => {
      const key = `${h.id}::${h.media_type}`;
      seen.add(key);
      const b = backupMap.get(key);
      if (b) {
        return {
          ...h,
          poster_path: h.poster_path || b.poster_path || null,
          vote_average: h.vote_average != null ? h.vote_average : (b.vote_average || 0),
          year: h.year || b.year || null
        };
      }
      return h;
    }).filter(h => !!h.id);
  }

  if (progress && Object.keys(progress).length > 0) {
    _cache.progress = progress;
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
    vote_average: item.vote_average || 0,
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
      vote_average: item.vote_average || 0,
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
    vote_average: item.vote_average || 0,
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
  _cache.progress[tmdbId] = { season, episode, progress_seconds: progressSeconds };
  setWatchProgress(_cache.progress);
  persistLocalCache();
  const userId = getUserId();
  if (!userId) return true;
  await syncSaveProgress(userId, { id: tmdbId, media_type: mediaType, season, episode, progress_seconds: progressSeconds });
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
