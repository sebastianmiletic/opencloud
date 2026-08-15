import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getInstallationIdentity, isRecentlyOnline, validInstallationId } from '../js/dev-panel-policy.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const authSource = readFileSync(new URL('../js/auth.js', import.meta.url), 'utf8');
const devSource = readFileSync(new URL('../js/dev-panel.js', import.meta.url), 'utf8');
const settingsSource = readFileSync(new URL('../js/settings.js', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../supabase/migrations/202608140001_owner_dev_panel.sql', import.meta.url),
  'utf8'
);
const activityMigration = readFileSync(
  new URL('../supabase/migrations/202608150003_dev_activity_and_controls.sql', import.meta.url),
  'utf8'
);
const updaterSource = readFileSync(new URL('../js/updater.js', import.meta.url), 'utf8');

test('legacy client-side admin activation is removed', () => {
  assert.doesNotMatch(html, /activationKey|activateBtn|adminTabBtn/);
  assert.doesNotMatch(settingsSource, /1234|setAdmin|isAdmin|is_admin/);
  assert.doesNotMatch(authSource, /oc_is_admin|persistSession:\s*false|serverAdmin/);
  assert.match(authSource, /autoRefreshToken:\s*true/);
  assert.match(authSource, /persistSession:\s*true/);
});

test('Dev workspace is hidden by default and identifies its private data boundary', () => {
  assert.match(html, /class="dropdown-item hidden"[^>]*id="devPanelBtn"/);
  assert.match(html, /id="devView"[^>]*class="dev-view hidden"/);
  assert.match(html, /does not expose passwords, authentication tokens, IP addresses, or hardware fingerprints/);
  assert.match(html, /Owner-only analytics include app version, device layout/);
});

test('Dev user content is rendered through text nodes rather than HTML interpolation', () => {
  assert.doesNotMatch(devSource, /innerHTML\s*=/);
  assert.match(devSource, /element\.textContent = value/);
  assert.match(devSource, /user\.email/);
});

test('installation identity is random, stable, and contains only runtime metadata', () => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value))
  };
  globalThis.sessionStorage = {
    getItem: key => values.get(`session:${key}`) ?? null,
    setItem: (key, value) => values.set(`session:${key}`, String(value))
  };
  const env = { APP_VERSION: '3.5.0', APP_PLATFORM: 'macos', APP_ARCHITECTURE: 'aarch64' };
  const first = getInstallationIdentity(env);
  const second = getInstallationIdentity(env);
  assert.equal(first.installId, second.installId);
  assert.equal(validInstallationId(first.installId), true);
  assert.deepEqual(
    { appVersion: first.appVersion, platform: first.platform, architecture: first.architecture, deviceKind: first.deviceKind },
    { appVersion: '3.5.0', platform: 'macos', architecture: 'aarch64', deviceKind: 'laptop' }
  );
  assert.equal(first.sessionId, second.sessionId);
  assert.equal(validInstallationId(first.sessionId), true);
  assert.deepEqual(Object.keys(first).sort(), ['appVersion', 'architecture', 'deviceKind', 'installId', 'platform', 'sessionId']);
});

test('owner-only activity and separate controls remain behind restricted RPCs', () => {
  assert.match(activityMigration, /perform private\.assert_dev_owner\(\)/);
  assert.match(activityMigration, /dev_force_sign_out/);
  assert.match(activityMigration, /dev_suspend_user/);
  assert.match(activityMigration, /dev_ban_user/);
  assert.match(activityMigration, /dev_restore_user/);
  assert.match(activityMigration, /appActiveSeconds/);
  assert.match(activityMigration, /recentViewing/);
  assert.match(activityMigration, /recentSessions/);
  assert.doesNotMatch(activityMigration, /encrypted_password|last_sign_in_ip|raw_app_meta_data/);
});

test('desktop updater checks at launch and waits for explicit installation approval', () => {
  assert.match(updaterSource, /startLaunchCheck\(\)/);
  assert.match(updaterSource, /checkForUpdate\(\{ interactive: false \}\)/);
  assert.match(updaterSource, /addEventListener\('click', installUpdate\)/);
  assert.match(html, /id="updateModalLaterBtn">Later</);
});

test('online presence expires after two minutes', () => {
  const now = Date.parse('2026-08-14T00:02:00.000Z');
  assert.equal(isRecentlyOnline('2026-08-14T00:00:01.000Z', now), true);
  assert.equal(isRecentlyOnline('2026-08-13T23:59:59.000Z', now), false);
  assert.equal(isRecentlyOnline(null, now), false);
});

test('database boundary requires owner checks and protects suspended accounts', () => {
  assert.match(migration, /private\.assert_dev_owner\(\)/);
  assert.match(migration, /lower\(users\.email\) = owners\.expected_email/);
  assert.match(migration, /delete from auth\.sessions where user_id = p_user_id/);
  assert.match(migration, /auth\.uid\(\) = id and public\.account_is_active\(\)/);
  assert.match(migration, /auth\.uid\(\) = user_id and public\.account_is_active\(\)/);
  assert.match(migration, /revoke all on schema private from public, anon, authenticated/);
  assert.doesNotMatch(migration, /encrypted_password|last_sign_in_ip|raw_app_meta_data/);
  assert.doesNotMatch(migration, /sebastian\.miletic043@gmail\.com/i);
});
