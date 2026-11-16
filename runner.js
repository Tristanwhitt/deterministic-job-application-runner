const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const puppeteer = require('puppeteer-core');

const ROOT = __dirname;
const ARTIFACT_DIR = path.join(ROOT, 'artifacts');
const PROOF_DIR = path.join(ARTIFACT_DIR, 'proofs');
const LOG_DIR = path.join(ARTIFACT_DIR, 'logs');
const ALLOW_SUBMIT = process.argv.includes('--allow-submit');
const SUBMISSION_GUARD_TOKEN = crypto.randomBytes(32).toString('hex');
const RESUME_DIR = path.resolve(ROOT, process.env.APPLICATION_RUNNER_RESUME_DIR || 'private/resumes');

function browserExecutable() {
  if (process.env.APPLICATION_RUNNER_BROWSER) {
    return path.resolve(process.env.APPLICATION_RUNNER_BROWSER);
  }

  const command = process.platform === 'win32' ? 'where' : 'which';
  const names = process.platform === 'win32'
    ? ['chrome.exe', 'msedge.exe']
    : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
  for (const name of names) {
    const located = spawnSync(command, [name], { encoding: 'utf8' });
    if (located.status === 0) {
      const first = located.stdout.split(/\r?\n/).map(item => item.trim()).find(Boolean);
      if (first) return first;
    }
  }

  if (process.platform === 'darwin') {
    const macChrome = path.join(
      path.parse(ROOT).root,
      'Applications',
      'Google Chrome.app',
      'Contents',
      'MacOS',
      'Google Chrome'
    );
    if (fs.existsSync(macChrome)) return macChrome;
  }

  throw new Error(
    'No Chromium-family browser found. Set APPLICATION_RUNNER_BROWSER to a local browser executable.'
  );
}

function usage() {
  console.error('Usage: node runner.js MANIFEST.json [--allow-submit]');
  process.exit(2);
}

function slug(value) {
  return String(value || 'run')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || 'run';
}

