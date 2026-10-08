# Board 15 combined build: integration handoff (Bones)

A **local** integration branch, `b15-integration`. Not pushed, no PR, no merge to main, no deployment,
credential change or cutover. **Production remains held.** The next milestone is a reviewed combined
build, not a release.

## Inputs (each approved by Bones at its exact SHA; code review only)

| Input | Exact SHA | Approval |
|---|---|---|
| Storage v2 | `51d7238306beb2e91d09d6a877f67599df974f64` | PR #131 `#issuecomment-6049450009` |
| Storage handoff doc correction (doc only, Bones's non-blocking item) | `58f7d4ac9473b6a5bf1d500cb87ab88df58c58ea` | parent is `51d7238`; requested by Jess |
| Scotty Batch 1 | `17a1252de9ca48ff081b51f5089f2b654b06dd9e` | INV-132 (Bones, 2026-10-08) |
| Scotty Batch 2 | `4e4e7f9a8c65588d667344f7000780d4fd76101e` | INV-108 (Bones, 2026-10-08) |

All three lines branch from main `3de480e`, which is still main.

## Commit map (first parent: the integration line)

| Commit | What |
|---|---|
| `58f7d4a` | base: approved storage `51d7238` + the doc correction |
| `a81afbc` merge of `17a1252` | Batch 1: `2e3099d`, `2ae787e`, `7e6a41d`, `bd7b4de`, `7b78a46`, `546eed6`, `8136fd8`, `17a1252` |
| `9a43c22` merge of `4e4e7f9` | Batch 2 only: `5d99552`, `9542868`, `018acec`, `0b9454a`, `66e563e`, `d248b6a`, `4e4e7f9` |
| `9a68348` | CI: the 15 focused suites |
| `a03cfcd` | CI: after the build, assert the guard removed the Test-only probes, then restore their sources |
| this commit | this handoff |

**The duplicated email patch is included once.** Batch 2's `018acec` is a cherry-pick of Batch 1's
`17a1252`: the stable patch ids match (`964a086a…`). Batch 2 forks from `8136fd8`, so merging Batch 1
and then Batch 2 sees the identical change on both sides and applies it once. After the merges the
three affected files (`app/src/lib/message-links.ts`, `app/src/pages/Conversations.tsx`,
`app/scripts/test-message-links.cjs`) are byte-identical to `17a1252`. Both merges were conflict-free;
the only shared file with storage is `app/package.json` (separate hunks). The two merges touch no
reviewed code: the merged tree equals the dry-run tree `16ba4ba` computed before approval.

## Integration-level changes (CI only; review these)

1. **`9a68348`: 15 focused suites added to CI.** None ran in CI before.
   - Storage (9): `test-storage-adapter`, `-ownership`, `-admission`, `-g5-import`, `-endpoints`,
     `-budgets` (an offline simulation, not live latency proof), `test-iaos-publish`,
     `test-iaos-cutover`, `test-page-activation-binding`.
   - Batch 1 (4): `test-message-links`, `test-b15-conversations-ghl-buttons`, `test-deal-calculator-bar`,
     `test-deal-calculator-wiring`.
   - Batch 2 (2): `test-pipeline-property`, `test-b15-ghl-shortcuts`.
2. **`a03cfcd`: a CI ordering fix found by running CI in order.** The build step runs
   `production-build-guard.cjs`, which deletes `storage-probe.ts` and `probe-limit.ts` from the checkout
   (CI's `SITE_NAME` is not `iaos-app-test`). `test-storage-endpoints` then failed 1 of 50 (its probe
   check reads `storage-probe.ts`). The new step asserts both files are absent after the build (the guard
   worked), then restores them from git. The build output is already final and is not rebuilt.

## Combined results at this branch (offline; Jeff's machine)

- **Every CI step in CI order** (all 48 `run:` steps after dependency install, including the four PDF
  steps with local Poppler, the app build, the 15 new suites, root-functions `tsc`, identifier boundary,
  exit contract static and runtime, `test-inv95` 40/40): **48 of 48 exit 0** (after `a03cfcd`; before it,
  47 of 48 with the probe failure above).
- **Every `app/scripts/test-*.cjs`: 127 of 127 exit 0.** The long-standing `test-deal-calculator-wiring`
  baseline failure is fixed by Batch 1's `7b78a46` and passes here.
- **Overlap checks:** Deal Calculator (`-bar`, `-wiring`, `-interaction` with storage's page binding);
  shell and navigation (`test-b15-navigation`, `test-b15-signin-pages`, `test-page-activation-binding`,
  under storage's `Layout.tsx` binding); Conversations (`test-message-links`,
  `test-b15-conversations-ghl-buttons`, `test-inv95`). All pass.
- **Not run here:** exact-head GitHub CI (the branch is not pushed), and the real-browser page checks
  Bones ran on each head (session recovery 60/60, Pipeline/shortcuts 33/33, Conversations bidi 10/10).
  Rerunning those on the combined tree is the recommended integration review.

## Unresolved limitations (explicit; none fixed by this build)

**Pipeline opportunities-read race (INV-108, reproduced by Bones at `4e4e7f9`, OPEN).**
`Pipeline.tsx` (the `listPipeline` effect) has no generation or cleanup guard. Bones held an older
opportunities read, completed a newer read with a changed contact association, then released the older
response: the older rows and their older contact links came back. This predates the batch. Not a blocker
to the approved corrections, but a real read-refresh correctness defect: **this build does not claim fresh
opportunity rows after overlapping recovery reads.** Required follow-up: generation/cleanup guards on
both success and failure, with real-page out-of-order tests.

**Other open scope from the batch approvals:**
- INV-108: the deal-to-property association is unresolved. Addresses are labelled as the contact's
  Property Address field, not confirmed for the deal.
- INV-125: Add Leads is guidance only; no live intake workflow is established.
- B15-23 / INV-132: remaining scope open; live GHL navigation, sign-in handoff and post-sign-in
  redirects are unverified. SMS and Contact Workspace history stay unlinked.
- The GHL shortcuts were verified offline only; a shortcut does not restore IAOS calendar API access.

**Storage holds (unchanged):**
- **Marketing webhooks** (`phone-lookup`, `motivation-score`): held (503 before any provider or GHL call)
  pending decision A. Not restored functionality.
- **R1–R5 uncertain-write recovery:** held pending decision B. Not restored functionality.
- **Request normalization** limits on the modern runtime; operator scripts still read
  `GHL_PRIVATE_API_KEY`; `GHL_API_TOKEN` must enter the C0 credential inventory.

## Release prerequisites (each separately gated; none authorized)

- **Merging is itself C2:** merging to main auto-publishes Test. From then every app write on Test returns
  503 until the admission record exists and C3–C7 are complete. Production is unaffected while its
  auto-publish lock stays on.
- **C0–C8** (`docs/STORAGE_V2_CUTOVER_RUNBOOK.md`): C0 credential inventory; C1 new secrets; C2 merge;
  C3 import owner, S1, G5 init; C4 legacy credential revocation and `T_r`; C5 S2/S3, dry run,
  completion, manifest approval; C6 G5 audit and table digest approval; C7 `L_obs` and latency probes
  on Test, then publish and activate; C8 Spock's rerun on an eligible synthetic contact.
- **P5 provider semantics** for Netlify restore; without them no publication reaches APPLIED. The offline
  test semantics are fixtures, not evidence.
- **Publisher identity permissions** (Test and Production), and live confirmation of
  `context.deploy.published` / `deploy.id`.
- Production publication remains Brad's manual, locked step.
