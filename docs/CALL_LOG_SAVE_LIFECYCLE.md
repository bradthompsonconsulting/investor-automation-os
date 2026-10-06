# Call-log save lifecycle

Board 15 / PR #131, Bones's re-review of `808e105`. This document is the complete lifecycle of a contact-page **Save call**. It maps every failure and recovery case to the code that handles it and the test that proves it. The recovery procedure for a step that may still land is in `CALL_LOG_RECOVERY_PROCEDURE.md`.

## Why the browser alone cannot own it

A call save is three GHL writes, in order:

1. the result (`contact.callLogResult`);
2. the call note (`note.create`);
3. the last touch (`contact.lastCallAttempt`).

Through `808e105`, the only memory of an unfinished save lived in the page. A reload, a navigation or another browser forgot it, which allowed three failures:

- a replacement result;
- a competing save, followed by the older one completing;
- a second copy of a note that had already landed.

Ownership now lives in durable server records, scoped to environment, location and **contact**. It is separate from the deal-scoped Current Offer barrier.

## Components

| Layer | File | Role |
|---|---|---|
| Control | `app/src/components/CallLogControl.tsx` | Reads ownership on load and on every contact change. Shows an unfinished save with **Check again**. Save is disabled unless the server reports the contact clear. Reserves before the first write, then sends each step with its reserved request id. |
| Client | `app/src/lib/call-log-barrier-client.ts` | `readCallLogStatus`, `beginCallLog`, `reconcileCallLog` and `sendCallLogStep`. A step's outcome is `confirmed`, `not_sent` (proven) or `uncertain`. Nothing here retries. |
| Server records | `app/netlify/functions/lib/call-log-barrier.ts` | Per contact, a **head** naming the current attempt, changed only by compare-and-swap. Write-once **barrier** (the result, the exact note body, each step's original request id), **request**, **decision** (`send` or `withdrawn`) and **outcome** records. Nothing is deleted. |
| Endpoint | `app/netlify/functions/call-log-barrier.ts` | `GET` status (read session). `POST` begin and reconcile (write session and origin, with the same Production write scope a call-log write needs), under the contact's write lock. |
| Write path | `app/netlify/functions/ghl-write.ts` | A call result, and any note in the call-log format, is refused (`not_sent`) without a reservation. A reserved step runs through `runCallLogOwnedWrite`. |

## The rules

- **Ownership before the first write.** `begin` claims the contact before the result is sent. Any session's `begin` is refused while another attempt is current. The client sends nothing unless `begin` succeeds.
- **Enforced server-side.** `ghl-write` sends a call result, or a call-log note, only as a reserved step. Each step must:
  - carry its reserved request id;
  - be for the reserved contact and operation;
  - carry the reserved result value or the exact reserved note body;
  - belong to the current attempt.

  Otherwise it is refused before anything is sent.
- **Order.** A step is sent only when the previous step's outcome is **confirmed**. The note can never be sent unless its result landed, and the last touch never unless the note landed.
- **At most once.** Each request id can claim `send` once, atomically, inside the write boundary immediately before the GHL call. A duplicate is refused by that claim and by the write receipt.
- **Original identities.** An unfinished attempt is finished with the same request ids and the same note body. Reconcile returns them from the barrier record. **A step is never re-sent under a fresh id.**
- **Evidence only.** A step may still be applied by GHL when it was sent and its outcome is uncertain or missing. Nothing clears it:
  - not a GHL read;
  - not elapsed time;
  - not a reload;
  - not an operator.
- **No reload advice.** No message recommends a reload to clear anything. A reload shows the same state, because it comes from the server.

## Attempt standing (server evaluation, step by step in order)

| Standing | Evidence | Status shown | **Check again** (reconcile) |
|---|---|---|---|
| complete | every step `confirmed` | the head is released by the last step's own handler | releases, if still held |
| pending | first step has **no decision** (it may still be on its way) | "…was started and is not confirmed — it may still be on its way…" | **withdraws** it atomically, and the rest; releases. The page shows "not saved — nothing was sent". A delayed request that arrives later loses its send claim and sends nothing. |
| resumable | a later step has no decision behind a confirmed step | "…is partly saved: its call note and last-touch time have not been sent yet…" | **changes nothing**. Returns the remaining steps' **original** request ids, the result and the note body. The page sends them, in order. |
| stopped | a step was provably never sent (`withdrawn` or `not_dispatched`) | (as pending, until checked) | withdraws the undecided later steps; releases. The page shows what landed. If the note never landed: "Result saved; notes not saved" with **Retry notes**, a new reservation (`call_log_note`) for that note and last touch. |
| uncertain | a step was sent and its outcome is uncertain or missing | "Unresolved — the … was sent and may still reach GHL…" | **changes nothing**. Only `CALL_LOG_RECOVERY_PROCEDURE.md` may resolve it. If the outcome was only missing because the handler was still running, it becomes `confirmed` when that handler finishes. Check again then finishes the attempt. |

**Scoped reconcile.** After a refusal, a page settles **its own** attempt (`attempt` = that attempt's first request id). If that attempt is no longer current, nothing changes and only its own evidence is reported. A page left behind by a reload or navigation can never withdraw a **newer** attempt's step.

## Failure and recovery map

| Case | What happens | Proof |
|---|---|---|
| Result write refused before sending (lock, GHL read failed, storage) | `not_sent`. The step is withdrawn, or left undecided; Check again settles it. The page shows "Result not saved — nothing was sent", and GHL agrees. | `test-call-log-barrier`: "a RESULT refused before sending". `test-call-log-ownership`: O6. |
| Result write uncertain (sent; GHL's answer lost at the server) | `uncertain`. The page shows "Result not confirmed … may still reach GHL". Nothing after it is ever sent. Repeated Check again and reloads keep it blocked. | `test-call-log-barrier`: "uncertain RESULT". O5. |
| Result confirmed, browser lost the answer | The page cannot claim it saved. The server shows it partly saved; Check again finishes it with the original ids. | O5 (lost answer). |
| **Bones 1**: result confirmed, readback failed, then reload, then a replacement result | After the reload the page shows "partly saved". Save and the results are disabled. A replacement can neither be reserved nor sent: `begin` is refused, and an unreserved call result is refused. Check again finishes the original with its original ids; one note. | `test-call-log-barrier`: REPRO 1 (both). O1. `808e105` control: the replacement wrote a second result, note and touch. |
| **Bones 2**: pending save, then away and back, then a competing save, then the older completion | Back on the contact, the pending save blocks. A competing save cannot start. (a) The older one completes on its own: one result, one note, one touch. (b) After a reload, it lands and Check again finishes it with its original ids. (c) Check again first withdraws it; the newer save goes through; the older request arrives later and sends nothing. | `test-call-log-barrier`: REPRO 2 (four checks). O2, O2r, O2b. `808e105` control: a competing save started. |
| **Bones 3**: note landed, response pending, then reload, then a duplicate note | After the reload: "may still reach GHL"; Save disabled. Check again changes nothing. The same id is refused, a fresh id is not reserved, and a new attempt is refused. When the handler confirms, Check again sends **only** the last touch, with its original id. GHL holds one call note. | `test-call-log-barrier`: REPRO 3 (three checks). O3. `808e105` control: no unfinished state after the reload. |
| Note sent, answer lost at the server | Uncertain forever: no second note, no last touch. | REPRO 3 (lost response). O5. |
| Note refused before sending | The attempt stops: result saved, note withdrawn. **Retry notes** (a new reservation) writes it once. | "a NOTE refused before sending". O6. `test-contact-isolation`: C5c. |
| Note answered by a gateway failure (never reached the server) | Uncertain on the page. Check again finishes it with the **same** id; one note. | `test-contact-isolation`: C5. |
| Contact's write lock held by another write | The step is `not_sent` with no decision, so it stays resumable with its own id. | "another write holding the contact lock". |
| Last touch uncertain | Blocked, naming the last-touch time; one touch request. | "uncertain LAST TOUCH". O5. |
| Two sessions | The second sees the first's save and cannot start one. Both finishing the same attempt get the same ids; one note and one touch reach GHL. Repeated reconciliation is stable. | "two sessions finishing the SAME attempt", "a second session cannot begin". O4, O7. |
| Navigation mid-save | The attempt runs to its end for **its** contact. Only the screen follows the contact shown, and each contact has its own in-flight guard. | `test-contact-isolation`: C6. O8. |
| Contact isolation | An unfinished save on A never blocks B. A's ids cannot write to B. | "contact isolation". O8. `test-read-session-recovery`: R4. |
| Storage failure (claim, outcome, begin, status, reservation read) | Nothing sent, never assumed finished. A failed status read counts as blocked. | `test-call-log-barrier` storage checks. |
| Read sign-in ends mid-save | The page is not remounted. Ownership survives on the server anyway. | `test-read-session-recovery`: R1–R3, P1CL. |

## Unchanged

- A plain contact note, and a last touch with no call-log reservation (Dashboard notes, the Contact-page note, Seller Call outcomes), write exactly as before.
- The deal's Current Offer barrier is independent of the contact's call log. A pending Current Offer save does not block a call save, and the reverse.
- The `808e105` recovery and display fixes are kept.