function resolveUrl(baseDir, rawUrl) {
  if (/^https?:\/\//i.test(rawUrl) || /^file:\/\//i.test(rawUrl)) return rawUrl;
  return `file://${path.resolve(baseDir, rawUrl)}`;
}

function resolveLocalResume(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') {
    throw new Error('uploadResume.file is required');
  }

  const absolutePath = path.resolve(ROOT, rawPath);
  const relativeToResumeDir = path.relative(RESUME_DIR, absolutePath);
  if (relativeToResumeDir.startsWith('..') || path.isAbsolute(relativeToResumeDir)) {
    throw new Error(`Resume upload blocked: file must be under ${path.relative(ROOT, RESUME_DIR)}`);
  }
  if (path.extname(absolutePath).toLowerCase() !== '.pdf') {
    throw new Error('Resume upload blocked: file must be a local PDF');
  }
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Resume upload blocked: file not found: ${rawPath}`);
  }

  const stats = fs.statSync(absolutePath);
  if (!stats.isFile()) {
    throw new Error(`Resume upload blocked: not a file: ${rawPath}`);
  }

  return { absolutePath, stats };
}

function fileSha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function requireManifest(filePath) {
  const manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  manifest.mode = manifest.mode || 'submit';
  if (!['submit', 'inspect'].includes(manifest.mode)) {
    throw new Error('manifest.mode must be either "submit" or "inspect"');
  }
  if (!manifest.runId) throw new Error('manifest.runId is required');
  if (!manifest.job || !manifest.job.company || !manifest.job.role) {
    throw new Error('manifest.job.company and manifest.job.role are required');
  }
  if (!Array.isArray(manifest.actions) || manifest.actions.length === 0) {
    throw new Error('manifest.actions must be a non-empty array');
  }
  if (manifest.mode === 'inspect' && manifest.submissionAllowed !== false) {
    throw new Error('inspect mode requires manifest.submissionAllowed to be exactly false');
  }
  if (manifest.mode === 'submit' && (!manifest.receipt || !Array.isArray(manifest.receipt.requiredText) || manifest.receipt.requiredText.length === 0)) {
    throw new Error('manifest.receipt.requiredText must be a non-empty array in submit mode');
  }
  if (manifest.mode === 'inspect' && (!manifest.verify || !Array.isArray(manifest.verify.requiredText) || manifest.verify.requiredText.length === 0)) {
    throw new Error('manifest.verify.requiredText must be a non-empty array in inspect mode');
  }
  return manifest;
}

function loadApprovalRegistry() {
  const configured = process.env.APPLICATION_RUNNER_APPROVALS_FILE;
  if (!configured) {
    throw new Error('Source-backed action blocked: APPLICATION_RUNNER_APPROVALS_FILE is required');
  }
  const approvalPath = path.resolve(process.cwd(), configured);
  if (!fs.existsSync(approvalPath) || !fs.statSync(approvalPath).isFile()) {
    throw new Error('Source-backed action blocked: approval registry file was not found');
  }
  const parsed = JSON.parse(fs.readFileSync(approvalPath, 'utf8'));
  if (!parsed || !Array.isArray(parsed.approvals)) {
    throw new Error('Source-backed action blocked: approval registry must contain an approvals array');
  }
  return parsed.approvals;
}

function requireApprovedProvenance(action, approvalRegistry = loadApprovalRegistry()) {
  const provenance = action.provenance;
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) {
    throw new Error(`${action.type} blocked: structured action.provenance is required`);
  }
  if (typeof provenance.approvalId !== 'string' || !provenance.approvalId.trim()) {
    throw new Error(`${action.type} blocked: action.provenance.approvalId is required`);
  }
  const approval = approvalRegistry.find(item => item && item.id === provenance.approvalId.trim());
  if (!approval || approval.approved !== true) {
    throw new Error(`${action.type} blocked: approvalId is not approved by the external registry`);
  }
  const expectedValue = Object.prototype.hasOwnProperty.call(action, 'value') ? action.value : null;
  const matches = approval.actionType === action.type &&
    approval.kind === provenance.kind &&
    approval.reference === provenance.reference &&
    JSON.stringify(approval.value ?? null) === JSON.stringify(expectedValue ?? null);
  if (!matches) {
    throw new Error(`${action.type} blocked: provenance does not match the externally approved action`);
  }
  return {
    approvalId: approval.id,
    kind: approval.kind,
    reference: approval.reference,
    approved: true
  };
}

async function bodyText(page) {
  return page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim());
}

function keyboardFor(context) {
  return context.keyboard || (typeof context.page === 'function' ? context.page().keyboard : null);
}

function installSubmissionGuard(token) {
  if (window.__applicationRunnerSubmissionGuard) return;
  let authorized = false;
  let blockedCount = 0;
  const nativeSubmit = HTMLFormElement.prototype.submit;
  const nativeRequestSubmit = HTMLFormElement.prototype.requestSubmit;

  Object.defineProperty(window, '__applicationRunnerSubmissionGuard', {
    configurable: false,
    enumerable: false,
    value: {
      authorize(candidate, value) {
        if (candidate !== token) return false;
        authorized = value === true;
        return true;
      },
      blockedCount(candidate) {
        return candidate === token ? blockedCount : null;
      }
    }
  });

  function block() {
    blockedCount += 1;
    return new Error('Submission blocked by application runner authorization guard');
  }

  HTMLFormElement.prototype.submit = function guardedSubmit(...args) {
    if (!authorized) throw block();
    return nativeSubmit.apply(this, args);
  };
  HTMLFormElement.prototype.requestSubmit = function guardedRequestSubmit(...args) {
    if (!authorized) throw block();
    return nativeRequestSubmit.apply(this, args);
  };
  document.addEventListener('submit', event => {
    if (authorized) return;
    blockedCount += 1;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}

async function setSubmissionAuthorization(context, allowed) {
  return context.evaluate((token, value) => {
    const guard = window.__applicationRunnerSubmissionGuard;
    return Boolean(guard && guard.authorize(token, value));
  }, SUBMISSION_GUARD_TOKEN, allowed);
}

async function blockedSubmissionCount(page) {
  let total = 0;
  for (const frame of page.frames()) {
    try {
      const count = await frame.evaluate(token => {
        const guard = window.__applicationRunnerSubmissionGuard;
        return guard ? guard.blockedCount(token) : 0;
      }, SUBMISSION_GUARD_TOKEN);
      total += Number(count || 0);
    } catch {}
  }
  return total;
}

async function resolveActionContext(page, action) {
  if (!action.frameUrlPattern) return page;
  const pattern = String(action.frameUrlPattern);
  const deadline = Date.now() + (action.timeoutMs || 10000);
  while (Date.now() < deadline) {
    const frame = page.frames().find(item => {
      const url = item.url();
      try {
        return new RegExp(pattern).test(url);
      } catch {
        return url.includes(pattern);
      }
    });
    if (frame) return frame;
    await delay(100);
  }
  throw new Error(`Frame target blocked: no frame matched frameUrlPattern=${pattern}`);
}

async function inspectFileInputs(page) {
  return page.evaluate(() => {
    function clean(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function labelFor(element) {
      const id = element.id || '';
      const explicit = id
        ? clean(Array.from(document.querySelectorAll(`label[for="${CSS.escape(id)}"]`)).map(label => label.innerText).join(' '))
        : '';
      const wrapped = clean((element.closest('label') || {}).innerText || '');
      const aria = clean(element.getAttribute('aria-label') || '');
      const labelledBy = clean((element.getAttribute('aria-labelledby') || '')
        .split(/\s+/)
        .map(item => document.getElementById(item))
        .filter(Boolean)
        .map(item => item.innerText || item.textContent || '')
        .join(' '));
      return clean(aria || labelledBy || explicit || wrapped);
    }

    return Array.from(document.querySelectorAll('input[type="file"]')).map((element, index) => {
      const file = element.files && element.files[0];
      const container = element.closest('label, .field, .application-question, .custom-question, section, fieldset, div') || element.parentElement || element;
      const descriptor = clean([
        element.id || '',
        element.name || '',
        element.accept || '',
        labelFor(element),
        container.innerText || container.textContent || ''
      ].join(' '));
      return {
        index,
        id: element.id || '',
        name: element.name || '',
        accept: element.accept || '',
        label: labelFor(element),
        descriptor: descriptor.slice(0, 500),
        hidden: Boolean(element.hidden || element.offsetParent === null),
        required: Boolean(element.required),
        file: file ? { name: file.name, size: file.size, type: file.type } : null,
        validity: {
          valid: element.validity ? element.validity.valid : true,
          valueMissing: element.validity ? element.validity.valueMissing : false,
          validationMessage: element.validationMessage || ''
        }
      };
    });
  });
}

async function findFileInputSelector(page, action) {
  if (action.selector) {
    await page.waitForSelector(action.selector, { timeout: action.timeoutMs || 10000 });
    return action.selector;
  }

  const patterns = (action.labelPatterns && action.labelPatterns.length ? action.labelPatterns : ['resume', 'cv', 'curriculum'])
    .map(pattern => String(pattern).toLowerCase());
  const result = await page.evaluate(patterns => {
    function clean(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function labelFor(element) {
      const id = element.id || '';
      const explicit = id
        ? clean(Array.from(document.querySelectorAll(`label[for="${CSS.escape(id)}"]`)).map(label => label.innerText).join(' '))
        : '';
      const wrapped = clean((element.closest('label') || {}).innerText || '');
      const aria = clean(element.getAttribute('aria-label') || '');
      const labelledBy = clean((element.getAttribute('aria-labelledby') || '')
        .split(/\s+/)
        .map(item => document.getElementById(item))
        .filter(Boolean)
        .map(item => item.innerText || item.textContent || '')
        .join(' '));
      return clean(aria || labelledBy || explicit || wrapped);
    }

    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    const candidates = inputs.map((element, index) => {
      const container = element.closest('label, .field, .application-question, .custom-question, section, fieldset, div') || element.parentElement || element;
      const label = labelFor(element);
      const descriptor = clean([element.id || '', element.name || '', element.accept || '', label, container.innerText || container.textContent || ''].join(' '));
      const lower = descriptor.toLowerCase();
      let score = 0;
      if (patterns.some(pattern => lower.includes(pattern))) score += 4;
      if (/pdf|application\/pdf/.test(lower)) score += 1;
      if (element.required) score += 1;
      return { element, index, label, descriptor, score };
    }).filter(candidate => candidate.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
    const match = candidates[0];
    if (!match) return { selector: null, count: inputs.length };
    if (!match.element.id) match.element.id = `application-runner-file-${Date.now()}-${match.index}`;
    return { selector: `#${CSS.escape(match.element.id)}`, count: inputs.length, label: match.label, descriptor: match.descriptor.slice(0, 300) };
  }, patterns);

  if (!result.selector) {
    const diagnostics = await inspectFileInputs(page);
    throw new Error(`Resume upload blocked: no matching file input found for patterns ${patterns.join(', ')}; fileInputs=${JSON.stringify(diagnostics)}`);
  }
  return result.selector;
}

