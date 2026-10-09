# B14-13: IAOS to AirDroid calling (design, launch contract and file ownership)

**Status (2026-10-09):** work on branch `b14-13-airdroid-prepare-call`, **base `45361c1`** (the current
`b15-integration` head and the held baseline).
- No merge, deployment or Production change. The Production publishing hold remains.
- The Netlify investigation continues independently.
- Board 15 work is preserved: no Board 15 file is changed by this branch.

## Finish line (corrected 2026-10-09)
**Brad clicks Call in IAOS's Seller Call screen, and on his Windows PC the helper:**
1. puts the seller's number in AirDroid's Dialpad and verifies the exact readback;
2. activates AirDroid's **Make Call once**.

Prefill followed by Brad pressing Make Call himself is **not** the finish line.

**Fixed requirements:**
- **AirDroid is primary.** GHL Phone stays as the backup, unchanged; GHL softphone changes are outside 14-13.
- **The script and notes stay accessible** while calling.
- **Outcome saving is unchanged and independent** of any hang-up detection. There is none: IAOS does not detect
  hang-up. A save shows success only after the save itself succeeds.
- **The browser never claims** a number was prepared, a call was dialled, connected or ended. It cannot see any of
  that.

## Evidence this rests on
- **Prefill:** proven repeatedly with exact readback (restricted Drive sections 10 and 13).
- **Single automated Make Call activation:** proven once in Manual mode (section 12).
  - The click went to the control that a **structural rule** identified as Make Call: inside the live Dialpad form,
    the single full-width panel directly below the 12-key grid, outside the call-status panel.
  - In that test the rule found exactly one candidate (handle 68298), and it was the same control Brad pointed at.
  - Tool-confirmed: one click sent, no retry.
  - Brad observed: a call was placed and ended. Voicemail answering is not confirmed.
- **What the pointing did:** it was a human cross-check of the rule, not part of it. The helper below uses the rule
  without pointing.

## Launch contract v1 (PROPOSED: needs Scotty and Jeff agreement before parallel edits)
| Item | Contract |
|---|---|
| Link | `iaos-airdroid:call?number=NNNNNNNNNN`. Exactly this form. |
| `number` | 10 digits, US. Area code and exchange start with 2–9. No `+1`, separators, extension or other parameters. |
| Builder (browser) | `app/src/lib/airdroid-prepare-call.ts` exports the builder. It returns the link, or `null` when the seller number is not valid; then the button is disabled and shows the reason. It is pure, does no I/O and writes nothing. |
| Opening | The Seller Call button opens the link with ordinary navigation (an anchor `href` or `window.location.assign`). No popup, no fetch. |
| Browser feedback | Only "Sent to the AirDroid helper on this PC. Check AirDroid and your phone." Never "calling", "connected", "prepared" or "ended". |
| Helper result | Shown on the PC by the helper, not reported back to IAOS (there is no channel back). |
| Writes | None, from either side. Notes and outcomes are saved by the existing controls, independently. |
| Version | A future change uses a new action name (for example `call2`), so old links are refused rather than misread. |

**Compatibility note:** the code at `0b59e5e` still implements the earlier `prepare` action (prefill only). Once v1 is
agreed, Jeff changes the builder, the handler and the tests to `call` in one commit.

## Helper behaviour for `call` (Jeff; design, not yet implemented)
1. Validate the number, as `PrepareCall.ps1` already does.
2. Find exactly one AirDroid main window and bring it forward.
3. Find exactly one visible `frmAirCloud` (deduplicated by window handle) that contains exactly one visible number
   field. This is the live Dialpad.
4. Replace the number and require an exact readback. This is the existing, reviewed prefill.
5. Identify Make Call **structurally**:
   - inside that form there must be exactly one 12-key grid;
   - exactly one visible panel at least 90% of the grid's width must sit below it;
   - that panel must not be inside the call-status panel (the parent of the "Unknown" caller label);
   - it must be enabled.

   Anything missing or ambiguous means **stop with no click**.
6. Recheck immediately before clicking: the same control, the same rectangle, and the number field still reads the
   exact number.
7. Send **one** left-button down/up pair to that control's own window handle. There is no retry on any path, End
   Call is never touched, Enter is never pressed, and the real pointer is not moved.
8. **Duplicate guard:** refuse a second activation within a short window (for example 30 s) using a lock file under
   the user's temp folder.
9. Report on the PC: "Make Call activated once. Check your phone." Exit codes distinguish "click sent" from "stopped
   before click". **"Click sent" is not evidence a call connected.**

**Implementation route:** writing the click code was denied once by the Claude Code auto-mode classifier
("[Auto-Mode Bypass]", section 11). Jeff will write and test it **only through Manual-mode human approval
prompts**. Until then the helper remains prefill-only.

