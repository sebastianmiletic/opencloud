/** Supabase Authentication Module */
import { showToast } from './utils.js';
import { createProfile, isUserAdmin } from './sync.js';

const SUPABASE_URL = (typeof window !== 'undefined' && window.ENV?.SUPABASE_URL) ? window.ENV.SUPABASE_URL : '';
const SUPABASE_ANON_KEY = (typeof window !== 'undefined' && window.ENV?.SUPABASE_ANON_KEY) ? window.ENV.SUPABASE_ANON_KEY : '';

let supabaseClient = null;
let currentUser = null;
let _isAdmin = false;
let _localUser = null;

const LOCAL_IDENTITY_KEY = 'oc_local_identity';

export function saveLocalIdentity(user) {
  if (!user) return;
  try {
    const identity = {
      id: user.id,
      email: user.email || '',
      username: user.user_metadata?.username || user.user_metadata?.display_name || '',
      display_name: user.user_metadata?.display_name || user.user_metadata?.username || user.email?.split('@')[0] || 'User',
      user_metadata: user.user_metadata || {},
      created_at: new Date().toISOString()
    };
    localStorage.setItem(LOCAL_IDENTITY_KEY, JSON.stringify(identity));
  } catch (e) {}
}

export function getLocalIdentity() {
  try {
    const raw = localStorage.getItem(LOCAL_IDENTITY_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return null;
}

export function clearLocalIdentity() {
  try { localStorage.removeItem(LOCAL_IDENTITY_KEY); } catch (e) {}
}

export function setLocalUser(user) {
  _localUser = user;
}

function getStoredAdmin() {
  try { return localStorage.getItem('oc_is_admin') === 'true'; } catch (e) { return false; }
}
function setStoredAdmin(v) {
  try { localStorage.setItem('oc_is_admin', v ? 'true' : 'false'); } catch (e) {}
}

export function initSupabase() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn('[Auth] Supabase credentials not configured');
    return false;
  }
  if (typeof window.supabase === 'undefined') {
    console.warn('[Auth] Supabase client not loaded');
    return false;
  }
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false
    }
  });
  // Restore admin from localStorage immediately
  _isAdmin = getStoredAdmin();
  return true;
}

export async function checkSession() {
  if (!supabaseClient) return null;
  try {
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    if (session?.user) {
      currentUser = session.user;
      // Try server first, fall back to localStorage
      const serverAdmin = await isUserAdmin(currentUser.id);
      _isAdmin = serverAdmin || getStoredAdmin();
      setStoredAdmin(_isAdmin);
      return session.user;
    }
    return null;
  } catch (err) {
    console.error('[Auth] Session check failed:', err);
    // Clear the stale session so Supabase stops retrying token refresh in the background
    try { await supabaseClient.auth.signOut(); } catch (e) {}
    return null;
  }
}

export async function signUp(email, password, username) {
  if (!supabaseClient) {
    showToast('Auth not configured', 'error');
    return { error: new Error('Auth not configured') };
  }
  if (!username || username.trim().length < 2) {
    showToast('Username must be at least 2 characters', 'error');
    return { error: new Error('Invalid username') };
  }
  try {
    // Sign up first — don't let username check block account creation
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: {
          username: username.trim(),
          display_name: username.trim()
        }
      }
    });
    if (error) {
      // Provide clearer error messages for common Supabase auth errors
      if (error.message?.toLowerCase().includes('disabled')) {
        throw new Error('Email signups are disabled in Supabase. Go to Authentication > Providers > Email and enable it.');
      }
      if (error.message?.toLowerCase().includes('already registered') || error.message?.toLowerCase().includes('already exists')) {
        throw new Error('An account with this email already exists. Try signing in instead.');
      }
      throw error;
    }
    currentUser = data.user;
    // Create profile in profiles table (best effort — don't block if this fails)
    if (data.user) {
      try {
        await createProfile(data.user.id, email, username.trim());
        _isAdmin = await isUserAdmin(data.user.id);
      } catch (profileErr) {
        console.warn('[Auth] Profile creation failed (non-critical):', profileErr);
      }
    }
    showToast('Account created successfully', 'success');
    return { user: data.user, error: null };
  } catch (err) {
    console.error('[Auth] Signup failed:', err);
    showToast(err.message || 'Signup failed', 'error');
    return { user: null, error: err };
  }
}

