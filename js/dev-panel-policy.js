const INSTALLATION_KEY = 'oc_installation_id';
export const ONLINE_WINDOW_MS = 120000;

export function validInstallationId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '');
}

export function getInstallationIdentity(env = {}) {
  let installId = localStorage.getItem(INSTALLATION_KEY) || '';
  if (!validInstallationId(installId)) {
    installId = crypto.randomUUID();
    localStorage.setItem(INSTALLATION_KEY, installId);
  }
  return {
    installId,
    appVersion: String(env.APP_VERSION || 'unknown'),
    platform: String(env.APP_PLATFORM || 'unknown'),
    architecture: String(env.APP_ARCHITECTURE || 'unknown')
  };
}

export function isRecentlyOnline(lastSeenAt, now = Date.now()) {
  if (!lastSeenAt) return false;
  const seen = new Date(lastSeenAt).getTime();
  return Number.isFinite(seen) && now - seen <= ONLINE_WINDOW_MS;
}
