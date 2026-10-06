# Call-log save lifecycle (v3)

Board 15 / PR #131. This implements the **Bones-approved lifecycle v3** (PR #131 `#issuecomment-6023481488`). That comment is the contract. This document maps it to the code and the tests. The recovery procedure for a protected, uncertain step is in `CALL_LOG_RECOVERY_PROCEDURE.md`.

## The model

- **One operation per call.** One **Save call** is one **operation** with a permanent `operationId` (UUID).
- **Three slots, in order:** result (`contact.callLogResult`), call note (`note.create`), last touch (`contact.lastCallAttempt`). Each slot is satisfied **at most once**.
- **Attempts.** A slot has numbered attempts. Their request ids are **derived**: `<operationId>-<slot>-<n>`.
- **When a new attempt may exist.** Attempt `n+1` exists only after attempt `n` is **durably proved unsent**.
- **Recovery continues the same operation.** Check again, Retry notes and Retry last-touch time only ever continue that operation.
- **A new call is a new operation.** It is allowed only when the contact has no open operation.
- **Saved means complete.** Only a recorded, `complete` operation is shown as **Saved**. A refused or uncertain operation stays visibly incomplete.

## Components

| Layer | File | Role |
|---|---|---|
| Control | `app/src/components/CallLogControl.tsx` | **On load and contact change:** reads the contact's open operation. **Save:** begins a new operation, sends the result once, reads it back, then continues through the server's next actions. **Check again** calls `resume`; **Retry notes** and **Retry last-touch time** call `retry` with `after`. **After any answer that is not a confirmation:** reads the operation by its **original id** and shows what was recorded. |
| Client | `app/src/lib/call-log-barrier-client.ts` | `readCallLogStatus`, `readOperation` (by original id), `beginOperation`, `resumeOperation`, `retryAttempt`, `settleLegacy`, `sendCallLogStep`, and `describe` (the wording). |
| Server records | `app/netlify/functions/lib/call-log-barrier.ts` | Operation, attempt, **dispatch binding**, decision, outcome and **final** records (write-once), plus the per-contact head (compare-and-swap). Nothing is deleted. |
| Endpoint | `app/netlify/functions/call-log-barrier.ts` | **Read session:** `GET` status by contact, or by operation. **Write session and origin:** `begin`, `resume`, `retry`, legacy `resume`, under the contact's write lock. `begin` is subject to the Production write scope. |
| Write path | `app/netlify/functions/ghl-write.ts` | **Refused when unbound:** a call result or call-log note that is not a bound attempt of the contact's current operation gets `not_sent`. **Bound attempts** run through `runCallLogOwnedWrite`. |
| Legacy | `app/netlify/functions/lib/call-log-legacy.ts` | The frozen `558c666` module, used only to settle an existing `558c666`-format unfinished head. |

## Records

```
call-log/head/<contact>            {v:3, current: op | null}         CAS; released only FROM the operation it names
call-log/v3/op/<op>                contact, result, exact note body  write-once
call-log/v3/attempt/<op,slot,n>    request id                        write-once
call-log/v3/binding/<request>      op, slot, n, contact, operation,  write-once DISPATCH BINDING
                                   result value / body digest
call-log/v3/decision/<request>     send | withdrawn                  write-once, atomic
call-log/v3/outcome/<request>      confirmed | not_dispatched | uncertain
call-log/v3/final/<op>             complete | not_saved              write-once, read back BEFORE release
```

## Rules (v3 section, then code)

- **Publishing an attempt (§3).** `publishAttempt` and `writeOnceVerified`:
  1. Write the attempt record **and** its binding with `onlyIfNew`.
  2. **Read both back and verify them.**
  3. Only then grant send permission.
  4. On a failed or ambiguous write acknowledgement, **reread the same identity**. Never allocate a fresh one.
- **What `ghl-write` verifies before sending (§3.7).** `runCallLogOwnedWrite` checks:
  - the binding and the attempt both exist;
  - this is the slot's **current** attempt;
  - the operation is open, unfinished and current;
  - the request carries the bound contact, operation, value or body;
  - the previous slot is confirmed.

  Any failure there **writes no record**.
