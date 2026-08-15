/** Supabase Authentication Module */
import { showToast } from './utils.js';
import { createProfile, getMyAccess } from './sync.js';

const SUPABASE_URL = (typeof window !== 'undefined' && window.ENV?.SUPABASE_URL) ? window.ENV.SUPABASE_URL : '';
const SUPABASE_ANON_KEY = (typeof window !== 'undefined' && window.ENV?.SUPABASE_ANON_KEY) ? window.ENV.SUPABASE_ANON_KEY : '';

let supabaseClient = null;
let currentUser = null;

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
  return true;
}

function clearSupabaseSessionLocal() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('sb-')) keys.push(key);
    }
    keys.forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
  } catch (e) {}
}

/* Quick connectivity check — resolves true if the Supabase URL is reachable */
export async function isSupabaseReachable() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    await fetch(`${SUPABASE_URL}/rest/v1/`, {
      method: 'HEAD',
      signal: controller.signal,
      headers: { 'apikey': SUPABASE_ANON_KEY }
    });
    clearTimeout(timeoutId);
    return true;
  } catch (e) {
    return false;
  }
}

export async function checkSession() {
  if (!supabaseClient) return null;

  // Check if Supabase is even reachable before trying session operations.
  // If the project is paused/deleted, skip straight to local identity.
  const reachable = await isSupabaseReachable();
  if (!reachable) {
    console.warn('[Auth] Supabase is unreachable');
    return null;
  }

  try {
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    if (session?.user) {
      currentUser = session.user;
      const access = await getMyAccess();
      if (access?.state === 'suspended') {
        await supabaseClient.auth.signOut({ scope: 'global' });
        currentUser = null;
        return null;
      }
      return session.user;
    }
    return null;
  } catch (err) {
    console.error('[Auth] Session check failed:', err);
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
        const access = await getMyAccess();
        if (access?.state === 'suspended') {
          await supabaseClient.auth.signOut({ scope: 'global' });
          throw new Error('Account suspended');
        }
      } catch (profileErr) {
        if (profileErr?.message === 'Account suspended') throw profileErr;
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
    if (data.user) {
      const access = await getMyAccess();
      if (access?.state === 'suspended') {
        await supabaseClient.auth.signOut({ scope: 'global' });
        currentUser = null;
        showToast(`Account suspended: ${access.reason || 'Contact support'}`, 'error');
        return { user: null, error: new Error('Account suspended') };
      }
      // Ensure profile exists (creates row if missing)
      try {
        await createProfile(data.user.id, data.user.email, data.user.email.split('@')[0]);
      } catch (e) {
        console.warn('[Auth] createProfile on signIn failed:', e);
      }
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
    showToast('Signed out', 'info');
  } catch (err) {
    console.error('[Auth] Signout failed:', err);
  } finally {
    currentUser = null;
    clearSupabaseSessionLocal();
  }
}

export async function clearRevokedSession() {
  try {
    await supabaseClient?.auth.signOut({ scope: 'local' });
  } catch (err) {
    console.warn('[Auth] Could not notify Supabase while clearing a revoked session:', err);
  } finally {
    currentUser = null;
    clearSupabaseSessionLocal();
  }
}

export function getCurrentAuthUser() {
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
