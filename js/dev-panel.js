/** Owner-only Dev workspace and signed-in installation authorization. */

import { clearRevokedSession } from './auth.js';
import {
  banDevUser,
  fetchDevSummary,
  fetchDevUserDetail,
  fetchDevUsers,
  forceSignOutDevUser,
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

function currentDeviceKind() {
  if (document.body.classList.contains('device-tv')) return 'tv';
  if (document.body.classList.contains('device-phone')) return 'phone';
  return 'laptop';
}

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

  if (kind === 'suspended' || kind === 'banned') {
    title.textContent = kind === 'banned' ? 'Account banned' : 'Account suspended';
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
    if (access.state === 'suspended' || access.state === 'banned') {
      configureOwnerAccess(false);
      await clearRevokedSession();
      showAccessGate(access.state, access.reason);
      return false;
    }
    configureOwnerAccess(access.isOwner);
    await heartbeatInstallation(getInstallationIdentity(window.ENV || {}, currentDeviceKind()));
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
  if (user.access_state === 'banned') return { label: 'Banned', className: 'banned' };
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
    appendText(clientCell.querySelector('.dev-client'), 'small', '', [user.latest_platform, user.latest_architecture, user.latest_device_kind].filter(Boolean).join(' · ') || 'No installation');
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

function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  if (total < 60) return `${Math.round(total)} sec`;
  const hours = Math.floor(total / 3600);
  const minutes = Math.round((total % 3600) / 60);
  return hours ? `${hours} hr ${minutes} min` : `${minutes} min`;
}

function viewingLabel(item) {
  const episode = item.mediaType === 'tv' && item.season != null
    ? ` · S${item.season} E${item.episode || 1}`
    : '';
  return `${item.title || 'Untitled'}${episode}`;
}

function auditLabel(action) {
  return ({
    force_sign_out: 'Forced sign-out',
    suspend: 'Access suspended',
    ban: 'Account banned',
    restore: 'Access restored'
  })[action] || 'Access changed';
}

function appendStatGrid(parent, stats) {
  const grid = document.createElement('div');
  grid.className = 'dev-stat-grid';
  [
    ['App time', formatDuration(stats.appActiveSeconds)],
    ['App sessions', stats.appSessions || 0],
    ['Watch time', formatDuration(stats.watchSeconds)],
    ['Watch sessions', stats.watchSessions || 0],
    ['Titles watched', stats.watchedTitles || 0],
    ['Active days', stats.watchDays || 0]
  ].forEach(([label, value]) => {
    const item = document.createElement('div');
    appendText(item, 'span', '', label);
    appendText(item, 'strong', '', value);
    grid.appendChild(item);
  });
  parent.appendChild(grid);
}

function appendConfirmedAction(parent, { label, confirmLabel, warning, className = '', run, success }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `btn btn-secondary ${className}`.trim();
  button.textContent = label;
  parent.appendChild(button);

  const confirmation = document.createElement('div');
  confirmation.className = 'dev-action-confirm hidden';
  appendText(confirmation, 'p', 'dev-user-email', warning);
  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = `btn btn-secondary ${className}`.trim();
  confirm.textContent = confirmLabel;
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn-secondary';
  cancel.textContent = 'Cancel';
  confirmation.append(confirm, cancel);
  parent.appendChild(confirmation);

  button.addEventListener('click', () => {
    button.classList.add('hidden');
    confirmation.classList.remove('hidden');
    confirm.focus();
  });
  cancel.addEventListener('click', () => {
    confirmation.classList.add('hidden');
    button.classList.remove('hidden');
    button.focus();
  });
  confirm.addEventListener('click', async () => {
    confirm.disabled = true;
    try {
      await run();
      showToast(success, 'success');
      await refreshDevData(selectedUserId);
    } catch (error) {
      console.error(`[Dev] ${label} failed:`, error);
      showToast(error?.message || `${label} failed`, 'error');
      confirm.disabled = false;
    }
  });
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

  const activity = document.createElement('section');
  activity.className = 'dev-detail-section';
  appendText(activity, 'h3', '', 'Activity overview');
  appendStatGrid(activity, detail.stats || {});
  container.appendChild(activity);

  const viewing = document.createElement('section');
  viewing.className = 'dev-detail-section';
  appendText(viewing, 'h3', '', 'Recent viewing');
  const viewingItems = (detail.recentViewing || []).map(item => ({
    primary: viewingLabel(item),
    secondary: `${formatDate(item.watchedAt)}${item.durationSeconds ? ` · ${formatDuration(item.durationSeconds)}` : ''}`
  }));
  viewing.appendChild(makeDetailList(viewingItems.length ? viewingItems : [{ primary: 'No viewing history recorded' }]));
  container.appendChild(viewing);

  const sessions = document.createElement('section');
  sessions.className = 'dev-detail-section';
  appendText(sessions, 'h3', '', 'Recent watch sessions');
  const sessionItems = (detail.recentSessions || []).map(item => ({
    primary: viewingLabel(item),
    secondary: `${formatDate(item.startedAt)} · ${formatDuration(item.durationSeconds)}`
  }));
  sessions.appendChild(makeDetailList(sessionItems.length ? sessionItems : [{ primary: 'No watch sessions recorded' }]));
  container.appendChild(sessions);

  const installations = document.createElement('section');
  installations.className = 'dev-detail-section';
  appendText(installations, 'h3', '', 'Installations');
  const installationItems = (detail.installations || []).map(install => ({
    primary: `OpenCloud ${install.appVersion || 'Unknown'} · ${install.deviceKind || 'Unknown device'}`,
    secondary: `${install.platform || 'Unknown'} · ${install.architecture || 'Unknown'} · ${install.isOnline ? 'Online since' : 'Last seen'} ${formatDate(install.lastSeenAt)}`
  }));
  installations.appendChild(makeDetailList(installationItems.length ? installationItems : [{ primary: 'No signed-in installations yet' }]));
  container.appendChild(installations);

  const audit = document.createElement('section');
  audit.className = 'dev-detail-section';
  appendText(audit, 'h3', '', 'Access history');
  const auditItems = (detail.audit || []).map(entry => ({
    primary: auditLabel(entry.action),
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
    appendText(access, 'p', 'dev-user-email', 'This is the sole owner account. Remote sign-out, suspension, and banning are blocked by the server.');
  } else if (user.access_state === 'suspended' || user.access_state === 'banned') {
    appendText(access, 'p', 'dev-user-email', `${user.access_state === 'banned' ? 'Ban' : 'Suspension'} reason: ${user.access_reason || 'No reason provided.'}`);
    appendConfirmedAction(actionArea, {
      label: 'Restore access', confirmLabel: 'Confirm restoration',
      warning: 'Allow this account to sign in and use cloud data again?',
      run: () => restoreDevUser(user.id), success: 'Access restored'
    });
  } else {
    const reason = document.createElement('textarea');
    reason.className = 'dev-reason-input';
    reason.maxLength = 500;
    reason.placeholder = 'Reason for suspension or ban (optional)';
    reason.setAttribute('aria-label', 'Reason for suspension or ban');
    actionArea.appendChild(reason);
    appendConfirmedAction(actionArea, {
      label: 'Force sign out', confirmLabel: 'Sign out now',
      warning: 'End all current sessions. The account can sign in again immediately.',
      run: () => forceSignOutDevUser(user.id), success: 'User signed out'
    });
    appendConfirmedAction(actionArea, {
      label: 'Suspend access', confirmLabel: 'Confirm suspension', className: 'warning',
      warning: 'Block access and end all sessions. User data is preserved until you restore access.',
      run: () => suspendDevUser(user.id, reason.value.trim()), success: 'Account suspended'
    });
    appendConfirmedAction(actionArea, {
      label: 'Ban account', confirmLabel: 'Confirm ban', className: 'danger',
      warning: 'Ban this account and end all sessions. User data is preserved until you restore access.',
      run: () => banDevUser(user.id, reason.value.trim()), success: 'Account banned'
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
    setText('devBanned', summary?.banned || 0);
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
