import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { resolveUpNextEpisode } from '../js/series.js';
import {
  connectionScoreForLatency,
  connectionScoreForPlayback,
  stallThresholdsForConnection
} from '../js/player-health.js';
import { getProviderUrlFor, PROVIDERS } from '../js/config.js';
import {
  getSavedPlaybackDuration,
  getSavedPlaybackSeconds,
  isPlausiblePlaybackSample,
  mergePlaybackCheckpoint
} from '../js/playback-progress.js';

const localValues = new Map();
globalThis.localStorage = {
  getItem: key => localValues.get(key) ?? null,
  setItem: (key, value) => localValues.set(key, String(value))
};

test('Continue Watching resumes an episode below the completion threshold', () => {
  const show = { seasons: [{ season_number: 1, episode_count: 8 }] };
  assert.deepEqual(
    resolveUpNextEpisode(show, { season: 1, episode: 3, elapsedMinutes: 20, episodeRuntime: 45 }),
    { season: 1, episode: 3, advanced: false }
  );
});

test('Continue Watching advances completed episodes and crosses season boundaries', () => {
  const show = { seasons: [
    { season_number: 0, episode_count: 4 },
    { season_number: 1, episode_count: 8 },
    { season_number: 2, episode_count: 6 }
  ] };
  assert.deepEqual(
    resolveUpNextEpisode(show, { season: 1, episode: 8, elapsedMinutes: 44, episodeRuntime: 45 }),
    { season: 2, episode: 1, advanced: true }
  );
});

test('Continue Watching stays on the series finale instead of inventing an episode', () => {
  const show = { seasons: [{ season_number: 1, episode_count: 2 }] };
  assert.deepEqual(
    resolveUpNextEpisode(show, { season: 1, episode: 2, elapsedMinutes: 50, episodeRuntime: 50 }),
    { season: 1, episode: 2, advanced: false }
  );
});

test('home exposes one episode-aware Continue Watching row and no Up Next heading', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.equal((html.match(/id="continueWatchingSection"/g) || []).length, 1);
  assert.match(html, /<h3>Continue Watching<\/h3>/);
  assert.match(html, /class="category-row up-next-row" id="continueWatchingRow"/);
  assert.doesNotMatch(html, /<h3>Up Next<\/h3>/);
});

test('automatic provider failover is off by default and settings migrate safely', async () => {
  const { getSettings } = await import('../js/config.js');
  localValues.clear();
  assert.equal(getSettings().autoProviderFailover, false);

  localValues.set('openccloud_settings', JSON.stringify({
    _version: 3,
    provider: 'moviesapi',
    device: 'tv',
    autoPlay: false
  }));
  assert.deepEqual(
    { provider: getSettings().provider, device: getSettings().device, autoPlay: getSettings().autoPlay, autoProviderFailover: getSettings().autoProviderFailover, playerHeaderAutoHide: getSettings().playerHeaderAutoHide, theme: getSettings().theme, roundedUI: getSettings().roundedUI },
    { provider: 'moviesapi', device: 'tv', autoPlay: false, autoProviderFailover: false, playerHeaderAutoHide: false, theme: 'noir', roundedUI: false }
  );

  localValues.set('openccloud_settings', JSON.stringify({ playerHeaderAutoHide: true }));
  assert.equal(getSettings().playerHeaderAutoHide, true);
});

test('provider health maps reachability and latency onto five honest levels', () => {
  assert.equal(connectionScoreForLatency(180, 200, true), 5);
  assert.equal(connectionScoreForLatency(620, 200, true), 4);
  assert.equal(connectionScoreForLatency(1300, 200, true), 3);
  assert.equal(connectionScoreForLatency(2600, 200, true), 2);
  assert.equal(connectionScoreForLatency(500, 503, true), 1);
  assert.equal(connectionScoreForLatency(100, 200, false), 1);
});

test('provider health uses actual video buffer depth and media failures', () => {
  assert.equal(connectionScoreForPlayback(45, 4, false, 0), 5);
  assert.equal(connectionScoreForPlayback(18, 4, false, 0), 4);
  assert.equal(connectionScoreForPlayback(7, 3, false, 0), 3);
  assert.equal(connectionScoreForPlayback(1, 2, false, 0), 2);
  assert.equal(connectionScoreForPlayback(60, 4, true, 0), 1);
  assert.equal(connectionScoreForPlayback(60, 4, false, 2), 1);
});

test('stall recovery gives weak connections time to refill before failover', () => {
  assert.deepEqual(stallThresholdsForConnection({ effectiveType: '4g', downlink: 20 }), {
    recoverAfterMs: 4000,
    failoverAfterMs: 14000
  });
  assert.deepEqual(stallThresholdsForConnection({ effectiveType: '3g', downlink: 2 }), {
    recoverAfterMs: 5000,
    failoverAfterMs: 20000
  });
});

test('Plasma is marked new and generates exact movie and TV embed URLs', () => {
  assert.equal(PROVIDERS.vsembed.name, 'Plasma');
  assert.equal(PROVIDERS.vsembed.rank, 'New');
  assert.equal(getProviderUrlFor('vsembed', 'movie', 550), 'https://vsembed.ru/embed/movie/550');
  assert.equal(getProviderUrlFor('vsembed', 'tv', 66732, 1, 1), 'https://vsembed.ru/embed/tv/66732/1/1');
});

