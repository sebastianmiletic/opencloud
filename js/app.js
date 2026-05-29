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
import { initSupabase, checkSession, signIn, signUp, getUserDisplayName } from './auth.js';

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
    splash.classList.add('fade-out');
    setTimeout(() => {
      splash.style.display = 'none';
      if (app) app.classList.add('visible');
    }, 600);
  }, 2200);
}
initSplash();

/* DOM Ready */
document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('appContainer');
  if (container) container.classList.add('visible');
});

/* Auth Modal */
function initAuthModal() {
  const authModal = document.getElementById('authModal');
  const signinForm = document.getElementById('signinForm');
  const signupForm = document.getElementById('signupForm');
  const signinEmail = document.getElementById('signinEmail');
  const signinPassword = document.getElementById('signinPassword');
  const signupEmail = document.getElementById('signupEmail');
  const signupPassword = document.getElementById('signupPassword');
  const tabs = document.querySelectorAll('.auth-tab');
  const indicator = document.querySelector('.auth-tab-indicator');

  /* Anti-autofill: remove readonly and switch password types on first real interaction */
  function activateField(input, isPassword = false) {
    if (input.readOnly) {
      input.readOnly = false;
      if (isPassword) input.type = 'password';
    }
  }
  [signinEmail, signupEmail].forEach(el => {
    if (!el) return;
    el.addEventListener('focus', () => activateField(el));
    el.addEventListener('input', () => { activateField(el); el.classList.toggle('has-value', !!el.value); });
  });
  [signinPassword, signupPassword].forEach(el => {
    if (!el) return;
    el.addEventListener('focus', () => activateField(el, true));
    el.addEventListener('input', () => { activateField(el, true); el.classList.toggle('has-value', !!el.value); });
  });
  const signupUsername = document.getElementById('signupUsername');
  if (signupUsername) {
    signupUsername.addEventListener('focus', () => activateField(signupUsername));
    signupUsername.addEventListener('input', () => { activateField(signupUsername); signupUsername.classList.toggle('has-value', !!signupUsername.value); });
  }

  /* Tab switching */
  function setActiveTab(targetTab) {
    tabs.forEach(t => t.classList.toggle('active', t.dataset.authTab === targetTab));
    const activeTab = document.querySelector(`.auth-tab[data-auth-tab="${targetTab}"]`);
    if (indicator && activeTab) {
      indicator.style.transform = `translateX(${activeTab.offsetLeft}px)`;
      indicator.style.width = `${activeTab.offsetWidth}px`;
    }
    if (targetTab === 'signin') {
      signupForm?.classList.remove('active');
      setTimeout(() => {
        signinForm?.classList.add('active');
        if (signupForm) signupForm.style.display = 'none';
        if (signinForm) signinForm.style.display = 'block';
      }, 50);
    } else {
      signinForm?.classList.remove('active');
      setTimeout(() => {
        signupForm?.classList.add('active');
        if (signinForm) signinForm.style.display = 'none';
        if (signupForm) signupForm.style.display = 'block';
      }, 50);
    }
  }

  tabs.forEach(btn => {
    btn.addEventListener('click', () => setActiveTab(btn.dataset.authTab));
  });

  // initialize indicator position
  setTimeout(() => setActiveTab('signin'), 0);

  // Sign In
  signinForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = signinEmail?.value.trim();
    const password = signinPassword?.value;
    if (!email || !password) return;

    const { user, error } = await signIn(email, password);
    if (user && !error) {
      authModal?.classList.add('hidden');
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
    const username = signupUsername?.value.trim();
    const email = signupEmail?.value.trim();
    const password = signupPassword?.value;
    if (!username || !email || !password) return;
    if (password.length < 6) {
      showToast('Password must be at least 6 characters', 'error');
      return;
    }

    const { user, error } = await signUp(email, password, username);
    if (user && !error) {
      authModal?.classList.add('hidden');
      unlockScroll();
      updateAuthUI(user);
      showToast(`Welcome, ${getUserDisplayName()}!`, 'success');
      await initAppContent();
    }
  });
}

