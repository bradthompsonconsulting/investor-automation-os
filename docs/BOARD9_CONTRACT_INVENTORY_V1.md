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

#### Live Test transaction proof — executed and reported by Brad, 2026-09-09

**Provenance.** This is a real send-to-completion Documents & Contracts
cycle Brad ran directly in the GHL Test location's own web interface --
**not** through IAOS's proxy, which was not extended, and **not** an API
call this session captured live. It is recorded here as OBSERVED,
reported by Brad, a distinct provenance from the live-API-capture this
document otherwise uses throughout. It resolves several of the ten
points above from BLOCKED to ACCOUNT-VERIFIED at the capability level;
it does **not** prove IAOS can drive or read this flow itself -- see the
correction at the end of this subsection, which Brad gave explicitly
alongside the evidence.

**Evidence, as reported:**

    GHL-native document ID       6aa17c1a122ddff22b62fe82
    GHL document reference       24015F7F-1E61-41A1-9BD3-3FC7D8BBEE10
                                  (a second, distinct identifier; this
                                  document does not assert which of the
                                  two maps to the `documentId` field named
                                  in item 9 above versus some other GHL
                                  field -- neither has been cross-checked
                                  against a live `GET /proposals/document`
                                  read)
    Sent                          2026-09-09 15:43 UTC
    Seller signed                 2026-09-09 19:23 UTC
    Buyer signed                  2026-09-09 19:35 UTC
    Provider-reported completion  2026-09-09 19:35 UTC (coincides with
                                  the buyer's signature; not independently
                                  distinguished as a separate event)
    Expiration                    preserved unchanged through the cycle
                                  at 2026-09-11 10:43 (AM; timezone not
                                  restated by Brad for this figure,
                                  recorded exactly as reported rather than
                                  assumed UTC)

**Items 7 and 8, ACCOUNT-VERIFIED.** With only the seller signed, GHL
kept the document under **Waiting for others** -- the buyer's
per-recipient completion state stayed false, matching the documented
`recipients[].hasCompleted` model exactly (item 7). The second, buyer
signature **automatically** moved the document to **Completed**; no
human used "Mark as Completed." This is the direct, account-level
evidence item 8 was BLOCKED on -- GHL's own provider-side completion
signal is now confirmed distinguishable from a manual override, at
least in this observed instance.

**Item 9, ACCOUNT-VERIFIED for identifier/completion-time/version
framing, and CLARIFIED (not merely BLOCKED) for the integrity-identifier
sub-point.** The executed two-page PDF was retrievable and includes both
signatures plus GHL's own Signature Certificate. Its SHA-256, computed
and preserved outside GHL:

    e3331f06f1e8be9414d3807c707f83af49d881e5851b0949554da3f67b67c3f6

**The PDF contains no embedded cryptographic PDF signature.** This
settles the open question this document's own carrier correction above
("Second correction") left open: GHL does **not** supply a native,
discrete integrity identifier distinct from the certificate concept, and
the fallback that correction anticipated -- IAOS computing and
preserving its own hash of the retrieved bytes -- is now confirmed as
the actual required mechanism, not a hypothesis. **Per Brad's
instruction: IAOS must preserve, for every executed document, the
downloaded PDF itself, its SHA-256, the GHL document reference, the
contract version, and the provider-reported completion time.** None of
this is implemented by this document; it is recorded here as a
requirement for whichever future work (INV-58 or later) builds the
durable carrier.

**Item 10, partially ACCOUNT-VERIFIED for the specific case observed.**
A single missing signature did not create Completed status -- the
partial-signature fail-closed case held in this instance. The other
cases item 10 names (missing preservation, duplicate events, a
stale/superseded version) remain unproven by this transaction and, per
this document's existing position, are IAOS's own responsibility to
enforce regardless of what GHL guarantees internally.