test('exact playback checkpoints stay isolated per episode', () => {
  const contextOne = { id: '42', type: 'tv', season: 1, episode: 2 };
  const first = mergePlaybackCheckpoint({}, contextOne, {
    seconds: 413.7,
    durationSeconds: 2712.4,
    updatedAt: '2026-07-19T01:00:00.000Z'
  });
  const second = mergePlaybackCheckpoint(first, { ...contextOne, episode: 3 }, {
    seconds: 12.3,
    durationSeconds: 2630,
    updatedAt: '2026-07-19T02:00:00.000Z'
  });

  assert.equal(getSavedPlaybackSeconds(second, 'tv', 1, 2), 413.7);
  assert.equal(getSavedPlaybackDuration(second, 'tv', 1, 2), 2712.4);
  assert.equal(getSavedPlaybackSeconds(second, 'tv', 1, 3), 12.3);
  assert.equal(second.progress_seconds, 12);
});

test('movie checkpoints preserve sub-second local precision and reject short ad samples', () => {
  const movie = mergePlaybackCheckpoint({}, { id: '99', type: 'movie' }, {
    seconds: 3671.6,
    durationSeconds: 7200.2
  });
  assert.equal(getSavedPlaybackSeconds(movie, 'movie'), 3671.6);
  assert.equal(getSavedPlaybackDuration(movie, 'movie'), 7200.2);
  assert.equal(isPlausiblePlaybackSample({ seconds: 15, durationSeconds: 30 }), false);
  assert.equal(isPlausiblePlaybackSample({ seconds: 15, durationSeconds: 7200 }), true);
});

test('native child-frame bridge forwards controls and resumes the content video', () => {
  const listeners = {};
  const documentListeners = {};
  const messages = [];
  const videoListeners = {};
  let recoveryPlayCalls = 0;
  class MockHTMLElement {}
  MockHTMLElement.prototype.click = () => {};
  const parent = { postMessage: message => messages.push(message) };
  const video = {
    tagName: 'VIDEO',
    currentTime: 0,
    duration: 3600,
    paused: true,
    ended: false,
    readyState: 4,
    networkState: 1,
    buffered: {
      length: 1,
      start: () => 0,
      end: () => 360
    },
    error: null,
    videoWidth: 1920,
    videoHeight: 1080,
    addEventListener: (type, listener) => { videoListeners[type] = listener; },
    setAttribute: () => {},
    play: () => {
      recoveryPlayCalls += 1;
      return Promise.resolve();
    },
    getBoundingClientRect: () => ({ width: 1280, height: 720 }),
    querySelectorAll: () => []
  };
  const mockWindow = {
    top: {},
    parent,
    location: { href: 'https://player.videasy.net/tv/1/1/1' },
    open: () => null,
    addEventListener: (type, listener) => { listeners[type] = listener; },
    dispatchEvent: () => {}
  };
  const mockDocument = {
    addEventListener: (type, listener) => { documentListeners[type] = listener; },
    querySelectorAll: selector => selector === 'video' ? [video] : [],
    documentElement: {}
  };

  runInNewContext(
    readFileSync(new URL('../src-tauri/src/blocker_init.js', import.meta.url), 'utf8'),
    {
      window: mockWindow,
      document: mockDocument,
      HTMLElement: MockHTMLElement,
      URL,
      Date,
      CustomEvent: class {},
      MutationObserver: class { observe() {} }
    }
  );

  documentListeners.DOMContentLoaded();
  listeners.message({
    source: parent,
    data: {
      channel: '__opencloud_player_control_v1__',
      type: 'resume',
      seconds: 321.4,
      durationSeconds: 3600,
      sessionKey: 'movie:99'
    }
  });
  videoListeners.timeupdate();
  video.paused = false;
  videoListeners.waiting();
  listeners.message({
    source: parent,
    data: {
      channel: '__opencloud_player_control_v1__',
      type: 'recover',
      sessionKey: 'movie:99'
    }
  });

  let prevented = false;
  let stopped = false;
  listeners.keydown({
    key: 't',
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target: {},
    preventDefault: () => { prevented = true; },
    stopImmediatePropagation: () => { stopped = true; }
  });
  listeners.mousemove();

  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.equal(video.currentTime, 321.4);
  assert.ok(messages.some(message => message.type === 'resume-applied' && message.sessionKey === 'movie:99'));
  assert.ok(messages.some(message => message.type === 'playback-progress'
    && message.sessionKey === 'movie:99'
    && message.sample.seconds === 321.4
    && Math.abs(message.sample.bufferedAheadSeconds - 38.6) < 0.01));
  assert.ok(messages.some(message => message.type === 'playback-progress' && message.eventName === 'waiting'));
  assert.equal(recoveryPlayCalls, 1);
  assert.ok(messages.some(message => message.type === 'toggle-header'));
  assert.ok(messages.some(message => message.type === 'pointer-activity'));
});
