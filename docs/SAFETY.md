# Safety

## Submission authorization

A resolved control is submit-capable when its native DOM behavior, visible text, accessible text, selector signal, or manifest metadata indicates submit/apply behavior. Clicking such a control requires both `submissionAllowed: true` and `--allow-submit`.

Inspect mode requires `submissionAllowed: false` exactly and rejects submit-capable controls even when `--allow-submit` is present. The runner blocks a second submit-capable action in one run. Submit success additionally requires exactly one successful authorized submit-capable action and a later receipt-labelled screenshot; zero or additional attempts remain non-countable.

The DOM classification is authoritative: caller metadata may strengthen classification but cannot downgrade it.

## Source-backed answers

`type`, `check`, and selection actions require a provenance object with a nonempty approval ID, kind, and reference. The ID must resolve in the external registry selected by `APPLICATION_RUNNER_APPROVALS_FILE`, and that trusted record must match the action type, value, kind, and reference exactly. The registry—not the caller-controlled manifest—holds `approved: true`.

Store production approval registries under ignored private storage. The committed registry approves synthetic fixtures only. Validation happens before the runner interacts with the target control.

## Selection boundaries

Non-native selections require an explicit `optionSelector` or `clickOptionText: true`. Text matching is restricted to elements with `role="option"`. Every resolved option target passes through the same DOM submit-capability classification and two-key authorization gate as an ordinary click. The runner does not use an implicit Enter keystroke to commit selections because Enter can submit the surrounding form and bypass click classification. Synthetic regression fixtures prove that under-specified combobox actions, submit controls disguised as option selectors, and role-less list items block rather than submitting.

## Upload boundaries

Resume actions accept only existing regular PDF files inside the configured resume directory. Uploads use the page file input, including hidden inputs, and fail if the browser does not retain a valid selected file. Logs record file metadata and SHA-256.

## Proof boundary

A submit-mode run is counted only when every configured receipt string is present and a receipt-labeled screenshot exists. Validation-blocked and no-receipt outcomes remain non-countable.

The included smoke suite uses local synthetic pages only.
