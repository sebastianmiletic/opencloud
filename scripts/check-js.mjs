import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const directories = ['js', 'electron'];
const files = ['sw.js'];

for (const directory of directories) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.js')) files.push(`${directory}/${entry.name}`);
  }
}

let failed = false;
for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) failed = true;
}

if (failed) process.exit(1);
console.log(`JavaScript syntax OK (${files.length} files)`);
