# Storage v2: code-review handoff (Bones)

Branch `b15-storage-v2`, based on main `3de480e`. It was pushed **without a PR** (Jess's ruling). All three
sites linked to the repository build only `main`, and previews are built only for PRs, so the push
triggered no build or deployment.

No merge, preview, deployment, credential, publication, probe, GHL, cutover or barrier action has been
taken. **Production remains held.**

## What to review

**The whole implementation, not only the new suites.** In particular, review the existing suites whose
assertions were restated. Each restatement carries an inline `/* Storage correction: … */` comment
explaining why.

| Area | Where |
|---|---|
| Verified storage adapter, deadlines, diagnostics | `app/netlify/functions/lib/verified-store.ts`, `invocation-scope.ts`, `diagnostics.ts` |
| Send ownership, lock v2, stage marker v2 | `owned-send.ts`, `contact-lock-v2.ts`, `stage-marker-v2.ts`, both barrier libraries |
| One authoritative record, T0–T9, classifier | `admission.ts` |
| Write gate, G5, cutover, legacy import, receipts | `write-gate.ts`, `g5-gate.ts`, `cutover.ts`, `legacy-import.ts`, `write-receipts.ts` |
| The five endpoints (modern runtime) | `call-log-barrier.ts`, `current-offer-barrier.ts`, `ghl-write.ts`, `ghl-disposition.ts`, `ghl-executed-artifact-upload.ts`, plus `modern-runtime.ts`, `endpoint-kit.ts`, `capability.ts` |
| Credential rename (14 consumers) | `ghl-token.ts` and each consumer |
| Publication and cutover tools | `iaos-activation.ts`, `iaos-cutover.ts`, `app/scripts/iaos-publish.cjs` |
| Probes and build guard | `storage-probe.ts`, `probe-limit.ts`, `app/scripts/production-build-guard.cjs` |
| Client | `src/lib/v2-ids.ts`, `app-write-session.ts` (activation echo), the call-log and offer clients, `CallLogControl.tsx` |
| Docs | `STORAGE_V2_LIFECYCLE.md`, `STORAGE_V2_CUTOVER_RUNBOOK.md` (Owner exception verbatim), `G5_LEGACY_PATH_AUDIT.md` |

## Offline test results (exit codes from one sequential run of every `app/scripts/test-*.cjs`)

**119 of 122 suites pass.** Typecheck (`tsc -b`) and `vite build` both pass.

**The three failing suites:**

| Suite | Why it fails | Status |
|---|---|---|
| `test-deal-calculator-wiring.cjs` | fails identically on main `3de480e` | pre-existing; unrelated |
| `test-write-webhooks.cjs` | the marketing-site webhooks `phone-lookup` and `motivation-score` use the app's GHL boundary, which v2 refuses without the app's write gate | **regression**; scoped path specified for review in `STORAGE_V2_MARKETING_WEBHOOKS.md`, not implemented (Jess's ruling) |
| `test-inv95.cjs` | an aggregate of 40 suites; its only failing member is `test-write-webhooks` | the same regression (on main this aggregate exceeded the runner's 300 s limit; on this branch it completes in about 198 s) |

**Behaviour regressions held fail-closed** (refused retry paths that used to work): R1–R5 in
`STORAGE_V2_UNCERTAIN_WRITE_RECOVERY.md`, each with its test evidence and a recovery proposal.

**Latency figures are offline simulations, not live performance proof.**
- **What was measured:** round-trip counts measured over the offline wire harness with a fixed injected
  latency, then a 1,000-save Monte Carlo over those counts using the plan's modelled distribution (p50
  150 ms, p95 600 ms, p99 1.5 s).
- **What it proves:** only that the code's sequential storage round trips fit the pinned budget rows
  under that model.
- **What it does not prove:** real Netlify Blobs latency, and the execution limit `L_obs`. Both are
  release evidence from the gated Test probes.

## Recorded limitations and open items

- **Request normalization.** The Fetch `Request` normalizes the method (a raw lowercase `post` arrives as
  `POST`) and trims header-value whitespace (an Origin with a leading space is seen as the approved
  origin). The old refusals for those two inputs cannot be reproduced on the modern runtime.
- **Operator credential files.** Operator scripts under `app/scripts/` that read `GHL_PRIVATE_API_KEY` from
  a credential file were not renamed; they will need the new credential after cutover.
- **Marketing credential.** `GHL_API_TOKEN` (marketing site) must be placed in the C0 credential inventory
  (see the webhook specification).
- **Release prerequisites,** unchanged:
  - P5 provider semantics (without them, controlled publication cannot complete);
  - the publisher identity's permissions;
  - every C0–C8 step, separately authorized;
  - the G5 audit's deploy inventory (a gated read).
