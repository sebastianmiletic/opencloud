import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export function rewriteUpdaterManifest(manifest, repository, tag) {
  if (!manifest || typeof manifest !== 'object' || !manifest.version || !manifest.platforms) {
    throw new Error('Invalid updater manifest');
  }
  if (!repository || !tag) throw new Error('Repository and tag are required');

  const macAsset = `OpenCloud_${manifest.version}_universal.app.tar.gz`;
  const windowsAsset = `OpenCloud_${manifest.version}_x64-setup.exe`;
  const linuxAsset = `OpenCloud_${manifest.version}_amd64.AppImage`;
  const baseUrl = `https://github.com/${repository}/releases/download/${tag}`;

  for (const [platform, entry] of Object.entries(manifest.platforms)) {
    if (!entry?.signature) throw new Error(`Missing signature for ${platform}`);
    if (platform.startsWith('darwin-')) entry.url = `${baseUrl}/${macAsset}`;
    else if (platform.startsWith('windows-')) entry.url = `${baseUrl}/${windowsAsset}`;
    else if (platform.startsWith('linux-')) entry.url = `${baseUrl}/${linuxAsset}`;
    else throw new Error(`Unsupported updater platform: ${platform}`);
  }

  return manifest;
}

function main() {
  const [manifestPath, repository, tag] = process.argv.slice(2);
  if (!manifestPath) throw new Error('Usage: fix-updater-manifest <latest.json> <owner/repo> <tag>');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const corrected = rewriteUpdaterManifest(manifest, repository, tag);
  fs.writeFileSync(manifestPath, `${JSON.stringify(corrected, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
