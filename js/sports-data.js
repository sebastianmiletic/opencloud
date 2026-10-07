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
  if (!Array.isArray(values) || (!LIVE.has(status) && status !== 8)) return null;
  // Index 5 is the provider's extra-time total, not a predicted score.
  const value = Number(values[5]) > 0 ? values[5] : values[0];
  if (value == null || value === '' || typeof value === 'boolean') return null;
  return Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
}

const nameKey = value => String(value || '').normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const NON_SENIOR = /\b(?:u[\s.-]*[1-9]\d?s?|under[\s-]*[1-9]\d?s?|youth|reserves?|academy|academies|development|amateur|regional|school|university|futsal|beach|esoccer)\b|\bpremier league 2\b/i;
const JUNIOR = /\bjuniors?\b/i;
// "Juniors" is part of several real senior clubs' names, not their age category.
const SENIOR_JUNIOR_NAMES = new Set(['Boca Juniors', 'Boca Juniors de Cali', 'Argentinos Juniors',
  'Junior', 'Atletico Junior', 'Junior Barranquilla', 'Atletico Junior Barranquilla'].map(nameKey));
const RESERVE_TEAM = /(?:\b(?:b|c|ii|iii|2|3)|\bres\.)\s*\)?$/i;
// A transparent competition allowlist, not fabricated fixtures or popularity.
// Youth/reserve checks apply to BOTH team names even in senior competitions.
const MAIN_COMPETITIONS = new Set([
  'English Premier League', 'Premier League', 'English Football League Championship', 'English Championship',
  'Spanish La Liga', 'La Liga', 'LaLiga', 'Spanish Segunda Division',
  'German Bundesliga', 'Bundesliga', 'German Bundesliga 2',
  'Italian Serie A', 'Serie A', 'French Ligue 1', 'Ligue 1',
  'Portuguese Primera Liga', 'Portuguese Primeira Liga', 'Primeira Liga',
  'Netherlands Eredivisie', 'Dutch Eredivisie', 'Eredivisie',
  'Belgian Pro League', 'Belgian First Division A', 'Scottish Premiership', 'Scottish Premier League',
  'Turkish Super League', 'Turkish Super Lig', 'Greek Super League', 'Austrian Bundesliga', 'Swiss Super League',
  'Danish Superliga', 'Swedish Allsvenskan', 'Norwegian Eliteserien', 'Polish Ekstraklasa',
  'Czech First League', 'Croatian First Football League', 'Serbian Super Liga', 'Romanian Liga I',
  'Ukrainian Premier League', 'Russian Premier League',
  'United States Major League Soccer', 'USA Major League Soccer', 'Major League Soccer', 'MLS',
  'Australia A-League', 'Australian A-League', 'A-League', 'A-League Men', 'A-League Women',
  'Japanese J1 League', 'J1 League', 'Korean K League 1', 'South Korea K League 1',
  'Chinese Super League', 'Saudi Professional League', 'Saudi Pro League',
  'Qatar Stars League', 'United Arab Emirates Pro-League', 'Indian Super League',
  'Brazilian Serie A', 'Brazilian Campeonato Serie A', 'Argentine Division 1', 'Argentine Primera Division',
  'Argentina Liga Profesional', 'Liga Profesional', 'Liga MX', 'Mexico Liga MX', 'Mexican Liga MX',
  'Paraguayan Primera Division', 'Uruguayan Primera Division', 'Chilean Primera Division',
  'Colombian Primera A', 'Categoria Primera A', 'Peruvian Liga 1', 'Ecuadorian LigaPro',
  'Egyptian Premier League', 'South African Premier Soccer League', 'Moroccan Botola Pro', 'Algerian Ligue Professionnelle 1',
  'FA Cup', 'English FA Cup', 'English Carabao Cup', 'English League Cup', 'EFL Cup', 'Community Shield',
  'Spanish Copa Del Rey', 'Copa Del Rey', 'Spanish Super Cup',
  'German Cup', 'DFB Pokal', 'DFB-Pokal', 'Italian Cup', 'Coppa Italia', 'Italian Super Cup',
  'French Cup', 'Coupe De France', 'Portuguese Cup', 'Taca De Portugal', 'Netherlands Cup', 'KNVB Cup',
  'Scottish Cup', 'Scottish League Cup', 'Turkish Cup', 'Turkish Super Cup',
  'Belgian Cup', 'Austrian Cup', 'Swiss Cup', 'Danish Cup', 'Sweden Cup', 'Norwegian SAS Braathens Cup',
  'Polish Cup', 'Greek Cup', 'Ukrainian Cup',
  'Brazilian Cup', 'Copa Do Brasil', 'Argentine Cup', 'Copa Argentina', 'Chilean Cup',
  'Australia Cup', 'Australian FFA Cup', 'US Open Cup', 'Leagues Cup', 'Emperor Cup', "Japan Emperor's Cup",
  'Vietnam National Cup', 'Korean FA Cup', 'Saudi Kings Cup', 'Egyptian Cup',
  'International Friendly', 'FIFA Club World Cup', 'FIFA Intercontinental Cup',
  'English FA Women Super League', "FA Women's Super League", 'Women Super League',
  'National Womens Soccer League', 'USA National Women Soccer League', 'NWSL',
  'UEFA Women Champions League', "UEFA Women's Champions League", "FIFA Women's World Cup"
].map(nameKey));
const MAIN_INTERNATIONAL = /^(?:(?:fifa )?world cup|(?:uefa )?(?:european championship|euro)|(?:uefa |concacaf )?nations league|(?:uefa )?(?:champions league|europa league|europa conference league|conference league|super cup)|(?:conmebol )?(?:copa america|copa libertadores|copa sudamericana)|(?:caf )?(?:africa cup of nations|champions league|confederation cup)|(?:afc )?(?:asian cup|champions league(?: elite| two)?)|(?:concacaf )?(?:gold cup|champions cup|champions league)|(?:ofc )?(?:nations cup|champions league))(?: qualification.*| qualifiers.*| qualifying.*)?$/;

