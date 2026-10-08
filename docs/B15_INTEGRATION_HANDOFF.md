# Board 15 combined build: integration handoff (Bones)

Branch `b15-integration`, pushed **branch-only** (no PR). No merge to main, deployment, credential change,
cutover or live mutation. **Production remains held.** The milestone is a reviewed combined build, not
a release. The previous reviewed comparison point is `16110d4` (storage + Batches 1–2 + CI fixes).

## Inputs (each approved by Bones at its exact SHA; code review only)

| Input | Exact SHA | Base | Approval |
|---|---|---|---|
| Storage v2 | `51d7238306beb2e91d09d6a877f67599df974f64` | main `3de480e` | PR #131 `#issuecomment-6049450009` |
| Storage handoff doc correction (doc only) | `58f7d4ac9473b6a5bf1d500cb87ab88df58c58ea` | `51d7238` | requested by Jess |
| Batch 1 (B15-23 / INV-132, INV-134) | `17a1252de9ca48ff081b51f5089f2b654b06dd9e` | main | INV-132 |
| Batch 2 (B15-09 / INV-108, INV-125, B15-07) | `4e4e7f9a8c65588d667344f7000780d4fd76101e` | `8136fd8` | INV-108 |
| Batch 3 (B15-09 opportunities-read race) | `eccffae367c204ffd121eb21e65bbf94666089fe` | main | INV-108 (approval + addendum) |
| Batch 4 (B15-26 / INV-134, partial) | `313483959f9cd4b988a475df04a389ea2e69aa92` | `17a1252` | INV-134 |
| Batch 5 (B15-12 / INV-110, partial) | `20e9f4fe1c801ba0f17d349d4a98c01b80553489` | main | INV-110 |

Main is still `3de480e`. Every approved SHA is preserved unchanged in history (merge commits only; no
rebase, squash or cherry-pick).

## Commit map (first parent: the integration line)

| Commit | What |
|---|---|
| `58f7d4a` | base: approved storage `51d7238` + the doc correction |
| `a81afbc` | merge Batch 1 `17a1252` (`2e3099d` `2ae787e` `7e6a41d` `bd7b4de` `7b78a46` `546eed6` `8136fd8` `17a1252`) |
| `9a43c22` | merge Batch 2 `4e4e7f9` (`5d99552` `9542868` `018acec` `0b9454a` `66e563e` `d248b6a` `4e4e7f9`) |
| `9a68348` | CI: the 15 focused suites (storage 9, Batch 1 4, Batch 2 2) |
| `a03cfcd` | CI: assert the build guard removed the Test-only probes, then restore their sources |
| `1bd2e68` | handoff (first version) |
| `b35d6e7` | handoff correction (GHL Test destinations verified live by Spock) |
| `11f8ec9` | CI: full-history checkout (`fetch-depth: 0`) |
| `3f0cbcc` | tests: L7b fails closed without history; L7c negative controls |
| `16110d4` | CI comment + handoff: probe-restore warning; **previous reviewed comparison point** |
| `1b71e41` | merge Batch 3 `eccffae` |
| `6e68653` | tests: Bones-reviewed Batch 2 assertion replacement |
| `c6cdcac` | tests: `test-pipeline-requests` startup diagnostics |
| `752c3d1` | CI: `test-current-read`; Chromium install + `test-pipeline-requests` |
| `b831b37` | merge Batch 4 `3134839` |
| `08ffcc5` | merge Batch 5 `20e9f4f` |
| `04307e8` | CI: `test-mailer-week` |
| this commit | this handoff |

**Merge fidelity.** Every merge was conflict-free, and each merged tree equals the read-only
`git merge-tree` result computed before merging (`16ba4ba`, `8a8c877`, `16c7243`). Each batch's own files
are byte-identical to its approved head (Batch 3's Pipeline/current-read/harness files also equal
Bones's reproduced tree `c6bd2ec`). The only file shared with storage is `app/package.json` (separate
hunks).

