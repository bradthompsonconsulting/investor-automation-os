# Current Offer save and Accept lifecycle

Board 15 / PR #126 plus its stacked durable-barrier PR, reviewed as **one** repair (Jess, 2026-10-05). This document is the complete lifecycle. Every failure case named in the ruling is mapped to the code that handles it and the test that proves it. The recovery procedure is in `CURRENT_OFFER_RECOVERY_PROCEDURE.md`.

## Components

| Layer | File | Role |
|---|---|---|
| Page | `app/src/pages/SellerCallWorkspace.tsx` | The input (read-only while the deal is locked), blur → `requestSave`, Confirm Accept, status read on load and deal change, **Check again**. |
| Coordinator (browser, one per loaded app) | `app/src/lib/current-offer-save-coordinator.ts` | Serializes saves per deal: one write and its readback at a time, a queue, coalescing, de-dupe. Owns the deal state (confirmed, failure, unresolved, accepting) and the labels. |
| Barrier client | `app/src/lib/current-offer-barrier-client.ts` | `beginReservation`, `readReservationStatus`, `reconcileReservation`. |
| Write client | `app/src/lib/ghl.ts`, `write-command.ts` | `setCurrentOffer`, `notes.create` and `setLastCallAttempt` carry the reserved request id. |
| Server records | `app/netlify/functions/lib/current-offer-barrier.ts` | Per deal: one **head** naming the current barrier, changed **only by compare-and-swap** on its etag. Write-once barrier records. Per request: a registration, a decision (`send` or `withdrawn`, atomic) and an outcome. **Nothing is ever deleted.** |
| Server endpoints | `current-offer-barrier.ts` (begin, reconcile, status); `ghl-write.ts` (owned writes) | The contact lock still serializes these, but safety rests on the conditional head write, not on the lock. |
| Write boundary | `lib/ghl-write-boundary.ts` | Claims `send` immediately before the GHL call. |

## States

| Deal state | Server records | Browser label | Input |
|---|---|---|---|
| Idle, verified | no barrier; coordinator holds the verified amount | "Recorded in GHL" for that amount, "Draft" otherwise | editable |
| Saving | a barrier owning the blur step | "Saving to GHL…" | editable (later edits queue) |
| Refused (proven) | released: the owner withdrew it, or it was never sent | "Not saved — nothing was sent to GHL" | editable |
| Accepting | a barrier owning offer, note and touch | "Saving…" / "Recorded" for the accepted amount | **read-only** |
| Unresolved: in progress or interrupted | a barrier with steps that have no decision | "…in progress or was interrupted… use Check again" | **read-only** |
| Unresolved: may still reach GHL | a barrier with a sent step whose outcome is uncertain or missing | "Unresolved — the <step> may still reach GHL…" | **read-only** |
| Agreement Reached | released after the touch step is confirmed | Agreement Reached | frozen by the existing gate, and refused by the server |

## Storage consistency (Bones / Jess, second review)

Lambda-compatibility functions can't make strong reads, so any read may be **stale**. The Blobs API has **no conditional delete**. Therefore:

- **Nothing is deleted.** Barrier, request, decision and outcome records are write-once (`onlyIfNew`).
- **Only the per-deal head changes, and only by compare-and-swap:** `onlyIfNew` when it is absent, `onlyIfMatch: <etag>` otherwise.
- **Stale evidence can't do damage.** A decision made on a stale read carries a stale etag, so its write fails and the code re-reads. A settled first barrier, seen through a stale head, can never clear or replace a newer barrier.
- **Stale reads of write-once records** can only be *missing* data. A missing decision makes the withdraw claim fail and re-read; a missing outcome reads as unresolved.
- **"Clear" is reported only after a successful conditional write** against the latest head, never from a read alone. A persistently stale head gives up after four attempts with a 503, and nothing changes.

## Blur save, step by step

1. **Blur:** `requestSave(deal, amount)`.
   - It is ignored if the deal is accepting or unresolved.
   - It queues behind a save already in flight; a later blur replaces a queued one.
   - It is skipped if the amount is already last in line, or already verified with nothing written since.
2. **Pump:** one item per deal.
   - The write first calls **begin** (`blur`, `[offer: R]`), under the contact lock, atomic `onlyIfNew`. The reservation is refused if any barrier exists for the deal.
3. **`ghl-write`** with request id R:
   - checks that the reservation names R for this operation and target;
   - takes the contact lock and runs the existing gates;
   - **claims `send` for R inside the boundary immediately before the PUT**;
   - sends the PUT and reads it back;
   - records the outcome and releases the barrier if it is confirmed.
4. **The browser classifies the result by proof:**
   - **confirmed:** the readback verified it;
   - **refused:** the server answered `not_sent`, sign-in was required before sending, or local validation failed;
   - **indeterminate:** everything else. The deal becomes unresolved and the queue is dropped.

