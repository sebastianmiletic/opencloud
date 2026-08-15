import { mergeDataItems } from './data-merge.js';

const tauriApi = () => window.__TAURI__ || null;

export function isTauri() {
  return !!tauriApi()?.core?.invoke;
}

export function isElectron() {
  return !!window.openCloudElectron;
}

export async function invokeDesktop(command, payload = {}) {
  if (!isTauri()) throw new Error('Tauri desktop bridge is unavailable');
  return tauriApi().core.invoke(command, payload);
}

export async function getPublicConfig() {
  if (!isTauri()) return window.ENV || {};
  return invokeDesktop('get_public_config');
}

export async function importLegacyElectronStorage() {
  if (!isTauri()) return false;
  const migration = await invokeDesktop('load_legacy_migration');
  if (!migration?.storage) return false;
  for (const [key, value] of Object.entries(migration.storage)) {
    if (key === 'oc_is_admin' || key.startsWith('sb-')) continue;
    if (typeof value !== 'string') continue;
    const current = localStorage.getItem(key);
    if (current === null) {
      localStorage.setItem(key, value);
      continue;
    }
    try {
      const legacyValue = JSON.parse(value);
      const currentValue = JSON.parse(current);
      if (key === 'oc_local_collection') {
        localStorage.setItem(key, JSON.stringify(mergeDataItems(currentValue, legacyValue, {
          timestampField: 'added_at', dataType: 'collection'
        })));
      } else if (key === 'oc_local_history') {
        localStorage.setItem(key, JSON.stringify(mergeDataItems(currentValue, legacyValue, {
          timestampField: 'watched_at', dataType: 'history'
        })));
      } else if (key === 'oc_local_progress' && currentValue && legacyValue) {
        localStorage.setItem(key, JSON.stringify({ ...legacyValue, ...currentValue }));
      } else if (key === 'oc_local_folders' && Array.isArray(currentValue) && Array.isArray(legacyValue)) {
        localStorage.setItem(key, JSON.stringify([...new Set([...legacyValue, ...currentValue])]));
      }
    } catch (error) {
      console.warn(`[Desktop] Could not merge legacy storage key ${key}:`, error);
    }
  }
  await invokeDesktop('complete_legacy_migration');
  return true;
}

export async function exportElectronStorage() {
  if (!isElectron()) return false;
  const storage = {};
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key || key === 'oc_is_admin' || key.startsWith('sb-')) continue;
    const value = localStorage.getItem(key);
    if (typeof value === 'string') storage[key] = value;
  }
  await window.openCloudElectron.exportMigration({
    version: 1,
    exportedAt: new Date().toISOString(),
    storage
  });
  return true;
}

export async function getNativeBlockerState() {
  if (!isTauri()) return null;
  return invokeDesktop('get_blocker_state');
}

export async function setNativeBlockerPolicy(settings) {
  if (!isTauri()) return null;
  const policy = {
    enabled: !!settings.enabled,
    blockAllTabs: !!settings.blockAllTabs,
    blockAllWindows: !!settings.blockAllWindows,
    allowSelfPages: !!settings.allowSelfPages,
    allowExtensionPages: !!settings.allowExtensionPages
  };
  broadcastBlockerPolicy(policy);
  return invokeDesktop('set_blocker_policy', { policy });
}

export async function setNativeBlockerActivity(settings) {
  if (!isTauri()) return null;
  return invokeDesktop('set_blocker_activity', {
    counter: Number(settings.counter) || 0,
    logs: Array.isArray(settings.logs) ? settings.logs.slice(0, 500) : []
  });
}

export function broadcastBlockerPolicy(policy) {
  window.postMessage({ channel: '__opencloud_blocker_v1__', type: 'policy', policy }, '*');
}

export async function listenNativeEvent(eventName, handler) {
  if (!isTauri() || !tauriApi()?.event?.listen) return () => {};
  return tauriApi().event.listen(eventName, (event) => handler(event.payload));
}

export async function openExternal(url) {
  if (isTauri()) return invokeDesktop('open_external', { url });
  if (isElectron()) return window.openCloudElectron.openExternal(url);
  window.open(url, '_blank', 'noopener,noreferrer');
}
