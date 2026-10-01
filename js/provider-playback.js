/** Browser-safe provider APIs. No access to a cross-origin video's DOM. */
import { isPlausiblePlaybackSample } from './playback-progress.js';

export const BROWSER_PLAYBACK = Object.freeze({
  platinum: { origins: ['https://cinesrc.st'], resumeParam: 't', protocol: 'cinesrc' },
  ultra: {
    origins: ['https://vidphantom.com', 'https://vidphantom.live', 'https://vidphantom.online',
      'https://vidphantom.site', 'https://vidphantom.website', 'https://vidphantom.xyz'],
    resumeParam: 'startAt', protocol: 'player-event'
  },
  vidlink: { origins: ['https://vidlink.pro'], resumeParam: 'startAt', protocol: 'player-event' },
  videasy: { origins: ['https://player.videasy.net'], resumeParam: 'progress', protocol: 'player-event' }
});

function objectData(value) {
  if (typeof value === 'string') {
    if (value.length > 65536) return null;
    try { value = JSON.parse(value); } catch (_) { return null; }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

export function isTrustedProviderEvent(event, { providerKey, frameWindow, context }) {
  return Boolean(context && frameWindow && event.source === frameWindow
    && BROWSER_PLAYBACK[providerKey]?.origins.includes(event.origin));
}

function sameContent(data, context) {
  const id = data.tmdbId ?? data.mtmdbId ?? data.id;
  if (id == null || String(id) !== String(context.id) || data.mediaType !== context.type) return false;
  if (context.type === 'tv') {
    if (Number(data.season) !== Number(context.season)) return false;
    if (Number(data.episode) !== Number(context.episode)) return false;
  }
  return true;
}

const eventNames = { play: 'playing', playing: 'playing', pause: 'pause',
  timeupdate: 'timeupdate', seeking: 'seeking', seeked: 'seeked', ended: 'ended' };

/** Return a normalized event, or null for unknown, stale or untrusted messages.
 * State is per iframe generation and supplies missing time/duration for CineSrc
 * pause/ended events. Snapshots without an episode identity are never imported.
 */
export function parseProviderEvent(event, options, previous = {}) {
  if (!isTrustedProviderEvent(event, options)) return null;
  const envelope = objectData(event.data);
  if (!envelope) return null;
  const { providerKey, context } = options;
  const protocol = BROWSER_PLAYBACK[providerKey].protocol;
  let data, name;
  if (protocol === 'cinesrc') {
    if (envelope.type === 'cinesrc:ready') return { kind: 'ready' };
    if (envelope.type === 'cinesrc:nextepisode') {
      const season = Number(envelope.season), episode = Number(envelope.episode);
      if (context.type !== 'tv' || !Number.isInteger(season) || season < 1
        || !Number.isInteger(episode) || episode < 1 || season > 1000 || episode > 10000) return null;
      return { kind: 'episode', season, episode, internalNavigation: envelope.internalNavigation === true };
    }
    if (envelope.type === 'cinesrc:loadedmetadata') {
      const durationSeconds = envelope.duration;
      return typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds >= 180
        ? { kind: 'metadata', durationSeconds, mediaLoaded: true } : null;
    }
    if (envelope.type === 'cinesrc:response') {
      const value = envelope.result;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
      if (envelope.command === 'getDuration' && value >= 180) return { kind: 'metadata', durationSeconds: value };
      if (envelope.command !== 'getCurrentTime') return null;
      data = { currentTime: value, duration: previous.durationSeconds };
      name = 'checkpoint';
    } else {
      if (typeof envelope.type !== 'string' || !envelope.type.startsWith('cinesrc:')) return null;
      name = envelope.type.slice(8);
      if (!eventNames[name]) return null;
      data = envelope;
    }
  } else {
    if (envelope.type !== 'PLAYER_EVENT') return null;
    data = objectData(envelope.data);
    if (!data || !sameContent(data, context)) return null;
    name = data.event;
    if (!eventNames[name]) return null;
  }
  const canUsePrevious = ['play', 'playing', 'pause', 'ended'].includes(name);
  const time = data.currentTime ?? (canUsePrevious ? previous.seconds : undefined);
  const duration = data.duration ?? (canUsePrevious || name === 'checkpoint' ? previous.durationSeconds : undefined);
  // Reject coercions such as null, booleans, arbitrary strings, NaN and Infinity.
  if (typeof time !== 'number' || typeof duration !== 'number') return null;
  const sample = { seconds: time, durationSeconds: duration };
  if (!isPlausiblePlaybackSample(sample)) return null;
  const eventName = eventNames[name] || name;
  return { kind: 'progress', eventName, sample };
}

export function withBrowserResume(urlString, providerKey, seconds) {
  const api = BROWSER_PLAYBACK[providerKey];
  if (!api || !Number.isFinite(seconds) || seconds < 1) return urlString;
  const url = new URL(urlString);
  if (!api.origins.includes(url.origin)) return urlString;
  url.searchParams.set(api.resumeParam, String(Math.round(seconds * 10) / 10));
  if (api.protocol === 'cinesrc') url.searchParams.set('continueprompt', 'false');
  return url.toString();
}

export function cinesrcCommand(command, args = []) {
  return { type: 'cinesrc:command', command, args };
}
