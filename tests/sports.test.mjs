import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  sportsUpstream, camelData, normalizeSportsMatches, filterSportsMatches,
  sportsStreams, sportsStreamName, sportsImage, authorizeSportsStream
} from '../js/sports-data.js';
import { createSportsPlayback } from '../js/sports-playback.js';

const rawUrl = 'https://liveplay1.camel4.live/live/sd-test.m3u8';
const token = { txSecret: 'a'.repeat(32), txTime: '6AC4B946' };
const match = (id, status = 2, extra = {}) => ({
  id, status_id: status, match_time: 1791271800,
  home_team: { name: 'Home', name_en: 'Home FC', logo: 'https://img.thesports.com/home.png' },
  away_team: { name: 'Away FC', logo: 'javascript:alert(1)' },
  home_scores: [0, 0, 0, 0, 0, 0], away_scores: [2, 1, 0, 0, 0, 0],
  coverage: { has_stream: 1 }, ...extra
});

function fixture() {
  return { living_group: [{ competition: { id: 'league', name: 'Example League' }, match: [match('live')] }],
    country_group: [{ competition_match: [{ competition: { id: 'league', name: 'Example League' },
      match: [match('live', 1), match('next', 1), match('final', 8), match('cancelled', 12)] }] }] };
}

test('sports API requests accept only three fixed read-only routes and valid parameters', () => {
  assert.equal(sportsUpstream('schedule', { date: '20261006' }).href,
    'https://api.cameltv.live/camel-service/ee/sports_live/home_match?day=20261006');
  assert.equal(sportsUpstream('streams', { matchId: 'match-1' }).searchParams.get('matchId'), 'match-1');
  assert.equal(sportsUpstream('token', { streamName: 'sd-test' }).searchParams.get('streamName'), 'sd-test');
  for (const date of ['20260230', '20261301', '../secret', '2026-10-06']) assert.equal(sportsUpstream('schedule', { date }), null);
  for (const id of ['', '../secret', 'https://127.0.0.1', 'name?token=evil', 'x'.repeat(81)]) {
    assert.equal(sportsUpstream('streams', { matchId: id }), null);
    assert.equal(sportsUpstream('token', { streamName: id }), null);
  }
  assert.equal(sportsUpstream('account', { matchId: 'valid' }), null);
});

test('grouped Camel fixtures flatten, deduplicate, preserve live data and safely display zero scores', () => {
  const matches = normalizeSportsMatches(fixture());
  assert.equal(matches.length, 4);
  const live = matches.find(item => item.id === 'live');
  assert.equal(live.live, true, 'stale duplicate does not overwrite the live group');
  assert.equal(live.home, 'Home FC'); assert.equal(live.homeScore, 0); assert.equal(live.awayScore, 2);
  assert.equal(live.competition, 'Example League'); assert.equal(live.awayLogo, '');
  assert.equal(live.watchable, true);
  assert.equal(matches.find(item => item.id === 'next').homeScore, null);
  assert.equal(matches.find(item => item.id === 'final').watchable, false);
  assert.equal(matches.find(item => item.id === 'cancelled').statusLabel, 'Cancelled');
  assert.deepEqual(normalizeSportsMatches({ living_group: [] }), []);
  assert.throws(() => normalizeSportsMatches({ unexpected: [] }));
  assert.throws(() => camelData({ status: 403, data: [] }));
});

test('team/league search and phase filters sort live matches before upcoming and results', () => {
  const matches = normalizeSportsMatches(fixture());
  assert.equal(filterSportsMatches(matches)[0].id, 'live');
  assert.deepEqual(filterSportsMatches(matches, { phase: 'live', query: 'example LEAGUE' }).map(m => m.id), ['live']);
  assert.deepEqual(filterSportsMatches(matches, { phase: 'results' }).map(m => m.id), ['final']);
  assert.deepEqual(filterSportsMatches(matches, { query: 'no such team' }), []);
});

test('streams and images reject spoofed hosts, credentials, ports, scripts and arbitrary destinations', () => {
  assert.equal(sportsImage('https://img.thesports.com/team.png'), 'https://img.thesports.com/team.png');
  const malicious = [
    'http://liveplay1.camel4.live/live/test.m3u8', 'https://camel4.live.evil.test/live/test.m3u8',
    'https://liveplay1.camel4.live:444/live/test.m3u8', 'https://user@liveplay1.camel4.live/live/test.m3u8',
    'https://127.0.0.1/live/test.m3u8', 'javascript:alert(1)', 'https://liveplay1.camel4.live/account'
  ];
  for (const url of malicious) assert.deepEqual(sportsStreams([{ streamUrl: url }]), []);
  assert.deepEqual(sportsStreams([{ streamUrlM3u8: rawUrl }, { streamUrl: rawUrl }]), [{ url: rawUrl, backup: false }]);
  assert.equal(sportsStreamName(rawUrl), 'sd-test');
  assert.throws(() => sportsStreamName(malicious[0]));
  assert.equal(sportsImage('https://img.thesports.com.evil.test/team.png'), '');
});

