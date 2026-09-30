# Buyer Disposition V1 — design contract (DRAFT)

**INV-71 · B10-01.** "Lock Buyer Disposition V1 contract, state machine,
qualification rules, and finish line."

**Status: DRAFT, revision 2, after Jess's REQUEST CHANGES of 2026-09-30.**
It is a design contract only. It authorizes no code, no GHL write, no
message send and no Production change. Every record kind and operation
named here is a **proposal** until reviewed. Each needs its own named
write operation (`docs/INV95_WRITE_BOUNDARIES.md`) and Production scope
review before anything may perform it.

**Source of scope.** Jess's relays of INV-71 and her review of revision 1
(2026-09-30). Jeff could not read Linear directly: the MCP connection needed
re-authentication. **The full INV-71 issue and the Board #10 project must
be rechecked against this draft once that connection returns.** Linear's
Board #10 "paused pending Board #9" text is stale: Brad signed off the
Board #9 Production walkthrough on 2026-09-30, after the verified Start
Disposition handoff (`docs/evidence/inv98/BOARD9_ACTIVATION_EVIDENCE.md`
§5f).

Claims are classified per `FOUNDATIONAL_PRINCIPLES.md` §I: **OBSERVED**
(with its source), **INFERRED**, or **UNKNOWN**. Proposed design is labelled
**PROPOSED**.

---

## 1. Scope and hard boundaries

**In scope:** from the verified Board #9 disposition handoff, through
acceptance into **Disposition Ready**, up to and including **Buyer
Selected**, the V1 finish line.

**Rules this contract sets:**
- **Brad alone selects the buyer.** No automatic selection, ranking, AI
  score, recommendation or "best buyer" signal, in any form.
- **Outreach: Brad-authorized only; autonomous outreach is prohibited.**
  IAOS may send a message to a buyer only as an explicit Brad action
  (T5). Brad picks that one buyer, that channel and that exact content,
  for that one send. Prohibited:
  - any send IAOS decides on its own;
  - bulk or list sends;
  - scheduled, delayed or follow-up sequences;
  - triggered sends;
  - any send through workflow enrollment, tags or pipeline movement (the
    HARD NO in `AGENTS.md` is unchanged);
  - any content Brad has not approved verbatim.
- **No Production mutation** by this contract.
- **No Board #11 work.** Nothing past Buyer Selected: no assignment
  contract, assignment fee, title or escrow coordination, or closing.
- **The `AGENTS.md` hard constraints still apply.** No tag, pipeline stage,
  `offer_` field or workflow-trigger writes. The Board #9 stage exception
  extends to nothing here. There are only named, reviewed writes, and no
  field write without its own inert-proof. GHL is the sole system of
  record, with no app-side shadow copy.

**Current state of the code (OBSERVED, repository search at
`main@618c1a8`):**
- No buyer, match, engagement, outreach, qualification, offer,
  proof-of-funds or selection carrier exists in `app/src/lib`.
- There is no mention of proof of funds in `app/src` or `docs/`.
- The only Board #10 artifact is Board #9's input contract: the disposition
  handoff record (`contract-disposition-handoff-model.ts`,
  `contract-disposition-handoff-carriers.ts`; INV-66).

## 2. Deal identity and the entry gate

**Deal identity (PROPOSED):** `(opportunityId, agreementAt, version)`. These
are exactly the identity fields of the Board #9 Under Contract record and
disposition handoff. Every Board #10 record names the deal identity it
belongs to. A different `agreementAt` or `version` is a different deal
identity.

**The handoff does not open Board #10 by itself.** A disposition handoff
note proves that Board #9 produced its output. It opens nothing. Board #10
opens a deal identity only through **B10-02's acceptance** of that handoff
(T1). Acceptance independently re-verifies the handoff and moves the deal
to **Disposition Ready**.

**What the handoff carries (OBSERVED from its model, INV-66):**
- A verified Under Contract record for the exact identity.
- No rescission for that version.
- No equivalent handoff for it.
- A frozen snapshot of:
  - the property address and legal description;
  - the seller contract price;
  - the approved ARV, with its evidence state and decision;
  - the approved repairs;
  - the closing date and possession;
  - the seller notice contact;
  - the required signers.
- Access/showing information is honestly `unresolved`, and document
  references are an honestly empty list.

**How Board #10 uses it (PROPOSED):**
- It reads the handoff and never re-derives or edits it.
- The deal facts Board #10 compares or shows come from the **accepted**
  handoff's snapshot only, never from live opportunity fields.

## 3. Status dimensions — kept separate

