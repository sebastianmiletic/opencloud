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
import { initSupabase, checkSession, signIn, signUp, getUserDisplayName, signOut, saveLocalIdentity, getLocalIdentity, setLocalUser } from './auth.js';

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
  }, 2600);
}
initSplash();

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
  [signinEmail, signupEmail].forEach(el => { if (el) el.addEventListener('focus', () => activateField(el)); el.addEventListener('input', () => { activateField(el); el.classList.toggle('has-value', !!el.value); }); });
  [signinPw,    signupPw   ].forEach(el => { if (el) el.addEventListener('focus', () => activateField(el, true)); el.addEventListener('input', () => { activateField(el, true); el.classList.toggle('has-value', !!el.value); }); });
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

/* ── Update Modal (manual-only) ── */
let _updateAvailable = false;
let _updateSummary   = '';
const LOCAL_VERSION_KEY  = 'openccloud_last_version';
const GITHUB_REPO        = 'sebastianmiletic/opencloud';
const GITHUB_BRANCH      = 'main';
const GITHUB_ZIP_URL     = `https://github.com/${GITHUB_REPO}/archive/refs/heads/${GITHUB_BRANCH}.zip`;

function cleanCommitMessage(raw) {
  if (!raw) return 'General improvements and bug fixes.';
  let firstLine = raw.split('\n')[0].trim();
  if (!firstLine) return 'General improvements and bug fixes.';
  firstLine = firstLine.replace(/^[a-z]+(\([^)]+\))?!?:\s*/i, '').trim();
  firstLine = firstLine.charAt(0).toUpperCase() + firstLine.slice(1);
  const words = firstLine.split(/\s+/);
  if (words.length > 12) {
    return words.slice(0, 12).join(' ') + '...';
  }
  return firstLine;
}