async function extractValidationState(page) {
  return page.evaluate(() => {
    function clean(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function labelFor(element) {
      const id = element.id || '';
      const ariaLabel = element.getAttribute('aria-label') || '';
      const labelledBy = clean((element.getAttribute('aria-labelledby') || '')
        .split(/\s+/)
        .map(item => document.getElementById(item))
        .filter(Boolean)
        .map(item => item.innerText || item.textContent || '')
        .join(' '));
      const explicit = id
        ? clean(Array.from(document.querySelectorAll(`label[for="${CSS.escape(id)}"]`)).map(label => label.innerText).join(' '))
        : '';
      const wrapped = clean((element.closest('label') || {}).innerText || '');
      return clean(ariaLabel || labelledBy || explicit || wrapped);
    }

    function contextFor(element) {
      const container = element.closest('.field, .field-error, .application-question, .custom-question, fieldset, label, div') || element.parentElement || element;
      return clean((container.innerText || container.textContent || '').slice(0, 500));
    }

    const controls = Array.from(document.querySelectorAll('input, select, textarea, [role="combobox"]'));
    const invalidControls = controls.map((element, index) => {
      const validity = element.validity || null;
      const ariaInvalid = element.getAttribute('aria-invalid') === 'true';
      const invalid = ariaInvalid || (validity && !validity.valid);
      if (!invalid) return null;
      return {
        index,
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute('role') || '',
        id: element.id || '',
        name: element.getAttribute('name') || '',
        type: element.getAttribute('type') || '',
        required: Boolean(element.required || element.getAttribute('aria-required') === 'true'),
        value: element.value || element.getAttribute('aria-valuetext') || element.textContent || '',
        validationMessage: element.validationMessage || '',
        ariaInvalid,
        label: labelFor(element),
        context: contextFor(element)
      };
    }).filter(Boolean);

    const errorSelectors = [
      '.error', '.field-error', '.field_with_errors', '.validation-error', '.error-message',
      '[class*="error"]', '[id*="error"]', '[role="alert"]', '[aria-live]'
    ];
    const hiddenErrors = Array.from(document.querySelectorAll(errorSelectors.join(',')))
      .map(element => ({
        tag: element.tagName.toLowerCase(),
        id: element.id || '',
        className: element.className ? String(element.className) : '',
        hidden: Boolean(element.hidden || element.getAttribute('aria-hidden') === 'true'),
        text: clean(element.innerText || element.textContent || '')
      }))
      .filter(item => item.text)
      .slice(0, 80);

    const submitButtons = Array.from(document.querySelectorAll('button, input[type="submit"], [role="button"]'))
      .filter(element => /submit|apply/i.test(clean(element.innerText || element.value || element.getAttribute('aria-label') || '')))
      .map(element => ({
        text: clean(element.innerText || element.value || element.getAttribute('aria-label') || ''),
        disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true')
      }));

    return {
      url: location.href,
      title: document.title,
      hasApplicationForm: Boolean(document.querySelector('form, #application, #application-form, input[type="file"], button[type="submit"], input[type="submit"]')),
      invalidControls,
      hiddenErrors,
      submitButtons
    };
  });
}

function classifyReceiptOutcome({ manifest, text, receiptMissing, validationState, hasReceiptScreenshot }) {
  if (receiptMissing.length === 0 && hasReceiptScreenshot) return 'receipt_verified';
  const isGreenhouse = /greenhouse/i.test(String(manifest.job && manifest.job.url || '')) || /greenhouse/i.test(text);
  if (isGreenhouse && validationState.invalidControls.length > 0) return 'greenhouse_validation_blocked';
  if (isGreenhouse && validationState.hiddenErrors.length > 0) return 'greenhouse_hidden_validation_or_error';
  if (isGreenhouse && validationState.hasApplicationForm) return 'greenhouse_returned_to_form_no_receipt';
  return 'receipt_text_missing';
}

async function waitForBodyText(page, text, timeoutMs) {
  await page.waitForFunction(
    expected => document.body.innerText.replace(/\s+/g, ' ').trim().includes(expected),
    { timeout: timeoutMs },
    text
  );
}

async function findCombobox(page, action) {
  if (action.selector) {
    await page.waitForSelector(action.selector, { visible: true, timeout: action.timeoutMs || 10000 });
    return action.selector;
  }

  if (!action.label) {
    throw new Error('selectComboboxOption requires either selector or label');
  }

  const selector = await page.evaluate(labelText => {
    function clean(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }
    const expected = clean(labelText).toLowerCase();
    const controls = Array.from(document.querySelectorAll('input, [role="combobox"], textarea'));
    const candidates = controls.map(element => {
      const id = element.id || '';
      const explicit = id
        ? clean(Array.from(document.querySelectorAll(`label[for="${CSS.escape(id)}"]`)).map(label => label.innerText).join(' '))
        : '';
      const aria = clean(element.getAttribute('aria-label') || '');
      const context = clean((element.closest('label, .field, .application-question, .custom-question') || element.parentElement || element).innerText || '');
      const exactish = [aria, explicit].map(value => value.toLowerCase()).filter(Boolean);
      const nearby = context.toLowerCase();
      let score = 0;
      if (exactish.some(value => value === expected)) score = 4;
      else if (exactish.some(value => value.includes(expected))) score = 3;
      else if (nearby === expected) score = 2;
      else if (nearby.includes(expected)) score = 1;
      return { element, score };
    }).filter(candidate => candidate.score > 0).sort((a, b) => b.score - a.score);
    const match = candidates[0] && candidates[0].element;
    if (!match) return null;
    if (!match.id) match.id = `application-runner-combobox-${Date.now()}`;
    return `#${CSS.escape(match.id)}`;
  }, action.label);

  if (!selector) {
    throw new Error(`selectComboboxOption blocked: no combobox/input found for label: ${action.label}`);
  }
  return selector;
}

async function findLabeledControl(page, action) {
  if (action.selector) {
    await page.waitForSelector(action.selector, { timeout: action.timeoutMs || 10000 });
    return action.selector;
  }

  if (!action.label) {
    throw new Error('selectLabeledOption requires either selector or label');
  }

  const selector = await page.evaluate(labelText => {
    function clean(value) {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function labelFor(element) {
      const id = element.id || '';
      const explicit = id
        ? clean(Array.from(document.querySelectorAll(`label[for="${CSS.escape(id)}"]`)).map(label => label.innerText).join(' '))
        : '';
      const wrapped = clean((element.closest('label') || {}).innerText || '');
      const aria = clean(element.getAttribute('aria-label') || '');
      const labelledBy = clean((element.getAttribute('aria-labelledby') || '')
        .split(/\s+/)
        .map(item => document.getElementById(item))
        .filter(Boolean)
        .map(item => item.innerText || item.textContent || '')
        .join(' '));
      return clean(aria || labelledBy || explicit || wrapped);
    }

    const expected = clean(labelText).toLowerCase();
    const controls = Array.from(document.querySelectorAll('select, input, textarea, [role="combobox"], [aria-haspopup="listbox"]'));
    const candidates = controls.map((element, index) => {
      const label = labelFor(element);
      const container = element.closest('label, .field, .application-question, .custom-question, fieldset, section, div') || element.parentElement || element;
      const context = clean(container.innerText || container.textContent || '');
      const labelLower = label.toLowerCase();
      const contextLower = context.toLowerCase();
      let score = 0;
      if (labelLower === expected) score = 6;
      else if (labelLower.includes(expected)) score = 5;
      else if (expected.includes(labelLower) && labelLower.length > 6) score = 4;
      else if (contextLower.includes(expected)) score = 3;
      else if (expected.split(/\s+/).filter(word => word.length > 3).every(word => contextLower.includes(word))) score = 2;
      return { element, index, score };
    }).filter(candidate => candidate.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
    const match = candidates[0] && candidates[0].element;
    if (!match) return null;
    if (!match.id) match.id = `application-runner-control-${Date.now()}`;
    return `#${CSS.escape(match.id)}`;
  }, action.label);

  if (!selector) {
    throw new Error(`selectLabeledOption blocked: no control found for label: ${action.label}`);
  }
  return selector;
}

async function isSubmitCapable(page, selector) {
  return page.$eval(selector, (element, targetSelector) => {
    const tag = element.tagName.toLowerCase();
    const type = String(element.getAttribute('type') || '').toLowerCase();
    const text = String(
      element.innerText ||
      element.value ||
      element.getAttribute('aria-label') ||
      ''
    ).replace(/\s+/g, ' ').trim();
    const nativeSubmit = (tag === 'input' && ['submit', 'image'].includes(type)) ||
      (tag === 'button' && (type === 'submit' || (!type && Boolean(element.closest('form')))));
    const submitSignal = /submit|apply/i.test(text) || /submit|apply/i.test(targetSelector);
    return nativeSubmit || submitSignal;
  }, selector);
}

async function guardedClick(page, selector, manifest, errorPrefix = 'Click', forceSubmitCapable = false) {
  await page.waitForSelector(selector, { visible: true, timeout: 10000 });
  const submitCapable = forceSubmitCapable || await isSubmitCapable(page, selector);
  if (submitCapable && manifest.mode === 'inspect') {
    throw new Error(`${errorPrefix} blocked: inspect mode cannot execute a submit-capable action`);
  }
  if (submitCapable && manifest.runtimeSuccessfulSubmitActionCount > 0) {
    throw new Error(`${errorPrefix} blocked: only one submit-capable action is allowed per run`);
  }
  if (submitCapable && (!manifest.submissionAllowed || !ALLOW_SUBMIT)) {
    throw new Error(`${errorPrefix} blocked: manifest.submissionAllowed and --allow-submit are both required`);
  }
  if (submitCapable) await setSubmissionAuthorization(page, true);
  try {
    await page.click(selector);
    if (submitCapable) await delay(500);
  } finally {
    if (submitCapable) {
      try { await setSubmissionAuthorization(page, false); } catch {}
    }
  }
  return { selector, submitCapable };
}

async function clickOptionText(page, action, manifest) {
  const selector = await page.evaluate(value => {
    function clean(text) {
      return String(text || '').replace(/\s+/g, ' ').trim();
    }
    const expected = clean(value).toLowerCase();
    const options = Array.from(document.querySelectorAll('[role="option"]'))
      .filter(element => {
        const text = clean(element.innerText || element.textContent || element.getAttribute('aria-label') || '');
        if (!text) return false;
        const lower = text.toLowerCase();
        return lower === expected || lower.includes(expected);
      });
    const match = options[0];
    if (!match) return null;
    if (!match.id) match.id = `application-runner-option-${Date.now()}`;
    return `#${CSS.escape(match.id)}`;
  }, action.optionText || action.value);
  if (!selector) {
    throw new Error(`Option selection blocked: accessible role=option text not found: ${action.optionText || action.value}`);
  }
  return guardedClick(page, selector, manifest, 'Option selection');
}

async function selectLabeledOption(page, action, manifest) {
  if (!action.value || typeof action.value !== 'string') {
    throw new Error('selectLabeledOption blocked: action.value is required');
  }

  const selector = await findLabeledControl(page, action);
  const keyboard = keyboardFor(page);
  if (!keyboard) throw new Error('selectLabeledOption blocked: no keyboard available for action context');
  const tag = await page.$eval(selector, element => element.tagName.toLowerCase());
  if (tag === 'select') {
    const selected = await page.$eval(selector, (element, expected) => {
      const expectedLower = String(expected).toLowerCase();
      const option = Array.from(element.options).find(item => {
        const text = String(item.textContent || '').trim().toLowerCase();
        const value = String(item.value || '').trim().toLowerCase();
        return text === expectedLower || value === expectedLower || text.includes(expectedLower);
      });
      if (!option) return false;
      element.value = option.value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, action.value);
    if (!selected) throw new Error(`selectLabeledOption blocked: no native select option matched ${action.value}`);
  } else {
    await page.click(selector, { clickCount: 3 });
    await keyboard.press('Backspace');
    if (action.searchText !== false) {
      await keyboard.type(action.searchText || action.value, { delay: action.delayMs || 3 });
    }
    await delay(action.optionWaitMs || 300);
    if (action.optionSelector) {
      await guardedClick(page, action.optionSelector, manifest, 'Option selector');
    } else if (action.clickOptionText) {
      await clickOptionText(page, action, manifest);
    } else {
      throw new Error('selectLabeledOption blocked: non-native controls require optionSelector or clickOptionText; implicit Enter is forbidden because it can submit a form');
    }
  }

  await page.$eval(selector, element => {
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await delay(action.commitWaitMs || 250);
  const state = await page.$eval(selector, element => ({
    tag: element.tagName.toLowerCase(),
    value: element.value || '',
    text: element.innerText || element.textContent || '',
    ariaValueText: element.getAttribute('aria-valuetext') || '',
    ariaInvalid: element.getAttribute('aria-invalid') || '',
    validationMessage: element.validationMessage || '',
    valid: element.validity ? element.validity.valid : true
  }));
  const committed = [state.value, state.text, state.ariaValueText].some(value => String(value || '').includes(action.value));
  if (!committed && action.requireCommitted !== false) {
    throw new Error(`selectLabeledOption blocked: selected value did not commit for ${selector}; expected ${action.value}`);
  }
  if (!state.valid) {
    throw new Error(`selectLabeledOption blocked: control invalid after selection for ${selector}: ${state.validationMessage || 'invalid control'}`);
  }
  return { selector, state };
}

async function selectComboboxOption(page, action, manifest) {
  if (!action.value || typeof action.value !== 'string') {
    throw new Error('selectComboboxOption blocked: action.value is required');
  }

  const selector = await findCombobox(page, action);
  const keyboard = keyboardFor(page);
  if (!keyboard) throw new Error('selectComboboxOption blocked: no keyboard available for action context');
  await page.click(selector, { clickCount: 3 });
  await keyboard.press('Backspace');
  await keyboard.type(action.searchText || action.value, { delay: action.delayMs || 3 });
  if (action.optionText) {
    await page.waitForFunction(expected => document.body.innerText.replace(/\s+/g, ' ').includes(expected), { timeout: action.timeoutMs || 10000 }, action.optionText);
  } else {
    await delay(action.optionWaitMs || 250);
  }

  if (action.optionSelector) {
    await guardedClick(page, action.optionSelector, manifest, 'Option selector');
  } else if (action.clickOptionText) {
    await clickOptionText(page, action, manifest);
  } else {
    throw new Error('selectComboboxOption blocked: optionSelector or clickOptionText is required; implicit Enter is forbidden because it can submit a form');
  }

  await delay(action.commitWaitMs || 250);
  const state = await page.$eval(selector, element => ({
    value: element.value || '',
    text: element.innerText || element.textContent || '',
    ariaValueText: element.getAttribute('aria-valuetext') || '',
    ariaInvalid: element.getAttribute('aria-invalid') || '',
    validationMessage: element.validationMessage || '',
    valid: element.validity ? element.validity.valid : true
  }));
  const committed = [state.value, state.text, state.ariaValueText].some(value => String(value || '').includes(action.value));
  if (!committed && action.requireCommitted !== false) {
    throw new Error(`selectComboboxOption blocked: selected value did not commit for ${selector}; expected ${action.value}`);
  }
  if (!state.valid) {
    throw new Error(`selectComboboxOption blocked: control invalid after selection for ${selector}: ${state.validationMessage || 'invalid control'}`);
  }
  return { selector, state };
}

async function readFileInputState(page, selector, timeoutMs) {
  const selectorPresent = await page.waitForSelector(selector, { timeout: timeoutMs || 10000 }).then(() => true, () => false);
  if (selectorPresent) {
    const input = await page.$(selector);
    if (!input) {
      throw new Error(`Resume upload blocked: selector not found after upload: ${selector}`);
    }
    const state = await input.evaluate(element => {
      const file = element.files && element.files[0];
      return {
        selectorPresent: true,
        file: file ? { name: file.name, size: file.size, type: file.type } : null,
        validity: {
          valid: element.validity ? element.validity.valid : true,
          valueMissing: element.validity ? element.validity.valueMissing : false,
          validationMessage: element.validationMessage || '',
          required: Boolean(element.required)
        },
        finalFileInputs: []
      };
    });
    await input.dispose();
    return state;
  }

  const finalFileInputs = await page.evaluate(() => Array.from(document.querySelectorAll('input[type="file"]')).map((element, index) => {
    const file = element.files && element.files[0];
    const id = element.id || '';
    const name = element.name || '';
    const ariaLabel = element.getAttribute('aria-label') || '';
    const labelledBy = element.getAttribute('aria-labelledby') || '';
    const labelText = id
      ? Array.from(document.querySelectorAll(`label[for="${CSS.escape(id)}"]`)).map(label => label.innerText.trim()).join(' ')
      : '';
    const nearbyText = (element.closest('label, div, section, fieldset') || element.parentElement || element).innerText || '';
    const descriptor = [id, name, ariaLabel, labelledBy, labelText, nearbyText].join(' ').replace(/\s+/g, ' ').trim();
    return {
      index,
      id,
      name,
      descriptor: descriptor.slice(0, 240),
      file: file ? { name: file.name, size: file.size, type: file.type } : null,
      validity: {
        valid: element.validity ? element.validity.valid : true,
        valueMissing: element.validity ? element.validity.valueMissing : false,
        validationMessage: element.validationMessage || '',
        required: Boolean(element.required)
      }
    };
  }));
  const invalidRequiredResumeInput = finalFileInputs.find(input => {
    const descriptor = input.descriptor.toLowerCase();
    return input.validity.required && !input.validity.valid && /resume|cv|curriculum/.test(descriptor);
  });
  return {
    selectorPresent: false,
    file: null,
    validity: invalidRequiredResumeInput ? invalidRequiredResumeInput.validity : {
      valid: true,
      valueMissing: false,
      validationMessage: '',
      required: false
    },
    finalFileInputs
  };
}

async function runAction({ page, manifest, manifestDir, action, runSlug, screenshots }) {
  if (action.type === 'goto') {
    const target = resolveUrl(manifestDir, action.url || manifest.job.url);
    await page.goto(target, { waitUntil: action.waitUntil || 'networkidle2', timeout: action.timeoutMs || 70000 });
    return { type: action.type, url: page.url() };
  }

  const sourceBackedTypes = new Set([
    'type',
    'check',
    'selectOption',
    'selectComboboxOption',
    'selectLabeledOption'
  ]);
  const provenance = sourceBackedTypes.has(action.type)
    ? requireApprovedProvenance(action)
    : null;
  const context = await resolveActionContext(page, action);

  if (action.type === 'click') {
    await context.waitForSelector(action.selector, { visible: true, timeout: action.timeoutMs || 10000 });
    const domSubmitCapable = await isSubmitCapable(context, action.selector);
    const submitCapable = Boolean(action.submit) || domSubmitCapable;
    if (submitCapable && manifest.mode === 'inspect') {
      throw new Error('Submit click blocked: inspect mode cannot execute a submit-capable action');
    }
    if (submitCapable && (!manifest.submissionAllowed || !ALLOW_SUBMIT)) {
      throw new Error('Submit click blocked: manifest.submissionAllowed and --allow-submit are both required');
    }
    const result = await guardedClick(context, action.selector, manifest, 'Submit click', Boolean(action.submit));
    return { type: action.type, selector: action.selector, submitCapable: submitCapable || result.submitCapable };
  }

  if (action.type === 'type') {
    await context.waitForSelector(action.selector, { visible: true, timeout: action.timeoutMs || 10000 });
    await context.click(action.selector, { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.keyboard.type(String(action.value || ''), { delay: action.delayMs || 3 });
    return { type: action.type, selector: action.selector, provenance };
  }

  if (action.type === 'waitForText') {
    await waitForBodyText(context, action.text, action.timeoutMs || 10000);
    return { type: action.type, text: action.text };
  }

  if (action.type === 'captureValidation') {
    const validation = await extractValidationState(context);
    if (action.failOnInvalid && validation.invalidControls.length > 0) {
      const labels = validation.invalidControls.map(item => item.label || item.context || item.id || item.name || item.type).join('; ');
      throw new Error(`Validation blocked: ${labels}`);
    }
    return { type: action.type, validation };
  }

  if (action.type === 'selectComboboxOption') {
    const result = await selectComboboxOption(context, action, manifest);
    return { type: action.type, selector: result.selector, value: action.value, provenance, state: result.state };
  }

  if (action.type === 'selectLabeledOption') {
    const result = await selectLabeledOption(context, action, manifest);
    return { type: action.type, selector: result.selector, label: action.label || null, value: action.value, provenance, state: result.state };
  }

  if (action.type === 'selectOption') {
    if (!action.selector || !action.value) {
      throw new Error('selectOption requires selector and value');
    }
    await context.waitForSelector(action.selector, { visible: true, timeout: action.timeoutMs || 10000 });
    await context.select(action.selector, action.value);
    const state = await context.$eval(action.selector, element => ({
      value: element.value || '',
      selectedText: element.selectedOptions && element.selectedOptions[0] ? element.selectedOptions[0].textContent.trim() : '',
      valid: element.validity ? element.validity.valid : true,
      validationMessage: element.validationMessage || ''
    }));
    if (!state.valid) {
      throw new Error(`selectOption blocked: control invalid after selection for ${action.selector}: ${state.validationMessage || 'invalid control'}`);
    }
    return { type: action.type, selector: action.selector, value: action.value, provenance, state };
  }

  if (action.type === 'check') {
    if (!action.selector) throw new Error('check requires selector');
    await context.waitForSelector(action.selector, { timeout: action.timeoutMs || 10000 });
    const alreadyChecked = await context.$eval(action.selector, element => Boolean(element.checked));
    if (!alreadyChecked) {
      await context.$eval(action.selector, element => {
        const label = element.closest('label') || (element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`) : null);
        (label || element).click();
      });
    }
    await context.$eval(action.selector, element => {
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    return { type: action.type, selector: action.selector, provenance };
  }

  if (action.type === 'screenshot') {
    const file = path.join(PROOF_DIR, `${runSlug}-${slug(action.label)}.png`);
    await page.screenshot({ path: file, fullPage: true });
    const relative = path.relative(ROOT, file);
    screenshots.push(relative);
    return { type: action.type, label: action.label, path: relative };
  }

  if (action.type === 'uploadResume') {
    const { absolutePath, stats } = resolveLocalResume(action.file);
    const selector = await findFileInputSelector(context, action);
    await context.waitForSelector(selector, { timeout: action.timeoutMs || 10000 });
    const input = await context.$(selector);
    if (!input) {
      throw new Error(`Resume upload blocked: selector not found: ${selector}`);
    }
    const inputType = await input.evaluate(element => String(element.getAttribute('type') || '').toLowerCase());
    if (inputType !== 'file') {
      throw new Error(`Resume upload blocked: selector is not a file input: ${selector}`);
    }

    await input.uploadFile(absolutePath);
    await input.evaluate(element => {
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });

    if (action.expectedText) {
      await waitForBodyText(context, action.expectedText, action.timeoutMs || 10000);
    }

    const finalState = await readFileInputState(context, selector, action.timeoutMs || 10000);
    const fileState = finalState.file;
    if (!fileState && !action.expectedText) {
      throw new Error(`Resume upload blocked: browser did not retain selected file for ${selector}`);
    }
    if (!finalState.validity.valid) {
      throw new Error(`Resume upload blocked: final file input is invalid for ${selector}: ${finalState.validity.validationMessage || 'invalid file input'}`);
    }

    return {
      type: action.type,
      selector,
      file: path.relative(ROOT, absolutePath),
      fileName: fileState ? fileState.name : path.basename(absolutePath),
      fileSize: fileState ? fileState.size : stats.size,
      fileType: fileState ? fileState.type : 'application/pdf',
      fileMtime: stats.mtime.toISOString(),
      sha256: fileSha256(absolutePath),
      expectedText: action.expectedText || null,
      pageTextConfirmed: Boolean(action.expectedText),
      inputValidity: finalState.validity,
      selectorPresentAfterUpload: finalState.selectorPresent,
      finalFileInputs: finalState.finalFileInputs
    };
  }

  throw new Error(`Unsupported action type: ${action.type}`);
}

async function main() {
  const manifestPath = process.argv.find(arg => arg.endsWith('.json'));
  if (!manifestPath) usage();

  const absoluteManifest = path.resolve(process.cwd(), manifestPath);
  const manifestDir = path.dirname(absoluteManifest);
  const manifest = requireManifest(absoluteManifest);
  Object.defineProperty(manifest, 'runtimeSuccessfulSubmitActionCount', {
    configurable: false,
    enumerable: false,
    writable: true,
    value: 0
  });
  fs.mkdirSync(PROOF_DIR, { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });

  const startedAt = new Date().toISOString();
  const runSlug = slug(`${manifest.runId}-${startedAt.replace(/[:.]/g, '-')}`);
  const log = {
    runId: manifest.runId,
    startedAt,
    finishedAt: null,
    job: manifest.job,
    mode: manifest.mode,
    receiptRequiredText: manifest.receipt ? manifest.receipt.requiredText : [],
    verifyRequiredText: manifest.verify ? manifest.verify.requiredText : [],
    actions: [],
    successfulSubmitActions: [],
    screenshots: [],
    receipt: null,
    verification: null,
    status: 'running',
    error: null
  };

  const browser = await puppeteer.launch({
    executablePath: browserExecutable(),
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage();
  await page.evaluateOnNewDocument(installSubmissionGuard, SUBMISSION_GUARD_TOKEN);
  await page.evaluate(installSubmissionGuard, SUBMISSION_GUARD_TOKEN);
  await page.setViewport({ width: 1365, height: 1600, deviceScaleFactor: 1 });

  try {
    for (const [actionIndex, action] of manifest.actions.entries()) {
      manifest.runtimeSuccessfulSubmitActionCount = log.successfulSubmitActions.length;
      const blockedBefore = await blockedSubmissionCount(page);
      const result = await runAction({ page, manifest, manifestDir, action, runSlug, screenshots: log.screenshots });
      const blockedAfter = await blockedSubmissionCount(page);
      if (blockedAfter > blockedBefore) {
        throw new Error(`Submission blocked during ${action.type}: action was not authorized by both submission gates`);
      }
      log.actions.push(result);
      if (result.submitCapable === true) {
        log.successfulSubmitActions.push({
          actionIndex,
          type: result.type,
          selector: result.selector || null
        });
      }
    }

    const text = await bodyText(page);
    if (manifest.mode === 'inspect') {
      const missing = manifest.verify.requiredText.filter(required => !text.includes(required));
      const hasScreenshot = log.screenshots.length > 0;
      const confirmed = missing.length === 0 && hasScreenshot;
      log.verification = {
        confirmed,
        finalUrl: page.url(),
        title: await page.title(),
        missingRequiredText: missing,
        textSnippet: text.slice(0, 2400)
      };
      log.status = confirmed ? 'page_verified' : 'page_not_verified';
      process.exitCode = confirmed ? 0 : 3;
    } else {
      const missing = manifest.receipt.requiredText.filter(required => !text.includes(required));
      const receiptScreenshotActionIndexes = log.actions
        .map((action, index) => action.type === 'screenshot' && /receipt/i.test(action.path || action.label || '') ? index : -1)
        .filter(index => index >= 0);
      const submitActionCount = log.successfulSubmitActions.length;
      const onlySubmitAction = submitActionCount === 1 ? log.successfulSubmitActions[0] : null;
      const hasReceiptScreenshot = onlySubmitAction !== null && receiptScreenshotActionIndexes.some(index => index > onlySubmitAction.actionIndex);
      const confirmed = submitActionCount === 1 && missing.length === 0 && hasReceiptScreenshot;
      const validationState = await extractValidationState(page);
      let outcome;
      if (submitActionCount === 0) outcome = 'no_successful_submit_action';
      else if (submitActionCount > 1) outcome = 'ambiguous_multiple_submit_actions';
      else if (!hasReceiptScreenshot) outcome = 'receipt_screenshot_missing_after_submit';
      else outcome = classifyReceiptOutcome({ manifest, text, receiptMissing: missing, validationState, hasReceiptScreenshot });
      log.receipt = {
        confirmed,
        successfulSubmitActionCount: submitActionCount,
        receiptScreenshotAfterSubmit: hasReceiptScreenshot,
        finalUrl: page.url(),
        title: await page.title(),
        missingRequiredText: missing,
        outcome,
        validation: validationState,
        textSnippet: text.slice(0, 2400)
      };
      log.status = confirmed ? 'submitted_receipt_verified' : 'receipt_not_verified';
      process.exitCode = confirmed ? 0 : 3;
    }
  } catch (error) {
    const blockerFile = path.join(PROOF_DIR, `${runSlug}-blocked.png`);
    try {
      await page.screenshot({ path: blockerFile, fullPage: true });
      log.screenshots.push(path.relative(ROOT, blockerFile));
    } catch {}
    log.status = 'blocked_or_failed';
    log.error = error.stack || String(error);
    process.exitCode = 1;
  } finally {
    log.finishedAt = new Date().toISOString();
    await browser.close();
    const logPath = path.join(LOG_DIR, `${runSlug}.json`);
    fs.writeFileSync(logPath, JSON.stringify(log, null, 2) + '\n');
    console.log(JSON.stringify({ status: log.status, runId: log.runId, logPath: path.relative(ROOT, logPath), screenshots: log.screenshots, receipt: log.receipt, error: log.error }, null, 2));
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  browserExecutable,
  classifyReceiptOutcome,
  requireApprovedProvenance,
  requireManifest,
  resolveLocalResume,
  slug
};