**Duplicated email patch: included once.** Batch 2's `018acec` is patch-identical to Batch 1's
`17a1252` (stable patch id `964a086a…`). Merging Batch 1, then Batch 2 (which forks from `8136fd8`),
applies it once; the three affected files equal `17a1252`. Batch 4 is built on `17a1252` itself, so it
needs no extra handling.

## Integration-level changes (not in any approved head; review these)

1. **CI: focused suites.** `9a68348` (15), `752c3d1` (`test-current-read`, `test-pipeline-requests`),
   `04307e8` (`test-mailer-week`): **18 suites** that did not run in CI before.
2. **CI: build-guard ordering** (`a03cfcd`). The build's `production-build-guard.cjs` deletes
   `storage-probe.ts` and `probe-limit.ts` from the checkout; the new step asserts they are absent, then
   restores the sources for later offline checks. **Warning (kept):** restored probe sources must never
   enter deployment packaging without rerunning the production guard; no later CI step builds, packages
   or deploys.
3. **CI: full history** (`11f8ec9`). L7 needs `3de480e`; the shallow checkout failed it (run 37713579938).
4. **L7b fails closed** (`3f0cbcc`, test change). L7b passed with no evidence when git history was
   missing. It now requires `3de480e` readable and accepts only git grep's no-match exit. L7c negative
   controls: empty repository, non-repository and unknown commit fail; a present term is found.
