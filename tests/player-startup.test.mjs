import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const player = readFileSync(new URL('../js/player.js', import.meta.url), 'utf8');

test('early readiness exposes the current frame once, without waiting for iframe load', () => {
  const start = player.indexOf('function confirmPlayerFrameReady(');
  const end = player.indexOf('\nfunction providerName(', start);
  const context = { performance: { now: () => 100 } };
  runInNewContext(`
    let _frameNavigationLoaded = false, _frameReady = false;
    let _playerFrameSessionToken = 2, _currentProviderKey = 'test';
    let _frameLoadStartedAt = 0, _lastFrameScore = 1, _providerProbeFailures = 0;
    let _playbackSignalsActive = false, _playbackBufferingSince = 0;
    const playerOverlay = { classList: { contains: () => false } };
    let shown = 0, resumed = 0, probes = 0;
    const clearHealthTimer = () => {};
    const showPlayerFrameReady = () => { shown++; };
    const adjustScoreForConnection = x => x;
    const connectionScoreForLatency = () => 5;
    const setPlayerHealth = () => {};
    const providerName = x => x;
    const healthQuality = () => 'Good';
    const startProviderHealthProbes = () => { probes++; };
    const scheduleResumeAttempts = () => { resumed++; };
    ${player.slice(start, end)}
    this.stale = confirmPlayerFrameReady('test', 1);
    this.early = confirmPlayerFrameReady('test', 2);
    confirmPlayerFrameReady('test', 2);
    confirmPlayerFrameReady('test', 2);
    this.counts = [shown, resumed, probes];
  `, context);
  assert.equal(context.stale, false);
  assert.equal(context.early, true);
  assert.deepEqual(Array.from(context.counts), [1, 1, 1]);
});

test('provider inline Play/server controls are allowed while new-tab links stay blocked', () => {
  const handlers = {};
  const parent = { postMessage() {} };
  const context = {
    window: { top: {}, parent, location: { href: 'https://example.test/player' },
      addEventListener() {}, open() {} },
    document: { addEventListener: (type, fn) => { handlers[type] = fn; } },
    HTMLElement: class { click() {} }, URL, Date
  };
  runInNewContext(readFileSync(new URL('../src-tauri/src/blocker_init.js', import.meta.url), 'utf8'), context);
  let blocked = 0;
  const click = target => handlers.click({
    target: { closest: selector => selector === 'a,area' ? {
      href: 'javascript:void(0)', getAttribute: () => target
    } : null },
    preventDefault: () => { blocked++; }, stopImmediatePropagation() {}
  });
  click('');
  assert.equal(blocked, 0);
  click('_blank');
  assert.equal(blocked, 1);
});
