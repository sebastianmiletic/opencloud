import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const failures = [];

if (tracked.includes('.env')) failures.push('.env is tracked');

const shippedSources = tracked.filter(path =>
  /^(js|electron|src-tauri)\//.test(path) || ['index.html', 'vite.config.js', 'package.json'].includes(path)
);
const elevatedPatterns = [
  /sb_secret_[A-Za-z0-9_-]+/,
  /SUPABASE_(?:SERVICE_ROLE|SECRET)_KEY/,
  /service_role\s*[:=]\s*['"][A-Za-z0-9._-]+/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
];

for (const path of shippedSources) {
  const source = readFileSync(path, 'utf8');
  if (elevatedPatterns.some(pattern => pattern.test(source))) {
    failures.push(`elevated credential material found in shipped source: ${path}`);
  }
}

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
if (JSON.stringify(packageJson.build?.extraResources || []).includes('.env')) {
  failures.push('Electron packaging includes .env');
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Secret-boundary checks passed');
