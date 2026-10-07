# Storage v2 — ownership storage lifecycle (call-log and Current Offer saves)

**Governing record:** PR #131 storage correction plan v6 (`#issuecomment-6042206665`) as amended by
r1–r4 (r4 `#issuecomment-6043033100`, approved by Bones) and Brad's Owner-bypass decision
(`#issuecomment-6042966089`). Release procedure: [`STORAGE_V2_CUTOVER_RUNBOOK.md`](STORAGE_V2_CUTOVER_RUNBOOK.md).
G5 audit: [`G5_LEGACY_PATH_AUDIT.md`](G5_LEGACY_PATH_AUDIT.md). The call-log and Current Offer business
lifecycles are unchanged: [`CALL_LOG_SAVE_LIFECYCLE.md`](CALL_LOG_SAVE_LIFECYCLE.md),
[`CURRENT_OFFER_SAVE_LIFECYCLE.md`](CURRENT_OFFER_SAVE_LIFECYCLE.md).

## 1. The defect being corrected

`@netlify/blobs` 11.1.0 reports `{modified: status !== 412}` for conditional writes, so 401, 403 and an
exhausted 5xx report `modified: true`; it retries 429/5xx/throws five times with 5 s sleeps and no
`AbortSignal`; `delete` is unconditional and retried; Lambda-compatibility functions cannot make strong
reads, and the code fell back to eventual reads silently. Ownership decisions (claims, locks, stage
markers, heads) were therefore built on unverified acknowledgements.

## 2. Components (app/netlify/functions/lib)

