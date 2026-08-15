/** Supabase Database Sync Module */
import { showToast } from './utils.js';
import { getSupabaseClient } from './auth.js';

const SUPABASE_URL = (typeof window !== 'undefined' && window.ENV?.SUPABASE_URL) ? window.ENV.SUPABASE_URL : '';
const SUPABASE_ANON_KEY = (typeof window !== 'undefined' && window.ENV?.SUPABASE_ANON_KEY) ? window.ENV.SUPABASE_ANON_KEY : '';

let _fallbackClient = null;

function getClient() {
  // Always use the authenticated client from auth.js so RLS policies pass.
  // auth.js initialises this before any DB calls are made.
  const authClient = getSupabaseClient();
  if (authClient) return authClient;

  // Fallback for edge-cases where auth.js hasn't run yet
  if (!_fallbackClient) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
    if (typeof window.supabase === 'undefined') return null;
    _fallbackClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false }
    });
  }
  return _fallbackClient;
}

/* ─── Collections ─── */

export async function syncCollection(userId, items) {
  const sb = getClient();
  if (!sb || !userId) return false;
  try {
    // Upsert all collection items
    const rows = items.map(item => ({
      user_id: userId,
      tmdb_id: item.id,
      media_type: item.media_type,
      title: item.title,
      year: item.year || null,
      poster_path: item.poster_path || null,
      vote_average: item.vote_average || 0,
      added_at: item.added_at || new Date().toISOString(),
      folder: item.folder || null
    }));
    if (!rows.length) return true;
    const { error } = await sb.from('collections').upsert(rows, { onConflict: 'user_id,tmdb_id,media_type' });
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Sync] collections failed:', err);
    return false;
  }
}

export async function fetchCollection(userId) {
  const sb = getClient();
  if (!sb || !userId) return [];
  try {
    const { data, error } = await sb
      .from('collections')
      .select('*')
      .eq('user_id', userId)
      .order('added_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(row => ({
      id: row.tmdb_id,
      media_type: row.media_type,
      title: row.title,
      year: row.year,
      poster_path: row.poster_path,
      vote_average: row.vote_average,
      added_at: row.added_at,
      folder: row.folder || null
    }));
  } catch (err) {
    console.error('[Sync] fetch collection failed:', err);
    return [];
  }
}

export async function addToCollection(userId, item) {
  const sb = getClient();
  if (!sb || !userId) return false;
  try {
    await clearDataTombstone(userId, 'collection', item.id, item.media_type);
    const { error } = await sb.from('collections').upsert({
      user_id: userId,
      tmdb_id: item.id,
      media_type: item.media_type,
      title: item.title,
      year: item.year || null,
      poster_path: item.poster_path || null,
      vote_average: item.vote_average || 0,
      added_at: item.added_at || new Date().toISOString(),
      folder: item.folder || null
    }, { onConflict: 'user_id,tmdb_id,media_type' });
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Sync] add to collection failed:', err);
    return false;
  }
}

export async function removeFromCollection(userId, tmdbId, mediaType) {
  const sb = getClient();
  if (!sb || !userId) return false;
  try {
    const recorded = await recordDataTombstone(userId, 'collection', tmdbId, mediaType);
    if (!recorded) throw new Error('Could not record collection deletion');
    const { error } = await sb.from('collections').delete()
      .eq('user_id', userId).eq('tmdb_id', tmdbId).eq('media_type', mediaType);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Sync] remove from collection failed:', err);
    return false;
  }
}

/* ─── Watch History ─── */

export async function addWatchHistory(userId, item) {
  const sb = getClient();
  if (!sb || !userId) return false;
  try {
    await clearDataTombstone(userId, 'history', item.id, item.media_type);
    const row = {
      user_id: userId,
      tmdb_id: item.id,
      media_type: item.media_type,
      title: item.title,
      season: item.season || null,
      episode: item.episode || null,
      duration_watched: item.duration_watched || 0,
      poster_path: item.poster_path || null,
      vote_average: item.vote_average || 0,
      year: item.year || null,
      watched_at: item.watched_at || new Date().toISOString()
    };
    const { error } = await sb.from('watch_history')
      .upsert(row, { onConflict: 'user_id,tmdb_id,media_type' });
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Sync] add watch history failed:', err);
    return false;
  }
}

