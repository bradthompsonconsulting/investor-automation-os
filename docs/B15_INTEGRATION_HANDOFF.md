# Board 15 combined build: integration handoff (Bones)

Storage v2 plus Scotty Batches 1–8, pushed **branch-only** (no PR). No merge to main, deployment,
credential change, cutover or live mutation. **Production remains held.** The milestone is a reviewed
combined build, not a release.

**Where things are:**
- `b15-integration` = `e94889a`, the last Bones-approved combined head (storage + Batches 1–7, the
  Mailers write-coverage correction and the verifier correction). Fast-forwarded from `9c74cbb`.
- **This candidate** (review branch `b15-review-b8-contacts`) = `e94889a` + Batch 8 + its CI step + one
  test correction that is **pending Bones review** (`8cd8197`, item 9 below) + this handoff. It becomes
  the next `b15-integration` head only once that correction is approved.
- Previous comparison points: `16110d4` (storage + Batches 1–2), `9c74cbb` (+ Batches 3–5),
  `e94889a` (+ Batches 6–7).

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
| Batch 6 (B15-12 / INV-110, partial: neutral No Address empty state) | `0ba74f2e42d88786ec51f33ba22caff2838106c0` | Batch 5 `20e9f4f` | INV-110 |
| Batch 7 (B15-17 / INV-126, partial: no Phase A badge; Conversations heading) | `197fbbdd9a1ca46987c3e4d625d57d2a4423d063` | Batch 2 `4e4e7f9` | INV-126 |
| Batch 8 (B15-11 / INV-111, partial: Contacts search matches Property Address) | `65c0f243a4d73c652ac188dafacebd924923d853` | main | INV-111 |

Main is still `3de480e`. Every approved SHA is preserved unchanged in history (merge commits and one
fast-forward to an approved head; no rebase, squash or cherry-pick).

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
| `16110d4` | CI comment + handoff: probe-restore warning; **comparison point 1** |
| `1b71e41` | merge Batch 3 `eccffae` |
| `6e68653` | tests: Bones-reviewed Batch 2 assertion replacement |
| `c6cdcac` | tests: `test-pipeline-requests` startup diagnostics |
| `752c3d1` | CI: `test-current-read`; Chromium install + `test-pipeline-requests` |
| `b831b37` | merge Batch 4 `3134839` |
| `08ffcc5` | merge Batch 5 `20e9f4f` |
| `04307e8` | CI: `test-mailer-week` |
| `9c74cbb` | handoff; **comparison point 2** (Bones-approved) |
| `271197e` | merge Batch 6 `0ba74f2` (only `07644cd`, `0ba74f2` enter; Batch 5 already integrated) |
| `a4b014f` | CI: `test-mailers-empty-state` |
| `8ac1cad` | tests: Mailers activation-read set-aside (first proposal; superseded by `e94889a`) |
| `73dd746` | merge Batch 7 `197fbbd` (only `197fbbd` enters; Batch 2 already integrated) |
| `c48d86c` | CI: `test-b15-shell-labels` |
| `8d82752` | merge of `8ac1cad` into the line |
| `fdbb35a` | verifier: `verify-conversations.cjs` §8.1/§8.9 expect the Conversations heading (Bones-approved) |
| `e94889a` | tests: Mailers write coverage (Bones-approved); **comparison point 3** = `b15-integration` |
| `823e5c9` | merge Batch 8 `65c0f24` (`79cea2d` `354edac` `65c0f24`) |
| `5874350` | CI: `test-contacts-address-search` |
| `8cd8197` | tests: Contacts write coverage on the combined tree (**PENDING Bones review**) |
| this commit | this handoff |

**Merge fidelity.** Every merge was conflict-free, and each merged tree equals the read-only
`git merge-tree` result computed before merging (Batch 6 `025c15b`, Batch 7 `573f217`, Batch 8
`23af330`; earlier ones in the previous handoff). Each batch's own files are byte-identical to its
approved head, except the shared `app/package.json` script list (separate one-line hunks; each batch's
script entry is present).

