import { getSettings, saveSettings, PROVIDERS, applyDeviceClass, applyBetaUi, getActiveProvider } from './config.js';
import { showToast } from './utils.js';
import { initBlockerUI } from './blocker.js';
import { getCurrentUser } from './storage.js';
import { scheduleSync, getWatchSessions, aggregateStats } from './supabase.js';
import { isAdmin, getCurrentAuthUser, getUserEmail, updatePassword, updateEmail, deleteAccount, signOut } from './auth.js';
import { fetchAllUsers, fetchTotalUserCount, fetchUserStats } from './sync.js';

let settings = getSettings();
let currentSettingsTab = 'general';

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981',
  '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#f43f5e'
];

function getUserProfileKey() {
  const user = getCurrentUser();
  return user ? `openccloud_user_${user}_profile` : '';
}

function getLocalProfile() {
  const key = getUserProfileKey();
  if (!key) return null;
  try {
    return JSON.parse(localStorage.getItem(key)) || {};
  } catch (e) {
    return {};
  }
}

function saveLocalProfile(profile) {
  const key = getUserProfileKey();
  if (!key) return;
  localStorage.setItem(key, JSON.stringify(profile));
}

export function initSettings() {
  const btn = document.getElementById('settingsBtn');
  const modal = document.getElementById('settingsModal');
  const close = document.getElementById('settingsClose');
  const cancel = document.getElementById('settingsCancel');
  const form = document.getElementById('settingsForm');

  if (btn) btn.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('accountDropdown')?.classList.add('hidden');
    openSettingsModal();
  });

  if (close) close.addEventListener('click', () => modal?.classList.add('hidden'));
  if (cancel) cancel.addEventListener('click', () => modal?.classList.add('hidden'));

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await saveSettingsFromForm();
    });
  }

  // Tab switching
  document.querySelectorAll('.settings-tab-btn').forEach(tabBtn => {
    tabBtn.addEventListener('click', () => {
      const tab = tabBtn.dataset.tab;
      switchSettingsTab(tab);
    });
  });

  // Avatar upload
  const avatarUploadBtn = document.getElementById('profileAvatarUploadBtn');
  const avatarInput = document.getElementById('profileAvatarInput');
  if (avatarUploadBtn && avatarInput) {
    avatarUploadBtn.addEventListener('click', () => avatarInput.click());
    avatarInput.addEventListener('change', handleAvatarUpload);
  }

  applyDeviceClass();
}

function switchSettingsTab(tab) {
  currentSettingsTab = tab;
  document.querySelectorAll('.settings-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.settings-tab-panel').forEach(panel => {
    panel.classList.toggle('hidden', panel.dataset.panel !== tab);
  });
  if (tab === 'blocker') {
    initBlockerUI();
  }
  if (tab === 'sources') {
    renderProviderCards();
  }
  if (tab === 'profile') {
    renderProfileTab();
  }
  if (tab === 'stats') {
    renderStatsTab();
  }
  if (tab === 'admin') {
    renderAdminTab();
  }
  if (tab === 'account') {
    renderAccountTab();
  }
}

export function openSettingsModal() {
  settings = getSettings();
  const modal = document.getElementById('settingsModal');
  const deviceSelect = document.getElementById('settingsDevice');
  const autoPlay = document.getElementById('settingsAutoPlay');
  const betaUi = document.getElementById('settingsBetaUi');

  if (deviceSelect) deviceSelect.value = settings.device;
  if (autoPlay) autoPlay.checked = settings.autoPlay !== false;
  if (betaUi) betaUi.checked = settings.beta_ui === true;

  // Show/hide admin tab
  const adminTabBtn = document.getElementById('adminTabBtn');
  if (adminTabBtn) {
    if (isAdmin()) {
      adminTabBtn.classList.remove('hidden');
    } else {
      adminTabBtn.classList.add('hidden');
    }
  }

  // Always re-render provider cards so they're fresh when the Sources tab is shown
  renderProviderCards();
  switchSettingsTab('general');
  modal?.classList.remove('hidden');
}

