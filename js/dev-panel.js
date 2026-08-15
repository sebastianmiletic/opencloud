/** Owner-only Dev workspace and signed-in installation authorization. */

import { clearRevokedSession } from './auth.js';
import {
  fetchDevSummary,
  fetchDevUserDetail,
  fetchDevUsers,
  getMyAccess,
  heartbeatInstallation,
  restoreDevUser,
  suspendDevUser
} from './sync.js';
import { showToast } from './utils.js';
import { getInstallationIdentity, isRecentlyOnline } from './dev-panel-policy.js';

const PAGE_SIZE = 50;
const HEARTBEAT_INTERVAL_MS = 60000;
const RETRY_DELAY_MS = 10000;

let accessTimer = null;
let devInitialized = false;
let isOwner = false;
let currentUsers = [];
let selectedUserId = null;
let pageOffset = 0;
let totalUsers = 0;
let searchTimer = null;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function showAccessGate(kind, reason = '') {
  const gate = document.getElementById('accessGate');
  const title = document.getElementById('accessGateTitle');
  const message = document.getElementById('accessGateMessage');
  const retry = document.getElementById('accessRetryBtn');
  if (!gate || !title || !message || !retry) return;
  if (!retry.dataset.bound) {
    retry.dataset.bound = 'true';
    retry.addEventListener('click', () => location.reload());
  }

  if (kind === 'suspended') {
    title.textContent = 'Account suspended';
    message.textContent = reason || 'This account no longer has access to OpenCloud. Contact the owner if you believe this is a mistake.';
    retry.textContent = 'Return to sign in';
  } else {
    title.textContent = 'Connection required';
    message.textContent = 'OpenCloud needs an online account check to continue. Check your connection and try again.';
    retry.textContent = 'Try again';
  }
  gate.classList.remove('hidden');
  retry.focus();
}

export function showConnectionRequired() {
  showAccessGate('connection');
}

function hideAccessGate() {
  document.getElementById('accessGate')?.classList.add('hidden');
}

async function checkAccessWithRetries(attempts = 3) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const access = await getMyAccess();
      if (!access || access.state === 'signed_out') throw new Error('Signed-in authorization is unavailable');
      return access;
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await sleep(RETRY_DELAY_MS);
    }
  }
  throw lastError || new Error('Authorization failed');
}

function configureOwnerAccess(allowed) {
  isOwner = allowed === true;
  const button = document.getElementById('devPanelBtn');
  button?.classList.toggle('hidden', !isOwner);
  if (!isOwner && !document.getElementById('devView')?.classList.contains('hidden')) {
    closeDevPanel();
  }
}

async function runAuthorizationCycle() {
  try {
    const access = await checkAccessWithRetries();
    if (access.state === 'suspended') {
      configureOwnerAccess(false);
      await clearRevokedSession();
      showAccessGate('suspended', access.reason);
      return false;
    }
    configureOwnerAccess(access.isOwner);
    await heartbeatInstallation(getInstallationIdentity(window.ENV || {}));
    hideAccessGate();
    return true;
  } catch (error) {
    console.error('[Access] Authorization check failed:', error);
    configureOwnerAccess(false);
    showAccessGate('connection');
    return false;
  }
}

export async function initializeSignedInRuntime() {
  const allowed = await runAuthorizationCycle();
  clearInterval(accessTimer);
  accessTimer = setInterval(() => {
    runAuthorizationCycle().catch(error => console.error('[Access] Periodic check failed:', error));
  }, HEARTBEAT_INTERVAL_MS);
  return allowed;
}

export function stopSignedInRuntime() {
  clearInterval(accessTimer);
  accessTimer = null;
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = String(value ?? '');
}

function formatDate(value, includeTime = true) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Unknown';
  return includeTime
    ? date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
    : date.toLocaleDateString([], { dateStyle: 'medium' });
}

function statusFor(user) {
  if (user.access_state === 'suspended') return { label: 'Suspended', className: 'suspended' };
  if (user.is_online || isRecentlyOnline(user.last_seen_at)) return { label: 'Online', className: 'online' };
  return { label: 'Offline', className: 'offline' };
}

function appendText(parent, tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = value;
  parent.appendChild(element);
  return element;
}