| Module | Role |
|---|---|
| `verified-store.ts` | the SDK `fetch` hook: synchronous scope/deadline check before every request; real outcome logged first; a synthetic terminal 499 for 429/5xx/throw/abort so the SDK makes one fetch and never sleeps; classification from the log only (`written` = one real 200 with an etag; `conflict` = clean 412s; else `StorageUncertain`); strong reads only on the uncached origin; ≤ 2 adapter retries (150/400 ms) inside the cutoff; **no delete of any ownership record** |
| `invocation-scope.ts` | deadlines fixed at entry (`T_work`, `T_dispatch`, `T_clean`, `T_abs`; pinned budget rows), the private claim token, the dispatch latch |
| `owned-send.ts` | the unforgeable `OwnedSend`; recovery of an ambiguous claim only by an exact read in the live scope; one dispatch per invocation; terminal surrender before any not-dispatched write |
| `contact-lock-v2.ts` | `lock2/` held/free records, never deleted; owner-proven release (`releasedByHash` / successor's `prevReleasedByHash`); `release_unverified`; durable status; same-operation recovery only |
| `stage-marker-v2.ts` | unresolved/resolved marker, resolved only by the same attempt's confirmed readback |
| `admission.ts` | **the one authoritative record `authz/admission`**: sender tickets (Admit → Dispatching → settle) and publication transitions T0–T9, invariants I1–I4, the default-deny classifier |
| `g5-gate.ts` | the default-deny G5 table, effect-class overlap, N1–N4/AUDIT narrowing validation |
| `cutover.ts`, `legacy-import.ts` | the import owner, captures, attribution, conservative classification, legacy blocks, the cutover record; `v2-` id format rule |
| `write-gate.ts` | the M4 gate composition and the MutationGate the GHL boundary must pass for every non-GET request |
| `modern-runtime.ts`, `endpoint-kit.ts`, `capability.ts` | the request adapter (oracle-equivalent; tightenings land on each endpoint's own parse refusal), shared invocation wiring, `storage_capability` + HMAC attestations |
| `ghl-token.ts` | `IAOS_GHL_TOKEN_V2`, no fallback |

## 3. One GHL mutation, end to end

1. Handler entry: modern runtime; method / auth / origin unchanged; v2 ids only.
2. Synchronous: published production deploy; kill switch.
3. One round trip: admission (captured activation; the page's echo must match), cutover bound to the
   import owner, the G5 table, the subject's legacy block — plus the request's write-once ownership
   records and the contact's lock record.
4. Lock v2 acquire; the barrier's ownership checks (unchanged rules).
5. `MutationGate.admit`: G5 (table digest must equal the activation's) + legacy block → ticket ADMITTED.
6. Barrier-owned requests: the send claim → `OwnedSend`.
7. Ticket DISPATCHING (the admission point; nothing after it consults publication state).
8. Synchronously: scope open, now ≤ `T_dispatch`, `OwnedSend` consumed under the latch → ONE request
   with `AbortSignal.timeout(GHL_TIMEOUT)`.
9. Readback; settle: confirmed → the ticket's own outcome record (read back) then removal; otherwise →
   `uncertain` (never removed except by same-operation recovery from a CONFIRMED outcome of that exact
   attempt). Owner-proven lock release; `release_unverified` is shown, durably.

## 4. Publication and activation

Every fact that can authorize admission, dispatch, a publication attempt, abandonment or activation lives
in `authz/admission`. T1 Close, T2 Claim, T3 Dispatching, T4 Record response, T5 Mark unresolved,
T6 Abandon, T7 Handover, T8 Reclassify, T9 Activate are each ONE compare-and-swap; ambiguous outcomes are
resolved only by the transition's own private mark. Archives (`evidence/publication/…`,
`evidence/activation/…`) are written after and never read for authorization.

**Classifier (default deny):** only ABANDONED is terminal without provider semantics. APPLIED and REJECTED
require an approved, immutable `authz/provider-semantics/<n>` predicate matching the persisted evidence
(bound to publication, attempt, request fingerprint and transition). Every 2xx/4xx without one is
RESPONDED (blocking); no response, 429, 5xx, a malformed body or a body naming another deploy is
UNRESOLVED (never terminal). No configuration flag is read.

**Accepted exception:** an out-of-tool Owner publication is not detected (runbook §1; test OB-1).

## 5. Requirement → code → tests

| Requirement | Code | Tests |
|---|---|---|
| F1/F2 characterization; adapter classification, retries, deadlines | `verified-store.ts`, `invocation-scope.ts` | `test-storage-adapter.cjs` CH-1..8, AD-1..18 |
| Send ownership, surrender | `owned-send.ts`, both barrier libs | `test-storage-ownership.cjs` D0–D5c, W1 |
| Lock v2 (L1 race, B/A counterexample), marker v2 | `contact-lock-v2.ts`, `stage-marker-v2.ts` | L0–L10, T7, S1–S3 |
| Tickets across publication (r1/r2) | `admission.ts`, `write-gate.ts` | `test-storage-admission.cjs` PUB-1..6c, PUB-11 |
| r4 correction 1: one authoritative record | `admission.ts` T0–T9, I1–I4 | ST-1..ST-6, PA-1..PA-9, PA-11 |
| r4 correction 2: default-deny classifier | `classify`, `validSemantics`, T4/T8 | CL-1..CL-7 |
| Owner exception (accepted, visible) | runbook §1 | OB-1 |
| G5, narrowing | `g5-gate.ts`, `write-gate.ts` | `test-storage-g5-import.cjs` G5-1..G5-8 |
| Import, owner, receipts | `legacy-import.ts`, `cutover.ts`, `write-receipts.ts` | I1–I10, O1–O7 |
| Five migrations, preview refusal, gate, credentials, capability, parity, deadlines, legacy isolation | the five endpoints, `modern-runtime.ts`, `capability.ts`, `ghl-token.ts` | `test-storage-endpoints.cjs` P1–P3 ×5, G-1..G-4, K1–K3, C1–C8, E1–E5, T1/T2/T5/T6, L7, L7b |
| Budgets and latency realism | read batching, cached etags | `test-storage-budgets.cjs` B0–B3 |
| Controlled publisher | `scripts/iaos-publish.cjs`, `iaos-activation.ts` | `test-iaos-publish.cjs` PUB-T1..T6 |

## 6. Voice (deferred)

`voice-attempt-store` still has the F1 defect. **Prerequisite to re-enabling voice:** move its
conditional writes onto `verified-store.ts`, with wire tests for 401/403, exhausted 5xx and ack-lost.
It reads GHL only through `ghlToken()`, and it stays fail-closed while disabled.
