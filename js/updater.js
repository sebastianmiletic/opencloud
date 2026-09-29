import { invokeDesktop, isTauri, listenNativeEvent, openExternal } from './desktop.js';
import { showToast } from './utils.js';

let availableUpdate = null;
let downloadedBytes = 0;
let initialized = false;
let launchCheckStarted = false;
let installing = false;
let checking = false;
let loadingVersions = false;
let selectedVersion = null;

function setVersionControlsDisabled(disabled) {
  document.querySelectorAll('#updatePastVersions button, #updatePastVersionsBtn').forEach(button => {
    button.disabled = disabled;
  });
}

async function showPastVersions() {
  if (installing || checking || loadingVersions) return;
  const panel = document.getElementById('updatePastVersions');
  const status = document.getElementById('updatePastVersionsStatus');
  const list = document.getElementById('updatePastVersionsList');
  panel.hidden = !panel.hidden;
  document.getElementById('updatePastVersionsBtn').setAttribute('aria-expanded', String(!panel.hidden));
  if (panel.hidden) return;
  list.replaceChildren();
  document.getElementById('updateDowngradeConfirm').hidden = true;
  selectedVersion = null;
  status.textContent = 'Loading release history…';
  loadingVersions = true;
  try {
    let page = 1;
    let more = true;
    const seen = new Set();
    while (more) {
      const result = await invokeDesktop('list_past_versions', { page });
      for (const release of result.items) {
        if (seen.has(release.tag)) continue;
        seen.add(release.tag);
        const row = document.createElement('li');
        row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:0.6rem 0;border-bottom:1px solid var(--border-color)';
        const label = document.createElement('span');
        const current = release.tag === `v${result.currentVersion}`;
        label.textContent = `${release.tag}${current ? ' (installed)' : ''}`;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-secondary';
        const parts = value => value.replace(/^v/, '').split('.').map(Number);
        const target = parts(release.tag);
        const installed = parts(result.currentVersion);
        const difference = target.map((value, index) => value - installed[index]).find(value => value !== 0) || 0;
        const canDowngrade = difference < 0 && release.signed;
        button.textContent = canDowngrade ? 'Downgrade…' : 'Downloads';
        button.setAttribute('aria-label', `${button.textContent} ${release.tag}`);
        button.addEventListener('click', () => {
          if (installing || checking) return;
          if (!canDowngrade) {
            openExternal(`https://github.com/sebastianmiletic/opencloud/releases/tag/${release.tag}`).catch(error => { status.textContent = String(error); });
            return;
          }
          selectedVersion = release.tag;
          document.getElementById('updateDowngradeQuestion').textContent = `Install ${release.tag} and restart? Your data will not be deleted, but compatibility with this older version is not guaranteed.`;
          document.getElementById('updateDowngradeConfirm').hidden = false;
          document.getElementById('updateDowngradeCancel').focus();
        });
        row.append(label, button);
        if (canDowngrade) {
          const downloads = document.createElement('button');
          downloads.type = 'button';
          downloads.className = 'btn btn-secondary';
          downloads.textContent = 'Downloads';
          downloads.setAttribute('aria-label', `Downloads for ${release.tag}`);
          downloads.addEventListener('click', () => {
            if (!installing) openExternal(`https://github.com/sebastianmiletic/opencloud/releases/tag/${release.tag}`)
              .catch(error => { status.textContent = String(error); });
          });
          row.append(downloads);
        }
        list.append(row);
      }
      more = result.hasMore;
      page += 1;
    }
    status.textContent = seen.size ? 'Signed downgrades require a compatible installer for this device.' : 'No releases found.';
  } catch (error) {
    status.textContent = `Could not load all versions: ${String(error)}. Close and reopen this list to retry.`;
  } finally { loadingVersions = false; }
}

