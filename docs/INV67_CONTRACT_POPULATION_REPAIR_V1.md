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
| `app/scripts/inv67-create-checkbox-text-fields-batch2.cjs` | Batch 2 (11 keys) GHL field-creation script -- sibling to Batch 1, same hardened architecture (hard Test-location allowlist, complete unfiltered 11-spec preflight, no `--only`, fail-closed canonical-anchor resolution, readback validation, unconfirmed-create safety) applied to `CHECKBOX_TEXT_KEYS`. Used live (`--apply`) 2026-09-14 -- see the "Batch 2 GHL Test provisioning" section above. Batch 1's script is untouched by this addition. |
| `app/scripts/test-inv67-checkbox-text-fields-batch2-script.cjs` | Pure-function + network-free child-process proofs of every safety property above, plus confirmation Batch 1's script remains untouched (79/79) |
| `app/scripts/inv67-create-broker-text-fields-batch3.cjs` | Batch 3 (22 keys) GHL field-creation script -- sibling to Batch 1/2, same hardened architecture applied to `BROKER_TEXT_KEYS` (11 Seller-broker + 11 Buyer-broker, both derived from `BROKER_FIELD_SUFFIXES`). Used live (`--apply`) 2026-09-15 -- see the "Batch 3 GHL Test provisioning" section above. Neither Batch 1's nor Batch 2's script is touched by this addition. |
| `app/scripts/test-inv67-broker-text-fields-batch3-script.cjs` | Pure-function + network-free child-process proofs of every safety property above, confirmation Batch 1/2's scripts remain untouched, and page-11 model boundary proofs (no city/state/ZIP, no intermediary, no paragraph-8; Team Name/Supervisor Phone present on both sides) (91/91) |

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

**Batch 1 GHL Test wiring (repository-only, following the live Test apply
above):** `test-inv67-checkbox-marker-fields-batch1-script.cjs` (110/110,
unchanged -- the committed script was not modified this step).
`test-contract-ghl-projection.cjs`'s drift guard extended (65/65, +10 at
that point): `shared/ghl-config.ts`'s TEST config proven to carry a real
id for exactly 77 keys (29 retained + 48 Batch 1 markers), exactly 33
keys (Batches 2/3) proven to remain sentinel-filled, no retired key
re-enters the live map, `PRODUCTION.contractProjectionFields` proven
still exactly `sentinelContractProjectionFields()`, and
`contractDraftRequest` proven unchanged on both TEST and PRODUCTION. The
48 wired ids were sourced from a fresh, independent, fail-closed
read-only GET joined against the committed script's own classification/
validation functions -- never hand-transcribed from a prior console
paste.

**Batch 2 GHL Test provisioning + wiring (repository-only, following the
live Test apply above):** `test-inv67-checkbox-text-fields-batch2-script.cjs`
(new, 79/79) -- mirrors Batch 1's suite exactly for the 11-key
`CHECKBOX_TEXT_KEYS` batch, plus confirms Batch 1's script file remains
untouched. `test-contract-ghl-projection.cjs`'s drift guard extended
further (74/74, +6 over the 68 from initial Batch 2 wiring): `shared/
ghl-config.ts`'s TEST config now proven to carry a real id for exactly
**88** keys (29 retained + 48 Batch 1 markers + 11 Batch 2 contract-text
keys, all unique, none the sentinel), exactly **22** keys (Batch 3 only,
now the sole remaining unprovisioned batch) proven to remain
sentinel-filled, no retired key re-enters the live map, and PRODUCTION/
`contractDraftRequest` proven unchanged.

**Jess Gate correction (PR #56 re-gate):** the original wiring proof for
"Batch 1's ids unchanged by Batch 2 wiring" sampled only 2 of the 48
Batch 1 keys, which could not detect a silent id change on any of the
other 46. Replaced with a complete, known-good 48-key reference map
(`BATCH1_APPROVED_MARKER_IDS`) checked key-by-key against every one of
`CHECKBOX_MARKER_KEYS` -- a single changed, missing, or extra id now fails
the check and prints exactly which key differs. The same weakness was
found and fixed in the 29-retained-ids proof (previously checked only key
*presence*, not id *value* -- replaced with `RETAINED_APPROVED_IDS`, a
complete 29-key reference map) and the Batch 2 proof was upgraded to the
same pattern for consistency (it already covered all 11 keys, but now
gives a precise per-key diff on failure instead of one boolean). Sanity-
verified: deliberately corrupting one reference id causes the check to
fail with an exact diff, confirming the proof is not tautological. The
11 wired Batch 2 ids were sourced from a fresh, independent, fail-closed
read-only GET joined
against BOTH the committed Batch 1 and Batch 2 scripts' own
classification/validation functions -- that same pass also re-verified
Batch 1's 48 ids and confirmed zero Batch-3-shaped field exists -- never
hand-transcribed from a prior console paste. Full repo-wide
`scripts/test-*.cjs` suite (59 files) re-run clean. `tsc -b --force` and
`vite build` both clean.

**Batch 3 GHL Test provisioning + wiring (repository-only, following the
live Test apply above) -- the FINAL wiring step, completing all 110 live
projection keys:** `test-inv67-broker-text-fields-batch3-script.cjs`
(new, 91/91) -- mirrors Batch 1/2's suite exactly for the 22-key
`BROKER_TEXT_KEYS` batch, plus confirms Batch 1/2's script files remain
untouched, plus proves the page-11 model boundaries (no city/state/ZIP,
no intermediary, no paragraph-8; Team Name/Supervisor Phone present on
both sides). `test-contract-ghl-projection.cjs`'s drift guard extended to
completion (79/79, +5 over the 74 from Batch 2's correction):
`shared/ghl-config.ts`'s TEST config now proven to carry a real id for
**every one of the 110 live projection keys** -- 29 retained + 48 Batch 1
markers + 11 Batch 2 contract-text keys + 22 Batch 3 broker-text keys,
all unique, none the sentinel, **zero sentinels remain in TEST**. A
fourth complete, known-good reference map (`BATCH3_APPROVED_BROKER_TEXT_
IDS`, 22 keys) joins `RETAINED_APPROVED_IDS` (29), `BATCH1_APPROVED_
MARKER_IDS` (48), and `BATCH2_APPROVED_TEXT_IDS` (11) -- every one of the
110 keys is checked key-by-key against its own exact previously-approved
or newly-authorized id, never a sample and never key-presence-only. No
retired key re-enters the live map, and PRODUCTION/`contractDraftRequest`
proven unchanged. The 22 wired Batch 3 ids were sourced from a fresh,
independent, fail-closed read-only GET joined against ALL THREE committed
scripts' own classification/validation functions -- that same pass also
re-verified all 29 retained + 48 Batch 1 + 11 Batch 2 ids (110 keys
total) and cross-checked the 22 Batch 3 ids against Brad's authorized
mapping exactly -- never hand-transcribed from a prior console paste.
Full repo-wide `scripts/test-*.cjs` suite (60 files) re-run clean. `tsc -b
--force` and `vite build` both clean.

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
  broker-text keys) remained UNPROVISIONED at this point** -- confirmed no
  field matching either shape existed yet; `shared/ghl-config.ts`'s TEST
  config carried the sentinel for exactly those 33 keys immediately after
  Batch 1 wiring. Both were subsequently provisioned -- see the Batch 2
  and Batch 3 sections below; all 110 live projection keys are now real
  TEST ids.
- **Zero sends, zero template mutation, zero draft creation, zero
  Production mutation.** Repository wiring (pasting the 48 real ids into
  `shared/ghl-config.ts`) was performed as a SEPARATE, subsequent,
  repository-only step (no further GHL mutation) -- see the Code map/Test
  evidence sections below.

## Batch 2 GHL Test provisioning -- 11 restructured contract-text fields (2026-09-14)

**State: PROVISIONED.** Following Batch 1's repository merge (PR #53,
then the "dropped entirely" wording correction and PR #54's wiring
merge), Brad authorized the live Batch 2 apply. `app/scripts/inv67-create
-checkbox-text-fields-batch2.cjs --apply` ran against GHL Test
(`SoTgVoaFGHtBdRFvXWQV`), the same canonical `parentId`
`sGP3pbDQFN7fXS62MAgA` Batch 1 and the original 29 retained fields use --
mirrors Batch 1's hardened architecture exactly (hard location allowlist,
fail-closed canonical-anchor resolution, complete unfiltered 11-spec
preflight with no `--only`, exact-existing/conflict classification,
readback validation, unconfirmed-create safety), applied to a new,
sibling 11-key spec set; Batch 1's own script file is untouched.

