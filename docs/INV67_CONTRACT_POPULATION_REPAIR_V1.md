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
| `app/src/lib/ghl.ts` | `syncContractProjectionFields`, `readContractDraftRequest`, `setContractDraftRequest` |
| `app/src/pages/ContractWorkspace.tsx` | "Sync contract fields to GHL" control |
| `app/scripts/inv67-create-contract-projection-fields.cjs` | Test field-creation script (dry-run by default) |
| `app/scripts/test-contract-ghl-projection.cjs` | Mapping model tests + drift guard |
| `app/scripts/test-contract-draft-request.cjs` | One-shot gating tests |
| `app/scripts/test-contract-projection-sync-carriers.cjs` | Audit-ledger round-trip tests |

## Test evidence

`pnpm --dir app test:contract-ghl-projection` (32/32), `test:contract-draft-
request` (23/23), `test:contract-projection-sync-carriers` (17/17). Full
Board #9 regression suite re-run clean (`test:board9-contract-model`,
`test:contract-authorization-model`, `test:contract-disposition-handoff`,
`test:contract-document-model`, `test:contract-execution-model`, `test:
contract-facts-model`, `test:contract-lifecycle-model`, `test:contract-send-*`
(6 suites), `test:contract-workspace-view`, `test:contract-workspace-wiring`
(updated for the 8th `ghl.notes.create` call site), `test:current-offer-
carrier`, `test:repairs-canonicalization`, `test:seller-contract-facts-
carriers`, `test:seller-call-resume`, `test:seller-call-workspace-wiring`,
`test:legacy-offer-fields-retired`, `test:legacy-repairs-writer-removed`).
`pnpm --dir app build` (tsc -b + vite build) clean. CI's own remaining
runners re-run clean: `test:underwriting-core`, `test:underwriting-resolver`,
`test:rail`, `netlify-status.test.cjs`, root Netlify functions typecheck,
`test-identifier-boundary.cjs` (confirms every new GHL id lives only in
`app/shared/ghl-config.ts`), `test-exit-contract-static.cjs`,
`test-exit-contract-runtime.cjs`.
