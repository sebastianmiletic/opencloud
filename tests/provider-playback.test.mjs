import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as adapters from '../js/provider-playback.js';
import * as playback from '../js/playback-progress.js';
import * as merge from '../js/data-merge.js';

const frameWindow = {};
const movie = { id: '550', type: 'movie', season: null, episode: null };
const tv = { id: '1399', type: 'tv', season: 1, episode: 2 };
function message(providerKey, data, context = movie, overrides = {}, previous = {}) {
  const event = { origin: adapters.BROWSER_PLAYBACK[providerKey].origins[0], source: frameWindow, data, ...overrides };
  return adapters.parseProviderEvent(event, { providerKey, frameWindow, context }, previous);
}
const playerEvent = (currentTime = 321.4, extra = {}) => ({ type: 'PLAYER_EVENT',
  data: { event: 'timeupdate', currentTime, duration: 7200, tmdbId: '550', mediaType: 'movie', ...extra } });

test('documented PLAYER_EVENT objects and JSON strings normalize time without DOM access', () => {
  for (const key of ['ultra', 'vidlink', 'videasy']) {
    assert.deepEqual(message(key, JSON.stringify(playerEvent())), {
      kind: 'progress', eventName: 'timeupdate', sample: { seconds: 321.4, durationSeconds: 7200 }
    });
  }
  assert.equal(message('videasy', playerEvent(322, { id: '550', tmdbId: undefined })).sample.seconds, 322);
});

test('messages must come from the current iframe and the selected provider origin', () => {
  for (const overrides of [{ origin: 'https://attacker.test' }, { source: {} },
    { origin: 'https://vidphantom.com.attacker.test' }, { origin: 'http://vidphantom.com' },
    { origin: 'https://vidlink.pro' }]) {
    assert.equal(message('ultra', playerEvent(), movie, overrides), null);
  }
  assert.equal(adapters.parseProviderEvent({ source: frameWindow, origin: 'https://vsembed.ru', data: playerEvent() },
    { providerKey: 'vsembed', frameWindow, context: movie }), null);
});

test('mismatched titles, types and episodes cannot overwrite the active checkpoint', () => {
  for (const extra of [{ tmdbId: '551' }, { mediaType: 'tv' }, { tmdbId: undefined }, { mediaType: undefined }]) {
    assert.equal(message('ultra', playerEvent(321, extra)), null);
  }
  for (const extra of [{ season: 2, episode: 2 }, { season: 1, episode: 3 }, { season: 1 }]) {
    assert.equal(message('ultra', playerEvent(100, { tmdbId: '1399', mediaType: 'tv', ...extra }), tv), null);
  }
  assert.equal(message('ultra', playerEvent(100, { tmdbId: '1399', mediaType: 'tv', season: '1', episode: '2' }), tv).sample.seconds, 100);
});

test('malformed messages and short advertisements never become progress', () => {
  for (const data of ['invalid JSON', '[1,2]', null, {}, { type: 'OTHER', data: playerEvent().data },
    playerEvent(NaN), playerEvent(Infinity), playerEvent(-1), playerEvent(9000),
    playerEvent(null), playerEvent('321'), playerEvent(true), playerEvent(10, { duration: 30 }),
    playerEvent(10, { event: 'unknown' }), 'x'.repeat(65537)]) {
    assert.equal(message('ultra', data, movie, {}, { seconds: 123, durationSeconds: 7200 }), null);
  }
});

test('CineSrc normalizes events, metadata and getter replies with bounded cached state', () => {
  assert.deepEqual(message('platinum', { type: 'cinesrc:ready' }), { kind: 'ready' });
  assert.deepEqual(message('platinum', { type: 'cinesrc:loadedmetadata', duration: 7200 }),
    { kind: 'metadata', durationSeconds: 7200, mediaLoaded: true });
  const previous = { seconds: 499.5, durationSeconds: 7200 };
  for (const name of ['pause', 'ended', 'play']) {
    assert.equal(message('platinum', { type: `cinesrc:${name}` }, movie, {}, previous).sample.seconds, 499.5);
    assert.equal(message('platinum', { type: `cinesrc:${name}` }), null);
  }
  const result = message('platinum', { type: 'cinesrc:response', command: 'getCurrentTime', result: 500 }, movie, {}, previous);
  assert.equal(result.eventName, 'checkpoint');
  assert.equal(result.sample.seconds, 500);
  assert.equal(message('platinum', { type: 'cinesrc:response', command: 'getCurrentTime', result: null }), null);
  assert.equal(message('platinum', { type: 'cinesrc:timeupdate', currentTime: null, duration: 7200 }, movie, {}, previous), null);
  assert.equal(message('platinum', { type: 'cinesrc:timeupdate', currentTime: 100, duration: 60 }), null);
});

