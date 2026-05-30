/** Main App Entry Point */
import { initStorage } from './storage.js';
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
let _lastUpdateInfo  = null;
const LOCAL_VERSION_KEY  = 'openccloud_last_version';
const GITHUB_REPO        = 'sebastianmiletic/opencloud';
const GITHUB_BRANCH      = 'main';
const IGNORE_PATTERNS    = [/^README/i, /^LICENSE/i, /^CHANGELOG/i, /^CONTRIBUTING/i, /^\.gitignore$/, /^\.env/, /^\.prettier/i, /^\.eslint/i, /^docs\//i, /^\.github\//i, /^screenshots\//i, /^assets\//i, /\.md$/i, /\.txt$/i, /\.log$/i, /\.png$/i, /\.jpg$/i, /\.svg$/i];

function isIgnoredFile(filename) { return !filename || IGNORE_PATTERNS.some(pat => pat.test(filename)); }
async function fetchLatestCommit() { const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/commits/${GITHUB_BRANCH}?per_page=1`, { cache: 'no-store' }); if (!res.ok) return null; return await res.json(); }
async function fetchCommitDetails(sha) { const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/commits/${sha}`, { cache: 'no-store' }); if (!res.ok) return null; return await res.json(); }

function openUpdateModal() {
  const updateModal          = document.getElementById('updateModal');
  const updateModalMsg       = document.getElementById('updateModalMsg');
  const updateModalDetails   = document.getElementById('updateModalDetails');
  const updateModalInstall   = document.getElementById('updateModalInstallBtn');
  const updateModalUpToDate  = document.getElementById('updateModalUpToDate');
  if (!updateModal) return;
  updateModal.classList.remove('hidden');
  if (!_updateAvailable || !_lastUpdateInfo) {
    if (updateModalMsg) updateModalMsg.innerHTML = 'You are on the latest version.';
    if (updateModalUpToDate) updateModalUpToDate.style.display = 'block';
    if (updateModalInstall) updateModalInstall.style.display = 'none';
    if (updateModalDetails) updateModalDetails.innerHTML = '';
  } else {
    if (updateModalUpToDate) updateModalUpToDate.style.display = 'none';
    if (updateModalInstall) updateModalInstall.style.display = 'block';
    if (updateModalMsg) {
      const dateStr = _lastUpdateInfo.date ? new Date(_lastUpdateInfo.date).toLocaleString() : 'Just now';
      updateModalMsg.innerHTML = `<strong style="color:var(--text-primary);display:block;margin-bottom:0.4rem;">${escapeHtml(_lastUpdateInfo.message)}</strong><span style="font-size:0.75rem;color:var(--text-muted);">by ${_lastUpdateInfo.author} · ${dateStr}</span>`;
    }
    if (updateModalDetails) updateModalDetails.innerHTML = `<pre style="font-family:monospace;font-size:0.75rem;color:var(--text-secondary);white-space:pre-wrap;line-height:1.6;">${_lastUpdateInfo.files.map(f => `• ${f}`).join('\n')}</pre>`;
  }
}

/* ── App Content ── */
async function initAppContent() {
  await initStorage();
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
      _updateAvailable = false; _lastUpdateInfo = null;
      const latest = await fetchLatestCommit();
      if (latest?.sha) {
        const localSha = localStorage.getItem(LOCAL_VERSION_KEY);
        if (latest.sha !== localSha) {
          const details = await fetchCommitDetails(latest.sha);
          const meaningful = (details?.files || []).filter(f => !isIgnoredFile(f.filename));
          if (meaningful.length > 0) {
            _updateAvailable = true;
            _lastUpdateInfo = { sha: latest.sha.slice(0, 7), message: latest.commit?.message || 'Update', author: latest.commit?.author?.name || 'Open Cloud', date: latest.commit?.committer?.date || '', files: meaningful.map(f => f.filename) };
            if (updateBadge) updateBadge.textContent = 'New!';
          } else {
            localStorage.setItem(LOCAL_VERSION_KEY, latest.sha);
            if (updateBadge) updateBadge.textContent = '';
          }
        }
      }
      openUpdateModal();
    });
  }

  /* Update modal close */
  document.getElementById('updateModalClose')?.addEventListener('click', () => document.getElementById('updateModal')?.classList.add('hidden'));

  /* Install update */
  document.getElementById('updateModalInstallBtn')?.addEventListener('click', async () => {
    showToast('Installing update...', 'info');
    try { const latest = await fetchLatestCommit(); if (latest?.sha) localStorage.setItem(LOCAL_VERSION_KEY, latest.sha); } catch (e) {}
    try { const cacheNames = await caches.keys(); await Promise.all(cacheNames.map(name => caches.delete(name))); } catch (e) {}
    try { if ('serviceWorker' in navigator) { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r => r.unregister())); } } catch (e) {}
    location.reload(true);
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
