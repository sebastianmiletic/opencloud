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
import { getNextProviderCandidate, isCurrentFrameGeneration } from '../js/player-frame-lifecycle.js';

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

test('collection and history preserve complete posters on older Intel Mac WebKit', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.collection-grid \.grid-item \.item-poster::before,[\s\S]*?padding-top:\s*150%/);
  assert.match(css, /\.collection-grid \.grid-item \.item-poster img,[\s\S]*?\.history-grid \.grid-item \.item-poster img\s*\{[\s\S]*?position:\s*absolute[\s\S]*?inset:\s*0[\s\S]*?object-fit:\s*contain/);
  assert.match(css, /\.collection-grid \.grid-item:hover \.item-poster img,[\s\S]*?transform:\s*none/);
});

test('macOS builds use the framed multi-resolution app icon', () => {
  const config = readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8');
  const iconBuilder = readFileSync(new URL('../build/create-macos-icon.py', import.meta.url), 'utf8');
  const icns = readFileSync(new URL('../icon.icns', import.meta.url));
  assert.match(config, /\.\.\/icon\.icns/);
  assert.match(iconBuilder, /rounded_rectangle/);
  assert.match(iconBuilder, /target_width = 470/);
  assert.match(iconBuilder, /cloud_y = \(CANVAS_SIZE - target_height\) \/\/ 2/);
  assert.equal(icns.subarray(0, 4).toString('ascii'), 'icns');
});

test('Plasma becomes the default once for new and existing settings', async () => {
  const { getSettings } = await import('../js/config.js');
  localValues.clear();
  assert.equal(getSettings().provider, 'vsembed');
  assert.equal(getSettings().autoProviderFailover, false);

  localValues.set('openccloud_settings', JSON.stringify({
    _version: 6,
    provider: 'moviesapi',
    device: 'tv',
    autoPlay: false
  }));
  assert.deepEqual(
    { provider: getSettings().provider, device: getSettings().device, autoPlay: getSettings().autoPlay, autoProviderFailover: getSettings().autoProviderFailover },
    { provider: 'vsembed', device: 'tv', autoPlay: false, autoProviderFailover: false }
  );
  assert.equal(JSON.parse(localValues.get('openccloud_settings'))._version, 7);

  localValues.set('openccloud_settings', JSON.stringify({
    _version: 7,
    provider: 'vidlink',
    playerHeaderAutoHide: true
  }));
  assert.equal(getSettings().provider, 'vidlink');
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

test('player provider picker is accessible and checkpoints before switching sources', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const playerSource = readFileSync(new URL('../js/player.js', import.meta.url), 'utf8');
  assert.match(html, /id="playerHealth"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"/);
  assert.match(html, /id="playerProviderMenu"[^>]*role="menu"[^>]*aria-label="Choose playback provider"/);

  const switchStart = playerSource.indexOf('async function switchPlayerProvider(providerKey)');
  const checkpoint = playerSource.indexOf('await requestFreshPlaybackCheckpoint', switchStart);
  const providerChange = playerSource.indexOf('_currentProviderKey = providerKey', switchStart);
  const reload = playerSource.indexOf('loadPlayerIframe()', providerChange);
  assert.ok(switchStart >= 0);
  assert.ok(checkpoint > switchStart);
  assert.ok(providerChange > checkpoint);
  assert.ok(reload > providerChange);
});

test('rapid provider switches ignore stale iframe events and choose an untried fallback', () => {
  const oldFrame = {};
  const currentFrame = {};
  const current = {
    frame: currentFrame,
    sessionToken: 12,
    providerKey: 'delta',
    playerOpen: true
  };

  assert.equal(isCurrentFrameGeneration({
    frame: oldFrame,
    sessionToken: 11,
    providerKey: 'ultra'
  }, current), false);
  assert.equal(isCurrentFrameGeneration({
    frame: currentFrame,
    sessionToken: 12,
    providerKey: 'delta'
  }, current), true);
  assert.equal(isCurrentFrameGeneration({
    frame: currentFrame,
    sessionToken: 12,
    providerKey: 'delta'
  }, { ...current, playerOpen: false }), false);
  assert.equal(getNextProviderCandidate(['vsembed', 'delta', 'omega'], new Set(['vsembed', 'delta'])), 'omega');
  assert.equal(getNextProviderCandidate(['vsembed'], new Set(['vsembed'])), null);
});

test('player source transitions replace the iframe and expose loading and recovery states', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const playerSource = readFileSync(new URL('../js/player.js', import.meta.url), 'utf8');

  assert.match(html, /id="playerFrameStatus"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="playerFrameRetryBtn"/);
  assert.match(html, /id="playerFrameChooseBtn"/);
  assert.match(css, /\.player-frame-wrap iframe\s*\{[\s\S]*?opacity:\s*0/);
  assert.match(css, /\.player-frame-wrap iframe\.is-ready\s*\{[\s\S]*?opacity:\s*1/);
  assert.match(playerSource, /const nextFrame = document\.createElement\('iframe'\)/);
  assert.match(playerSource, /previousFrame\.replaceWith\(nextFrame\)/);
  assert.match(playerSource, /providerKey, sessionToken\);/);
});

test('Electron allows verified provider redirects only inside child frames', () => {
  const electronSource = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8');
  assert.match(electronSource, /'player\.videasy\.to'/);
  assert.match(electronSource, /will-navigate[\s\S]*?if \(!isAppUrl\(url\)\)[\s\S]*?event\.preventDefault\(\)/);
  assert.match(electronSource, /will-frame-navigate[\s\S]*?shouldAllowUrl\(details\.url\)/);
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

test('new providers expose working tags and exact movie and TV embed URLs', () => {
  const expected = {
    ultra: ['https://vidphantom.com/movie/666243', 'https://vidphantom.com/tv/94997/1/1'],
    delta: ['https://vidcore.org/embed/movie/666243', 'https://vidcore.org/embed/tv/94997/1/1'],
    omega: ['https://embedmaster.link/movie/666243', 'https://embedmaster.link/tv/94997/1/1']
  };

  for (const [key, [movieUrl, tvUrl]] of Object.entries(expected)) {
    assert.deepEqual(PROVIDERS[key].tags, ['New', 'Working']);
    assert.equal(getProviderUrlFor(key, 'movie', 666243), movieUrl);
    assert.equal(getProviderUrlFor(key, 'tv', 94997, 1, 1), tvUrl);
  }

  const providersMarkedNew = Object.entries(PROVIDERS)
    .filter(([, provider]) => provider.tags?.includes('New') || provider.rank === 'New')
    .map(([key]) => key);
  assert.deepEqual(providersMarkedNew, ['ultra', 'delta', 'omega']);
});

test('original provider names are preserved without character aliases', () => {
  assert.equal(PROVIDERS.videasy.name, 'Helix');
  assert.equal(PROVIDERS.moviesapi.name, 'Dossier');
  assert.equal(PROVIDERS.vidsrcme.name, 'Pulse');
  assert.equal(PROVIDERS.vidlink.name, 'Vertex');
  assert.equal(PROVIDERS.vixsrc.name, 'VixSrc');
  assert.equal(PROVIDERS.vidfast.name, 'VidFast');
  assert.equal(PROVIDERS.vsembed.rank, 'Default');

  const forbiddenAliases = new Set(['Rakan', 'Bard', 'Xayah', 'Ekko', 'Naafiri', 'Ryze']);
  assert.equal(Object.values(PROVIDERS).some(provider => forbiddenAliases.has(provider.name)), false);
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
