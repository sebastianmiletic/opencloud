/** localStorage & Cache Wrappers */
import { setAccounts, setCollection, setUserCollection, setUserHistory, setWatchProgress, setUserFolders } from './state.js';

const DEFAULT_ACCOUNT = 'Default';
const PRIVACY_RESET_KEY = 'openccloud_privacy_reset_v2';

function safeParse(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

function runOneTimePrivacyReset() {
  if (localStorage.getItem(PRIVACY_RESET_KEY)) return;

  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (key.startsWith('openccloud_user_')) keysToRemove.push(key);
  }
  keysToRemove.forEach(key => localStorage.removeItem(key));
  localStorage.removeItem('openccloud_accounts');
  localStorage.removeItem('openccloud_current_user');

  localStorage.setItem('openccloud_accounts', JSON.stringify([DEFAULT_ACCOUNT]));
  localStorage.setItem('openccloud_current_user', DEFAULT_ACCOUNT);
  localStorage.setItem(PRIVACY_RESET_KEY, new Date().toISOString());
}

export function getAccounts() {
  const parsed = safeParse(localStorage.getItem('openccloud_accounts'), []);
  const cleaned = Array.isArray(parsed)
    ? [...new Set(parsed.map(v => String(v || '').trim()).filter(Boolean))]
    : [];
  return cleaned.length > 0 ? cleaned : [DEFAULT_ACCOUNT];
}

export function saveAccounts(data) {
  localStorage.setItem('openccloud_accounts', JSON.stringify(data));
}

export function getCurrentUser() {
  const user = localStorage.getItem('openccloud_current_user') || DEFAULT_ACCOUNT;
  return String(user).trim() || DEFAULT_ACCOUNT;
}

export function setCurrentUser(user) {
  localStorage.setItem('openccloud_current_user', user);
}

export function getUserPrefix() {
  const user = getCurrentUser();
  return user ? `openccloud_user_${user}` : '';
}

export function getCollection() {
  const prefix = getUserPrefix();
  if (!prefix) return [];
  return JSON.parse(localStorage.getItem(`${prefix}_collection`)) || [];
}

export function saveCollection(data) {
  const prefix = getUserPrefix();
  if (!prefix) return;
  localStorage.setItem(`${prefix}_collection`, JSON.stringify(data));
}

export function getUserCollection() {
  const prefix = getUserPrefix();
  if (!prefix) return [];
  return safeParse(localStorage.getItem(`${prefix}_usercollection`), []);
}

export function saveUserCollection(data) {
  const prefix = getUserPrefix();
  if (!prefix) return;
  localStorage.setItem(`${prefix}_usercollection`, JSON.stringify(data));
}

export function getUserCollectionForUser(user) {
  if (!user) return [];
  return safeParse(localStorage.getItem(`openccloud_user_${user}_usercollection`), []);
}

export function saveUserCollectionForUser(user, data) {
  if (!user) return;
  localStorage.setItem(`openccloud_user_${user}_usercollection`, JSON.stringify(data));
}

export function getOMDBCache() {
  return safeParse(localStorage.getItem('openccloud_omdb_cache'), {});
}

export function setOMDBCache(key, value) {
  const cache = getOMDBCache();
  cache[key] = { value, timestamp: Date.now() };
  localStorage.setItem('openccloud_omdb_cache', JSON.stringify(cache));
}

export function getUserHistory() {
  const prefix = getUserPrefix();
  if (!prefix) return [];
  return safeParse(localStorage.getItem(`${prefix}_history`), []);
}

export function saveUserHistory(data) {
  const prefix = getUserPrefix();
  if (!prefix) return;
  localStorage.setItem(`${prefix}_history`, JSON.stringify(data));
}

export function getUserHistoryForUser(user) {
  if (!user) return [];
  return safeParse(localStorage.getItem(`openccloud_user_${user}_history`), []);
}

export function getWatchProgress() {
  const prefix = getUserPrefix();
  if (!prefix) return {};
  return safeParse(localStorage.getItem(`${prefix}_progress`), {});
}

export function saveWatchProgress(data) {
  const prefix = getUserPrefix();
  if (!prefix) return;
  localStorage.setItem(`${prefix}_progress`, JSON.stringify(data));
}

export function getWatchProgressForUser(user) {
  if (!user) return {};
  return safeParse(localStorage.getItem(`openccloud_user_${user}_progress`), {});
}

export function saveWatchProgressForUser(user, data) {
  if (!user) return;
  localStorage.setItem(`openccloud_user_${user}_progress`, JSON.stringify(data));
}

export function getUserFolders() {
  const prefix = getUserPrefix();
  if (!prefix) return [];
  const parsed = safeParse(localStorage.getItem(`${prefix}_folders`), []);
  return Array.isArray(parsed) ? parsed : [];
}

export function saveUserFolders(data) {
  const prefix = getUserPrefix();
  if (!prefix) return;
  localStorage.setItem(`${prefix}_folders`, JSON.stringify(data));
}

export function getUserFoldersForUser(user) {
  if (!user) return [];
  const parsed = safeParse(localStorage.getItem(`openccloud_user_${user}_folders`), []);
  return Array.isArray(parsed) ? parsed : [];
}

export function saveUserFoldersForUser(user, data) {
  if (!user) return;
  localStorage.setItem(`openccloud_user_${user}_folders`, JSON.stringify(data));
}

export function initStorage() {
  runOneTimePrivacyReset();
  const accountList = getAccounts();
  setAccounts(accountList);
  if (!accountList.includes(getCurrentUser())) {
    setCurrentUser(accountList[0] || DEFAULT_ACCOUNT);
  }
  setCollection(getCollection());
  setUserCollection(getUserCollection());
  setUserHistory(getUserHistory());
  setWatchProgress(getWatchProgress());
  setUserFolders(getUserFolders());
}