**Duplicated email patch: included once.** Batch 2's `018acec` is patch-identical to Batch 1's
`17a1252` (stable patch id `964a086a…`); merging both applies it once. Batch 4 is built on `17a1252`,
Batch 6 on Batch 5, Batch 7 on Batch 2: each merge brings only its own new commits.

## Integration-level changes (not in any approved head; review these)

1. **CI: focused suites.** `9a68348` (15), `752c3d1` (`test-current-read`, `test-pipeline-requests`),
   `04307e8` (`test-mailer-week`), `a4b014f` (`test-mailers-empty-state`), `c48d86c`
   (`test-b15-shell-labels`), `5874350` (`test-contacts-address-search`): **21 suites** that did not run
   in CI before. The four real-page suites share one Chromium install step; none is retried.
2. **CI: build-guard ordering** (`a03cfcd`). The build's `production-build-guard.cjs` deletes
   `storage-probe.ts` and `probe-limit.ts` from the checkout; the new step asserts they are absent, then
   restores the sources for later offline checks. **Warning (kept):** restored probe sources must never
   enter deployment packaging without rerunning the production guard; no later CI step builds, packages
   or deploys.
3. **CI: full history** (`11f8ec9`). L7 needs `3de480e`; the shallow checkout failed it (run 37713579938).
4. **L7b fails closed** (`3f0cbcc`, test change). L7b passed with no evidence when git history was
   missing. It now requires `3de480e` readable and accepts only git grep's no-match exit. L7c negative
   controls: empty repository, non-repository and unknown commit fail; a present term is found.
5. **Batch 2 assertion replacement** (`6e68653`, test change, Bones-reviewed on INV-108). Floor unchanged
   (36). Not ownership evidence: `test-current-read` and `test-pipeline-requests` are.
6. **Browser-suite diagnostics** (`c6cdcac`, test change). Diagnostics only. Fresh-cache first run 16/16
   (ready at 25.9 s locally); in CI ready at about 1–1.4 s. The **original 60 s timeout's cause remains
   UNPROVEN**. Negative control `--before=3de480e` fails 7 of 16.
7. **Mailers write coverage** (`8ac1cad` then `e94889a`, test change, **Bones-approved**). On the
   combined tree storage v2's Layout reads `GET iaos-activation` once per page load; Batch 6 (built on
   main) did not expect it. `e94889a` answers the activation OPEN, installs a valid offline write
   session, requires the real Layout bound before testing, and adds a canary: one real completion call
   (`ghl.mailers.completeTask`) must reach the intercepted network as `POST ghl-write` with the bound
   activation and session bearer. `--inject-write` fails the request check. Floor 9 → 11.
8. **Verifier correction** (`fdbb35a`, **Bones-approved**). `verify-conversations.cjs` §8.1 expects the
   page heading "Conversations" (Batch 7); §8.9 finds its banner by that heading. 24 checks, unchanged.
   Not run live.
