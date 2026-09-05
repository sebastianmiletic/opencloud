import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function verifyUpdaterAssets(manifest, assetNames, readSignature) {
  const available = new Set(assetNames);
  let verified = 0;

  for (const [platform, entry] of Object.entries(manifest?.platforms ?? {})) {
    const asset = path.basename(new URL(entry.url).pathname);
    const signatureAsset = `${asset}.sig`;
    if (!available.has(asset)) throw new Error(`Updater asset is missing for ${platform}: ${asset}`);
    if (!available.has(signatureAsset)) throw new Error(`Updater signature is missing for ${platform}: ${signatureAsset}`);
    if (entry.signature.trim() !== readSignature(signatureAsset).trim()) {
      throw new Error(`Updater signature does not match its asset for ${platform}: ${asset}`);
    }
    verified += 1;
  }

  if (!verified) throw new Error('Updater manifest has no platform entries');
  return verified;
}

function main() {
  const [manifestPath, assetsPath, signatureDir] = process.argv.slice(2);
  if (!manifestPath || !assetsPath || !signatureDir) {
    throw new Error('Usage: verify-updater-assets <latest.json> <assets.json> <signature-directory>');
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const release = JSON.parse(fs.readFileSync(assetsPath, 'utf8'));
  const count = verifyUpdaterAssets(
    manifest,
    release.assets.map((asset) => asset.name),
    (name) => fs.readFileSync(path.join(signatureDir, name), 'utf8')
  );
  console.log(`Verified ${count} updater entries against their published assets and signatures`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
