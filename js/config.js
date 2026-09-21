/** API Configuration & Settings */
// Read from env.js (injected by server from .env file), fallback to empty
const ENV = (typeof window !== 'undefined' && window.ENV) ? window.ENV : {};

export const API_KEY = ENV.TMDB_BEARER_TOKEN || '';
export const BASE_URL = 'https://api.themoviedb.org/3';
export const IMG_BASE = 'https://image.tmdb.org/t/p/';
export const OMDB_KEY = ENV.OMDB_API_KEY || '';
export const OMDB_URL = 'https://www.omdbapi.com/';

export const HERO_SLIDE_DURATION = 12000;

export const STAR_WARS_SAGA_ORDER = [
  'The Phantom Menace', 'Attack of the Clones', 'Revenge of the Sith',
  'Solo: A Star Wars Story', 'Rogue One: A Star Wars Story',
  'A New Hope', 'The Empire Strikes Back', 'Return of the Jedi',
  'The Force Awakens', 'The Last Jedi', 'The Rise of Skywalker'
];

export const PROVIDERS = {
  vidsrccc: {
    name: 'Nova',
    tier: 1,
    movie: true,
    tv: true,
    quality: '1080p',
    subtitles: true,
    speed: 'Fast',
    description: 'Reliable all-rounder with fast load times and consistent uptime.',
    movieUrl: 'https://vidsrc.cc/v3/embed/movie/{id}?autoPlay=false',
    tvUrl: 'https://vidsrc.cc/v3/embed/tv/{id}/{season}/{episode}?autoPlay=false'
  },
  videasy: {
    name: 'Helix',
    rank: '1st',
    tier: 1,
    movie: true,
    tv: true,
    quality: '4K',
    subtitles: true,
    speed: 'Fast',
    description: 'Premium player with built-in next-episode and selector UI.',
    movieUrl: 'https://player.videasy.net/movie/{id}',
    tvUrl: 'https://player.videasy.net/tv/{id}/{season}/{episode}?nextEpisode=true&episodeSelector=true'
  },
  ultra: {
    name: 'Ultra',
    tags: ['New', 'Working'],
    tier: 1,
    movie: true,
    tv: true,
    quality: '1080p',
    subtitles: true,
    speed: 'Fast',
    description: 'VidPhantom player with broad movie and episode coverage.',
    movieUrl: 'https://vidphantom.com/movie/{id}',
    tvUrl: 'https://vidphantom.com/tv/{id}/{season}/{episode}'
  },
  delta: {
    name: 'Delta',
    tags: ['New', 'Working'],
    tier: 1,
    movie: true,
    tv: true,
    quality: '4K',
    subtitles: true,
    speed: 'Fast',
    description: 'Fast VidCore player with adaptive streaming and subtitles.',
    movieUrl: 'https://vidcore.org/embed/movie/{id}',
    tvUrl: 'https://vidcore.org/embed/tv/{id}/{season}/{episode}'
  },
  omega: {
    name: 'Omega',
    tags: ['New', 'Working'],
    tier: 1,
    movie: true,
    tv: true,
    quality: '1080p',
    subtitles: true,
    speed: 'Fast',
    description: 'EmbedMaster player with movie, episode, and subtitle support.',
    movieUrl: 'https://embedmaster.link/movie/{id}',
    tvUrl: 'https://embedmaster.link/tv/{id}/{season}/{episode}'
  },
  vsembed: {
    name: 'Plasma',
    rank: 'Default',
    tier: 1,
    movie: true,
    tv: true,
    description: 'New movie and series source powered by the VSEmbed player.',
    movieUrl: 'https://vsembed.ru/embed/movie/{id}',
    tvUrl: 'https://vsembed.ru/embed/tv/{id}/{season}/{episode}'
  },
  vidsrcme: {
    name: 'Pulse',
    rank: '2nd',
    tier: 1,
    movie: true,
    tv: true,
    quality: '1080p',
    subtitles: true,
    speed: 'Medium',
    description: 'Stable source with multi-language subtitle support.',
    movieUrl: 'https://vidsrc.me/embed/movie?tmdb={id}&autoplay=1',
    tvUrl: 'https://vidsrc.me/embed/tv?tmdb={id}&season={season}&episode={episode}&autoplay=1'
  },
  vidsrcto: {
    name: 'Phantom',
    movie: true,
    tv: true,
    quality: '1080p',
    subtitles: false,
    speed: 'Fast',
    description: 'Minimalist embed with clean playback and no clutter.',
    movieUrl: 'https://vidsrc.to/embed/movie/{id}',
    tvUrl: 'https://vidsrc.to/embed/tv/{id}/{season}/{episode}'
  },
  moviesapi: {
    name: 'Dossier',
    movie: true,
    tv: true,
    quality: '720p',
    subtitles: false,
    speed: 'Medium',
    description: 'Large back-catalog with older titles and cult classics.',
    movieUrl: 'https://moviesapi.to/movie/{id}',
    tvUrl: 'https://moviesapi.to/tv/{id}-{season}-{episode}'
  },
  vixsrc: {
    name: 'VixSrc',
    movie: true,
    tv: true,
    quality: '1080p',
    subtitles: true,
    speed: 'Fast',
    description: 'Fast VixSrc player with English language playback.',
    movieUrl: 'https://vixsrc.to/movie/{id}?autoPlay=true&lang=en',
    tvUrl: 'https://vixsrc.to/tv/{id}/{season}/{episode}?autoPlay=true&lang=en'
  },
  vidfast: {
    name: 'VidFast',
    movie: true,
    tv: true,
    quality: '1080p',
    subtitles: true,
    speed: 'Fast',
    description: 'Responsive VidFast source with automatic playback.',
    movieUrl: 'https://vidfast.pro/movie/{id}?autoPlay=true',
    tvUrl: 'https://vidfast.pro/tv/{id}/{season}/{episode}?autoPlay=true'
  },
  vidsrcsu: {
    name: 'Zenith',
    movie: true,
    tv: true,
    quality: '1080p',
    subtitles: false,
    speed: 'Fast',
    description: 'Lightweight and responsive with broad title coverage.',
    movieUrl: 'https://vidsrc.su/embed/movie/{id}',
    tvUrl: 'https://vidsrc.su/embed/tv/{id}/{season}/{episode}'
  },
  vidlink: {
    name: 'Vertex',
    movie: true,
    tv: true,
    quality: '4K',
    subtitles: true,
    speed: 'Medium',
    description: 'Rich UI with poster, title cards, and next-episode button.',
    movieUrl: 'https://vidlink.pro/movie/{id}?title=true&poster=true&autoplay=true',
    tvUrl: 'https://vidlink.pro/tv/{id}/{season}/{episode}?title=true&poster=true&autoplay=true&nextbutton=true'
  }
};