async function initAppContent() {
  await initStorage();
  initUser();
  initNav();
  initSearch();
  initModals();
  initPlayer();
  initHero();

  /* Hero slide click opens item modal */
  window.addEventListener('heroOpenModal', (e) => {
    if (e.detail?.id) openItemModal(e.detail.id, e.detail.type || 'movie');
  });

  /* Hero add-to-collection event */
  window.addEventListener('heroAddToCollection', (e) => {
    if (e.detail) addToUserCollection(e.detail).catch(err => console.error('[Hero] Add to collection failed:', err));
  });

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

  /* Account dropdown toggle */
  const accountBtn = document.getElementById('accountBtn');
  const accountDropdown = document.getElementById('accountDropdown');

  if (accountBtn) {
    accountBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      accountDropdown?.classList.toggle('hidden');
      accountBtn.classList.toggle('open');
    });
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.account-menu')) {
      accountDropdown?.classList.add('hidden');
      accountBtn?.classList.remove('open');
    }
  });
  const updateCheckBtn = document.getElementById('updateCheckBtn');
  const updateBadge     = document.getElementById('versionBadge');
  const GITHUB_REPO     = 'sebastianmiletic/opencloud';
  const GITHUB_BRANCH   = 'main';
  const LOCAL_VERSION_KEY = 'openccloud_last_version';
  const IGNORE_PATTERNS = [
    /^README/i, /^LICENSE/i, /^CHANGELOG/i, /^CONTRIBUTING/i,
    /^\.gitignore$/, /^\.env/, /^\.prettier/i, /^\.eslint/i,
    /^docs\//i, /^\.github\//i, /^screenshots\//i, /^assets\//i,
    /\.md$/i, /\.txt$/i, /\.log$/i, /\.png$/i, /\.jpg$/i, /\.svg$/i
  ];

  function isIgnoredFile(filename) {
    return !filename || IGNORE_PATTERNS.some(pat => pat.test(filename));
  }

  let _updateAvailable = false;
  let _lastUpdateInfo  = null;

  async function fetchLatestCommit() {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/commits/${GITHUB_BRANCH}?per_page=1`, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  }

  async function fetchCommitDetails(sha) {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/commits/${sha}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  }

  /* Update Modal */
  const updateModal = document.getElementById('updateModal');
  const updateModalClose = document.getElementById('updateModalClose');
  const updateModalMsg = document.getElementById('updateModalMsg');
  const updateModalDetails = document.getElementById('updateModalDetails');
  const updateModalInstallBtn = document.getElementById('updateModalInstallBtn');
  const updateModalUpToDate = document.getElementById('updateModalUpToDate');

  function openUpdateModal() {
    if (!updateModal) return;
    updateModal.classList.remove('hidden');

    if (!_updateAvailable) {
      if (updateModalMsg) updateModalMsg.innerHTML = 'You are on the latest version.';
      if (updateModalUpToDate) { updateModalUpToDate.style.display = 'block'; }
      if (updateModalInstallBtn) { updateModalInstallBtn.style.display = 'none'; }
      if (updateModalDetails) { updateModalDetails.innerHTML = ''; }
    } else {
      if (updateModalUpToDate) updateModalUpToDate.style.display = 'none';
      if (updateModalInstallBtn) updateModalInstallBtn.style.display = 'block';
      if (updateModalMsg) {
        const dateStr = _lastUpdateInfo.date ? new Date(_lastUpdateInfo.date).toLocaleString() : 'Just now';
        updateModalMsg.innerHTML = `
          <strong style="color:var(--text-primary);display:block;margin-bottom:0.4rem;">${_lastUpdateInfo.message}</strong>
          <span style="font-size:0.75rem;color:var(--text-muted);">by ${_lastUpdateInfo.author} · ${dateStr}</span>
        `;
      }
      if (updateModalDetails) {
        const fileList = _lastUpdateInfo.files.map(f => `• ${f}`).join('\n');
        updateModalDetails.innerHTML = `<pre style="font-family:monospace;font-size:0.75rem;color:var(--text-secondary);white-space:pre-wrap;line-height:1.6;"
>${fileList}</pre>`;
  }
}

const SESSION_RESTORED_KEY = 'oc_session_restored';

function clearSupabaseSession() {
  // Wipe all Supabase auth tokens from localStorage
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('sb-')) keys.push(key);
  }
  keys.forEach(k => {
    try { localStorage.removeItem(k); } catch (e) {}
  });
  console.log('[App] Cleared', keys.length, 'Supabase localStorage keys (fresh install)');
}

  if (updateCheckBtn) {
    updateCheckBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      accountDropdown?.classList.add('hidden');
      // Always fetch fresh data when user explicitly clicks
      _updateAvailable = false;
      _lastUpdateInfo = null;
      const latest = await fetchLatestCommit();
      if (latest?.sha) {
        const localSha = localStorage.getItem(LOCAL_VERSION_KEY);
        if (latest.sha !== localSha) {
          const details = await fetchCommitDetails(latest.sha);
          const meaningful = (details?.files || []).filter(f => !isIgnoredFile(f.filename));
          if (meaningful.length > 0) {
            _updateAvailable = true;
            _lastUpdateInfo = {
              sha: latest.sha.slice(0, 7),
              message: latest.commit?.message || 'Update',
              author: latest.commit?.author?.name || 'Open Cloud',
              date: latest.commit?.committer?.date || '',
              files: meaningful.map(f => f.filename)
            };
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

  /* Sign Out */
  const signOutBtn = document.getElementById('signOutBtn');
  if (signOutBtn) {
    signOutBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      accountDropdown?.classList.add('hidden');
      await signOut();
      location.reload(true);
    });
  }

  /* Update Modal close + install */
  if (updateModalClose) {
    updateModalClose.addEventListener('click', () => updateModal?.classList.add('hidden'));
  }

  if (updateModalInstallBtn) {
    updateModalInstallBtn.addEventListener('click', async () => {
      showToast('Installing update...', 'info');
      try {
        const latest = await fetchLatestCommit();
        if (latest?.sha) localStorage.setItem(LOCAL_VERSION_KEY, latest.sha);
      } catch (e) {}
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(name => caches.delete(name)));
      }
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
      location.reload(true);
    });
  }

  /* Load home */
  loadHomeCategories().catch(err => {
    console.error('Failed to load home categories:', err);
  });
}

function updateAuthUI(user) {
  const accountAvatar = document.getElementById('accountAvatar');
  const accountName = document.getElementById('accountName');
  const profileAvatar = document.getElementById('profileAvatar');
  const profileUsername = document.getElementById('profileUsername');
  const dropdownUserAvatar = document.getElementById('dropdownUserAvatar');
  const dropdownUserName = document.getElementById('dropdownUserName');
  const dropdownUserEmail = document.getElementById('dropdownUserEmail');

  const displayName = getUserDisplayName();
  const email = user?.email || '';

  if (accountAvatar) accountAvatar.textContent = displayName.charAt(0).toUpperCase();
  if (accountName) accountName.textContent = displayName;
  if (profileAvatar) profileAvatar.textContent = displayName.charAt(0).toUpperCase();
  if (profileUsername) profileUsername.value = displayName;
  if (dropdownUserAvatar) dropdownUserAvatar.textContent = displayName.charAt(0).toUpperCase();
  if (dropdownUserName) dropdownUserName.textContent = displayName;
  if (dropdownUserEmail) dropdownUserEmail.textContent = email;
}

function showAuthModal() {
  const authModal = document.getElementById('authModal');
  if (authModal) {
    authModal.classList.remove('hidden');
    lockScroll();
    // Reset all auth fields: clear values, restore readonly, remove has-value class
    const ids = [
      ['signinEmail', false],
      ['signinPassword', true],
      ['signupUsername', false],
      ['signupEmail', false],
      ['signupPassword', true]
    ];
    ids.forEach(([id, isPw]) => {
      const el = document.getElementById(id);
      if (el) {
        el.value = '';
        el.readOnly = true;
        el.classList.remove('has-value');
        if (isPw) el.type = 'text';
      }
    });
    // Reset to sign-in tab after modal renders
    requestAnimationFrame(() => {
      const tabs = document.querySelectorAll('.auth-tab');
      const indicator = document.querySelector('.auth-tab-indicator');
      const signinTab = document.querySelector('.auth-tab[data-auth-tab="signin"]');
      tabs.forEach(t => t.classList.toggle('active', t.dataset.authTab === 'signin'));
      if (indicator && signinTab) {
        indicator.style.transform = `translateX(${signinTab.offsetLeft}px)`;
        indicator.style.width = `${signinTab.offsetWidth}px`;
      }
      const signinForm = document.getElementById('signinForm');
      const signupForm = document.getElementById('signupForm');
      signupForm?.classList.remove('active');
      signupForm && (signupForm.style.display = 'none');
      signinForm?.classList.add('active');
      signinForm && (signinForm.style.display = 'block');
    });
  }
}

function showEnvErrorModal(missing) {
  const appContainer = document.getElementById('appContainer');
  const splash = document.getElementById('splashScreen');
  if (splash) splash.style.display = 'none';
  if (appContainer) {
    appContainer.classList.add('visible');
    appContainer.innerHTML = `
      <div style="max-width:600px;margin:10vh auto;padding:2rem;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:12px;text-align:center;">
        <i class="fas fa-triangle-exclamation" style="font-size:3rem;color:#ef4444;margin-bottom:1rem;"></i>
        <h1 style="font-size:1.5rem;margin-bottom:1rem;">Configuration Required</h1>
        <p style="color:var(--text-secondary);margin-bottom:1.5rem;">
          Before running Open Cloud, you need to copy the included <code>.env.example</code> file to
          <code>.env</code> and fill in your API keys.
        </p>
        <div style="text-align:left;background:var(--bg-primary);padding:1rem;border-radius:8px;font-family:monospace;font-size:0.875rem;margin-bottom:1.5rem;">
          <div style="color:var(--text-muted);margin-bottom:0.5rem;"># Commands to set up</div>
          cp .env.example .env
          <br>nano .env
        </div>
        <p style="color:var(--text-secondary);font-size:0.875rem;margin-bottom:0.5rem;">
          <strong>Missing keys:</strong>
        </p>
        <ul style="text-align:left;color:#ef4444;font-family:monospace;font-size:0.875rem;">
          ${missing.map(k => `<li><code>${k}</code></li>`).join('')}
        </ul>
        <p style="color:var(--text-muted);font-size:0.8125rem;margin-top:1.5rem;">
          Get your free API keys at
          <a href="https://www.themoviedb.org/settings/api" target="_blank">TMDB</a>,
          <a href="https://www.omdbapi.com/apikey.aspx" target="_blank">OMDB</a>, and
          <a href="https://supabase.com" target="_blank">Supabase</a>.
        </p>
      </div>
    `;
  }
}

const SESSION_RESTORED_KEY = 'oc_session_restored';

function clearSupabaseSession() {
  // Wipe all Supabase auth tokens from localStorage
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('sb-')) keys.push(key);
  }
  keys.forEach(k => {
    try { localStorage.removeItem(k); } catch (e) {}
  });
  console.log('[App] Cleared', keys.length, 'Supabase localStorage keys (fresh install)');
}

/* Initialize everything with error boundaries */
async function initApp() {
  try {
    // On a fresh ZIP download (first ever open), localStorage is completely
    // empty. We use that as the signal to wipe any stale Supabase tokens left
    // behind by a previous install on the same localhost:8080 origin.
    const isFirstEverOpen = !localStorage.getItem(SESSION_RESTORED_KEY);
    if (isFirstEverOpen) {
      clearSupabaseSession();
      localStorage.setItem(SESSION_RESTORED_KEY, 'true');
    }

    // Initialize Supabase auth
    const hasSupabase = initSupabase();
    let user = null;

    initAuthModal();

    if (hasSupabase) {
      user = await Promise.race([
        checkSession(),
        new Promise(resolve => setTimeout(() => { console.warn('[App] Session check timed out'); resolve(null); }, 4000))
      ]);
    }

    // Mandatory auth: if not authenticated, show auth modal and block everything
    if (hasSupabase && !user) {
      showAuthModal();
      initSettings();
      window._appLoaded = true;
      return;
    }

    // User is authenticated — init everything
    await hydrateSettingsFromCloud();
    initSettings();
    updateAuthUI(user);
    await initAppContent();

    window._appLoaded = true;
    window.scrollTo(0, 0);
  } catch (err) {
    console.error('Open Cloud init failed:', err);
    const splash = document.getElementById('splashScreen');
    const msgEl = splash?.querySelector('.splash-error-msg');
    if (msgEl && splash) {
      msgEl.innerHTML = `<p style="margin-bottom:0.5rem;color:#fff;font-weight:600;">App Error</p><p style="font-size:0.75rem;color:#aaa;font-family:monospace;max-width:300px;word-break:break-word;">${err?.message || err || 'Unknown error'}</p><p style="margin-top:0.75rem;font-size:0.8rem;">Check browser console for details.</p>`;
      document.getElementById('moduleError').style.display = 'flex';
    }
  }
}

initApp();
