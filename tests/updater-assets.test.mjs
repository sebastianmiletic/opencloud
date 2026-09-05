import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyUpdaterAssets } from '../scripts/verify-updater-assets.mjs';

test('updater verification requires a published asset and its matching signature', () => {
  const manifest = {
    platforms: {
      'linux-aarch64': {
        url: 'https://github.com/owner/repo/releases/download/v1.0.0/App_aarch64.AppImage',
        signature: 'arm-signature'
      }
    }
  };
  const assets = ['App_aarch64.AppImage', 'App_aarch64.AppImage.sig'];
  assert.equal(verifyUpdaterAssets(manifest, assets, () => 'arm-signature'), 1);
  assert.throws(() => verifyUpdaterAssets(manifest, assets.slice(1), () => 'arm-signature'), /Updater asset is missing/);
  assert.throws(() => verifyUpdaterAssets(manifest, assets, () => 'wrong-signature'), /does not match/);
});
