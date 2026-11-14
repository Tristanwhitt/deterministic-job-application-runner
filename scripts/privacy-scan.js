'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const excluded = new Set(['node_modules', 'artifacts', '.git']);
const files = [];
const findings = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(target);
    else if (entry.isFile()) files.push(target);
  }
}

function report(file, label, match) {
  findings.push({
    file: path.relative(root, file),
    label,
    sample: String(match).slice(0, 80)
  });
}

walk(root);
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const checks = [
    ['home-directory path', new RegExp('/' + 'Users' + '/[^/\\s]+/', 'i')],
    ['private workspace marker', new RegExp(['workspace', 'main'].join('-'), 'i')],
    ['private runtime marker', new RegExp('\\.' + ['open', 'claw'].join(''), 'i')],
    ['email address', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
    ['phone number', /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/],
    ['social profile URL', /https?:\/\/(?:www\.)?linkedin\.com\/in\//i],
    ['credential assignment', /\b(?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*['"][^'"]+['"]/i],
    ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/]
  ];
  for (const [label, pattern] of checks) {
    const match = text.match(pattern);
    if (match) report(file, label, match[0]);
  }

  for (const match of text.matchAll(/https?:\/\/[^\s"'<>),]+/gi)) {
    const url = match[0];
    if (
      url.startsWith('https://registry.npmjs.org/') ||
      url.startsWith('https://github.com/sponsors/') ||
      url.startsWith('https://github.com/chalk/')
    ) continue;
    report(file, 'unexpected URL', url);
  }
}

if (findings.length) {
  console.error(JSON.stringify({ status: 'privacy_scan_failed', findings }, null, 2));
  process.exit(1);
}
console.log('privacy scan: ok (' + files.length + ' files)');
