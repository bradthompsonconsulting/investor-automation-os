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

## Re-review: Bones's findings on `e982ed0` (`#issuecomment-6046546656`)

Each fix is a separate commit with adversarial regressions. "Pre-fix" means the regression was run
against the unfixed code and failed there.

| # | Finding | Fix commit | Regression evidence |
|---|---|---|---|
| 1 | G5 widening raced an entered invocation | `23fe554` | **The design:** the effective G5 table now lives in `authz/admission`. Admit and Dispatching check it inside their own compare-and-swap. `g5_widen` applies the block in one compare-and-swap that also revokes admitted overlapping tickets. A narrowing is staged and only a fresh activation copies it in. **The tests:** `test-storage-endpoints` W-1/W-2/W-3 drive the real `g5_widen` handler at three points of a real `ghl-write` note: after entry, after Admit, after Dispatching. W-1 fails pre-fix |
| 2 | Preview control endpoints mutated shared records | `8856ec6` | Every POST action on `iaos-activation` and `iaos-cutover` requires a published production deploy. `test-iaos-cutover` CT-9 covers all 18 mutating actions under deploy-preview, unpublished production, branch-deploy and missing contexts: 403, zero storage writes, records unchanged |
| 3 | The publisher lost its identity across commands | `652dc3d` | **The tool:** one-process `cycle` (Close to Activate) and `resume` (handover, reclassify the stored response, activate). **The protocol:** T7 may take over a `responded` attempt. **The tests:** `test-iaos-publish` runs every command as a separate child process: RESPONDED, process exit, later semantics, `resume`; activation finished by a new process; a kill mid-dispatch stays blocked; exactly one restore request ever |
| 4 | Import let a later success cover an earlier unsafe attempt | `c2b4bf5` | Every attempt needs exact terminal evidence. `test-storage-g5-import` I5b reproduces the review case and two variants (fails pre-fix: `class=resolved`) |
| 5 | Import could not resume after owner completion | `0b21b27` | Idempotent same-owner resume; `T_r` frozen into the owner record. I8b reproduces the review case (fails pre-fix: "already complete"); I8c covers ack-lost; I8d refuses a changed `T_r`, token or capture |
| 6 | Marketing webhook made a partial, ungated tag write | `c518628` | Tags now go through gated boundary methods. Both webhooks are **uniformly held**: 503 before any provider or GHL call, with no exception introduced. `test-write-webhooks` exercises each real handler independently. **This is still a held loss of functionality pending Jess decision A** |
| 7 | A stale page adopted a later activation | `c50a3b9`, `8662a12` | The page binds once at first read sign-in, before any save, and never re-reads. `test-page-activation-binding` runs the real module: the review case (first save echoes A1, not A2) and a failed initial bind followed by reactivation |

**Proposal documents amended (still proposals, not implemented):**
- `STORAGE_V2_UNCERTAIN_WRITE_RECOVERY.md` (item B): recovery is not restored. P-A and P-B now require
  request-specific evidence plus supported terminal semantics; an approval is not clearance.
- `STORAGE_V2_MARKETING_WEBHOOKS.md` (item A): the exception is NOT cleared; the evidence required before
  one can be considered is listed.

**Full offline run after the fixes:** 122 of 123 suites pass.
- **The one failure:** `test-deal-calculator-wiring`, the unchanged baseline failure. It fails
  identically on main `3de480e`.
- **During the run:** two new regressions caused by finding 7 (`test-app-read-auth`,
  `test-under-contract-stage-result`) were found and fixed in fixtures in `8662a12`; no assertion
  changed. `test-inv95` now passes 40/40.
- **Typecheck and build:** `tsc -b`, the root-functions `tsc` and `vite build` all pass.
- **Unverified here:** four PDF suites need `pdftotext`. They passed on Jeff's machine, but Bones's
  environment lacks the tool, so they remain unverified there.

## Re-review: Bones's findings on `20d7a62` (`#issuecomment-6048531462`)

| # | Finding | Fix commit | Regression evidence |
|---|---|---|---|
| 1 | Import missed an uncertain attempt after a missing ordinal | `bbed3eb` | The importer takes the union of every observed attempt record for the operation. Every version must be exactly bound (slot, ordinal, request id, key); each slot's ordinals must be exactly 1..max; each attempt needs its exact dispatch binding plus a send decision and confirmed outcome. `test-storage-g5-import` I5c (the review case, a gap with a confirmed later attempt, a missing attempt 1) and I5d (seven inconsistent-record variants, and orphan evidence halting as unattributed). Both fail pre-fix (review case: `class=resolved`) |
| 2 | The publisher's continuation after an abandoned attempt could not run | `25a26cd` | New `iaos-publish next-attempt`: the same publication, after ABANDONED or REJECTED with nothing outstanding; handover then one new attempt, history retained, then activation. T7 handover is bound to the named publication inside its compare-and-swap. `test-iaos-publish` PC-9 (the review case through to activation, one restore), PC-10 (REJECTED via `cycle` and via `resume`), PC-11 (refusals: dispatching and unresolved exit 3, other publication or target exit 1, after APPLIED exit 2, an unbound or mismatched handover refused). All three fail pre-fix |
| 3 | Exact-head CI red on the identifier-boundary scanner | `4d41548` | `TransitionUnresolved` (an Error-class name) added as an exact-value exemption, following the INV-60/INV-62 precedent; no file or directory exempted, floor unchanged at 10. New near-miss control `TransitionUnresolvez`; a real id added to `admission.ts` still fails the scan |

**Full offline run after the fixes:** 122 of 123 `app/scripts/test-*.cjs` pass. The one failure is the unchanged baseline `test-deal-calculator-wiring` (fails identically on main `3de480e`). No new regression. Root checks: identifier boundary 10/10, exit contract static and runtime, Netlify observer, root-functions `tsc`, and `pnpm --dir app build` (guard, `tsc -b`, `vite build`) all pass.

**Unchanged holds:** marketing webhooks (decision A) and R1–R5 recovery (decision B) remain held; nothing here restores either.

**Scotty Batch 1** (code-review approved at `8136fd893257f07cda962085a6d2cef554cf4fbe`, head of `b15-scotty`) is not part of this branch. It is kept for later integration; its four focused suites go into CI when the batch is integrated.
