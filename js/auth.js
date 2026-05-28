/** Supabase Authentication Module */
import { showToast } from './utils.js';
import { createProfile, isUserAdmin } from './sync.js';

const SUPABASE_URL = (typeof window !== 'undefined' && window.ENV?.SUPABASE_URL) ? window.ENV.SUPABASE_URL : '';
const SUPABASE_ANON_KEY = (typeof window !== 'undefined' && window.ENV?.SUPABASE_ANON_KEY) ? window.ENV.SUPABASE_ANON_KEY : '';

let supabaseClient = null;
let currentUser = null;
let _isAdmin = false;

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

export async function checkSession() {
  if (!supabaseClient) return null;
  try {
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    if (session?.user) {
      currentUser = session.user;
      _isAdmin = await isUserAdmin(currentUser.id);
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
    // Check if username already exists
    const { data: existingUsername, error: usernameError } = await supabaseClient
      .from('profiles')
      .select('username')
      .eq('username', username.trim())
      .maybeSingle();
    if (usernameError) throw usernameError;
    if (existingUsername) {
      showToast('Username already taken', 'error');
      return { user: null, error: new Error('Username already taken') };
    }
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
    if (error) throw error;
    currentUser = data.user;
    // Create profile in profiles table
    if (data.user) {
      await createProfile(data.user.id, email, username.trim());
      _isAdmin = await isUserAdmin(data.user.id);
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
    // Ensure profile exists
    if (data.user) {
      await createProfile(data.user.id, data.user.email, data.user.email.split('@')[0]);
      _isAdmin = await isUserAdmin(data.user.id);
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
    showToast('Signed out', 'info');
  } catch (err) {
    console.error('[Auth] Signout failed:', err);
  }
}

export function getCurrentAuthUser() {
  return currentUser;
}

export function isAuthenticated() {
  return !!currentUser;
}

export function getUserDisplayName() {
  if (!currentUser) return 'Guest';
  return currentUser.user_metadata?.display_name || 
         currentUser.user_metadata?.username || 
         currentUser.email?.split('@')[0] || 
         'User';
}

export function getUserEmail() {
  if (!currentUser) return '';
  return currentUser.email || '';
}

export function isAdmin() {
  return _isAdmin;
}

export function getSupabaseClient() {
  return supabaseClient;
}
