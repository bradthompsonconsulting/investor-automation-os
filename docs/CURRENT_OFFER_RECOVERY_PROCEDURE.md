# Current Offer recovery procedure

Board 15 / PR #126 stacked server PR. Scope: the durable Current Offer barrier (`app/netlify/functions/lib/current-offer-barrier.ts`). This procedure is separate from the Under Contract stage-marker procedure and does not apply to it.

## When this procedure applies

The barrier blocks a deal for every session until each step it owns has **evidence**:

| Step evidence | Meaning | Cleared by |
|---|---|---|
| `withdrawn` | The request never reached the GHL call. It can now never be sent: a late handler loses the atomic send claim. | **Check again** (automatic) |
| `confirmed` | GHL answered, and the server's readback verified the write. | The write itself, or **Check again** |
| `not_dispatched` | The handler that owned the send recorded that it never called GHL. | The write itself, or **Check again** |
| `unresolved` | The send was claimed, so the GHL call may have been made. The outcome is uncertain or was never recorded (for example, the function died). | **Only this procedure** |

This procedure is needed **only** for a step whose evidence is `unresolved`. The app labels it "may still reach GHL", and **Check again** cannot clear it. That is by design.

## Rules

1. **There is no operator bypass.** No button, API or setting clears a barrier on someone's word, and this procedure adds none.
2. **None of these is evidence on its own:**
   - a fresh GHL read showing an amount;
   - elapsed time or a timeout;
   - a page reload;
   - someone checking GHL by eye.
3. **IAOS cannot cancel a request that GHL may have received.** HighLevel's update-opportunity reference documents only a `200` response. It describes no idempotency key, cancellation, request-status lookup or timing guarantee. (Checked 2026-10-05 against `marketplace.gohighlevel.com/docs/ghl/opportunities/update-opportunity`.) Nothing in IAOS claims otherwise.
4. **The procedure may conclude that the barrier cannot yet be cleared.** Then the deal stays blocked, and Brad is told which deal and which step.
5. **No live GHL proof writes, Production changes or record edits** happen as part of evidence gathering. It is read-only.

## Roles

- **Jeff** gathers the evidence and writes it up.
- **Bones** reviews it.
- **Jess** decides.
- **Brad** is informed of the outcome.

## Evidence gathering (read-only)

1. **Identify the blocked deal and step.** The page shows the step: the Current Offer save, the acceptance note or the last-touch time. The status endpoint (`GET /.netlify/functions/current-offer-barrier?opportunityId=…`, read session) returns each step's evidence and the barrier's `createdAt`.
2. **Locate the records.** Keys are under `current-offer/` in the `iaos-write-receipts` store. Each is a digest of `env:locationId:…` (see `barrierKey`, `decisionKey` and `outcomeKey`). Records hold digests only.
3. **Read the function logs.** Read the Netlify function logs for `ghl-write` around `createdAt`.
   - `logWriteFailure` records the request id, operation, error name and message, and whether the error was a `WriteUncertain`.
   - Match the request by computing `digest(requestId)` against the barrier's step digest.
   - Establish whether the handler invocation ended, and what the GHL call returned, if anything.
4. **Read GHL's own history, if any.** Check whether the location's GHL audit or history view records a change to the field (or the note) with a timestamp. Use it only if it exists and identifies the change unambiguously.

## Deciding

Write up the facts from steps 1–4 and state which case applies:

- **Safe to resolve:** the evidence establishes that the specific request has **terminated** and its effect on GHL is **known**. For example, GHL's history records the change exactly once, and the logs show the handler ended with no other request outstanding. The write-up names the evidence for both points.
- **Cannot yet be cleared:** anything less. The barrier stays. Record the conclusion, and inform Brad which deal is blocked and why.

## Executing a resolution

This PR contains **no tool that clears an unresolved step**, by design. If Jess approves a resolution, clearing it is its own small change, reviewed by Bones before it runs. That change:

- writes a step outcome that names the approving decision (for example, a Linear comment id);
- is scoped to that one opportunity and request digest;
- leaves every other record untouched.

After it runs, **Check again** on the deal clears the barrier through the normal evidence path.

## Storage v2 (storage correction, PR #131)

From the storage cutover on, these records live in `iaos-ownership-v2` and are read and written only through the verified storage adapter (strong reads; conditional writes classified from the real wire outcome; no deletes). Every GHL mutation is admitted through `authz/admission`; an uncertain send keeps its admission ticket, which blocks overlapping saves until a CONFIRMED outcome of that exact attempt is recorded. Records from before the cutover are never resumed: the conservative import turns them into `authz/legacy-block/<subject>` records, which nothing clears. There is still **no clearing authority**. Design: [`STORAGE_V2_LIFECYCLE.md`](STORAGE_V2_LIFECYCLE.md); release procedure and stuck-lock steps: [`STORAGE_V2_CUTOVER_RUNBOOK.md`](STORAGE_V2_CUTOVER_RUNBOOK.md).