function renderProviderCards() {
  const container = document.getElementById('settingsProviderCards');
  if (!container) return;

  const currentKey = getSettings().provider;

  // Sort: tier 1 (best) first, then alphabetical by name
  const sortedEntries = Object.entries(PROVIDERS).sort((a, b) => {
    const tierA = a[1].tier || 99;
    const tierB = b[1].tier || 99;
    if (tierA !== tierB) return tierA - tierB;
    return a[1].name.localeCompare(b[1].name);
  });

  container.innerHTML = sortedEntries.map(([key, p]) => {
    const isActive = key === currentKey;
    const isBest = p.tier === 1;
    const rankLabel = p.rank || '';
    const badges = [];
    if (rankLabel) badges.push(`<span class="provider-badge badge-rank">${rankLabel}</span>`);
    if (p.movie && p.tv) badges.push('<span class="provider-badge"><i class="fas fa-film"></i> Movies + TV</span>');
    else if (p.movie) badges.push('<span class="provider-badge"><i class="fas fa-film"></i> Movies</span>');
    else if (p.tv) badges.push('<span class="provider-badge"><i class="fas fa-tv"></i> TV</span>');
    if (p.quality === '4K') badges.push('<span class="provider-badge badge-4k">4K</span>');
    else if (p.quality) badges.push(`<span class="provider-badge">${p.quality}</span>`);
    if (p.subtitles) badges.push('<span class="provider-badge"><i class="fas fa-closed-captioning"></i> Subs</span>');
    badges.push(`<span class="provider-badge"><i class="fas fa-bolt"></i> ${p.speed}</span>`);

    return `
      <div class="provider-card ${isActive ? 'active' : ''} ${isBest ? 'provider-best' : ''}" data-provider="${key}">
        <div class="provider-card-header">
          <div class="provider-card-name">${p.name}</div>
          <div class="provider-card-check">${isActive ? '<i class="fas fa-check-circle"></i>' : '<i class="far fa-circle"></i>'}</div>
        </div>
        <div class="provider-card-badges">${badges.join('')}</div>
        <div class="provider-card-desc">${p.description}</div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.provider-card').forEach(card => {
    card.addEventListener('click', () => {
      const key = card.dataset.provider;
      settings.provider = key;
      saveSettings(settings);
      scheduleSync();
      renderProviderCards();
      showToast(`Switched to ${PROVIDERS[key].name}`, 'success');
    });
  });
}

async function saveSettingsFromForm() {
  if (currentSettingsTab === 'profile') {
    await saveProfile();
    return;
  }

  if (currentSettingsTab === 'sources' || currentSettingsTab === 'blocker' || currentSettingsTab === 'stats' || currentSettingsTab === 'account') {
    // These tabs auto-save on interaction; just close the modal
    document.getElementById('settingsModal')?.classList.add('hidden');
    return;
  }

  const device = document.getElementById('settingsDevice')?.value || 'laptop';
  const autoPlay = document.getElementById('settingsAutoPlay')?.checked ?? true;
  const betaUi = document.getElementById('settingsBetaUi')?.checked ?? false;
  const betaChanged = settings.beta_ui !== betaUi;

  settings.device = device;
  settings.autoPlay = autoPlay;
  settings.beta_ui = betaUi;

  saveSettings(settings);
  scheduleSync();
  applyDeviceClass();
  applyBetaUi();

  document.getElementById('settingsModal')?.classList.add('hidden');
  showToast('Settings saved', 'success');

  if (betaChanged) {
    showToast(betaUi ? 'Reloading with BETA UI...' : 'Reloading with standard UI...', 'info');
    setTimeout(() => location.reload(true), 600);
  }
}

/* Profile Tab State */
let _pendingProfileChanges = { avatar_url: null, avatar_color: null };

function renderProfileTab() {
  const profile = getLocalProfile();
  const usernameInput = document.getElementById('profileUsername');
  const avatarEl = document.getElementById('profileAvatar');
  const presetsEl = document.getElementById('profileAvatarPresets');

  // Reset pending changes whenever tab is opened
  _pendingProfileChanges = { avatar_url: null, avatar_color: null };

  if (usernameInput) {
    usernameInput.value = profile?.username || '';
  }

  // Determine current avatar state
  const hasCustomPhoto = profile?.avatar_url;
  const currentColor = profile?.avatar_color || PRESET_COLORS[0];
  const displayName = profile?.username || getCurrentUser() || 'U';
  const initial = displayName.charAt(0).toUpperCase();

  // Render main avatar
  if (avatarEl) {
    if (hasCustomPhoto) {
      avatarEl.innerHTML = `<img src="${profile.avatar_url}" alt="avatar">`;
    } else {
      avatarEl.innerHTML = '';
      avatarEl.textContent = initial;
      avatarEl.style.background = currentColor;
      avatarEl.style.color = '#fff';
    }
  }

  // Render preset color circles
  if (presetsEl) {
    presetsEl.innerHTML = PRESET_COLORS.map((color) => {
      const isActive = !hasCustomPhoto && currentColor === color;
      return `<div class="preset-avatar ${isActive ? 'active' : ''}" data-color="${color}" style="background:${color};">${initial}</div>`;
    }).join('');

    presetsEl.querySelectorAll('.preset-avatar').forEach(el => {
      el.addEventListener('click', () => {
        // Mark this preset as selected visually
        presetsEl.querySelectorAll('.preset-avatar').forEach(a => a.classList.remove('active'));
        el.classList.add('active');

        // Update main avatar preview to show the preset color
        if (avatarEl) {
          avatarEl.innerHTML = '';
          avatarEl.textContent = initial;
          avatarEl.style.background = el.dataset.color;
          avatarEl.style.color = '#fff';
        }

        // Track that we want to use a preset color, not a custom photo
        _pendingProfileChanges.avatar_url = null;
        _pendingProfileChanges.avatar_color = el.dataset.color;
      });
    });
  }
}

function handleAvatarUpload(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const dataUrl = ev.target.result;
    const avatarEl = document.getElementById('profileAvatar');
    const presetsEl = document.getElementById('profileAvatarPresets');

    // Update preview to show uploaded photo
    if (avatarEl) {
      avatarEl.innerHTML = `<img src="${dataUrl}" alt="avatar">`;
    }

    // Remove active state from all presets since we're using a custom photo
    if (presetsEl) {
      presetsEl.querySelectorAll('.preset-avatar').forEach(a => a.classList.remove('active'));
    }

    // Track that we want to use this custom photo
    _pendingProfileChanges.avatar_url = dataUrl;
    _pendingProfileChanges.avatar_color = null;
  };
  reader.readAsDataURL(file);
}

async function saveProfile() {
  const usernameInput = document.getElementById('profileUsername');

  try {
    const profile = getLocalProfile() || {};

    // Username: always save what's in the field (even empty string allows clearing)
    const newUsername = usernameInput?.value.trim();
    if (newUsername !== undefined) {
      profile.username = newUsername;
    }

    // Avatar: use pending changes if any
    if (_pendingProfileChanges.avatar_url) {
      profile.avatar_url = _pendingProfileChanges.avatar_url;
      profile.avatar_color = null;
    } else if (_pendingProfileChanges.avatar_color) {
      profile.avatar_color = _pendingProfileChanges.avatar_color;
      profile.avatar_url = null;
    }

    saveLocalProfile(profile);

    // Reset pending changes
    _pendingProfileChanges = { avatar_url: null, avatar_color: null };

    // Update the account dropdown avatar and name
    const accountAvatar = document.getElementById('accountAvatar');
    const accountName = document.getElementById('accountName');
    const displayName = profile.username || getCurrentUser() || 'U';
    const initial = displayName.charAt(0).toUpperCase();

    if (accountName) accountName.textContent = displayName;
    if (accountAvatar) {
      if (profile.avatar_url) {
        accountAvatar.innerHTML = `<img src="${profile.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
      } else {
        accountAvatar.innerHTML = '';
        accountAvatar.textContent = initial;
        accountAvatar.style.background = profile.avatar_color || PRESET_COLORS[0];
        accountAvatar.style.color = '#fff';
      }
    }

    showToast('Profile saved', 'success');
    window.dispatchEvent(new CustomEvent('profileUpdated'));
    document.getElementById('settingsModal')?.classList.add('hidden');
  } catch (err) {
    console.error('[saveProfile] Error:', err);
    showToast(err.message || 'Failed to save profile', 'error');
  }
}

