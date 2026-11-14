'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const markdown = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['node_modules', 'artifacts', '.git'].includes(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(target);
    else if (entry.isFile() && entry.name.endsWith('.md')) markdown.push(target);
  }
}

walk(root);
const missing = [];
for (const file of markdown) {
  const text = fs.readFileSync(file, 'utf8');
  const links = text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g);
  for (const match of links) {
    const raw = match[1].trim().replace(/^<|>$/g, '');
    if (!raw || raw.startsWith('#') || /^[a-z]+:/i.test(raw)) continue;
    const target = raw.split('#')[0];
    if (target && !fs.existsSync(path.resolve(path.dirname(file), target))) {
      missing.push(`${path.relative(root, file)} -> ${raw}`);
    }
  }
}

if (missing.length) {
  console.error(['Broken local Markdown links:', ...missing].join('\n'));
  process.exit(1);
}
console.log(`Markdown link checks: ok (${markdown.length} files)`);
