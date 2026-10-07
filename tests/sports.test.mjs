import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  sportsUpstream, camelData, normalizeSportsMatches, filterSportsMatches,
  sportsStreams, sportsStreamName, sportsStreamLabel, sportsImage, authorizeSportsStream, isMainFootballMatch
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
    country_group: [{ country: { name: 'England' }, competition_match: [{ competition: { id: 'league', name: 'Example League' },
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
  assert.equal(live.competition, 'Example League'); assert.equal(live.country, 'England'); assert.equal(live.awayLogo, '');
  assert.equal(live.watchable, true);
  assert.equal(matches.find(item => item.id === 'next').homeScore, null);
  assert.equal(matches.find(item => item.id === 'final').watchable, false);
  assert.equal(matches.find(item => item.id === 'cancelled').statusLabel, 'Cancelled');
  assert.deepEqual(normalizeSportsMatches({ living_group: [] }), []);
  assert.throws(() => normalizeSportsMatches({ unexpected: [] }));
  assert.throws(() => camelData({ status: 403, data: [] }));
});

test('team, country-vs-country, league, and phase searches sort live matches first', () => {
  const matches = normalizeSportsMatches(fixture());
  assert.equal(filterSportsMatches(matches)[0].id, 'live');
  assert.deepEqual(filterSportsMatches(matches, { phase: 'live', query: 'example LEAGUE' }).map(m => m.id), ['live']);
  assert.deepEqual(filterSportsMatches(matches, { phase: 'live', query: 'Home FC vs Away FC' }).map(m => m.id), ['live']);
  assert.deepEqual(filterSportsMatches(matches, { phase: 'live', query: 'away versus home' }).map(m => m.id), ['live']);
  assert.deepEqual(filterSportsMatches(matches, { phase: 'live', query: 'England' }).map(m => m.id), ['live']);
  assert.deepEqual(filterSportsMatches(matches, { phase: 'results' }).map(m => m.id), ['final']);
  assert.deepEqual(filterSportsMatches(matches, { query: 'no such team' }), []);
  assert.deepEqual(filterSportsMatches(matches, { query: 'vs' }), [], 'a separator alone is not a match-all query');
  const countries = [{ ...matches[0], id: 'countries', home: 'South Korea', away: 'Uzbekistan' }];
  assert.deepEqual(filterSportsMatches(countries, { query: 'South Korea vs Uzbekistan' }).map(m => m.id), ['countries']);
  assert.deepEqual(filterSportsMatches(countries, { query: 'Uzbekistan' }).map(m => m.id), ['countries']);
  const scoreOnly = { ...matches[0], id: 'earlier-score-only', watchable: false, startTime: 0 };
  assert.equal(filterSportsMatches([scoreOnly, ...matches])[0].id, 'live', 'available live video comes before score-only matches');
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
  return { src: '', plays: 0, pauses: 0, loads: 0, paused: true, ended: false, currentTime: 0, readyState: 4,
    canPlayType: () => native ? 'probably' : '',
    pause() { this.pauses++; this.paused = true; }, load() { this.loads++; },
    play() { this.plays++; this.paused = false; return Promise.resolve(); }, removeAttribute() { this.src = ''; },
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

test('only recognized main senior competitions pass, including senior teams in mixed friendly feeds', () => {
  const senior = { home: 'England', away: 'France', competition: 'UEFA Nations League' };
  assert.equal(isMainFootballMatch(senior), true);
  for (const competition of ['English Premier League', 'Spanish La Liga', 'UEFA Champions League', 'FIFA World Cup qualification (AFC)',
    'International Friendly', 'Turkish Cup', 'Categoría Primera A', 'FIFA Women\'s World Cup']) {
    assert.equal(isMainFootballMatch({ ...senior, competition }), true, competition);
  }
  for (const name of ['England U21', 'France U-23', 'Spain Under 19', 'Belgium Under-17s', 'Japan U9', 'Germany Juniors', 'Youth FC', 'Paris Reserves', 'Ajax II', 'Benfica B']) {
    assert.equal(isMainFootballMatch({ ...senior, home: name }), false, name);
    assert.equal(isMainFootballMatch({ ...senior, away: name }), false, name);
  }
  for (const competition of ['Portuguese U23 League', 'UEFA European U21 Championship qualification', 'English Premier League 2',
    'Brazilian Youth Championship', 'Paraguayan Reserve League', 'Indian Calcutta Football League', 'English Northern Premier League']) {
    assert.equal(isMainFootballMatch({ ...senior, competition }), false, competition);
  }
  for (const home of ['Boca Juniors', 'Argentinos Juniors', 'Junior Barranquilla']) {
    assert.equal(isMainFootballMatch({ ...senior, competition: 'Argentine Division 1', home }), true, 'senior club names are not age labels');
  }
  assert.equal(isMainFootballMatch({ ...senior, home: '' }), false);
});

test('missing scores and names stay missing, and custom/blocked/ended feeds are not advertised as playable', () => {
  const data = { living_group: [{ competition: { id: 'league', name: 'UEFA Nations League' }, match: [
    match('missing', 2, { home_scores: [null], away_scores: [''] }),
    match('false-score', 2, { home_scores: [false], away_scores: [-1] }),
    match('fraction', 2, { home_scores: [1.5], away_scores: [2] }),
    match('next-custom', 1, { has_custom_stream: 1 }),
    match('ended-custom', 8, { has_custom_stream: 1 }),
    match('blocked', 2, { is_blocked: 1 }),
    match('unnamed', 2, { home_team: {} }),
    match('no-time', 2, { match_time: null }),
    match('postponed-score', 9)
  ] }] };
  const matches = normalizeSportsMatches(data), find = id => matches.find(item => item.id === id);
  assert.equal(find('missing').homeScore, null); assert.equal(find('missing').awayScore, null);
  assert.equal(find('false-score').homeScore, null); assert.equal(find('false-score').awayScore, null);
  assert.equal(find('fraction').homeScore, null);
  for (const id of ['next-custom', 'ended-custom', 'blocked']) assert.equal(find(id).watchable, false);
  assert.equal(find('unnamed'), undefined);
  assert.ok(Number.isNaN(find('no-time').startTime));
  assert.equal(find('postponed-score').homeScore, null);
});

test('source ordering prefers real HD/English metadata, with backups last and no duplicate streams', () => {
  const hd = 'https://liveplay1.camel4.live/live/hd-en-match.m3u8';
  const streams = sportsStreams([{ streamUrl: rawUrl }, { streamUrl: hd }, { streamUrl: hd },
    { streamUrl: 'https://liveplay1.camel4.live/live/hd-other.m3u8', isBackup: 1 }]);
  assert.equal(streams[0].url, hd); assert.equal(streams.length, 3);
  assert.equal(sportsStreamLabel(streams[0], 0), 'HD · Source 1');
  assert.equal(sportsStreamLabel(streams[2], 2), 'HD · Source 3 · Backup');
});

function fakeClock(initial = Date.now()) {
  let time = initial, id = 0;
  const tasks = new Map();
  return { now: () => time,
    setTimeout(fn, delay) { const key = ++id; tasks.set(key, { fn, at: time + delay, interval: 0 }); return key; },
    clearTimeout(key) { tasks.delete(key); },
    setInterval(fn, delay) { const key = ++id; tasks.set(key, { fn, at: time + delay, interval: delay }); return key; },
    clearInterval(key) { tasks.delete(key); },
    advance(delay) {
      time += delay;
      for (const [key, task] of [...tasks]) if (task.at <= time) {
        if (task.interval) task.at = time + task.interval; else tasks.delete(key);
        task.fn();
      }
    }, size: () => tasks.size };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 10));

test('a failing video source automatically falls back to another real allowlisted source', async () => {
  const video = fakeVideo(), states = [], chosen = [];
  const second = 'https://liveplay1.camel4.live/live/hd-en-second.m3u8';
  const player = createSportsPlayback({ video, onState: (...s) => states.push(s), onSourceChange: i => chosen.push(i), request: async () => token });
  await player.start([rawUrl, second]);
  video.emit('error'); await settle();
  assert.ok(video.src.includes('/hd-en-second.m3u8?')); assert.deepEqual(chosen, [0, 1]);
  video.emit('playing'); assert.equal(states.at(-1)[0], 'playing');
  video.emit('error'); await settle();
  assert.equal(states.at(-1)[0], 'error'); assert.equal(video.src, '');
  player.stop();
});

test('a hanging authorization is bounded, falls back, and cannot later replace the working source', async () => {
  const clock = fakeClock(), video = fakeVideo(), pending = deferred(), chosen = [];
  let requests = 0;
  const player = createSportsPlayback({ video, timers: clock, now: clock.now, onState() {}, onSourceChange: i => chosen.push(i),
    request: () => ++requests === 1 ? pending.promise : Promise.resolve(token) });
  const loading = player.start([rawUrl, 'https://liveplay1.camel4.live/live/second.m3u8']);
  clock.advance(26000); await settle();
  assert.deepEqual(chosen, [0, 1]); assert.ok(video.src.includes('/second.m3u8?'));
  pending.resolve(token); await loading;
  assert.ok(video.src.includes('/second.m3u8?'));
  player.stop(); assert.equal(clock.size(), 0);
});

test('expired authorization reconnects before expiry, preserves pause, and cleans every timer on exit', async () => {
  const clock = fakeClock(), video = fakeVideo(); let requests = 0;
  const player = createSportsPlayback({ video, timers: clock, now: clock.now, onState() {}, request: async () => {
    requests++; return { ...token, txTime: Math.floor((clock.now() + 90000) / 1000).toString(16) };
  } });
  await player.start(rawUrl); video.emit('playing');
  video.currentTime = 60; clock.advance(61000); await settle();
  assert.equal(requests, 2, 'renews while playing');
  video.emit('playing'); video.pause(); video.emit('pause');
  clock.advance(61000); await settle();
  assert.equal(requests, 2, 'a deliberately paused stream does not resume itself');
  await player.play(); assert.equal(requests, 3, 'resume obtains fresh authorization');
  player.stop(); assert.equal(clock.size(), 0);
});

test('a frozen playing feed is detected from actual time progression and switches source', async () => {
  const clock = fakeClock(), video = fakeVideo(), chosen = [];
  const player = createSportsPlayback({ video, timers: clock, now: clock.now, onState() {}, onSourceChange: i => chosen.push(i), request: async () => token });
  await player.start([rawUrl, 'https://liveplay1.camel4.live/live/second.m3u8']);
  video.emit('playing'); clock.advance(16000); await settle();
  assert.deepEqual(chosen, [0, 1]);
  player.stop(); assert.equal(clock.size(), 0);
});

test('blocked autoplay exposes a paused state and explicit play resumes without refetching', async () => {
  const video = fakeVideo(), states = []; let requests = 0;
  video.play = () => Promise.reject(new Error('Autoplay blocked'));
  const player = createSportsPlayback({ video, onState: (...s) => states.push(s), request: async () => { requests++; return token; } });
  await player.start(rawUrl); await settle();
  assert.equal(states.at(-1)[0], 'paused');
  video.play = () => { video.paused = false; video.emit('playing'); return Promise.resolve(); };
  await player.play(); assert.equal(states.at(-1)[0], 'playing'); assert.equal(requests, 1);
  player.stop();
});

function fakeHls(instances) {
  return class {
    static Events = { MANIFEST_PARSED: 'manifest', ERROR: 'error' };
    static ErrorTypes = { MEDIA_ERROR: 'media', NETWORK_ERROR: 'network' };
    static isSupported() { return true; }
    constructor() { this.handlers = {}; instances.push(this); }
    on(name, handler) { this.handlers[name] = handler; }
    loadSource(url) { this.url = url; }
    attachMedia(video) { this.video = video; }
    recoverMediaError() { this.recovered = true; this.video.pause(); this.video.emit('pause'); this.handlers.manifest(); }
    destroy() { this.destroyed = true; }
  };
}

test('HLS media recovery does not mistake an internal pause for a user pause and is bounded', async () => {
  const video = fakeVideo(false), instances = [], states = [];
  const player = createSportsPlayback({ video, onState: (...s) => states.push(s), request: async () => token, loadHls: async () => ({ default: fakeHls(instances) }) });
  await player.start([rawUrl, 'https://liveplay1.camel4.live/live/second.m3u8']);
  instances[0].handlers.manifest(); video.emit('playing');
  instances[0].handlers.error(null, { fatal: true, type: 'media' });
  assert.equal(instances[0].recovered, true); assert.equal(video.paused, false);
  assert.ok(!states.some(([state]) => state === 'paused'));
  instances[0].handlers.error(null, { fatal: true, type: 'media' }); await settle();
  assert.equal(instances.length, 2); assert.equal(instances[0].destroyed, true);
  player.stop();
});

test('HLS token rejection renews once before fallback, and destroyed-engine events cannot revive playback', async () => {
  const video = fakeVideo(false), instances = [], chosen = []; let requests = 0;
  const player = createSportsPlayback({ video, onState() {}, onSourceChange: i => chosen.push(i), request: async () => { requests++; return token; },
    loadHls: async () => ({ default: fakeHls(instances) }) });
  await player.start([rawUrl, 'https://liveplay1.camel4.live/live/second.m3u8']);
  instances[0].handlers.error(null, { fatal: true, type: 'network', response: { code: 403 } }); await settle();
  assert.equal(requests, 2); assert.deepEqual(chosen, [0, 0]);
  instances[1].handlers.error(null, { fatal: true, type: 'network', response: { code: 403 } }); await settle();
  assert.equal(requests, 3); assert.deepEqual(chosen, [0, 0, 1]);
  player.stop();
  instances[2].handlers.error(null, { fatal: true, type: 'network', response: { code: 403 } }); await settle();
  assert.equal(requests, 3); assert.equal(video.src, '');
});

test('Live Games sits below Continue Watching with no Sports tab or Camel website embed', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(!html.includes('data-tab="sports"'));
  assert.ok(html.indexOf('id="continueWatchingSection"') < html.indexOf('id="liveGamesSection"'));
  assert.ok(html.indexOf('id="liveGamesSection"') < html.indexOf('id="starWarsSection"'));
  assert.ok(html.includes('id="liveGamesLive"'));
  assert.ok(html.includes('id="liveGamesUpcoming"'));
  assert.ok(html.includes('id="gameSearchSection"'));
  assert.ok(html.includes('id="sportsVideo"'));
  assert.ok(html.includes('<meta name="referrer" content="no-referrer">'));
  assert.ok(/<iframe id="playerFrame"[^>]*referrerpolicy="origin"/.test(html), 'movie iframe keeps its provider referrer');
  assert.ok(!/<iframe[^>]+camel/i.test(html));
  const sports = readFileSync(new URL('../js/sports.js', import.meta.url), 'utf8');
  const ui = readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
  assert.ok(/export async function searchLiveGames/.test(sports));
  assert.match(ui, /initLiveGames, openLiveGame, searchLiveGames/);
  assert.ok(!/sportsView|data-tab=["']sports/.test(ui));
  assert.ok(!/innerHTML|window\.open|userHistory|saveWatchProgress|userCollection/.test(sports));
});
