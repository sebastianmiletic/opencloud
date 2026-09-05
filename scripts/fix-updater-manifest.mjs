import fs from 'node:fs';
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
    const linuxStem = `OpenCloud_${manifest.version}_${isArm64 ? 'arm64' : 'amd64'}`;
    if (platform.startsWith('darwin-')) entry.url = `${baseUrl}/${macAsset}`;
    else if (platform.startsWith('windows-')) entry.url = `${baseUrl}/${windowsAsset}`;
    else if (platform.startsWith('linux-') && platform.endsWith('-deb')) entry.url = `${baseUrl}/${linuxStem}.deb`;
    else if (platform.startsWith('linux-')) entry.url = `${baseUrl}/${linuxStem}.AppImage`;
    else throw new Error(`Unsupported updater platform: ${platform}`);
  }

  return manifest;
}

function main() {
  const [manifestPath, repository, tag] = process.argv.slice(2);
  if (!manifestPath) throw new Error('Usage: fix-updater-manifest <latest.json> <owner/repo> <tag>');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const corrected = rewriteUpdaterManifest(manifest, repository, tag);
  assertRequiredUpdaterPlatforms(corrected);
  fs.writeFileSync(manifestPath, `${JSON.stringify(corrected, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
