import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function bridge() {
  const events = {}, documentEvents = {}, videoEvents = {}, messages = [];
  let now = 100000;
  const video = {
    tagName: 'VIDEO', currentTime: 0, duration: NaN, readyState: 0,
    networkState: 2, paused: true, ended: false, seeking: false,
    videoWidth: 0, videoHeight: 0, buffered: { length: 0 },
    seekable: { length: 0, start: () => 0, end: () => 3600 },
    getBoundingClientRect: () => ({ width: 1280, height: 720 }),
    addEventListener: (type, listener) => { videoEvents[type] = listener; }
  };
  const parent = { postMessage: message => messages.push(message) };
  runInNewContext(readFileSync(new URL('../src-tauri/src/blocker_init.js', import.meta.url), 'utf8'), {
    window: { top: {}, parent, location: { hostname: 'cinesrc.st' },
      addEventListener: (type, listener) => { events[type] = listener; }, open() {} },
    document: { querySelectorAll: type => type === 'video' ? [video] : [],
      addEventListener: (type, listener) => { documentEvents[type] = listener; }, documentElement: {} },
    HTMLElement: class { click() {} }, MutationObserver: class { observe() {} },
    Date: { now: () => now }, URL
  });
  documentEvents.DOMContentLoaded();
  events.message({ source: parent, data: { channel: '__opencloud_player_control_v1__',
    type: 'resume', sessionKey: 'movie:550', seconds: 900, durationSeconds: 3600 } });
  return { video, messages, videoEvents, advance: () => { now += 6000; } };
}

test('HLS resume waits for data and seekable range, then seeks only once', () => {
  const { video, videoEvents, messages } = bridge();
  video.duration = 3600;
  video.readyState = 1;
  videoEvents.loadedmetadata();
  assert.equal(video.currentTime, 0);
  video.readyState = 4;
  videoEvents.canplay();
  assert.equal(video.currentTime, 0, 'no seek until a seekable range exists');
  video.seekable.length = 1;
  videoEvents.progress();
  assert.equal(video.currentTime, 900);
  video.currentTime = 910;
  videoEvents.canplay();
  assert.equal(video.currentTime, 910, 'do not jump backwards on repeated canplay');
  assert.equal(messages.filter(m => m.type === 'resume-applied').length, 1);
});

test('manifest failures with unknown duration produce diagnostics, never checkpoints', () => {
  const { video, videoEvents, messages, advance } = bridge();
  video.error = { code: 2 };
  videoEvents.error();
  assert.ok(messages.some(m => m.type === 'media-startup' && m.sample.mediaErrorCode === 2));
  assert.ok(!messages.some(m => m.type === 'playback-progress'));
  advance();
  videoEvents.timeupdate();
  assert.equal(messages.filter(m => m.type === 'media-startup').length, 2);
});
