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

**UNRESOLVED PRODUCT/LEGAL DECISION — verified absent everywhere this
document can search.**

- `grep -rn -i "purchase agreement" docs/*.md` — **zero matches**, run
  fresh this session.
- `docs/PRODUCT_BACKLOG.md`'s two literal occurrences of the word
  "contract" (lines 125, 163–164) are both about Board #4 workflow-routing
  design ("that is the mechanism a persisted-disposition design would
  use"), unrelated to a purchase agreement.
- No attachment, linked document, or comment on INV-56 or INV-57 in Linear
  references a template. `mcp__linear-server__search_documentation` was
  attempted this session for "purchase agreement template" and returned
  only Linear's own product-help articles (Salesforce integration, project
  templates, SLAs) — Linear's help center, not this workspace's data; it
  confirms the search tool itself found nothing in-workspace, not that the
  search was skipped.
- A real, business-approved purchase-agreement template is exactly the
  kind of fact that would most plausibly live either in Brad's own
  external process or in a Production GHL Documents & Contracts template
  — and Production access is explicitly barred this round (HARD NO). The
  Test location was checked anyway rather than assumed empty: no
  Documents/Contracts-related endpoint is even reachable through IAOS's
  own sanctioned proxy to check (see coverage area 5's allowlist finding
  below), so a Test-side template's existence could not be confirmed or
  denied by IAOS's own tooling either.

**This cannot be established without Brad directly supplying the
template, or a future, separately authorized Production read.** No
plausible-sounding template or clause is invented here — that would
violate this issue's own HARD NO on invented legal content and
FOUNDATIONAL_PRINCIPLES principle 19.

### 2. Required template fields and signer roles

**Partially derivable from existing locked contracts; the rest is
downstream of item 1 and is UNRESOLVED alongside it.**

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

Signer roles cannot be enumerated beyond "the seller(s)" without the
actual template (item 1) — a template may require co-owner signatures,
spousal signatures, POA signers, or witness/notary roles that only the
template itself would name. **Classification: REAL LOGIC GAP** for
mapping IAOS's existing party data to template signer roles (nothing
attempts this today — see item 7 for what party data exists), compounded
by the **UNRESOLVED PRODUCT/LEGAL DECISION** in item 1: signer roles
cannot be finalized before a template is.

### 3. Brad's current contracting workflow

**UNRESOLVED PRODUCT/LEGAL DECISION — verified absent, same searches as
item 1.** No document in `docs/` describes what Brad actually does today
between an accepted verbal deal and an executed contract (which tool he
uses, whether he already uses an e-sign provider, how he currently tracks
sent-but-unsigned agreements). `docs/SELLER_ACQUISITION_WORKFLOW.md`'s
"Agreement and contract readiness" section (lines 168–172) describes what
IAOS should check before paperwork, not what paperwork process exists
today. This is a real-world business-process fact only Brad can supply;
it is not established by inference from the surrounding documents, and
this document does not guess at it.

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
further reconciliation — the remaining work is entirely in item 9 below
(whether verified evidence exists for what a title/closing company
actually needs at handoff).

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

**Documents & Contracts — external provider evidence, none obtained.**
GHL's own public Stoplight-hosted API reference
(`highlevel.stoplight.io/docs/integrations/`) and a specific help-center
URL guessed for its Documents & Contracts article both failed to return
retrievable content this session (the Stoplight page is a JavaScript
single-page app that returned no server-rendered content to this
session's fetch tool; the guessed help-center URL 404'd). **Classification:
UNKNOWN** — GHL's own native e-signature capability, its template
merge-field support, and its webhook/completion-signal shape remain
unverified by this document, for a tooling reason (the fetch method
available this session could not render the source), not because no
attempt was made.

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

**No selection made. Findings only, each cited to what was actually
fetched this session.** Evaluated: DocuSign, Dropbox Sign (formerly
HelloSign), PandaDoc, Adobe Acrobat Sign, and GHL's own native capability.