export async function signIn(email, password) {
  if (!supabaseClient) {
    showToast('Auth not configured', 'error');
    return { error: new Error('Auth not configured') };
  }
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });
    if (error) throw error;
    currentUser = data.user;
    // Check ban status — use .limit(1) instead of .single() to avoid crash on missing row
    if (data.user) {
      const { data: profileRows, error: profileErr } = await supabaseClient
        .from('profiles')
        .select('is_banned, ban_reason')
        .eq('id', data.user.id)
        .limit(1);
      const profile = profileRows?.[0];
      if (!profileErr && profile?.is_banned) {
        await supabaseClient.auth.signOut();
        currentUser = null;
        showToast(`Account suspended: ${profile.ban_reason || 'Contact support'}`, 'error');
        return { user: null, error: new Error('Account suspended') };
      }
      // Ensure profile exists (creates row if missing)
      try {
        await createProfile(data.user.id, data.user.email, data.user.email.split('@')[0]);
      } catch (e) {
        console.warn('[Auth] createProfile on signIn failed:', e);
      }
      const serverAdmin = await isUserAdmin(data.user.id);
      _isAdmin = serverAdmin || getStoredAdmin();
      setStoredAdmin(_isAdmin);
      // Update last_seen_at
      await supabaseClient.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', data.user.id);
    }
    showToast('Signed in successfully', 'success');
    return { user: data.user, error: null };
  } catch (err) {
    console.error('[Auth] Signin failed:', err);
    showToast(err.message || 'Invalid email or password', 'error');
    return { user: null, error: err };
  }
}

export async function signOut() {
  if (!supabaseClient) return;
  try {
    await supabaseClient.auth.signOut();
    currentUser = null;
    _isAdmin = false;
    setStoredAdmin(false);
    clearLocalIdentity();
    _localUser = null;
    showToast('Signed out', 'info');
  } catch (err) {
    console.error('[Auth] Signout failed:', err);
  }
}

export function getCurrentAuthUser() {
  if (_localUser) return _localUser;
  return currentUser;
}

export function isAuthenticated() {
  return !!getCurrentAuthUser();
}

export function getUserDisplayName() {
  const user = getCurrentAuthUser();
  if (!user) return 'Guest';
  return user.user_metadata?.display_name ||
         user.user_metadata?.username ||
         user.email?.split('@')[0] ||
         user.display_name ||
         user.username ||
         'User';
}

export function getUserEmail() {
  const user = getCurrentAuthUser();
  if (!user) return '';
  return user.email || '';
}

export function isAdmin() {
  return _isAdmin;
}

export function setAdmin(value) {
  _isAdmin = !!value;
  setStoredAdmin(_isAdmin);
}

export async function updatePassword(newPassword) {
  if (!supabaseClient) {
    showToast('Auth not configured', 'error');
    return { error: new Error('Auth not configured') };
  }
  try {
    const { data, error } = await supabaseClient.auth.updateUser({
      password: newPassword
    });
    if (error) throw error;
    showToast('Password updated', 'success');
    return { user: data.user, error: null };
  } catch (err) {
    console.error('[Auth] Password update failed:', err);
    showToast(err.message || 'Failed to update password', 'error');
    return { user: null, error: err };
  }
}

export async function updateEmail(newEmail) {
  if (!supabaseClient) {
    showToast('Auth not configured', 'error');
    return { error: new Error('Auth not configured') };
  }
  try {
    const { data, error } = await supabaseClient.auth.updateUser({
      email: newEmail
    });
    if (error) throw error;
    currentUser = data.user;
    showToast('Email updated', 'success');
    return { user: data.user, error: null };
  } catch (err) {
    console.error('[Auth] Email update failed:', err);
    showToast(err.message || 'Failed to update email', 'error');
    return { user: null, error: err };
  }
}

export async function deleteAccount() {
  if (!supabaseClient || !currentUser) {
    showToast('Not signed in', 'error');
    return { error: new Error('Not signed in') };
  }
  try {
    // Delete profile first (RLS will enforce user can only delete own profile)
    await supabaseClient.from('profiles').delete().eq('id', currentUser.id);
    // Sign out locally
    await supabaseClient.auth.signOut();
    currentUser = null;
    _isAdmin = false;
    setStoredAdmin(false);
    showToast('Account deleted', 'info');
    return { error: null };
  } catch (err) {
    console.error('[Auth] Account deletion failed:', err);
    showToast(err.message || 'Failed to delete account', 'error');
    return { error: err };
  }
}

export function getSupabaseClient() {
  return supabaseClient;
}
