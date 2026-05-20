/** Settings Modal */
import { getSettings, saveSettings, DEVICES, PROVIDERS, applyDeviceClass, getActiveProvider } from './config.js';
import { showToast } from './utils.js';
import { initBlockerUI } from './blocker.js';

let settings = getSettings();
let currentSettingsTab = 'general';

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
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      saveSettingsFromForm();
    });
  }

  // Tab switching
  document.querySelectorAll('.settings-tab-btn').forEach(tabBtn => {
    tabBtn.addEventListener('click', () => {
      const tab = tabBtn.dataset.tab;
      switchSettingsTab(tab);
    });
  });

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
}

export function openSettingsModal() {
  settings = getSettings();
  const modal = document.getElementById('settingsModal');
  const deviceSelect = document.getElementById('settingsDevice');
  const autoPlay = document.getElementById('settingsAutoPlay');

  if (deviceSelect) deviceSelect.value = settings.device;
  if (autoPlay) autoPlay.checked = settings.autoPlay !== false;

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
    const badges = [];
    if (isBest) badges.push('<span class="provider-badge badge-best"><i class="fas fa-star"></i> Best</span>');
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
          <div class="provider-card-name">${p.name}${isBest ? ' <i class="fas fa-star" style="color:var(--text-primary);font-size:0.75rem;margin-left:0.25rem;"></i>' : ''}</div>
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
      renderProviderCards();
      showToast(`Switched to ${PROVIDERS[key].name}`, 'success');
    });
  });
}

function saveSettingsFromForm() {
  const device = document.getElementById('settingsDevice')?.value || 'laptop';
  const autoPlay = document.getElementById('settingsAutoPlay')?.checked ?? true;

  settings.device = device;
  settings.autoPlay = autoPlay;

  saveSettings(settings);
  applyDeviceClass();
  document.getElementById('settingsModal')?.classList.add('hidden');
  showToast('Settings saved', 'success');
}
