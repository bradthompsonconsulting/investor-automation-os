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

## Proposed recovery: tied to the exact attempt and its evidence

Each proposal below needs review. None is implemented.

**P-A: response received, readback failed** (R4, part of R2).
- **What is recorded:** when the ticket became uncertain *after* GHL answered 2xx, the sender persists,
  in the same write that marks the ticket uncertain, the exact evidence:
  - the GHL status;
  - the GHL-returned record id (the note id from the POST response);
  - a digest of the request body;
  - the ticket and attempt ids.
- **Later recovery:** a strong GHL read that finds **that record id** with **that exact body** proves
  the attempt applied. Recovery then compare-and-swaps the ticket to removed, matched on that exact
  evidence. A field write returns no record id, so it does not qualify.
- **Correlation:** this is correlation by an identifier the attempt itself produced, the N4 standard. A
  matching value alone never clears anything.

**P-B: no response** (R1, R3, part of R2).
- **What it needs:** request-specific evidence. GHL offers none known for these endpoints, so no
  automatic recovery is proposed.
- **What it gets instead:** a **reviewed resolution record**, `authz/ticket-resolution/<ticketId>`. It is
  immutable and created only by a separately authorized tool, with Bones's and Jess's approval references.
  It holds:
  - the exact ticket, attempt and request digest;
  - the evidence relied on (for example a GHL audit-log entry identifying that request, if one exists);
  - a statement of what was observed.
- **What the gate requires:** the record and its approvals, the same model as `register_semantics`.
- **What it rules out:** elapsed time, a later readback of the value, operator say-so without a record.

**P-C: narrower blocking scope for no-identifier field writes** (R1–R3; an option, not a recommendation).
- **The change:** for field writes, the ticket's blocking set could be its exact `custom_field:<id>`
  classes plus the semantic class (`last_touch`), rather than every write in that class.
- **The trade:** it reduces collateral blocking (R5-like effects across fields) but does not unblock
  R1–R3, because those retry the same field.

**P-D: client/product change** (R1/R2). The pages could surface the blocked state, "Saving the call time
is held: an earlier attempt's result is unknown", instead of offering a retry that will be refused.
This is copy and flow only; the product decision is Brad's.

**Not proposed:**
- classifying GHL 4xx (or any status) as definitely refused;
- time-based expiry;
- a GHL value read as clearance.