## File ownership (PROPOSED)
| File | Owner | Notes |
|---|---|---|
| `tools/airdroid-prepare-call/*` (helper, link handler, README) | **Jeff** | |
| `app/src/lib/airdroid-prepare-call.ts` (launch contract builder) | **Jeff** | Scotty imports it and does not edit it. Contract changes go through Jeff. |
| `app/scripts/test-airdroid-prepare-call.cjs` | **Jeff** | |
| `app/package.json` test entries and `.github/workflows/ci.yml` test steps | **Jeff** | Scotty asks Jeff to add entries for his tests. Jeff's B14-13 entries sit away from Board 13's hunks, and a `git merge-tree` check against `b13-scotty-responsive-nav` is clean. |
| `docs/B14-13_AIRDROID_PREPARE_CALL.md` | **Jeff** | |
| `app/src/components/SellerCallVoiceControls.tsx` and `.css` | **Scotty** | Adds "Call with AirDroid" as the first, primary option. GHL stays as the backup option, and Cell stays. Seller Call only; the Contact page is deferred. |
| `app/scripts/test-seller-call-voice-controls.cjs` (existing suite for that component) | **Scotty** | Coordinate with Jeff for CI wiring. |
| `app/src/pages/SellerCallWorkspace.tsx`, script drawer, notes, outcome controls, contact selection | **No change planned** | Any need to touch them is raised first. They are heavily edited by Board 15. |
| GHL softphone code (`ghl-call-handoff.ts`, `GhlHandoffNotice`) | **Out of scope** | Unchanged. |

## Overlap check (2026-10-09)
**Compared against:**
- `b15-integration` `45361c1` and `docs/B15_INTEGRATION_HANDOFF.md`;
- every `origin/b15-*` branch;
- `b13-scotty-responsive-nav`.

**Results:**
- **Board 15 feature branches:** all are fully contained in `b15-integration`.
- **Oct 5 review compositions** (`b15-release-candidate`, `b15-subset-review`, `b15-trial-combined-review`): their
  call-area edits are already present in `b15-integration` in revised form, so they are superseded.
- **Board 13:** touches `Layout.tsx`, `app/package.json` and CI, in hunks separate from this branch.
- **No active overlap.**

## Launch-link registration plan (for Brad's review through Manual-mode approval; NOT approved, NOT done)
Registration is a persistent per-user change. A registration script was **not** written: writing one was denied as
"[Unauthorized Persistence]", and it is not being retried or recreated. If Brad approves, these exact actions would
run as individual Manual-mode prompts:

1. **Precheck (read-only):** `HKCU:\Software\Classes\iaos-airdroid` must not exist; if it does, stop.
2. **Create (current user only; no administrator rights; nothing machine-wide):**
   - `HKCU:\Software\Classes\iaos-airdroid`, default value `URL:IAOS AirDroid Call`, and string value
     `URL Protocol` = empty.
   - `HKCU:\Software\Classes\iaos-airdroid\shell\open\command`, default value:
     `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<helper folder>\IaosAirdroidHandler.ps1" "%1"`
3. **Verify (read-only):** read the three values back exactly.
4. **Removal (when asked):** delete `HKCU:\Software\Classes\iaos-airdroid` and its subkeys, then confirm it is gone.

**Security decision needed (Jess/Bones):**
- Once registered, **any web page** could open an `iaos-airdroid:` link. Edge and Chrome ask "Open … ?" before
  launching an external app, unless "always allow" is ticked for that site.
- The handler accepts only `call` plus one valid 10-digit US number, but a hostile page could still try to make
  Brad's phone call a number.
- **Options:**
  - (a) treat the browser's launch prompt as the confirmation, and never tick "always allow";
  - (b) have the helper show its own one-click confirmation ("Call (202) 555-0147?");
  - (c) bind launches to a shared secret, which needs a design.
- Option (b) adds a second click, contrary to the finish line. Option (a) is the current proposal.

## Remaining blockers
1. **Launch contract v1 and file ownership:** agreement with Scotty (via Brad).
2. **Activation code:** writing and testing it through Manual-mode approvals.
3. **Registration:** Brad's approval of the plan above, and the security decision.
4. **AirDroid connection label (Local or Remote):** not observed by Jeff. Window capture is denied, and the label is
   drawn, not readable as text. Brad needs to read it. No Premium purchase is authorized.
5. **Validation on Brad's laptop:** not done.
6. **Durability:** the helper depends on AirDroid's internal names. Two visible Dialpad forms exist, so an AirDroid
   update can break identification; the helper must then stop, not guess.
