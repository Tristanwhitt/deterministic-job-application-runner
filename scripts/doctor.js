'use strict';

const fs = require('fs');
const path = require('path');
const { browserExecutable } = require('../runner');

const REPOSITORY_ROOT = path.resolve(__dirname, '..');
const MINIMUM_NODE = [22, 12, 0];

function versionAtLeast(actual, minimum) {
  const parts = String(actual).replace(/^v/, '').split('.').map(value => Number.parseInt(value, 10) || 0);
  for (let index = 0; index < minimum.length; index += 1) {
    if ((parts[index] || 0) > minimum[index]) return true;
    if ((parts[index] || 0) < minimum[index]) return false;
  }
  return true;
}

function inspectApprovalFile(file) {
  if (!fs.existsSync(file)) return { ok: false, detail: 'missing' };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const validation = validateApprovalRegistry(parsed);
    if (!validation.ok) return validation;
    const enabled = parsed.approvals.filter(item => item.approved === true).length;
    return { ok: true, detail: `${parsed.approvals.length} valid entries; ${enabled} approved` };
  } catch {
    return { ok: false, detail: 'invalid JSON' };
  }
}

const APPROVABLE_ACTION_TYPES = new Set([
  'type',
  'check',
  'selectOption',
  'selectComboboxOption',
  'selectLabeledOption'
]);

const SELECTION_ACTION_TYPES = new Set([
  'selectOption',
  'selectComboboxOption',
  'selectLabeledOption'
]);

function nonemptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateApprovalRegistry(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray(parsed.approvals)) {
    return { ok: false, detail: 'must contain an approvals array' };
  }
  const ids = new Set();
  for (let index = 0; index < parsed.approvals.length; index += 1) {
    const entry = parsed.approvals[index];
    const prefix = `entry ${index + 1}`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, detail: `${prefix} must be an object` };
    }
    if (!nonemptyString(entry.id)) return { ok: false, detail: `${prefix} has an invalid id` };
    const normalizedId = entry.id.trim();
    if (ids.has(normalizedId)) return { ok: false, detail: `${prefix} duplicates an earlier id` };
    if (entry.id !== normalizedId) return { ok: false, detail: `${prefix} id must not have leading or trailing whitespace` };
    ids.add(normalizedId);
    if (!APPROVABLE_ACTION_TYPES.has(entry.actionType)) {
      return { ok: false, detail: `${prefix} has an unsupported actionType` };
    }
    if (!Object.prototype.hasOwnProperty.call(entry, 'value')) {
      return { ok: false, detail: `${prefix} is missing value` };
    }
    if (entry.actionType === 'check' && entry.value !== null) {
      return { ok: false, detail: `${prefix} requires null value for check` };
    }
    if (entry.actionType !== 'check' && typeof entry.value !== 'string') {
      return { ok: false, detail: `${prefix} requires a string value` };
    }
    if (SELECTION_ACTION_TYPES.has(entry.actionType) && entry.value.length === 0) {
      return { ok: false, detail: `${prefix} requires a non-empty selection value` };
    }
    if (!nonemptyString(entry.kind)) return { ok: false, detail: `${prefix} has an invalid kind` };
    if (!nonemptyString(entry.reference)) return { ok: false, detail: `${prefix} has an invalid reference` };
    if (typeof entry.approved !== 'boolean') return { ok: false, detail: `${prefix} has a non-boolean approved flag` };
  }
  return { ok: true, detail: `${parsed.approvals.length} valid entries` };
}

async function inspectPdfFile(file) {
  let loadingTask;
  try {
    const stats = fs.statSync(file);
    if (!stats.isFile() || stats.size < 32) return { ok: false, detail: 'not a readable PDF' };
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    loadingTask = pdfjs.getDocument({
      data: new Uint8Array(fs.readFileSync(file)),
      disableWorker: true,
      isEvalSupported: false,
      verbosity: 0
    });
    const document = await loadingTask.promise;
    if (!Number.isInteger(document.numPages) || document.numPages < 1) {
      return { ok: false, detail: 'PDF has no readable pages' };
    }
    await document.getPage(1);
    return { ok: true, detail: 'readable PDF document' };
  } catch {
    return { ok: false, detail: 'not a readable PDF' };
  } finally {
    if (loadingTask) await loadingTask.destroy().catch(() => {});
  }
}

async function inspectDoctor(options = {}) {
  const root = options.root || REPOSITORY_ROOT;
  const resolveBrowser = options.resolveBrowser || browserExecutable;
  const checks = [];
  const add = (name, ok, detail, next) => checks.push({ name, ok, detail, next });

  const nodeOk = versionAtLeast(process.versions.node, MINIMUM_NODE);
  add('Node.js', nodeOk, `v${process.versions.node}`, 'Install Node.js 22.12 or newer.');

  try {
    const executable = resolveBrowser();
    const stats = fs.statSync(executable);
    add('Chromium-family browser', stats.isFile(), path.basename(executable), 'Install Chrome, Chromium, or Edge, or set APPLICATION_RUNNER_BROWSER to its executable.');
  } catch {
    add('Chromium-family browser', false, 'not found', 'Install Chrome, Chromium, or Edge, or set APPLICATION_RUNNER_BROWSER to its executable.');
  }

  for (const directory of ['private/resumes', 'private/manifests', 'artifacts/logs', 'artifacts/proofs']) {
    const target = path.join(root, directory);
    const ok = fs.existsSync(target) && fs.statSync(target).isDirectory();
    add(directory, ok, ok ? 'ready' : 'missing', 'Run npm run setup.');
  }

  const approval = inspectApprovalFile(path.join(root, 'private/approvals.json'));
  add('private/approvals.json', approval.ok, approval.detail, 'Run npm run setup, then review the generated approval registry.');

  const resumeDirectory = path.join(root, 'private/resumes');
  const pdfFiles = fs.existsSync(resumeDirectory)
    ? fs.readdirSync(resumeDirectory, { withFileTypes: true })
      .filter(entry => entry.isFile() && path.extname(entry.name).toLowerCase() === '.pdf')
      .map(entry => path.join(resumeDirectory, entry.name))
    : [];
  const pdfResults = await Promise.all(pdfFiles.map(file => inspectPdfFile(file)));
  const readablePdfCount = pdfResults.filter(result => result.ok).length;
  const invalidPdfCount = pdfFiles.length - readablePdfCount;
  add(
    'Private PDF resume',
    readablePdfCount > 0 && invalidPdfCount === 0,
    `${readablePdfCount} readable PDF(s); ${invalidPdfCount} invalid PDF file(s)`,
    'Place only reviewed, readable PDF resumes under private/resumes/.'
  );

  return { ok: checks.every(check => check.ok), checks };
}

async function main() {
  const result = await inspectDoctor();
  for (const check of result.checks) {
    console.log(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name}: ${check.detail}`);
    if (!check.ok) console.log(`      Next: ${check.next}`);
  }
  console.log(result.ok ? 'READY: local runtime prerequisites are present.' : 'NOT READY: complete the failed next steps above.');
  process.exitCode = result.ok ? 0 : 1;
}

if (require.main === module) {
  main().catch(() => {
    console.error('NOT READY: doctor could not complete its checks.');
    process.exit(1);
  });
}

module.exports = { inspectApprovalFile, inspectDoctor, inspectPdfFile, validateApprovalRegistry, versionAtLeast };
