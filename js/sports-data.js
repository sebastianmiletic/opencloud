/** Camel's public, read-only football feed. No website HTML or scripts are rendered. */
export const SPORTS_API_ORIGIN = 'https://api.cameltv.live';
const API_ROOT = '/camel-service/ee/sports_live/';
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;
const GROUP_KEYS = ['obs_group', 'living_group', 'hot_group', 'category_group', 'country_group', 'other_group', 'competition_match', 'match', 'results'];

export function sportsUpstream(resource, { date, matchId, streamName } = {}) {
  let route, parameter, value;
  if (resource === 'schedule' && /^\d{8}$/.test(date || '')) {
    const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
    const parsed = new Date(`${iso}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) return null;
    route = 'home_match'; parameter = 'day'; value = date;
  } else if (resource === 'streams' && ID_PATTERN.test(matchId || '')) {
    route = 'football/stream'; parameter = 'matchId'; value = matchId;
  } else if (resource === 'token' && ID_PATTERN.test(streamName || '')) {
    route = 'token'; parameter = 'streamName'; value = streamName;
  } else return null;
  const url = new URL(API_ROOT + route, SPORTS_API_ORIGIN);
  url.searchParams.set(parameter, value);
  return url;
}

export function camelData(response) {
  if (response?.status === 200 && response.data != null) return response.data;
  throw new Error('Camel is temporarily unavailable. Try refreshing.');
}

const STATUS = {
  0: 'Unavailable', 1: 'Upcoming', 2: 'First half', 3: 'Half-time', 4: 'Second half',
  5: 'Extra time', 7: 'Penalties', 8: 'Full-time', 9: 'Postponed', 10: 'Interrupted',
  11: 'Suspended', 12: 'Cancelled', 13: 'Time TBC'
};
const LIVE = new Set([2, 3, 4, 5, 7]);

function score(values, status) {
  if (!Array.isArray(values) || status === 1 || status === 13) return null;
  // The provider uses the extra-time total at index 5 when present.
  const value = Number(values[5]) > 0 ? values[5] : values[0];
  return Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
}

export function sportsImage(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    return ['img.thesports.com', 'img.cameltv.live', 'livecdn.cameltv.live'].includes(url.hostname) ? url.href : '';
  } catch { return ''; }
}

export function normalizeSportsMatches(data) {
  if (!data || typeof data !== 'object' || !GROUP_KEYS.some(key => Array.isArray(data[key]))) {
    throw new Error('Camel returned an unfamiliar schedule. Try refreshing later.');
  }
  const matches = new Map();
  function visit(node, competition = {}, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 12) return;
    if (Array.isArray(node)) { node.forEach(child => visit(child, competition, depth + 1)); return; }
    if (node.competition) competition = node.competition;
    if (ID_PATTERN.test(node.id || '') && node.home_team && node.away_team) {
      if (matches.has(node.id)) return;
      const status = Number(node.real_time_data?.status_id ?? node.status_id);
      const home = String(node.home_team.name_en || node.home_team.name || 'Home team').slice(0, 200);
      const away = String(node.away_team.name_en || node.away_team.name || 'Away team').slice(0, 200);
      const live = LIVE.has(status);
      matches.set(node.id, {
        id: node.id, home, away,
        homeLogo: sportsImage(node.home_team.country_logo || node.home_team.logo),
        awayLogo: sportsImage(node.away_team.country_logo || node.away_team.logo),
        competition: String(competition.name_en || competition.name || 'Other matches').slice(0, 200),
        competitionId: String(competition.id || node.competition_id || 'other'),
        startTime: Number(node.match_time) * 1000,
        status, statusLabel: STATUS[status] || 'Unavailable', live,
        phase: live ? 'live' : status === 8 ? 'results' : 'upcoming',
        homeScore: score(node.home_scores, status), awayScore: score(node.away_scores, status),
        watchable: (live && Number(node.coverage?.has_stream) === 1) || Number(node.has_custom_stream) === 1,
        kickoffTime: Number(node.real_time_data?.kickoff_time) * 1000
      });
      return;
    }
    GROUP_KEYS.forEach(key => visit(node[key], competition, depth + 1));
  }
  visit(data);
  return [...matches.values()];
}

export function filterSportsMatches(matches, { query = '', phase = 'all' } = {}) {
  const needle = query.trim().toLocaleLowerCase();
  const order = { live: 0, upcoming: 1, results: 2 };
  return matches.filter(match => (phase === 'all' || match.phase === phase)
    && (!needle || `${match.home} ${match.away} ${match.competition}`.toLocaleLowerCase().includes(needle)))
    .sort((a, b) => order[a.phase] - order[b.phase] || a.startTime - b.startTime || a.id.localeCompare(b.id));
}

export function sportsStreamUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    if (!['camel4.live', 'cameltv.live'].some(host => url.hostname.endsWith(`.${host}`))) return '';
    if (!/^\/live\/[a-zA-Z0-9_-]+\.m3u8$/.test(url.pathname)) return '';
    return url.href;
  } catch { return ''; }
}

export function sportsStreams(data) {
  if (!Array.isArray(data)) throw new Error('Camel returned an unfamiliar stream list.');
  const seen = new Set();
  return data.flatMap(stream => {
    const url = sportsStreamUrl(stream?.streamUrlM3u8 || stream?.streamUrl);
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [{ url, backup: Number(stream.isBackup) === 1 }];
  });
}

export function sportsStreamName(raw) {
  const url = sportsStreamUrl(raw);
  if (!url) throw new Error('This stream is outside the Camel media allowlist.');
  return new URL(url).pathname.split('/').pop().replace(/\.m3u8$/, '');
}

// Public response-envelope key shipped by Camel's web client, not an account
// credential. Tokens are still issued and authorized by Camel's /token endpoint.
const PUBLIC_TOKEN_ENVELOPE = 'tVIVSag6HwBa2ixdiJhyoVGv2VhR/2ALR8zNrt+jjcU=';
const fromBase64 = value => Uint8Array.from(atob(value), character => character.charCodeAt(0));

export async function authorizeSportsStream(rawUrl, token, subtle = globalThis.crypto?.subtle) {
  const url = sportsStreamUrl(rawUrl);
  if (!url || !subtle || typeof token?.txSecret !== 'string' || !/^[0-9a-f]+$/i.test(token?.txTime || '')) {
    throw new Error('Camel could not authorize this stream. Try again.');
  }
  let secret = token.txSecret;
  if (!/^[0-9a-f]{32}$/i.test(secret)) {
    try {
      const key = await subtle.importKey('raw', fromBase64(PUBLIC_TOKEN_ENVELOPE), 'AES-GCM', false, ['decrypt']);
      const decoded = await subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(secret.slice(0, 16)) }, key, fromBase64(secret.slice(16)));
      secret = new TextDecoder().decode(decoded);
    } catch { throw new Error('Camel changed its stream authorization. Try again later.'); }
  }
  if (!/^[0-9a-f]{32}$/i.test(secret)) throw new Error('Camel returned an invalid playback token.');
  const authorized = new URL(url);
  authorized.searchParams.set('txSecret', secret);
  authorized.searchParams.set('txTime', token.txTime);
  return authorized.href;
}