- **Pre-apply Test Opportunity field count:** 115.
- **Created:** all 11 `CHECKBOX_TEXT_KEYS` -- zero pre-existing
  collisions, so all 11 were `CREATE`, none `REUSE`.
- **Post-apply Test Opportunity field count:** 126 (115 + 11, exact).
- **Readback verification:** every one of the 11 creates was independently
  re-read and validated against name, `fieldKey`, `dataType` (`TEXT`),
  `model` (`opportunity`), and `parentId` before being logged as
  `-- readback verified`. Exit code `0`.
- **Post-apply dry run (second, independent run):** all 11 keys
  reclassified `exact_existing`, zero proposed creates, zero conflicts.
  Exit code `0`. All 11 ids confirmed unique.
- **Independent source-of-truth re-verification** (before repository
  wiring): a SEPARATE, fresh read-only GET joined against BOTH the
  committed Batch 1 and Batch 2 scripts' own `FIELD_SPECS`/
  `classifyExistingMatch`/`validateFieldAgainstSpec`/
  `resolveCanonicalParentId` confirmed all 11 Batch 2 ids a second time
  AND cross-checked them against Brad's authorized 11-key mapping
  (exact match), confirmed Batch 1's 48 ids remained `exact_existing` and
  unaffected, and confirmed zero Batch-3-shaped field exists -- fail-closed
  on any missing/mismatched/duplicated/unexpected field or a field count
  other than 126.
- **Batch 1's 48 marker fields confirmed unchanged** (ids, `dataType`,
  `model` all re-verified live) -- none was touched by Batch 2's
  provisioning.
- **Batch 3 (22 page-11 broker-text keys) remains UNPROVISIONED** --
  confirmed no field matching that shape exists; `shared/ghl-config.ts`'s
  TEST config keeps the sentinel for exactly those 22 keys.
- **Zero sends, zero template mutation, zero draft creation, zero
  Production mutation.** Repository wiring (pasting the 11 real ids into
  `shared/ghl-config.ts`) was performed as a SEPARATE, subsequent,
  repository-only step (no further GHL mutation) -- see the Code map/Test
  evidence sections below.

**Batch 2 display names** (Brad/Jess approved): "Contract Natural
Resource Leases Terminate Within Days", "Contract Survey Seller Existing
Survey Furnish Days", "Contract Survey Buyer New Survey Obtain Days",
"Contract Survey Seller New Survey Furnish Days", "Contract Sellers
Disclosure Notice Deliver Within Days", "Contract Water Disclosure
Deliver Within Days", "Contract Water Disclosure Source", "Contract
Seller Pays Buyer Broker Dollar Amount", "Contract Seller Pays Buyer
Broker Percent Amount", "Contract Buyer Pays Seller Broker Dollar
Amount", "Contract Buyer Pays Seller Broker Percent Amount".

## Batch 3 GHL Test provisioning -- 22 page-11 broker-text fields (2026-09-15)

**State: PROVISIONED. All 110 live projection keys are now real TEST
ids -- zero sentinels remain.** Following Batch 2's repository merge (PR
#55, then the complete 48/29/11-key ID-preservation correction and PR
#56's wiring merge), Brad authorized the live Batch 3 apply.
`app/scripts/inv67-create-broker-text-fields-batch3.cjs --apply` ran
against GHL Test (`SoTgVoaFGHtBdRFvXWQV`), the same canonical `parentId`
`sGP3pbDQFN7fXS62MAgA` Batches 1/2 and the original 29 retained fields
use -- mirrors Batch 1/2's hardened architecture exactly, applied to the
22-key `BROKER_TEXT_KEYS` spec set (11 Seller-broker + 11 Buyer-broker,
both derived from the same 11 `BROKER_FIELD_SUFFIXES`); neither Batch
1's nor Batch 2's own script file is touched.

- **Pre-apply Test Opportunity field count:** 126.
- **Created:** all 22 `BROKER_TEXT_KEYS` -- zero pre-existing collisions,
  so all 22 were `CREATE`, none `REUSE`.
- **Post-apply Test Opportunity field count:** 148 (126 + 22, exact).
- **Readback verification:** every one of the 22 creates was
  independently re-read and validated against name, `fieldKey`,
  `dataType` (`TEXT`), `model` (`opportunity`), and `parentId` before
  being logged as `-- readback verified`. Exit code `0`.
- **Post-apply dry run (second, independent run):** all 22 keys
  reclassified `exact_existing`, zero proposed creates, zero conflicts.
  Exit code `0`. All 22 ids confirmed unique.
- **Independent source-of-truth re-verification** (before repository
  wiring): a SEPARATE, fresh read-only GET joined against ALL THREE
  committed scripts' own `FIELD_SPECS`/`classifyExistingMatch`/
  `validateFieldAgainstSpec`/`resolveCanonicalParentId` confirmed all 22
  Batch 3 ids a second time AND cross-checked them against Brad's
  authorized 22-key mapping (exact match); ALSO re-verified all 29
  retained + 48 Batch 1 + 11 Batch 2 ids in the same pass (110 keys
  total, all fail-closed on any missing/mismatched/duplicated/unexpected
  field or a field count other than 148).