function renderLoading() {
  const list = document.getElementById('devUserList');
  if (!list) return;
  list.replaceChildren();
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = 6;
  cell.className = 'dev-table-state';
  cell.textContent = 'Loading accounts...';
  row.appendChild(cell);
  list.appendChild(row);
}

function renderUsers() {
  const list = document.getElementById('devUserList');
  if (!list) return;
  list.replaceChildren();

  if (!currentUsers.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 6;
    cell.className = 'dev-table-state';
    cell.textContent = 'No accounts match this view.';
    row.appendChild(cell);
    list.appendChild(row);
  }

  currentUsers.forEach(user => {
    const row = document.createElement('tr');
    row.dataset.userId = user.id;
    row.tabIndex = 0;
    row.classList.toggle('selected', user.id === selectedUserId);
    row.setAttribute('aria-label', `Open ${user.username || 'user'} details`);

    const identityCell = document.createElement('td');
    const identity = document.createElement('div');
    identity.className = 'dev-user-cell';
    const avatar = appendText(identity, 'span', 'dev-user-avatar', (user.username || user.email || 'U').charAt(0).toUpperCase());
    avatar.setAttribute('aria-hidden', 'true');
    const identityText = document.createElement('span');
    appendText(identityText, 'span', 'dev-user-name', user.username || 'User');
    appendText(identityText, 'span', 'dev-user-email', user.email || 'No email');
    identity.appendChild(identityText);
    identityCell.appendChild(identity);
    row.appendChild(identityCell);

    const userStatus = statusFor(user);
    const statusCell = document.createElement('td');
    appendText(statusCell, 'span', `dev-status ${userStatus.className}`, userStatus.label);
    row.appendChild(statusCell);

    appendText(row, 'td', '', formatDate(user.last_seen_at));
    appendText(row, 'td', '', String(user.installation_count || 0));

    const clientCell = document.createElement('td');
    appendText(clientCell, 'span', 'dev-client', user.latest_version || 'No client');
    appendText(clientCell.querySelector('.dev-client'), 'small', '', [user.latest_platform, user.latest_architecture].filter(Boolean).join(' · ') || 'No installation');
    row.appendChild(clientCell);

    const actionCell = document.createElement('td');
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'dev-row-action';
    action.setAttribute('aria-label', `Open ${user.username || 'user'} details`);
    const icon = document.createElement('i');
    icon.className = 'fas fa-chevron-right';
    icon.setAttribute('aria-hidden', 'true');
    action.appendChild(icon);
    actionCell.appendChild(action);
    row.appendChild(actionCell);

    const select = () => selectUser(user.id);
    row.addEventListener('click', select);
    row.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        select();
      }
    });
    list.appendChild(row);
  });

  const start = totalUsers ? pageOffset + 1 : 0;
  const end = Math.min(pageOffset + currentUsers.length, totalUsers);
  setText('devPaginationText', `${start}–${end} of ${totalUsers} accounts`);
  const previous = document.getElementById('devPreviousBtn');
  const next = document.getElementById('devNextBtn');
  if (previous) previous.disabled = pageOffset === 0;
  if (next) next.disabled = pageOffset + PAGE_SIZE >= totalUsers;
}

function makeDetailList(items) {
  const list = document.createElement('ul');
  list.className = 'dev-detail-list';
  items.forEach(item => {
    const row = document.createElement('li');
    appendText(row, 'span', '', item.primary);
    if (item.secondary) appendText(row, 'small', '', item.secondary);
    list.appendChild(row);
  });
  return list;
}

