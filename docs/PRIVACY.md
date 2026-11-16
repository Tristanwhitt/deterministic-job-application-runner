# Privacy

The repository intentionally excludes:

- real employer URLs and manifests;
- applicant defaults and contact details;
- real resumes and tracker data;
- browser profiles, cookies, credentials, and account linkage;
- logs, screenshots, proof packets, and other generated artifacts;
- internal orchestration prompts or operating instructions;
- machine-specific user paths.

Only generic disabled templates plus synthetic test names, values, pages, and a synthetic PDF upload fixture are committed. Runtime artifacts and private input directories are ignored. `npm run doctor` reports only readiness metadata such as counts and file state; it does not print resume contents or approval values.

Before publishing, run:

```sh
npm run check:privacy
npm run check:links
```

The privacy scan detects common contact data, machine-local paths, credential assignments, private-key material, social profile URLs, and unexpected URLs. It complements, but does not replace, a manual review of the final inventory.