**No dimension is derived from, or collapsed into, another.** A buyer can
be `criteria_fit` and not qualified. A buyer can be qualified with no
offer. An offer can exist from an unqualified buyer, but it can't be
selected.

| Dimension | Scope | Values (PROPOSED) |
|---|---|---|
| **Deal disposition** | per deal identity | `handoff_unaccepted` · `disposition_ready` · `buyer_selected` · `disposition_frozen` · `disposition_superseded` · `disposition_halted` |
| **Match** | per buyer × deal | `candidate` · `criteria_fit` · `criteria_misfit` · `criteria_insufficient` · `candidate_removed` |
| **Engagement** | per buyer × deal | `not_engaged` · `contacted` · `responded` · `interested` · `not_interested` · `unresponsive` |
| **Qualification** | per buyer × deal | `unqualified` · `qualified` · `qualification_lapsed` · `disqualified` |
| **Offer** | per offer | `offer_received` · `offer_superseded` · `offer_withdrawn` · `offer_declined` · `offer_selected` |
| **Selection** | per deal identity | `no_selection` · `selected` · `selection_frozen` · `selection_superseded` · `selection_void` |

**What each dimension means:**
- **Match** is a deterministic comparison of the buyer's *stated* buy-box
  criteria against the accepted handoff's deal facts. It is **not**
  qualification, and never a score.
- **Engagement** records Brad-authorized IAOS sends (`contacted`) and the
  facts Brad records about responses (`responded`, `interested`, and so
  on).

## 4. Claims, evidence, decisions — and the qualification gates

Every qualification-relevant fact carries exactly one **provenance**:

- **`buyer_claim`:** something the buyer said. For example: cash
  available, a closing timeline, deal history, buy-box criteria, a stated
  price. Recorded verbatim with its date and channel. **A claim never
  satisfies a gate by itself**, and is never promoted to evidence.
- **`evidence_received`:** a document or record Brad received, identified
  by a stable reference (proposed: its SHA-256 and file name) and received
  time. **Receipt is not acceptance.**
- **`brad_decision`:** Brad's explicit, recorded judgment. Always recorded
  with its time, `operator: brad`, and the basis or reason the table
  requires.

**POF received ≠ POF accepted:**
- `pof_received` records that a document arrived: the reference, the
  stated amount, the issuer as shown, the document date, and the received
  time.
- `pof_accepted` is a separate `brad_decision`. It records Brad's
  determination that the document is reliable, is in the buyer's (or the
  buyer entity's) name, is dated within the freshness window, and shows
  available funds of at least the required funds for this deal.
- `pof_rejected` (with reason) ends that document's use.

**Qualification gates (PROPOSED).** Each is checked on a fresh read, both
when the qualification decision is recorded and again at every later read.

| Gate | Requirement | Provenance that can satisfy it |
|---|---|---|
| **G1 Usable buyer contact** | The buyer's GHL contact has at least one contact method that isn't DND for its channel. Brad has recorded that the buyer was actually reached and responded on it (a T6 `responded` fact) | `brad_decision` on engagement facts |
| **G2 Deal-criteria fit** | Match is `criteria_fit` against the **accepted** handoff snapshot for this deal identity | System derivation from the buyer's claim and deal facts. Fit is necessary, never sufficient |
| **G3 Identity** | The legal buyer name or entity, and the signer's name and role, confirmed by Brad from named evidence | `brad_decision` |
| **G4 Funds** | An accepted POF covers the required funds for this deal, and its document date is inside the freshness window | `brad_decision` on `evidence_received` |
| **G5 Ability to meet closing** | Brad has decided the buyer can close by the seller contract's closing date. The buyer's committed closing date is **on or before** the handoff's `closingDate`, and that date is not `unresolved` | `brad_decision`, based on the buyer's recorded commitment plus G4. A timeline claim alone never passes |
| **G6 Acquisition path** | Cash purchase, consistent with Board #9's supported "Cash Acquisition / Assignment Exit" path. Financing-contingent intent fails in V1 | `brad_decision` on the buyer's recorded intent |
| **G7 Nothing adverse** | No disqualification, and no outstanding revocation of any record G1–G6 relies on | System derivation |

