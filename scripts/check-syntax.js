'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const excluded = new Set(['node_modules', 'artifacts', '.git']);
const files = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(target);
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(target);
  }
}

walk(root);
for (const file of files.sort()) {
  const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (checked.status !== 0) {
    process.stderr.write(checked.stderr);
    process.exit(1);
  }
}
console.log(`syntax checks: ok (${files.length} files)`);