5. **Batch 2 assertion replacement** (`6e68653`, test change, Bones-reviewed on INV-108). Batch 2's
   "the pipeline read itself is unchanged" pinned the pre-Batch-3 `.then()` chain and failed on the
   combined tree (35/36). Replaced by the reviewed regex, renamed as Bones asked ("pipeline keeps the
   endpoint and stages/opportunities response mapping, and returns the read cleanup"), with the `return`
   he preferred. Floor unchanged (36); no other property assertion touched. Controls: removing `return`,
   swapping the mapping, and Batch 2's pre-fix page each fail exactly this check. **Not ownership
   evidence:** `test-current-read` and `test-pipeline-requests` are.
6. **Browser-suite diagnostics** (`c6cdcac`, test change). Diagnostics only: no check, floor, scenario
   or timeout changed. Startup timings are always printed; on any failure (including no check run, or a
   startup throw, which now exits 2) it dumps the browser console, page errors with stacks, failed
   requests and the Vite log.
   - **Fresh-cache first run** (Vite cache moved aside, local Windows): 16/16, exit 0; harness ready at
     25.9 s, about 21 s of it the first page load during dependency optimisation. Warm: ready at 3.3 s.
   - **Forced startup failure** (harness throws; temporary 5 s wait): exit 2, diagnostics name the exact
     page error.
   - The **original 60 s timeout's cause remains UNPROVEN**. The cold-start gap is consistent with, but
     does not prove, the cold-Vite hypothesis. In CI the suite runs on a fresh runner with a fresh cache
     every time and is **not retried**.
   - Negative control unchanged: `--before=3de480e` fails 7 of 16 (exit 1).

## Combined results

**Local (Jeff's machine; final code tree `04307e8`, which differs from this commit only by this doc):**
- **Every CI step in CI order:** 51 of 51 `run:` steps exit 0 (every step after dependency install,
  except the Chromium install, since Playwright's browser is already present locally). They include the
  four PDF steps with local Poppler, the app build and probe-guard step, all 18 focused suites,
  root-functions `tsc`, the identifier boundary, exit contract static and runtime, and `test-inv95` 40/40.
- **Every `app/scripts/test-*.cjs`:** 130 of 130 exit 0. This includes `test-deal-calculator-wiring`,
  the long-standing baseline failure fixed by Batch 1's `7b78a46`.
- **Earlier stages, same method:** 50/50 and 129/129 at `752c3d1` (after Batch 3) and at `b831b37`
  (after Batch 4).

**Affected checks run separately on the combined tree:**
- Pipeline/property/navigation/session: `test-pipeline-property` 36/36, `test-pipeline-requests` 16/16,
  `test-current-read` 11/11, `test-pipeline-stage-display`, `test-b15-ghl-shortcuts` 13/13,
  `test-b15-navigation` 23/23, `test-b15-signin-pages` 28/28, `test-read-session-recovery` 60/60,
  `test-app-read-auth` 172/172, `test-page-activation-binding` 7/7.
- Calculator (Batch 4): `test-deal-calculator-bar` 81/81, `-wiring` 73/73, `-interaction` 10/10,
  `-inputs` 36/36, `test-seller-call-deal-bar` 42/42 (counts match Bones's approval).
- Mailers (Batch 5): `test-mailer-week` 25/25, plus every suite touching mailer code
  (`test-app-read-auth`, `test-read-session-recovery`, `test-storage-endpoints` 51/51). Storage renamed the
  digest handler's GHL credential (`ghlToken()`); the suite calls `mailer-shared` directly and is
  unaffected.

**Exact-head GitHub CI:** reported with the push (see the Jeff → Bones message for the run id).

**Not repeated here:** Bones's own real-browser reviews on each head (Conversations bidi, the Pipeline
page/remount orderings, the Deal Calculator page, the mailer millisecond/DST checks). Rerunning the
relevant ones on the combined tree is the recommended integration review.

## Unresolved limitations (explicit)

**Batch-level scope still open:**
- **B15-09 / INV-108:** the opportunities-read race is fixed by Batch 3 (approved). Remaining scope stays
  open, including a verified deal-to-property association; addresses are labelled as the contact's
  Property Address field, not confirmed for the deal. Test-quality note (Bones): R5's browser checks also
  pass on the old page; callback suppression is established by the helper tests and mutation, not by R5.
- **B15-26 / INV-134:** Batch 4 is a copy correction only; transaction net proceeds and cost authority
  remain open.
- **B15-12 / INV-110:** no live verification; the page label shows raw ISO dates; undated tasks count as
  Overdue (pre-existing); the empty-state distinction is not done.
- **INV-125:** Add Leads is guidance only; no live intake workflow.
- **B15-23 / INV-132:** remaining scope open; SMS and Contact Workspace history stay unlinked.
- **GHL shortcuts:** Spock verified both destinations live in GHL Test (`/calendars/view`,
  `/contacts/smart_list/All`). The IAOS shortcuts themselves still need a live application check;
  Production navigation and post-sign-in redirects remain unverified. A shortcut does not restore IAOS
  calendar API access.

**Storage holds (unchanged):**
- **Marketing webhooks** (`phone-lookup`, `motivation-score`): held, 503 before any provider or GHL call,
  pending decision A. Not restored functionality.
- **R1–R5 uncertain-write recovery:** held pending decision B. Not restored functionality.
- Request normalization limits on the modern runtime; operator scripts still read `GHL_PRIVATE_API_KEY`;
  `GHL_API_TOKEN` must enter the C0 credential inventory.

## Release prerequisites (each separately gated; none authorized)

- **Merging is itself C2:** merging to main auto-publishes Test. From then every app write on Test returns
  503 until the admission record exists and C3–C7 are complete. Production is unaffected while its
  auto-publish lock stays on.
- **C0–C8** (`docs/STORAGE_V2_CUTOVER_RUNBOOK.md`): C0 credential inventory; C1 new secrets; C2 merge;
  C3 import owner, S1, G5 init; C4 legacy credential revocation and `T_r`; C5 S2/S3, dry run,
  completion, manifest approval; C6 G5 audit and table digest approval; C7 `L_obs` and latency probes
  on Test, then publish and activate; C8 Spock's rerun on an eligible synthetic contact.
- **P5 provider semantics** for Netlify restore; the offline test semantics are fixtures, not evidence.
- **Publisher identity permissions** (Test and Production), and live confirmation of
  `context.deploy.published` / `deploy.id`.
- Production publication remains Brad's manual, locked step.
