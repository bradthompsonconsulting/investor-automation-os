# INV-67 / B9-12 -- contract-population repair (V1)

## What this is

The narrow repair Brad authorized this session: project Board #9's already
-resolved TREC 20-19 contract facts (`contract-facts-model.ts` /
`contract-document-model.ts`, both already shipped, INV-60/INV-61) into
narrowly-scoped GHL Opportunity custom fields, and add a one-shot
`Contract Draft Request` control for a future GHL workflow to trigger a
draft-only document creation. This document does not build the template, the
workflow, or the browser test -- those follow Jess Gate review of this
implementation, per the corrected scope Brad gave for this issue.

**No automatic contract sending exists anywhere in this repair.** Every write
this repair performs is an Opportunity custom-field PUT or a `ghl.notes.
create()` audit note. Nothing here calls GHL Documents & Contracts, moves a
pipeline stage, or sets Opportunity status.

## Locked architecture, as implemented

1. **IAOS canonical carriers and Notes remain authoritative.** The new code
   never reads a Note directly -- it consumes `contract-document-model.ts`'s
   already-computed `ContractDocumentPreview` (itself built from
   `contract-facts-model.ts`'s `SellerContractFactsReport`).
2. **Required TREC facts project into narrowly scoped Opportunity custom
   fields.** 48 new TEXT fields, one per remaining fact -- see the mapping
   table below.
3. **Required unresolved facts block synchronization.** `buildContract
   ProjectionPlan` fails closed (`ok: false`) on any unresolved template
   field, unresolved additional required fact, or price conflict. There is
   no partial plan and no partial write.
4. **Resolved conditional facts project their canonical result, including
   "None" when that is the resolved value.** Entries are built from
   `ContractDocumentLine.text` verbatim -- a resolved `not_applicable`
   disposition already renders as its own "None." (or similar) text; this
   repair never re-derives or overrides that text.
5. **Property address uses a NEW Opportunity-scoped field**
   (`identity.propertyStreetAddress`) -- never `contact.property_address`.
6. **Buyer entity uses a NEW Opportunity-scoped field**
   (`parties.buyerEntityName`) so a per-deal override
   (`latestBuyerEntityOverrideForOpportunity`) reaches the contract.
7. **Buyer capacity and Texas-license status stay invariant -- proven, not
   inferred.** Both are fixed exported constants in `contract-facts-model.ts`
   (`BUYER_CAPACITY`, `BUYER_TEXAS_LICENSE_STATUS`), always `system_derived`,
   no carrier, no override path. No field was created for either. The same
   proof applies to `salesPrice.financingSum` (always `$0`, fixed by the
   Cash Acquisition / Assignment Exit path) and
   `addendaApplicability.financingAddenda` (always the same fixed
   `not_applicable` disposition, unconditionally).
8. **Broker representation stays deal-specific.** `representation.
   representation` is a projected field, sourced from its own carrier.
9. **Equitable-interest disclosure remains a required pre-contract gate,
   never invented as TREC body text.** It carries no TREC paragraph citation
   and is not a `documentLines` entry -- never projected into a GHL
   body-merge field. `buildContractProjectionPlan` adds its OWN gate over
   `preview.additionalRequiredFacts`, because `contract-document-model.ts`'s
   own `previewComplete` does not cover this fact (see the finding below).
10. **Every projection field is written first and read back before the
    one-shot control fires.** `ghl.opportunities.syncContractProjectionFields`
    performs one custom-fields-only PUT for all 48 fields, then a singular-GET
    readback, comparing each by strict string equality (`readSingularFieldValue`,
    the same reader every other named writer in `ghl.ts` uses).
11. **The GHL workflow (not built here) creates a draft only; the future
    workflow resets the field to "Idle" after creating the draft.**

## A finding this repair surfaces, not silently patches

`contract-document-model.ts`'s `buildContractDocumentPreview` computes
`additionalRequiredFacts` (which carries `sellerEquitableInterest`) but its
own `previewComplete`/`blockingReasons` do not loop over it -- confirmed by
direct read of the shipped function. A preview can report
`previewComplete: true` while the equitable-interest disclosure is still
unresolved. Editing that shipped module was out of this repair's authorized
scope ("one conceptual change is one revert boundary"), so
`contract-ghl-projection-model.ts`'s `buildContractProjectionPlan` adds its
own independent gate over `preview.additionalRequiredFacts` instead (see
locked-architecture point 9 above and that module's own header). Flagged
here explicitly for Jess Gate review.

## One-shot Contract Draft Request -- corrected ruling

Not a persistent timestamp. An Opportunity dropdown field, `Contract Draft
Request` (GHL id below), options `Idle` / `Requested`, default/fail-safe
`Idle`. IAOS sets `Requested` only after (a) every projection field lands on
readback, and (b) the accepted price (`opportunity.current_offer`) matches
the contract's own ¶3A/¶3C sales-price lines. Duplicate/stale-request
protection: `ghl.opportunities.readContractDraftRequest` reads the field
fresh, immediately before `contract-draft-request-model.ts`'s
`evaluateContractDraftRequestTransition` decides -- a current value of
`Requested` refuses every further transition, so repeated clicks, partial
failures, or later edits cannot create a duplicate draft. The reset back to
`Idle` after a draft is created is the future workflow's job, not IAOS's.

## Jess Gate correction (this session) -- audit ordering

**Problem found in review.** The originally shipped `handleSyncContract
ProjectionFields` wrote and verified the projection fields, wrote
"Requested," and only afterward attempted ONE audit note, best-effort
(failure swallowed). Because GHL may create the draft the instant
"Requested" lands, a failed post-write note could leave IAOS with a live
generated draft and no durable evidence of who authorized it or which
`ContractVersionIdentity` initiated it.

**Corrected to the SAME two-phase attempt/resolution evidence pattern
`contract-send-model.ts` / `contract-send-carriers.ts` already established
for Contract Sent** (`buildSendAttemptArgs` -> reserve note -> POST ->
`buildSendResultArgs` -> resolution note -> readback -> final note),
reused by direct mirroring rather than reinvented:

1. After all 48 projection writes/readbacks and the price cross-check
   succeed, and the fresh-read duplicate guard allows a transition,
   `buildContractDraftRequestAttemptRecord` (`contract-draft-request-
   model.ts`) builds an `in_progress` evidence record -- unique `attemptId`
   (the attempt's own timestamp, generated fresh inside the handler on every
   invocation, so a repeated UI action can never reuse an earlier attempt's
   id), Opportunity id, exact `ContractVersionIdentity`, projection-field
   counts, the current-offer cross-check result, the freshly observed
   pre-write state, and the intended transition (always `"Requested"`).
2. That record's note is written via `ghl.notes.create` BEFORE "Requested"
   is ever attempted. **If that write fails, IAOS does not write
   "Requested,"** surfaces a precise blocking error, and preserves the
   already-confirmed projection-field results in the reported result.
3. Only once that note is confirmed durable does
   `ghl.opportunities.setContractDraftRequest` ever run.
4. `buildContractDraftRequestResolutionRecord` builds the SECOND note, for
   the SAME `attemptId`: `"accepted"` (PUT succeeded, readback confirmed),
   `"failed"` (a CONFIRMED non-event -- refused before any network call, or
   GHL returned a confirmed non-success response), or `"indeterminate"`
   (anything short of a confirmed non-event or a confirmed match -- see the
   transport-outcomes correction below for the exact boundary), **or** the
   resolution note itself failed to write -- either way, a draft may have
   been triggered with no confirmed durable evidence, and this is never
   silently reported as success, failure, or safe-to-retry.
5. Neither evidence write is swallowed. A resolution-note failure after a
   successful, readback-confirmed PUT is explicitly escalated to
   `"indeterminate"` in the reported result (`rawStatus === "accepted" &&
   !resolutionNoteOk ? "indeterminate" : rawStatus`) -- the UI shows a
   dedicated warning that the resolution evidence did not land. Nothing
   here retries automatically; the NEXT invocation's own fresh read is what
   actually prevents a duplicate request (item 3 above), not a client-side
   retry loop.

**Ledger version bumped** (`contract-projection-sync-carriers.ts`):
`iaos-contract-draft-request-sync-v1` -> `iaos-contract-draft-request-
sync-v2`, ONE record shape reused across both notes for an attempt
(mirroring `contract-send-carriers.ts`'s `ParsedContractSend` exactly),
read back via the same rank-then-latest-attempt algorithm as
`latestContractSendForOpportunity` (a terminal note always supersedes its
own `in_progress` note regardless of exact timestamp ordering; the most
recent ATTEMPT overall, by `attemptId`, wins).

**No further GHL mutation.** This correction is code-only -- no new Test
field, no template edit, no workflow, no Production or Linear change.

## Jess Gate correction (this session, round 2) -- transport outcomes

**Problem found in review.** `setContractDraftRequest` (round 1's own
version) threw for BOTH a confirmed non-success PUT response AND a bare
transport exception (no response ever arrived). The caller consequently
classified every thrown error identically as `"failed"` -- wrong for a
transport exception or a post-PUT readback failure, either of which means
GHL may already hold "Requested" with IAOS unable to confirm it. This
violated the locked rule that a successful-or-possibly-successful write
whose readback cannot confirm the result must be `"indeterminate"`, with an
explicit "a draft may have been triggered" warning and no automatic retry.

**Corrected: `setContractDraftRequest` NEVER THROWS.** It now always
returns a discriminated `ContractDraftRequestWriteOutcome`
(`contract-draft-request-model.ts`), preserving the exact transport
boundary as six variants:

| Variant | Meaning | Classifies |
|---|---|---|
| `refused` | Never reached the network (bad config/value). No draft could have been triggered. | `"failed"` |
| `put_failed` | A CONFIRMED non-success HTTP response -- GHL was reached and rejected it. | `"failed"` |
| `put_transport_error` | The PUT's own transport failed before any response arrived. GHL may have received it. | `"indeterminate"` |
| `readback_failed` | PUT succeeded, but the readback's own transport, HTTP response, or JSON parse failed. | `"indeterminate"` |
| `readback_mismatch` | PUT succeeded, readback succeeded, but the observed value is not the one sent. | `"indeterminate"` |
| `confirmed` | PUT succeeded and the readback exactly confirms the sent value. | `"accepted"` |

Only `refused` and `put_failed` -- CONFIRMED non-events -- are ever
`"failed"`. The other three failure-shaped variants are ALWAYS
`"indeterminate"`, never `"failed"` -- collapsing them into `"failed"`
would wrongly assert the write is confirmed NOT to have happened.
`classifyContractDraftRequestOutcome` (`contract-draft-request-model.ts`)
is the ONE, exhaustive (TS `never`-checked) place this mapping happens;
`ContractWorkspace.tsx`'s handler calls it directly instead of its own
ad hoc try/catch classification.

**Evidence preserved separately, per variant.** `put_failed` preserves the
PUT's own HTTP status and response body. `readback_failed` preserves the
PUT's own (successful) status AND names the readback failure distinctly --
never one opaque merged message. `readback_mismatch` preserves both the
sent and observed values distinctly. Every attempted request still
receives a terminal resolution note for the SAME `attemptId` and exact
`ContractVersionIdentity` -- `setContractDraftRequest` returning cleanly
(never throwing) means the resolution-note stage in `ContractWorkspace.tsx`
always runs; there is no code path where an attempted write goes
unresolved.

**UI corrected.** The prior "the write did not reach GHL" fallback text
(reachable only when no specific reason was recorded) is removed --
`refusalReason` is now always populated with the exact,
kind-specific explanation `classifyContractDraftRequestOutcome` built, so
the UI never states non-arrival unless that is conclusively known
(`put_failed`'s own message explicitly confirms GHL WAS reached). Every
`"indeterminate"` outcome renders the same dedicated "a draft may have been
triggered... do not retry" warning, regardless of which of the three
indeterminate variants produced it. No automatic retry exists anywhere in
this flow (single button click, no retry loop) -- the next manual
invocation's own fresh duplicate-guard read is what actually prevents a
second request, unchanged from round 1.

**No further GHL mutation, no template/workflow/Production/Linear change.**
Code-only correction.

## Field mapping

**48 new Opportunity TEXT fields** (`CONTRACT_PROJECTION_FIELD_KEYS`,
`app/src/lib/contract-ghl-projection-model.ts`) -- created live in GHL Test
this session via `app/scripts/inv67-create-contract-projection-fields.cjs
--apply`, Opportunity Details folder (`sGP3pbDQFN7fXS62MAgA`, the same
folder `opportunityFacts.currentOffer` already uses). Real ids recorded in
`app/shared/ghl-config.ts`'s `TEST.contractProjectionFields`. `PRODUCTION`
carries the `CONTRACT_PROJECTION_FIELD_NOT_PROVISIONED` sentinel for every
key -- Production provisioning is a separate, later decision, out of this
repair's authorized scope.

**1 new Opportunity SINGLE_OPTIONS field**, `Contract Draft Request`
(fieldKey `opportunity.contract_draft_request`, id `GlbJxxrxnvMkwJSRNUwI`,
Test only), options `Idle` / `Requested`.

**4 invariant facts -- no field created** (`CONTRACT_PROJECTION_INVARIANT_KEYS`):
`parties.buyerCapacity`, `parties.buyerTexasLicenseStatus`,
`salesPrice.financingSum`, `addendaApplicability.financingAddenda`.

**2 facts reuse the existing `opportunityFacts.currentOffer` carrier -- no
new field** (`CONTRACT_PROJECTION_REUSED_CURRENT_OFFER_KEYS`):
`salesPrice.cashPortion`, `salesPrice.salesPrice`. Both equal the accepted
price, already frozen into `opportunity.current_offer` at Agreement Reached
(INV-70 / B9-07A Family 5). Creating a second field for either would violate
this repair's own "create no duplicate current-offer field" constraint --
the sync writer cross-checks against the existing field instead.

54 = 48 + 4 + 2 -- the complete `documentLines` set `contract-document-model.ts`
already builds.

## GHL Test mutation evidence

`app/scripts/inv67-create-contract-projection-fields.cjs --apply`, this
session, against `SoTgVoaFGHtBdRFvXWQV`: 49 fields created (0 clashes -- dry
run confirmed first), each read back immediately after creation. Live
write/readback/restore inert-proof against the approved fixture opportunity
`MAl1FWHEsK0QqsXt4v6f` ("IAOS Underwriting Test"):

    STEP 1  origin read       -- TEXT field null, dropdown null (both brand-new)
    STEP 2  PUT TEXT="123 Inert Proof St", dropdown="Requested" -- HTTP 200
    STEP 3  readback           -- both exact matches
    STEP 4  PUT TEXT="" (clear), dropdown="Idle" (fail-safe default) -- HTTP 200
    STEP 5  readback           -- TEXT null (cleared), dropdown "Idle" (the
                                   correct resting default, not residual data)

No other field, contact, or opportunity was touched. No Production GHL call
was made. No document was created or sent.

## What this repair does NOT do

- Does not edit the GHL TREC template or place any merge field on it.
- Does not build the GHL workflow (`Opportunity Changed -> Contract Draft
  Request Has Changed To Requested -> Send Documents & Contracts -> Create as
  Draft`).
- Does not perform a live browser test of the end-to-end flow.
- Does not provision Production (`CONTRACT_PROJECTION_FIELD_NOT_PROVISIONED`
  sentinel throughout `PRODUCTION`).
- Does not touch Board #10 in any way.

Those are explicitly Spock/browser work, gated on Jess's review of this
implementation, per this issue's own scope instruction.

## Code map

| File | Role |
|---|---|
| `app/src/lib/contract-ghl-projection-model.ts` | Pure mapping: preview -> write plan |
| `app/src/lib/contract-draft-request-model.ts` | Pure one-shot transition gating |
| `app/src/lib/contract-projection-sync-carriers.ts` | Append-only audit-evidence ledger (Note-based) |
| `app/shared/ghl-config.ts` | 48 field ids + the dropdown id (Test); Production sentinel |
| `app/src/lib/ghl.ts` | `syncContractProjectionFields`, `readContractDraftRequest`, `setContractDraftRequest` (never throws -- returns `ContractDraftRequestWriteOutcome`) |
| `app/src/pages/ContractWorkspace.tsx` | "Sync contract fields to GHL" control |
| `app/scripts/inv67-create-contract-projection-fields.cjs` | Test field-creation script (dry-run by default) |
| `app/scripts/test-contract-ghl-projection.cjs` | Mapping model tests + drift guard |
| `app/scripts/test-contract-draft-request.cjs` | One-shot gating tests |
| `app/scripts/test-contract-projection-sync-carriers.cjs` | Audit-ledger round-trip tests |

## Test evidence

`pnpm --dir app test:contract-ghl-projection` (32/32), `test:contract-draft-
request` (86/86 -- one-shot gating + the two-phase record builders + all six
transport-outcome classifications (refused/put_failed/put_transport_error/
readback_failed/readback_mismatch/confirmed), each proven to preserve PUT
and readback evidence separately + static source-order proofs against both
`ghl.ts` and `ContractWorkspace.tsx`), `test:contract-projection-sync-
carriers` (23/23 -- the two-phase ledger shape and rank-then-latest-attempt
reading). Full Board #9 regression suite re-run clean (`test:board9-
contract-model`, `test:contract-authorization-model`, `test:contract-
disposition-handoff`, `test:contract-document-model`, `test:contract-
execution-model`, `test:contract-facts-model`, `test:contract-lifecycle-
model`, `test:contract-send-*` (6 suites), `test:contract-workspace-view`,
`test:contract-workspace-wiring` (the handler writes two notes, attempt and
resolution, per the same two-phase pattern `handleSend` already uses),
`test:current-offer-carrier`, `test:repairs-canonicalization`, `test:
seller-contract-facts-carriers`, `test:seller-call-resume`, `test:seller-
call-workspace-wiring`, `test:legacy-offer-fields-retired`, `test:legacy-
repairs-writer-removed`). `pnpm --dir app build` (tsc -b + vite build)
clean. CI's own remaining runners re-run clean: `test:underwriting-core`,
`test:underwriting-resolver`, `test:rail`, `netlify-status.test.cjs`, root
Netlify functions typecheck, `test-identifier-boundary.cjs` (confirms every
GHL id still lives only in `app/shared/ghl-config.ts` -- unchanged this
round, no new GHL mutation), `test-exit-contract-static.cjs`,
`test-exit-contract-runtime.cjs`.
