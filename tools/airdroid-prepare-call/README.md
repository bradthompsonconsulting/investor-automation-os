# IAOS AirDroid "Prepare Call" helper (B14-13)

AirDroid is IAOS's **primary** calling path on Brad's Windows PC, GHL Phone is the **backup**, and the seller script
stays in IAOS.

**Finish line:** Brad clicks Call in IAOS and AirDroid dials once; the script and notes stay available. IAOS shows no
dialling or connection success (`docs/B14-13_AIRDROID_PREPARE_CALL.md`).

**Current code (local integration, `b14-13-airdroid-integration`):** the handler accepts
`iaos-airdroid:call?number=NNNNNNNNNN`, runs the prefill helper, then the single Make Call step. Brad authorized one-click
dialing with no second confirmation (2026-10-09); `DialCall.ps1` was written in Manual mode with his approval. **Live
dialing through IAOS is not yet proven:** the link is not registered and no live test has run.

**Visible Dialpad (Brad, 2026-10-12; current):** Brad opens AirDroid and his phone's Dialpad once, at the start of
work, and keeps that AirDroid window **visible** beside IAOS. It may be a small window in a corner; he sizes and places
it by hand (the helper never moves or resizes it). Each IAOS Call enters the number, verifies it, brings that one
identified Dialpad window in front once, and clicks Make Call once; AirDroid then stays where it is, in front of IAOS
until Brad clicks back. (VivoBook, 2026-10-12: a click sent while AirDroid was behind IAOS placed no call.) If Windows
will not bring it in front, nothing is clicked (exit 11). The helper never starts AirDroid, never restores a hidden or
minimised window, never moves or resizes it and never minimises it. "Click sent" is not a connected call. If exactly one visible AirDroid window with the Dialpad cannot
be identified, it stops with a plain instruction to open it, and never guesses between windows.

**Check the Dialpad (no call):** after sizing AirDroid, run `DialCall.ps1 -CheckOnly` with no number (the installer
package has `CHECK-DIALPAD.cmd`). It reports the Dialpad window's size, the number field and Make Call, and types and
clicks nothing. If AirDroid will not shrink far enough for both to stay visible, that is reported, not worked around.

| File | Purpose |
|---|---|
| `PrepareCall.ps1` | The reviewed standalone prefill helper. Prefill only. Byte-identical to the 2026-10-09 prototype (SHA-256 `3a7d68fd…e520`) up to `ef37102`; changed after Bones's review: it now takes the IAOS call lock (or, with `-CallerHoldsLock`, confirms the handler holds it) before touching the Dialpad, and `-Automatic` suppresses its "press Make Call yourself" line in the automatic path. Standalone use keeps that line. |
| `DialCall.ps1` | Runs after a successful prefill. Duplicate guard (one call at a time under the IAOS call lock; the same number is refused for 30 s), exact recheck of the Dialpad number, structural Make Call identification (the rule validated against Brad's pointing), recheck, then **one click, no retry**. Brings the identified Dialpad window in front once just before the click (exit 11, nothing clicked, if Windows refuses), lets it settle briefly, then rechecks Make Call (still the same live, visible, enabled control, still inside the same device page and Dialpad window, exactly the same rectangle) and the number field and number; any change stops with exit 9 before anything is recorded or clicked. Reports only "click sent once", never a connected call, and leaves AirDroid where it is. `-CheckOnly` is read-only; without a number it is the "check the Dialpad" mode. `-GuardOnly` runs only the guard (tests). |
| `IaosAirdroidHandler.ps1` | Accepts one IAOS launch link and parses it strictly. It then takes the **IAOS call lock** (named mutex `LocalIAOS-AirDroid-Dial`, no wait) and holds it for the whole sequence: duplicate check (`DialCall.ps1 -GuardOnly`), `PrepareCall.ps1 -Automatic`, then `DialCall.ps1`, each only if the previous step exits 0, all with `-CallerHoldsLock`. A competing launch finds the lock taken and stops (exit 10) without touching the Dialpad. The lock is released in `finally` on every exit path, before any "Press Enter" pause. `-ParseOnly` touches nothing and is used by the tests. |

## What `PrepareCall.ps1` does
1. Validates the number, a 10-digit US number, before touching anything.
2. Finds the one **visible**, not-minimised AirDroid window that shows the Dialpad (a visible `frmAirCloud` page with a
   visible number field). None (not open, hidden or minimised) or more than one: it stops with a plain instruction.
3. Finds the single number field in that Dialpad. It stops if the field is ambiguous.
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
- 3 AirDroid not running, or more than one visible AirDroid window shows a Dialpad
- 4 no visible AirDroid window shows the Dialpad (not open, hidden or minimised)
- 5 field ambiguous
- 6 readback mismatch (field cleared)
- 7 unexpected error
- 10 another IAOS call is in progress (nothing changed), or `-CallerHoldsLock` given but the lock is not held
- 20 (handler only) link refused

**`DialCall.ps1` exit codes:** 0 click sent once (or the check passed); 2 invalid number; 3 AirDroid not running, or more
than one visible AirDroid window shows a Dialpad; 4 no visible live Dialpad, or it is not unique; 8 Make Call not found, ambiguous, in the call-status panel or disabled; 9 number or panel did not match or
changed before the click (nothing clicked); 10 duplicate refused; 11 AirDroid could not be brought in front (nothing clicked or recorded); 7 unexpected error. The duplicate guard records the
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
  - 45/45 checks pass.
- **Concurrency test:** `app/scripts/test-airdroid-dial-concurrency.cjs` (Windows; inert).
  - It builds a fake AirDroid Dialpad (`app/scripts/harness/airdroid-fake/FakeAirDroid.cs`) and runs the real
    handler and scripts against it with `-TestProcessName`.
  - Controlled pauses (`-TestPauseMs`, honoured only with `-TestProcessName`) hold a launch before its final number
    check and before dispatch, while competing launches are attempted. The fake logs every number change and click.
  - The registered command passes none of the test parameters. 34/34 checks pass.
  - Its negative controls catch a weakened builder (4 failures) and a weakened handler (3 failures).
- **Visible-Dialpad test:** `app/scripts/test-airdroid-visible.cjs` (Windows desktop session; inert).
  - The fake reproduces the VivoBook diagnostic's layout: one AirDroid process; the main window holds two `frmAirCloud`
    pages (one hidden) and the Dialpad; a second unowned "AirDroid" form with five text fields and no Dialpad.
  - Checks: the Dialpad check; three consecutive calls, each one entry and one click, AirDroid still visible at the
    same size; the second form visible too; a small corner window; minimised, tray-hidden, Dialpad-not-open and
    two-Dialpad windows stop with a plain instruction and change nothing; not running starts nothing; duplicate and
    lock refusals. Static: no start, restore, foreground, move, resize or minimise in the calling path.

## Limits
- Tested on one machine: BRAD-LAPTOP, AirDroid 3.8.0.4.
- It depends on AirDroid's internal form name, so an update can break the lookup. The helper then stops rather than
  guessing.
- The Dialpad must already be open.
- Only US numbers are supported.
- The connection label (Local or Remote) is not recorded, so the AirDroid Premium question is open.
- AirDroid's minimum window size, and whether the number field and Make Call stay visible at a small size, are
  checked on the VivoBook with the Dialpad check, not assumed.