export async function syncWatchHistory(userId, items) {
  const sb = getClient();
  if (!sb || !userId) return false;
  const rows = (items || []).map(item => ({
    user_id: userId,
    tmdb_id: Number(item.id),
    media_type: item.media_type,
    title: item.title || 'Unknown',
    season: item.season ?? null,
    episode: item.episode ?? null,
    duration_watched: Number(item.duration_watched) || 0,
    poster_path: item.poster_path || null,
    vote_average: item.vote_average || 0,
    year: item.year || null,
    watched_at: item.watched_at || new Date().toISOString()
  })).filter(row => row.tmdb_id && row.media_type);
  if (!rows.length) return true;
  try {
    const { error } = await sb.from('watch_history')
      .upsert(rows, { onConflict: 'user_id,tmdb_id,media_type' });
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Sync] history batch failed:', err);
    return false;
  }
}

export async function fetchWatchHistory(userId, limit = null) {
  const sb = getClient();
  if (!sb || !userId) return [];
  try {
    let query = sb
      .from('watch_history')
      .select('*')
      .eq('user_id', userId)
      .order('watched_at', { ascending: false });
    if (Number.isFinite(limit) && limit > 0) query = query.limit(limit);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(row => ({
      id: row.tmdb_id,
      media_type: row.media_type,
      title: row.title,
      season: row.season,
      episode: row.episode,
      duration_watched: row.duration_watched,
      poster_path: row.poster_path,
      vote_average: row.vote_average,
      year: row.year,
      watched_at: row.watched_at
    }));
  } catch (err) {
    console.error('[Sync] fetch watch history failed:', err);
    return [];
  }
}

/* ─── Lossless sync tombstones and backups ─── */

export async function fetchDataTombstones(userId) {
  const sb = getClient();
  if (!sb || !userId) return [];
  const { data, error } = await sb.from('user_data_tombstones').select('*').eq('user_id', userId);
  if (error) throw error;
  return data || [];
}

export async function syncDataTombstones(userId, tombstones) {
  const sb = getClient();
  if (!sb || !userId || !tombstones?.length) return true;
  const rows = tombstones.map(item => ({
    user_id: userId,
    data_type: item.data_type,
    tmdb_id: Number(item.tmdb_id ?? item.id),
    media_type: item.media_type,
    deleted_at: item.deleted_at || new Date().toISOString()
  }));
  const { error } = await sb.from('user_data_tombstones')
    .upsert(rows, { onConflict: 'user_id,data_type,tmdb_id,media_type' });
  if (error) throw error;
  return true;
}

export async function recordDataTombstone(userId, dataType, tmdbId, mediaType, deletedAt = new Date().toISOString()) {
  try {
    return await syncDataTombstones(userId, [{ data_type: dataType, tmdb_id: tmdbId, media_type: mediaType, deleted_at: deletedAt }]);
  } catch (err) {
    console.error('[Sync] record deletion failed:', err);
    return false;
  }
}

export async function clearDataTombstone(userId, dataType, tmdbId, mediaType) {
  const sb = getClient();
  if (!sb || !userId) return false;
  const { error } = await sb.from('user_data_tombstones').delete()
    .eq('user_id', userId)
    .eq('data_type', dataType)
    .eq('tmdb_id', tmdbId)
    .eq('media_type', mediaType);
  if (error) throw error;
  return true;
}

export async function backupMyUserData() {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('backup_my_user_data');
  if (error) throw error;
  return data;
}

/* ─── Watch Progress ─── */

