# HANDOFF — shared callback helper: WIRED + VERIFIED (2026-07-15)

Status file, now a completion record. Read this + `CONTACT_WORKSPACE_SPEC_v2.md` §9/§10/§11.

## STATUS: DONE ✅

Both surfaces are wired onto `scheduleCallbackGated`, deployed to production, and all three
verifications passed live with numbers. Nothing outstanding from this task. The one thing
still open is unrelated and pre-existing: the Lead Queue UI-copy blurb (§10 item 2 below).

- **Wiring — commit `b76802a`** (feat: wire both surfaces to shared `scheduleCallbackGated`).
  ContactWorkspace + Dashboard both call the shared helper; failure mapping made identical
  stage-for-stage; `formatCallbackTime` collapsed to one definition in `callbackWrite.ts`
  (both local copies removed); `tsc -b` clean.
- **Deployed** to `app.investorautomationos.com` alongside `17c6238` (chore: playwright devDep
  for the harnesses). Bundle gate proved live: old code built to `index-DlH3mUN9.js`, wired
  code to `index-BCwmjQxm.js`, prod served `index-BCwmjQxm.js` (method in §9.2 of the spec).

### Verification results (actual numbers, not "passed")

1. **Dashboard grey test** — 3 gated writes in order `callback(200) → note(201) →
   attempt(200)`, no 4th; `last_call_attempt` advanced `20:53:34.890Z → 22:09:26.014Z` (assert
   keys on the VALUE advancing, not band membership — she was already band 3); `listAll`
   converged after 35 polls (~105s, §11); reload → `opacity 0.55`, band 3, keyed off
   `last_call_attempt`; cleaned up. EXIT 0.
2. **Dashboard `route.abort` gate** — aborts callback=1, note=0, attempt=0 (gate HELD; note +
   attempt never attempted); error surfaced ("Couldn't schedule callback: Failed to fetch"),
   popover stayed open; `last_call_attempt` unchanged `22:09:26.014Z`; INTERCEPTION_FIRED true
   (counted inside the abort). EXIT 0.
3. **Workspace re-runs** — Phase A: 3 gated writes `callback(200) → note(201) → attempt(200)`,
   attempt advanced `22:09:26.014Z → 22:18:56.259Z` and persisted; Phase B gate: callback=1,
   note=0, attempt=0, error surfaced, popover open, no state change. Extraction left the
   Workspace's observable behavior identical. EXIT 0.

Final live state: Neelima's callback cleared; `last_call_attempt` left at `22:18:56.259Z`;
test notes left in place. Full write-up with the bundle-gate method lives in the spec §9.1/§9.2.

## Where we were (historical, pre-wiring)

The grey-rule mechanism was settled from source and the shared callback-write helper was
built and **proven behavior-identical**, but **not yet wired into either surface**. That
refactor + its live verification was the task — now complete (above).

## What's DONE and committed

- **Grey mechanism reframe — commit `fc3a078` (pushed).** Settled from source: a fresh
  `last_call_attempt` (< `RESURFACE_HOURS`) greys; notes are NOT read by the grey
  computation. "A note greys" is a downstream coincidence of the note+`setLastCallAttempt`
  pairing. `CONTACT_WORKSPACE_SPEC_v2.md` §6 restructured (MECHANISM / CONVENTION /
  CONSEQUENCE / STEP 6 REQUIREMENT); `DASHBOARD_SPEC_v2.txt` GREY-OUT section reframed;
  Dashboard.tsx header comment fixed; both specs swept of note-drives-grey phrasing.
  Frontend-gate caveat added verbatim to §6.
- **`verify_gate_v2.js` (Workspace callback gate-failure test): FIRED, exit 0, clean.**
  `INTERCEPTION_FIRED: true` (1 write aborted), `GATE_HELD: true` (note POST never
  attempted), `ERROR_SURFACED: true`, no state change, tags unchanged. The self-check
  guarantees it actually ran (a silent no-run prints `TEST_DID_NOT_RUN` / exit 2). **The
  frontend-gate caveat in the spec is backed — do NOT name it untested in §10.**

## Shared helper — built, proven, NOT wired

- **`app/src/lib/callbackWrite.ts`** (committed alongside this handoff; unwired dead code
  until the refactor imports it) exports:
  - `formatCallbackTime(iso)` — the shared date formatter (currently duplicated in
    Dashboard.tsx and ContactWorkspace.tsx; the wiring should point both at this one).
  - `scheduleCallbackGated(ghl, id, iso): Promise<ScheduleResult>` — the gated sequence
    `setCallbackDatetime → notes.create → setLastCallAttempt`, each gating the next, with
    the §6.1 note copy. Returns a discriminated result (`ok` | fail `stage`:
    `callback`/`note`/`attempt` + `error` + `callbackPersisted`). `ghl` is injected (not
    imported) so it's testable with a mock.
- **Proven behavior-identical to the Workspace's current `handleSaveCallback`** before
  wiring, two complementary proofs (division of labor matters — see next section):
  - SOURCE-diff: a verbatim baseline copy's `handleSaveCallback` function text is
    byte-identical to the live Workspace's (empty diff, sanity-checked non-empty).
  - BEHAVIOR-comparison: baseline vs helper driven by a mocked `ghl` across all four gate
    scenarios (all-succeed, fail@callback, fail@note, fail@attempt), self-checking that each
    scenario actually ran. Final: **ALL 4 SCENARIOS RAN AND MATCHED, exit 0** (GHL call
    order + note copy + outcome).

## Source-diff vs behavior-comparison — the division of labor (why the stub exited 1)

Important nuance for the fresh context: these two proofs cover different things and neither
alone is sufficient.

