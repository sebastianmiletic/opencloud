/** Main App Entry Point */
import { initStorage } from './storage.js';
import { initUser, renderManageAccounts, renderAccountDropdown } from './accounts.js';
import { initSettings } from './settings.js';
import { initPlayer } from './player.js';
import { initHero } from './hero.js';
import { initBlocker } from './blocker.js';
import {
  initNav, initSearch, initModals, loadHomeCategories, openItemModal,
  addToUserCollection, addToUserHistory, renderUserCollection
} from './ui.js';
import { showToast, lockScroll, unlockScroll } from './utils.js';
import { getAccounts, saveAccounts, setCurrentUser } from './storage.js';
import { setAccounts } from './state.js';
import { initSupabase, checkSession, signIn, signUp, signOut, isAuthenticated, getUserDisplayName } from './auth.js';

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
    splash.classList.add('hidden');
    if (app) app.style.opacity = '1';
    window.scrollTo(0, 0);
  }, 3200);
}
initSplash();

/* Hero events (breaks circular dependency) */
window.addEventListener('heroOpenModal', (e) => {
  const { id, type } = e.detail;
  if (id && type) openItemModal(id, type);
});
window.addEventListener('heroAddToCollection', (e) => {
  try {
    addToUserCollection(e.detail);
  } catch (err) {
    console.error('[heroAddToCollection] Error:', err);
  }
});
window.addEventListener('watchStarted', (e) => {
  const { id, type } = e.detail || {};
  if (!id || !type) return;
  addToUserHistory({ id, media_type: type }).catch((err) => {
    console.error('[watchStarted] Failed to save history:', err);
  });
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

  /* Close auth modal */
  const authModalClose = document.getElementById('authModalClose');
  const authOverlay = authModal?.querySelector('.modal-overlay');
  if (authModalClose) {
    authModalClose.addEventListener('click', () => {
      authModal?.classList.add('hidden');
      unlockScroll();
    });
  }
  if (authOverlay) {
    authOverlay.addEventListener('click', () => {
      authModal?.classList.add('hidden');
      unlockScroll();
    });
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
        signupForm?.style.display = 'none';
        signinForm && (signinForm.style.display = 'block');
      }, 50);
    } else {
      signinForm?.classList.remove('active');
      setTimeout(() => {
        signupForm?.classList.add('active');
        signinForm && (signinForm.style.display = 'none');
        signupForm && (signupForm.style.display = 'block');
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
    }
  });
}

function updateAuthUI(user) {
  const accountAvatar = document.getElementById('accountAvatar');
  const accountName = document.getElementById('accountName');
  const profileAvatar = document.getElementById('profileAvatar');
  const profileUsername = document.getElementById('profileUsername');

  const displayName = getUserDisplayName();

  if (accountAvatar) accountAvatar.textContent = displayName.charAt(0).toUpperCase();
  if (accountName) accountName.textContent = displayName;
  if (profileAvatar) profileAvatar.textContent = displayName.charAt(0).toUpperCase();
  if (profileUsername) profileUsername.value = displayName;
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

/* Initialize everything with error boundaries */
async function initApp() {
  try {
    // Initialize Supabase auth
    const hasSupabase = initSupabase();
    let user = null;

    if (hasSupabase) {
      // Timeout checkSession after 4s so the app doesn't hang on slow networks
      user = await Promise.race([
        checkSession(),
        new Promise(resolve => setTimeout(() => { console.warn('[App] Session check timed out'); resolve(null); }, 4000))
      ]);
      initAuthModal();
    }

    initStorage();
    initUser();
    initNav();
    initSearch();
    initModals();
    initPlayer();
    initHero();
    initSettings();
    initBlocker();

    // If not authenticated and Supabase is configured, show auth modal
    if (hasSupabase && !user) {
      showAuthModal();
    } else if (user) {
      updateAuthUI(user);
    }

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

    /* Add Account */
    const addAccountBtn = document.getElementById('addAccountBtn');
    const addAccountModal = document.getElementById('addAccountModal');
    const addAccountClose = document.getElementById('addAccountClose');
    const addAccountCancel = document.getElementById('addAccountCancel');
    const addAccountForm = document.getElementById('addAccountForm');
    const newAccountName = document.getElementById('newAccountName');

    if (addAccountBtn) {
      addAccountBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        accountDropdown?.classList.add('hidden');
        addAccountModal?.classList.remove('hidden');
        if (newAccountName) {
          newAccountName.value = '';
          newAccountName.focus();
        }
      });
    }

    addAccountClose?.addEventListener('click', () => addAccountModal?.classList.add('hidden'));
    addAccountCancel?.addEventListener('click', () => addAccountModal?.classList.add('hidden'));

    if (addAccountForm) {
      addAccountForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = newAccountName?.value.trim();
        if (!name) return;
        const accounts = getAccounts();
        if (accounts.includes(name)) {
          showToast('Account already exists', 'error');
          return;
        }
        accounts.push(name);
        saveAccounts(accounts);
        setAccounts(accounts);
        if (accounts.length === 1) {
          setCurrentUser(name);
          initUser();
        }
        renderAccountDropdown();
        addAccountModal?.classList.add('hidden');
        showToast(`Account "${name}" created`, 'success');
      });
    }

    /* Manage Accounts */
    const manageAccountsBtn = document.getElementById('manageAccountsBtn');
    const manageAccountsModal = document.getElementById('manageAccountsModal');
    const manageAccountsClose = document.getElementById('manageAccountsClose');

    if (manageAccountsBtn) {
      manageAccountsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        accountDropdown?.classList.add('hidden');
        renderManageAccounts();
        manageAccountsModal?.classList.remove('hidden');
      });
    }

    manageAccountsClose?.addEventListener('click', () => manageAccountsModal?.classList.add('hidden'));

    /* Install Latest Update */
    const updateBtn = document.getElementById('updateBtn');
    const versionBadge = document.getElementById('versionBadge');
    const APP_VERSION = '1.0.0';
    if (versionBadge) versionBadge.textContent = `v${APP_VERSION}`;
    if (updateBtn) {
      updateBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        accountDropdown?.classList.add('hidden');
        showToast('Checking for updates...', 'info');
        try {
          // Force reload with cache clearing to get latest files
          if ('caches' in window) {
            const cacheNames = await caches.keys();
            await Promise.all(cacheNames.map(name => caches.delete(name)));
          }
          location.reload(true);
        } catch (err) {
          console.error('[App] Update failed:', err);
          location.reload(true);
        }
      });
    }

    /* Sign Out */
    const signOutBtn = document.getElementById('signOutBtn');
    if (signOutBtn) {
      signOutBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        accountDropdown?.classList.add('hidden');
        await signOut();
        showAuthModal();
      });
    }

    /* Load home */
    loadHomeCategories().catch(err => {
      console.error('Failed to load home categories:', err);
    });

    /* Mark app as loaded */
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