export const DEVICES = {
  laptop: { name: 'Laptop / Desktop', class: 'device-laptop' },
  tv: { name: 'Google TV / Android TV', class: 'device-tv' },
  phone: { name: 'Phone', class: 'device-phone' }
};

export const THEMES = Object.freeze(['noir', 'graphite', 'midnight', 'ember', 'paper']);

export const DEFAULT_PROVIDER = 'vsembed';
const SETTINGS_VERSION = 7;
const DEFAULT_SETTINGS = Object.freeze({
  provider: DEFAULT_PROVIDER,
  device: 'laptop',
  autoPlay: true,
  autoProviderFailover: false,
  playerHeaderAutoHide: false,
  theme: 'noir',
  roundedUI: false,
  _version: SETTINGS_VERSION
});

function normalizeSettings(settings, sourceVersion = settings?._version) {
  const normalized = { ...DEFAULT_SETTINGS, ...settings, _version: SETTINGS_VERSION };
  // Version 7 makes Plasma the one-time default for every existing installation/account.
  if ((Number(sourceVersion) || 0) < SETTINGS_VERSION) normalized.provider = DEFAULT_PROVIDER;
  if (!PROVIDERS[normalized.provider]) normalized.provider = DEFAULT_PROVIDER;
  return normalized;
}