function renderDetail(user, detail) {
  const container = document.getElementById('devDetail');
  if (!container || user.id !== selectedUserId) return;
  container.replaceChildren();

  const header = document.createElement('header');
  header.className = 'dev-detail-header';
  appendText(header, 'h2', '', user.username || 'User');
  appendText(header, 'p', '', user.email || 'No email');
  appendText(header, 'p', '', `Joined ${formatDate(user.joined_at, false)}`);
  container.appendChild(header);

  const installations = document.createElement('section');
  installations.className = 'dev-detail-section';
  appendText(installations, 'h3', '', 'Installations');
  const installationItems = (detail.installations || []).map(install => ({
    primary: `${install.appVersion || 'Unknown'} · ${install.platform || 'Unknown'} · ${install.architecture || 'Unknown'}`,
    secondary: `${install.isOnline ? 'Online' : 'Last seen'} ${formatDate(install.lastSeenAt)}`
  }));
  installations.appendChild(makeDetailList(installationItems.length ? installationItems : [{ primary: 'No signed-in installations yet' }]));
  container.appendChild(installations);

  const audit = document.createElement('section');
  audit.className = 'dev-detail-section';
  appendText(audit, 'h3', '', 'Access history');
  const auditItems = (detail.audit || []).map(entry => ({
    primary: entry.action === 'suspend' ? 'Access suspended' : 'Access restored',
    secondary: `${formatDate(entry.createdAt)}${entry.reason ? ` · ${entry.reason}` : ''}`
  }));
  audit.appendChild(makeDetailList(auditItems.length ? auditItems : [{ primary: 'No access changes' }]));
  container.appendChild(audit);

  const access = document.createElement('section');
  access.className = 'dev-detail-section';
  appendText(access, 'h3', '', 'Access control');
  const actionArea = document.createElement('div');
  actionArea.className = 'dev-access-actions';

  if (user.is_owner) {
    appendText(access, 'p', 'dev-user-email', 'This is the sole owner account and cannot be suspended from OpenCloud.');
  } else if (user.access_state === 'suspended') {
    appendText(access, 'p', 'dev-user-email', user.access_reason || 'No suspension reason provided.');
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'btn btn-secondary';
    restore.textContent = 'Restore access';
    actionArea.appendChild(restore);
    const confirmation = document.createElement('div');
    confirmation.className = 'dev-access-actions hidden';
    appendText(confirmation, 'p', 'dev-user-email', 'Restore sign-in and cloud access for this account?');
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn btn-primary';
    confirm.textContent = 'Confirm restoration';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-secondary';
    cancel.textContent = 'Cancel';
    confirmation.append(confirm, cancel);
    actionArea.appendChild(confirmation);
    restore.addEventListener('click', () => { restore.classList.add('hidden'); confirmation.classList.remove('hidden'); confirm.focus(); });
    cancel.addEventListener('click', () => { confirmation.classList.add('hidden'); restore.classList.remove('hidden'); restore.focus(); });
    confirm.addEventListener('click', async () => {
      confirm.disabled = true;
      try {
        await restoreDevUser(user.id);
        showToast('Access restored', 'success');
        await refreshDevData(user.id);
      } catch (error) {
        console.error('[Dev] Restore failed:', error);
        showToast('Failed to restore access', 'error');
        confirm.disabled = false;
      }
    });
  } else {
    const reason = document.createElement('textarea');
    reason.className = 'dev-reason-input';
    reason.maxLength = 500;
    reason.placeholder = 'Suspension reason (optional)';
    reason.setAttribute('aria-label', 'Suspension reason');
    actionArea.appendChild(reason);
    const suspend = document.createElement('button');
    suspend.type = 'button';
    suspend.className = 'btn btn-secondary danger';
    suspend.textContent = 'Suspend and sign out';
    actionArea.appendChild(suspend);
    const confirmation = document.createElement('div');
    confirmation.className = 'dev-access-actions hidden';
    appendText(confirmation, 'p', 'dev-user-email', 'This immediately blocks cloud access and signs the account out. User data is preserved.');
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'btn btn-secondary danger';
    confirm.textContent = 'Confirm suspension';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-secondary';
    cancel.textContent = 'Cancel';
    confirmation.append(confirm, cancel);
    actionArea.appendChild(confirmation);
    suspend.addEventListener('click', () => { suspend.classList.add('hidden'); confirmation.classList.remove('hidden'); confirm.focus(); });
    cancel.addEventListener('click', () => { confirmation.classList.add('hidden'); suspend.classList.remove('hidden'); suspend.focus(); });
    confirm.addEventListener('click', async () => {
      confirm.disabled = true;
      try {
        await suspendDevUser(user.id, reason.value.trim());
        showToast('Account suspended and signed out', 'success');
        await refreshDevData(user.id);
      } catch (error) {
        console.error('[Dev] Suspension failed:', error);
        showToast(error?.message || 'Failed to suspend access', 'error');
        confirm.disabled = false;
      }
    });
  }

  if (!user.is_owner) access.appendChild(actionArea);
  container.appendChild(access);
}