| Provider | Templates | API/integration | Signer experience | Completion signal | Executed-document retrieval | Correction/void | Cost |
|---|---|---|---|---|---|---|---|
| **DocuSign** | OBSERVED referenced ("Request Signatures & Automate Forms") but the fetched overview page carried only a title, no body detail this session | UNKNOWN in detail this session — the Connect/webhooks doc page fetched returned only its title, no substantive content | UNKNOWN — not reached this session | UNKNOWN — Connect/webhooks page content not retrieved this session | UNKNOWN — not reached this session | UNKNOWN — not reached this session | **OBSERVED** (`ecom.docusign.com/plans-and-pricing/esignature`, fetched this session): Personal $11/mo, Standard $30/user/mo, Business Pro $45/user/mo, Enhanced = custom pricing; the page states API access ("Industry-leading APIs") and a developer account are included on every tier, Personal through Enhanced |
| **Dropbox Sign (HelloSign)** | OBSERVED (`developers.hellosign.com/docs/overview`, fetched): "use templates created on Dropbox Sign website" on the Essentials plan, with "premium template endpoints" referenced for higher tiers — no further detail retrieved | OBSERVED partially: file-retrieval endpoints named (`signature_request/files`, `signature_request/files_as_data_uri`, `signature_request/files_as_file_url`) at different subscription levels, but their exact behavior was not in the fetched content | UNKNOWN — not addressed in fetched content | UNKNOWN — the fetched overview page did not discuss webhook event types; a follow-up fetch of the cancellation-endpoint reference page also did not surface event-type documentation | **OBSERVED, partial**: the three file-retrieval endpoint names above exist, per the same overview page; their response shape was not retrieved | **OBSERVED** (`developers.hellosign.com/api/reference/.../signatureRequestCancel`, fetched): a `/signature_request/cancel/{signature_request_id}` endpoint exists; the docs state it "cancels an incomplete signature request. This action is not reversible," and explicitly only works on **incomplete** requests — a completed request cannot be canceled through this endpoint | UNKNOWN — pricing page not reached this session |
| **PandaDoc** | OBSERVED (`developers.pandadoc.com/reference/about`, fetched): "Create from template" is listed as a core getting-started capability | OBSERVED, minimal: a guide titled "Listening for changes in document status" is referenced, indicating webhook/status functionality exists, but the fetched page did not enumerate event types or payload shape | UNKNOWN — not addressed in fetched content | UNKNOWN, per above — existence indicated, detail not retrieved | UNKNOWN — not addressed in fetched content | UNKNOWN — not addressed in fetched content | Attempted twice this session (`pandadoc.com/pricing/` and `pandadoc.com/pricing`); both returned HTTP 429 (rate-limited) — **not obtained** |
| **Adobe Acrobat Sign** | UNKNOWN — the specific overview URL fetched returned HTTP 404 this session | UNKNOWN, same reason | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN — not reached |
| **GHL native (Documents & Contracts)** | UNKNOWN — see item 5; both the Stoplight API reference and a guessed help-center article failed to return retrievable content this session (SPA with no server-rendered body; 404 respectively) | UNKNOWN, same reason, compounded by IAOS's own proxy allowlist not permitting any documents-shaped path today (item 5) | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |

**Honest summary of this section: real, cited findings exist for two
providers on select dimensions (DocuSign's pricing/API-inclusion; Dropbox
Sign's template existence, partial file-retrieval, and cancel-when-
incomplete behavior) — everything else in the grid is genuinely UNKNOWN
this session, not filled in with general knowledge.** The tool available
this session (a fetch-and-summarize pass over rendered HTML) repeatedly
failed to surface documentation-page bodies (title-only pages, 404s, a
JS single-page app, and rate-limiting). This is a tooling limitation of
this session, not evidence that the underlying capabilities don't exist.
**Classification: EXTERNAL/OPERATIONAL GAP** for completing this
comparison — a future pass with better-targeted URLs, a different fetch
method, or direct account creation/sandbox access with each provider
would be needed to fill the UNKNOWNs above. No provider is recommended or
ranked; this issue's HARD NO on provider selection by developer
preference is honored by the fact that no dimension favors one provider
over another with confidence.

### 9. Actual first-market title/closing handoff expectations