export function isMainFootballMatch(match) {
  if (!match?.home || !match?.away || !match?.competition) return false;
  if ([match.home, match.away, match.competition].some(value => NON_SENIOR.test(value))) return false;
  if (JUNIOR.test(match.competition)) return false;
  if ([match.home, match.away].some(value => RESERVE_TEAM.test(value)
    || (JUNIOR.test(value) && !SENIOR_JUNIOR_NAMES.has(nameKey(value))))) return false;
  const competition = nameKey(match.competition);
  return MAIN_COMPETITIONS.has(competition) || MAIN_INTERNATIONAL.test(competition);
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
  function visit(node, competition = {}, country = '', depth = 0, featured = false) {
    if (!node || typeof node !== 'object' || depth > 12) return;
    if (Array.isArray(node)) { node.forEach(child => visit(child, competition, country, depth + 1, featured)); return; }
    if (node.competition) competition = node.competition;
    if (node.country) country = String(node.country.name_en || node.country.name || '').trim().slice(0, 100);
    if (ID_PATTERN.test(node.id || '') && node.home_team && node.away_team) {
      if (matches.has(node.id)) {
        const existing = matches.get(node.id);
        if (featured) existing.featured = true;
        if (country && !existing.country) existing.country = country;
        return;
      }
      const status = Number(node.real_time_data?.status_id ?? node.status_id);
      const home = String(node.home_team.name_en || node.home_team.name || '').trim().slice(0, 200);
      const away = String(node.away_team.name_en || node.away_team.name || '').trim().slice(0, 200);
      const competitionName = String(competition.name_en || competition.name || '').trim().slice(0, 200);
      if (!home || !away || !competitionName) return; // Never manufacture missing teams or leagues.
      const live = LIVE.has(status);
      matches.set(node.id, {
        id: node.id, home, away,
        homeLogo: sportsImage(node.home_team.country_logo || node.home_team.logo),
        awayLogo: sportsImage(node.away_team.country_logo || node.away_team.logo),
        competition: competitionName, country, featured,
        competitionId: String(competition.id || node.competition_id || nameKey(competitionName)),
        startTime: Number(node.match_time) > 0 ? Number(node.match_time) * 1000 : NaN,
        status, statusLabel: STATUS[status] || 'Unavailable', live,
        phase: live ? 'live' : status === 8 ? 'results' : 'upcoming',
        homeScore: score(node.home_scores, status), awayScore: score(node.away_scores, status),
        watchable: live && Number(node.is_blocked) !== 1
          && (Number(node.coverage?.has_stream) === 1 || Number(node.has_custom_stream) === 1),
        providerUpdatedAt: Number(node.updated_at) > 0 ? Number(node.updated_at) * 1000 : null
      });
      return;
    }
    GROUP_KEYS.forEach(key => visit(node[key], competition, country, depth + 1, featured || key === 'hot_group'));
  }
  visit(data);
  return [...matches.values()];
}

export function matchesSportsQuery(match, query = '') {
  const normalized = nameKey(query);
  if (!normalized) return true;
  const tokens = normalized.split(' ').filter(token => !['v', 'vs', 'versus', 'against'].includes(token));
  if (!tokens.length) return false;
  const searchable = nameKey(`${match?.home || ''} ${match?.away || ''} ${match?.competition || ''} ${match?.country || ''}`);
  return tokens.every(token => searchable.includes(token));
}

export function filterSportsMatches(matches, { query = '', phase = 'all' } = {}) {
  const order = { live: 0, upcoming: 1, results: 2 };
  return matches.filter(match => (phase === 'all' || match.phase === phase) && matchesSportsQuery(match, query))
    .sort((a, b) => order[a.phase] - order[b.phase] || Number(b.watchable) - Number(a.watchable)
      || Number(b.featured) - Number(a.featured)
      || (Number.isFinite(a.startTime) ? a.startTime : Infinity) - (Number.isFinite(b.startTime) ? b.startTime : Infinity)
      || a.id.localeCompare(b.id));
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
  }).sort((a, b) => Number(a.backup) - Number(b.backup)
    || streamPreference(b.url) - streamPreference(a.url)).slice(0, 8);
}

function streamPreference(url) {
  const name = new URL(url).pathname.split('/').pop();
  return (name.startsWith('hd-') ? 2 : 0) + (name.includes('-en-') ? 1 : 0);
}

export function sportsStreamLabel(stream, index) {
  const name = sportsStreamName(stream.url);
  const parts = [];
  if (name.startsWith('hd-')) parts.push('HD');
  if (name.startsWith('sd-')) parts.push('SD');
  // Do not infer commentary language from an opaque stream identifier.
  parts.push(`Source ${index + 1}`);
  if (stream.backup) parts.push('Backup');
  return parts.join(' · ');
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