test('resume URLs use only verified provider parameters and preserve TV coordinates', () => {
  const cases = [
    ['platinum', 'https://cinesrc.st/embed/tv/1399?s=1&e=2', 't'],
    ['ultra', 'https://vidphantom.com/embed/tv/1399/1/2?autoplay=1', 'startAt'],
    ['vidlink', 'https://vidlink.pro/movie/550?title=true', 'startAt'],
    ['videasy', 'https://player.videasy.net/tv/1399/1/2', 'progress']
  ];
  for (const [key, input, param] of cases) {
    const result = new URL(adapters.withBrowserResume(input, key, 321.46));
    assert.equal(result.searchParams.get(param), '321.5');
    assert.equal(result.pathname, new URL(input).pathname);
    if (key === 'platinum') {
      assert.equal(result.searchParams.get('s'), '1');
      assert.equal(result.searchParams.get('e'), '2');
      assert.equal(result.searchParams.get('continueprompt'), 'false');
      assert.equal(result.searchParams.has('seek'), false); // seek is the button interval, not start time.
    }
    assert.equal(adapters.withBrowserResume(input, key, 0), input);
  }
  const unsupported = 'https://vsembed.ru/embed/movie/550';
  assert.equal(adapters.withBrowserResume(unsupported, 'vsembed', 321), unsupported);
  assert.equal(adapters.withBrowserResume(unsupported, 'platinum', 321), unsupported);
});

// Execute the actual storage and player persistence functions, with only network
// and UI dependencies stubbed. Test reloads use a new in-memory module instance.
const playerSource = readFileSync(new URL('../js/player.js', import.meta.url), 'utf8');
const storageSource = readFileSync(new URL('../js/storage.js', import.meta.url), 'utf8')
  .replace(/^import\s[\s\S]*?from\s+'[^']+';/gm, '').replace(/\bexport /g, '');
const segment = (start, end) => playerSource.slice(playerSource.indexOf(start), playerSource.indexOf(end, playerSource.indexOf(start)));

async function storageHarness(localStorage, userId, remote = {}) {
  const uploaded = [];
  const context = {
    console, localStorage, ...merge, ...playback,
    getCurrentAuthUser: () => ({ id: userId }),
    setUserCollection() {}, setUserHistory() {}, setWatchProgress() {}, setUserFolders() {},
    fetchCollection: async () => [], fetchWatchHistory: async () => [], fetchWatchProgress: async () => remote,
    fetchUserSettings: async () => null, fetchFolders: async () => [], fetchDataTombstones: async () => [],
    backupMyUserData: async () => {}, syncDataTombstones: async () => {}, syncCollection: async () => {},
    syncWatchHistory: async () => {}, syncSaveFolders: async () => {},
    syncSaveProgress: async (id, item) => { uploaded.push({ id, item }); }
  };
  runInNewContext(`${storageSource}\nthis.storage = { initStorage, getWatchProgress, saveWatchProgress, syncWatchProgressItem };`, context);
  await context.storage.initStorage();
  return { ...context.storage, uploaded };
}

function localHarness() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