**Verified absent beyond what is already locked.** Searched `docs/*.md`
for anything past `docs/SELLER_ACQUISITION_WORKFLOW.md`'s existing
"Contract Readiness -- DISTINCT, DETAIL DEFERRED" framing (already cited
in item 4) and `docs/SELLER_CONTRACT_STATE_MACHINE_V1.md`'s Contract
Execution Details/Closing Ready split — no additional document describes
what a real title company or closing agent in Brad's actual market
expects to receive at handoff (specific disclosure forms, timing
conventions, required signatures beyond the purchase agreement itself,
or jurisdiction-specific requirements). **Classification: UNRESOLVED
PRODUCT/LEGAL DECISION**, verified absent rather than invented — this is
exactly the kind of jurisdiction- and market-specific fact this document
does not manufacture from general knowledge, per the HARD NO on invented
legal requirements.

---

## Part B — Six-way classification summary

| # | Area | Classification(s) |
|---|---|---|
| 1 | Approved template candidate(s) | UNRESOLVED PRODUCT/LEGAL DECISION |
| 2 | Template fields / signer roles | REAL LOGIC GAP + UNRESOLVED PRODUCT/LEGAL DECISION (blocked on 1) |
| 3 | Brad's current contracting workflow | UNRESOLVED PRODUCT/LEGAL DECISION |
| 4 | Disclosures vs. title/closing verification | REUSE (already locked, no gap) |
| 5 | GHL stages/fields/documents/notes/workflows/API | Mixed: REUSE (stages/fields as read targets, occupancy), REAL CARRIER GAP (lien amount unused, no contract-state stage), EXTERNAL/OPERATIONAL GAP (workflows and documents-capability unreachable via sanctioned proxy), UNKNOWN (opportunity-model field catalog; GHL native e-sign capability) |
| 6 | Board #8 economics provenance/handoff | REUSE (fully covered, no gap) |
| 7 | Property/ARV/repairs/access/photo/closing-date/earnest-money/possession/contingency/owner/signer-delivery data | Mixed: REUSE (property, ARV, repairs, transaction-assumptions prose, occupancy), RENAME/PRESENTATION-ONLY (confirmation-act framing), REAL CARRIER GAP (access, photo/document, closing date, earnest money, contingencies, owner signing-authority, signer delivery — the majority of this row) |
| 8 | E-sign providers | EXTERNAL/OPERATIONAL GAP (comparison incomplete — tooling limitation this session), no provider selected |
| 9 | First-market title/closing handoff expectations | UNRESOLVED PRODUCT/LEGAL DECISION |

---

## Unresolved Product/Legal decisions (for Brad, not decided here)

1. **The approved V1 purchase-agreement template itself** (item 1) — the
   single largest blocker; most of items 2, 7, and parts of 8 cannot be
   finalized without it.
2. **Brad's current contracting process** (item 3) — whether an e-sign
   provider is already in informal use, and what "contracting" concretely
   looks like today outside IAOS.
3. **First-market title/closing handoff expectations** (item 9).
4. **Which categories of contract data (item 7's gaps) actually need a
   durable IAOS carrier versus living entirely inside the chosen
   template/provider** — this document inventories what's missing; it
   does not decide what IAOS must capture versus what the e-sign
   provider's own form fields capture instead.

## External/operational gaps (not product decisions — verification/tooling work)

- **Workflow inventory for the Test location** is unreachable through
  IAOS's sanctioned proxy (no allowlist entry); Production's own
  inventory is out of scope this round.
- **GHL's Documents & Contracts capability** (existence, template
  merge-field support, plan-tier gating) is unverified both because
  IAOS's proxy blocks any candidate path and because this session's fetch
  tooling could not render GHL's own public documentation.
- **The e-sign provider comparison** (item 8) is incomplete — several
  cells are UNKNOWN due to fetch failures (title-only pages, 404s, a
  client-rendered SPA, and one rate-limited page), not due to absence of
  public documentation.
- **Opportunity-model custom field catalog** cannot be enumerated the way
  the contact-model catalog was — only currently-populated fields are
  visible via a live Opportunity read.

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

No template edited or drafted. No legal language invented anywhere in
this document — every gap in items 1, 3, and 9 is reported as unresolved,
never filled with a plausible-sounding placeholder. No workflow opened,
edited, or activated — the Test location's workflow list was not even
retrievable, let alone touched. No new GHL field, carrier, or Production
record created. No e-sign provider selected — Part A item 8 presents
findings only, several explicitly incomplete, with no ranking or
recommendation. INV-58 (B9-03) is not begun; this document is its
prerequisite input only. No PR opened, no push performed — this commit
sits on the local branch pending Jess Gate and Brad's explicit
authorization to proceed.