export async function saveWatchProgress(userId, item) {
  const sb = getClient();
  if (!sb || !userId) return false;
  try {
    const { error } = await sb.from('watch_progress').upsert({
      user_id: userId,
      tmdb_id: item.id,
      media_type: item.media_type,
      season: item.season || null,
      episode: item.episode || null,
      progress_seconds: item.progress_seconds || 0,
      duration_seconds: item.duration_seconds || 0,
      episode_progress: item.episodes || {},
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,tmdb_id' });
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Sync] save progress failed:', err);
    return false;
  }
}

export async function fetchWatchProgress(userId) {
  const sb = getClient();
  if (!sb || !userId) return {};
  try {
    const { data, error } = await sb
      .from('watch_progress')
      .select('*')
      .eq('user_id', userId);
    if (error) throw error;
    const map = {};
    (data || []).forEach(row => {
      const progress = {
        mediaType: row.media_type,
        season: row.season,
        episode: row.episode,
        playbackSeconds: row.progress_seconds,
        progress_seconds: row.progress_seconds,
        durationSeconds: row.duration_seconds || 0,
        elapsedMinutes: row.media_type === 'tv' ? (Number(row.progress_seconds) || 0) / 60 : undefined,
        updated_at: row.updated_at,
        episodes: row.episode_progress || {}
      };
      if (row.media_type === 'tv' && row.season != null && row.episode != null) {
        progress.episodes = {
          ...(progress.episodes || {}),
          [`s${Number(row.season) || 1}e${Number(row.episode) || 1}`]: {
            playbackSeconds: row.progress_seconds,
            progress_seconds: row.progress_seconds,
            updated_at: row.updated_at
          }
        };
      }
      map[row.tmdb_id] = progress;
    });
    return map;
  } catch (err) {
    console.error('[Sync] fetch progress failed:', err);
    return {};
  }
}

/* ─── Settings ─── */

export async function saveUserSettings(userId, settings) {
  const sb = getClient();
  if (!sb || !userId) return false;
  try {
    const { error } = await sb.from('user_settings').upsert({
      user_id: userId,
      device: settings.device || 'laptop',
      provider: settings.provider || 'vidsrccc',
      auto_play: settings.autoPlay !== false,
      folders: settings.folders || [],
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Sync] save settings failed:', err);
    return false;
  }
}

export async function fetchUserSettings(userId) {
  const sb = getClient();
  if (!sb || !userId) return null;
  try {
    const { data, error } = await sb
      .from('user_settings')
      .select('*')
      .eq('user_id', userId)
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    if (!data) return null;
    return {
      device: data.device,
      provider: data.provider,
      autoPlay: data.auto_play,
      folders: data.folders || []
    };
  } catch (err) {
    console.error('[Sync] fetch settings failed:', err);
    return null;
  }
}

/* ─── Account access and owner Dev RPCs ─── */

async function callRpc(name, params = {}) {
  const sb = getClient();
  if (!sb) throw new Error('Authentication client is unavailable');
  const { data, error } = await sb.rpc(name, params);
  if (error) throw error;
  return data;
}

export async function getMyAccess() {
  return callRpc('get_my_access');
}

export async function heartbeatInstallation(installation) {
  return callRpc('heartbeat_app_activity', {
    p_install_id: installation.installId,
    p_session_id: installation.sessionId,
    p_app_version: installation.appVersion,
    p_platform: installation.platform,
    p_architecture: installation.architecture,
    p_device_kind: installation.deviceKind
  });
}

export async function fetchDevSummary() {
  return callRpc('dev_summary');
}

export async function fetchDevUsers({ query = '', status = 'all', limit = 100, offset = 0 } = {}) {
  return callRpc('dev_list_users', {
    p_query: query,
    p_status: status,
    p_limit: limit,
    p_offset: offset
  });
}

export async function fetchDevUserDetail(userId) {
  return callRpc('dev_user_detail', { p_user_id: userId });
}

export async function suspendDevUser(userId, reason = '') {
  return callRpc('dev_suspend_user', { p_user_id: userId, p_reason: reason });
}

export async function banDevUser(userId, reason = '') {
  return callRpc('dev_ban_user', { p_user_id: userId, p_reason: reason });
}

export async function forceSignOutDevUser(userId) {
  return callRpc('dev_force_sign_out', { p_user_id: userId });
}

export async function restoreDevUser(userId) {
  return callRpc('dev_restore_user', { p_user_id: userId });
}

export async function fetchUserCollection(userId) {
  const sb = getClient();
  if (!sb || !userId) return [];
  try {
    const { data, error } = await sb
      .from('collections')
      .select('*')
      .eq('user_id', userId)
      .order('added_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('[Sync] fetch user collection failed:', err);
    return [];
  }
}

export async function fetchUserHistory(userId) {
  const sb = getClient();
  if (!sb || !userId) return [];
  try {
    const { data, error } = await sb
      .from('watch_history')
      .select('*')
      .eq('user_id', userId)
      .order('watched_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('[Sync] fetch user history failed:', err);
    return [];
  }
}

export async function removeWatchHistory(userId, tmdbId, mediaType) {
  const sb = getClient();
  if (!sb || !userId) return false;
  try {
    const recorded = await recordDataTombstone(userId, 'history', tmdbId, mediaType);
    if (!recorded) throw new Error('Could not record history deletion');
    const { error } = await sb.from('watch_history').delete()
      .eq('user_id', userId).eq('tmdb_id', tmdbId).eq('media_type', mediaType);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Sync] remove watch history failed:', err);
    return false;
  }
}

/* ─── Watch Sessions ─── */

export async function recordWatchSession(userId, session) {
  const sb = getClient();
  if (!sb || !userId) return false;
  try {
    const { error } = await sb.from('watch_sessions').insert({
      user_id: userId,
      tmdb_id: session.tmdb_id,
      media_type: session.media_type,
      title: session.title,
      season: session.season || null,
      episode: session.episode || null,
      started_at: session.started_at || new Date().toISOString(),
      ended_at: session.ended_at || new Date().toISOString(),
      duration_seconds: session.duration_seconds || 0
    });
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Sync] record session failed:', err);
    return false;
  }
}

export async function fetchWatchSessions(userId, days = 365) {
  const sb = getClient();
  if (!sb || !userId) return [];
  try {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const { data, error } = await sb
      .from('watch_sessions')
      .select('*')
      .eq('user_id', userId)
      .gte('started_at', since.toISOString())
      .order('started_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(row => ({
      tmdb_id: row.tmdb_id,
      media_type: row.media_type,
      title: row.title,
      season: row.season,
      episode: row.episode,
      started_at: row.started_at,
      ended_at: row.ended_at,
      duration_seconds: row.duration_seconds
    }));
  } catch (err) {
    console.error('[Sync] fetch sessions failed:', err);
    return [];
  }
}