9. **Contacts write coverage** (`8cd8197`, test change, **PENDING Bones review**). Same mismatch as item
   7: Batch 8 (built on main) failed its read check on the combined tree (23/24, the extra
   `GET iaos-activation`). Applies the approved item-7 pattern: activation answered OPEN and set aside at
   most once; valid offline write session; new check that the real Layout is bound before testing; new
   canary (one real `ghl.contacts.setExplicitCallback` call must reach the intercepted network as
   `POST ghl-write` with the bound activation and session bearer); `--inject-write` negative control.
   Floor 24 → 26; existing assertions unchanged.
   - Corrected suite 26/26. `--inject-write` fails exactly the read check (exit 1).
   - `--before=3de480e` fails exactly the 9 search/prompt checks; `--before=354edac` exactly the 5 width
     checks (Batch 8's own negative controls, now without the activation noise).
   - Mutations: activation answered 404 fails the bind check and the canary; no write session fails
     the canary.

## Combined results

**Local (Jeff's machine; code tree `8cd8197`, which differs from this commit only by this doc):**
- **Every CI step in CI order:** 54 of 54 `run:` steps exit 0 (every step after dependency install,
  except the Chromium install, since Playwright's browser is already present locally). They include the
  four PDF steps with local Poppler, the app build and probe-guard step, all 21 focused suites,
  root-functions `tsc`, the identifier boundary, exit contract static and runtime, and `test-inv95` 40/40.
- **Every `app/scripts/test-*.cjs`:** 133 of 133 exit 0.
- **Earlier stages, same method:** 53/53 and 132/132 at `e94889a` (approved head); 51/51 and 130/130 at
  `04307e8`.

**Contacts page with production CSS (Batch 8; offline, local).** The combined app was built as CI builds
it (`pnpm --dir app build`), and the built `dist/` (production JS and minified Tailwind CSS) was served
to headless Chromium with every function answered offline (runtime config = the Test projection, as in
`verify-propstream-handoff.cjs`). 12/12:
- both built stylesheets (`/assets/index-*.css`, `/assets/App-*.css`) load; box-sizing `border-box`;
  body font stack `Inter, system-ui, sans-serif`;
- the exact prompt "Search name, phone, email, property address…" fits uncut at 2560, 1440, 1280, 1024
  and 768 px (measured text 268 px in the fallback font; room 334 px at every width), the box stays
  inside the page, and nothing overflows sideways;
- an address-only street name matches; a digits query returns the address and phone matches;
- only reads (runtime config, read session, one contacts read, one activation read); no page errors.
- **Not verified:** the actual Inter rendering (the Google Fonts stylesheet is blocked offline, so text is
  measured in the fallback face) and widths below 768 px.

**Affected checks on the combined tree:**
- Contacts (Batch 8): `test-contacts-address-search` 26/26 (with `8cd8197`), `test-b15-operator-copy-b4`
  48/48.
- Shell and Conversations (Batch 7): `test-b15-shell-labels` 8/8 (`--before=4e4e7f9` fails exactly its 3
  label checks), `test-b15-conversations-ghl-buttons`, `test-message-links`,
  `test-seller-call-conversation-first` 72/72, `test-b15-navigation` 23/23, `test-b15-signin-pages`
  28/28, `test-read-session-recovery` 60/60, `test-app-read-auth` 172/172, `test-page-activation-binding`
  7/7.
- Mailers (Batches 5–6): `test-mailers-empty-state` 11/11, `test-mailer-week` 25/25.
- Earlier batches: unchanged from the previous handoff (Pipeline, Calculator, storage endpoints 51/51).

**Exact-head GitHub CI:** reported with the push (see the Jeff → Bones message for the run id).

**Not repeated here:** Bones's own real-browser reviews on each head. Rerunning the relevant ones on the
combined tree is the recommended integration review.

## Unresolved limitations (explicit)

**Batch-level scope still open:**
- **B15-09 / INV-108:** the opportunities-read race is fixed by Batch 3. Remaining scope stays open,
  including a verified deal-to-property association; addresses are labelled as the contact's Property
  Address field, not confirmed for the deal. Test-quality note (Bones): R5's browser checks also pass on
  the old page; callback suppression is established by the helper tests and mutation, not by R5.
- **B15-26 / INV-134:** Batch 4 is a copy correction only; transaction net proceeds and cost authority
  remain open.
- **B15-12 / INV-110:** Batch 5 (Saturday–Friday week) and Batch 6 (neutral "No contacts missing an
  address were found.") only. No live verification; the page label shows raw ISO dates; undated tasks
  count as Overdue (pre-existing). The digest has no enrolment data, so the page cannot tell "nobody
  enrolled" from "everyone has an address"; the wording is neutral rather than distinguishing them.
- **B15-17 / INV-126:** Batch 7 covers F11 (Phase A badge removed) and F50 (Conversations heading) only;
  remaining scope open. `verify-conversations.cjs` is corrected (`fdbb35a`) but not run live.
- **B15-11 / INV-111:** Batch 8 adds Property Address matching to Contacts search (the displayed value;
  no native-address fallback, no new read). Remaining scope open. **Actual Inter rendering and widths
  below 768 px remain unverified.**
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
