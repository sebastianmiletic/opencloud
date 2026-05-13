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
import { showToast } from './utils.js';
import { getAccounts, saveAccounts, setCurrentUser } from './storage.js';
import { setAccounts } from './state.js';

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

/* Initialize everything with error boundaries */
function initApp() {
  try {
    initStorage();
    initUser();
    initNav();
    initSearch();
    initModals();
    initPlayer();
    initHero();
    initSettings();
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
        // If first account, auto-switch to it
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

    /* Load home */
    loadHomeCategories().catch(err => {
      console.error('Failed to load home categories:', err);
    });

    /* Mark app as loaded */
    window._appLoaded = true;
  } catch (err) {
    console.error('Open Cloud init failed:', err);
  }
}

initApp();