**Items 1, 2 and 6, ACCOUNT-VERIFIED at the access/capability level,
still BLOCKED for the specific documentation-level sub-points named in
the original ten-point pass.** Brad both has and used Documents &
Contracts access on this Test location (item 1's access question,
though plan tier and cost remain undocumented). Real, distinguishable
seller and buyer signer roles were used (item 2's signer-role model),
though template *discovery* (browsing the library) is still
unconfirmed. A two-day expiration was set, tracked, and preserved
unchanged across the whole cycle (item 6), though whether it is
settable via the Send Template API's own documented request body --
which names no expiry parameter -- remains unconfirmed; this send did
not go through that endpoint.

**A new, previously unrecorded finding: both delivery emails were
classified as spam.** Gmail and Yahoo both routed the signer
notification emails to spam, though both were ultimately delivered. Not
addressed by anything in this document or in `SELLER_CONTRACT_STATE_
MACHINE_V1.md` today -- a real deliverability risk to a live signer
flow, recorded here rather than left to be rediscovered.

**What this proof does NOT establish -- per Brad's own instruction, not
represented as passed:**

- **Opportunity/deal binding (item 3) stays BLOCKED.** This transaction
  was not confirmed bound to a specific IAOS Opportunity via the
  documented `opportunityId` parameter or any equivalent, and whether
  the List Documents read-back actually echoes an `opportunityId`/
  `contactId` for per-deal filtering remains unconfirmed.
- **API automation stays entirely unproven.** This cycle was operated
  directly in GHL's own web interface, not through IAOS's proxy or any
  `/proposals/...` API call -- no allowlist entry was added, and none is
  added by this document. Item 4's `sendDocument` draft/send semantics
  and item 5's document/version-binding question (whether a second call
  against the same template regenerates rather than transmits the
  reviewed draft) are unaffected by this proof and remain exactly as
  BLOCKED as before.

This proof demonstrates the underlying GHL capability works and behaves
the way B9-01 requires **when operated directly by a human with account
access.** It does not demonstrate that IAOS itself can trigger, bind, or
read this flow programmatically -- that remains INV-58's open question,
not this document's to close.

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

