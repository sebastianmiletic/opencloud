/** Open Cloud Settings */

import { getSettings, saveSettings, PROVIDERS, THEMES, applyDeviceClass, applyAppearanceSettings, getActiveProvider } from './config.js';
import { showToast } from './utils.js';
import { initBlockerUI } from './blocker.js';
import { getCurrentUser, getLocalProfile, saveLocalProfile } from './storage.js';
import { getWatchSessions, aggregateStats } from './supabase.js';
import { getUserEmail, updatePassword, updateEmail, deleteAccount } from './auth.js';

let settings = getSettings();
let currentSettingsTab = 'general';
const providerHealthScores = new Map();

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981',
  '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#f43f5e'
];

export function initSettings() {
  applyDeviceClass();
  applyAppearanceSettings();
  const btn = document.getElementById('settingsBtn');
  const modal = document.getElementById('settingsModal');
  const close = document.getElementById('settingsClose');
  const cancel = document.getElementById('settingsCancel');
  const form = document.getElementById('settingsForm');
  const autoFailover = document.getElementById('settingsAutoFailover');
  const roundedUI = document.getElementById('settingsRoundedUI');

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

  autoFailover?.addEventListener('change', () => {
    settings = getSettings();
    settings.autoProviderFailover = autoFailover.checked;
    saveSettings(settings);
    showToast(autoFailover.checked ? 'Automatic failover enabled' : 'Automatic failover disabled', 'success');
  });

  document.querySelectorAll('[data-theme-option]').forEach(option => {
    option.addEventListener('click', () => {
      const theme = option.dataset.themeOption;
      if (!THEMES.includes(theme)) return;
      settings = { ...getSettings(), theme };
      saveSettings(settings);
      renderThemeOptions();
      showToast(`${option.querySelector('strong')?.textContent || 'Theme'} applied`, 'success');
    });
  });

  roundedUI?.addEventListener('change', () => {
    settings = { ...getSettings(), roundedUI: roundedUI.checked };
    saveSettings(settings);
    showToast(roundedUI.checked ? 'Rounder UI enabled' : 'Standard UI restored', 'success');
  });

  window.addEventListener('opencloud:provider-health', (event) => {
    const { provider, score, state } = event.detail || {};
    if (!provider || state === 'idle') return;
    providerHealthScores.set(provider, Math.max(1, Math.min(5, Number(score) || 1)));
    const modalOpen = !document.getElementById('settingsModal')?.classList.contains('hidden');
    if (modalOpen && currentSettingsTab === 'sources') renderProviderCards();
  });

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
    avatarInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        showToast('Please select an image file', 'error');
        return;
      }
      // Convert to base64 (in production, upload to Supabase Storage)
      const reader = new FileReader();
      reader.onload = (evt) => {
        const base64 = evt.target.result;
        saveLocalProfile({ ...getLocalProfile(), avatar_url: base64 });
        initProfileAvatar();
        showToast('Avatar updated', 'success');
        window.dispatchEvent(new CustomEvent('profileUpdated'));
      };
      reader.readAsDataURL(file);
    });
  }

  // Color presets
  const presetsEl = document.getElementById('profileAvatarPresets');
  if (presetsEl) {
    presetsEl.innerHTML = PRESET_COLORS.map(color =>
      `<div class="avatar-preset" data-color="${color}" style="background:${color};cursor:pointer;width:2rem;height:2rem;border-radius:50%;border:2px solid transparent;transition:border-color 0.15s;" title="${color}"></div>`
    ).join('');
    presetsEl.querySelectorAll('.avatar-preset').forEach(p => {
      p.addEventListener('click', () => {
        const color = p.dataset.color;
        saveLocalProfile({ ...getLocalProfile(), avatar_color: color });
        initProfileAvatar();
        showToast('Color updated', 'success');
      });
    });
  }

  // Account actions
  const passwordBtn = document.getElementById('accountUpdatePasswordBtn');
  const emailBtn = document.getElementById('accountUpdateEmailBtn');
  const deleteBtn = document.getElementById('accountDeleteBtn');

  if (passwordBtn) {
    passwordBtn.addEventListener('click', async () => {
      const input = document.getElementById('accountNewPassword');
      const pass = input?.value;
      if (!pass || pass.length < 6) { showToast('Password must be at least 6 characters', 'error'); return; }
      const { error } = await updatePassword(pass);
      if (!error) { showToast('Password updated', 'success'); input.value = ''; }
      else showToast(error?.message || 'Failed to update password', 'error');
    });
  }
  if (emailBtn) {
    emailBtn.addEventListener('click', async () => {
      const input = document.getElementById('accountNewEmail');
      const email = input?.value?.trim();
      if (!email) { showToast('Enter a valid email', 'error'); return; }
      const { error } = await updateEmail(email);
      if (!error) { showToast('Email updated', 'success'); input.value = ''; }
      else showToast(error?.message || 'Failed to update email', 'error');
    });
  }
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      const confirmed = confirm('Delete your account? This cannot be undone.');
      if (!confirmed) return;
      const { error } = await deleteAccount();
      if (!error) location.reload();
      else showToast('Failed to delete account', 'error');
    });
  }
}