async function fetchLatestCommit() {
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/commits/${GITHUB_BRANCH}`, { cache: 'no-store' });
    if (!res.ok) {
      if (res.status === 403 || res.status === 429) {
        return { error: 'rate_limit', message: 'GitHub API rate limit reached. Try again in a few minutes.' };
      }
      return { error: 'network', message: `Server error (${res.status}). Please try again later.` };
    }
    return await res.json();
  } catch (err) {
    return { error: 'network', message: 'Network error. Check your internet connection.' };
  }
}

function openUpdateModal() {
  const modal         = document.getElementById('updateModal');
  const msg           = document.getElementById('updateModalMsg');
  const installBtn    = document.getElementById('updateModalInstallBtn');
  const upToDateEl    = document.getElementById('updateModalUpToDate');
  const titleEl       = document.getElementById('updateModalTitle');
  const subtitleEl    = document.getElementById('updateModalSubtitle');
  if (!modal) return;
  modal.classList.remove('hidden');

  if (_updateAvailable && _updateSummary) {
    if (titleEl) titleEl.textContent = 'Update Available';
    if (subtitleEl) subtitleEl.textContent = 'A new version of Open Cloud is ready';
    if (msg) msg.innerHTML = escapeHtml(_updateSummary);
    if (upToDateEl) upToDateEl.style.display = 'none';
    if (installBtn) {
      installBtn.style.display = 'block';
      installBtn.innerHTML = '<i class="fas fa-download" style="margin-right:0.4rem;"></i>Download Latest ZIP';
    }
  } else {
    if (titleEl) titleEl.textContent = 'No Updates';
    if (subtitleEl) subtitleEl.textContent = 'You are on the latest version';
    if (msg) msg.innerHTML = '<i class="fas fa-check-circle" style="color:#10b981;margin-right:0.3rem;"></i>Everything is up to date.';
    if (upToDateEl) upToDateEl.style.display = 'none';
    if (installBtn) installBtn.style.display = 'none';
  }
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

  initBlocker();

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
  const updateBadge    = document.getElementById('versionBadge');
  if (updateCheckBtn) {
    updateCheckBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      accountDropdown?.classList.add('hidden');
      _updateAvailable = false;
      _updateSummary   = '';

      const latest = await fetchLatestCommit();

      // Handle API errors gracefully
      if (latest?.error) {
        _updateAvailable = false;
        _updateSummary   = '';
        openUpdateModal();
        showToast(latest.message, 'error');
        return;
      }

      if (!latest?.sha) {
        _updateAvailable = false;
        _updateSummary   = '';
        openUpdateModal();
        showToast('Could not check for updates. Try again later.', 'error');
        return;
      }

      const localSha = localStorage.getItem(LOCAL_VERSION_KEY);
      if (latest.sha === localSha) {
        _updateAvailable = false;
        _updateSummary   = '';
        if (updateBadge) updateBadge.textContent = '';
        openUpdateModal();
        return;
      }

      // Build a human-readable feature description from the commit
      const rawMessage   = latest.commit?.message || '';
      const featureDesc  = cleanCommitMessage(rawMessage);
      const files        = (latest.files || []).map(f => f.filename).filter(Boolean);

      // Only show update if there are actual code changes (not just docs/README)
      const codeFiles    = files.filter(f => {
        const name = f.toLowerCase();
        return !name.startsWith('readme') && !name.startsWith('license') &&
               !name.startsWith('docs/') && !name.startsWith('.github/') &&
               !name.endsWith('.md') && !name.endsWith('.txt') &&
               !name.endsWith('.log') && !name.endsWith('.png') &&
               !name.endsWith('.jpg') && !name.endsWith('.svg');
      });

      if (codeFiles.length === 0) {
        // No meaningful code changes — mark as up to date
        localStorage.setItem(LOCAL_VERSION_KEY, latest.sha);
        if (updateBadge) updateBadge.textContent = '';
        _updateAvailable = false;
        _updateSummary   = '';
        openUpdateModal();
        return;
      }

      _updateAvailable = true;
      _updateSummary   = featureDesc;
      if (updateBadge) updateBadge.textContent = 'New!';
      openUpdateModal();
    });
  }

  /* Update modal close */
  document.getElementById('updateModalClose')?.addEventListener('click', () => document.getElementById('updateModal')?.classList.add('hidden'));

  /* Install Update — tell Service Worker to fetch new files from GitHub raw */
  document.getElementById('updateModalInstallBtn')?.addEventListener('click', async () => {
    showToast('Downloading update...', 'info');
    const installBtn = document.getElementById('updateModalInstallBtn');
    if (installBtn) { installBtn.disabled = true; installBtn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:0.4rem;"></i>Updating...'; }

    // Re-fetch latest commit to get changed files
    let files = [];
    let sha   = '';
    try {
      const latest = await fetchLatestCommit();
      if (latest?.sha && latest?.files) {
        sha   = latest.sha;
        files = (latest.files || []).map(f => f.filename).filter(f => {
          const name = f.toLowerCase();
          return !name.startsWith('readme') && !name.startsWith('license') &&
                 !name.startsWith('docs/') && !name.startsWith('.github/') &&
                 !name.endsWith('.md') && !name.endsWith('.txt') &&
                 !name.endsWith('.log') && !name.endsWith('.png') &&
                 !name.endsWith('.jpg') && !name.endsWith('.svg');
        });
      }
    } catch (e) {}

    if (!files.length || !sha) {
      showToast('Could not get update files. Try again.', 'error');
      if (installBtn) { installBtn.disabled = false; installBtn.innerHTML = '<i class="fas fa-rotate-right" style="margin-right:0.4rem;"></i>Install Update Now'; }
      return;
    }

    // Send message to Service Worker to update cache
    const reg = await navigator.serviceWorker?.ready;
    if (!reg || !reg.active) {
      showToast('Service Worker not ready. Please reload and try again.', 'error');
      return;
    }

    const channel = new MessageChannel();
    const done = new Promise((resolve) => {
      channel.port1.onmessage = (event) => {
        resolve(event.data);
      };
    });

    reg.active.postMessage({ type: 'UPDATE_CACHE', files, sha }, [channel.port2]);
    const result = await done;

    if (result?.ok) {
      localStorage.setItem(LOCAL_VERSION_KEY, sha);
      showToast(`Update applied (${result.updated} files). Reloading...`, 'success');
      setTimeout(() => location.reload(true), 1500);
    } else {
      showToast(result?.error || 'Update failed. Try again.', 'error');
      if (installBtn) { installBtn.disabled = false; installBtn.innerHTML = '<i class="fas fa-rotate-right" style="margin-right:0.4rem;"></i>Install Update Now'; }
    }
  });

  /* Sign Out */
  document.getElementById('signOutBtn')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    accountDropdown?.classList.add('hidden');
    await signOut();
    location.reload(true);
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

    // Init Supabase client
    const hasSupabase = initSupabase();
    initAuthModal();

    let user = null;
    if (hasSupabase) {
      user = await Promise.race([
        checkSession(),
        new Promise(resolve => setTimeout(() => resolve(null), 10000))
      ]);
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
