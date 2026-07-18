/** Main App Entry Point */
import { initStorage, hydrateHistoryMetadata, hydrateCollectionMetadata } from './storage.js';
import { initUser } from './accounts.js';
import { initSettings } from './settings.js';
import { initPlayer } from './player.js';
import { initHero } from './hero.js';
import { initBlocker } from './blocker.js';
import {
  initNav, initSearch, initModals, loadHomeCategories, openItemModal,
  addToUserCollection
} from './ui.js';
import { showToast, lockScroll, unlockScroll } from './utils.js';
import { hydrateSettingsFromCloud } from './config.js';
import { initSupabase, isSupabaseReachable, checkSession, signIn, signUp, getUserDisplayName, signOut, saveLocalIdentity, getLocalIdentity, setLocalUser } from './auth.js';
import { initUpdater } from './updater.js';
import { initAccessibility } from './accessibility.js';

/* Global error handler */
window.onerror = (msg, url, line) => {
  console.error(`[Open Cloud Error] ${msg} at ${url}:${line}`);
};
window.addEventListener('unhandledrejection', (e) => {
  console.error('[Open Cloud Unhandled Promise]', e.reason);
});

/* Splash */
function initSplash() {
  const splash = document.getElementById('splashScreen');
  const app = document.getElementById('appContainer');
  if (!splash) return;
  setTimeout(() => {
    splash.style.display = 'none';
    if (app) app.classList.add('visible');
  }, 900);
}
initSplash();
initAccessibility();

/* Auth Modal Helpers */
function initAuthModal() {
  const authModal   = document.getElementById('authModal');
  const signinForm  = document.getElementById('signinForm');
  const signupForm  = document.getElementById('signupForm');
  const signinEmail = document.getElementById('signinEmail');
  const signinPw    = document.getElementById('signinPassword');
  const signupEmail = document.getElementById('signupEmail');
  const signupPw    = document.getElementById('signupPassword');
  const signinTab   = document.querySelector('.auth-tab[data-auth-tab="signin"]');
  const signupTab   = document.querySelector('.auth-tab[data-auth-tab="signup"]');

  if (!authModal) return;

  /* Activate field helpers */
  function activateField(el, isPw = false) {
    if (el && el.readOnly) { el.readOnly = false; if (isPw) el.type = 'password'; }
  }
  [signinEmail, signupEmail].forEach(el => {
    if (!el) return;
    el.addEventListener('focus', () => activateField(el));
    el.addEventListener('input', () => { activateField(el); el.classList.toggle('has-value', !!el.value); });
  });
  [signinPw, signupPw].forEach(el => {
    if (!el) return;
    el.addEventListener('focus', () => activateField(el, true));
    el.addEventListener('input', () => { activateField(el, true); el.classList.toggle('has-value', !!el.value); });
  });
  const signupUsername = document.getElementById('signupUsername');
  if (signupUsername) { signupUsername.addEventListener('focus', () => activateField(signupUsername)); signupUsername.addEventListener('input', () => { activateField(signupUsername); signupUsername.classList.toggle('has-value', !!signupUsername.value); }); }

  /* Tab switching */
  function setActiveTab(target) {
    [signinTab, signupTab].forEach(t => { if (t) t.classList.toggle('active', t.dataset.authTab === target); });
    if (target === 'signin') {
      signupForm?.classList.remove('active');
      setTimeout(() => { signinForm?.classList.add('active'); if (signupForm) signupForm.style.display = 'none'; if (signinForm) signinForm.style.display = 'block'; }, 50);
    } else {
      signinForm?.classList.remove('active');
      setTimeout(() => { signupForm?.classList.add('active'); if (signinForm) signinForm.style.display = 'none'; if (signupForm) signupForm.style.display = 'block'; }, 50);
    }
  }

  [signinTab, signupTab].forEach(tab => { tab?.addEventListener('click', () => setActiveTab(tab.dataset.authTab)); });
  setTimeout(() => setActiveTab('signin'), 0);

  // Sign In
  signinForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email    = signinEmail?.value?.trim() || '';
    const password = signinPw?.value || '';
    if (!email || !password) return;
    const { user, error } = await signIn(email, password);
    if (user && !error) {
      saveLocalIdentity(user);
      authModal.classList.add('hidden');
      unlockScroll();
      updateAuthUI(user);
      showToast(`Welcome back, ${getUserDisplayName()}!`, 'success');
      await hydrateSettingsFromCloud();
      await initAppContent();
    }
  });

  // Sign Up
  signupForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = signupUsername?.value?.trim() || '';
    const email    = signupEmail?.value?.trim() || '';
    const password = signupPw?.value || '';
    if (!username || !email || !password) return;
    if (password.length < 6) { showToast('Password must be at least 6 characters', 'error'); return; }
    const { user, error } = await signUp(email, password, username);
    if (user && !error) {
      saveLocalIdentity(user);
      authModal.classList.add('hidden');
      unlockScroll();
      updateAuthUI(user);
      showToast(`Welcome, ${getUserDisplayName()}!`, 'success');
      await initAppContent();
    }
  });
}

