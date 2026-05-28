/** Account System */
import { accounts, setAccounts, setUserCollection, setUserHistory, setWatchProgress, setUserFolders } from './state.js';
import {
  getAccounts, saveAccounts, getCurrentUser, setCurrentUser,
  getUserCollection, getUserHistory, getWatchProgress, getUserFolders
} from './storage.js';
import { showToast, showConfirm } from './utils.js';

function getLocalProfile(user) {
  if (!user) return null;
  try {
    return JSON.parse(localStorage.getItem(`openccloud_user_${user}_profile`)) || {};
  } catch (e) {
    return {};
  }
}

export function initUser() {
  const user = getCurrentUser();
  const avatar = document.getElementById('accountAvatar');
  const name = document.getElementById('accountName');
  const profile = getLocalProfile(user);
  const displayName = profile?.username || user || 'Default';

  if (name) name.textContent = displayName;
  if (avatar) {
    if (profile?.avatar_url) {
      avatar.innerHTML = `<img src="${profile.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    } else {
      avatar.innerHTML = '';
      avatar.textContent = displayName.charAt(0).toUpperCase();
      avatar.style.background = profile?.avatar_color || 'var(--text-primary)';
      avatar.style.color = 'var(--bg-primary)';
    }
  }

  setUserCollection(getUserCollection());
  setUserHistory(getUserHistory());
  setWatchProgress(getWatchProgress());
  setUserFolders(getUserFolders());
  renderAccountDropdown();
}

export function renderAccountDropdown() {
  const current = getCurrentUser();
  const accountList = document.getElementById('accountList');
  if (!accountList) return;
  accountList.innerHTML = accounts.map(user => `
    <button class="dropdown-item" data-user="${user}">
      <div class="dropdown-avatar">${user.charAt(0).toUpperCase()}</div>
      <span>${user}</span>
      <i class="fas fa-check check-icon ${user === current ? '' : 'hidden'}" data-check="${user}"></i>
    </button>
  `).join('');

  accountList.querySelectorAll('.dropdown-item[data-user]').forEach(item => {
    item.addEventListener('click', () => {
      const user = item.dataset.user;
      if (user === getCurrentUser()) return;

      // Close any open overlays before switching to prevent cross-account state leaks
      document.getElementById('playerOverlay')?.classList.add('hidden');
      const playerFrame = document.getElementById('playerFrame');
      if (playerFrame) playerFrame.src = '';
      document.getElementById('itemModal')?.classList.add('hidden');
      document.getElementById('manageAccountsModal')?.classList.add('hidden');
      document.getElementById('addAccountModal')?.classList.add('hidden');
      document.getElementById('settingsModal')?.classList.add('hidden');
      document.getElementById('epPopoverOverlay')?.classList.add('hidden');
      document.getElementById('confirmModal')?.classList.add('hidden');
      import('./utils.js').then(m => m.unlockScroll());

      setCurrentUser(user);
      initUser();
      document.getElementById('accountDropdown')?.classList.add('hidden');
      document.getElementById('accountBtn')?.classList.remove('open');
      // Reload current tab via dynamic import to avoid circular deps
      const activeTab = document.querySelector('.nav-btn.active')?.dataset.tab || 'home';
      if (activeTab === 'home') {
        import('./ui.js').then(m => {
          m.loadHomeCategories();
          m.loadContinueWatching();
        });
      } else if (activeTab === 'collection') {
        import('./ui.js').then(m => m.renderUserCollection());
      } else if (activeTab === 'history') {
        import('./ui.js').then(m => m.renderUserHistory());
      }
      showToast(`Switched to ${user}`, 'success');
    });
  });
}

export function renderManageAccounts() {
  const manageAccountsList = document.getElementById('manageAccountsList');
  if (!manageAccountsList) return;
  manageAccountsList.innerHTML = accounts.map(user => {
    const prefix = `openccloud_user_${user}`;
    const ucCount = (JSON.parse(localStorage.getItem(`${prefix}_usercollection`)) || []).length;
    const hCount = (JSON.parse(localStorage.getItem(`${prefix}_history`)) || []).length;
    const pCount = Object.keys(JSON.parse(localStorage.getItem(`${prefix}_progress`)) || {}).length;
    const fCount = (JSON.parse(localStorage.getItem(`${prefix}_folders`)) || []).length;
    const isCurrent = user === getCurrentUser();
    const canDelete = accounts.length > 1;
    return `
      <div class="manage-account-item">
        <div class="dropdown-avatar">${user.charAt(0).toUpperCase()}</div>
        <div class="account-info">
          <div class="name">${user} ${isCurrent ? '<span style="color:var(--text-muted);font-size:0.75rem;">(Current)</span>' : ''}</div>
          <div class="details">${ucCount} in collection • ${hCount} in history • ${pCount} in progress • ${fCount} folders</div>
        </div>
        <button class="remove-btn" data-user="${user}" ${!canDelete ? 'disabled' : ''}>Remove</button>
      </div>
    `;
  }).join('');

  manageAccountsList.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const user = btn.dataset.user;
      const confirmed = await showConfirm('Remove Account?', `Remove account "${user}" and all its data? This cannot be undone.`);
      if (!confirmed) return;
      const newAccounts = accounts.filter(u => u !== user);
      saveAccounts(newAccounts);
      setAccounts(newAccounts);
      localStorage.removeItem(`openccloud_user_${user}_usercollection`);
      localStorage.removeItem(`openccloud_user_${user}_history`);
      localStorage.removeItem(`openccloud_user_${user}_progress`);
      localStorage.removeItem(`openccloud_user_${user}_folders`);
      if (getCurrentUser() === user) {
        setCurrentUser(newAccounts[0] || 'Default');
        initUser();
      }
      renderManageAccounts();
      renderAccountDropdown();
      showToast(`Account "${user}" removed`, 'success');
    });
  });
}