- **Batches 1 and 2's 59 fields confirmed unchanged** (ids, `dataType`,
  `model` all re-verified live) -- none was touched by Batch 3's
  provisioning.
- **No unauthorized broker-shaped field exists** -- exact-set proof: the
  22 keys created this run equal, element-for-element, `BROKER_TEXT_KEYS`.
- **Page-11 model boundaries preserved**: no intermediary field, no
  city/state/ZIP field, no paragraph-8 field; Team Name and Licensed
  Supervisor Phone present on both sides.
- **Zero sends, zero template mutation, zero draft creation, zero
  Production mutation.** Repository wiring (pasting the 22 real ids into
  `shared/ghl-config.ts`) was performed as a SEPARATE, subsequent,
  repository-only step (no further GHL mutation) -- see the Code
  map/Test evidence sections below.

**Batch 3 display names** (Brad/Jess approved): "Contract Seller Broker
Firm Name", "Contract Seller Broker Address", "Contract Seller Broker
Firm License No", "Contract Seller Broker Associate Name", "Contract
Seller Broker Team Name", "Contract Seller Broker Associate Email",
"Contract Seller Broker Associate Phone", "Contract Seller Broker
Associate License No", "Contract Seller Broker Supervisor Name",
"Contract Seller Broker Supervisor Phone", "Contract Seller Broker
Supervisor License No", and the same 11 with "Buyer" in place of
"Seller".

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
  TREC 20-19. All three batches (48 checkbox-marker keys, 11 restructured
  contract-text keys, 22 page-11 broker-text keys -- all 81 new keys, all
  110 live projection keys total) ARE now provisioned in GHL Test, per
  the sections above -- but no template placement of any kind has been
  performed, including the 51 physical Batch 1 marker overlay positions
  (3 markers each printed at 2 locations) and all 110 keys' merge-tag
  placement on the Test template generally.

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

## Compound text-destination repair (this session) -- retires 2 more keys, adds 4, reformats 14

**What Jess found.** The 113-placement template manifest exercise (built
after the checkbox-marker / broker-model repair above provisioned all 110
live keys) surfaced that two of the original 29 retained document-line keys
project onto TREC paragraphs printing TWO physically separate blanks with
live printed language between them:

- `earnestMoneyOption.additionalEarnestMoney` -- ¶5(1): `"additional earnest
  money of $ ___ to Escrow Agent within ___ days"`.
- `closingPossession.closingDate` -- ¶9A: `"on or before ___, 20 ___"`.

