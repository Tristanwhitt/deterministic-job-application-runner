# Deterministic Job Application Runner

## What this is

A reusable local, manifest-driven browser runner for **one reviewed job application at a time**. Install it on your computer, keep your own resume and answers in ignored private storage, and use a reviewed action manifest to inspect or operate a supported official employer/ATS form.

**Problem it solves:** job-application helpers can otherwise improvise answers, click the wrong control, submit too early, or report success without proof. This runner narrows that risk with exact actions, separate answer approvals, two independent submission keys, and receipt-based success.

**What it actually does:** opens a declared official employer or applicant-tracking-system (ATS) URL in a fresh headless Chromium session; types, checks, selects, uploads a PDF, waits, validates, clicks, and screenshots only as directed by a reviewed manifest; blocks unapproved source-backed values and unauthorized direct or indirect form submission; then writes ignored local artifacts.

**What it does not do:** it is not a universal auto-apply agent, job board scraper, tracker, duplicate detector, answer generator, CAPTCHA/MFA solver, or direct LinkedIn/Indeed integration. It does not control an already-open browser tab or reuse that tab's signed-in session. Real sites can change and may require manual handling or new, reviewed selectors.

Start with [the Claude Code operator guide](CLAUDE-CODE-GUIDE.md), then consult [Safety](docs/SAFETY.md), [Privacy](docs/PRIVACY.md), and [Architecture](docs/ARCHITECTURE.md).

## Who does what

The names below describe roles, not required software components:

- **Lead scout (sometimes called Pacer):** finds a possible role on LinkedIn, Indeed, or elsewhere and records the lead. A job-board URL is discovery evidence, not the runner target.
- **Queue/review coordinator (sometimes called Harper):** checks fit, freshness, duplicates, blockers, and the official employer/ATS route before a role enters preparation.
- **Human owner:** supplies truthful answers, reviews sensitive commitments, maintains the separate approval registry, authorizes the exact final application, and decides when manual handling is required.
- **Claude Code:** reads this repository, helps draft and review private manifests, collects unanswered questions, and diagnoses artifacts. It is a planning assistant, not an authorization source.
- **Runner (`runner.js`):** executes only its declared action vocabulary and enforces approvals, submit gates, validation, and proof classification. There is no model runtime in the runner.

```mermaid
flowchart LR
  A[Source job lead] --> B[Open official employer or ATS route]
  B --> C[Prepare inspect-only manifest]
  C --> D[Human reviews answers]
  D --> E[Separate approval registry]
  E --> F[Runner fills fields and uploads PDF]
  F --> G{Explicit two-key submit?}
  G -- No --> H[Inspect-only evidence]
  G -- submissionAllowed true AND --allow-submit --> I[Submit once]
  I --> J[Verify receipt text and receipt screenshot]
  J --> K[Local proof artifacts]
  J -- Ambiguous or missing --> L[Stop; check manually; do not auto-retry]
```

## Operating modes

Only `inspect` and `submit` are literal manifest modes. The other labels are human workflow stages:

1. **Lead-only / research:** use a LinkedIn or Indeed screenshot or URL to identify a role, then find the official employer/ATS application URL. Do not run against the job-board lead.
2. **Inspect-only:** use `"mode": "inspect"` and `"submissionAllowed": false`. The runner may perform reviewed non-submit actions and verify expected page text plus a screenshot, but submit-capable interactions are blocked.
3. **Prepare-for-review:** draft the final actions, surface unanswered questions, independently review approval-registry entries, confirm the resume and URL, and check for a duplicate. This is not a runner mode and grants no submission permission.
4. **Submit:** use `"mode": "submit"`, include required receipt text, set `"submissionAllowed": true`, and separately invoke the exact run with `--allow-submit`. Both keys are mandatory.
5. **Receipt verification:** the runner blocks a second submit-capable action in the same run. Count success only when exactly one authorized submit-capable action succeeded, status is `submitted_receipt_verified`, all configured receipt text is present, and a later screenshot action with `receipt` in its label exists. Pre-existing receipt content, zero submit actions, a blocked additional attempt, or any other ambiguity must not be counted or retried automatically.

## Supported interactions

The implementation and synthetic tests cover:

- navigation to declared `file:`, `http:`, or `https:` targets;
- exact-selector clicks with DOM-based submit/apply detection;
- text entry and checkbox changes;
- native `<select>` values;
- labeled native or dynamic selections;
- React-style combobox selection through an explicit option selector or accessible `role="option"` text;
- hidden or visible PDF resume inputs, including filename/size/type/hash logging;
- waits for exact body text, HTML validation capture, and fail-on-invalid checks;
- full-page screenshots and JSON run logs;
- actions inside a matching iframe via `frameUrlPattern`;
- direct and indirect form-submission blocking when both submit keys are absent;
- Greenhouse-oriented no-receipt/returned-form diagnostics.

