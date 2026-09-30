import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const player = readFileSync(new URL('../js/player.js', import.meta.url), 'utf8');
const blocker = readFileSync(new URL('../src-tauri/src/blocker_init.js', import.meta.url), 'utf8');
const auth = readFileSync(new URL('../js/auth.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

test('episode completion exposes a bottom-right Up next action and honors autoplay setting', () => {
  assert.match(html, /id="playerUpNext"[\s\S]*?id="playerUpNextPlay"/);
  assert.match(css, /\.player-up-next\s*\{[\s\S]*?right:[\s\S]*?bottom:/);
  assert.match(player, /detail\.eventName === 'ended'\) showNextEpisodePrompt\(\)/);
  assert.match(player, /getSettings\(\)\.autoPlay !== false/);
  assert.match(player, /switchEpisode\(target\.season, target\.episode, '', \{ autoplay: true \}\)/);
  assert.match(player, /url\.searchParams\.set\('autoplay', '1'\)/);
  assert.match(blocker, /data\.type === 'play'[\s\S]*?video\.play/);
});

test('web sessions use persistent first-party browser storage across Render restarts', () => {
  assert.match(auth, /persistSession:\s*true/);
  assert.match(auth, /storage:\s*window\.localStorage/);
  assert.match(auth, /autoRefreshToken:\s*true/);
  assert.match(readme, /https:\/\/opencloud-web\.onrender\.com\//);
});
