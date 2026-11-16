'use strict';

const assert = require('assert');
const {
  classifyReceiptOutcome,
  requireApprovedProvenance,
  requireManifest,
  slug
} = require('../runner');
const fs = require('fs');
const os = require('os');
const path = require('path');

const registry = [{
  id: 'approved-example',
  actionType: 'type',
  value: 'Example value',
  kind: 'synthetic_fixture',
  reference: 'fixtures/example.html#field',
  approved: true
}];
const approved = requireApprovedProvenance({
  type: 'type',
  value: 'Example value',
  provenance: {
    approvalId: 'approved-example',
    kind: 'synthetic_fixture',
    reference: 'fixtures/example.html#field'
  }
}, registry);
assert.deepStrictEqual(approved, {
  approvalId: 'approved-example',
  kind: 'synthetic_fixture',
  reference: 'fixtures/example.html#field',
  approved: true
});

for (const action of [
  { type: 'check' },
  { type: 'check', provenance: 'plain string' },
  { type: 'type', value: 'Example value', provenance: { approvalId: 'unknown', kind: 'synthetic_fixture', reference: 'fixtures/example.html#field', approved: true } },
  { type: 'type', value: 'Forged value', provenance: { approvalId: 'approved-example', kind: 'synthetic_fixture', reference: 'fixtures/example.html#field' } },
  { type: 'check', provenance: { approvalId: 'approved-example', kind: 'synthetic_fixture', reference: 'fixtures/example.html#field' } }
]) {
  assert.throws(() => requireApprovedProvenance(action, registry), /blocked/);
}

const outcome = classifyReceiptOutcome({
  manifest: { job: { url: 'fixture-greenhouse.html' } },
  text: 'Powered by Greenhouse fixture',
  receiptMissing: ['Application Received'],
  validationState: {
    invalidControls: [{ id: 'required-field' }],
    hiddenErrors: [],
    hasApplicationForm: true
  },
  hasReceiptScreenshot: false
});
assert.strictEqual(outcome, 'greenhouse_validation_blocked');
assert.strictEqual(slug('Synthetic Run!'), 'synthetic-run');

const manifestRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'application-runner-manifest-'));
try {
  for (const [name, submissionAllowed] of [['missing', undefined], ['true', true], ['null', null]]) {
    const manifestPath = path.join(manifestRoot, `${name}.json`);
    const manifest = {
      runId: `inspect-${name}`,
      mode: 'inspect',
      job: { company: 'Example Company', role: 'Example Role' },
      verify: { requiredText: ['Example'] },
      actions: [{ type: 'goto', url: './synthetic-example.html' }]
    };
    if (submissionAllowed !== undefined) manifest.submissionAllowed = submissionAllowed;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.throws(() => requireManifest(manifestPath), /submissionAllowed to be exactly false/);
  }
} finally {
  fs.rmSync(manifestRoot, { recursive: true, force: true });
}

console.log('safety unit tests: ok');