async function installSelectedVersion() {
  if (!selectedVersion || installing || checking || loadingVersions) return;
  installing = true;
  downloadedBytes = 0;
  setVersionControlsDisabled(true);
  const ui = elements();
  if (ui.install) ui.install.disabled = true;
  try {
    ui.message.textContent = `Downloading and verifying ${selectedVersion}…`;
    await invokeDesktop('downgrade_version', { tag: selectedVersion });
    await invokeDesktop('restart_app');
  } catch (error) {
    ui.message.textContent = `Downgrade failed: ${String(error)}. You can also use the release's Downloads page.`;
    installing = false;
    setVersionControlsDisabled(false);
    if (ui.install) ui.install.disabled = false;
  }
}

function elements() {
  return {
    modal: document.getElementById('updateModal'),
    close: document.getElementById('updateModalClose'),
    title: document.getElementById('updateModalTitle'),
    subtitle: document.getElementById('updateModalSubtitle'),
    message: document.getElementById('updateModalMsg'),
    install: document.getElementById('updateModalInstallBtn'),
    later: document.getElementById('updateModalLaterBtn'),
    upToDate: document.getElementById('updateModalUpToDate')
  };
}

function setCheckingUI() {
  const ui = elements();
  ui.modal?.classList.remove('hidden');
  document.getElementById('updatePastVersions').hidden = true;
  document.getElementById('updatePastVersionsBtn').setAttribute('aria-expanded', 'false');
  document.getElementById('updateDowngradeConfirm').hidden = true;
  selectedVersion = null;
  if (ui.title) ui.title.textContent = 'Checking for Updates';
  if (ui.subtitle) ui.subtitle.textContent = 'Contacting the signed release channel';
  if (ui.message) ui.message.textContent = 'Checking…';
  if (ui.install) ui.install.style.display = 'none';
  if (ui.later) ui.later.style.display = 'none';
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
  if (ui.later) ui.later.style.display = 'block';
  if (ui.upToDate) ui.upToDate.style.display = 'none';
  requestAnimationFrame(() => ui.install?.focus({ preventScroll: true }));
}

async function checkForUpdate({ interactive = false } = {}) {
  if (installing || checking || loadingVersions) return;
  checking = true;
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
      if (ui.later) ui.later.style.display = 'none';
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
    return undefined;
  } finally { checking = false; }
}

async function installUpdate() {
  if (!availableUpdate || installing || checking || loadingVersions) return;
  installing = true;
  setVersionControlsDisabled(true);
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
    setVersionControlsDisabled(false);
    if (ui.message) ui.message.textContent = String(error);
    if (ui.install) {
      ui.install.disabled = false;
      ui.install.textContent = 'Try Again';
    }
    showToast('Update installation failed', 'error');
  }
}

function startLaunchCheck() {
  if (launchCheckStarted || !isTauri()) return;
  launchCheckStarted = true;

  const check = async (retry = true) => {
    const result = await checkForUpdate({ interactive: false });
    if (result === undefined && retry) setTimeout(() => check(false), 6000);
  };

  // The splash clears at 900 ms. Check immediately after it so an available
  // update becomes the first actionable prompt, even for signed-out users.
  setTimeout(() => check(true), 1050);
  if (!navigator.onLine) window.addEventListener('online', () => check(false), { once: true });
}

export function initUpdater(button, accountDropdown) {
  const ui = elements();
  if (!initialized) {
    initialized = true;
    ui.close?.addEventListener('click', () => { if (!installing) ui.modal?.classList.add('hidden'); });
    ui.modal?.querySelector('.modal-overlay')?.addEventListener('click', () => { if (!installing) ui.modal?.classList.add('hidden'); });
    ui.install?.addEventListener('click', installUpdate);
    ui.later?.addEventListener('click', () => { if (!installing) ui.modal?.classList.add('hidden'); });
    document.getElementById('updatePastVersionsBtn')?.addEventListener('click', showPastVersions);
    document.getElementById('updateDowngradeInstall')?.addEventListener('click', installSelectedVersion);
    document.getElementById('updateDowngradeCancel')?.addEventListener('click', () => {
      if (installing) return;
      selectedVersion = null;
      document.getElementById('updateDowngradeConfirm').hidden = true;
    });

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
  startLaunchCheck();
}
