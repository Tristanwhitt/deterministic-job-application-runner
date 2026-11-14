'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const runner = path.join(root, 'runner.js');
const fixtures = path.join(root, 'fixtures');
const environment = {
  ...process.env,
  APPLICATION_RUNNER_RESUME_DIR: 'fixtures/resumes',
  APPLICATION_RUNNER_APPROVALS_FILE: 'fixtures/synthetic-approvals.json'
};

function execute(manifest, extraArgs = []) {
  const result = spawnSync(
    process.execPath,
    [runner, path.join(fixtures, manifest), ...extraArgs],
    { cwd: root, env: environment, encoding: 'utf8' }
  );
  let output;
  try {
    output = JSON.parse(result.stdout.trim());
  } catch {
    throw new Error(
      `Could not parse runner output for ${manifest}. stdout=${result.stdout} stderr=${result.stderr}`
    );
  }
  return { ...result, output };
}

let result = execute('smoke-manifest.json', ['--allow-submit']);
assert.strictEqual(result.status, 0);
assert.strictEqual(result.output.status, 'submitted_receipt_verified');
assert.strictEqual(result.output.receipt.confirmed, true);

result = execute('smoke-manifest.json');
assert.strictEqual(result.status, 1);
assert.strictEqual(result.output.status, 'blocked_or_failed');
assert.match(result.output.error, /submissionAllowed and --allow-submit/);

result = execute('submit-metadata-bypass-manifest.json', ['--allow-submit']);
assert.strictEqual(result.status, 1);
assert.strictEqual(result.output.status, 'blocked_or_failed');
assert.match(result.output.error, /submissionAllowed and --allow-submit/);

result = execute('combobox-enter-submit-smoke-manifest.json');
assert.strictEqual(result.status, 1);
assert.strictEqual(result.output.status, 'blocked_or_failed');
assert.match(result.output.error, /implicit Enter is forbidden/);
assert.notStrictEqual(result.output.status, 'submitted_receipt_verified');

for (const manifest of [
  'option-selector-submit-smoke-manifest.json',
  'labeled-option-selector-submit-smoke-manifest.json'
]) {
  result = execute(manifest);
  assert.strictEqual(result.status, 1);
  assert.strictEqual(result.output.status, 'blocked_or_failed');
  assert.match(result.output.error, /submissionAllowed and --allow-submit/);
  assert.notStrictEqual(result.output.status, 'page_verified');
}

result = execute('roleless-option-submit-smoke-manifest.json');
assert.strictEqual(result.status, 1);
assert.strictEqual(result.output.status, 'blocked_or_failed');
assert.match(result.output.error, /accessible role=option text not found/);
assert.notStrictEqual(result.output.status, 'page_verified');

for (const manifest of [
  'type-indirect-submit-smoke-manifest.json',
  'check-indirect-submit-smoke-manifest.json',
  'click-indirect-submit-smoke-manifest.json',
  'select-indirect-submit-smoke-manifest.json',
  'upload-indirect-submit-smoke-manifest.json',
  'combobox-focus-submit-smoke-manifest.json',
  'labeled-focus-submit-smoke-manifest.json',
  'role-option-indirect-submit-smoke-manifest.json'
]) {
  result = execute(manifest);
  assert.strictEqual(result.status, 1, `${manifest}: ${result.stderr || result.stdout}`);
  assert.strictEqual(result.output.status, 'blocked_or_failed');
  assert.notStrictEqual(result.output.status, 'page_verified');
  assert.notStrictEqual(result.output.status, 'submitted_receipt_verified');
}

result = execute('greenhouse-no-receipt-smoke-manifest.json', ['--allow-submit']);
assert.strictEqual(result.status, 3);
assert.strictEqual(result.output.status, 'receipt_not_verified');
assert.strictEqual(result.output.receipt.confirmed, false);
assert.strictEqual(result.output.receipt.outcome, 'greenhouse_validation_blocked');

for (const manifest of [
  'upload-smoke-manifest.json',
  'react-select-smoke-manifest.json',
  'greenhouse-recovery-smoke-manifest.json',
  'greenhouse-wrapper-smoke-manifest.json'
]) {
  result = execute(manifest);
  assert.strictEqual(result.status, 0, `${manifest}: ${result.stderr || result.stdout}`);
  assert.strictEqual(result.output.status, 'page_verified');
}

console.log('browser smoke tests: ok');