/* ─── Folders ─── */

export async function saveFolders(userId, folders) {
  const sb = getClient();
  if (!sb || !userId) return false;
  try {
    const { error } = await sb.from('user_settings').update({
      folders: folders,
      updated_at: new Date().toISOString()
    }).eq('user_id', userId);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Sync] save folders failed:', err);
    return false;
  }
}

export async function fetchFolders(userId) {
  const sb = getClient();
  if (!sb || !userId) return [];
  try {
    const { data, error } = await sb
      .from('user_settings')
      .select('folders')
      .eq('user_id', userId)
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    return data?.folders || [];
  } catch (err) {
    console.error('[Sync] fetch folders failed:', err);
    return [];
  }
}

/* ─── Profile ─── */

export async function createProfile(userId, email, username) {
  const sb = getClient();
  if (!sb || !userId) return false;
  try {
    // Check if row already exists (SELECT is allowed for everyone)
    const { data: existing } = await sb.from('profiles').select('id').eq('id', userId).limit(1);
    if (existing && existing.length > 0) {
      // Row exists — update it (RLS allows own update)
      const { error } = await sb.from('profiles').update({
        email,
        username: username || email.split('@')[0],
        last_seen_at: new Date().toISOString()
      }).eq('id', userId);
      if (error) throw error;
    } else {
      // No row — insert new (RLS allows own insert)
      const { error } = await sb.from('profiles').insert({
        id: userId,
        email,
        username: username || email.split('@')[0],
        created_at: new Date().toISOString()
      });
      if (error) throw error;
    }
    return true;
  } catch (err) {
    console.error('[Sync] create profile failed:', err);
    return false;
  }
}

export async function updateProfile(userId, updates) {
  const sb = getClient();
  if (!sb || !userId) return false;
  try {
    const { error } = await sb.from('profiles').update(updates).eq('id', userId);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Sync] update profile failed:', err);
    return false;
  }
}