- The **source-diff** proves only the **function text** (the gated logic + ordering). It
  references `formatCallbackTime` by name; it does NOT prove which formatter that name
  resolves to. So "IDENTICAL" from the source-diff means "same logic text," NOT "same
  runtime output / same note copy."
- The **behavior-comparison** proves the **runtime output**, including the resolved
  formatter and the note body. On the first run the harness's baseline used a STUB formatter
  (a wiring bug — an env var wasn't passed), so the note body differed (`FMT<…>` vs
  `Jul 17, 2:00 PM`) and the self-checking comparison **exited 1** — correctly catching a
  real runtime difference, not a false pass. After wiring the baseline to the real
  formatter, the comparison passed 4/4, exit 0.
- Takeaway: a byte-identical function with a different dependency binding produces different
  behavior. Don't lean on the source-diff for note-copy fidelity — that's the behavior
  comparison's job. Together they cover logic + runtime.

## Committed with this handoff

- `app/src/lib/callbackWrite.ts` — the shared helper (behavior-proven, unwired dead code).
- `docs/HANDOFF_callback_helper_wiring.md` — this file.
- Pre-existing untracked, still left alone: `docs/CONTACT_WORKSPACE_SPEC_v1.md`,
  `docs/IAOS DASHBOARD — BUILD SPEC v2.txt`.
- The scratchpad proof harnesses (`cb_baseline.ts`, `run_compare.ts`, `verify_gate_v2.js`,
  etc.) live in the session scratchpad, not the repo — they are not committed and can be
  rebuilt from this doc if needed.

## §10 items (in CONTACT_WORKSPACE_SPEC_v2.md)

1. **DONE — Dashboard callback handler must grey.** Was "DECIDED, pending its own task"; the
   wiring implemented it. Both surfaces now run the gated `setCallbackDatetime → notes.create →
   setLastCallAttempt` pairing, so scheduling from the Dashboard greys off a fresh
   `last_call_attempt` (commit `b76802a`, deployed w/ `17c6238`; verified — results above and
   spec §9.1). Now §10 item 8 (Closed) in the spec.
2. **STILL OPEN — Lead Queue UI copy** (`Dashboard.tsx:816`, "A note is the only thing that
   marks an attempt") is wrong as a mechanism but roughly true as usage guidance. Wording
   undecided; user-facing copy with its own build/deploy/verify cycle. **Untouched by the
   wiring** — the line moved 783 → 816 only because the wiring added code above it; the blurb
   itself is unchanged and still wrong. Not part of this task.

## The refactor (next task, fresh context) — plan

Wire `scheduleCallbackGated` into BOTH surfaces (option B, extraction chosen to avoid
write-ordering drift):
- **ContactWorkspace**: `handleSaveCallback` calls `scheduleCallbackGated(ghl, id, iso)` and
  maps the `ScheduleResult` to its existing state (callbackOverride, attemptOverride,
  callbackError, loadNotes, close popover). `handleClearCallback` unchanged
  (`setCallbackDatetime(id, null)` only). Import `formatCallbackTime` from the shared module,
  remove the local copy.
- **Dashboard**: `handleSaveCallback(contactId, iso)` — when `iso !== null` (schedule), call
  `scheduleCallbackGated` and, on success, set `attemptOverride[contactId]` so the row greys;
  map failures to `callbackError`. When `iso === null` (clear), keep `setCallbackDatetime(id,
  null)` only. Import `formatCallbackTime` from the shared module, remove the local copy
  (note: Dashboard uses it in several places — all become the shared import).
- Still exactly three write METHODS; no new one. Dashboard's callback path gains the note +
  attempt writes (that's the intended §10-item-1 behavior change).

## THREE verification conditions for the Dashboard fix — ALL SATISFIED 2026-07-15

All three ran live at app.investorautomationos.com, 2560px, Neelima Bale `FiIT0hUaxVCIuokQpZuc`
by explicit ID, polling (never fixed-wait), real `page.reload()`, each harness self-checking
that it actually ran. Numbers in the "Verification results" section at the top; the conditions
they satisfied are below (kept verbatim as the acceptance bar).

1. **Live grey test on the Dashboard, keyed off the real marker.** Schedule a callback from
   a Dashboard Lead Queue row; write-audit the three gated writes fire in order; then poll
   the `listAll` / `ghl-contacts` (bulk) endpoint per §11 until it reflects the fresh
   `last_call_attempt`, load the Dashboard, and assert the row renders greyed
   (`opacity 0.55`, band 3). The grey must be verified against `last_call_attempt`, NOT note
   presence.
2. **`route.abort` gate-failure test on the Dashboard surface (non-optional).** Same
   bulletproof matcher + self-check as `verify_gate_v2.js` (string `url.includes`, not a
   regex — a `?`-escaping bug silently no-matched once; abort ALL writes so nothing is
   written; assert `INTERCEPTION_FIRED`; fail loud if zero aborted). The per-component state
   mapping is exactly what can diverge, so the gate must be proven on THIS surface, not
   inherited from the Workspace.
3. **Workspace live re-runs after the refactor.** Re-run the happy-path callback test and the
   `route.abort` gate test against the refactored Workspace; confirm identical results (3
   gated writes in order; gate holds on failure). Confirms the extraction left the Workspace's
   observable behavior unchanged.

Cleanup after live write tests: clear Neelima's callback so she carries no dangling live
callback; leave labeled test notes + `last_call_attempt` (permanent/harmless on the
established test contact).

## Automation discipline (learned the hard way this session)

Every new test harness MUST self-check that it actually ran (assert the mock/interception
fired; fail loud + non-zero exit otherwise). Several false signals this session came from
tests that could pass while doing nothing — a route pattern that never matched, an awk
extraction that captured nothing. "All scenarios match" when zero ran is the failure mode to
design against.
