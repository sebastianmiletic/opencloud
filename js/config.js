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
    rank: 'Default',
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
    movieUrl: 'https://player.videasy.net/movie/{id}?nextEpisode=true&episodeSelector=true',
    tvUrl: 'https://player.videasy.net/tv/{id}/{season}/{episode}?nextEpisode=true&episodeSelector=true'
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
    movieUrl: 'https://vidsrc.me/embed/movie?tmdb={id}',
    tvUrl: 'https://vidsrc.me/embed/tv?tmdb={id}&season={season}&episode={episode}'
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
    movieUrl: 'https://moviesapi.club/movie/{id}',
    tvUrl: 'https://moviesapi.club/tv/{id}-{season}-{episode}'
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
    movieUrl: 'https://vidlink.pro/movie/{id}?title=true&poster=true&autoplay=false&nextbutton=true',
    tvUrl: 'https://vidlink.pro/tv/{id}/{season}/{episode}?title=true&poster=true&autoplay=false&nextbutton=true'
  }
};

export const DEVICES = {
  laptop: { name: 'Laptop / Desktop', class: 'device-laptop' },
  tv: { name: 'Google TV / Android TV', class: 'device-tv' },
  phone: { name: 'Phone', class: 'device-phone' }
};

export const THEMES = Object.freeze(['noir', 'graphite', 'midnight', 'ember', 'paper']);

export const DEFAULT_PROVIDER = 'videasy';
const SETTINGS_VERSION = 5;
const DEFAULT_SETTINGS = Object.freeze({
  provider: DEFAULT_PROVIDER,
  device: 'laptop',
  autoPlay: true,
  autoProviderFailover: false,
  theme: 'noir',
  roundedUI: false,
  _version: SETTINGS_VERSION
});

export function getSettings() {
  const raw = localStorage.getItem('openccloud_settings');
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      // Add new defaults without discarding a user's provider and device choices.
      return { ...DEFAULT_SETTINGS, ...parsed, _version: SETTINGS_VERSION };
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
      const merged = { ...getSettings(), ...cloudSettings, _version: SETTINGS_VERSION };
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