**Superseded in part, 2026-09-09.** The Live Test transaction proof
above resolves items 7, 8 and 9's core BLOCKED status -- and the
access-level parts of items 1, 2 and 6 -- without executing any part of
the plan below. This plan remains relevant only if and when INV-58
needs IAOS itself to drive or read this flow via API; it is not
required merely to establish that GHL's capability works, which the
proof above already does. Nothing below this note has changed: still
not implemented, still requires its own separate authorization if
pursued.

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
- **Sender `userId`** (required by the Send Template endpoint's own
  documented request body): **unconfirmed.** No GHL user id is named —
  this must be a real user id on this Test location (most plausibly
  Brad's own), obtained the same way the template ID is: Brad's own
  account check, not assumed here.
- **Contact ID:** `NAGtUZ9aOE5C1GatJzpT` ("IAOS Underwriting Test") —
  **confirmed**, reused from prior live proofs this session rather than
  creating a new record.
- **Opportunity ID:** `MAl1FWHEsK0QqsXt4v6f` — **confirmed live this
  session**, via `GET /opportunities/search` (already allowlisted,
  read-only, no proxy change needed): the single opportunity returned
  for this contact, named "IAOS Underwriting Test," `pipelineId
  wdvKMdPMxs38qoA6lkUa` (the Test location's own Seller Leads Pipeline,
  confirming this read ran against Test — matching `TEST.pipelines.
  sellerLeads` in `app/shared/ghl-config.ts`, not `PRODUCTION`'s
  differently-valued pipeline id).
- **Every signer/CC recipient — controlled and confirmed before any
  eventual transmission, not just a single "the recipient":** the Send
  Template endpoint's own documented model supports multiple recipients
  with roles and signing order (item 2 above). This plan does not name a
  fixed count or exact addresses — every recipient/role passed in Step B
  must be an explicit, Brad-approved, non-real address, confirmed
  individually before that call, not assumed to be "one recipient" by
  default. **Unconfirmed — no exact address(es) named.**
- **Permissions needed:** whatever GHL plan/scope gates Documents &
  Contracts for this location — unverified (item 1 above), unknown until
  Brad's own account access confirms it.

**Draft creation and sending are two distinct, sequential steps — neither
executed by this document. Step B does not assume it transmits the exact
document reviewed in Step A; that binding is itself unverified, per the
correction below, and must be resolved before Step B is treated as safe
to run at all:**

- **Step A — draft only, no transmission.** One `POST /proposals/
  templates/send` call with `sendDocument: false`, `templateId`,
  `userId`, `locationId`, `contactId`, and `opportunityId` all passed
  explicitly. Purpose: resolve item 4's draft-vs-send semantics without
  transmitting anything to any recipient.
- **Existing-document send mechanism and document/version binding —
  UNVERIFIED, and this is a real, load-bearing gap, not a formality.**
  The Send Template endpoint's own documented request body (confirmed
  this session) takes `templateId`, not `documentId` — there is no
  documented parameter for referencing an already-created document by
  its own id. This means it is **not confirmed** that calling this same
  endpoint again (with `sendDocument: true`) would transmit *the specific
  draft created in Step A* — the documented shape is at least equally
  consistent with each call **generating a fresh document/version from
  the template**, independent of any prior call. No endpoint for
  finalizing/transmitting a pre-existing document by id was found in
  what this session could fetch (a targeted attempt to enumerate the
  full proposals endpoint list returned only a page-title shell, the
  same SPA-rendering limitation encountered elsewhere in this document —
  a tooling gap, not evidence such an endpoint doesn't exist).
- **If Step B in fact generates a replacement document/version rather
  than sending Step A's exact draft, that replacement requires its own
  fresh review before any authorization is treated as covering it** —
  per `docs/SELLER_CONTRACT_STATE_MACHINE_V1.md`'s own already-locked
  principle that a subsequent seller-facing change invalidates a prior
  authorization, extended here to document/version regeneration, not
  only content edits. **Step B is therefore not proposed as an automatic
  next action after Step A.** The correct sequence, if this plan is
  approved, is: run Step A; read back its result via `GET /proposals/
  document` and confirm from the live response (not assumed) whether the
  draft and any subsequent send would in fact share one document
  identity; only then decide whether Step B as designed is safe, or
  whether a different mechanism is required to send the exact reviewed
  draft.

**Provider-side event timestamps are not proposed as available, and
IAOS's own observation times are not proposed as a substitute for
them — this corrects the prior version of this plan, which claimed a
timestamp-substitution consistent with B9-01. That claim is withdrawn:**

- **Transmission time.** GHL's own List Documents response names no
  distinct "sent at" field — only the generic `updatedAt`. The prior
  version of this plan proposed IAOS's own API-response-receipt
  timestamp as standing in for the provider's transmission time and
  asserted this matched `docs/SELLER_CONTRACT_STATE_MACHINE_V1.md`'s
  design. **Both claims are withdrawn.** An HTTP response returning to
  IAOS is not the same fact as when GHL itself dispatched the document
  to the recipient — those can differ (queueing, retries, async
  processing), and nothing fetched this session establishes they
  coincide. **The provider's own transmission time is left explicitly
  unverified** until a supporting field or account-level check
  establishes one; this plan does not propose IAOS's receipt time as a
  filled-in substitute.
- **Completion time.** Same correction. The prior version proposed "the
  timestamp IAOS itself records the moment a read-back first observes
  `hasCompleted` true" as completion-time evidence. **Withdrawn as a
  substitute for the provider's own completion time** — a first-observed
  polling result reflects when IAOS happened to look, not when the
  provider recorded execution; those can differ by however long the
  interval between IAOS's calls was. Whether GHL exposes a webhook or a
  per-signer completion timestamp of its own remains **unconfirmed** —
  the four fetched docs did not cover a webhook/event mechanism for
  Documents & Contracts at all, a real gap in what was fetched, not
  assumed absent. **The provider's own completion time is left
  explicitly unverified** until such evidence is found.
- **All required signatures.** Unaffected by the correction above —
  already DOCUMENTED (item 7): the `recipients[].hasCompleted` per-
  recipient boolean, read via `GET /proposals/document`. Proposed
  evidence: the full `recipients` array from that read-back, not a
  single aggregate flag, and not a timestamp claim.
- **Executed PDF retrieval — explicitly unverified, unchanged.** No
  document-download/export endpoint was named in what was fetched. Not
  assumed to exist; would need to be identified during any approved
  test, not designed around here.
- **Integrity — explicitly unverified, unchanged.** No discrete
  hash/checksum-shaped field was named in what was fetched (item 9).
  If an approved test does not surface one natively, IAOS computing its
  own hash of the retrieved bytes remains the only proposed fallback —
  itself unverified until attempted, and, per the carrier correction
  above, written into GHL-native storage if pursued at all, never a
  non-GHL carrier, and no such write is authorized by this document.
- **Manual-completion detection — explicitly unverified, unchanged.**
  Item 8 remains BLOCKED: no fetched page states that "Completed" status
  cannot be manually set independent of actual signer completion.

**You-vs-Brad split:** **Brad-only** — verifying/granting Documents &
Contracts plan access, any billing implication, his own GHL web login
for any account-level UI check (Settings, template library, exact
template ID, sender `userId`), and approving every specific recipient
address. **Already executed, read-only, no proxy change needed** — the
Opportunity-ID lookup above. **Executable once separately authorized —
Step A only**, pending resolution of the document/version-binding
question before Step B is even proposed as safe.

**Test isolation and safeguards for any proxy extension — a path
allowlist entry alone does not provide this, per the correction below:**

Reading `app/netlify/functions/ghl-proxy.ts` and `app/shared/ghl-
config.ts` directly (not assumed): this proxy's Test/Production
separation is enforced by the `IAOS_ENV` selector resolved once at
module load (`getConfig(process.env.IAOS_ENV)`), which picks one of two
hardcoded `GhlConfig` objects and fixes `LOCATION_ID` for every
outbound call the running function makes — **the allowlist governs which
paths are permitted, not which location they target.** Two new path
entries, by themselves, say nothing about environment; they would
inherit whatever `IAOS_ENV` the function happens to be running under.
**This is exactly why two shared allowlist entries are not, by
themselves, Test isolation**, and this plan does not claim otherwise.

The Test/Production selector mechanism is already independently
corroborated live this session: the `/opportunities/search` call above
returned `pipelineId wdvKMdPMxs38qoA6lkUa`, matching `TEST.pipelines.
sellerLeads` in `ghl-config.ts` exactly, and distinct from `PRODUCTION`'s
different value for the same key — confirming the currently-running dev
instance is in fact resolved to `IAOS_ENV=test` right now, not merely
assumed to be.

If this plan is approved, the following safeguards are proposed for the
two new paths specifically, beyond the existing selector mechanism —
**none implemented, none bypassed, this round:**
- **Explicit location assertion at the point of use**, not reliance on
  the module-scope selector alone: before permitting either new path,
  assert `LOCATION_ID === "SoTgVoaFGHtBdRFvXWQV"` and refuse (fail
  closed) if it does not match — a defense-in-depth check specific to
  these two write-capable/document-creating paths, given their higher
  consequence than the existing read-only entries.
- **Recipient controls**: the request body for `POST /proposals/
  templates/send` is validated against a pre-approved allowlist before
  the outbound call is made — `contactId` restricted to the single
  pre-approved Test contact (`NAGtUZ9aOE5C1GatJzpT`) and every
  recipient/email field restricted to Brad-approved test addresses only,
  refusing the call otherwise.
- **No secret logging**: consistent with this file's own existing
  doctrine ("the key is NEVER sent to the client"), any test script or
  log output for these two paths must not print the `Authorization`
  header, the raw GHL token, or any other secret value — request/response
  logging, if used for the proof, is restricted to non-secret fields.

**The smallest proposed Test-only proxy change, if this plan is
approved — not implemented, not bypassed, this round:**

Exactly two new allowlist entries in `app/netlify/functions/
ghl-proxy.ts`'s existing `ALLOW` object (lines 59-77), confirmed against
the actual endpoint references fetched this session, **plus the location
assertion and recipient-allowlist safeguards above, not the path entries
alone**:
- `POST`: `^/proposals/templates/send$`
- `GET`: `^/proposals/document$` (this endpoint's own documented required
  query parameter is `locationId`; it also requires a `Version: v3`
  request header, confirmed directly from its reference page this
  session — narrower than most other entries in the existing GET list,
  which do not carry a version-header requirement, so the proxy's
  request-building code would need to attach that header specifically
  for this path, not just the path pattern).

No third path is proposed — the Opportunity-ID lookup already ran
against the already-allowlisted `GET /opportunities/search`, live, this
session, needing no proxy change. This is the entire proxy change this
plan would need; nothing else in `ghl-proxy.ts` is touched, and this
document does not implement it.

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
| 8 | E-sign providers, GHL-first | GHL-native Documents & Contracts is the preferred V1 candidate per Brad's direction. **Updated 2026-09-09 by a live Test transaction proof (see "Live Test transaction proof" subsection):** items 7, 8 and 9 are now ACCOUNT-VERIFIED at the capability level (9's integrity-identifier sub-point CLARIFIED as an IAOS-side requirement, not a GHL-native field); items 1, 2 and 6 are ACCOUNT-VERIFIED for access/capability, still BLOCKED for their specific documentation-level sub-points; item 10 is partially ACCOUNT-VERIFIED for the single-missing-signature case only. **Items 3, 4 and 5 remain BLOCKED, explicitly not represented as passed** — Opportunity/deal binding and all API-mediated automation are unproven; this transaction was operated directly in GHL's UI, not through IAOS. Zero items UNSUPPORTED. External providers retained as unranked fallback-tier findings only; no provider selected |
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
- **GHL Documents & Contracts account-level verification (item 8) —
  UPDATED 2026-09-09 by a live Test transaction Brad ran directly in
  GHL's own web interface (see the "Live Test transaction proof"
  subsection in item 8).** That proof resolved points 7, 8 and 9 to
  ACCOUNT-VERIFIED, and points 1, 2 and 6 to ACCOUNT-VERIFIED at the
  access/capability level (their narrower documentation-level
  sub-points stay BLOCKED as before). **Points 3, 4, 5, 3's read-back
  sub-point, 4's `sendDocument` semantics, 6's settability sub-point,
  9's integrity-identifier sub-point (now CLARIFIED rather than
  BLOCKED — see the proof), and 10's non-partial-signature cases remain
  BLOCKED, precisely, not UNKNOWN and not UNSUPPORTED:** the live proof
  did not go through IAOS at all — no GHL direct-login credential
  exists anywhere in this session's memory (confirmed by an explicit
  grep across every memory file), so no IAOS-mediated account-level
  check was attempted; and `app/netlify/functions/ghl-proxy.ts`'s
  allowlist still has zero entries for any `/proposals/...` path, so
  even a fully permission-confirmed API-level test still cannot run
  through IAOS's own sanctioned proxy without a separately authorized
  allowlist change (implementation, out of scope this round and not
  made by this document). GHL's own official documentation itself was
  separately fetched (item 8) and yielded substantial DOCUMENTED
  findings — the capability is not "unverified because unreachable
  documentation," as an earlier pass reported; the remaining gaps are
  specifically account-access, proxy-allowlist, and API-binding BLOCKED
  for what neither documentation nor a directly-operated UI transaction
  can settle.
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
direction, not selected by developer preference. **No GHL account login was attempted by this session** — memory was
checked for credentials and none exist for a Test-scoped web login, so
account-level items this session itself tried to verify are reported
BLOCKED rather than guessed. **Correction, 2026-09-09.** Brad
separately, and directly, ran one real send/sign/complete Documents &
Contracts cycle in GHL's own web interface — outside this document,
outside any IAOS code path, and without the proxy/API extension this
document's own minimal proof plan proposed. That evidence is recorded
in item 8's "Live Test transaction proof" subsection and resolves
several BLOCKED points to ACCOUNT-VERIFIED; it created no IAOS
template, contact, opportunity, carrier, or code, and it is exactly the
kind of directly-operated, non-IAOS-mediated transaction this document
did not itself execute. The proxy/API extension proposal remains
unimplemented and unauthorized. **INV-58 (B9-03) is not begun**; this
document is its prerequisite input only. **This commit is pushed and a
PR is opened, per Brad's explicit authorization** — Jess Gate review is
still the next step before B9-03 may begin.
