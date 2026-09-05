const INSTALLATION_KEY = 'oc_installation_id';
const SESSION_KEY = 'oc_usage_session_id';
export const ONLINE_WINDOW_MS = 120000;

export function validInstallationId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '');
}

export function getOrCreateInstallationId() {
  let installId = localStorage.getItem(INSTALLATION_KEY) || '';
  if (!validInstallationId(installId)) {
    installId = crypto.randomUUID();
    localStorage.setItem(INSTALLATION_KEY, installId);
  }
  return installId;
}

export function getInstallationIdentity(env = {}, deviceKind = 'laptop') {
  const installId = getOrCreateInstallationId();
  let sessionId = sessionStorage.getItem(SESSION_KEY) || '';
  if (!validInstallationId(sessionId)) {
    sessionId = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, sessionId);
  }
  return {
    installId,
    sessionId,
    appVersion: String(env.APP_VERSION || 'unknown'),
    platform: String(env.APP_PLATFORM || 'unknown'),
    architecture: String(env.APP_ARCHITECTURE || 'unknown'),
    deviceKind: ['laptop', 'tv', 'phone'].includes(deviceKind) ? deviceKind : 'laptop'
  };
}

export function isRecentlyOnline(lastSeenAt, now = Date.now()) {
  if (!lastSeenAt) return false;
  const seen = new Date(lastSeenAt).getTime();
  return Number.isFinite(seen) && now - seen <= ONLINE_WINDOW_MS;
}
