'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { setup } = require('../scripts/setup');
const {
  inspectApprovalFile,
  inspectDoctor,
  inspectPdfFile,
  validateApprovalRegistry,
  versionAtLeast
} = require('../scripts/doctor');

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'application-runner-setup-'));
(async () => {
try {
  fs.mkdirSync(path.join(temporaryRoot, 'templates'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, '..', 'templates', 'approvals.template.json'), path.join(temporaryRoot, 'templates', 'approvals.template.json'));
  fs.copyFileSync(path.join(__dirname, '..', 'templates', 'inspect-manifest.template.json'), path.join(temporaryRoot, 'templates', 'inspect-manifest.template.json'));

  const first = setup(temporaryRoot);
  assert.strictEqual(first.copies.every(copy => copy.created), true);
  assert.strictEqual(fs.existsSync(path.join(temporaryRoot, 'private', 'approvals.json')), true);
  assert.strictEqual(fs.existsSync(path.join(temporaryRoot, 'private', 'manifests', 'inspect-manifest.template.json')), true);

  fs.writeFileSync(path.join(temporaryRoot, 'private', 'approvals.json'), '{"approvals":[],"preserved":true}\n');
  const second = setup(temporaryRoot);
  assert.strictEqual(second.copies.every(copy => !copy.created), true);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(temporaryRoot, 'private', 'approvals.json'), 'utf8')).preserved, true);

  fs.copyFileSync(
    path.join(__dirname, '..', 'fixtures', 'resumes', 'synthetic-resume.pdf'),
    path.join(temporaryRoot, 'private', 'resumes', 'resume.pdf')
  );
  const doctor = await inspectDoctor({ root: temporaryRoot, resolveBrowser: () => process.execPath });
  assert.strictEqual(doctor.ok, true);
  assert.strictEqual(doctor.checks.find(check => check.name === 'Private PDF resume').detail, '1 readable PDF(s); 0 invalid PDF file(s)');

  const fakePdf = path.join(temporaryRoot, 'private', 'resumes', 'fake.pdf');
  fs.writeFileSync(fakePdf, 'plain text with a PDF extension\n');
  assert.strictEqual((await inspectPdfFile(fakePdf)).ok, false);
  let invalidDoctor = await inspectDoctor({ root: temporaryRoot, resolveBrowser: () => process.execPath });
  assert.strictEqual(invalidDoctor.ok, false);
  assert.strictEqual(invalidDoctor.checks.find(check => check.name === 'Private PDF resume').detail, '1 readable PDF(s); 1 invalid PDF file(s)');
  fs.rmSync(fakePdf);

  const malformedPdf = path.join(temporaryRoot, 'private', 'resumes', 'malformed.pdf');
  fs.writeFileSync(malformedPdf, '%PDF-1.7\nThis is not a parseable document.\n%%EOF\n');
  assert.strictEqual((await inspectPdfFile(malformedPdf)).ok, false);
  invalidDoctor = await inspectDoctor({ root: temporaryRoot, resolveBrowser: () => process.execPath });
  assert.strictEqual(invalidDoctor.ok, false);
  assert.strictEqual(invalidDoctor.checks.find(check => check.name === 'Private PDF resume').detail, '1 readable PDF(s); 1 invalid PDF file(s)');
  fs.rmSync(malformedPdf);

  const templateApproval = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'templates', 'approvals.template.json'), 'utf8'));
  assert.strictEqual(validateApprovalRegistry(templateApproval).ok, true);
  assert.strictEqual(templateApproval.approvals[0].approved, false);
  assert.strictEqual(inspectApprovalFile(path.join(__dirname, '..', 'templates', 'approvals.template.json')).ok, true);

  const validApproval = {
    approvals: [{
      id: 'valid-approval-1',
      actionType: 'type',
      value: 'Synthetic value',
      kind: 'synthetic_fixture',
      reference: 'fixtures/example.html#field',
      approved: true
    }]
  };
  assert.strictEqual(validateApprovalRegistry(validApproval).ok, true);
  const approvalPath = path.join(temporaryRoot, 'private', 'approvals.json');
  fs.writeFileSync(approvalPath, JSON.stringify(validApproval));
  assert.strictEqual(inspectApprovalFile(approvalPath).ok, true);

  const validSelectionActionTypes = [
    'selectOption',
    'selectComboboxOption',
    'selectLabeledOption'
  ];
  for (const actionType of validSelectionActionTypes) {
    const selectionApproval = {
      approvals: [{
        ...validApproval.approvals[0],
        id: `valid-${actionType}`,
        actionType,
        value: 'Synthetic option'
      }]
    };
    assert.strictEqual(validateApprovalRegistry(selectionApproval).ok, true);
  }

  const focusedInvalidApprovals = [
    {
      registry: { approvals: [{ ...validApproval.approvals[0], id: ' whitespace-id' }] },
      expectedDetail: 'id must not have leading or trailing whitespace'
    },
    {
      registry: {
        approvals: [
          { ...validApproval.approvals[0], id: 'normalized-duplicate' },
          { ...validApproval.approvals[0], id: 'normalized-duplicate ' }
        ]
      },
      expectedDetail: 'duplicates an earlier id'
    },
    ...validSelectionActionTypes.map(actionType => ({
      registry: {
        approvals: [{
          ...validApproval.approvals[0],
          id: `empty-${actionType}`,
          actionType,
          value: ''
        }]
      },
      expectedDetail: 'requires a non-empty selection value'
    }))
  ];
  for (const { registry, expectedDetail } of focusedInvalidApprovals) {
    const validation = validateApprovalRegistry(registry);
    assert.strictEqual(validation.ok, false);
    assert.strictEqual(validation.detail.includes(expectedDetail), true);
    fs.writeFileSync(approvalPath, JSON.stringify(registry));
    const inspected = inspectApprovalFile(approvalPath);
    assert.strictEqual(inspected.ok, false);
    assert.strictEqual(inspected.detail.includes('Synthetic value'), false);
    assert.strictEqual(inspected.detail.includes('Synthetic option'), false);
  }

  for (const malformedApproval of [
    { approvals: [{ id: 'missing-fields' }] },
    { approvals: [{ ...validApproval.approvals[0], approved: 'yes' }] },
    { approvals: [validApproval.approvals[0], { ...validApproval.approvals[0] }] },
    { approvals: [{ ...validApproval.approvals[0], actionType: 'click' }] }
  ]) {
    const validation = validateApprovalRegistry(malformedApproval);
    assert.strictEqual(validation.ok, false);
    fs.writeFileSync(approvalPath, JSON.stringify(malformedApproval));
    const inspected = inspectApprovalFile(approvalPath);
    assert.strictEqual(inspected.ok, false);
    assert.strictEqual(inspected.detail.includes('Synthetic value'), false);
  }
  assert.strictEqual(versionAtLeast('22.12.0', [22, 12, 0]), true);
  assert.strictEqual(versionAtLeast('22.11.9', [22, 12, 0]), false);
  assert.strictEqual(versionAtLeast('23.0.0', [22, 12, 0]), true);
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log('setup and doctor tests: ok');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
