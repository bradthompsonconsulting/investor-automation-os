# Board #9 contract inventory & reconciliation — B9-02 / INV-57

## What this is

The inventory INV-57 requires: what already exists — in code, in GHL, and
in locked decisions — against every requirement `docs/SELLER_CONTRACT_
STATE_MACHINE_V1.md` (B9-01) names, plus the wider template/process/
provider landscape B9-01 explicitly left to this issue. B9-03 (INV-58) may
build only from this map, not from assumption.

**It authorizes no code, creates no carrier, edits no template, activates
no workflow, and mutates no Production data.** Every classification below
is a finding about what exists, not a decision about what should be built.
Where the evidence does not reach an answer, that is reported as an
unresolved decision or a verified absence — never filled in here.

**Method**, mirroring `docs/BOARD8_ECONOMICS_INVENTORY_V1.md` (B8-02): every
row cites one of a file and line number (code, read directly from the
working tree on this branch), a document and section (a locked decision),
a live API response actually captured this session (request shown), a
provider's own public documentation actually fetched this session (URL
quoted), or an explicit search with a stated "no matches" result (verified
absence). Classified per `docs/FOUNDATIONAL_PRINCIPLES.md`'s OBSERVED /
INFERRED / UNKNOWN discipline throughout. Nothing below is reported from
memory of a prior session.

**Scope note.** All live GHL calls in this document were read-only GETs
against the **Test** location (`SoTgVoaFGHtBdRFvXWQV`), issued through the
running `netlify dev` instance's own `/.netlify/functions/ghl-proxy`
route — the same sanctioned path the application itself uses. No
Production location was queried. No POST/PUT/DELETE was issued anywhere
in producing this document.

---

## Part A — The nine required coverage areas

### 1. The actual approved V1 seller purchase-agreement template candidate(s)

**Settled, not open: no approved or current purchase agreement exists
yet.** Per Brad's ruling recorded in the INV-57 Linear comment,
2026-09-09: no approved/current purchase agreement exists. This is now a
plain fact this document records, not an open question — the absence
itself is not classified as UNRESOLVED PRODUCT/LEGAL DECISION.

- `grep -rn -i "purchase agreement" docs/*.md` — **zero matches**, run
  fresh this session, corroborating the same conclusion independently.