/* Account Tab */
function renderAccountTab() {
  const emailEl = document.getElementById('accountCurrentEmail');
  if (emailEl) {
    const email = getUserEmail();
    emailEl.textContent = email || 'Not signed in';
  }

  // Wire up buttons (idempotent — safe to call multiple times)
  const pwBtn = document.getElementById('accountUpdatePasswordBtn');
  const emailBtn = document.getElementById('accountUpdateEmailBtn');
  const delBtn = document.getElementById('accountDeleteBtn');

  if (pwBtn && !pwBtn._wired) {
    pwBtn._wired = true;
    pwBtn.addEventListener('click', async () => {
      const newPw = document.getElementById('accountNewPassword')?.value;
      if (!newPw || newPw.length < 6) {
        showToast('Password must be at least 6 characters', 'error');
        return;
      }
      const { error } = await updatePassword(newPw);
      if (!error) {
        document.getElementById('accountNewPassword').value = '';
      }
    });
  }

  if (emailBtn && !emailBtn._wired) {
    emailBtn._wired = true;
    emailBtn.addEventListener('click', async () => {
      const newEmail = document.getElementById('accountNewEmail')?.value?.trim();
      if (!newEmail || !newEmail.includes('@')) {
        showToast('Enter a valid email', 'error');
        return;
      }
      const { error } = await updateEmail(newEmail);
      if (!error) {
        document.getElementById('accountNewEmail').value = '';
        const emailEl = document.getElementById('accountCurrentEmail');
        if (emailEl) emailEl.textContent = newEmail;
      }
    });
  }

  if (delBtn && !delBtn._wired) {
    delBtn._wired = true;
    delBtn.addEventListener('click', async () => {
      const confirmed = confirm('Are you sure? This will permanently delete your account and all data.');
      if (!confirmed) return;
      const { error } = await deleteAccount();
      if (!error) {
        document.getElementById('settingsModal')?.classList.add('hidden');
        // Show auth modal after deletion
        const authModal = document.getElementById('authModal');
        if (authModal) {
          authModal.classList.remove('hidden');
        }
      }
    });
  }
}

