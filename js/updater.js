import { invokeDesktop, isTauri, listenNativeEvent } from './desktop.js';
import { showToast } from './utils.js';

let availableUpdate = null;
let downloadedBytes = 0;
let initialized = false;
let automaticCheckScheduled = false;
let installing = false;

function elements() {
  return {
    modal: document.getElementById('updateModal'),
    close: document.getElementById('updateModalClose'),
    title: document.getElementById('updateModalTitle'),
    subtitle: document.getElementById('updateModalSubtitle'),
    message: document.getElementById('updateModalMsg'),
    install: document.getElementById('updateModalInstallBtn'),
    upToDate: document.getElementById('updateModalUpToDate')
  };
}

function setCheckingUI() {
  const ui = elements();
  ui.modal?.classList.remove('hidden');
  if (ui.title) ui.title.textContent = 'Checking for Updates';
  if (ui.subtitle) ui.subtitle.textContent = 'Contacting the signed release channel';
  if (ui.message) ui.message.textContent = 'Checking…';
  if (ui.install) ui.install.style.display = 'none';
  if (ui.upToDate) ui.upToDate.style.display = 'none';
}

function showAvailableUpdate(update) {
  const ui = elements();
  ui.modal?.classList.remove('hidden');
  if (ui.title) ui.title.textContent = `Open Cloud ${update.version}`;
  if (ui.subtitle) ui.subtitle.textContent = `Current version: ${update.currentVersion}`;
  if (ui.message) ui.message.textContent = update.body || 'A signed update is ready to install.';
  if (ui.install) {
    ui.install.style.display = 'block';
    ui.install.disabled = false;
    ui.install.innerHTML = '<i class="fas fa-rotate-right" style="margin-right:0.4rem;"></i>Install and Restart';
  }
  if (ui.upToDate) ui.upToDate.style.display = 'none';
}

async function checkForUpdate({ interactive = false } = {}) {
  const ui = elements();
  if (interactive) setCheckingUI();
  try {
    availableUpdate = await invokeDesktop('check_for_updates');
    if (!availableUpdate) {
      if (!interactive) return null;
      if (ui.title) ui.title.textContent = 'Open Cloud is Up to Date';
      if (ui.subtitle) ui.subtitle.textContent = 'No newer signed release is available';
      if (ui.message) ui.message.textContent = 'You already have the latest version installed.';
      if (ui.upToDate) ui.upToDate.style.display = 'block';
      return null;
    }
    showAvailableUpdate(availableUpdate);
    return availableUpdate;
  } catch (error) {
    if (interactive) {
      if (ui.title) ui.title.textContent = 'Update Check Failed';
      if (ui.subtitle) ui.subtitle.textContent = 'The release channel could not be verified';
      if (ui.message) ui.message.textContent = String(error);
      showToast('Unable to check for updates', 'error');
    } else {
      console.warn('[Updater] Automatic update check failed:', error);
    }
    return null;
  }
}

async function installUpdate() {
  if (!availableUpdate || installing) return;
  installing = true;
  const ui = elements();
  downloadedBytes = 0;
  if (ui.install) {
    ui.install.disabled = true;
    ui.install.textContent = 'Downloading signed update…';
  }
  try {
    await invokeDesktop('install_update');
    if (ui.message) ui.message.textContent = 'Update installed. Restarting Open Cloud…';
    await invokeDesktop('restart_app');
  } catch (error) {
    installing = false;
    if (ui.message) ui.message.textContent = String(error);
    if (ui.install) {
      ui.install.disabled = false;
      ui.install.textContent = 'Try Again';
    }
    showToast('Update installation failed', 'error');
  }
}

function scheduleAutomaticCheck() {
  if (automaticCheckScheduled || !isTauri()) return;
  automaticCheckScheduled = true;
  const run = () => setTimeout(() => checkForUpdate({ interactive: false }), 4500);
  if (navigator.onLine) run();
  else window.addEventListener('online', run, { once: true });
}

export function initUpdater(button, accountDropdown) {
  const ui = elements();
  if (!initialized) {
    initialized = true;
    ui.close?.addEventListener('click', () => { if (!installing) ui.modal?.classList.add('hidden'); });
    ui.modal?.querySelector('.modal-overlay')?.addEventListener('click', () => { if (!installing) ui.modal?.classList.add('hidden'); });
    ui.install?.addEventListener('click', installUpdate);

    listenNativeEvent('opencloud:update-progress', (progress) => {
      downloadedBytes += Number(progress?.chunkLength) || 0;
      if (!ui.message) return;
      const total = Number(progress?.contentLength) || 0;
      if (total > 0) {
        const percent = Math.min(100, Math.round((downloadedBytes / total) * 100));
        ui.message.textContent = `Downloading and verifying update… ${percent}%`;
      } else {
        ui.message.textContent = `Downloading and verifying update… ${Math.round(downloadedBytes / 1024 / 1024)} MB`;
      }
    }).catch(console.error);
  }

  if (button && button.dataset.updaterWired !== 'true') {
    button.dataset.updaterWired = 'true';
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      accountDropdown?.classList.add('hidden');
      if (!isTauri()) {
        showToast('Redownload the ZIP from GitHub for updates', 'info');
        return;
      }
      checkForUpdate({ interactive: true });
    });
  }
  scheduleAutomaticCheck();
}
