# Deterministic Application Runner

A sanitized portfolio package demonstrating deterministic browser automation for job-application forms. It executes explicit manifests, verifies committed form state, records local proof artifacts, and refuses to count a submission without receipt text plus a receipt screenshot.

This repository contains synthetic fixtures only. It does not include real employer manifests, applicant data, resumes, trackers, account sessions, credentials, or generated run artifacts.

## Attribution and scope

This work demonstrates deterministic browser-runner engineering and agent-workflow safety design. It does **not** claim model training. A planner or agent may propose a manifest, but the runner owns interaction safety, validation, and proof classification.

## Requirements

- Node.js 22.12 or newer
- A local Chromium-family browser

The runner searches common browser commands and the standard macOS Chrome installation. To select a browser explicitly, set `APPLICATION_RUNNER_BROWSER` to its executable.

## Install

```sh
npm ci
```

## Verify

```sh
npm run check:syntax
npm test
npm run test:smoke
npm run check:privacy
npm run check:links
npm run verify
```

`npm run test:smoke` opens local `file:` fixtures only. It exercises receipt verification, no-receipt diagnosis, hidden file upload, dynamic selections, iframe targeting, and both submission gates. It does not access employer pages.

## Run the synthetic example

```sh
APPLICATION_RUNNER_APPROVALS_FILE=fixtures/synthetic-approvals.json \
  node runner.js fixtures/smoke-manifest.json --allow-submit
```

The fixture is local, but the two-key submit rule still applies:

1. the manifest must set `submissionAllowed: true`; and
2. the process must receive `--allow-submit`.

The runner derives submit capability from the resolved DOM control. A false or omitted manifest `submit` hint cannot downgrade a submit/apply control.

## Manifest contract

See [the synthetic example manifest](fixtures/smoke-manifest.json). Submit-mode manifests require receipt text. Inspect-mode manifests require verification text. Personal-data actions such as typing, checking, or selecting require structured, explicitly approved provenance:

```json
{
  "type": "selectComboboxOption",
  "label": "Location (City)",
  "value": "Example City",
  "optionSelector": "#location-options [role=option]",
  "provenance": {
    "approvalId": "react-select-smoke-manifest-1",
    "kind": "synthetic_fixture",
    "reference": "fixtures/react-select-smoke.html#location"
  }
}
```

Every source-backed action must match an independently maintained approval record by ID, action type, value, kind, and reference. Set `APPLICATION_RUNNER_APPROVALS_FILE` to a registry stored outside the repository (for example, `private/approvals.json`). A manifest cannot approve itself. The committed registry approves synthetic fixtures only.

For non-native comboboxes, provide an explicit `optionSelector` or set `clickOptionText: true` so the runner clicks only an accessible option. The runner never presses Enter implicitly to commit a selection because Enter can submit the surrounding form.

Resume uploads are restricted to PDFs under `private/resumes` by default. That directory is ignored. Tests override the allowlisted directory to use the synthetic PDF fixture:

```sh
APPLICATION_RUNNER_APPROVALS_FILE=fixtures/synthetic-approvals.json \
APPLICATION_RUNNER_RESUME_DIR=fixtures/resumes \
  node runner.js fixtures/upload-smoke-manifest.json
```

## Output

Runs write logs and screenshots under `artifacts/`, which is ignored. A successful submit-mode run requires all configured receipt text and at least one screenshot whose label contains `receipt`. Otherwise the run is non-countable.

## Design notes

- [Architecture](docs/ARCHITECTURE.md)
- [Safety](docs/SAFETY.md)
- [Privacy](docs/PRIVACY.md)