/* Stats Tab */
async function renderStatsTab() {
  const dashboard = document.getElementById('statsDashboard');
  if (!dashboard) return;

  // Loading state
  document.getElementById('statsTotalHours').textContent = '…';
  document.getElementById('statsMoviesCount').textContent = '…';
  document.getElementById('statsEpisodesCount').textContent = '…';
  document.getElementById('statsStreak').innerHTML = '0 <span style="font-size:0.75rem;font-weight:500;">days</span>';

  const sessions = await getWatchSessions(365);
  const stats = aggregateStats(sessions);

  document.getElementById('statsTotalHours').textContent = (stats.totalSeconds / 3600).toFixed(1);
  document.getElementById('statsMoviesCount').textContent = stats.movies;
  document.getElementById('statsEpisodesCount').textContent = stats.episodes;
  document.getElementById('statsStreak').innerHTML = `${stats.streak} <span style="font-size:0.75rem;font-weight:500;">days</span>`;

  renderHeatmap(stats.daily);
  renderDayBars(stats.dayOfWeek);
}

function renderHeatmap(daily) {
  const container = document.getElementById('statsHeatmap');
  if (!container) return;

  const today = new Date();
  const cells = [];
  for (let i = 364; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const minutes = (daily[key] || 0) / 60;
    let level = 0;
    if (minutes > 0) level = 1;
    if (minutes >= 30) level = 2;
    if (minutes >= 60) level = 3;
    if (minutes >= 120) level = 4;
    if (minutes >= 180) level = 5;
    cells.push(`<div class="heatmap-cell level-${level}" title="${key}: ${Math.round(minutes)}m"></div>`);
  }
  container.innerHTML = cells.join('');

  // Simple tooltip on hover
  container.querySelectorAll('.heatmap-cell').forEach(cell => {
    cell.addEventListener('mouseenter', (e) => {
      const text = e.target.getAttribute('title');
      if (!text) return;
      const tooltip = document.createElement('div');
      tooltip.className = 'heatmap-tooltip';
      tooltip.textContent = text;
      tooltip.id = 'activeHeatmapTooltip';
      document.body.appendChild(tooltip);
      const rect = e.target.getBoundingClientRect();
      tooltip.style.left = `${rect.left + rect.width / 2 - tooltip.offsetWidth / 2}px`;
      tooltip.style.top = `${rect.top - tooltip.offsetHeight - 6}px`;
    });
    cell.addEventListener('mouseleave', () => {
      document.getElementById('activeHeatmapTooltip')?.remove();
    });
  });
}