export function getSettings() {
  const raw = localStorage.getItem('openccloud_settings');
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const normalized = normalizeSettings(parsed);
      if (parsed._version !== SETTINGS_VERSION || parsed.provider !== normalized.provider) {
        localStorage.setItem('openccloud_settings', JSON.stringify(normalized));
      }
      return normalized;
    } catch (e) { /* fall through */ }
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings) {
  const next = { ...settings, _version: SETTINGS_VERSION };
  localStorage.setItem('openccloud_settings', JSON.stringify(next));
  applyAppearanceSettings(next);
  queueSettingsSync();
}

export function applyAppearanceSettings(settings = getSettings()) {
  if (typeof document === 'undefined') return;
  const theme = THEMES.includes(settings.theme) ? settings.theme : 'noir';
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle('ui-rounded', settings.roundedUI === true);
}

/* Sync settings to Supabase when authenticated */
let _settingsSyncTimeout = null;
export function queueSettingsSync() {
  if (_settingsSyncTimeout) clearTimeout(_settingsSyncTimeout);
  _settingsSyncTimeout = setTimeout(() => {
    syncSettingsToCloud();
  }, 1000);
}

async function syncSettingsToCloud() {
  try {
    const { getCurrentAuthUser } = await import('./auth.js');
    const { saveUserSettings } = await import('./sync.js');
    const user = getCurrentAuthUser();
    if (user?.id) {
      const settings = getSettings();
      await saveUserSettings(user.id, settings);
    }
  } catch (err) {
    console.error('[Config] Settings sync failed:', err);
  }
}

/* Hydrate settings from Supabase after login */
export async function hydrateSettingsFromCloud() {
  try {
    const { getCurrentAuthUser } = await import('./auth.js');
    const { fetchUserSettings } = await import('./sync.js');
    const user = getCurrentAuthUser();
    if (!user?.id) return;
    const cloudSettings = await fetchUserSettings(user.id);
    if (cloudSettings) {
      const merged = normalizeSettings(
        { ...getSettings(), ...cloudSettings },
        cloudSettings._version
      );
      saveSettings(merged);
    }
  } catch (err) {
    console.error('[Config] Settings hydration failed:', err);
  }
}

export function getProviderUrlFor(providerKey, type, id, season = 1, episode = 1) {
  const p = PROVIDERS[providerKey] || PROVIDERS[DEFAULT_PROVIDER];
  let url = type === 'movie' ? p.movieUrl : p.tvUrl;
  url = url.replace(/{id}/g, id).replace(/{season}/g, season).replace(/{episode}/g, episode);
  return url;
}

export function getProviderUrl(type, id, season = 1, episode = 1) {
  return getProviderUrlFor(getSettings().provider, type, id, season, episode);
}

export function getProviderCandidates(type) {
  const selected = getSettings().provider;
  return Object.entries(PROVIDERS)
    .filter(([, provider]) => provider[type] !== false)
    .sort((a, b) => {
      if (a[0] === selected) return -1;
      if (b[0] === selected) return 1;
      const tierDiff = (a[1].tier || 99) - (b[1].tier || 99);
      return tierDiff || a[1].name.localeCompare(b[1].name);
    })
    .map(([key]) => key);
}

export function getActiveProvider() {
  const settings = getSettings();
  return PROVIDERS[settings.provider] || PROVIDERS[DEFAULT_PROVIDER];
}

export function applyDeviceClass() {
  const settings = getSettings();
  const device = DEVICES[settings.device] ? settings.device : 'laptop';
  document.body.classList.remove('device-laptop', 'device-tv', 'device-phone');
  document.body.classList.add(DEVICES[device].class);
  window.dispatchEvent(new CustomEvent('opencloud:device-layout', { detail: { device } }));
}