async function selectUser(userId) {
  selectedUserId = userId;
  renderUsers();
  const user = currentUsers.find(candidate => candidate.id === userId);
  const container = document.getElementById('devDetail');
  if (!user || !container) return;
  container.replaceChildren();
  const loading = document.createElement('div');
  loading.className = 'dev-detail-empty';
  appendText(loading, 'p', '', 'Loading account details...');
  container.appendChild(loading);
  try {
    const detail = await fetchDevUserDetail(userId);
    renderDetail(user, detail || {});
  } catch (error) {
    console.error('[Dev] Detail failed:', error);
    container.replaceChildren();
    const failed = document.createElement('div');
    failed.className = 'dev-detail-empty';
    appendText(failed, 'p', '', 'Account details could not be loaded.');
    container.appendChild(failed);
  }
}

async function refreshDevData(reselectId = selectedUserId) {
  if (!isOwner) return;
  renderLoading();
  const query = document.getElementById('devSearch')?.value?.trim() || '';
  const status = document.getElementById('devStatusFilter')?.value || 'all';
  try {
    const [summary, userPage] = await Promise.all([
      fetchDevSummary(),
      fetchDevUsers({ query, status, limit: PAGE_SIZE, offset: pageOffset })
    ]);
    setText('devAccounts', summary?.accounts || 0);
    setText('devInstallations', summary?.installations || 0);
    setText('devOnlineUsers', summary?.onlineUsers || 0);
    setText('devOnlineInstallations', summary?.onlineInstallations || 0);
    setText('devSuspended', summary?.suspended || 0);
    setText('devUpdatedAt', `Updated ${formatDate(summary?.generatedAt || new Date().toISOString())}`);
    currentUsers = Array.isArray(userPage?.users) ? userPage.users : [];
    totalUsers = Number(userPage?.total) || 0;
    if (reselectId && currentUsers.some(user => user.id === reselectId)) selectedUserId = reselectId;
    else selectedUserId = null;
    renderUsers();
    if (selectedUserId) await selectUser(selectedUserId);
  } catch (error) {
    console.error('[Dev] Refresh failed:', error);
    const list = document.getElementById('devUserList');
    if (list) {
      list.replaceChildren();
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 6;
      cell.className = 'dev-table-state';
      cell.textContent = error?.message?.includes('denied') ? 'Dev access denied.' : 'Accounts could not be loaded.';
      row.appendChild(cell);
      list.appendChild(row);
    }
  }
}

function closeDevPanel() {
  document.getElementById('devView')?.classList.add('hidden');
  const home = document.getElementById('homeView');
  home?.classList.remove('hidden');
  document.querySelectorAll('.nav-btn').forEach(button => button.classList.toggle('active', button.dataset.tab === 'home'));
  document.getElementById('mainContent')?.focus();
}

async function openDevPanel() {
  if (!isOwner) {
    showToast('Dev access denied', 'error');
    return;
  }
  document.getElementById('accountDropdown')?.classList.add('hidden');
  document.querySelectorAll('#mainContent > section').forEach(section => section.classList.add('hidden'));
  document.querySelectorAll('.nav-btn').forEach(button => button.classList.remove('active'));
  document.getElementById('devView')?.classList.remove('hidden');
  document.getElementById('devTitle')?.focus?.();
  await refreshDevData();
}

export function initDevPanel() {
  if (devInitialized) return;
  devInitialized = true;
  document.getElementById('devPanelBtn')?.addEventListener('click', event => {
    event.stopPropagation();
    openDevPanel().catch(error => console.error('[Dev] Open failed:', error));
  });
  document.getElementById('devBackBtn')?.addEventListener('click', closeDevPanel);
  document.getElementById('devRefreshBtn')?.addEventListener('click', () => refreshDevData());
  document.getElementById('devStatusFilter')?.addEventListener('change', () => {
    pageOffset = 0;
    refreshDevData();
  });
  document.getElementById('devSearch')?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      pageOffset = 0;
      refreshDevData();
    }, 250);
  });
  document.getElementById('devPreviousBtn')?.addEventListener('click', () => {
    pageOffset = Math.max(0, pageOffset - PAGE_SIZE);
    refreshDevData();
  });
  document.getElementById('devNextBtn')?.addEventListener('click', () => {
    if (pageOffset + PAGE_SIZE < totalUsers) pageOffset += PAGE_SIZE;
    refreshDevData();
  });
}