- `docs/PRODUCT_BACKLOG.md`'s two literal occurrences of the word
  "contract" (lines 125, 163–164) are both about Board #4 workflow-routing
  design ("that is the mechanism a persisted-disposition design would
  use"), unrelated to a purchase agreement.
- No attachment, linked document, or comment on INV-56 or INV-57 in Linear
  referenced a template before Brad's ruling above.

**Classification: REUSE, for a reference baseline only — not a Production
agreement.** Per Brad's direction, this document identifies a real,
publicly verifiable Texas contract form suitable for architecture,
field-mapping, signer-role, and e-sign evaluation purposes:

**Texas Real Estate Commission (TREC) Form ID 20-19, "One to Four Family
Residential Contract (Resale)."** OBSERVED this session, fetched from
`trec.texas.gov/forms/one-four-family-residential-contract-resale`: this
is a **promulgated form** — the page states it is published by TREC, the
Texas state regulatory agency for real estate, with a currently listed
effective date of 07/01/2026 (a redline revision, "20-19 Redline 5.2026,"
is also referenced on the same page, indicating an active revision cycle).
The page's own description: **"This is the most frequently used contract
form. It is used for the resale of residential properties that are
either a single family home, a duplex, a tri-plex or a four-plex."** It
explicitly **excludes** condominiums, new homes sold by builders, and
farm/ranch properties.

The actual PDF (`trec.texas.gov/sites/default/files/pdf-forms/20-19.pdf`)
was fetched this session and confirmed to exist and download (741.7KB,
saved locally to this session's own tool-results directory) — **but its
text could not be extracted by this session's fetch tooling**, which
returned encoded PDF stream/font data rather than readable prose. This
document therefore cannot cite the form's specific field-by-field layout
(the exact parties/property/price/financing/earnest-money/title/closing-
date/possession section wording) from direct inspection this session —
that remains a **follow-up read** (a PDF-text-extraction pass, or TREC's
own HTML summary of the form's parts, neither performed here) rather than
an UNRESOLVED PRODUCT/LEGAL DECISION. What is OBSERVED and citable now is
the form's identity, publishing authority, current effective date, and
stated scope, all above.

**Required disclaimers, stated explicitly and binding on all downstream
use of this reference:**
- **(a) Reference baseline for IAOS architecture purposes only** — named
  here so B9-03 has a real, concrete, publicly-inspectable document shape
  to design field-mapping and signer-role handling against, not to imply
  any decision about which form IAOS will ultimately use.
- **(b) Not approved for live use.** No purchase agreement — TREC 20-19
  or any other — is approved for any live seller transaction under this
  document.
- **(c) Texas real-estate attorney review and approval is required**
  before any live use of any purchase agreement, TREC 20-19 or otherwise.
  This document does not substitute for, shortcut, or presume that
  review.
- **(d) IAOS does not and cannot determine legal sufficiency of any
  agreement.** Nothing in this document, or in any future carrier/UI work
  built from it, may assert that a document is legally sufficient,
  complete, or enforceable. That determination belongs exclusively to
  qualified legal counsel.

This document quotes and cites only what TREC's own published page
actually says, above. Nothing is drafted, paraphrased as if official, or
presented as legally sufficient.

**No plausible-sounding template or clause is invented here** for the
question Brad's ruling settled (whether an approved agreement exists) —
that would violate this issue's own HARD NO on invented legal content and
FOUNDATIONAL_PRINCIPLES principle 19. The TREC citation above is the one
exception this document makes to "nothing is invented," precisely because
it is not invented: it is a real, externally published, independently
verifiable form, cited as a reference baseline exactly as Brad directed,
with its non-approved status stated as plainly as its identity.

### 2. Required template fields and signer roles

**Partially derivable from existing locked contracts; final enumeration
still depends on an approved template, which item 1 records does not yet
exist.**

What the *state machine itself* already requires as data, regardless of
which template is eventually chosen (`docs/SELLER_CONTRACT_STATE_MACHINE_
V1.md`, "Contract Execution Details" section, lines 457–464): party
identity and signing authority, agreed price and terms (consumed from
Board #8), closing timeline, occupancy/possession terms, delivery/signing
mechanics, a disclosure-level liens/title-complications fact, verified
execution status, and the preserved executed document with its
provider/envelope identifier, completion time, contract version, and
integrity identifier (SELLER_CONTRACT_STATE_MACHINE_V1.md lines 202–222,
Under Contract entry evidence).

The TREC 20-19 reference baseline (item 1) gives a concrete, real shape to
design field-mapping against — a promulgated Texas 1-4 family resale
contract necessarily names parties/buyer/seller, property description,
sales price, financing, earnest money, title, closing date, and
possession as a matter of the form's own subject matter — but this
document could not extract TREC 20-19's own section-by-section field text
this session (see item 1), so it does not claim a verified field-by-field
list from that specific document. Signer roles beyond "the seller(s)"
(co-owner, spousal, POA, witness/notary roles) remain unenumerable until
an actual approved template's own signature-block language is read.
**Classification: REAL LOGIC GAP** for mapping IAOS's existing party data
to template signer roles (nothing attempts this today — see item 7 for
what party data exists). No product/legal decision blocks this item
directly; it is a mapping exercise that has no template yet to map
against.

### 3. Brad's current contracting workflow

**Settled, not open: no current contracting workflow exists yet.** Per
Brad's ruling recorded in the INV-57 Linear comment, 2026-09-09: no
current contracting workflow exists. This is a plain fact this document
records, not an open question.

**Classification: EXTERNAL/OPERATIONAL GAP** (reclassified from
UNRESOLVED PRODUCT/LEGAL DECISION, this correction) — the gap is that no
workflow exists to observe or reconcile, not that a policy decision is
pending. No document in `docs/` describes a paperwork process between an
accepted verbal deal and an executed contract, corroborating the same
conclusion independently: `grep -rn -i "purchase agreement" docs/*.md`
returns zero matches (item 1), and `docs/SELLER_ACQUISITION_WORKFLOW.md`'s
"Agreement and contract readiness" section (lines 168–172) describes what
IAOS *should* check before paperwork, not what paperwork process exists
today. **Designing the future workflow remains out of scope for INV-57**
— this document records that the gap is real and external/operational,
not a decision this issue makes or a workflow this issue drafts.

### 4. Seller disclosures versus formal title/closing verification

**RESUSE of an existing, already-locked distinction — no gap.**
`docs/SELLER_CONTRACT_STATE_MACHINE_V1.md`'s "Contract Execution Details
vs. later Closing Ready / title-clearance information" section (lines
450–471) already draws this line precisely, citing `docs/SELLER_
ACQUISITION_WORKFLOW.md`'s own instruction to "Separate facts required to
prepare and execute the seller agreement from facts required later for
title clearance or closing... do not silently turn Closing Ready into
Contract Ready." In scope for Board #9: the fact that liens/title
complications were *disclosed and reviewed* (disclosure-level). Out of
scope, deferred: title search results, lien payoff verification and
amounts, insurance, funds disbursement, actual closing completion. This
document's finding is that the distinction is already locked and needs no
further reconciliation — item 9 below records the related, now-settled
fact that no single title/closing provider or process is fixed, which
this distinction's "deferred to future Closing Ready work" side must
accommodate rather than assume away.

### 5. Existing GHL seller stages, Opportunity/contact fields, documents, notes, workflows, and relevant API capabilities

**Mixed — REUSE for stages/fields as read targets, REAL CARRIER GAP for
contract-specific data, and a newly-confirmed EXTERNAL/OPERATIONAL GAP for
workflow and documents-capability visibility.**

**Pipeline stages — OBSERVED live, Test location, 2026-09.** `GET
/opportunities/pipelines` (via `ghl-proxy`) returns the "Seller Leads
Pipeline" (`id: wdvKMdPMxs38qoA6lkUa`) with exactly ten stages, in
position order: New Lead - Seller, Contact Initiated, Seller Call Booked,
No Show, Seller Call Completed, Seller Follow-Up, **Seller Offer Sent**,
**Seller Closed-Won**, Long-Term Nurture, Lost / Not Interested. **No
stage corresponds to Agreement Reached, Contract Ready, Contract Sent, or
Under Contract** — the closest by name are "Seller Offer Sent" (position
6, pre-acceptance) and "Seller Closed-Won" (position 7, which conflates
whatever "closed" means today with the four-state machine B9-01 just
locked). **Classification: REAL CARRIER GAP** for stage-based tracking of
the Board #9 states specifically — but per AGENTS.md's HARD NO
(`CONTACTS_OPPORTUNITIES_SPEC.md` §4.1: "Tags, pipeline stage, `offer_`
fields, workflow triggers. IAOS never fires a workflow. No write class
relaxes this"), **IAOS could not write pipeline-stage transitions for
these states even if a carrier gap analysis recommended it** — this is a
hard boundary this document restates, not a gap B9-03 is free to close by
adding a stage-move write.

**Contact custom fields — OBSERVED live, Test location, 2026-09.** `GET
/locations/SoTgVoaFGHtBdRFvXWQV/customFields` returns exactly 109 fields,
**all** `model: "contact"` (`d.customFields.every(f => f.model ===
"contact")` — confirmed, zero `"opportunity"`-model rows in this
response). Filtered against every data category items 2 and 7 require:

| Category needed | Field(s) found | Classification |
|---|---|---|
| Owner name(s) | `Owner 2 First Name` (`BO6g5lI3zwl9o2fkzKJA`), `Owner 2 Last Name` (`k03lJQIsMj6RFEHbFe1n`), both TEXT — plus the Contact's own primary name fields (implicit Owner 1) | **REUSE, partial** — a second owner's name is capturable; nothing distinguishes signing *authority* (POA, trustee, etc.) from a name |
| Occupancy | `Occupancy Status` (`H3daXFIC1fXl99oG7YX7`, MULTIPLE_OPTIONS, already wired via `ghl.contacts.setOccupancyStatus`, `app/src/lib/ghl.ts:764`), `Owner Occupied` (`UyNmFRehGS0D1Xf5TvJT`, TEXT) | **REUSE**, already shipped and used |
| Liens | `Lien Amount` (`8HfQAfqKuP7tqLefmQCs`, NUMERICAL) exists but **is not read anywhere in `app/src`** — confirmed by the same grep discipline B8-02 used: no call site references this field id or a `setLienAmount`-shaped writer in `app/src/lib/ghl.ts` | **REAL CARRIER GAP** — a structured field exists in GHL but IAOS has no read or write path to it; only the free-text "Title complications" field in `seller-call-readiness-carriers.ts` (`TRANSACTION_ASSUMPTIONS_LABELS[5]`, line 206) captures anything lien-adjacent, and only as prose |
| Earnest money, contingencies, signer delivery, property access, closing date (structured), possession terms (structured) | **None found.** Broadened keyword search across all 109 fields (`deposit`, `money`, `earnest`, `contingen`, `access`, `signer`, `sign`, `envelope`, `possession`, `closing`) matched zero relevant fields beyond the dates already listed (`Offer Date`, `MLS Date`, `Follow Up Date`, `Callback Datetime`, `Last Sale Date`, `Date Added to List` — none is a closing date) | **REAL CARRIER GAP**, verified absent |

**Opportunity-model fields could not be enumerated the same way.** The
`customFields` endpoint above returns contact-model fields only; a live
`GET /opportunities/search` sample opportunity's own `customFields` array
returns only the four fields that happen to carry a value on that record
today (ARV, assignment mode, end-buyer max, seller MAO) — this is
populated data, not a field-definition catalog, so it cannot confirm or
deny whether other opportunity-model custom fields exist unpopulated.
**Classification: UNKNOWN**, stated as such rather than inferred either
way — the sanctioned read path does not expose an opportunity-model field
catalog the way it does for contacts.

**Workflows — could not be retrieved; the sanctioned proxy blocks the
attempt outright.** `GET /workflows/?locationId=...` returns `{"error":
"Forbidden","by":"iaos-proxy-allowlist"}`, HTTP 403 — confirmed by reading
`app/netlify/functions/ghl-proxy.ts` lines 59–69: the GET allowlist
contains exactly `/contacts`, `/contacts/{id}`, `/contacts/{id}/notes`,
`/locations/{id}/customFields`, `/locations/{id}/customFields/{id}`,
`/opportunities/pipelines`, `/opportunities/search`, `/opportunities/{id}`
— **no `/workflows` entry at all**. Per that file's own header comment
(lines 8–19), this is a deliberate positive allowlist derived from every
existing call site; a new path "requires a matching entry here or it
fails 403." Reference memory's prior note ("31 published workflows... at
observation time, 2026-07-21") describes **Production**, observed by a
method this document cannot reconstruct from the current allowlist, and
is inapplicable here regardless since Production access is barred this
round. **Classification: EXTERNAL/OPERATIONAL GAP** — workflow inventory
for the Test location is genuinely unavailable through IAOS's current
sanctioned tooling; expanding the allowlist to permit it would itself be
implementation work, outside this issue's HARD NO.

**Documents/Contracts/Invoices/Proposals capability — could not be probed
at all; same allowlist mechanism, three attempts.** `GET /invoices/
template?...`, `GET /documents?...`, and `GET /proposals/template?...`
each returned the identical `{"error":"Forbidden","by":"iaos-
proxy-allowlist"}` — none of these paths appear in the GET allowlist
either (same file, same line range). This is a **stronger, independently
confirmed version** of `docs/UNDERWRITING_WORKSPACE_SPEC.md`'s own prior
finding (lines 261–273): not only is it unverified whether this GHL
location's Documents & Contracts feature can merge per-deal Opportunity
fields — IAOS's own sanctioned read path cannot even ask the question,
by design. Attempting to reach GHL directly, bypassing the proxy, was not
done: that would mean handling the raw API token outside the app's own
sanctioned mechanism, which this document treats as configuration/secrets
handling requiring its own authorization, not a "read-only Test check."
**Classification: UNKNOWN, more precisely bounded than before** — genuine
capability verification requires either a change to the proxy's own
allowlist (implementation, out of scope) or a direct, separately-
authorized check outside IAOS's app code.

**Documents & Contracts — official documentation, superseded finding.**
An earlier pass this session guessed at GHL's own documentation URLs:
the general Stoplight-hosted API reference
(`highlevel.stoplight.io/docs/integrations/`) and a guessed help-center
URL both failed to return retrievable content (the Stoplight page is a
JavaScript single-page app that returned no server-rendered content to
this session's fetch tool; the guessed help-center URL 404'd) — that
attempt's negative result is preserved here as an honest record of what
was tried and failed, **not** as this document's current position.
**Superseded, this correction:** Brad supplied the correct official
documentation URLs directly (item 8 below), which were fetched
successfully and yielded substantial DOCUMENTED evidence for the
feature's actual API and data model. Item 8's ten-point verification is
the current, authoritative treatment of this capability; this paragraph
and the allowlist finding above it remain accurate for what they
specifically describe (the app's own proxy, and the earlier failed
guesses), but should not be read as GHL's capability remaining wholly
UNKNOWN. **Classification: superseded by item 8's ten-point
verification** — this document's current position on GHL's native
e-signature capability, template merge-field support, and completion-
signal shape is DOCUMENTED for several dimensions and BLOCKED (not
UNKNOWN, not UNSUPPORTED) for the remainder, per item 8's tags.

### 6. Existing Board #8 accepted-price/economics provenance and handoff

**REUSE — already fully covered by `docs/SELLER_CONTRACT_STATE_MACHINE_
V1.md`, restated here rather than re-derived.** Agreement Reached's
accepted price is `OutcomeSnapshot.currentOffer`
(`app/src/lib/seller-call-outcome.ts:67-76`), captured verbatim at
acceptance from B8-08's session negotiation state, alongside
`sellerPosition`, `targetAcquisitionPrice`, `maxSupportedOffer`,
`expectedSpread`, `arv`, `repairs`, and `readinessStatus` — all copied,
none recomputed (module header, lines 40-45: "ACCEPTED PRICE IS THE
EXISTING CURRENT OFFER, NEVER A NEW FIELD"). Written through the existing
sanctioned `ghl.notes.create()` (confirmed in the POST allowlist,
`ghl-proxy.ts` line 76: `^/contacts/${ID}/notes$`), gated so acceptance
cannot be recorded without a Current Offer or without `OFFER_READY`
`effectiveStatus` (`attemptRecordOutcome`, `seller-call-outcome.ts:265-279`).
The note's own embedded timestamp is the durable agreement identity
(`agreementAt`), already reused by the Contract Ready checklist carrier
(`seller-call-readiness-carriers.ts:913`, `ParsedContractReadyChecklist.
agreementAt`). Nothing here needs reconciling; B9-03 consumes this
exactly as `SELLER_CONTRACT_STATE_MACHINE_V1.md` already specifies.

### 7. Existing property, ARV, repairs, access, photo/document, closing-date, earnest-money, possession, contingency, owner/signing-authority, and signer-delivery data

**Mixed, itemized — the largest single source of REAL CARRIER GAP
findings in this document.**

| Data category | Existing carrier | Classification |
|---|---|---|
| Property (address) | `PropertyIdentityConfirmation` carrier, `seller-call-readiness-carriers.ts:109-200` — confirmed/withdrawn address, durable, scoped to Opportunity | **REUSE** |
| ARV | `opportunity.arv_after_repair_value`, approval writer `setApprovedArv`, inert-proofed — per B8-02 (`BOARD8_ECONOMICS_INVENTORY_V1.md` "ARV" row) | **REUSE** |
| Repairs | `contact.estimated_repairs`, writer `setEstimatedRepairs` — per B8-02 ("Repairs" row) | **REUSE** |
| Transaction structure, closing/possession *description*, title complications *description* | `TransactionAssumptions` carrier, `seller-call-readiness-carriers.ts:202-277` — three free-text fields, each either a real value or an explicit "none" marker (never blank), durable, per-Opportunity | **REUSE**, but only as unstructured prose — no structured closing **date**, no structured possession **terms** (e.g. days-after-closing), no structured title-complication *amounts* |
| Legal owners, closing timeline, occupancy/possession, liens/title, delivery/signing — *confirmation* | `ContractReadyItems` (`CONTRACT_READY_ITEM_KEYS`, `seller-call-readiness-carriers.ts:902-903`) — **five booleans**: `legal_owners`, `closing_timeline`, `occupancy_possession`, `liens_title`, `delivery_signing` | **RENAME/PRESENTATION-ONLY at best for the confirmation act itself** (REUSE of the *fact that someone confirmed it*) — but **REAL CARRIER GAP for the underlying data**: confirming `legal_owners: true` records only that the operator attests owners are correct, not who they are; `closing_timeline: true` records nothing about *what* the timeline is; same for the other three. Confirmed by reading the full carrier (`formatContractReadyChecklistNote`, lines 919-938): the note body carries `at`, `operator`, `opportunityId`, `agreementAt`, `agreedPrice`, `propertyAddress`, and the five booleans — **no free-text or structured value for any of the five items themselves** |
| Access (property access arrangements) | **None found.** No carrier, no custom field (per item 5's field search), no mention in any carrier module | **REAL CARRIER GAP, verified absent** |
| Photo/document (contract-relevant photos or documents, distinct from ARV comp evidence) | **None found for contract purposes.** `ArvCompsWorkspace.tsx` and PropStream comp handling exist but are ARV *evidence*, not contract-execution documents; no GHL Documents/media capability is reachable per item 5 | **REAL CARRIER GAP, verified absent** |
| Closing date (structured) | **None found.** Only a free-text "Closing/possession expectations" description exists (Transaction Assumptions, above); no DATE-typed field or carrier holds an actual closing date | **REAL CARRIER GAP** |
| Earnest money | **None found** — no custom field (item 5), no carrier | **REAL CARRIER GAP, verified absent** |
| Contingencies | **None found** — no custom field, no carrier; `SELLER_ACQUISITION_WORKFLOW.md`'s "Agreement and contract readiness" list (line 171) names "contingencies / access" as items IAOS should check, but no mechanism does | **REAL CARRIER GAP, verified absent** |
| Owner/signing authority (names, roles, POA/trustee status) | `Owner 2 First/Last Name` fields exist (item 5) for a plain second name; **nothing captures signing *authority*** (whether a listed owner has POA, is a trustee, is deceased-with-estate, etc.) | **REAL CARRIER GAP** |
| Signer delivery (how/where signing documents reach each signer) | **None found** — this is inherently downstream of choosing an e-sign provider (item 8); no IAOS carrier could reuse anything here even in principle yet | **REAL CARRIER GAP, blocked on item 8 as well as a carrier decision** |

### 8. E-sign providers realistically usable for V1

**GHL-first reframing, per Brad's direction (INV-57 Linear comment,
2026-09-09, "Brad's GHL-first direction"). This supersedes the broad
external-provider-comparison framing of the prior two passes.** HighLevel's
own native "Documents & Contracts" feature is now the **preferred V1
candidate**. External providers (DocuSign, PandaDoc, Adobe Acrobat Sign,
Dropbox Sign) are retained below as **fallback-tier findings only** — kept
for reference, not the comparison's center of gravity, and not resumed as
a broad multi-provider grid by default. A fetch failure, a proxy 403, or
this session's tooling limitation is **never** reported as evidence GHL
lacks a capability; where GHL genuinely can't do something, that is
stated precisely as UNSUPPORTED, distinct from BLOCKED (a real,
named restriction prevented verification) and from a bare fetch failure.

**Official sources fetched and cited directly, per Brad's provided
list:**
- `marketplace.gohighlevel.com/docs/ghl/proposals/send-documents-contracts-template/` — the Send Template API reference.
- `marketplace.gohighlevel.com/docs/ghl/proposals/list-documents-contracts/` — the List Documents API reference.
- `help.gohighlevel.com/support/solutions/articles/155000004039-documents-contracts-templates-with-opportunity-custom-values` — the Opportunity-merge help article.
- `help.gohighlevel.com/support/solutions/articles/155000000594` — the general Documents & Contracts feature guide.

#### Correction to log explicitly: provider/envelope metadata preservation

An earlier Jess carrier recommendation (surfaced only in this session's
working discussion, not committed to this document before now) suggested
provider/envelope metadata could be left provider-owned. **Brad's
correction: it must not be.** `docs/SELLER_CONTRACT_STATE_MACHINE_V1.md`'s
Under Contract entry evidence already locks a requirement for the
provider/envelope identifier, completion time, contract version, and
integrity identifier to be preserved as part of "GHL as the sole system
of record" (that document, "GHL as the sole system of record" section).
**What this correction changes:** that requirement now points
specifically at **GHL-native storage of this metadata** — e.g., as a GHL
note, or as a field of GHL's own Documents & Contracts record itself
(`documentId`, `documentRevision`, `updatedAt`, `isExpired`, per the List
Documents response fields below) — **not** at the third-party e-sign
provider's own separate servers as the authoritative copy, and **not**
at a new IAOS-side (non-GHL) carrier, which remains unauthorized by this
document exactly as before. This is a genuine fit with GHL-native
Documents & Contracts specifically: its own List Documents response
already carries several of the required fields natively (see item 9
below), which a third-party provider integration would not automatically
place inside GHL's own system of record without IAOS building an
explicit copy step.

**Second correction, do not over-read the first one (Brad, 2026-09-09):**
this document does not conclude that GHL-native fields are *sufficient*
on their own. Item 9 below already finds three of four required fields
DOCUMENTED but the fourth — a discrete integrity identifier — BLOCKED,
not confirmed to exist natively. **If native fields prove insufficient,
a future GHL-facing carrier may still be required** — meaning IAOS
writing additional evidence INTO GHL (for example, a structured GHL note
recording a computed integrity hash, mirroring the existing note-ledger
pattern this codebase already uses for other durable facts), not a
carrier that stores the authoritative copy outside GHL. That possibility
is not ruled out here. **No such carrier is authorized during this
inventory** — this correction only prevents the document from
prematurely closing the question in either direction.

#### Ten-point verification

Each tagged **DOCUMENTED** (found in the official docs above),
**ACCOUNT-VERIFIED** (checked against this Test account directly),
**BLOCKED** (a specific, named restriction prevented verification), or
**UNSUPPORTED** (GHL itself, per its own docs or a verified account
check, does not offer this) — never blurred.

**1. Account access, permissions, entitlements, and any additional cost
for Documents & Contracts on this GHL plan/location.**
**BLOCKED.** No GHL direct-login credential exists anywhere in this
session's available memory (`grep -rli` across every memory file for
login/password/username/web-UI references found only an unrelated deep-
link URL pattern in `project_dashboard_build_status.md`, not a
credential) — per this correction's own instruction, no login was
attempted without confidence it is Test-scoped. None of the four fetched
official docs states a plan tier, permission level, or cost either (each
explicitly: send-template doc "contains no mention of plan requirements
or specific permissions needed"; the general feature guide "does not
address feature availability by plan tier... or cost information").
BLOCKED, not UNSUPPORTED — this is an access limitation, not a documented
or verified absence of the feature.

**2. Template discovery and required signer roles as GHL's own feature
models them.**
**DOCUMENTED.** The general feature guide (155000000594) states Documents
& Contracts "supports multiple recipients with configurable signing
order (sequential or simultaneous)" and lets an operator assign "specific
fields (e.g., signature, initials)" to each signer. The Opportunity
custom-values article (155000004039) separately documents **multi-role
templates**: "Assign at least one fillable element to Contact before
using the template in a workflow. Role details entered in the workflow
override the corresponding template defaults." Template *discovery*
(browsing/listing available templates) itself is not covered by any of
the four fetched pages — this narrower sub-point is **BLOCKED** (no
account access to the template library), while signer-role modeling
itself is DOCUMENTED.

**3. Exact Opportunity binding — including whether two separate deals
for the same contact are each bound to their own distinct document.**
**DOCUMENTED, partially, with the gap named precisely.** The Send
Template API (`POST /proposals/templates/send`) takes `contactId` as
**required** and `opportunityId` as **optional, not required**. This is
the API-level binding mechanism, documented directly from the endpoint's
own parameter list — distinct from, and not to be conflated with, the
Opportunity custom-values *workflow* action (item below), which is a
separate mechanism. Because `opportunityId` is optional rather than
required, nothing in the documented API itself *enforces* that two
distinct deals for the same contact each produce a distinct, correctly-
attributed document — that enforcement, if needed, would be IAOS's own
responsibility to apply (always pass `opportunityId`) rather than a GHL
guarantee. Whether the List Documents response actually echoes back an
`opportunityId` field for a sent document (needed to filter/attribute
documents per deal on read-back) was **not confirmed** in the fetched
List Documents excerpt, which named `documentId`, `_id`, `locationId`,
`status`, `paymentStatus`, `documentRevision`, `recipients`, `updatedAt`,
`grandTotal`, `type`, `name`, `deleted`, `isExpired`, `locale` — no
`opportunityId` or `contactId` among them. **BLOCKED** for confirming
this specific read-back field without an account-level test (item 4 of
the minimal proof plan below would resolve it directly).

**4. Draft generation without sending — API support distinguished from
workflow-only support.**
**DOCUMENTED, partially, with the two mechanisms kept separate as
directed.** The List Documents response's own `status` field includes
`"draft"` as one of its documented values (alongside `"sent"`,
`"viewed"`, `"completed"`, `"accepted"`) — confirming a draft *concept*
exists natively in GHL's data model. The Send Template API's own
documented request body includes a `sendDocument` boolean parameter,
but "its specific behavior isn't detailed in this excerpt" — so whether
`sendDocument: false` is the mechanism that produces a `"draft"`-status
document without transmitting it is **not confirmed** from what was
fetched; the endpoint's own description reads "Send template to a
client," and the fetched excerpt states "no draft mode is documented" at
the description level even though the `draft` status value and the
`sendDocument` parameter both exist. **Kept explicitly separate, per this
correction's own instruction:** the Opportunity custom-values article
describes only the **workflow action** ("Send Documents & Contracts")
merging Opportunity fields — "the feature operates exclusively through
the ... workflow action" per that article — which is a different claim
from the API's own `opportunityId` parameter above and does not, by
itself, prove the API endpoint shares the same Opportunity-merge
capability. **BLOCKED** for confirming `sendDocument`'s exact semantics
without an account-level test call.

**5. Review and authorization bound to the exact document version.**
**BLOCKED — not addressed in any fetched document, and no account access
to test it.** The Opportunity custom-values article's silence on what
happens if underlying Opportunity data changes after generation is the
closest available signal, and it is silence, not a stated guarantee —
this document does not infer a "static snapshot" behavior from that
silence as a documented fact. Per `docs/SELLER_CONTRACT_STATE_MACHINE_
V1.md`'s own already-locked design, this is exactly the kind of
guarantee IAOS's own verification logic (INV-58's job) should enforce
regardless of what GHL does internally — this document does not treat a
future GHL behavior as a substitute for that enforcement.

**6. A confirmed transmission identifier and timestamp, and an explicit,
settable expiration.**
**DOCUMENTED, partially.** `documentId` (identifier) and `updatedAt`
(timestamp) are both real, named fields in the List Documents response —
though `updatedAt` is a generic last-modified timestamp, not explicitly
labeled a "sent at" timestamp in the fetched excerpt. An `isExpired`
boolean is also a documented **read** field, confirming expiration is
tracked as a concept — but the Send Template API's own documented
request body, per the same fetch, contains **no expiration/expiry
parameter**: "No expiration or expiry parameters are mentioned in the
documented request body." So expiration is DOCUMENTED as a tracked
*read-side* concept, and **BLOCKED** (not UNSUPPORTED — the docs simply
don't cover it in this excerpt) for whether it is settable at send time
via this specific endpoint, versus configured elsewhere (a template
default, an account setting) not visible in what was fetched.

**7. Every required signer's own execution evidence, not just an
aggregate flag.**
**DOCUMENTED.** The List Documents response's `recipients` array carries
a **per-recipient** `hasCompleted` boolean, `signingOrder`, `role`,
`email`, and `contactName` — not a single aggregate flag. The general
feature guide corroborates this independently: a document stays in
"Waiting for others" status until "every required signer finishes," and
e-signature certificates record "signer details, IP address, and
timestamps" per signer.

**8. GHL's own provider-side completion signal distinguishable from a
human manually clicking "Mark as Completed."**
**BLOCKED for a direct guarantee; DOCUMENTED for corroborating design
intent.** No fetched page states outright that "Completed" status cannot
be manually set by an operator independent of actual signer completion.
The general feature guide's own framing — a document remains "Waiting
for others" until every required signer finishes, with completion status
appearing to be a consequence of per-signer `hasCompleted` flags rather
than a described manual toggle — is corroborating design intent, not a
verified guarantee. Per B9-01's own locked requirement ("the provider
reports completion" as one of three jointly-required facts, never a
human "mark as complete" substitute), this document does not accept
design-intent inference as proof; **BLOCKED**, pending either further
official documentation stating this explicitly or an account-level test.

**9. Durable executed-document/audit preservation, or a verified
GHL-native authoritative reference, carrying an identifier, completion
time, contract version, and integrity identifier.**
**DOCUMENTED, partially.** Identifier: `documentId` / `_id` (List
Documents). Completion time: `updatedAt` (generic, not completion-
specific — see item 6's same caveat). Contract version: `documentRevision`
is a real, named field. Integrity identifier: the general feature guide
documents "e-signature certificates with audit trails recording signer
details, IP address, and timestamps" — a real audit-trail mechanism
exists, but no fetched page names a specific hash/checksum-shaped
"integrity identifier" field distinct from the certificate concept
itself. **DOCUMENTED** for three of the four required fields
(identifier, version, an audit-trail mechanism); **BLOCKED** for
confirming whether that audit trail exposes a discrete integrity
identifier in the shape B9-01 requires, versus needing IAOS to derive
one (e.g., hashing the retrieved document) itself.

**10. Fail-closed behavior: partial signatures, missing preservation,
duplicate events, and a stale/superseded version cannot create Under
Contract, even in principle.**
**BLOCKED for what GHL itself guarantees internally — and, per B9-01's
own already-locked architecture, this is not solely GHL's guarantee to
make.** No fetched page addresses GHL's own internal fail-closed
behavior. `docs/SELLER_CONTRACT_STATE_MACHINE_V1.md`'s own design already
places this requirement on **IAOS's own read/verification logic**
(Under Contract's "Failure behavior": "Any of the three facts missing,
ambiguous, or unconfirmed must never read as Under Contract — fail
closed... exactly as this codebase already does everywhere a durable
state gates downstream authority") — not on trusting any provider,
GHL included, to enforce it unassisted. This document states plainly:
unverified whether GHL enforces this internally, and unnecessary to
verify for B9-01's own guarantee to hold, since that guarantee is
IAOS-side by design regardless of provider.

#### Recommended integration split — Jess's recommendation, NOT YET ACCOUNT-PROVEN

Recorded here as a recommendation under active consideration, explicitly
**not settled, not decided, and not proven against this or any real GHL
account** — none of the ten items above reaches ACCOUNT-VERIFIED, and
this split is not implemented by this document:

- **IAOS handles:** readiness, agreement/version identity, Brad's
  explicit authorization, signing-progress tracking, execution
  verification.
- **GHL handles:** templates, document rendering, signing, native
  document management.
- **Prefer opening the exact GHL draft/document for human review via a
  verified link** over IAOS building its own editor.
- **Avoid duplicate entry and competing sources of deal data** — GHL
  should be the one place data lives; IAOS reads and verifies, it does
  not re-enter or shadow-copy (consistent with FOUNDATIONAL_PRINCIPLES
  principle 15, already cited throughout this document).

This recommendation does not authorize any implementation, and INV-58
should treat it as a starting hypothesis to validate against the
BLOCKED items above, not as a locked design.

#### Minimal Test-setup/proof plan — a PROPOSAL only, not executed this round

If genuinely resolving the BLOCKED items above requires creating
something in Test GHL, this is the smallest plan that would do it —
**proposed for separate approval, no part executed this round.**

**Sanctioned access methods actually checked, for the record (no
password searched for or exposed):** two, and only two, were checked.
(1) IAOS's own app-level GHL proxy (`app/netlify/functions/ghl-proxy.ts`,
using the Test API token already configured in `.env.test`) — this is
the same sanctioned path the application itself uses, and it is what
every live finding elsewhere in this document was read through. (2) A
search of this session's memory files
(`C:\Users\brad\.claude\projects\C--Users-brad-investor-automation-os\
memory\`) for whether a *separate* GHL direct-web-login credential is
recorded there at all — a check for the **existence of a credential
reference**, not a search for or display of any password value. None
was found. **No GHL web UI login was attempted.** Neither method reaches
account-level facts like plan tier, billing, or the template library —
that gap is why item 1 and several others below are BLOCKED, not
ACCOUNT-VERIFIED.

- **Exact Test location:** `SoTgVoaFGHtBdRFvXWQV` (already the location
  used throughout this document's live GHL calls). **Confirmed.**
- **Template ID:** **unconfirmed.** No template ID is named because none
  is known — whether this Test account has a built-in sample/demo
  template at all is unverified (item 1/2 above; no account access).
  Creating a new template is itself a write this round does not
  authorize. A real template ID must come from Brad's own account check
  before any send-template call could even be attempted.
- **Contact ID:** `NAGtUZ9aOE5C1GatJzpT` ("IAOS Underwriting Test") —
  **confirmed**, reused from prior live proofs this session rather than
  creating a new record.
- **Opportunity ID:** **unconfirmed in this document.** The contact above
  has an associated Opportunity from prior session work, but this
  document does not state its ID from memory or assumption — confirming
  it would require one additional read-only `GET /opportunities/search`
  call (already an allowlisted path, no proxy change needed) at
  execution time, not a new write.
- **Controlled test recipient:** **unconfirmed — no exact address
  named.** Proposed only as "a throwaway or Brad-controlled email
  address, never a real seller's contact information." Brad must supply
  or approve the specific address before any send.
- **Permissions needed:** whatever GHL plan/scope gates Documents &
  Contracts for this location — unverified (item 1 above), unknown until
  Brad's own account access confirms it.

**Draft creation and sending are two distinct, sequential steps — neither
executed by this document, and step B is never taken without step A's
result reviewed first:**

- **Step A — draft only, no transmission.** One `POST /proposals/
  templates/send` call with `sendDocument: false`, `contactId` and
  `opportunityId` both passed explicitly (to test item 3's binding),
  targeting the controlled test recipient only. Purpose: resolve item
  4's draft-vs-send semantics without transmitting anything to the
  recipient.
- **Step B — actual send, only after Step A is reviewed and separately
  approved.** The same call with `sendDocument: true`. Purpose: resolve
  items 3 (Opportunity attribution on read-back) and 6 (transmission
  evidence, below).
- Both steps use the exact same documented endpoint: **`POST /proposals/
  templates/send`** (confirmed directly from the endpoint reference this
  session: required body — `templateId`, `userId`, `locationId`,
  `contactId`; optional — `opportunityId`, `sendDocument`).

**Exact evidence proposed for each remaining BLOCKED item — `updatedAt`
is not proposed as a substitute for transmission or completion time
anywhere below:**

- **Transmission time.** GHL's own List Documents response does not name
  a distinct "sent at" field — only the generic `updatedAt`. Proposed
  evidence instead: **the wall-clock timestamp IAOS itself records at
  the moment Step B's `POST /proposals/templates/send` call returns
  successfully** — a fact IAOS directly observes and controls, not one
  read back from GHL after the fact. This is the same pattern already
  locked in `docs/SELLER_CONTRACT_STATE_MACHINE_V1.md` for Contract
  Sent's own "confirmed provider transmission identifier and timestamp"
  — the identifier comes from GHL (`documentId`), the timestamp is
  IAOS's own observation of the send, not a GHL-reported field.
- **Completion time.** Same reasoning: proposed evidence is **the
  timestamp IAOS itself records the moment a `GET /proposals/document`
  read-back first observes every required recipient's `hasCompleted`
  true**, not `updatedAt` (confirmed generic, not completion-specific,
  per item 6/9 above). Whether GHL additionally exposes a webhook or a
  per-signer completion timestamp of its own is **unconfirmed** — the
  four fetched docs did not cover a webhook/event mechanism for
  Documents & Contracts at all; this is a real gap in what was fetched,
  not assumed absent.
- **All required signatures.** Already DOCUMENTED (item 7): the
  `recipients[].hasCompleted` per-recipient boolean, read via `GET
  /proposals/document`. Proposed evidence: the full `recipients` array
  from that read-back, not a single aggregate flag.
- **Executed PDF retrieval.** **Unconfirmed — a real gap.** None of the
  four fetched official docs names a specific document-download/export
  endpoint for Documents & Contracts (unlike, for example, Dropbox
  Sign's named file-retrieval endpoints in the fallback-tier findings
  below). Proposed evidence: whatever `GET /proposals/document` itself
  returns for a completed document (it may embed a file URL or require a
  separate call not yet identified) — this specific sub-question is
  exactly what Step B plus a completed signature would resolve, and this
  document does not assume a mechanism that hasn't been confirmed to
  exist.
- **Integrity.** Already found BLOCKED at item 9: no discrete
  hash/checksum-shaped field was named in what was fetched. Proposed
  evidence, in order of preference: (1) if the account-level check
  surfaces a GHL-native integrity field not visible in the four fetched
  docs, use it; (2) failing that, **IAOS computes its own integrity
  identifier** (a hash of the retrieved executed-document bytes) at the
  moment of retrieval and records it alongside the other evidence — per
  the correction above, this may mean writing that computed value into a
  GHL-native record (a structured note), not a non-GHL carrier, and no
  such write is authorized by this document.

**You-vs-Brad split:** **Brad-only** — verifying/granting Documents &
Contracts plan access, any billing implication, and his own GHL web
login for any account-level UI check (Settings, template library, exact
template ID). **Executable once separately authorized** — the
Opportunity-ID lookup, and Steps A and B above, once a template ID and
confirmed access exist.

**The smallest proposed Test-only proxy change, if this plan is
approved — not implemented, not bypassed, this round:**

Exactly two new allowlist entries in `app/netlify/functions/
ghl-proxy.ts`'s existing `ALLOW` object (lines 59-77), confirmed against
the actual endpoint references fetched this session:
- `POST`: `^/proposals/templates/send$`
- `GET`: `^/proposals/document$` (this endpoint's own documented required
  query parameter is `locationId`; it also requires a `Version: v3`
  request header, confirmed directly from its reference page this
  session — narrower than most other entries in the existing GET list,
  which do not carry a version-header requirement, so the proxy's
  request-building code would need to attach that header specifically
  for this path, not just the path pattern).

No third path is proposed — the Opportunity-ID lookup step above reuses
the already-allowlisted `GET /opportunities/search`. This is the entire
proxy change this plan would need; nothing else in `ghl-proxy.ts` is
touched, and this document does not implement it.

#### Fallback-tier findings — external providers, kept for reference only

**Not the comparison's center of gravity. Retained, not removed, exactly
as directed.** These are the real, cited findings already established in
prior passes, unchanged, presented now explicitly as fallback evidence
should GHL-native prove insufficient on a specific, *proven* (not merely
unreached) capability:

| Provider | Templates | API/integration | Signer experience | Completion signal | Executed-document retrieval | Correction/void | Cost | GHL compatibility |
|---|---|---|---|---|---|---|---|---|
| **DocuSign** | OBSERVED referenced ("Request Signatures & Automate Forms") but the fetched overview page carried only a title, no body detail this session | UNKNOWN in detail this session — the Connect/webhooks doc page and the envelope-void reference page both returned HTTP 404 on retry this session | UNKNOWN — not reached this session | UNKNOWN — both retry attempts (Connect/webhooks concepts page, envelope-void reference page) returned HTTP 404 this session, not merely title-only | UNKNOWN — not reached this session | UNKNOWN — the envelope-void reference URL fetched this session returned HTTP 404; whether/how void applies to completed vs. in-progress envelopes remains unretrieved | **OBSERVED** (`ecom.docusign.com/plans-and-pricing/esignature`, fetched this session): Personal $11/mo, Standard $30/user/mo, Business Pro $45/user/mo, Enhanced = custom pricing; the page states API access ("Industry-leading APIs") and a developer account are included on every tier, Personal through Enhanced | UNKNOWN — not retrieved this session |
| **Dropbox Sign (HelloSign)** | OBSERVED (`developers.hellosign.com/docs/overview`, fetched): "use templates created on Dropbox Sign website" on the Essentials plan, with "premium template endpoints" referenced for higher tiers — no further detail retrieved | OBSERVED partially: file-retrieval endpoints named (`signature_request/files`, `signature_request/files_as_data_uri`, `signature_request/files_as_file_url`) at different subscription levels, but their exact behavior was not in the fetched content | UNKNOWN — not addressed in fetched content | UNKNOWN — the fetched overview page did not discuss webhook event types; a follow-up fetch of the cancellation-endpoint reference page also did not surface event-type documentation | **OBSERVED, partial**: the three file-retrieval endpoint names above exist, per the same overview page; their response shape was not retrieved | **OBSERVED** (`developers.hellosign.com/api/reference/.../signatureRequestCancel`, fetched): a `/signature_request/cancel/{signature_request_id}` endpoint exists; the docs state it "cancels an incomplete signature request. This action is not reversible," and explicitly only works on **incomplete** requests — a completed request cannot be canceled through this endpoint | UNKNOWN — pricing page not reached this session | UNKNOWN — not retrieved this session |
| **PandaDoc** | OBSERVED (`developers.pandadoc.com/reference/about`, fetched): "Create from template" is listed as a core getting-started capability | OBSERVED, minimal: a guide titled "Listening for changes in document status" is referenced, plus a full webhook event list obtained separately below | UNKNOWN — not addressed in fetched content | **OBSERVED** (`developers.pandadoc.com/reference/webhooks-overview`, fetched this session): the full event list includes `document_state_changed`, `document_completed_pdf_ready` (explicitly "when document completes and PDF is ready"), `recipient_completed`, `document_updated`, `document_creation_failed`, `document_deleted`, `document_section_added`, `quote_updated`, `template_created`, `template_updated`, `template_deleted`. Payloads are de-duplicated via an `X-PandaDoc-Webhook-Event-Id` header, per the page; the exact payload body schema was not retrieved (the page points to a separate full guide at `developers.pandadoc.com/docs/webhooks` for that, not fetched this session) | UNKNOWN — not addressed in fetched content | UNKNOWN — not addressed in fetched content | Attempted **four times** this session across three URLs (`pandadoc.com/pricing/`, `pandadoc.com/pricing`, `support.pandadoc.com/.../pandadoc-pricing-plans`); the first two returned HTTP 429 (rate-limited) and the third returned HTTP 404 — **not obtained**, a persistent tooling/rate-limit issue this session, not evidence of absence | UNKNOWN — not retrieved this session |
| **Adobe Acrobat Sign** | UNKNOWN — the specific overview URL fetched returned HTTP 404 this session | UNKNOWN, same reason | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN — not reached | UNKNOWN — not retrieved this session |

**GHL-marketplace compatibility with these providers remains UNKNOWN,
for a stated tooling reason, not a documented absence:**
`marketplace.gohighlevel.com/` and two more specific guessed URLs were
each fetched three separate times this session; every attempt returned
only the page-title shell ("App Marketplace \| CRM Apps & Integrations")
with no listing content — a client-rendered single-page app this
session's fetch tool cannot execute JavaScript for. This is explicitly
**not** reported as GHL lacking third-party integrations — it is
UNKNOWN, tooling-blocked, exactly as directed.

**No provider is recommended, ranked, or selected.** This issue's HARD NO
on provider selection by developer preference is honored: GHL-native is
named *preferred* per Brad's own direction, not selected by developer
preference, and the fallback tier above remains unranked among itself.

### 9. Actual first-market title/closing handoff expectations

**Settled, not open: no fixed title company or closing process is
required.** Per Brad's ruling recorded in the INV-57 Linear comment,
2026-09-09: the provider may vary by deal, and Brad does not require the
same provider each time. This is a plain fact this document records, not
an open question — there is no single "first-market" expectation to
discover, because the design does not fix a single market or provider.

**Classification: EXTERNAL/OPERATIONAL GAP** (reclassified from
UNRESOLVED PRODUCT/LEGAL DECISION, this correction). Searched `docs/*.md`
for anything past `docs/SELLER_ACQUISITION_WORKFLOW.md`'s existing
"Contract Readiness -- DISTINCT, DETAIL DEFERRED" framing (already cited
in item 4) and `docs/SELLER_CONTRACT_STATE_MACHINE_V1.md`'s Contract
Execution Details/Closing Ready split — no additional document describes
title/closing handoff mechanics, corroborating Brad's ruling independently
(there was nothing to find because no fixed process is required, not
because a decision was merely undocumented).

**Explicit design constraint for downstream work (B9-03 / INV-58):**
per-deal title/closing-provider variability must be preserved. INV-58
must not assume a single fixed title company, closing agent, or process
— any handoff mechanism it designs must accommodate a different
provider on every deal, not hardcode or default to one.

---

## Part B — Six-way classification summary

| # | Area | Classification(s) |
|---|---|---|
| 1 | Approved template candidate(s) | Settled fact: none exists yet (Brad's ruling, 2026-09-09). REUSE, for a reference baseline only (TREC 20-19, not approved for live use) |
| 2 | Template fields / signer roles | REAL LOGIC GAP (mapping exercise with no template yet to map against — no product/legal decision blocks it directly) |
| 3 | Brad's current contracting workflow | Settled fact: none exists yet (Brad's ruling, 2026-09-09). EXTERNAL/OPERATIONAL GAP |
| 4 | Disclosures vs. title/closing verification | REUSE (already locked, no gap) |
| 5 | GHL stages/fields/documents/notes/workflows/API | Mixed: REUSE (stages/fields as read targets, occupancy), REAL CARRIER GAP (lien amount unused, no contract-state stage), EXTERNAL/OPERATIONAL GAP (workflows and IAOS-proxy documents-path unreachable via sanctioned proxy), UNKNOWN (opportunity-model field catalog). GHL native e-sign capability itself is superseded by item 8's DOCUMENTED/BLOCKED findings, no longer wholly UNKNOWN |
| 6 | Board #8 economics provenance/handoff | REUSE (fully covered, no gap) |
| 7 | Property/ARV/repairs/access/photo/closing-date/earnest-money/possession/contingency/owner/signer-delivery data | Mixed: REUSE (property, ARV, repairs, transaction-assumptions prose, occupancy), RENAME/PRESENTATION-ONLY (confirmation-act framing), REAL CARRIER GAP (access, photo/document, closing date, earnest money, contingencies, owner signing-authority, signer delivery — the majority of this row) |
| 8 | E-sign providers, GHL-first | GHL-native Documents & Contracts is the preferred V1 candidate per Brad's direction (not yet ACCOUNT-VERIFIED). Ten-point verification: DOCUMENTED (2, 3 partial, 4 partial, 6 partial, 7, 9 partial), BLOCKED (1, 3's read-back sub-point, 4's `sendDocument` semantics, 5, 6's settability sub-point, 8, 9's integrity-identifier sub-point, 10). Zero items UNSUPPORTED. External providers retained as unranked fallback-tier findings only; no provider selected |
| 9 | First-market title/closing handoff expectations | Settled fact: no fixed provider required, may vary by deal (Brad's ruling, 2026-09-09). EXTERNAL/OPERATIONAL GAP |

---

## Settled facts (Brad's ruling, INV-57 Linear comment, 2026-09-09 — not open questions)

1. **No approved or current purchase agreement exists yet** (item 1). A
   real, publicly verifiable reference baseline — TREC Form 20-19, "One
   to Four Family Residential Contract (Resale)" — is cited for
   architecture purposes only; it is explicitly not approved for live
   use, and Texas attorney review is required before any live use of any
   agreement.
2. **No current contracting workflow exists yet** (item 3). Designing the
   future workflow remains out of scope for INV-57.
3. **No fixed title company or closing process is required** (item 9);
   the provider may vary by deal. This is now an explicit design
   constraint for INV-58: it must not assume a single fixed title/closing
   provider or process.

## Unresolved Product/Legal decisions (for Brad, not decided here)

1. **Which categories of contract data (item 7's gaps) actually need a
   durable IAOS carrier versus living entirely inside the chosen
   template/provider** — this document inventories what's missing; it
   does not decide what IAOS must capture versus what the e-sign
   provider's own form fields capture instead. This remains genuinely
   open and is not resolved by any of Brad's three settled facts above.

## External/operational gaps (not product decisions — verification/tooling work)

- **No current contracting workflow exists to observe** (item 3,
  settled above) — nothing to reconcile until one exists; not this
  issue's job to design it.
- **No fixed title/closing provider or process exists to characterize**
  (item 9, settled above) — per-deal variability is now a locked design
  constraint for INV-58, not a fact this document could have discovered
  by more searching.
- **Workflow inventory for the Test location** is unreachable through
  IAOS's sanctioned proxy (no allowlist entry); Production's own
  inventory is out of scope this round.
- **GHL Documents & Contracts account-level verification (item 8,
  points 1, 3's read-back sub-point, 4's `sendDocument` semantics, 5, 6's
  settability sub-point, 8, 9's integrity-identifier sub-point, and 10)
  is BLOCKED, precisely, not UNKNOWN and not UNSUPPORTED:** no GHL
  direct-login credential exists anywhere in this session's memory
  (confirmed by an explicit grep across every memory file), so no
  account-level UI check was attempted; and `app/netlify/functions/
  ghl-proxy.ts`'s allowlist has zero entries for any `/proposals/...`
  path, so even a fully permission-confirmed API-level test cannot run
  through IAOS's own sanctioned proxy without a separately authorized
  allowlist change (implementation, out of scope this round). GHL's own
  official documentation itself, by contrast, **was** successfully
  fetched this round (item 8) and yielded substantial DOCUMENTED
  findings — the capability is not "unverified because unreachable
  documentation," as an earlier pass reported; it is specifically
  account-access and proxy-allowlist BLOCKED for the items documentation
  alone cannot settle.
- **The e-sign provider comparison is now fallback-tier only** (item 8) —
  GHL-native is the preferred subject per Brad's direction. The fallback
  grid's remaining UNKNOWN cells (several DocuSign dimensions, most
  Adobe Acrobat Sign dimensions, PandaDoc's cost) are due to fetch
  failures (title-only pages, 404s on retry, persistent rate-limiting on
  PandaDoc's pricing across four attempts on three URLs), not due to
  absence of public documentation. GHL-marketplace compatibility with
  these fallback providers remains UNKNOWN for a distinct, stated tooling
  reason (a client-rendered SPA this session's fetch tool cannot execute
  JavaScript for, confirmed across three separate attempts) — never
  reported as GHL lacking such integrations.
- **Opportunity-model custom field catalog** cannot be enumerated the way
  the contact-model catalog was — only currently-populated fields are
  visible via a live Opportunity read.
- **TREC Form 20-19's own field-by-field text** (item 1) could not be
  extracted from the fetched PDF this session (encoded PDF stream data,
  not readable prose) — a follow-up extraction pass is needed to cite the
  form's specific section wording, distinct from the form's identity and
  scope, which are already cited.

---

## Validation

**No executable test applies to this document**, for the same reason
none applied to B8-02: nothing here is code. Every claim above is either
a citation to a file and line number re-readable on this branch, a
citation to a locked decision section, the literal result of a live,
read-only API call captured this session (request path shown), the
literal result of a provider documentation fetch this session (URL
shown), or the literal result of a search establishing absence.

Cross-checks performed while writing, not after:
- Every GHL field id and classification in Part A item 5's table was read
  directly from a live `customFields` response this session and cross-
  checked against `app/src/lib/ghl.ts` (full method-name grep) for whether
  a reader/writer exists — none does for `Lien Amount`.
- The pipeline-stage claim was read directly from a live `/opportunities/
  pipelines` response this session, not from documentation.
- The proxy-allowlist claims (workflows, documents/invoices/proposals all
  blocked) were each independently confirmed twice: once by the literal
  403 response body from a live call, and once by reading `ghl-proxy.ts`'s
  own `ALLOW` object to confirm the absence of a matching entry.
- The `Contract Ready` checklist's boolean-only nature (item 7) was
  confirmed by reading `formatContractReadyChecklistNote` and
  `ParsedContractReadyChecklist`'s complete field list in
  `seller-call-readiness-carriers.ts`, not inferred from the item names
  alone.
- Every "verified absent" claim in items 1, 3, 7, and 9 names the exact
  search performed (grep pattern, or field-list scan) rather than
  asserting absence from silence.

No field, carrier, template, workflow, or Production record was created,
modified, activated, or written to produce this document. No provider was
selected or ranked.

---

## Scope confirmation

**No template edited or drafted.** Item 1 cites TREC Form 20-19 as a real,
externally published reference baseline — quoted from what TREC's own
page actually says, never paraphrased as if official, never declared
legally sufficient, and explicitly marked not approved for live use
pending Texas attorney review. **No legal language invented anywhere in
this document.** Items 1, 3, and 9's absences are now settled facts per
Brad's ruling rather than open questions this document guesses at; the
one remaining genuinely open item (the carrier-vs-template question,
"Unresolved Product/Legal decisions" above) is reported as open, never
filled with a plausible-sounding placeholder. **No workflow opened,
edited, or activated** — the Test location's workflow list was not even
retrievable, let alone touched. **No new GHL field, carrier, or
Production record created.** **No e-sign provider selected** — Part A
item 8 presents findings only, several explicitly incomplete, with no
ranking or recommendation; GHL-native is named *preferred* per Brad's own
direction, not selected by developer preference. **No GHL account login
was attempted** — memory was checked for credentials and none exist for
a Test-scoped web login, so account-level items are reported BLOCKED
rather than guessed. **No test template, contact, opportunity, or
send/recipient action was created or executed** — item 8's minimal
Test-setup/proof plan is a proposal only, awaiting separate approval.
**INV-58 (B9-03) is not begun**; this document is its prerequisite input
only. **No PR opened, no push performed** — this commit sits on the
local branch pending Jess Gate and Brad's explicit authorization to
proceed.
