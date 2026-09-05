import assert from 'node:assert/strict';
import test from 'node:test';
import { rewriteUpdaterManifest } from '../scripts/fix-updater-manifest.mjs';

test('release finalizer replaces GitHub API metadata URLs without changing signatures', () => {
  const manifest = {
    version: '3.5.0',
    platforms: {
      'darwin-universal': { signature: 'mac-signature', url: 'https://api.github.com/assets/1' },
      'windows-x86_64': { signature: 'win-signature', url: 'https://api.github.com/assets/2' },
      'linux-x86_64': { signature: 'linux-appimage-signature', url: 'https://api.github.com/assets/3' },
      'linux-x86_64-deb': { signature: 'linux-deb-signature', url: 'https://api.github.com/assets/4' }
    }
  };

  const result = rewriteUpdaterManifest(manifest, 'sebastianmiletic/opencloud', 'v3.5.0');
  assert.equal(
    result.platforms['darwin-universal'].url,
    'https://github.com/sebastianmiletic/opencloud/releases/download/v3.5.0/OpenCloud_3.5.0_universal.app.tar.gz'
  );
  assert.equal(
    result.platforms['windows-x86_64'].url,
    'https://github.com/sebastianmiletic/opencloud/releases/download/v3.5.0/OpenCloud_3.5.0_x64-setup.exe'
  );
  assert.equal(result.platforms['darwin-universal'].signature, 'mac-signature');
  assert.equal(result.platforms['windows-x86_64'].signature, 'win-signature');
  assert.equal(
    result.platforms['linux-x86_64'].url,
    'https://github.com/sebastianmiletic/opencloud/releases/download/v3.5.0/OpenCloud_3.5.0_amd64.AppImage'
  );
  assert.equal(result.platforms['linux-x86_64'].signature, 'linux-appimage-signature');
  assert.equal(
    result.platforms['linux-x86_64-deb'].url,
    'https://github.com/sebastianmiletic/opencloud/releases/download/v3.5.0/OpenCloud_3.5.0_amd64.deb'
  );
  assert.equal(result.platforms['linux-x86_64-deb'].signature, 'linux-deb-signature');
});

test('release finalizer refuses unsigned or unsupported updater entries', () => {
  assert.throws(
    () => rewriteUpdaterManifest({ version: '1.0.0', platforms: { 'linux-x86_64': { signature: '' } } }, 'owner/repo', 'v1.0.0'),
    /Missing signature/
  );
  assert.throws(
    () => rewriteUpdaterManifest({ version: '1.0.0', platforms: { freebsd: { signature: 'signed' } } }, 'owner/repo', 'v1.0.0'),
    /Unsupported updater platform/
  );
});
