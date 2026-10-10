# B14-13: IAOS to AirDroid calling (design, launch interface and file ownership)

**Status (2026-10-09, simplified):** branch `b14-13-airdroid-prepare-call`, base `45361c1` (the held baseline).
- Local only: not pushed.
- No merge, deployment or Production change.
- No Board 15 file changed.

## Finish line (Brad)
1. Brad clicks **Call** in IAOS's Seller Call screen.
2. **AirDroid dials once.**
3. The **script and notes remain available**, and outcomes are saved as today.

**Explicitly out of this version:**
- live feedback to IAOS;
- any localhost listener or request-id channel;
- automatic call status;
- any "Check AirDroid and your phone" message.

**IAOS never displays dialling or connection success,** because nothing verifies it. The existing notes and outcome
saves are unchanged and independent of the call. GHL softphone work is outside 14-13.

## Launch interface (accepted starting interface; coordinate any change through Brad)
| Item | Interface |
|---|---|
| Link | `iaos-airdroid:call?number=NNNNNNNNNN`. Exactly this form. |
| `number` | 10 digits, US. Area code and exchange start with 2–9. No `+1`, separators, extension or other parameters. |
| Builder | `app/src/lib/airdroid-prepare-call.ts`: `airdroidCallLink(rawPhone)` returns the link, or `null` when the number is not valid. `airdroidCallDigits` gives the digits. Pure: no I/O, no writes. |
| Seller Call button (Scotty) | One deliberate click opens the link with ordinary navigation. No popup, no fetch, no write. When the builder returns `null`, the button is disabled and says why. |
| After the click | IAOS shows **no** success, dialling or connection state. Any neutral wording is Scotty's and Brad's call. It must not imply the call was placed. |
| Result back to IAOS | None in this version. |
| Version | A future change uses a new action name, so old links are refused rather than misread. |

## Helper (Jeff)
- **Implemented and offline-verified at this head:**
  - the handler accepts only the `call` link;
  - it runs the reviewed prefill helper `PrepareCall.ps1`, which fills the open Dialpad, verifies the exact readback,
    and never dials.
- **Single Make Call activation: implemented at local integration (`b14-13-airdroid-integration`),
  `DialCall.ps1`.** Brad authorized one-click dialing with no second confirmation (2026-10-09). The earlier
  auto-mode write was denied by the classifier; the file was then written in Manual mode with Brad's approval of that
  specific write.
  - It identifies Make Call structurally (the single full-width panel below the 12-key grid in the live Dialpad,
    outside the call-status panel). This rule matched the button Brad pointed at in the Manual-mode test (restricted
    Drive section 12).
  - It rechecks the exact number and the panel immediately before the click, clicks once with no retry, and refuses
    a duplicate (one call at a time; the same number within 30 s).
  - **Bones review fixes (2026-10-10):**
    - the handler now holds the IAOS call lock for the whole prepare-and-dial sequence, so a competing launch
      cannot change the Dialpad between prefill and click;
    - the automatic path no longer shows PrepareCall's "press Make Call yourself" line.
    Both are tested inertly against a fake Dialpad (`app/scripts/test-airdroid-dial-concurrency.cjs`).
  - **Offline-checked only.** Live dialing through IAOS is not proven until registration and a live test with Brad's
    designated test number.

## File ownership
| File | Owner |
|---|---|
| `tools/airdroid-prepare-call/*`, `app/src/lib/airdroid-prepare-call.ts`, `app/scripts/test-airdroid-prepare-call.cjs`, `app/package.json` and `.github/workflows/ci.yml` test wiring, this doc | **Jeff** |
| `app/src/components/SellerCallVoiceControls.tsx`, its CSS and component tests | **Scotty** (imports the builder; does not edit it) |
| `SellerCallWorkspace.tsx`, script drawer, notes, outcome controls, contact selection | **No change planned**; raise first |
| GHL softphone code | **Out of scope** |

## Overlap check (2026-10-09)
- **Board 15 feature branches:** fully contained in `b15-integration`.
- **The Oct 5 review compositions:** superseded.
- **Board 13 (`b13-scotty-responsive-nav`):** touches `Layout.tsx`, `app/package.json` and CI, in hunks separate
  from this branch. A `git merge-tree` check is clean.

## Registration (pending approval; not done)
The `iaos-airdroid:` link must be registered for Brad's Windows user before IAOS can launch the helper. The plan for
Brad's review through Manual-mode approval is unchanged:
1. **Precheck** that `HKCU:\Software\Classes\iaos-airdroid` is absent.
2. **Create** the three per-user values, pointing at `IaosAirdroidHandler.ps1 "%1"`.
3. **Read** them back.
4. **Removal** deletes that key.

The earlier denied registration script is not recreated. **Security decision still open:** any web page could open
the link once it is registered; the browser's own "Open…?" prompt is the current proposal.

## Remaining blockers
1. **Activation:** implemented and offline-checked at local integration; live proof pending.
2. **Registration:** approval. Then a live test, including any browser "Open …?" prompt (a browser-level
   confirmation outside IAOS) and whether Seller Call's script and unsaved answers survive the handoff.
3. **Push:** approval. The review package is in restricted Drive.
4. **Connection label:** AirDroid's Local or Remote label is unknown; Brad needs to read it. No Premium purchase is
   authorized.
5. **Brad's laptop:** validation not done.
6. **Durability:** AirDroid's internal names can change with updates; the helper then stops rather than guessing.
