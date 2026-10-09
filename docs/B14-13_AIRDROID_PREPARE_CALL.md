# B14-13: IAOS to AirDroid "Prepare Call" (design and coordination note)

**Status:** isolated work only, on branch `b14-13-airdroid-prepare-call`. **Base `45361c1`**, which is the current
`b15-integration` head and the held baseline.
- No merge, deployment or Production change. The Production publishing hold remains.
- The Netlify investigation continues independently.
- The Board 15 work is preserved: no Board 15 file is changed by this branch.

## Direction (Brad)
- **AirDroid is primary.** IAOS prepares the seller's number in AirDroid on Brad's PC, and Brad presses Make Call.
- **GHL Phone is the backup.** The existing B14-11 "Open seller in GHL" handoff stays as it is.
- **"Call with Cell" stays.**
- **The seller script stays accessible** in IAOS while calling.

**Saving to GHL stays independent of hangup.** The call log, outcomes and callbacks are unchanged and are still
recorded by the operator.

## How it connects
1. The browser builds a navigation-only link: `airdroid-prepare-call.ts` produces
   `iaos-airdroid:prepare?number=NNNNNNNNNN`, and only for valid 10-digit US numbers.
2. Windows hands the link to `tools/airdroid-prepare-call/IaosAirdroidHandler.ps1`. The handler parses it strictly
   and passes the digits as a named parameter.
3. `PrepareCall.ps1` fills the already-open Dialpad and verifies the readback. It never dials.

**Opening the link writes nothing and is not evidence of anything.** The browser cannot see whether the helper ran or
what it did, so the UI must say "check AirDroid" rather than "prepared".

**Registration of the `iaos-airdroid:` link is not part of this branch.** It is a persistent machine change, and
writing the registration script was denied by the Claude Code permission classifier. It needs Brad's explicit
decision.

## Overlap check (2026-10-09)
**Compared against:**
- `origin/b15-integration` `45361c1` and the B15 integration handoff (`docs/B15_INTEGRATION_HANDOFF.md`);
- every `origin/b15-*` branch;
- Scotty's Board 13 branch `b13-scotty-responsive-nav`.

**Areas checked:** Seller Call screen, call buttons, script layout, contact selection, outcome controls, `Layout`, CI
and `app/package.json`.

| Branch | Edits not in `b15-integration` touching call-area files |
|---|---|
| `b15-b1` / `b2` / `b3-seller-call` / `b3b-offer-barrier` / `b4-operator-copy` / `b5-signin-pages` / `f38-contract-state` / `repair-allowances` | none (fully contained) |
| `b15-scotty*`, `b15-review-*`, `b15-storage-v2`, `b15-cleanup-1` | none |
| `b15-release-candidate`, `b15-subset-review`, `b15-trial-combined-review` (Oct 5 review compositions) | `SellerCallWorkspace.tsx` (NoDealYet notice), `ContactWorkspace.tsx`, `Contacts.tsx`, `call-outcome-copy.ts`, `Layout.tsx`, CI. **Superseded:** their content is already in `b15-integration` in revised form (at most one differing line per file). |
| `b13-scotty-responsive-nav` (local; implementation authorized, merge not) | `Layout.tsx`, `app/package.json`, CI, harness |

**Result:**
- **No active overlap** with the isolated files in this branch.
- **The shared files below are not edited yet** and need coordination first.

## Files in this branch (isolated, new)
- `tools/airdroid-prepare-call/PrepareCall.ps1` (reviewed prototype, unchanged)
- `tools/airdroid-prepare-call/IaosAirdroidHandler.ps1`
- `tools/airdroid-prepare-call/README.md`
- `app/src/lib/airdroid-prepare-call.ts` (pure link builder)
- `app/scripts/test-airdroid-prepare-call.cjs` (offline, 29 checks)
- `docs/B14-13_AIRDROID_PREPARE_CALL.md` (this note)

## Proposed shared-file edits (NOT made; coordinate first)
| File | Proposed change | Who else touches it |
|---|---|---|
| `app/src/components/SellerCallVoiceControls.tsx` (+ `.css`) | Add a first "Call with AirDroid (primary)" option: a "Prepare in AirDroid" button that opens the launch link, plus the honest status "Check AirDroid: the number should be in the Dialpad. Press Make Call there." Relabel the GHL option as backup. The Cell option is unchanged. | B14-11 owner. No active B15 edits, but it renders inside Seller Call (`SellerCallWorkspace.tsx`, which B15 has edited heavily). |
| `app/src/pages/SellerCallWorkspace.tsx` | **No change planned.** The controls render where they do today, beside the script. | B15 Seller Call work |
| `app/package.json` | Optional script entry for the new test | Every batch, and B13 |
| `.github/workflows/ci.yml` | Add `node scripts/test-airdroid-prepare-call.cjs`. On Ubuntu the handler checks are skipped and reported. | Every batch, and B13 |
| `app/src/pages/ContactWorkspace.tsx`, `CallLogControl`, `FullScriptDrawer`, outcome controls, contact selection | **No change planned.** | B15 |

## Open decisions
1. **Approval of the `SellerCallVoiceControls` edit** (copy and layout above), and whether the Contact page also gets
   a Prepare button.
2. **Launch-link registration on Brad's PC:** whether, and by whom.
3. **CI wiring:** adding the test means editing `ci.yml`, a shared file.
4. **AirDroid connection mode and Premium:** the connection label is not yet recorded.
5. **Validation on Brad's own laptop** before adoption.
