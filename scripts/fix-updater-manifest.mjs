import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const REQUIRED_UPDATER_PLATFORMS = [
  'darwin-aarch64',
  'darwin-x86_64',
  'windows-aarch64',
  'windows-aarch64-nsis',
  'windows-x86_64',
  'windows-x86_64-nsis',
  'linux-aarch64',
  'linux-aarch64-appimage',
  'linux-aarch64-deb',
  'linux-x86_64',
  'linux-x86_64-appimage',
  'linux-x86_64-deb'
];

export function assertRequiredUpdaterPlatforms(manifest) {
  const missing = REQUIRED_UPDATER_PLATFORMS.filter((platform) => !manifest?.platforms?.[platform]);
  if (missing.length) throw new Error(`Updater manifest is missing required platforms: ${missing.join(', ')}`);
}

export function updaterPlatformAssets(version) {
  const mac = `OpenCloud_${version}_universal.app.tar.gz`;
  const windowsArm = `OpenCloud_${version}_arm64-setup.exe`;
  const windowsX64 = `OpenCloud_${version}_x64-setup.exe`;
  const linuxArmAppImage = `OpenCloud_${version}_aarch64.AppImage`;
  const linuxArmDeb = `OpenCloud_${version}_arm64.deb`;
  const linuxX64AppImage = `OpenCloud_${version}_amd64.AppImage`;
  const linuxX64Deb = `OpenCloud_${version}_amd64.deb`;
  return {
    'darwin-aarch64': mac,
    'darwin-aarch64-app': mac,
    'darwin-universal': mac,
    'darwin-universal-app': mac,
    'darwin-x86_64': mac,
    'darwin-x86_64-app': mac,
    'windows-aarch64': windowsArm,
    'windows-aarch64-nsis': windowsArm,
    'windows-x86_64': windowsX64,
    'windows-x86_64-nsis': windowsX64,
    'linux-aarch64': linuxArmAppImage,
    'linux-aarch64-appimage': linuxArmAppImage,
    'linux-aarch64-deb': linuxArmDeb,
    'linux-x86_64': linuxX64AppImage,
    'linux-x86_64-appimage': linuxX64AppImage,
    'linux-x86_64-deb': linuxX64Deb
  };
}

export function completeUpdaterManifest(manifest, readSignature) {
  if (!manifest?.version || typeof readSignature !== 'function') throw new Error('Manifest version and signature reader are required');
  manifest.platforms ||= {};
  for (const [platform, asset] of Object.entries(updaterPlatformAssets(manifest.version))) {
    manifest.platforms[platform] = {
      ...manifest.platforms[platform],
      signature: readSignature(`${asset}.sig`).trim(),
      url: manifest.platforms[platform]?.url || asset
    };
  }
  return manifest;
}

export function rewriteUpdaterManifest(manifest, repository, tag) {
  if (!manifest || typeof manifest !== 'object' || !manifest.version || !manifest.platforms) {
    throw new Error('Invalid updater manifest');
  }
  if (!repository || !tag) throw new Error('Repository and tag are required');

  const macAsset = `OpenCloud_${manifest.version}_universal.app.tar.gz`;
  const baseUrl = `https://github.com/${repository}/releases/download/${tag}`;

  for (const [platform, entry] of Object.entries(manifest.platforms)) {
    if (!entry?.signature) throw new Error(`Missing signature for ${platform}`);
    const isArm64 = platform.includes('-aarch64');
    const windowsAsset = `OpenCloud_${manifest.version}_${isArm64 ? 'arm64' : 'x64'}-setup.exe`;
    const linuxAppImageStem = `OpenCloud_${manifest.version}_${isArm64 ? 'aarch64' : 'amd64'}`;
    const linuxDebStem = `OpenCloud_${manifest.version}_${isArm64 ? 'arm64' : 'amd64'}`;
    if (platform.startsWith('darwin-')) entry.url = `${baseUrl}/${macAsset}`;
    else if (platform.startsWith('windows-')) entry.url = `${baseUrl}/${windowsAsset}`;
    else if (platform.startsWith('linux-') && platform.endsWith('-deb')) entry.url = `${baseUrl}/${linuxDebStem}.deb`;
    else if (platform.startsWith('linux-')) entry.url = `${baseUrl}/${linuxAppImageStem}.AppImage`;
    else throw new Error(`Unsupported updater platform: ${platform}`);
  }

  return manifest;
}

function main() {
  const [manifestPath, repository, tag, signatureDir] = process.argv.slice(2);
  if (!manifestPath) throw new Error('Usage: fix-updater-manifest <latest.json> <owner/repo> <tag> [signature-directory]');
  let manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (signatureDir) {
    manifest = completeUpdaterManifest(
      manifest,
      (name) => fs.readFileSync(path.join(signatureDir, name), 'utf8')
    );
  }
  const corrected = rewriteUpdaterManifest(manifest, repository, tag);
  assertRequiredUpdaterPlatforms(corrected);
  fs.writeFileSync(manifestPath, `${JSON.stringify(corrected, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