test('public Camel token envelopes are decoded locally and only server-issued tokens authorize playback', async () => {
  const key = Buffer.from('tVIVSag6HwBa2ixdiJhyoVGv2VhR/2ALR8zNrt+jjcU=', 'base64');
  const iv = Buffer.alloc(12, 7);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(token.txSecret, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  const wrapped = { txSecret: iv.toString('base64') + encrypted.toString('base64'), txTime: token.txTime };
  const result = new URL(await authorizeSportsStream(rawUrl, wrapped, webcrypto.subtle));
  assert.equal(result.searchParams.get('txSecret'), token.txSecret);
  assert.equal(result.searchParams.get('txTime'), token.txTime);
  await assert.rejects(authorizeSportsStream(rawUrl, { txSecret: 'garbage', txTime: token.txTime }, webcrypto.subtle));
  await assert.rejects(authorizeSportsStream('https://evil.test/live/test.m3u8', token, webcrypto.subtle));
});

function fakeVideo(native = true) {
  const events = new Map();
  return { src: '', plays: 0, pauses: 0, loads: 0,
    canPlayType: () => native ? 'probably' : '',
    pause() { this.pauses++; }, load() { this.loads++; },
    play() { this.plays++; return Promise.resolve(); }, removeAttribute() { this.src = ''; },
    addEventListener(name, fn) { events.set(name, fn); },
    removeEventListener(name, fn) { if (events.get(name) === fn) events.delete(name); },
    emit(name) { events.get(name)?.(); } };
}
const deferred = () => { let resolve; return { promise: new Promise(r => { resolve = r; }), resolve }; };

test('native HLS uses the system video decoder and releases it on tab exit', async () => {
  const video = fakeVideo(), states = [];
  const player = createSportsPlayback({ video, onState: (...state) => states.push(state),
    request: async () => token, loadHls: () => { throw new Error('HLS library must stay unloaded'); } });
  await player.start(rawUrl);
  assert.ok(video.src.includes('txSecret=')); assert.equal(video.plays, 1);
  video.emit('playing'); assert.equal(states.at(-1)[0], 'playing');
  player.stop(); assert.equal(video.src, ''); assert.ok(video.pauses >= 2);
});

test('closing or selecting another stream invalidates delayed authorization and HLS imports', async () => {
  const video = fakeVideo(), pending = deferred();
  const player = createSportsPlayback({ video, onState() {}, request: () => pending.promise });
  const first = player.start(rawUrl); player.stop(); pending.resolve(token); await first;
  assert.equal(video.src, ''); assert.equal(video.plays, 0);
  const mediaVideo = fakeVideo(false), importPending = deferred();
  let instantiated = 0;
  const other = createSportsPlayback({ video: mediaVideo, onState() {}, request: async () => token, loadHls: () => importPending.promise });
  const second = other.start(rawUrl);
  await new Promise(resolve => setImmediate(resolve)); other.stop();
  importPending.resolve({ default: class { static isSupported() { return true; } constructor() { instantiated++; } } });
  await second; assert.equal(instantiated, 0);
});

test('non-native playback loads local HLS lazily, without workers, and destroys its buffers', async () => {
  const video = fakeVideo(false), handlers = {}, options = [], instances = [];
  class Hls {
    static Events = { MANIFEST_PARSED: 'manifest', ERROR: 'error' };
    static isSupported() { return true; }
    constructor(config) { options.push(config); instances.push(this); }
    on(name, handler) { handlers[name] = handler; }
    loadSource(url) { this.url = url; }
    attachMedia(media) { this.media = media; }
    destroy() { this.destroyed = true; }
  }
  const player = createSportsPlayback({ video, onState() {}, request: async () => token, loadHls: async () => ({ default: Hls }) });
  await player.start(rawUrl);
  assert.equal(options[0].enableWorker, false);
  assert.equal(instances[0].media, video); assert.ok(instances[0].url.includes('txTime='));
  handlers.manifest(); assert.equal(video.plays, 1);
  player.stop(); assert.equal(instances[0].destroyed, true);
});

test('sports shell appears between Home and Collection, never embeds the Camel website', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('data-tab="home"') < html.indexOf('data-tab="sports"'));
  assert.ok(html.indexOf('data-tab="sports"') < html.indexOf('data-tab="collection"'));
  assert.ok(html.includes('id="sportsVideo"'));
  assert.ok(html.includes('<meta name="referrer" content="no-referrer">'));
  assert.ok(/<iframe id="playerFrame"[^>]*referrerpolicy="origin"/.test(html), 'movie iframe keeps its provider referrer');
  assert.ok(!/<iframe[^>]+camel/i.test(html));
  const sports = readFileSync(new URL('../js/sports.js', import.meta.url), 'utf8');
  assert.ok(!/innerHTML|window\.open|userHistory|saveWatchProgress|userCollection/.test(sports));
});
