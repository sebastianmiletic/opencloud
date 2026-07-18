import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveUpNextEpisode } from '../js/series.js';
import { connectionScoreForLatency } from '../js/player-health.js';

const localValues = new Map();
globalThis.localStorage = {
  getItem: key => localValues.get(key) ?? null,
  setItem: (key, value) => localValues.set(key, String(value))
};

test('Up Next resumes an episode below the completion threshold', () => {
  const show = { seasons: [{ season_number: 1, episode_count: 8 }] };
  assert.deepEqual(
    resolveUpNextEpisode(show, { season: 1, episode: 3, elapsedMinutes: 20, episodeRuntime: 45 }),
    { season: 1, episode: 3, advanced: false }
  );
});

test('Up Next advances completed episodes and crosses season boundaries', () => {
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

test('Up Next stays on the series finale instead of inventing an episode', () => {
  const show = { seasons: [{ season_number: 1, episode_count: 2 }] };
  assert.deepEqual(
    resolveUpNextEpisode(show, { season: 1, episode: 2, elapsedMinutes: 50, episodeRuntime: 50 }),
    { season: 1, episode: 2, advanced: false }
  );
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
    { provider: getSettings().provider, device: getSettings().device, autoPlay: getSettings().autoPlay, autoProviderFailover: getSettings().autoProviderFailover, theme: getSettings().theme, roundedUI: getSettings().roundedUI },
    { provider: 'moviesapi', device: 'tv', autoPlay: false, autoProviderFailover: false, theme: 'noir', roundedUI: false }
  );
});

test('provider health maps reachability and latency onto five honest levels', () => {
  assert.equal(connectionScoreForLatency(180, 200, true), 5);
  assert.equal(connectionScoreForLatency(620, 200, true), 4);
  assert.equal(connectionScoreForLatency(1300, 200, true), 3);
  assert.equal(connectionScoreForLatency(2600, 200, true), 2);
  assert.equal(connectionScoreForLatency(500, 503, true), 1);
  assert.equal(connectionScoreForLatency(100, 200, false), 1);
});