## Confirm Accept, step by step

1. `beginAccept`: the input locks, queued (never-sent) blur saves are dropped, and new blurs are ignored.
2. `whenIdle`: wait for a blur save already in flight. If it ended unresolved, stop and send nothing.
3. **begin** (`accept`, `[offer: R1, note: R2, touch: R3]`). If it is refused or unknown, stop and send nothing; an unknown result blocks.
4. `runConfirmAcceptWrites` (unchanged): the offer write (R1) goes through the same per-deal queue, then the note (R2), then the last-touch (R3). Each step is claimed and recorded on the server.
5. **finally:** **reconcile.**
   - It withdraws never-sent steps.
   - It clears only if every step is withdrawn, confirmed or `not_dispatched`.
   - Otherwise the deal stays unresolved, with the server naming the step.
   - The accept module's partial-failure messages are unchanged. Nothing is called atomic.

## Accept timestamp recovery ("Check & retry call timestamp")

1. **Reconcile first.** While the original last-touch request (or any step of the deal's barrier) is unresolved, nothing new is sent: no reservation and no timestamp write. The reason is shown, naming the step.
2. **Only when the server proves every step**, reserve a last-touch-only request (purpose `touch`). The recovery's write carries that new id.
3. **Reconcile again.** An unproven write keeps the deal blocked.

The recovery's own read-first logic (`recoverLastCallAttempt`) is unchanged. Its messages no longer invite a blind retry or a reload. The page's other note writes (evidence notes, Follow-Up / Pass outcomes) aren't Accept steps.

## Failure cases (Jess's list) and their tests

Abbreviations:
- **S** = `test-current-offer-barrier.cjs` (real handlers, in CI)
- **C** = `test-current-offer-save-coordinator.cjs` (in CI)
- **O** = `test-seller-call-offer-interaction.cjs` (browser)
- **A** = `test-seller-call-accept-protection.cjs` (browser)
- **I** = `test-contact-isolation.cjs` (browser)

| Case | Behaviour | Tests |
|---|---|---|
| **Overlapping saves** | One write and its readback per deal at a time; the queue coalesces; the corrective save is never skipped; "Recorded" only for the verified amount with nothing pending. | C 2–4; O 2, 5, 8–13 |
| Older save finishes late or is refused | It never labels a newer amount; a refusal releases the barrier. | O 6, 11, 12 |
| **Navigation** (deal A → B, leaving the page) | Per-deal state; the shared coordinator keeps an unresolved deal blocked across navigation; a status read on return. | C 10; O 5, 14, 15; A A5 |
| **Reloads** | The durable barrier survives: status on load blocks; nothing is sent; **Check again** clears only with evidence. | O 19, 20, 22; A A4b, A5 |
| **Two browsers** | Browser 2 sees browser 1's save in progress, or its unresolved save, and sends nothing, not even a reservation. It clears only when the server has evidence. | O 21; A A7; S "second session cannot begin" |
| **Uncertain submissions** | Lost before the server: withdrawn by reconcile, and a late arrival sends nothing. Lost after the GHL call, a 5xx, the generic 409, a 202, or a readback that doesn't verify: stays unresolved, with no retry and no release of queued saves. Neither a snapshot nor time clears it. | S "delayed handler", "withdrawal wins", "lost response", "part-way", "2xx not verified"; C 6; O 7, 11, 15–17, 19, 20 |
| Duplicate request | A second send of the same id sends nothing. | S "duplicate" |
| **Partial Accept failures** | Offer refused, lost before the server, or lost after the GHL call; note refused, or lost after the call; last-touch lost. Each is reported by the existing messages, and the uncertain step is tracked and named. | A A2, A3a, A3b, A4a, A4b, A6; S Accept cases |
| Storage failures | Begin, claim, outcome, status and reservation-read failures never send and never clear. | S storage cases; O 22 |
| **Stale storage** | A stale head naming the settled first barrier can't clear or release the newer unresolved barrier. A stale empty head can't let a second barrier in or report clear. A persistently stale head answers 503 and changes nothing. | S "STALE FIRST BARRIER / NEWER UNRESOLVED BARRIER" (reconcile and release), "stale empty head", "persistently stale", "nothing deleted" |
| **Timestamp recovery** | While the original last-touch is unresolved (sent, not yet applied), recovery sends nothing. When it is proven unsent, recovery reserves first, then sends exactly one write with a new reserved id. | A A6 (recovery refused twice), A6b (reserved recovery) |
| Lock contention | Reconcile while a write holds the lock answers `in_progress` and changes nothing. | S "held lock" |
| Contact isolation (unchanged) | A's late results never reach B. | I (87/87) |

## Out of scope / known limits

- A step that was sent and is unresolved stays blocked until the reviewed recovery procedure. This repair includes no clearing tool.
- HighLevel documents no idempotency key, cancellation or request-status lookup. IAOS claims none.
