/** Supabase Database Sync Module */
import { showToast } from './utils.js';

const SUPABASE_URL = (typeof window !== 'undefined' && window.ENV?.SUPABASE_URL) ? window.ENV.SUPABASE_URL : '';
const SUPABASE_ANON_KEY = (typeof window !== 'undefined' && window.ENV?.SUPABASE_ANON_KEY) ? window.ENV.SUPABASE_ANON_KEY : '';

let supabaseClient = null;

function getClient() {
  if (!supabaseClient) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
    if (typeof window.supabase === 'undefined') return null;
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false }
    });
  }
  return supabaseClient;
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
      added_at: item.added_at || new Date().toISOString()
    }));
    const { error } = await sb.from('collections').upsert(rows, { onConflict: 'user_id,tmdb_id' });
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
      added_at: row.added_at
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
    const { error } = await sb.from('collections').upsert({
      user_id: userId,
      tmdb_id: item.id,
      media_type: item.media_type,
      title: item.title,
      year: item.year || null,
      poster_path: item.poster_path || null,
      vote_average: item.vote_average || 0,
      added_at: item.added_at || new Date().toISOString()
    }, { onConflict: 'user_id,tmdb_id' });
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Sync] add to collection failed:', err);
    return false;
  }
}

export async function removeFromCollection(userId, tmdbId) {
  const sb = getClient();
  if (!sb || !userId) return false;
  try {
    const { error } = await sb.from('collections').delete().eq('user_id', userId).eq('tmdb_id', tmdbId);
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
    await sb.from('watch_history').delete().eq('user_id', userId).eq('tmdb_id', item.id);
    const { error } = await sb.from('watch_history').insert({
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
      watched_at: new Date().toISOString()
    });
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Sync] add watch history failed:', err);
    return false;
  }
}

export async function fetchWatchHistory(userId, limit = 100) {
  const sb = getClient();
  if (!sb || !userId) return [];
  try {
    const { data, error } = await sb
      .from('watch_history')
      .select('*')
      .eq('user_id', userId)
      .order('watched_at', { ascending: false })
      .limit(limit);
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
      map[row.tmdb_id] = {
        season: row.season,
        episode: row.episode,
        progress_seconds: row.progress_seconds
      };
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

/* ─── Admin ─── */

export async function isUserAdmin(userId) {
  const sb = getClient();
  if (!sb || !userId) return false;
  try {
    const { data, error } = await sb
      .from('profiles')
      .select('is_admin')
      .eq('id', userId)
      .single();
    if (error) throw error;
    return !!data?.is_admin;
  } catch (err) {
    console.error('[Sync] admin check failed:', err);
    return false;
  }
}

export async function fetchAllUsers() {
  const sb = getClient();
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from('profiles')
      .select('id, email, username, is_admin, is_banned, ban_reason, last_seen_at, created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('[Sync] fetch users failed:', err);
    return [];
  }
}

export async function fetchUserStats(userId) {
  const sb = getClient();
  if (!sb || !userId) return null;
  try {
    const [colRes, histRes, progRes] = await Promise.all([
      sb.from('collections').select('id', { count: 'exact' }).eq('user_id', userId),
      sb.from('watch_history').select('id', { count: 'exact' }).eq('user_id', userId),
      sb.from('watch_progress').select('id', { count: 'exact' }).eq('user_id', userId)
    ]);
    return {
      collectionCount: colRes.count || 0,
      historyCount: histRes.count || 0,
      progressCount: progRes.count || 0
    };
  } catch (err) {
    console.error('[Sync] fetch user stats failed:', err);
    return null;
  }
}

export async function fetchTotalUserCount() {
  const sb = getClient();
  if (!sb) return 0;
  try {
    const { count, error } = await sb
      .from('profiles')
      .select('id', { count: 'exact', head: true });
    if (error) throw error;
    return count || 0;
  } catch (err) {
    console.error('[Sync] fetch total users failed:', err);
    return 0;
  }
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

export async function removeWatchHistory(userId, tmdbId) {
  const sb = getClient();
  if (!sb || !userId) return false;
  try {
    const { error } = await sb.from('watch_history').delete().eq('user_id', userId).eq('tmdb_id', tmdbId);
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
    const { error } = await sb.from('profiles').upsert({
      id: userId,
      email: email,
      username: username || email.split('@')[0],
      is_admin: false,
      created_at: new Date().toISOString()
    }, { onConflict: 'id' });
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Sync] create profile failed:', err);
    return false;
  }
}

export async function activateAdmin(userId) {
  const sb = getClient();
  if (!sb || !userId) return false;
  try {
    const { error } = await sb.from('profiles').update({ is_admin: true }).eq('id', userId);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Sync] activate admin failed:', err);
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

/* ─── Admin: Ban / Kick / Restore ─── */

export async function banUser(userId, reason = '') {
  const sb = getClient();
  if (!sb || !userId) return false;
  try {
    const { error } = await sb.from('profiles')
      .update({ is_banned: true, ban_reason: reason })
      .eq('id', userId);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Sync] ban user failed:', err);
    return false;
  }
}

export async function unbanUser(userId) {
  const sb = getClient();
  if (!sb || !userId) return false;
  try {
    const { error } = await sb.from('profiles')
      .update({ is_banned: false, ban_reason: '' })
      .eq('id', userId);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[Sync] unban user failed:', err);
    return false;
  }
}

export async function deleteUserData(userId) {
  const sb = getClient();
  if (!sb || !userId) return false;
  try {
    await Promise.all([
      sb.from('collections').delete().eq('user_id', userId),
      sb.from('watch_history').delete().eq('user_id', userId),
      sb.from('watch_progress').delete().eq('user_id', userId),
      sb.from('watch_sessions').delete().eq('user_id', userId),
      sb.from('user_settings').delete().eq('user_id', userId)
    ]);
    return true;
  } catch (err) {
    console.error('[Sync] delete user data failed:', err);
    return false;
  }
}

export async function kickUser(userId) {
  const sb = getClient();
  if (!sb || !userId) return false;
  try {
    // Mark user as having a null last_seen_at so they appear offline
    // Clients will check periodically and log out if they detect a ban
    await updateProfile(userId, { last_seen_at: null });
    return true;
  } catch (err) {
    console.error('[Sync] kick user failed:', err);
    return false;
  }
}

export async function getActiveSessions(minutes = 15) {
  const sb = getClient();
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from('watch_sessions')
      .select('user_id, started_at, title')
      .gte('started_at', new Date(Date.now() - minutes * 60000).toISOString())
      .order('started_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('[Sync] get active sessions failed:', err);
    return [];
  }
}
