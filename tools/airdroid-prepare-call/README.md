# IAOS AirDroid "Prepare Call" helper (B14-13)

AirDroid is IAOS's **primary** calling path on Brad's Windows PC, GHL Phone is the **backup**, and the seller script
stays in IAOS.

**Finish line:** Brad clicks Call in IAOS and AirDroid dials once; the script and notes stay available. IAOS shows no
dialling or connection success (`docs/B14-13_AIRDROID_PREPARE_CALL.md`).

**Current code (local integration, `b14-13-airdroid-integration`):** the handler accepts
`iaos-airdroid:call?number=NNNNNNNNNN`, runs the prefill helper, then the single Make Call step. Brad authorized one-click
dialing with no second confirmation (2026-10-09); `DialCall.ps1` was written in Manual mode with his approval. **Live
dialing through IAOS is not yet proven:** the link is not registered and no live test has run.

| File | Purpose |
|---|---|
| `PrepareCall.ps1` | The reviewed standalone helper, byte-identical to the prototype delivered on 2026-10-09 (SHA-256 `3a7d68fd…e520`). Prefill only. |
| `DialCall.ps1` | Runs after a successful prefill. Duplicate guard (one dial at a time; the same number is refused for 30 s), exact recheck of the Dialpad number, structural Make Call identification (the rule validated against Brad's pointing), recheck, then **one click, no retry**. Reports only "click sent once". `-CheckOnly` is read-only; `-GuardOnly` runs only the guard (tests). |
| `IaosAirdroidHandler.ps1` | Accepts one IAOS launch link, parses it strictly, runs `PrepareCall.ps1 -Number NNNNNNNNNN` and, only if that exits 0, `DialCall.ps1 -Number NNNNNNNNNN`. `-ParseOnly` touches nothing and is used by the tests. |

## What `PrepareCall.ps1` does
1. Validates the number, a 10-digit US number, before touching anything.
2. Brings AirDroid forward.
3. Finds the single number field in AirDroid's already-open Dialpad (form `frmAirCloud`). It stops if the field is
   missing or ambiguous.
4. Sets the number without keystrokes.
5. Requires an exact readback, and clears the field on a mismatch.

**It never:**
- dials;
- presses Enter, Make Call or End Call;
- navigates AirDroid;
- reads AirDroid's configuration or logs.

**Exit codes:**
- 0 prepared
- 2 invalid number
- 3 AirDroid missing or ambiguous
- 4 Dialpad not open
- 5 field ambiguous
- 6 readback mismatch (field cleared)
- 7 unexpected error
- 20 (handler only) link refused

**`DialCall.ps1` exit codes:** 0 click sent once; 2 invalid number; 3 AirDroid missing or ambiguous; 4 live Dialpad
not unique; 8 Make Call not found, ambiguous, in the call-status panel or disabled; 9 number or panel did not match or
changed before the click (nothing clicked); 10 duplicate refused; 7 unexpected error. The duplicate guard records the
last dial in `%LOCALAPPDATA%\IAOS\airdroid-last-dial.json` (number and time only).

## Launch-link registration: NOT included
For IAOS to open the helper from the browser, the `iaos-airdroid:` link has to be registered on the PC. That is a
persistent change to the machine's configuration.
- A registration script was **not** added to this branch: writing one was denied by Claude Code's permission
  classifier ("Unauthorized Persistence").
- Registration therefore needs its own explicit decision by Brad, and is a separate step from this code.

Until the link is registered:
- the helper runs by hand (`PrepareCall.cmd` / `PrepareCall.ps1`) with the Dialpad open;
- an IAOS button would only show the browser's "no app for this link" behaviour.

## Evidence
- **Standalone proof and prototype:** restricted Drive handoff, sections `10_`, `11_` and `12_`. Section 12 records
  one Manual-mode test that placed a call (Brad's observation; voicemail not confirmed).
- **Offline test:** `app/scripts/test-airdroid-prepare-call.cjs`.
  - It checks the browser-side link builder against the handler's own parser, the Make Call step's shape (one
    click, recheck first, no keystrokes, no AirDroid file reads, handler order) and, on Windows, its number
    validation and duplicate guard against a temporary guard file. Nothing touches AirDroid or places a call.
  - 42/42 checks pass.
  - Its negative controls catch a weakened builder (4 failures) and a weakened handler (3 failures).

## Limits
- Tested on one machine: BRAD-LAPTOP, AirDroid 3.8.0.4.
- It depends on AirDroid's internal form name, so an update can break the lookup. The helper then stops rather than
  guessing.
- The Dialpad must already be open.
- Only US numbers are supported.
- The connection label (Local or Remote) is not recorded, so the AirDroid Premium question is open.
