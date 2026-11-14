# Architecture

The package separates planning from deterministic execution.

1. A manifest declares a job descriptor, ordered browser actions, and expected proof.
2. `runner.js` validates the manifest and resolves only the declared actions.
3. Puppeteer controls a local Chromium-family browser.
4. Each action verifies resulting state where applicable.
5. The runner classifies the final page as verified, not verified, or blocked.
6. JSON logs and screenshots are written to ignored local artifacts.

Core modules:

- `runner.js`: manifest validation, browser actions, submit gating, provenance checks, validation extraction, and receipt classification.
- `csv-records.js`: logical CSV record and column parsing, including quoted newlines and escaped quotes.
- `fixtures/`: synthetic local pages and manifests.
- `tests/`: unit regressions and browser smoke coverage.
- `scripts/`: syntax, privacy, and Markdown-link checks.

There is no model runtime in this package. Agent workflows can produce manifests, but they do not bypass runner policy.