A single merge-tag overlay cannot truthfully populate either destination.
A follow-up audit (Jess's own instruction: "do not assume these two are the
complete set") found two further deterministic defect classes among the
remaining retained keys, both provable directly from the renderer source in
`contract-document-model.ts`:

- **Four keys** (`earnestMoneyOption.earnestMoney`, `earnestMoneyOption.
  optionFee`, `earnestMoneyOption.optionPeriodDays`, `titleSurvey.
  objectionsDays`) whose renderer (`money()` / `daysText()`)
  unconditionally re-adds a `"$"` or `"day(s)"` word the printed form
  already supplies immediately adjacent to the blank -- placing the
  preview's verbatim text would duplicate printed TREC language
  (`"$$1,000.00"`, `"10 days days"`).
- **Nine keys** (`propertyLegalDescription.lot/block/addition/county/
  exclusions`, `titleSurvey.objectionsText`, `propertyCondition.
  serviceContractCap`, `settlementExpense.sellerCreditCap`,
  `addendaApplicability.districtNotices`) whose "none" disposition renders
  the invented sentence `"None (explicitly confirmed)."` -- never itself
  TREC language, never sized for the printed blank.

`parties.sellerSigners` was separately narrowed by Product Owner ruling
(not a defect -- the printed ¶1 Seller blank legitimately holds one or more
names, but the preview's `renderSignerRequirements()` also includes role
and a signing-authority note, which the printed contract must not carry).

**Product Owner rulings (all four approved before implementation):**

1. **Option A** -- retire the two compound keys from template projection
   entirely (join `CONTRACT_PROJECTION_RETIRED_KEYS`, 19 -> 21). Their
   existing GHL Test fields (`lx0NWWA8tgilbEY71n3b`,
   `s7jauYhoSPQd09GjoGOr`) remain physically present, unwritten and
   unplaced -- exactly the same disposition as the original 19 retired
   keys. **No audit-only writer was introduced** (Option B, a separately
   named/configured non-template audit projection path, was presented and
   explicitly declined).
2. **Four new transport-only key names approved**, collision-verified
   against every existing internal projection key and every existing GHL
   field key before approval: `additional_earnest_money_amount_text`,
   `additional_earnest_money_days_text`, `closing_date_month_day_text`,
   `closing_date_year_suffix_text`.
3. **Closing month/day format**: UTC-derived `"MMMM d"` (e.g.
   `"September 15"`). Its eventual template PLACEMENT remains Visual
   judgment in the manifest until Spock confirms fit on the clone -- this
   repair only builds the correct transport VALUE, never claims a proven
   GHL coordinate. The year suffix is exactly two numeric digits.
4. **`parties.sellerSigners` narrowed** to legal names only, `"; "`-
   separated, no role/note/status prose -- the human-facing Contract
   Workspace preview is UNCHANGED (still shows role + signing-authority
   note via `renderSignerRequirements()`, untouched).

**Architecture.** A new pure module, `app/src/lib/contract-ghl-transport-
formatting.ts`, supplies transport-only renderers that derive directly from
the same canonical `SellerContractFactsReport` fields
`contract-document-model.ts`'s preview renderers already read -- never a
second, independently-read carrier, never a re-parse of the preview's own
rendered text. `contract-document-model.ts` itself is completely
UNCHANGED. `contract-ghl-projection-model.ts`'s `buildContractProjectionPlan`
now routes fourteen of the 27 remaining retained keys
(`REFORMATTED_RETAINED_KEYS`) through the new transport renderers instead
of copying `preview.documentLines[key].text` verbatim; the other thirteen
retained keys are genuinely unaffected and still project verbatim preview
text exactly as before. `propertyCondition.serviceContractCap` and
`settlementExpense.sellerCreditCap` get an ADDITIONAL defensive fix beyond
the "none" -> `""` correction: their underlying `ValueOrNone.value` is free
text from a generic, currency-unaware capture control
(`ValueOrNoneField` in `ContractWorkspace.tsx`) with no guarantee an
operator never types a leading `"$"`, so their transport renderer
(`dollarValueOrNoneTransport`) strips one leading `"$"` and adjacent
whitespace defensively, by construction, regardless of what was typed.

**Closing-date fail-closed gate.** A new exported check,
`checkClosingDateCenturyBound(closingDateIso)`, refuses a malformed/
unparseable instant or any year outside 2000-2099 (the century TREC's own
printed `"20 ___"` prefix requires) via `blockingReasons` -- called from
`buildContractProjectionPlan` before either closing-date transport value is
derived, exactly like every other blocking reason (mineral-reservation
disagreement, marker-exclusivity violation, blocking broker arrangement).
This is the SAME gate `ContractWorkspace.tsx`'s sync handler checks (`plan.
ok`) before calling the GHL write or evaluating the Contract Draft Request
transition -- a failed gate structurally blocks both.

**Key inventory, before -> after:**

| Metric | Before | After |
|---|---|---|
| Retained template document-line keys | 29 | 27 |
| New transport-only keys | 0 | 4 |
| Retired keys | 19 | 21 |
| Active template-projection keys (`CONTRACT_PROJECTION_FIELD_KEYS`) | 110 | 112 |
| Real GHL Test ids (unaffected, byte-for-byte unchanged) | 110 | 108 |
| Sentinel-filled GHL Test ids | 0 | 4 (the new transport-only keys -- NOT provisioned this session) |
| Production | 110/110 sentinel | 112/112 sentinel |

**Code map (this repair):**

| File | Role |
|---|---|
| `app/src/lib/contract-ghl-transport-formatting.ts` (new) | Pure transport-only renderers + `checkClosingDateCenturyBound` |
| `app/src/lib/contract-ghl-projection-model.ts` | `CONTRACT_PROJECTION_TRANSPORT_ONLY_KEYS` (new), retained/retired arrays updated, `buildContractProjectionPlan`'s reformatted-key routing + century-bound gate |
| `app/shared/ghl-config.ts` | `CONTRACT_PROJECTION_FIELD_KEYS` (112), TEST/PRODUCTION `contractProjectionFields` updated |
| `app/scripts/test-contract-ghl-transport-formatting.cjs` (new) | Direct unit proof of every transport function, including the 2000-2099 boundary table, leap day, and UTC-boundary instants |
| `app/scripts/test-contract-ghl-projection.cjs` | Extended: 112-entry happy path, reformatted-key transport proofs, century-bound blocking proof, updated drift guard (108 real / 4 sentinel in TEST, 27-key `RETAINED_APPROVED_IDS` reference) |
| `app/package.json` | `test:contract-ghl-transport-formatting` script entry |

**Test evidence.** `test:contract-ghl-projection` 133/133, `test:contract-
ghl-transport-formatting` 54/54 (new), `test:contract-document-model`
100/100 (proves the human-facing preview is byte-for-byte unaffected),
`test:contract-checkbox-marker-model` 99/99, `test:contract-broker-
arrangement-model` 29/29, `test:contract-facts-model` 52/52, `test:seller-
contract-facts-carriers` 56/56, `test:contract-draft-request` 86/86,
`test:contract-workspace-wiring` 100/100, `test:contract-workspace-view`
37/37. Full repository suite (every `scripts/test-*.cjs`) re-run clean.
`tsc -b` (project-wide TypeScript build) clean. `pnpm --dir app build`
(tsc -b + vite build) clean.

**What this repair does NOT do.** Does not provision the 4 new GHL Test
fields (a separately authorized future Test-only provisioning pass,
mirroring Batches 1-3's hardened architecture, is required first). Does not
touch the source template (`6aa417de09c51fa0927e77cd`) or the clone
(`6aa8cd5958e1a1e2c804c80b`) in any way. Does not edit
`docs/INV67_TEMPLATE_PLACEMENT_MANIFEST_V1.md` -- that manifest must be
regenerated only after the 4 fields are provisioned and wired, against the
corrected 112-key / 115-placement structure. Does not create a draft, send
anything, or touch Production, Linear, or Board #10. PR opened for Jess
Gate review; not merged pending that review.

## One-/Two-Seller signer model + Test Seller-Count field -- Phase 1 (this session)

**What this phase is.** Brad's final-gated "INV-67 ONE-/TWO-SELLER MODEL +
TEST SELLER-COUNT FIELD -- PHASE 1 IMPLEMENTATION" authorization, following
four rounds of READ-ONLY planning (circular-gate removal, discovery-before-
implementation sequencing, strict name-matching, entity-capacity-boundary,
template-readiness-must-include-verification, draft-bound recipient-
confirmation binding). This phase builds and tests the canonical model, the
persistence carrier, Seller 1 resolution, the Contract Workspace UI, and a
dry-run-only GHL Test provisioning script for a new `Contract Seller Count`
transport field. **CORRECTED by the Jess re-gate round below: the live
readiness gate IS wired into `buildContractProjectionPlan` and the
Contract Draft Request write path in this same phase** -- see "One-/Two-
Seller signer model -- Phase 1 Jess re-gate correction" further down for
what changed and why, and "What this phase does NOT do" below for what
genuinely remains out of scope.

**Locked canonical model** (`app/src/lib/contract-seller-signing-model.ts`,
new, pure). `SellerSigningModel` is a discriminated union on `kind`:
`"one_seller"` (`seller1Capacity` only) or `"two_sellers"` (`seller1Capacity`,
`seller2: {legalName, email}`, `seller2Capacity`). `SigningCapacityDisposition`
is `"individual_own_capacity" | "unsupported_capacity" | "unresolved"` --
only the first passes; the other two fail closed with DIFFERENT messages.
V1 supports natural-person Sellers signing in their own capacity only --
entity/trust/trustee/POA/estate/representative capacity is explicitly
unsupported, never inferred from free-text `role`/`signingAuthorityNote`.
Email normalizes via `trim().toLowerCase()`; name comparison normalizes via
trim + collapse-internal-whitespace + case-fold ONLY -- no fuzzy matching,
so punctuation/middle-name/suffix/abbreviation differences fail closed and
show both values.

**Seller 1 -- zero new GHL API surface.** `OpportunityRow`
(`app/src/lib/ghl.ts`) already carries `contactId`/`contactName`/`email` on
every row, populated server-side by the existing `ghl-opportunities`
function and already fetched by `ContractWorkspace.tsx` via the existing
`ghl.opportunities.listPipeline()` / `opportunitiesForContact()` path.
`resolveSeller1FromOpportunity()` is therefore 100% pure -- it validates
already-fetched data, it does not fetch anything. Seller 1 is never
manually duplicated into the canonical fact; `SellerSigningModel` carries no
Seller-1 identity fields at all.

**Persistence.** A sixteenth section appended to `app/src/lib/seller-
contract-facts-carriers.ts` (`SELLER_SIGNING_MODEL_LEDGER_VERSION =
"iaos-seller-contract-signing-model-v1"`), mirroring every existing section's
append-only, positional-label, latest-note-wins pattern exactly. Switching
Two Sellers -> One Seller writes a new `one_seller` note; the prior
`two_sellers` note remains independently parseable as history (never
edited/deleted), but has zero influence once the latest fact resolves to
`one_seller` -- proved directly in the test suite.

**Fifteen distinct pre-draft gates**, each its own exported function, plus
one aggregator (`evaluateSellerSigningReadiness`) that collects ALL
applicable reasons in one pass (never just the first) and mirrors
`board9-contract-model.ts`'s own `{ok:true} | {ok:false; reasons}` shape.
Two-Seller-only gates (7-11, Seller 2's half of 13) are skipped entirely for
`one_seller` -- One-Seller produces zero Seller-2-shaped output of any kind.
Printed-party consistency (gates 12-13) cross-validates against the existing
`parties.sellerSigners` cardinality and, only once cardinality agrees, each
name -- resolved Seller 1 name vs. the first printed Seller, Seller 2's
legal name vs. the second.

**Contract Workspace UI** (`app/src/pages/ContractWorkspace.tsx`). A new
form box in the existing "parties" group, alongside (not replacing) the
existing signer/buyer-override forms: a required Number-of-Sellers selector
with no default (`"unset"` until chosen); a read-only display of the
resolved Seller 1 name/email/contact id (or the specific resolution failure
reason); an explicit three-state Seller 1 capacity selector defaulting to
"Not yet confirmed" (`unresolved` -- a real, persistable disposition, not an
eligible default); and, rendered ONLY when Two Sellers is selected, Seller 2
legal-name/email fields and its own three-state capacity selector. Save
validates only what the Note carrier itself requires to round-trip (a
selected count; for Two Sellers, non-blank name, valid + distinct email) --
an `unresolved` capacity is itself a valid recorded state, exactly like every
other explicit populated/not-applicable/unresolved fact group in this file
-- draft-readiness gating on that capacity happens downstream, in
`buildContractProjectionPlan`'s own fold (see the Jess re-gate correction
section below), not at Note-save time.

**Contract Seller Count transport field -- Test-only, dry-run only.** New
script `app/scripts/inv67-create-seller-count-field.cjs`, structurally
identical to the proven Batch 1-3 provisioning architecture (hard
Test-location allowlist checked before any credential read, canonical-anchor
`parentId` resolution, `classifyExistingMatch` / `validateFieldAgainstSpec`
/ `parsePostResponse` / `planBatch` / `printSummaryAndExit`, dry-run
default, zero PUT/PATCH/DELETE capability anywhere in the script), plus one
addition: `validateFieldAgainstSpec` now also enforces exact, order-
sensitive equality of the field's options array, and a new
`verifyAgainstAuthoritativeSource()` reads
`contract-seller-signing-model.ts` and dies loud before any network call if
its `SELLER_COUNT_ONE_SELLER_VALUE`/`SELLER_COUNT_TWO_SELLERS_VALUE`
constants ever drift from this script's `options` array. One field:
`Contract Seller Count`, `SINGLE_OPTIONS`, options exactly `["One Seller",
"Two Sellers"]`, on the existing Opportunity Details folder (same canonical
anchor, `opportunity.arv_after_repair_value`).

**Configuration.** `app/shared/ghl-config.ts` gets a new, separate
`contractSellerCountField: string` field on `GhlConfig` -- NOT a member of
`CONTRACT_PROJECTION_FIELD_KEYS` (still exactly 112). Both `TEST` and
`PRODUCTION` are sentinel-filled (`CONTRACT_PROJECTION_FIELD_NOT_PROVISIONED`)
this phase; `checkSellerCountFieldProvisioned` fails closed on that exact
sentinel. No fake field id was ever written. **STALE as of "Seller Count
Test-ID wiring" further below: `TEST.contractSellerCountField` now carries
the real, readback-verified id -- `PRODUCTION` remains exactly as described
here.**

**Live GHL Test dry run (authorized, zero POSTs).** One proposed field,
zero collisions: `contractSellerCount` does not yet exist in GHL Test.
Proposed fieldKey `opportunity.contract_seller_count`, merge tag
`{{opportunity.contract_seller_count}}`, canonical parentId
`sGP3pbDQFN7fXS62MAgA` (the same Opportunity Details folder every other
INV-67 field uses), against 148 existing fields at the time of the read.

**What this phase does NOT do** (Brad's explicit out-of-scope list, verbatim
respected -- CORRECTED by the Jess re-gate round below: the live readiness
gate itself is now in scope and wired; see that section for what changed).
Does not create the live Seller Count field (no `--apply` was ever passed).
Does not mutate any GHL workflow, template, or clone. Does not create a
draft or send anything. Does not build the Two-Seller template. Does not
modify the placement manifest (`docs/INV67_TEMPLATE_PLACEMENT_MANIFEST_V1.md`'s
hash is unchanged from this phase's authorized starting point,
`075d847f3f7d8916feb16fc23a8ee92828a7033b5f3e1bb6fc76bf245e36e60d`). Does
not implement the final draft-bound recipient-confirmation gate (draft-time
recipient status is recorded as `pending_manual_review` audit evidence; no
routing/sending is implemented or simulated). Does not touch Production,
Linear, or Board #10. Does not mark INV-67 complete. PR opened for Jess
Gate review; not merged pending that review.

**Code map (this phase):**

| File | Role |
|---|---|
| `app/src/lib/contract-seller-signing-model.ts` (new) | Canonical `SellerSigningModel` type, normalization, transport derivation, fifteen gates, `evaluateSellerSigningReadiness` aggregator, `resolveSeller1FromOpportunity` |
| `app/src/lib/seller-contract-facts-carriers.ts` | New Section 16 -- `formatSellerSigningModelNote` / `parseSellerSigningModelNote` / `latestSellerSigningModelForOpportunity` |
| `app/src/pages/ContractWorkspace.tsx` | New Number-of-Sellers form in the "parties" group; `handleSaveSellerSigning`; `seller1Resolution` / `latestSellerSigningModel` memos |
| `app/shared/ghl-config.ts` | New `contractSellerCountField` config entry, separate from `CONTRACT_PROJECTION_FIELD_KEYS`, sentinel in both TEST and PRODUCTION |
| `app/scripts/inv67-create-seller-count-field.cjs` (new) | Dry-run-only Test provisioning script for the Contract Seller Count field |
| `app/scripts/test-contract-seller-signing-model.cjs` (new) | Direct unit proof of every gate, the aggregator, and `resolveSeller1FromOpportunity` |
| `app/scripts/test-seller-contract-facts-carriers.cjs` | Extended -- Section 16 round-trip, fail-closed, and Two-Sellers-to-One-Seller history-isolation proofs |
| `app/scripts/test-inv67-seller-count-field-script.cjs` (new) | Offline (network-free) safety suite for the new provisioning script |
| `app/package.json` | `test:contract-seller-signing-model`, `test:inv67-seller-count-field-script` script entries |

**Test evidence.** `test:contract-seller-signing-model` 76/76 (new),
`test:seller-contract-facts-carriers` 73/73 (56 existing + 17 new),
`test:inv67-seller-count-field-script` 89/89 (new). Full repository suite
(every `scripts/test-*.cjs`) re-run clean. `tsc -b --force` (project-wide
TypeScript build) clean. `CONTRACT_PROJECTION_FIELD_KEYS` count unaffected
at exactly 112.

## One-/Two-Seller signer model -- Phase 1 Jess re-gate correction (this session)

**What this correction is.** PR #60's Phase 1 build (above) built and unit-
tested the canonical model, gates, and aggregator but deliberately did NOT
wire them into the live sync/draft path -- Jess Gate review found that a
blocking scope miss: the authorization required every seller-model blocker
to prevent Contract Draft Request from reaching Requested. This correction
wires the live gate into the EXACT same fail-closed path
`buildContractProjectionPlan` and the Contract Draft Request write already
use, extends the existing two-phase audit evidence, and adds the live-
capable write/readback path for the Seller Count transport field (at the
time of this correction, not yet reachable in Test -- the field was still
sentinel; see "Seller Count Test-ID wiring" further below for when and how
that changed) -- without weakening any of the
112 TREC projection fields' or the Contract Draft Request control's
existing guarantees. **Zero GHL mutations. The Seller Count field, the
GHL workflow, the Two-Seller template, and the draft-bound recipient-
confirmation gate all remain exactly as out of scope as PR #60 stated.**

**1. Canonical vs. transport readiness split** (`contract-seller-signing-
model.ts`, additive -- the existing fifteen gates and `evaluateSellerSigningReadiness`
are UNCHANGED, byte-for-byte, and all 76 of their existing tests still pass
unmodified). Three new pure functions, each re-invoking the same
unmodified aggregator with the other half's inputs probed as passing,
never a second, independently-maintained copy of any gate's logic:
- `evaluateSellerSigningCanonicalReadiness` -- gates 1-13 only (the seller
  model itself: cardinality, Seller 1, capacity, printed-party consistency).
- `evaluateSellerSigningTransportReadiness` -- gates 14-15 only (the Seller
  Count field's provisioning and write/readback state).
- `evaluateSellerSigningPreWriteReadiness` -- gates 1-14, the actual live
  gate. Gate 15 (write/readback confirmed) cannot be evaluated before a
  write is attempted at all, so it is probed as satisfied here and enforced
  SEPARATELY, post-write, via the exact same `allEntriesLanded` mechanism
  every one of the 112 TREC fields already uses (see #3 below) -- not a
  weaker guarantee, the SAME guarantee enforced at the pipeline stage where
  it is actually knowable.

**2. `buildContractProjectionPlan` now takes a REQUIRED fourth argument**,
`sellerReadiness` (`contract-ghl-projection-model.ts`). Its reasons (when
not `ok`) are folded into the SAME `blockingReasons` array every existing
gate already populates, at the very top of the function, before ANY entry
is built. All 17 pre-existing call sites (`ContractWorkspace.tsx`'s one live
call, plus 17 in `test-contract-ghl-projection.cjs`) were updated
mechanically; all 148 of that suite's pre-existing checks still pass
unmodified, proving the fold changes nothing about the TREC-fact gates'
own behavior. `ContractWorkspace.tsx`'s `handleSyncContractProjectionFields`
now: resolves the live seller-readiness input (the latest `SellerSigningModel`
Note via `latestSellerSigningModelForOpportunity`, the resolved Seller 1
identity via the existing `seller1Resolution` memo, the printed
`parties.sellerSigners` array, and the configured `contractSellerCountField`
id/sentinel from `shared/ghl-config.ts`) -- calls
`evaluateSellerSigningPreWriteReadiness` -- passes the result into
`buildContractProjectionPlan` -- and only THEN, on `plan.ok`, proceeds to
the Opportunity-field write. A single `if (!plan.ok) { ...; return; }`
(unchanged code, already there) structurally short-circuits BEFORE the
112-field write AND before `setContractDraftRequest`, for every one of the
fifteen seller gates -- proven directly by a new structural test section
reading `ContractWorkspace.tsx`'s own source (see Test evidence below).

**3. The Seller Count write is folded into the SAME atomic PUT + SAME
atomic readback** the 112 TREC fields already go through (`ghl.ts`'s
`syncContractProjectionFields`), via a new optional third argument,
`sellerCount: {fieldId, text} | null`. Refuses before any network call on
the same missing/sentinel/duplicate-id conditions the 112 fields already
refuse on. Its own `landed` boolean is folded into the function's overall
`ok`, exactly like every projection entry's `landed` already is -- so
`evaluateContractDraftRequestTransition`'s existing `allEntriesLanded` gate
already refuses "Requested" on a failed Seller Count write/readback,
**with zero change to `contract-draft-request-model.ts`'s transition
logic**. Never reads the observed value back into the canonical
`SellerSigningModel` Note carrier -- transport only, exactly per the locked
ruling. Proven directly with a mocked-`fetch` test (`test-ghl-seller-count-
transport-write.cjs`, new) -- the first test in this repository to invoke
`ghl.ts` directly with a mocked network boundary rather than only reading
its source; ZERO real network calls anywhere in that suite.

**4. Extended, NOT duplicated, audit evidence.** `ContractDraftRequestSyncRecord`
(`contract-draft-request-model.ts`) gains one new required field,
`sellerSigningEvidence: SellerSigningAuditEvidence` -- a JSON-encoded blob
(new type + exact-keys validator, both in `contract-seller-signing-model.ts`)
computed ONCE per sync attempt (`buildSellerSigningAuditEvidence`,
immediately after the write) and carried forward UNCHANGED from the attempt
note to the resolution note, exactly like the existing `currentOfferCrossCheckOk`
field already is. Records: the seller-count discriminator; the resolved
Seller 1 reference and capacity; Seller 2's legal name, NORMALIZED email,
and capacity (when applicable); the printed-party consistency outcome; the
expected Seller Count transport value; `canonicalReady` and
`sellerCountFieldProvisioned` as SEPARATE booleans (never conflated --
"do not log a successful readiness result when the transport sentinel
blocks it"); the write/readback outcome (`null` pre-write); the fixed
`effectiveDateStatus: "pending_final_acceptance"` and
`recipientAssignmentStatus: "pending_manual_review"` literals; every
applicable blocking reason; and `sendOccurred: false`, always. This is the
SAME opportunity-scoped, two-phase ledger PR #60 already built
(`contract-projection-sync-carriers.ts`) -- no second, global, or
independently-scoped audit system. Ledger version bumped
`iaos-contract-draft-request-sync-v2` -> `-v3` (one new positional field);
a pre-existing v2 note -- none exist live, Contract Draft Request remains
sentinel-filled everywhere -- simply fails the new header match and parses
`null`, this ledger's own established schema-bump precedent.

**5. UI uses the live result.** No second, UI-only validation set exists for
draft-readiness -- the Number-of-Sellers form's own Save validates only what
the Note carrier requires to round-trip (unchanged from PR #60); the SAME
`plan.blockingReasons` the live sync handler computes (now including every
applicable seller reason) is what the existing generic "blocked" UI already
renders, with zero new rendering code required.

**Code map (this correction):**

| File | Role |
|---|---|
| `app/src/lib/contract-seller-signing-model.ts` | Additive -- `SellerSigningReadinessResult` type, `evaluateSellerSigningCanonicalReadiness` / `evaluateSellerSigningTransportReadiness` / `evaluateSellerSigningPreWriteReadiness`, `SellerSigningAuditEvidence` type + `validateSellerSigningAuditEvidenceValue`, `buildSellerSigningAuditEvidence` |
| `app/src/lib/contract-ghl-projection-model.ts` | `buildContractProjectionPlan` takes a required 4th `sellerReadiness` argument, folded into `blockingReasons` |
| `app/src/lib/contract-draft-request-model.ts` | `ContractDraftRequestSyncRecord` / attempt+resolution builders gain `sellerSigningEvidence` |
| `app/src/lib/contract-projection-sync-carriers.ts` | Ledger v2 -> v3, new "Seller signing evidence" positional field |
| `app/src/lib/ghl.ts` | `syncContractProjectionFields` gains an optional `sellerCount` argument, folded into the same PUT + readback |
| `app/src/pages/ContractWorkspace.tsx` | `handleSyncContractProjectionFields` resolves and folds live seller readiness before any write; new `sellerSigningDisposition` / `printedSellerSigners` memos |
| `app/scripts/test-contract-ghl-projection.cjs` | 17 call sites updated for the new required argument (148 pre-existing checks unaffected); new Section 11 (19 checks) proving the fold, including "Requested impossible" for every seller blocker |
| `app/scripts/test-contract-seller-signing-model.cjs` | Extended -- 50 new checks covering the canonical/transport split, the pre-write gate, and the audit-evidence builder/validator |
| `app/scripts/test-contract-projection-sync-carriers.cjs` | Extended -- 5 new checks: evidence round-trip, malformed-evidence fail-closed, v2-header-now-rejected |
| `app/scripts/test-contract-draft-request.cjs` | Extended -- new evidence-carry-forward checks, and new STATIC source-order checks proving the handler short-circuits before both the Opportunity-field write and `setContractDraftRequest`, and that the canonical Note never absorbs the transport write's observed value |
| `app/scripts/test-ghl-seller-count-transport-write.cjs` (new) | Mocked-`fetch` proof of the write/readback fold: configured-field success, readback mismatch, write failure, sentinel/collision refusal -- zero real network calls |
| `app/package.json` | `test:ghl-seller-count-transport-write` script entry |

**Test evidence.** `test:contract-seller-signing-model` 126/126 (was 76),
`test:contract-ghl-projection` 167/167 (was 148), `test:contract-draft-request`
104/104 (was 90), `test:contract-projection-sync-carriers` 28/28 (was 23),
`test:ghl-seller-count-transport-write` 16/16 (new), `test:contract-workspace-wiring`
100/100 (unchanged -- the `ghl.notes.create` call-count invariant of 9 is
unaffected; no new note-write class was introduced). Full repository suite
(every `scripts/test-*.cjs`) re-run clean. `tsc -b --force` clean.
`pnpm --dir app build` clean. `CONTRACT_PROJECTION_FIELD_KEYS` count
unaffected at exactly 112. Manifest hash unchanged.

**What this correction does NOT do.** Does not use the provisioning script
with `--apply`; does not create the live Seller Count field; does not
mutate any GHL workflow or template; does not create a draft; does not
send anything; does not touch Production, Linear, or Board #10; does not
implement the final draft-bound recipient-confirmation gate or any
automatic recipient routing/sending. At the time of this correction,
`contractSellerCountField` remained the sentinel in both Test and
Production, so the live gate refused before any Seller-Count-dependent
write in BOTH environments -- proven directly
(`TEST.contractSellerCountField`/`PRODUCTION.contractSellerCountField`
sentinel checks, `test-contract-ghl-projection.cjs`). **STALE for Test as
of "Seller Count Test-ID wiring" below -- Production is unaffected and
remains sentinel.** PR #60 remains open, not merged, pending Jess re-gate
review.

## Seller Count Test-ID wiring (this session)

**What this is.** A separately authorized live GHL Test apply
(`scripts/inv67-create-seller-count-field.cjs --apply`, against the
approved Test location `SoTgVoaFGHtBdRFvXWQV`) created the `Contract
Seller Count` field, followed by this repository-wiring PR. **Test only.
Production untouched. Zero GHL mutations in this PR** -- the field already
exists from the prior authorized apply; this PR only edits committed
configuration and tests.

**Live field, readback-verified independently** (a separate GET, not the
provisioning script's own internal confirmation): id `gW6eD1ZgbS4UOhPWVyMm`,
name `Contract Seller Count`, fieldKey `opportunity.contract_seller_count`,
dataType `SINGLE_OPTIONS`, model `opportunity`, parentId
`sGP3pbDQFN7fXS62MAgA` (the same canonical Opportunity Details anchor every
other INV-67 field resolves from), options exactly `["One Seller", "Two
Sellers"]` in that order. Opportunity-field count went from 148 to 149
(exactly +1). A subsequent dry run classified it "exact existing" (0
create / 1 reuse / 0 conflict), confirming this is the SAME field, never a
second one.

**Configuration.** `TEST.contractSellerCountField` now carries
`"gW6eD1ZgbS4UOhPWVyMm"` (`app/shared/ghl-config.ts`).
`PRODUCTION.contractSellerCountField` remains exactly
`CONTRACT_PROJECTION_FIELD_NOT_PROVISIONED`, unaffected. Contract Seller
Count remains OUTSIDE `CONTRACT_PROJECTION_FIELD_KEYS` -- still exactly
112 -- it is a separate transport/control field, never one of the 112 TREC
projection keys, per the original design.

**Effect on the live gate.** `evaluateSellerSigningPreWriteReadiness`'s
field-provisioned check (gate 14) now passes in Test whenever the
canonical seller-model gates (1-13) also pass, and
`buildContractProjectionPlan`'s fold reflects that (`plan.ok` can now be
`true` in Test on a clear seller model). Production's own config value is
unchanged, so the SAME gate still refuses in Production -- proven directly,
side by side, in `test-contract-ghl-projection.cjs`. Expected transport
values remain exactly `"One Seller"` / `"Two Sellers"`, unchanged. The
Test id is not read back into the canonical `SellerSigningModel` Note
carrier -- transport only, exactly per the locked ruling.

**Code map:**

| File | Role |
|---|---|
| `app/shared/ghl-config.ts` | `TEST.contractSellerCountField` wired to the verified id; `PRODUCTION.contractSellerCountField` unchanged |
| `app/scripts/test-contract-ghl-projection.cjs` | Extended -- Test carries the exact verified id, Production remains sentinel, no duplicate id, Seller Count stays outside the 112-key set, the live gate passes in Test / still refuses in Production, expected transport values unchanged |

**Test evidence.** `test:contract-ghl-projection` 178/178 (was 167).
`test:contract-seller-signing-model`, `test:contract-draft-request`,
`test:contract-projection-sync-carriers`, `test:ghl-seller-count-transport-write`,
`test:contract-workspace-wiring` all unaffected (none reference the live
config value directly; the mocked transport-write suite supplies its own
fake id and is unaffected by the real committed value). Identifier
boundary green (10/10). Full repository suite (every `scripts/test-*.cjs`)
re-run clean. `tsc -b --force` clean. `pnpm --dir app build` clean.
`CONTRACT_PROJECTION_FIELD_KEYS` count unaffected at exactly 112. Manifest
hash unchanged.

**What this PR does NOT do.** Does not create, modify, or delete any GHL
field (the field was created by a prior, separately authorized apply, not
by this PR). Does not wire or provision the four remaining transport-only
fields. Does not touch any template or workflow. Does not create a draft.
Does not send anything. Does not touch Production, Linear, INV-66, or
Board #10. Does not mark INV-67 complete. PR opened for review; not
merged.

## Batch 4 transport-only fields -- Test provisioning script + live dry run (this session)

**What this is.** A new, hardened provisioning script and offline safety
suite for the four remaining `CONTRACT_PROJECTION_TRANSPORT_ONLY_KEYS`
fields (introduced by the compound text-destination repair, above), plus
one authorized read-only live dry run against GHL Test. **Zero GHL
mutations. No field was created. `--apply` was never passed.**

**The four-field batch, exactly:**

| IAOS key | Display name | Expected fieldKey |
|---|---|---|
| `additional_earnest_money_amount_text` | Contract Additional Earnest Money Amount | `opportunity.contract_additional_earnest_money_amount` |
| `additional_earnest_money_days_text` | Contract Additional Earnest Money Days | `opportunity.contract_additional_earnest_money_days` |
| `closing_date_month_day_text` | Contract Closing Date Month Day | `opportunity.contract_closing_date_month_day` |
| `closing_date_year_suffix_text` | Contract Closing Date Year Suffix | `opportunity.contract_closing_date_year_suffix` |

All four Opportunity `TEXT` fields, on the same canonical Opportunity
Details folder every prior batch and the Seller Count field use (anchor
`opportunity.arv_after_repair_value`). Does NOT include Contract Seller
Count, any checkbox marker, any broker-text field, any retired field, or
Contract Draft Request.

**Script** (`app/scripts/inv67-create-transport-only-fields-batch4.cjs`,
new), structurally identical to Batch 1-3's and the Seller Count script's
proven architecture: dry-run by default, `--apply` required for mutation,
hard Test-location allowlist checked before any credential read, canonical-
anchor `parentId` resolution (fails closed on missing/duplicate/blank
anchor), the complete unfiltered 4-spec batch always preflighted before any
POST (no `--only`), exact-existing vs. conflict classification, strict
readback validation on both create and reuse paths, unconfirmed-create and
partial-failure safety, and zero PUT/PATCH/DELETE capability anywhere in
the script. `verifyAgainstAuthoritativeSource()` reads
`contract-ghl-projection-model.ts`'s `CONTRACT_PROJECTION_TRANSPORT_ONLY_KEYS`
directly and dies loud before any network call if this script's own
`FIELD_SPECS` ever drifts from it.

**Offline safety suite**
(`app/scripts/test-inv67-transport-fields-batch4-script.cjs`, new), 88/88,
mirroring Batch 2's own safety-suite structure exactly (the closest prior
precedent -- also a multi-`TEXT`-field batch): FIELD_SPECS count/order/
names/fieldKeys, location allowlist (static + real network-free child-
process spawns for both the approved location and Production's own id),
self-verification-before-network-access, `classifyExistingMatch` across
every conflict shape, `validateFieldAgainstSpec`, `parsePostResponse`,
`planBatch` (including a full-batch-preflight-before-any-POST proof and a
one-conflict-refuses-the-whole-batch proof), no `--only` bypass, the
canonical-anchor fail-closed proofs, the zero-PUT/PATCH/DELETE / no-
template/draft/send/Linear-endpoint proofs, and confirmation this script
does not modify the Seller Count script. One addition beyond the Batch 2
template: a direct proof that re-running `planBatch` against a hypothetical
post-apply inventory (all four fields already existing exactly as
specified) classifies every one `"reuse"`, never `"create"` -- a future
re-run cannot produce a duplicate field.

**Live GHL Test dry run (authorized, zero POSTs).** Existing Opportunity
fields: 149 (unchanged from the Seller Count field's own post-apply count).
Canonical parentId: `sGP3pbDQFN7fXS62MAgA` (same anchor, unchanged). Result:
**4 create, 0 exact-existing/reuse, 0 conflict** -- none of the four fields
exists yet in GHL Test. Zero POST, PUT, PATCH, or DELETE calls were issued
-- only the two GET calls (existing-fields list, canonical-anchor
resolution) every dry run of every prior batch also makes.

**Code map:**

| File | Role |
|---|---|
| `app/scripts/inv67-create-transport-only-fields-batch4.cjs` (new) | Dry-run-only Test provisioning script for the four transport-only fields |
| `app/scripts/test-inv67-transport-fields-batch4-script.cjs` (new) | Offline (network-free) safety suite, 88/88 |
| `app/package.json` | `test:inv67-transport-fields-batch4-script` script entry |

**Test evidence.** `test:inv67-transport-fields-batch4-script` 88/88 (new).
`test:contract-ghl-projection` 178/178 and `test:contract-ghl-transport-formatting`
54/54, both unaffected (this batch adds no new code to either module).
Identifier boundary green (10/10) -- unaffected, since no id was ever
created or wired. Full repository suite (every `scripts/test-*.cjs`)
re-run clean. `tsc -b --force` clean. `pnpm --dir app build` clean.

**What this session does NOT do.** Does not use `--apply`. Does not create,
modify, or delete any GHL field. Does not wire any id into
`app/shared/ghl-config.ts`. Does not regenerate or otherwise modify
`docs/INV67_TEMPLATE_PLACEMENT_MANIFEST_V1.md` -- that manifest remains
frozen until all four fields are provisioned and wired, per its own
governing note. Does not touch any template or workflow. Does not create a
draft. Does not send anything. Does not touch Production, Linear, INV-66,
or Board #10. Does not mark INV-67 complete. PR opened for review; not
merged.
