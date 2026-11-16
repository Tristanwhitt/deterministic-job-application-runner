'use strict';

const fs = require('fs');
const path = require('path');

const REPOSITORY_ROOT = path.resolve(__dirname, '..');

function copyIfMissing(source, destination) {
  if (fs.existsSync(destination)) return false;
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  return true;
}

function setup(root = REPOSITORY_ROOT) {
  const directories = [
    'private/resumes',
    'private/manifests',
    'artifacts/logs',
    'artifacts/proofs'
  ];
  for (const directory of directories) {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
  }

  const copies = [
    ['templates/approvals.template.json', 'private/approvals.json'],
    ['templates/inspect-manifest.template.json', 'private/manifests/inspect-manifest.template.json']
  ].map(([source, destination]) => ({
    destination,
    created: copyIfMissing(path.join(root, source), path.join(root, destination))
  }));

  return { directories, copies };
}

function main() {
  const result = setup();
  console.log('Application runner local storage is ready.');
  for (const copy of result.copies) {
    console.log(`${copy.created ? 'created' : 'preserved'}: ${copy.destination}`);
  }
  console.log('Next: add a PDF under private/resumes/, review private/approvals.json, then run npm run doctor.');
}

if (require.main === module) main();

module.exports = { setup };