function renderDayBars(dayOfWeek) {
  const container = document.getElementById('statsDayBars');
  if (!container) return;
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const max = Math.max(...dayOfWeek, 1);
  container.innerHTML = days.map((label, i) => {
    const pct = Math.round((dayOfWeek[i] / max) * 100);
    const hours = (dayOfWeek[i] / 3600).toFixed(1);
    return `
      <div class="stats-bar-row">
        <div class="stats-bar-label">${label}</div>
        <div class="stats-bar-track">
          <div class="stats-bar-fill" style="width:${pct}%"></div>
        </div>
        <div class="stats-bar-value">${hours}h</div>
      </div>`;
  }).join('');
}

/* Admin Tab */
async function renderAdminTab() {
  const totalUsersEl = document.getElementById('adminTotalUsers');
  const activeTodayEl = document.getElementById('adminActiveToday');
  const userListEl = document.getElementById('adminUserList');

  if (totalUsersEl) totalUsersEl.textContent = '…';
  if (activeTodayEl) activeTodayEl.textContent = '…';
  if (userListEl) userListEl.innerHTML = '<div class="blocker-empty-logs">Loading users...</div>';

  try {
    const totalUsers = await fetchTotalUserCount();
    if (totalUsersEl) totalUsersEl.textContent = totalUsers;

    const users = await fetchAllUsers();
    if (activeTodayEl) {
      const today = new Date().toISOString().slice(0, 10);
      const activeToday = users.filter(u => u.created_at?.startsWith(today)).length;
      activeTodayEl.textContent = activeToday;
    }

    if (userListEl) {
      if (!users.length) {
        userListEl.innerHTML = '<div class="blocker-empty-logs">No users found</div>';
        return;
      }

      userListEl.innerHTML = users.map(user => {
        const date = new Date(user.created_at).toLocaleDateString();
        const isAdminBadge = user.is_admin ? '<span style="color:var(--text-primary);font-size:0.625rem;background:var(--bg-tertiary);padding:0.125rem 0.375rem;border-radius:4px;">ADMIN</span>' : '';
        return `
          <div class="admin-user-item" data-user-id="${user.id}" style="display:flex;align-items:center;gap:0.75rem;padding:0.75rem;background:var(--bg-tertiary);border:1px solid var(--border-color);border-radius:var(--radius-md);margin-bottom:0.5rem;">
            <div class="dropdown-avatar">${(user.username || user.email || 'U').charAt(0).toUpperCase()}</div>
            <div style="flex:1;min-width:0;">
              <div style="font-weight:600;font-size:0.875rem;">${user.username || user.email?.split('@')[0] || 'Unknown'} ${isAdminBadge}</div>
              <div style="font-size:0.75rem;color:var(--text-muted);">${user.email || ''} · Joined ${date}</div>
            </div>
            <button class="btn btn-secondary admin-view-user-btn" data-user-id="${user.id}" style="font-size:0.75rem;padding:0.375rem 0.75rem;">View</button>
          </div>`;
      }).join('');

      userListEl.querySelectorAll('.admin-view-user-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const userId = btn.dataset.userId;
          const stats = await fetchUserStats(userId);
          if (stats) {
            showToast(`Collection: ${stats.collectionCount} · History: ${stats.historyCount}`, 'info');
          }
        });
      });
    }
  } catch (err) {
    console.error('[Admin] Failed to load admin data:', err);
    if (userListEl) userListEl.innerHTML = '<div class="blocker-empty-logs">Failed to load users</div>';
  }
}
