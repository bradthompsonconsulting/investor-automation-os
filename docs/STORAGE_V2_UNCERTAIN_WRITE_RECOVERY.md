# Uncertain GHL writes under storage v2: regressions and recovery proposal (for review)

**Status:** this is a proposal for Bones's review (Jess's ruling, item 3). Behaviour on this branch stays
**fail-closed**. Nothing here classifies a GHL 4xx as refused, and nothing is implemented beyond what
the branch already does.

## The mechanism

Every GHL mutation takes an admission ticket in `authz/admission`, scoped to its `(subject, effect
classes)`.
- **Confirmed** (exact readback): the ticket's outcome is recorded and the ticket removed.
- **Otherwise** (no response, a GHL error status, a readback that is unavailable or mismatched): the
  ticket becomes `uncertain`, which is what the approved design calls for (r1/r2).
- **Who can remove it:** only its sender, on a confirmed outcome, or **same-operation recovery** from the
  persisted **confirmed** outcome of that exact attempt.

Only call-log and Current Offer operations have per-attempt records that recovery can read. Every other
write's uncertain ticket stays forever, and it blocks every later write whose effect classes overlap
it, on that subject.

## Previously working paths now refused (Bones to review each)

| # | Path | Before (main `3de480e`) | On this branch | Evidence |
|---|---|---|---|---|
| R1 | Confirm Accept: "Check & retry call timestamp" after the original last-touch got no response | the retry (a `touch` reservation) was sent and confirmed: 200 | **refused `409 in_progress`**; the earlier `uncertain` ticket on `last_touch` blocks it | `test-production-write-scope.cjs`, Confirm Accept recovery step 5 (restated inline) |
| R2 | Seller Call: retry of a failed call timestamp | page reported `written` | page reports **`write_unconfirmed`**; nothing is sent | `test-production-write-scope.cjs`, Seller Call recovery (restated inline) |
| R3 | `ghl-disposition`: GHL retries the webhook after the attempt PUT failed | the note was deduped and the attempt re-marked: 200 | **refused**; the uncertain `last_touch` ticket blocks the re-mark (the note is still never duplicated) | `test-disposition-blob-context.cjs`, "attempt failure remains non-2xx; retry does not duplicate note" |
| R4 | A ledger note retried after the note POST returned GHL 500 | the retry self-healed: 200 | **refused `409 in_progress`** until the ticket is resolved | `test-write-contract-ledgers.cjs`, "Note-write failure, then retry self-heals" (restated; the fixture then simulates resolution) |
| R5 | Any later note on a contact after one uncertain **plain** note | allowed | **refused**: the `note` effect overlaps, which includes that contact's call-log notes | follows from the ticket model; covered by `test-storage-endpoints.cjs` E2E "an uncertain GHL write …" |

R1–R4 used to recover by **retrying**. Retrying blind after an uncertain send is exactly what v2 exists
to prevent: GHL documents no idempotency key, cancellation or request status. Retries are therefore
refused by design, but the alternative is that the subject stays blocked until a recovery path exists.

## Review status

Bones (review of `e982ed0`, `#issuecomment-6046546656`, item B) reproduced R1–R5 and confirmed they are
covered by the rerun handlers. **Recovery is NOT restored.**

The restated assertions in those suites document a stricter held state. Their green counts are not
evidence of preserved recovery behaviour. R4's later success uses a fixture that removes the ticket to
simulate resolution, and that is not production recovery evidence. The accepted Owner-bypass exception
changes none of this.

## Proposed recovery (amended per review; for Jess and Bones; NOT implemented)

Every proposal below is bound to **one exact ticket**: its ticket id, request digest, op and attempt ids,
and the subject and effects it holds. Each must satisfy the same fail-closed contract as the publication
classifier (amendment r4 §C).

Removal requires BOTH:
- (i) request-specific evidence bound to that exact attempt; and
- (ii) supported provider semantics that make that request **terminal**: either applied and unable to
  apply again, or not applied and unable to apply later.

Missing or ambiguous evidence, an absent semantics record, an elapsed time, a later value read, or an
approval alone leaves the ticket blocking.

**P-A: GHL answered 2xx, readback failed** (R4, part of R2).
- **What is persisted:** in the same compare-and-swap that marks the ticket uncertain, the attempt's exact
  evidence: GHL status, returned record id, request-body digest, and ticket and attempt ids. The
  evidence digest is bound to the ticket.
- **What it can establish:** a later strong GHL read finding that record id with that exact body is
  *correlation* (the attempt did apply). It does **not** by itself establish that the request cannot
  apply again later.
- **Removal also requires** an approved GHL provider-semantics record whose predicates classify exactly
  that persisted evidence as terminal-applied, with the provider citation.
- **Until then the ticket stays.** No such GHL semantics are known today.

**P-B: no response** (R1, R3, part of R2).
- **What it needs:** request-specific evidence plus supported semantics for terminal-applied or
  terminal-not-applied. GHL offers no known request-status, idempotency or audit API for these endpoints,
  so **no removal route is proposed**.
- **Approvals are not facts:** a resolution record carrying approval references is a policy act, not a
  fact about an outstanding request. It cannot remove a ticket.
- **If evidence ever becomes available** (for example a provider audit entry naming that request), its
  classifier must be fail-closed and bound to that exact evidence, exactly like T4/T8. Until then R1, R3
  and part of R2 stay held.

**P-C: blocking scope** (an option, not a recommendation). A narrower block is acceptable only if it is
derived from **actual semantic and workflow overlap**, mapped from evidence. Field-name separation is not
sufficient: a field write can trigger workflows that write notes, touches or stages. Without that
mapping, the current effect-class block stands.

**P-D: what the page says** (a product decision for Brad). The page should explain the held or partial
state plainly. It should **not** offer a retry that suggests an unresolved request is safe to resend.

**Not proposed:**
- classifying GHL 4xx (or any status) as refused;
- time-based expiry;
- a GHL value read as clearance;
- an approval record as clearance.