**Qualified Buyer (the fix for revision 1's circularity).**
- **The decision is the result, not one of the gates.** A buyer is
  `qualified` for a deal identity when **Brad's qualification decision
  (T11) was recorded while G1–G7 all passed**, that decision has not been
  revoked, and **G1–G7 still pass on the current read**.
- The system refuses to record the decision unless G1–G7 pass. It never
  records the decision on its own.
- If a gate later fails, qualification derives `qualification_lapsed` (T12)
  without any write. For example: the POF ages out, the contact becomes
  DND, or a superseding criteria claim changes the fit.
- Claims, a match alone, a received but unaccepted POF, an outreach send or
  an offer contribute nothing.

## 5. Transition table (PROPOSED)

**Common rules for every row:**
- **Authority** is either **System** or **Brad**.
  - **System** means a deterministic derivation at read time from recorded
    facts. It writes nothing and is recomputed on every read.
  - **Brad** means an explicit action by the authenticated, allowlisted
    Brad application-write session. No other operator, no automation, no AI.
- **Every Brad transition appends exactly one record.** Records are never
  edited or deleted.
- **Every Brad transition:**
  - re-derives its preconditions from a fresh read;
  - refuses a duplicate equivalent record before writing;
  - verifies its own record by fresh readback.
- **Failure writes nothing and names each failed precondition.** An
  uncertain result is reported as uncertain. It is never retried blindly
  and never shown as success.

| # | Current state | Event | Authority | Evidence required | Next state | Failure behavior | Append-only audit record |
|---|---|---|---|---|---|---|---|
| T0 | (none) | A disposition handoff note exists for a deal identity | System | The handoff parses and matches its Under Contract record | Deal `handoff_unaccepted` (Board #10 is **not** open) | Invalid handoff: no Board #10 state; the reason is named | None new. The handoff note is Board #9's record |
| T1 | `handoff_unaccepted` | **B10-02: accept the handoff** | Brad initiates; System re-verifies | Fresh independent re-checks: the handoff matches the current Under Contract record; a fresh GHL read shows Seller Leads / Under Contract; the preserved executed artifact re-verifies; no rescission or pending correction (T18) for this identity; no current acceptance already exists | Deal `disposition_ready` | Refuses, naming each failed check. Nothing opens | `disposition-acceptance` (deal identity, handoff note ref, check results, at, operator) |
| T2 | Deal `disposition_ready` | Brad adds a buyer candidate | Brad | The buyer is an existing GHL contact in this location, is not the seller contact, and is not already a candidate for this deal identity | Match `candidate`; Engagement `not_engaged`; Qualification `unqualified` | Refuses a duplicate, the seller as buyer, or a deal that isn't `disposition_ready` | `buyer-candidate-added` |
| T3 | Match `candidate`, `criteria_*` | Brad records the buyer's stated buy-box criteria | Brad | The criteria verbatim (`buyer_claim`), with date and channel. A newer claim supersedes the older by reference | (input to T4) | Refuses an empty claim, or a missing date or channel | `buyer-criteria-claim` |
| T4 | Match `candidate` or `criteria_*` | Criteria or deal facts are read | System | The latest un-superseded criteria claim compared with the accepted handoff snapshot | `criteria_fit` / `criteria_misfit` / `criteria_insufficient` | Missing data gives `criteria_insufficient`, never a guess | None. Derived |
| T5 | Deal `disposition_ready`; Match not `candidate_removed` | **Brad-authorized outreach: one send** | **Brad only** | Brad selects this buyer, channel and exact content for this one send. The channel's contact method exists and isn't DND. The provider accepts the send, verified by fresh readback | Engagement `contacted` | Refuses any missing selection, DND, a removed candidate or a deal that isn't ready. Provider uncertainty is reported as uncertain, never auto-retried, never sent twice | `buyer-outreach` (buyer, channel, verbatim content, provider message ref, at, operator `brad`) |
| T6 | Any engagement | Brad records an engagement fact | Brad | Brad attestation: date, channel, and outcome (`responded`, `interested`, `not_interested`, `unresponsive`) | Engagement per the outcome | Refuses a future date, or a missing channel or outcome | `buyer-engagement` |
| T7 | Qualification not `disqualified` | Brad records a POF received | Brad | The reference (SHA-256 and file name), stated amount, issuer as shown, document date, received time | Qualification unchanged | Refuses a missing reference, amount or date | `pof-received` |
| T8 | A `pof-received` record with no decision | Brad accepts or rejects that POF | Brad | Accept only if it covers the required funds, is inside the freshness window, and the name matches the buyer or entity; otherwise reject, with reason | That POF is `accepted` or `rejected` | Refuses an acceptance that fails any test, or a second decision on the same POF | `pof-decision` |
| T9 | Qualification not `disqualified` | Brad confirms identity and signer | Brad | The legal name or entity, and the signer's name and role, from named evidence | (gate G3) | Refuses a missing entity or signer | `buyer-identity-confirmed` |
| T10 | Qualification not `disqualified` | Brad records ability to meet closing | Brad | The buyer's committed closing date (`buyer_claim`) plus Brad's decision and basis. Requires the date to be on or before the handoff `closingDate` | (gate G5) | Refuses if `closingDate` is `unresolved`, the committed date is later, or the basis is missing | `buyer-closing-capability` |
| T11 | Qualification `unqualified` or `qualification_lapsed` | **Brad records the qualification decision** | Brad (system-gated) | G1–G7 all pass on a fresh read | Qualification `qualified` | Refuses, naming each failing gate. Never records on its own | `buyer-qualification-decision` (`qualified`, with references to every gate-satisfying record) |
| T12 | Qualification `qualified` | A relied-on gate stops passing | System | Read-time re-check of G1–G7 | `qualification_lapsed` | None | None. Derived |
| T13 | Any qualification | Brad disqualifies the buyer | Brad | A reason | `disqualified` (terminal for this buyer × deal identity) | Refuses a missing reason | `buyer-qualification-decision` (`disqualified`) |
| T14 | Any | **Brad revokes one of his own decisions** | Brad | The exact record being revoked (disposition acceptance, POF decision, identity, closing capability, qualification, or selection), and a reason | States re-derive without the revoked record. Revoking a selection returns the deal to `disposition_ready`, the selection to `no_selection`, and the offer to `offer_received`. Revoking the acceptance returns the deal to `handoff_unaccepted` | Refuses a missing reason or target, or an already-revoked target | `decision-revocation` (target ref, reason) |
| T15 | Deal `disposition_ready`; Match not `candidate_removed` | Brad records a buyer offer | Brad | Price, terms, closing timing and earnest money as stated (`buyer_claim`), with date and channel | `offer_received`. A prior open offer from the same buyer becomes `offer_superseded` | Refuses a deal that isn't ready, or a missing field | `buyer-offer` (the superseded offer is referenced) |
| T16 | `offer_received` | The buyer withdraws, or Brad declines | Brad | Attestation (withdrawn) or decision (declined), with reason | `offer_withdrawn` / `offer_declined` | Refuses a missing reason | `buyer-offer-status` |
| T17 | Deal `disposition_ready`; Selection `no_selection` | **Brad selects the buyer** | **Brad only** | On a fresh read: the acceptance (T1) is current and unrevoked; no T18 condition; the buyer is `qualified` with G1–G7 passing now; that buyer's current offer is `offer_received` | Deal `buyer_selected`; Selection `selected`; that offer `offer_selected` | Refuses, naming each unmet precondition. Never auto-selects or suggests | `buyer-selection` (deal identity, buyer, offer ref, qualification ref, acceptance ref, at, operator `brad`) |
| T18 | `disposition_ready` or `buyer_selected` | **A Board #9 correction is pending** for this deal identity (§6) | System | A Board #9 correction lifecycle record, or a new Agreement Reached for the opportunity, that has not reached verified Under Contract | Deal `disposition_frozen`. An existing selection becomes `selection_frozen` (not void) | T17 and T15 are refused while frozen; T2–T13 remain available. Nothing opens or selects | None new. Board #9's records |
| T19 | Frozen or not | **The replacement reaches verified Under Contract** (§6) | System | A Board #9 Under Contract record for a new version or a new `agreementAt` on the same opportunity | This identity: `disposition_superseded`, with a selection becoming `selection_superseded`. The new identity: `handoff_unaccepted` once its own handoff exists (T0) | None | None new. Board #9's records |
| T20 | Any | **Rescission** recorded by Brad in Board #9 for this agreement/version | System | The Board #9 rescission lifecycle record | Deal `disposition_halted` (terminal); a selection becomes `selection_void` | All Board #10 transitions for this identity are refused | None new. Board #9's rescission record |
| T21 | New identity `handoff_unaccepted` | **Controlled re-entry** (§6) | Brad (via T1) | T1's full re-verification for the **new** identity | New identity `disposition_ready` | As T1 | `disposition-acceptance` for the new identity, referencing the superseded identity |

**Finish line (V1).** A deal identity is `buyer_selected`, its
`buyer-selection` record is verified by fresh readback, and no T14, T18,
T19 or T20 condition applies to it. Board #10 V1 ends there. Anything after
it is Board #11. Board #11 must not proceed on a frozen, superseded, void or
revoked selection.

## 6. Revocation, supersession, re-entry and Board #9 corrections

**Revocation (T14).**
- Brad may revoke any of his own Board #10 decisions with a reason, by an
  append-only `decision-revocation` that references the exact record.
- The revoked record is preserved, and state re-derives as if it were
  absent.
- Records that are facts, not decisions, are **not** revoked. They are
  superseded by newer facts. These are buyer claims, `pof-received`,
  engagement facts and outreach sends.
- A revocation is never inferred. Only Brad records one.

**Supersession.**
- A newer record of the same kind, for the same buyer and the same deal
  identity, supersedes the older **by reference**. This applies to
  criteria claims, offers, closing capability and identity confirmations.
- The latest un-superseded, unrevoked record governs, and superseded
  records are preserved.
- A selection references the exact offer and qualification records. If
  either is later superseded or revoked, the selection no longer holds,
  and Brad must re-select (T17) or revoke (T14). It is never re-pointed
  silently.

**Controlled re-entry (T21).**
- **The only ways back into Disposition Ready:**
  - a revoked selection or acceptance on the **same** identity (T14);
  - a **new** deal identity entering through its own handoff and B10-02
    acceptance (T0 → T1 / T21).
- **After a new identity (PROPOSED carry-over):**
  - Buyer-level evidence may be **referenced**, never copied, when it is
    still valid for the new identity. That covers a confirmed identity, and
    an accepted POF if it's inside the window and covers the new required
    funds.
  - Match is re-derived against the new snapshot.
  - Engagement history remains visible.
  - Qualification decisions, closing capability, offers and selection do
    **not** carry over. They must be recorded again for the new identity.
    Price, dates or terms may have changed.

**Effect of later Board #9 events** (`SELLER_CONTRACT_STATE_MACHINE_V1.md`,
"Corrected" and "Rescinded").

| Board #9 event | Board #9 rule (OBSERVED) | Board #10 effect (PROPOSED) |
|---|---|---|
| **Correction, case 3:** metadata only | Outside Corrected; no new contract cycle | **None** |
| **Correction, case 2:** wording fix, same `agreementAt`, new version | The prior executed version stays authoritative until the replacement reaches verified full execution, or Brad records a Rescission | While pending: **frozen** (T18). Selection and new offers are blocked, qualification work may continue, and an existing selection is `selection_frozen`. When the replacement is verified Under Contract: the prior identity is **superseded** (T19); re-entry is through the new version's handoff and acceptance (T21) |
| **Correction, case 1:** a material term differs, so a new Agreement Reached with a new `agreementAt` | A different accepted deal; the prior version stays authoritative on the same terms as case 2 | The same as case 2: frozen, then superseded, then re-entry for the new identity. No qualification, offer or selection carries over, because price or terms changed |
| **Rescission** of this agreement/version | Brad-only; this agreement is terminal | **Halted** (T20), terminal for the identity; any selection is `selection_void` in IAOS. Buyer communication about it is a separate Brad-authorized send (T5), never automatic |
| **Expired / Declined** | Pre-execution outcomes | **Not applicable.** They cannot follow a verified Under Contract for the same version (INFERRED from the state order; confirm with Jess) |

**IAOS makes no legal determination.** As in Board #9, these states govern
IAOS's own downstream behavior only. They never declare a buyer arrangement
legally void or superseded.

## 7. Open decisions (for Brad or Jess; not decided here)

1. **Carriers and locations.** Which GHL record holds each proposed record,
   and in what form. Each needs a named write operation and scope review.
   `ghl.notes.create()` is the only sanctioned general write today.
2. **The outreach send mechanism (T5).** Which GHL send path is used, and
   its named operation, Production scope and proof. Is a send in Board #10
   V1, or only recorded?
3. **Identifying a buyer contact,** given that IAOS may not write tags.
4. **Required funds (G4).** The formula POF must cover. The seller contract
   price is the floor.
5. **The POF freshness window (G4).** The number of days.
6. **The closing margin (G5).** Whether a buffer before the seller closing
   date is required.
7. **An offer below the seller contract price.** Refuse it at selection, or
   allow it with Brad's recorded override.
8. **POF document preservation.** Preserved bytes, like Board #9's executed
   artifact, or a hash reference only.
9. **Offer before qualification.** Revision 2 allows recording it, but not
   selecting it.
10. **B10-02 acceptance authority.** Brad-initiated as drafted (T1), or
    system-performed on handoff readback.
11. **An abandoned Board #9 correction.** How Board #9 records one that will
    never execute, and so how a T18 freeze lifts without a replacement.
    UNKNOWN: Board #9 defines no such record today.
12. **Recheck the full INV-71 issue and the Board #10 project** against this
    draft once Jeff's Linear connection returns.