/* ── App Content ── */
async function initAppContent() {
  await initStorage();
  // Background: enrich any history/collection items missing poster or rating
  hydrateHistoryMetadata().catch(() => {});
  hydrateCollectionMetadata().catch(() => {});
  initUser();
  initNav();
  initSearch();
  initModals();
  initPlayer();
  initHero();

  /* Hero events */
  window.addEventListener('heroOpenModal', (e) => { if (e.detail?.id) openItemModal(e.detail.id, e.detail.type || 'movie'); });
  window.addEventListener('heroAddToCollection', (e) => { if (e.detail) addToUserCollection(e.detail).catch(err => console.error('[Hero] Add to collection failed:', err)); });

  await initBlocker();

  /* Logo click -> home */
  const logoHome = document.getElementById('logoHome');
  if (logoHome) {
    logoHome.addEventListener('click', () => {
      const homeBtn = document.querySelector('.nav-btn[data-tab="home"]');
      if (homeBtn) homeBtn.click();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* Account dropdown */
  const accountBtn = document.getElementById('accountBtn');
  const accountDropdown = document.getElementById('accountDropdown');
  if (accountBtn) {
    accountBtn.addEventListener('click', (e) => { e.stopPropagation(); accountDropdown?.classList.toggle('hidden'); accountBtn.classList.toggle('open'); });
  }
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.account-menu')) { accountDropdown?.classList.add('hidden'); accountBtn?.classList.remove('open'); }
  });

  /* Check for Updates */
  const updateCheckBtn = document.getElementById('updateCheckBtn');
  initUpdater(updateCheckBtn, accountDropdown);

  /* Sign Out */
  document.getElementById('signOutBtn')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    accountDropdown?.classList.add('hidden');
    await signOut();
    location.reload();
  });

  /* Load home */
  loadHomeCategories().catch(err => console.error('Failed to load home categories:', err));
}

/* ── Auth UI ── */
function updateAuthUI(user) {
  const displayName = getUserDisplayName();
  const email       = user?.email || '';
  const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  const setVal  = (id, text) => { const el = document.getElementById(id); if (el) el.value = text; };
  setText('accountAvatar', displayName.charAt(0).toUpperCase());
  setText('accountName', displayName);
  setText('profileAvatar', displayName.charAt(0).toUpperCase());
  setVal('profileUsername', displayName);
  setText('dropdownUserAvatar', displayName.charAt(0).toUpperCase());
  setText('dropdownUserName', displayName);
  setText('dropdownUserEmail', email);
  setText('accountCurrentEmail', email || 'Not signed in');
}

  /* ── Show Auth Modal ── */
function showAuthModal() {
  const authModal = document.getElementById('authModal');
  if (!authModal) return;
  authModal.classList.remove('hidden');
  lockScroll();

  // Show first-time welcome text if the user has no account
  const intro = authModal.querySelector('.auth-intro');
  if (intro) {
    const hasAccounts = localStorage.getItem('oc_session_restored');
    const hasLoggedInBefore = localStorage.getItem('openccloud_settings');
    if (hasAccounts && !hasLoggedInBefore) {
      intro.innerHTML = 'Welcome to Open Cloud! Create an account or sign in with an existing one to start watching movies and shows.';
    } else if (!hasAccounts) {
      intro.innerHTML = 'Welcome to Open Cloud! Create a free account to start watching movies and shows instantly.';
    } else {
      intro.innerHTML = 'Welcome back to Open Cloud!';
    }
  }

  // Clear all fields
  const ids = [ ['signinEmail', false], ['signinPassword', true], ['signupUsername', false], ['signupEmail', false], ['signupPassword', true] ];
  ids.forEach(([id, isPw]) => { const el = document.getElementById(id); if (el) { el.value = ''; el.readOnly = true; el.classList.remove('has-value'); if (isPw) el.type = 'text'; } });

  // Reset tab indicator and set sign-in active
  requestAnimationFrame(() => {
    const indicator = document.querySelector('.auth-tab-indicator');
    const signinTab = document.querySelector('.auth-tab[data-auth-tab="signin"]');
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.authTab === 'signin'));
    if (indicator && signinTab) { indicator.style.transform = `translateX(${signinTab.offsetLeft}px)`; indicator.style.width = `${signinTab.offsetWidth}px`; }
    const signinForm = document.getElementById('signinForm');
    const signupForm = document.getElementById('signupForm');
    signupForm?.classList.remove('active'); if (signupForm) signupForm.style.display = 'none';
    signinForm?.classList.add('active');   if (signinForm) signinForm.style.display = 'block';
  });
}

