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

## Checkbox-marker / broker-model repair (this session) -- supersedes ¶8, retires 19 keys, adds 81

**Problem found in review (Spock's live GHL discovery).** GHL Checkbox
elements cannot bind to Opportunity custom values or conditional logic --
confirmed live against the GHL account. Of the original 48 projection keys,
14 were modeled as one rendered-sentence TEXT field standing in for what the
TREC template actually prints as a set of checkboxes (e.g. "Residential
leases: applies" for a printed `☐ applies ☐ does not apply` pair) -- no GHL
mechanism can place that rendered sentence onto the printed checkbox
positions. A 15th key, `propertyLegalDescription.reservations`, shares one
physical checkbox with ¶22's mineral-reservation addendum and needed the
same treatment. `representation.representation` (originally cited to ¶8) was
also wrong -- representation's real printed destination is page 11's broker
blocks, not ¶8 body text, and TREC prints THREE broker configurations
(separate Seller-side / Buyer-side blocks, or a single intermediary block)
that a single rendered sentence cannot address either. Two further keys,
`noticeContact.buyerSignerName` / `buyerSignerRole`, and
`closingPossession.possessionDetails`, were found to have no truthful GHL
projection destination at all (the first two are Board #10 scope, the third
belongs to a future addendum, per Brad's ruling) -- each is RETAINED
canonically in `SellerContractFactsReport` (still a real, readable fact),
simply never given a GHL field.

**Corrected architecture -- three additions, one retirement, ONE new gate:**

1. **19 keys retired** (`CONTRACT_PROJECTION_RETIRED_KEYS`) -- their
   dedicated GHL Test field stops receiving writes (kept, never deleted, per
   the INV-70 retirement precedent). Jess Gate correction (repeated-
   destination re-gate, this session): each of the 19 has a DISTINCT,
   precise disposition -- not a loose "15 + 4" split:
   - **14** are checkbox-shaped and replaced by the new markers/text below
     (`leaseDisclosure.residentialLeases`/`fixtureLeases`/
     `naturalResourceLeases`, `titleSurvey.titlePolicyExpenseParty`/
     `shortageAmendmentElection`/`surveyElection`/`poaMembership`,
     `propertyCondition.sellerDisclosureNotice`/`asIsElection`/
     `waterDisclosure`, `closingPossession.possessionElection`,
     `settlementExpense.sellerPaysBuyerBroker`/`buyerPaysSellerBroker`,
     `addendaApplicability.items`).
   - **1** is checkbox-ADJACENT, not itself replaced by a new field:
     `propertyLegalDescription.reservations` FOLDS INTO / is reconciled
     against the existing `addenda_mineral_reservation_mark` (see
     `checkMineralReservationConsistency`) -- it shares that one checkbox
     rather than getting a dedicated field of its own.
   - **1** is REPLACED by a differently-shaped projection, not dropped:
     `representation.representation` is superseded by the 22-key page-11
     broker-text decomposition.
   - **1** is retained canonically but deliberately NOT projected into TREC
     20-19 in V1: `closingPossession.possessionDetails` stays a real,
     readable fact in `SellerContractFactsReport` -- it is scoped to a
     future addendum (Brad's ruling), never given a GHL field here.
   - **2** are retained as internal/audit metadata, also not projected:
     `noticeContact.buyerSignerName` and `noticeContact.buyerSignerRole`
     are Board #10 scope, out of this repair.
   - `14 + 1 + 1 + 1 + 2 = 19`.
2. **48 new checkbox-marker keys** (`CHECKBOX_MARKER_KEYS`,
   `contract-checkbox-marker-model.ts`) -- every value is exactly `"X"` or
   `""`, one Text-block merge field positioned over each printed checkbox.
   Derived by an exhaustive per-group `derive*Markers` function straight
   from the SAME `SellerContractFactsReport` the human-facing preview
   already consumes -- never re-derived from rendered prose, never a second
   carrier read. Every derive function constructs every key in its group on
   every call, so an inactive child marker ALWAYS writes an explicit `""`
   rather than being omitted -- a re-sync after an election changes always
   clears the prior mark.
3. **11 new restructured contract-text keys** (`CHECKBOX_TEXT_KEYS`) -- the
   free-text blanks embedded inside a checkbox group (day counts, dollar/
   percent amounts, water source), each written blank when its parent
   election is not the active one.
4. **22 new page-11 broker-text keys** (`BROKER_TEXT_KEYS`,
   `contract-broker-arrangement-model.ts` + `deriveBrokerText`) -- exactly
   the 11 printed destinations per side (`Broker Firm`, `Address`,
   `Broker Firm License No.`, `Associate Name`, `Team Name`,
   `Associate Email`, `Associate Phone`, `Associate License No.`,
   `Licensed Supervisor Name`, `Licensed Supervisor Phone`,
   `Licensed Supervisor License No.`) -- no invented city/state/ZIP; TREC's
   own page 11 has ONE `Address` blank per side. `BrokerInfo` (`seller-
   contract-facts-carriers.ts`) is extended from its original six required
   strings with five new `ValueOrNone` fields (`address`, `teamName`,
   `supervisorName`, `supervisorPhone`, `supervisorLicenseNo`) --
   backward-compatible: `validateBrokerInfo` accepts BOTH the current
   11-key shape and the original 6-key shape, upconverting a legacy note's
   missing fields to explicit `{kind:"none"}`, never invented or guessed.
   No ledger-version bump -- the note's outer header/labels are unchanged,
   only the inner JSON blob gained optional-with-fallback fields.

### Repeated printed destinations (Jess Gate correction, PR #52 re-gate)

TREC 20-19's own ¶22 "Addenda, Notices, and Other Provisions" checklist
DUPLICATES three elections already asked once elsewhere on the form, rather
than posing a new question:

| Marker (unique GHL field) | Destination 1 | Destination 2 |
|---|---|---|
| `lease_residential_mark` | ¶4A residential-leases election | ¶22 "Addendum Regarding Residential Leases" checkbox |
| `lease_fixture_mark` | ¶4B fixture-leases election | ¶22 "Addendum Regarding Fixture Leases" checkbox |
| `possession_leaseback_mark` | ¶10A temporary-lease possession election | ¶22 "Seller's Temporary Residential Lease" checkbox |

**Correction (Jess Gate, factual-wording re-gate).** An earlier version of
this section claimed TREC promulgates "exactly one" temporary-lease form for
¶10A's second option. That is factually wrong -- ¶22 actually lists BOTH a
"Buyer's Temporary Residential Lease" and a "Seller's Temporary Residential
Lease" checkbox, and this repair does not claim otherwise.

**The correct basis for the reuse is IAOS's own V1 scope, not TREC's form
count.** IAOS V1's canonical possession election explicitly uses the term
`leaseback` (`closingPossession.possessionElection`'s `"leaseback"` kind),
and its operator UI labels the choice "Leaseback" (`ContractWorkspace.tsx`).
In IAOS V1, this means Seller retains possession after closing. Therefore
`possession_leaseback_mark` is reused at ¶22's Seller's Temporary
Residential Lease checkbox. Buyer possession before closing and the Buyer's
Temporary Residential Lease are not modeled or populated in V1 -- there is
no carrier value, marker, or projected field for either.

**This is a PLACEMENT distinction, not a new-field distinction.** GHL's
Text-block merge mechanism supports positioning the SAME Opportunity custom
field at more than one location on one template -- no duplicate field is (or
will be) created for any of the three echoed destinations.
`CHECKBOX_MARKER_REPEATED_TEMPLATE_PLACEMENTS`
(`contract-checkbox-marker-model.ts`) is the authoritative manifest naming
exactly these 3 reused markers and their 2 destinations each; every other of
the 45 remaining `CHECKBOX_MARKER_KEYS` is placed exactly once. Three counts
must never be conflated:

| Count | Value | Meaning |
|---|---|---|
| Unique GHL projection fields (`CONTRACT_PROJECTION_FIELD_KEYS.length`) | **110** | What this repair reads/writes -- one write per key, always, regardless of template placement. |
| New unique GHL fields this repair adds (48 markers + 11 text + 22 broker) | **81** | What the follow-on field-creation script must create. Unaffected by repeated placements -- reusing a field at a second location creates no new field. |
| Physical checkbox/text overlay placements the 48 markers require on the future Test template (`CHECKBOX_MARKER_TOTAL_TEMPLATE_PLACEMENTS`) | **51** (48 unique + 3 extra) | What the follow-on template-placement work and its visual-verification proof must cover. NEVER equal to 48 or 81 -- an overlay-placement count stated as 81 would silently omit the 3 repeated pastes. |

**Future GHL proof plan, corrected.** The template-placement and E2E proof
work this repair does not perform (deferred to Spock/browser work, per this
issue's own scope) must, when it happens:

- Create 81 new GHL Test fields (unchanged from before this correction).
- Place 51 checkbox overlays for the 48 markers -- not 48 -- with all THREE
  paragraph-22 echo placements (`lease_residential_mark`,
  `lease_fixture_mark`, `possession_leaseback_mark`'s second destination
  each) visually verified against the printed template in addition to their
  primary ¶4/¶10 destination, using the SAME field for both pastes.
- Report the overlay-placement count and the new-field count as two
  DISTINCT numbers in its own evidence, never one figure standing in for
  both.
- Field-by-field visual verification must enumerate every physical
  destination for a repeated marker (both placements), not just confirm the
  field exists once.

No template edit, no field creation, and no E2E proof is performed in THIS
repository-only correction -- the table and manifest above are the
authoritative reference for that future work, not evidence that it has
happened.

**Broker-arrangement classification -- `classifyBrokerArrangement`
(`contract-broker-arrangement-model.ts`), exhaustive over
`RepresentationFact`'s three kinds:**

| Classification | Meaning | Blocks? |
|---|---|---|
| `no_broker` | `{kind:"none"}` -- the ONLY input that ever produces this. | No |
| `seller_broker_only` | `represented`, seller agent named, no buyer agent. | No |
| `buyer_broker_only` | `represented`, buyer agent named, no seller agent. | No |
| `separate_brokers_both_sides` | `represented`, both agents named. | No |
| `represented_but_empty` | `represented`, BOTH agents `null`. | **Yes** |
| `intermediary` | `{kind:"intermediary"}`. | **Yes** |

**Mandatory architect correction, applied exactly as specified:**
`{kind:"represented", sellerAgent:null, buyerAgent:null}` is invalid and
must fail closed -- it must NOT classify as `no_broker`. Only the explicit
`{kind:"none"}` variant may produce `no_broker`. A `represented` fact naming
no broker on either side is a distinct, also-blocking state
(`represented_but_empty`) with its own message: representation is recorded
as "represented" but names no broker on either side -- this is not the same
fact as "no broker" and must be corrected (or explicitly recorded as
`"none"`) before syncing.

**Intermediary is out of V1 scope and fails closed, never populated.** TREC
prints a real third page-11 configuration (one broker representing both
parties) that IAOS is not authorized to populate in V1 -- Brad's ruling this
session. `classifyBrokerArrangement` detects it; no code path in this repair
renders it into either the separate Seller-broker or Buyer-broker block, and
no template/GHL support for it exists.

**Both blocking classifications are checked inside
`buildCheckboxMarkersAndText`, called from `buildContractProjectionPlan`
itself** -- the SAME plan-level gate that already refuses the whole sync on
any other unresolved fact, not a writer-only check. An intermediary or
represented-but-empty arrangement blocks `Contract Draft Request` from ever
reaching `Requested` exactly as strongly as every other blocking reason.

**Mineral-reservation disagreement fails closed with its own distinct
message.** ¶2E's reservations disposition and ¶22's mineral-reservation
addendum checkbox share ONE physical box on the printed form --
`checkMineralReservationConsistency` refuses to sync when they disagree,
with a message naming both sides of the disagreement, never a generic
"unresolved" string.

**POA membership vs. POA addendum disagreement is a warning, never a
blocker** (Product Owner ruling, this session) -- `checkPoaAddendaConsistency`
returns a non-null, non-blocking string surfaced through the plan's new
`warnings: string[]` field (both the `ok:true` plan type and
`ContractWorkspace.tsx`'s sync-result UI carry it; `handleSaveRepresentation`
also gained an `"intermediary"` branch so the status summary and the page-11
capture form -- 5 new `ValueOrNoneField` rows per side -- stay exhaustive).

**Marker mutual exclusivity is enforced twice, deliberately:** (1) BY
CONSTRUCTION -- every `derive*Markers` function is an exhaustive `switch`/
chain of `===` comparisons over its own canonical fact's TS union, so the
function itself cannot emit two `"X"` values in one exclusive group without
a code defect; (2) EXPLICITLY, by `validateMarkerExclusivity` -- a runtime
check over all 13 exclusive groups, called from
`buildCheckboxMarkersAndText`, which is itself called from
`buildContractProjectionPlan` -- the same plan-level gate, so a violation
here blocks the whole sync before any GHL call, exactly like every other
blocking reason. Never checked ONLY in the writer.

**Final live projection-key count: exactly 110** (`CONTRACT_PROJECTION_
FIELD_KEYS`) = 29 retained (`CONTRACT_PROJECTION_RETAINED_DOCUMENT_LINE_
KEYS`, unchanged single-TEXT keys) + 48 checkbox markers + 11 restructured
contract-text keys + 22 page-11 broker-text keys. `29 + 19 = 48` -- the
original complete key set, preserved as an equality check in the drift-guard
test.

**No GHL mutation this session.** No new GHL Test field was created --
`app/scripts/inv67-create-contract-projection-fields.cjs` (the original
48-key field-creation script) is deliberately untouched; its 48 keys are the
original 29 retained + 19 now-retired keys, unchanged. Provisioning the 81
new keys as real GHL Test fields, the corrected template placement, and the
E2E readback proof are explicitly follow-on, Jess-Gate-reviewed work, not
performed here. No GHL field, template, draft, document, email, or SMS was
touched. Production remains fully `CONTRACT_PROJECTION_FIELD_NOT_PROVISIONED`
for all 110 keys.

**Code map additions:**

| File | Role |
|---|---|
| `app/src/lib/contract-checkbox-marker-model.ts` | Pure: 48-marker + 11-text derivation, 13-group exclusivity validation, mineral-reservation/POA consistency checks, the repeated-template-placement manifest (`CHECKBOX_MARKER_REPEATED_TEMPLATE_PLACEMENTS`, `CHECKBOX_MARKER_TOTAL_TEMPLATE_PLACEMENTS`), `buildCheckboxMarkersAndText` (the one entry point `buildContractProjectionPlan` calls) |
| `app/src/lib/contract-broker-arrangement-model.ts` | Pure: `classifyBrokerArrangement`, the blocking-state table, distinct per-state messages |
| `app/scripts/test-contract-checkbox-marker-model.cjs` | Per-group derive-function tests, all 13 exclusivity groups, mineral/POA consistency, broker-text gating, the repeated-placement manifest + absence-of-duplicate-key proofs, `buildCheckboxMarkersAndText` integration (99/99) |
| `app/scripts/test-contract-broker-arrangement-model.cjs` | All 6 classification states incl. the mandatory correction, blocking-set membership, distinct messages (29/29) |
| `app/scripts/inv67-create-checkbox-marker-fields-batch1.cjs` | Batch 1 (48 keys) GHL field-creation script -- hard Test-location allowlist, exact-existing/conflict preflight across the complete unfiltered 48-spec batch, fail-closed canonical-anchor `parentId` resolution, readback validation, unconfirmed-create safety. Used live (`--apply`) 2026-09-14 -- see the "Batch 1 GHL Test provisioning" section above. |
| `app/scripts/test-inv67-checkbox-marker-fields-batch1-script.cjs` | Pure-function + network-free child-process proofs of every safety property above (110/110) |

**Test evidence, this session (including the PR #52 repeated-destination
re-gate):** `test-contract-checkbox-marker-model.cjs` (99/99, +12 for the
repeated-placement manifest, the placement-count-vs-field-count distinction,
and the absence-of-synthetic-duplicate-key proof), `test-contract-broker-
arrangement-model.cjs` (29/29), `test-contract-ghl-projection.cjs` rewritten
for the 3-arg `buildContractProjectionPlan(opportunityId, preview, report)`
signature and the 110-key reality (55/55, +4 for the same placement-vs-field
distinction proven at the integration layer -- 110 unique keys and 81 new
keys are unaffected by the manifest, each repeated-placement marker is
written exactly once per plan, including the plan-level integration proofs
for every blocking/warning condition above and the corrected drift guard
against both `shared/ghl-config.ts` and the untouched field-creation
script), `test-seller-contract-facts-carriers.cjs` extended for `BrokerInfo`
backward compatibility (current 11-key shape, legacy 6-key upconversion, the
`intermediary` kind, and represented-but-empty at the carrier layer; 56/56).
Full repo-wide `scripts/test-*.cjs` suite (57 files) re-run clean. `tsc -b
--force` and `vite build` both clean.

**Batch 1 GHL Test wiring, this session (repository-only, following the
live Test apply above):** `test-inv67-checkbox-marker-fields-batch1-script.cjs`
(110/110, unchanged -- the committed script was not modified this step).
`test-contract-ghl-projection.cjs`'s drift guard extended (65/65, +10):
`shared/ghl-config.ts`'s TEST config now proven to carry a real id for
exactly 77 keys (29 retained + 48 Batch 1 markers, all unique, none the
sentinel), exactly 33 keys (Batches 2/3) proven to remain sentinel-filled,
no retired key re-enters the live map, `PRODUCTION.contractProjectionFields`
proven still exactly `sentinelContractProjectionFields()`, and
`contractDraftRequest` proven unchanged on both TEST and PRODUCTION. Full
repo-wide `scripts/test-*.cjs` suite re-run clean. `tsc -b --force` and
`vite build` both clean. The 48 wired ids were sourced from a fresh,
independent, fail-closed read-only GET joined against the committed
script's own classification/validation functions -- never hand-transcribed
from a prior console paste.

## Field mapping (original -- 48 keys)

*SUPERSEDED for 19 of these keys by the checkbox-marker / broker-model
repair above -- kept verbatim below as the historical record of what was
actually provisioned in GHL Test this session's field-creation script run.*

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

## Batch 1 GHL Test provisioning -- 48 checkbox-marker fields (2026-09-14)

**State: PROVISIONED.** Following the checkbox-marker / broker-model
repair's repository merge (PR #52, then the repeated-destination
correction and live-safety hardening in PR #53), Brad authorized the live
Batch 1 apply. `app/scripts/inv67-create-checkbox-marker-fields-batch1.cjs
--apply` ran against GHL Test (`SoTgVoaFGHtBdRFvXWQV`), canonical
`parentId` `sGP3pbDQFN7fXS62MAgA` (the same Opportunity Details folder
`opportunityFacts.currentOffer` and the original 29 retained fields use).

- **Pre-apply Test Opportunity field count:** 67.
- **Created:** all 48 `CHECKBOX_MARKER_KEYS` -- zero pre-existing
  collisions, so all 48 were `CREATE`, none `REUSE`.
- **Post-apply Test Opportunity field count:** 115 (67 + 48, exact).
- **Readback verification:** every one of the 48 creates was independently
  re-read and validated against name, `fieldKey`, `dataType` (`TEXT`),
  `model` (`opportunity`), and `parentId` before being logged as
  `-- readback verified`. Exit code `0`.
- **Post-apply dry run (second, independent run):** all 48 keys
  reclassified `exact_existing`, re-verified via their own single-field
  GET, zero proposed creates, zero conflicts. Exit code `0`.
- **Independent source-of-truth re-verification** (before repository
  wiring): a SEPARATE, fresh read-only GET joined against the committed
  script's own `FIELD_SPECS`/`classifyExistingMatch`/
  `validateFieldAgainstSpec`/`resolveCanonicalParentId` (not the earlier
  console paste) confirmed all 48 a second time, fail-closed on any
  missing/mismatched/duplicated/unexpected field or a field count other
  than 115.
- **Repeated-destination markers** (`lease_residential_mark`,
  `lease_fixture_mark`, `possession_leaseback_mark`) each confirmed to
  exist as exactly ONE field -- template placement at their second
  paragraph-22 destination remains unperformed, future work.
- **All 19 retired fields confirmed present, unmodified** (name and
  `dataType` unchanged) -- none was touched by this provisioning.
- **Batches 2 (11 restructured contract-text keys) and 3 (22 page-11
  broker-text keys) remain UNPROVISIONED** -- confirmed no field matching
  either shape exists; `shared/ghl-config.ts`'s TEST config keeps the
  sentinel for exactly those 33 keys.
- **Zero sends, zero template mutation, zero draft creation, zero
  Production mutation.** Repository wiring (pasting the 48 real ids into
  `shared/ghl-config.ts`) was performed as a SEPARATE, subsequent,
  repository-only step (no further GHL mutation) -- see the Code map/Test
  evidence sections below.

## What this repair does NOT do

- Does not edit the GHL TREC template or place any merge field on it.
- Does not build the GHL workflow (`Opportunity Changed -> Contract Draft
  Request Has Changed To Requested -> Send Documents & Contracts -> Create as
  Draft`).
- Does not perform a live browser test of the end-to-end flow.
- Does not provision Production (`CONTRACT_PROJECTION_FIELD_NOT_PROVISIONED`
  sentinel throughout `PRODUCTION`).
- Does not touch Board #10 in any way.
- (checkbox-marker / broker-model repair) Does not modify the GHL
  template, does not add intermediary template/GHL support, does not
  expand ¶8's carrier or scope, does not project `possessionDetails` into
  TREC 20-19. Batch 1 (48 checkbox-marker keys) IS now provisioned in GHL
  Test, per the section above -- Batches 2 (11 restructured contract-text
  keys) and 3 (22 broker-text keys) remain unprovisioned, and no template
  placement of any of the 51 physical Batch 1 overlay positions has been
  performed.

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