- **Proof (§4).** The only proof that a request never went out is its durable `withdrawn` or `not_dispatched` record. A refusal reports `proves: "this_request" | "nothing"`. A losing duplicate's refusal proves nothing.
- **Result (§5).** Exactly one attempt.
  - **Undecided:** `resume` withdraws it atomically. Success means **Not saved**. If dispatch won the race, the operation stays blocked until that attempt's outcome is known.
- **Note and touch (§6).**
  - **Undecided:** reuse the same request id.
  - **Proved unsent:** an explicit `retry {slot, after: n}` publishes attempt `n+1`. Only after the previous slot is confirmed.
  - **Uncertain:** protected.
  - **A persistent note refusal** stays a visible partial save. Ownership is retained, and Retry notes stays available.
  - **There is no "Finish without note".**
- **Finalization (§7).**
  1. Write `final`, then read it back.
  2. Release the head **only from that operation**.
  - **Final write fails:** ownership is retained, shown as "finishing". The next status, resume or retry retries finalization only; it never resends a write.
  - **Release fails:** a later reconciliation releases the head only if it still names that operation. A new `begin` first completes the release of a finished operation.
- **Stale requests of Call A (§7).** These all return **A's recorded outcome** without changing B:
  - a `begin` of a finished operation (which never reopens it);
  - a `resume` or `retry` for A;
  - a step request for A (`operation_not_current`, with no record written).
- **Older clients (§10).** Pre-#131 clients are refused. `558c666`-shape requests get 400. A `558c666`-format head is blocked, and is released only when its evidence settles: all steps confirmed, or the first step proved unsent. It is never resumed or resent.

## Acceptance matrix: where each case is proven

Server means `app/scripts/test-call-log-barrier.cjs` (47 checks, in CI). Page means `app/scripts/test-call-log-ownership.cjs` (43 checks, local browser).

| Case | Server | Page |
|---|---|---|
| D1 Bones's exact order | D1 | D1 (two contexts; B1's stale Retry creates nothing; "Saved") |
| D2 Jeff's variant | D2 | D2 |
| D3 losing duplicate proves nothing | D3 | — |
| RA1 reuse a pending attempt | RA1 | — |
| RA2 concurrent retries and Check again | RA2 | RA2 |
| RA3 no retry of an unproven attempt | RA3 | — |
| P-1 attempt and binding verified before permission | P-1 | — |
| R-1 / R-2 / R-3 result slot | R-1, R-2, R-3 | R-1 (AB), R-3 |
| F-1 to F-8 note and touch | F-1 to F-8 | F (uncertain result, note and touch), F-2, F-3, F-6, F-7 |
| AB-1 to AB-4 Call A, then Call B | AB-1 to AB-4 | AB-3, AB-4 |
| FN-1 / FN-2 finalization and release | FN-1, FN-2 | — |
| ST-1 to ST-7 storage | ST-1 to ST-4, ST-7 (ST-5 = FN-1, ST-6 = FN-2) | ST-7 |
| L-1 to L-3 older clients and legacy records | L-1, L-2, L-3 | — |
| E-1 to E-3 earlier reproductions | E-1 to E-3 | E-1 |
| B1 ownership changes during a status read (finding, 14eb2d0): the ORIGINAL operation's final is rechecked; a non-current operation without a final is `unrecorded`, never "nothing was sent"; contact status follows the head | B1a, B1b, B1c, B1d | B1 (stale final read after A finished and B began: page 1 shows A "Saved") |
| B2 partial publication (finding): the SAME attempt's missing binding is repaired and verified; shown as unpublished (nothing sent); a request id shaped like an attempt is never sent without its binding | B2 note, B2 touch, B2 via Check again | B2 note, B2 touch |
| B3 pending finalization keeps its kind (finding): `finishing not_saved` is never shown as reaching GHL or Saved | B3 (not_saved), B3 (complete) | B3 |
| K preservation | K (isolation, Current Offer independence, auth) | K-4; the other suites (below) |

**Preservation, also proven by the existing suites:**
- `test-read-session-recovery` (R1–R5, P1BLUR, P2UW, P1CL);
- `test-contact-isolation` (C1–C6 call log, and Seller Call);
- `test-current-offer-barrier` (45);
- `test-seller-call-offer-interaction` and `test-seller-call-accept-protection`;
- `test-write-boundaries` (call result is bound-only; plain notes and touch unchanged);
- the source pins in `test-call-outcome-copy`, `test-app-read-auth` and `test-b15-cleanup`.