function showEnvErrorModal(missing) {
  const splash = document.getElementById('splashScreen');
  if (splash) splash.style.display = 'none';
  const appContainer = document.getElementById('appContainer');
  if (appContainer) {
    appContainer.classList.add('visible');
    appContainer.innerHTML = `
      <div style="max-width:600px;margin:10vh auto;padding:2rem;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:12px;text-align:center;font-family:'Inter',sans-serif;">
        <i class="fas fa-triangle-exclamation" style="font-size:3rem;color:#ef4444;margin-bottom:1rem;"></i>
        <h1 style="font-size:1.5rem;margin-bottom:1rem;">Configuration Required</h1>
        <p style="color:var(--text-secondary);margin-bottom:1.5rem;">Open Cloud needs API keys to work. Copy <code>.env.example</code> to <code>.env</code> and fill in your keys.</p>
        <ul style="text-align:left;color:#ef4444;font-family:monospace;font-size:0.875rem;">${missing.map(k => `<li><code>${k}</code></li>`).join('')}</ul>
      </div>`;
  }
}

/* ── Helpers ── */
function escapeHtml(text) {
  const div = document.createElement('div'); div.textContent = text; return div.innerHTML;
}

function validateEnv() {
  const env = (typeof window !== 'undefined' && window.ENV) ? window.ENV : {};
  const missing = [];
  if (!env.TMDB_BEARER_TOKEN || env.TMDB_BEARER_TOKEN.length < 20) missing.push('TMDB_BEARER_TOKEN');
  if (!env.OMDB_API_KEY || env.OMDB_API_KEY.length < 5) missing.push('OMDB_API_KEY');
  if (!env.SUPABASE_URL || !env.SUPABASE_URL.startsWith('https://')) missing.push('SUPABASE_URL');
  if (!env.SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY.length < 20) missing.push('SUPABASE_ANON_KEY');
  return missing;
}

const SESSION_RESTORED_KEY = 'oc_session_restored';
function clearSupabaseSession() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key && key.startsWith('sb-')) keys.push(key); }
  keys.forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
}

/* ── Initialize everything ── */
async function initApp() {
  try {
    // Fresh install? Wipe stale Supabase tokens
    if (!localStorage.getItem(SESSION_RESTORED_KEY)) {
      clearSupabaseSession();
      localStorage.setItem(SESSION_RESTORED_KEY, 'true');
    }

    // Validate env.js loaded before anything else
    const missing = validateEnv();
    if (missing.length > 0) {
      showEnvErrorModal(missing);
      window._appLoaded = true;
      return;
    }

    // Mark as loaded immediately — env is confirmed, JS modules loaded fine.
    // The error screen should never fire from this point on.
    window._appLoaded = true;

    // Signed update checks run for every desktop launch, including signed-out sessions.
    initUpdater(document.getElementById('updateCheckBtn'), document.getElementById('accountDropdown'));

    // Check if Supabase is reachable BEFORE creating the client.
    // If the project is paused/deleted, creating the client triggers
    // background network retries that block the UI.
    let hasSupabase = false;
    const supabaseReachable = await isSupabaseReachable();
    if (supabaseReachable) {
      hasSupabase = initSupabase();
    } else {
      console.warn('[Main] Supabase is unreachable — skipping auth client creation');
      // Clear any stale Supabase localStorage keys
      clearSupabaseSession();
    }
    initAuthModal();

    let user = null;
    if (hasSupabase) {
      user = await checkSession();
    }

    // If no Supabase session, check for a saved local identity so the user
    // never has to sign in again on this device.
    if (!user) {
      const localIdentity = getLocalIdentity();
      if (localIdentity) {
        setLocalUser(localIdentity);
        user = localIdentity;
      }
    }

    if (!user) {
      showAuthModal();
      initSettings(); // still init settings so nothing crashes later
      window._appLoaded = true;
      return;
    }

    await hydrateSettingsFromCloud();
    initSettings();
    if (user) updateAuthUI(user);
    await initAppContent();

    window._appLoaded = true;
    document.getElementById('moduleError')?.classList.add('hidden');
  } catch (err) {
    console.error('Open Cloud init failed:', err);
    window._appLoaded = true;
    document.getElementById('moduleError')?.classList.add('hidden');
  }
}

initApp();