function switchSettingsTab(tab) {
  currentSettingsTab = tab;
  document.querySelectorAll('.settings-tab-btn').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.settings-tab-panel').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== tab));

  if (tab === 'stats') {
    renderStatsTab();
  }
  if (tab === 'blocker') {
    initBlockerUI();
  }
  if (tab === 'themes') {
    renderThemeOptions();
  }
}

function renderThemeOptions() {
  const activeTheme = getSettings().theme || 'noir';
  document.querySelectorAll('[data-theme-option]').forEach(option => {
    const selected = option.dataset.themeOption === activeTheme;
    option.classList.toggle('active', selected);
    option.setAttribute('aria-checked', String(selected));
  });
}

export function openSettingsModal() {
  const modal = document.getElementById('settingsModal');
  const profile = getLocalProfile(getCurrentUser());

  // Hydrate avatar + username
  const profileAvatar = document.getElementById('profileAvatar');
  const profileUsername = document.getElementById('profileUsername');
  if (profileAvatar) {
    if (profile?.avatar_url) {
      profileAvatar.innerHTML = `<img src="${profile.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;background:var(--bg-tertiary);border:2px solid var(--border-color);">`;
    } else {
      profileAvatar.innerHTML = '';
      profileAvatar.textContent = (profile?.username || getCurrentUser() || 'D').charAt(0).toUpperCase();
      profileAvatar.style.background = profile?.avatar_color || 'var(--text-primary)';
      profileAvatar.style.color = 'var(--bg-primary)';
    }
  }
  if (profileUsername) profileUsername.value = profile?.username || '';

  // Hydrate account email
  const currentEmailEl = document.getElementById('accountCurrentEmail');
  if (currentEmailEl) currentEmailEl.textContent = getUserEmail() || 'Not signed in';

  settings = getSettings();
  const deviceSelect = document.getElementById('settingsDevice');
  const autoPlay = document.getElementById('settingsAutoPlay');
  const autoFailover = document.getElementById('settingsAutoFailover');
  const roundedUI = document.getElementById('settingsRoundedUI');

  if (deviceSelect) deviceSelect.value = settings.device;
  if (autoPlay) autoPlay.checked = settings.autoPlay !== false;
  if (autoFailover) autoFailover.checked = settings.autoProviderFailover === true;
  if (roundedUI) roundedUI.checked = settings.roundedUI === true;
  renderThemeOptions();

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
    const healthScore = providerHealthScores.get(key);
    if (rankLabel) badges.push(`<span class="provider-badge badge-rank">${rankLabel}</span>`);
    if (p.movie && p.tv) badges.push('<span class="provider-badge"><i class="fas fa-film"></i> Movies + TV</span>');
    else if (p.movie) badges.push('<span class="provider-badge"><i class="fas fa-film"></i> Movies</span>');
    else if (p.tv) badges.push('<span class="provider-badge"><i class="fas fa-tv"></i> TV</span>');
    if (p.quality === '4K') badges.push('<span class="provider-badge badge-4k">4K</span>');
    else if (p.quality) badges.push(`<span class="provider-badge">${p.quality}</span>`);
    if (p.subtitles) badges.push('<span class="provider-badge"><i class="fas fa-closed-captioning"></i> Subs</span>');
    if (p.speed) badges.push(`<span class="provider-badge"><i class="fas fa-bolt"></i> ${p.speed}</span>`);

    return `
      <div class="provider-card ${isActive ? 'active' : ''} ${isBest ? 'provider-best' : ''}" data-provider="${key}">
        <div class="provider-card-header">
          <div class="provider-card-name">${p.name}</div>
          <div class="provider-card-status">
            <span class="provider-health-mini ${healthScore ? `score-${healthScore}` : 'is-unmeasured'}" aria-label="${healthScore ? `${healthScore} out of 5 connection strength` : 'Connection strength is measured during playback'}">
              <span class="provider-signal" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></span>
              <small>${healthScore ? `${healthScore}/5` : 'Live in player'}</small>
            </span>
            <span class="provider-card-check">${isActive ? '<i class="fas fa-check-circle"></i>' : '<i class="far fa-circle"></i>'}</span>
          </div>
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
      
      renderProviderCards();
      showToast(`Switched to ${PROVIDERS[key].name}`, 'success');
    });
  });
}

async function saveSettingsFromForm() {
  if (currentSettingsTab === 'account') {
    await saveProfile();
    return;
  }

  if (currentSettingsTab === 'themes' || currentSettingsTab === 'sources' || currentSettingsTab === 'blocker' || currentSettingsTab === 'stats') {
    // These tabs auto-save on interaction; just close the modal
    document.getElementById('settingsModal')?.classList.add('hidden');
    return;
  }

  const device = document.getElementById('settingsDevice')?.value || 'laptop';
  const autoPlay = document.getElementById('settingsAutoPlay')?.checked ?? true;

  settings.device = device;
  settings.autoPlay = autoPlay;

  saveSettings(settings);
  
  applyDeviceClass();

  document.getElementById('settingsModal')?.classList.add('hidden');
}

async function saveProfile() {
  const input = document.getElementById('profileUsername');
  const name = input?.value?.trim();
  if (!name) { showToast('Name cannot be empty', 'error'); return; }
  const profile = getLocalProfile(getCurrentUser());
  saveLocalProfile({ ...profile, username: name });
  showToast('Profile updated', 'success');
  window.dispatchEvent(new CustomEvent('profileUpdated'));
}

function initProfileAvatar() {
  const profileAvatar = document.getElementById('profileAvatar');
  const profile = getLocalProfile(getCurrentUser());
  if (profileAvatar) {
    if (profile?.avatar_url) {
      profileAvatar.innerHTML = `<img src="${profile.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;background:var(--bg-tertiary);border:2px solid var(--border-color);">`;
    } else {
      profileAvatar.innerHTML = '';
      profileAvatar.textContent = (profile?.username || getCurrentUser() || 'D').charAt(0).toUpperCase();
      profileAvatar.style.background = profile?.avatar_color || 'var(--text-primary)';
      profileAvatar.style.color = 'var(--bg-primary)';
    }
  }
}

/* ───── Stats Tab ───── */

async function renderStatsTab() {
  const sessions = await getWatchSessions(90);
  const stats = aggregateStats(sessions);

  const totalHours = document.getElementById('statsTotalHours');
  const moviesCount = document.getElementById('statsMoviesCount');
  const episodesCount = document.getElementById('statsEpisodesCount');
  const streakEl = document.getElementById('statsStreak');

  if (totalHours) totalHours.textContent = Math.round(stats.totalSeconds / 3600);
  if (moviesCount) moviesCount.textContent = stats.movies;
  if (episodesCount) episodesCount.textContent = stats.episodes;
  if (streakEl) streakEl.innerHTML = `${stats.streak} <span style="font-size:0.75rem;font-weight:500;">days</span>`;

  renderHeatmap(stats.daily);
  renderDayBars(stats.dayOfWeek);
}

function renderHeatmap(daily) {
  const container = document.getElementById('statsHeatmap');
  if (!container) return;
  const cells = [];
  const days = 90;
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
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