function playerHarness(storage, state = movie, key = 'platinum') {
  const classes = new Set();
  const commands = [], callbacks = [], toasts = [];
  const frame = { contentWindow: {}, classList: { remove() {} }, src: '' };
  const context = {
    console, ...adapters, ...playback, URL, Date, Number, String, Object, Math,
    playerState: { ...state, tmdbData: { title: 'Series', 1: 10 } },
    playerFrame: frame, playerOverlay: { classList: { contains: x => classes.has(x),
      add: x => classes.add(x), remove: x => classes.delete(x) } },
    _browserProgress: {}, _currentProviderKey: key, _playerFrameSessionToken: 1, _providerSwitchToken: 1,
    _metadataRequestId: 1, _isPlayerFullscreen: false, _activePlaybackFrameId: null,
    _activePlaybackDuration: 0, _activePlaybackFrameSeenAt: 0, _sessionResumePoint: null,
    _lastPlaybackCheckpoint: null, _lastLocalCheckpointAt: 0, _lastCloudCheckpointAt: 0,
    _checkpointResolvers: [], _resumeConfirmationKey: null, _autoplayNextEpisode: false,
    _mediaStarted: false, _mediaStartupTimer: null, _playbackSignalsActive: false,
    LOCAL_CHECKPOINT_INTERVAL_MS: 10000, CLOUD_CHECKPOINT_INTERVAL_MS: 60000,
    _sessionStart: 0, _playerOpenedAt: 0, _pausedAt: null, _totalPausedMs: 0,
    _providerCandidates: [], _attemptedProviders: new Set(), _metadataFailed: false,
    isTauri: () => false, getCurrentProgress: storage.getWatchProgress,
    setCurrentProgress: storage.saveWatchProgress, syncWatchProgressItem: storage.syncWatchProgressItem,
    confirmPlayerFrameReady() {}, stopProviderHealthProbes() {}, clearTimeout() {},
    showToast: text => toasts.push(text), showNextEpisodePrompt: () => { context.prompted = true; },
    saveCurrentEpisodeElapsed: () => context.flushPlaybackCheckpoint(),
    setPlayerState: next => { context.playerState = { ...context.playerState, ...next }; },
    resetPlaybackMonitoring: () => { context._browserProgress = {}; },
    updatePlayerTitle() {}, configureNextButton() {}, persistProgress: async () => {},
    loadSeasonData: async () => {}, handleSeasonLoadFailure() {},
    closeProviderMenu() {}, setPlayerHeaderAutohide() {}, requestFreshPlaybackCheckpoint: async () => false,
    flushElapsedAndSave() {}, stopProgressInterval() {}, stopFrameMonitoring() {}, clearHealthTimer() {},
    recordCurrentSession() {}, detachWatchActivityListeners() {}, setPlayerHealth() {}, unlockScroll() {},
    document: { body: { classList: { remove() {} } } },
    window: { dispatchEvent() {}, addEventListener: (name, fn) => { callbacks[name] = fn; } },
    CustomEvent: class {}, setTimeout: fn => { callbacks.push(fn); },
    getProviderUrlFor: (provider, type, id, season, episode) => provider === 'platinum'
      ? `https://cinesrc.st/embed/${type}/${id}${type === 'tv' ? `?s=${season}&e=${episode}` : ''}`
      : `https://vidphantom.com/embed/${type}/${id}`
  };
  frame.contentWindow.postMessage = (data, origin) => commands.push({ data, origin });
  runInNewContext([
    segment('function currentPlaybackContext()', 'function requestProviderPlayback()'),
    segment('function formatPlaybackTime(', 'function handlePlayerFrameInput('),
    segment('function getPlayerSrc(', 'function preconnectProvider('),
    segment('export function closePlayer()', 'export async function openPlayer(').replace('export ', ''),
    "window.addEventListener('pagehide', () => { flushPlaybackCheckpoint(); });"
  ].join('\n'), context);
  return { context, frame, commands, classes, callbacks, toasts,
    send: data => context.handleBrowserProviderMessage({ data, source: frame.contentWindow,
      origin: adapters.BROWSER_PLAYBACK[key].origins[0] }) };
}

test('movie close and website pagehide preserve the latest sample, then a fresh session resumes it', async () => {
  for (const action of ['close', 'pagehide']) {
    const local = localHarness(), storage = await storageHarness(local, 'account-a');
    const h = playerHarness(storage);
    h.send({ type: 'cinesrc:timeupdate', currentTime: 123.4, duration: 7200 });
    h.send({ type: 'cinesrc:timeupdate', currentTime: 125.7, duration: 7200 });
    // A regular update within ten seconds is cached without rewriting storage.
    assert.equal(storage.getWatchProgress()['550'].playbackSeconds, 123.4);
    if (action === 'close') h.context.closePlayer();
    else h.callbacks.pagehide();
    assert.equal(JSON.parse(local.getItem('oc_user_account-a_progress'))['550'].playbackSeconds, 125.7);
    const reloaded = await storageHarness(local, 'account-a');
    const next = playerHarness(reloaded);
    const url = new URL(next.context.getPlayerSrc());
    assert.equal(url.searchParams.get('t'), '125.7');
    assert.equal(url.searchParams.get('continueprompt'), 'false');
    assert.ok(reloaded.uploaded.some(upload => upload.item.progress_seconds === 126));
    const otherAccount = await storageHarness(local, 'account-b');
    assert.equal(otherAccount.getWatchProgress()['550'], undefined);
  }
});

