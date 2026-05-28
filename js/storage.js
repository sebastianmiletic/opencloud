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

function getUserId() {
  return getCurrentAuthUser()?.id || null;
}

/* ─── Init ─── */
export async function initStorage() {
  const userId = getUserId();
  if (!userId) return;

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

  _cache.collection = collection || [];
  _cache.history    = history || [];
  _cache.progress   = progress || {};
  _cache.settings   = settings || { device: 'laptop', provider: 'videasy', autoPlay: true, folders: [] };
  _cache.folders    = settings?.folders || [];

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
}

export async function addToUserCollection(item) {
  const userId = getUserId();
  if (!userId) return false;
  const normalized = {
    id: item.id,
    media_type: item.media_type,
    title: item.title,
    year: item.year,
    poster_path: item.poster_path,
    vote_average: item.vote_average,
    added_at: item.added_at || new Date().toISOString(),
    folder: item.folder || null
  };
  // Optimistic update — memory + state first, guaranteed instant
  const exists = _cache.collection.findIndex(i => i.id === normalized.id);
  if (exists >= 0) _cache.collection[exists] = normalized;
  else _cache.collection.unshift(normalized);
  setUserCollection([..._cache.collection]);

  // Supabase fire-and-forget with silent error handling
  try {
    await syncAddCollection(userId, normalized);
  } catch (err) {
    console.error('[Storage] addToUserCollection Supabase failed:', err);
  }
  return true;
}

export async function removeFromUserCollection(tmdbId) {
  const userId = getUserId();
  if (!userId) return false;
  // Optimistic — remove from local immediately
  _cache.collection = _cache.collection.filter(i => i.id !== tmdbId);
  setUserCollection([..._cache.collection]);

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
  if (!userId || !Array.isArray(items)) return false;
  _cache.history = items;
  setUserHistory(items);
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
      watched_at: item.watched_at || new Date().toISOString()
    }));
    if (batch.length) {
      await supabase.from('watch_history').insert(batch);
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
    title: item.title,
    season: item.season || null,
    episode: item.episode || null,
    duration_watched: item.duration_watched || 0,
    watched_at: new Date().toISOString()
  };
  // Deduplicate and cap — instant
  _cache.history = _cache.history.filter(h => !(h.id === entry.id && h.media_type === entry.media_type));
  _cache.history.unshift(entry);
  if (_cache.history.length > 200) _cache.history = _cache.history.slice(0, 200);
  setUserHistory([..._cache.history]);

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
  const userId = getUserId();
  if (!userId) return false;
  _cache.progress = { ..._cache.progress, ...data };
  setWatchProgress(_cache.progress);
  // Batch sync: we don't write every key individually, the caller should call syncSaveProgress for specific items
  return true;
}

export async function syncWatchProgressItem(tmdbId, mediaType, season, episode, progressSeconds) {
  const userId = getUserId();
  if (!userId) return false;
  _cache.progress[tmdbId] = { season, episode, progress_seconds: progressSeconds };
  setWatchProgress(_cache.progress);
  await syncSaveProgress(userId, { id: tmdbId, media_type: mediaType, season, episode, progress_seconds: progressSeconds });
  return true;
}

/* ─── Folders ─── */
export function getUserFolders() {
  return _cache.folders;
}

export async function saveUserFolders(folders) {
  const userId = getUserId();
  if (!userId) return false;
  _cache.folders = folders;
  setUserFolders(folders);
  await syncSaveFolders(userId, folders);
  return true;
}

/* ─── Settings ─── */
export function getSettings() {
  return _cache.settings || { device: 'laptop', provider: 'vidsrccc', autoPlay: true, beta_ui: false, folders: [] };
}

export async function saveSettings(settings) {
  const userId = getUserId();
  _cache.settings = { ..._cache.settings, ...settings };
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
  const userId = getUserId();
  _cache.profile = { ..._cache.profile, ...profile };
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
