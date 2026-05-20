/** API Configuration & Settings */
// Read from env.js (injected by server from .env file), fallback to empty
const ENV = (typeof window !== 'undefined' && window.ENV) ? window.ENV : {};

export const API_KEY = ENV.TMDB_BEARER_TOKEN || '';
export const BASE_URL = 'https://api.themoviedb.org/3';
export const IMG_BASE = 'https://image.tmdb.org/t/p/';
export const OMDB_KEY = ENV.OMDB_API_KEY || '';
export const OMDB_URL = 'http://www.omdbapi.com/';

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

export function getSettings() {
  return JSON.parse(localStorage.getItem('openccloud_settings')) || {
    provider: 'vidsrccc',
    device: 'laptop',
    autoPlay: true
  };
}

export function saveSettings(settings) {
  localStorage.setItem('openccloud_settings', JSON.stringify(settings));
}

export function getProviderUrl(type, id, season = 1, episode = 1) {
  const settings = getSettings();
  const p = PROVIDERS[settings.provider] || PROVIDERS.vidsrccc;
  let url = type === 'movie' ? p.movieUrl : p.tvUrl;
  url = url.replace(/{id}/g, id).replace(/{season}/g, season).replace(/{episode}/g, episode);
  return url;
}

export function getActiveProvider() {
  const settings = getSettings();
  return PROVIDERS[settings.provider] || PROVIDERS.vidsrccc;
}

export function applyDeviceClass() {
  const settings = getSettings();
  document.body.classList.remove('device-laptop', 'device-tv', 'device-phone');
  document.body.classList.add(DEVICES[settings.device]?.class || 'device-laptop');
}