test('pause/seeked save immediately; individual episode checkpoints survive reopen', async () => {
  const local = localHarness(), storage = await storageHarness(local, 'account-a');
  const h = playerHarness(storage, tv, 'ultra');
  const data = (seconds, event = 'timeupdate') => playerEvent(seconds,
    { tmdbId: '1399', mediaType: 'tv', season: 1, episode: 2, event, duration: 3600 });
  h.send(data(600));
  h.send(data(1200, 'seeked'));
  h.send(data(1190, 'seeked')); // A deliberate backwards seek is not discarded.
  assert.equal(storage.getWatchProgress()['1399'].episodes.s1e2.playbackSeconds, 1190);
  h.send(data(1192, 'pause'));
  const reloaded = await storageHarness(local, 'account-a');
  assert.equal(reloaded.getWatchProgress()['1399'].episodes.s1e2.playbackSeconds, 1192);
  const next = playerHarness(reloaded, tv, 'platinum');
  assert.equal(new URL(next.context.getPlayerSrc()).searchParams.get('t'), '1192');
  next.context.playerState.episode = 3;
  assert.equal(new URL(next.context.getPlayerSrc()).searchParams.has('t'), false);
});

test('same-frame CineSrc episode navigation preserves the old episode and never reuses its time', async () => {
  const storage = await storageHarness(localHarness(), 'account-a');
  const h = playerHarness(storage, tv);
  h.send({ type: 'cinesrc:timeupdate', currentTime: 777, duration: 3600 });
  h.send({ type: 'cinesrc:nextepisode', season: 1, episode: 3, internalNavigation: true });
  assert.equal(h.context.playerState.episode, 3);
  h.send({ type: 'cinesrc:pause' });
  assert.equal(storage.getWatchProgress()['1399'].episodes.s1e3, undefined);
  h.send({ type: 'cinesrc:response', command: 'getDuration', result: 3600 });
  h.send({ type: 'cinesrc:timeupdate', currentTime: 777, duration: 3600 });
  assert.equal(storage.getWatchProgress()['1399'].episodes.s1e3, undefined);
  h.send({ type: 'cinesrc:loadedmetadata', duration: 3500 });
  h.send({ type: 'cinesrc:timeupdate', currentTime: 777, duration: 3500 });
  assert.deepEqual(Array.from(h.commands.at(-1).data.args), [0]);
  h.send({ type: 'cinesrc:timeupdate', currentTime: 1, duration: 3500 });
  assert.equal(storage.getWatchProgress()['1399'].episodes.s1e2.playbackSeconds, 777);
  assert.equal(storage.getWatchProgress()['1399'].episodes.s1e3.playbackSeconds, 1);
});

test('startup samples cannot overwrite a saved resume point; backwards seeks work after resume', async () => {
  const storage = await storageHarness(localHarness(), 'account-a');
  const h = playerHarness(storage);
  h.context._sessionResumePoint = { contextKey: 'movie:550', seconds: 500, durationSeconds: 7200, active: true };
  h.send({ type: 'cinesrc:timeupdate', currentTime: 0, duration: 7200 });
  assert.equal(storage.getWatchProgress()['550'], undefined);
  h.send({ type: 'cinesrc:timeupdate', currentTime: 500, duration: 7200 });
  assert.equal(h.context._sessionResumePoint.active, false);
  assert.equal(h.toasts.length, 1);
  h.send({ type: 'cinesrc:seeked', currentTime: 100, duration: 7200 });
  assert.equal(storage.getWatchProgress()['550'].playbackSeconds, 100);
  assert.equal(h.toasts.length, 1);
});

test('closed players and desktop-native bridge sessions ignore browser messages', async () => {
  const storage = await storageHarness(localHarness(), 'account-a');
  const h = playerHarness(storage);
  h.classes.add('hidden');
  h.send({ type: 'cinesrc:timeupdate', currentTime: 100, duration: 7200 });
  h.classes.delete('hidden');
  h.context.isTauri = () => true;
  h.send({ type: 'cinesrc:timeupdate', currentTime: 100, duration: 7200 });
  assert.equal(storage.getWatchProgress()['550'], undefined);
});