The runner intentionally does not press Enter to commit dynamic selections because Enter can submit a surrounding form. Support in a synthetic fixture is not a promise that every live ATS implementation will work unchanged.

## Safety and stop conditions

Stop and use manual handling for CAPTCHA, MFA or email verification, login/account creation, assessments, demographic or legal attestations, ambiguous or unsourced answers, salary/relocation/sponsorship commitments, unsupported widgets, failed uploads, unclear consent, or any changed page that invalidates reviewed selectors.

Additional boundaries:

- Use LinkedIn and Indeed only to discover leads; target the official employer/ATS application page.
- Never invent an answer. `type`, `check`, and selection actions require provenance that exactly matches a separately maintained approved record.
- A manifest cannot approve itself. Approval of an answer is not approval to submit.
- The runner detects submit capability from the live DOM; manifest metadata cannot disguise a submit/apply control as harmless.
- Never automatically retry an uncertain submit. First determine manually whether an application was received.
- Do not use the runner for bulk or duplicate submissions, access-control bypass, or hiding automation where disclosure is required.

## Privacy boundary

Committed examples and tests use synthetic data only. The tool is intended to run with user-owned data kept under ignored `private/` paths: real resumes, manifests, approval registries, applicant data, and employer-specific material. Generated logs and screenshots stay under ignored `artifacts/` paths. Never place passwords, cookies, session tokens, private keys, MFA codes, recovery codes, or email verification codes in prompts, manifests, commands, logs, or tracked repository files.

The runner launches a new headless browser process without a persistent profile. It does not inherit cookies or authentication from your regular Chrome window. If the official application requires an authenticated session, stop and complete it manually; do not copy session secrets into the runner.

## Quick start

Requirements: Node.js 22.12 or newer and an installed Chromium-family browser.

```sh
npm ci
npm run verify
npm run setup
npm run doctor
```

`npm run setup` is idempotent: it creates ignored `private/resumes/`, `private/manifests/`, `private/approvals.json`, `artifacts/logs/`, and `artifacts/proofs/` without replacing existing private files. It also copies a safe inspect-manifest template into private storage. Place your PDF at `private/resumes/resume.pdf`, edit the copied manifest for one official employer/ATS route, and independently review the disabled approval template before changing any entry to `approved: true`.

`npm run doctor` reports the Node version, Chromium-family browser discovery, private-directory state, runner-usable approval-schema validity/counts, and whether the private resume files have recognizable readable PDF structure. It never prints resume contents, filenames, or approval values.

Run the repository's local synthetic submission fixture:

```sh
APPLICATION_RUNNER_APPROVALS_FILE=fixtures/synthetic-approvals.json \
  node runner.js fixtures/smoke-manifest.json --allow-submit
```

This opens only a local fixture and demonstrates the two-key gate. For a real application, begin in inspect-only mode:

```sh
APPLICATION_RUNNER_APPROVALS_FILE=private/approvals.json \
  node runner.js private/manifests/example-company-example-role.json
```

Set `APPLICATION_RUNNER_BROWSER` to an absolute Chromium executable path only if automatic discovery fails. The runner writes ignored JSON logs to `artifacts/logs/` and screenshots to `artifacts/proofs/`.

## Manifest and approval essentials

Start with the committed [inspect manifest template](templates/inspect-manifest.template.json) and [approval template](templates/approvals.template.json); `npm run setup` copies both into ignored private storage without overwriting existing work. The approval entry is deliberately disabled. The [synthetic manifest](fixtures/smoke-manifest.json) exists for automated tests, not as applicant data.

An inspect manifest needs nonempty `verify.requiredText`; a submit manifest needs nonempty `receipt.requiredText`. Every source-backed `type`, `check`, `selectOption`, `selectComboboxOption`, or `selectLabeledOption` action needs structured provenance whose ID, action type, value, kind, and reference exactly match an `approved: true` entry in the external registry selected by `APPLICATION_RUNNER_APPROVALS_FILE`.

Resume uploads accept only existing regular PDF files under `private/resumes/` by default. Tests override this directory to use the committed synthetic fixture.

## Verify the repository

```sh
npm run verify
```

That command runs syntax checks, unit regressions, local browser smoke tests, the privacy scan, and Markdown link checks. Smoke tests access local `file:` fixtures only; they do not visit employer pages.

## Deeper documentation

- [Claude Code operator guide](CLAUDE-CODE-GUIDE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Safety](docs/SAFETY.md)
- [Privacy](docs/PRIVACY.md)
