# Call-log recovery procedure

Board 15 / PR #131. Scope: durable call-log ownership (`app/netlify/functions/lib/call-log-barrier.ts`). This procedure is separate from the Current Offer recovery procedure and from the Under Contract stage-marker procedure, and it does not apply to either.

## When this procedure applies

A contact's call save stays blocked, for every session, until each step has **evidence**:

| Step evidence | Meaning | Settled by |
|---|---|---|
| `confirmed` | GHL answered, and the server verified the write. | The write itself |
| `withdrawn` | The request never reached the GHL call. It can now never be sent: a late handler loses the atomic send claim. | **Check again** (automatic) |
| `not_dispatched` | The handler that owned the send recorded that it never called GHL. | **Check again** |
| no decision, behind a confirmed step | The step was never sent. | **Check again** finishes it with its **original** request id |
| `unresolved` | The send was claimed, so the GHL call may have been made. The outcome is uncertain or was never recorded (for example, the function died). | **Only this procedure** |

This procedure is needed **only** for an `unresolved` step. The page labels it "Unresolved — the … was sent and may still reach GHL". **Check again** cannot clear it, by design.

## Rules

1. **There is no operator bypass.** No button, API or setting clears an attempt on someone's word, and this procedure adds none.
2. **None of these is evidence on its own:**
   - a fresh GHL read showing the result or the note;
   - elapsed time;
   - a page reload;
   - someone checking GHL by eye.
3. **IAOS cannot cancel a request that GHL may have received.** HighLevel documents no idempotency key, cancellation or request-status lookup for these endpoints. A note sent twice is two notes.
4. **The procedure may conclude that the attempt cannot yet be cleared.** Then the contact's call log stays blocked, and Brad is told which contact and which step. Other contacts are unaffected.
5. **Evidence gathering is read-only.** No live GHL proof writes, Production changes or record edits.

## Roles

- **Jeff** gathers the evidence and writes it up.
- **Bones** reviews it.
- **Jess** decides.
- **Brad** is informed of the outcome.

## Evidence gathering (read-only)

1. **Identify the contact and step.** The page names the step: the call result, the call note or the last-touch time. `GET /.netlify/functions/call-log-barrier?contactId=…` (read session) returns each step's evidence and the attempt's `createdAt`.
2. **Locate the records.** Keys are under `call-log/` in the `iaos-write-receipts` store. Each is a digest of `env:locationId:…` (see `barrierKey`, `decisionKey` and `outcomeKey`). The barrier record holds the result, the note body and the original request ids.
3. **Read the function logs.** Read the Netlify function logs for `ghl-write` around `createdAt`. `logWriteFailure` records the request id, operation, error name and message, and whether the error was a `WriteUncertain`. Establish whether the handler invocation ended, and what the GHL call returned.
4. **Read the contact in GHL** (read-only): its call result field, its notes (count the call note's exact text) and its last-touch fields, with timestamps.

## Deciding

Write up the facts from steps 1–4 and state which case applies:

- **Safe to resolve:** the evidence establishes that the specific request has **terminated** and its effect on GHL is **known**. For example, the call note appears exactly once, and the logs show the handler ended with no other request outstanding. The write-up names the evidence for both points.
- **Cannot yet be cleared:** anything less. The attempt stays. Record the conclusion, and inform Brad which contact is blocked and why.

## Executing a resolution

This PR contains **no tool that clears an unresolved step**, by design. If Jess approves a resolution, clearing it is its own small change, reviewed by Bones before it runs. That change:

- writes the step's outcome naming the approving decision (for example, a Linear comment id);
- is scoped to that one contact and request digest;
- leaves every other record untouched.

After that, **Check again** settles the attempt from the evidence as usual. It finishes any remaining step with its original id, or releases the contact.
