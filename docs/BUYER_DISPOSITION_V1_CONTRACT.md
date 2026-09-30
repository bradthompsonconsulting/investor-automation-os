# Buyer Disposition V1 — design contract (DRAFT)

**INV-71 · B10-01.** "Lock Buyer Disposition V1 contract, state machine,
qualification rules, and finish line."

**Status: DRAFT for Jess's review. It is a design contract only.** It
authorizes no code, no GHL write, no outreach and no Production change.
Every record kind named here is a **proposal** until reviewed. Each needs its
own named write operation (`docs/INV95_WRITE_BOUNDARIES.md`) before anything
may write it.

**Source of scope.** Jess's relay of INV-71 (2026-09-30). Jeff could not read
Linear directly: the MCP connection needed re-authentication. The INV-71
issue and the Board #10 project are to be re-read as the source once that
connection returns. Linear's Board #10 "paused pending Board #9" text is
stale: Brad signed off the Board #9 Production walkthrough on 2026-09-30,
after the verified Start Disposition handoff
(`docs/evidence/inv98/BOARD9_ACTIVATION_EVIDENCE.md` §5f).

Claims are classified per `FOUNDATIONAL_PRINCIPLES.md` §I: **OBSERVED**
(with its source), **INFERRED**, or **UNKNOWN**. Proposed design is labelled
**PROPOSED**.

---

## 1. Scope and hard boundaries

**In scope:** from the verified Board #9 disposition handoff, up to and
including **Buyer Selected**, the V1 finish line.

**Out of scope, and excluded by this contract:**
- **Brad alone selects the buyer.** No automatic selection, ranking, AI
  score, recommendation or "best buyer" signal, in any form.
- **No outreach.** IAOS sends nothing to any buyer: no email, SMS, call,
  workflow enrollment or document. Contact with buyers happens outside
  IAOS, by Brad. IAOS only records facts Brad enters about it.
- **No Production mutation** by this contract.
- **No Board #11 work.** Nothing past Buyer Selected: no assignment
  contract, assignment fee collection, title or escrow coordination, or
  closing.
- **The hard constraints in `AGENTS.md` still apply.** No tag, pipeline
  stage, `offer_` field or workflow-trigger writes. The Board #9 stage
  exception extends to nothing here. There are only named, reviewed writes,
  and no field write without its own inert-proof. GHL is the sole system
  of record, with no app-side shadow copy.

**Current state of the code (OBSERVED, repository search at
`main@618c1a8`):**
- No buyer, match, engagement, qualification, offer, proof-of-funds or
  selection carrier exists in `app/src/lib`.
- There is no mention of proof of funds in `app/src` or `docs/`.
- The only Board #10 artifact is Board #9's input contract: the disposition
  handoff record (`app/src/lib/contract-disposition-handoff-model.ts`,
  `contract-disposition-handoff-carriers.ts`; INV-66).

## 2. Entry condition — the verified Board #9 handoff

Board #10 begins only from a **disposition handoff record**. This is the
existing `iaos-disposition-handoff` note, written by Board #9's Start
Disposition and verified by fresh readback.

**What the handoff guarantees (OBSERVED from its model, INV-66):**
- A verified Under Contract record for the exact agreement and version.
- No rescission lifecycle evidence for that version.
- No equivalent handoff already existed.
- A frozen snapshot of:
  - the property address and legal description;
  - the seller contract price;
  - the approved ARV, with its evidence state and decision;
  - the approved repairs;
  - the closing date and possession;
  - the seller notice contact;
  - the required signers.

  Each field is copied from canonical upstream sources and never
  recomputed.
- Access/showing information is honestly `unresolved`, and document
  references are an honestly empty list. No upstream carrier exists for
  either.

**How Board #10 uses it (PROPOSED):**
- It **reads** the handoff and never re-derives, edits or supersedes it.
- Deal facts Board #10 shows or compares come from the handoff snapshot
  only, never from live opportunity fields.
- If the handoff is later invalidated (a rescission lifecycle record for
  that version), the deal moves to `disposition_halted` (T14).

## 3. Six status dimensions — kept separate

**No dimension is ever derived from, or collapsed into, another.** A buyer
can be `matched` and `unqualified`. A buyer can be `qualified` and have
made no offer. An offer can exist from an unqualified buyer, but it can't
be selected (§5).

| Dimension | Scope | Values (PROPOSED) |
|---|---|---|
| **Deal disposition** | per deal (opportunity + agreement + version) | `disposition_open` · `buyer_selected` · `disposition_halted` |
| **Match** | per buyer × deal | `candidate` · `criteria_fit` · `criteria_misfit` · `criteria_insufficient` · `candidate_removed` |
| **Engagement** | per buyer × deal | `not_engaged` · `engaged` · `interested` · `not_interested` · `unresponsive` |
| **Qualification** | per buyer × deal (funds must cover *this* deal) | `unqualified` · `qualified` · `disqualified` · `qualification_expired` |
| **Offer** | per offer, from buyer × deal | `offer_received` · `offer_superseded` · `offer_withdrawn` · `offer_declined` · `offer_selected` |
| **Selection** | per deal | `no_selection` · `selected` |

**What each dimension means:**
- **Match** is a deterministic comparison of the buyer's *stated* buy-box
  criteria against the handoff's deal facts. It says the deal fits what the
  buyer says they want. It is **not** qualification, and never a score.
- **Engagement** records what Brad reports about his own contact with the
  buyer outside IAOS. IAOS never initiates it.

## 4. Claims, evidence and decisions — the qualification vocabulary

Every qualification-relevant fact carries exactly one **provenance**:

- **`buyer_claim`:** something the buyer *said*. For example: "I have cash",
  "I close in 10 days", "I've done 30 deals", "I buy in 78701", a stated
  maximum price. Recorded verbatim with its date and channel. **A claim
  never satisfies a qualification requirement by itself**, and is never
  promoted to evidence.
- **`evidence_received`:** a document or record Brad received, identified
  by a stable reference (proposed: its SHA-256 and file name) and received
  time. For example, a proof-of-funds letter or statement. **Receipt is not
  acceptance.**
- **`brad_decision`:** Brad's explicit, recorded judgment on evidence or on
  the buyer. For example: POF accepted or rejected, identity confirmed,
  qualified or disqualified, selected. Always recorded with its time,
  `operator: brad`, and a reason where the table requires one.

**POF received vs POF accepted:**
- `pof_received` records that a document arrived: the reference, the
  stated amount, the issuing institution as shown, the document date, and
  the received time.
- `pof_accepted` is a separate `brad_decision`. It records Brad's
  determination that the document is authentic enough to rely on, is in the
  buyer's (or the buyer entity's) name, is dated within the freshness
  window, and shows available funds of at least the **required funds** for
  this deal.
- A `pof_rejected` decision (with reason) is equally valid, and ends that
  document's use.

**Qualified Buyer (conservative definition, PROPOSED).** A buyer is
`qualified` for a deal **only** when every one of these holds at the moment
of evaluation:

1. **Identity established** (`brad_decision`): the legal buyer name or
   entity, and the name and role of the person who will sign. Confirmed by
   Brad from evidence, not from a claim.
2. **POF accepted** (`brad_decision` on `evidence_received`):
   - the accepted POF's amount is at least the **required funds** for this
     deal;
   - its document date is within the **freshness window**;
   - both are checked again at read time. If the window lapses, the result
     derives `qualification_expired` and the buyer is no longer qualified.
     No write is needed.
3. **Acquisition path compatible:** the buyer's recorded intent is a cash
   purchase consistent with Board #9's supported path ("Cash Acquisition /
   Assignment Exit"). Financing-contingent intent does **not** qualify in
   V1.
4. **No disqualifying decision** is recorded for this buyer on this deal.
5. **Brad's explicit qualification decision** is recorded after conditions
   1–4 were met. The system gates the decision (it refuses to record
   `qualified` unless 1–4 hold). **It never makes it.**

Anything short of all five is `unqualified`. Buyer claims, a match, a
received but unaccepted POF, engagement or an offer contribute **nothing**
toward qualification.

## 5. Transition table — handoff to Buyer Selected (PROPOSED)

**Common rules for every row:**
- **Authority** is either **System** or **Brad**.
  - **System** means a deterministic, read-time derivation from recorded
    facts. It writes nothing and is recomputed on every read.
  - **Brad** means an explicit action by the authenticated, allowlisted
    Brad application-write session. No other operator, no automation, no AI.
- **Every Brad transition appends exactly one record.** Records are never
  edited or deleted. A correction is a new record that supersedes the
  earlier one by reference (the PB-D43 convention).
- **Every Brad transition:**
  - re-derives its preconditions from a fresh read before writing;
  - refuses a duplicate equivalent record before writing;
  - verifies the new record by fresh readback, as Board #9's handoff does.
- **Failure writes nothing and names the failed precondition.** An
  uncertain write result is reported as uncertain. It is never retried
  blindly and never shown as success.

| # | Current state | Event | Authority | Evidence required | Next state | Failure behavior | Append-only audit record |
|---|---|---|---|---|---|---|---|
| T0 | (none) | A verified disposition handoff exists | System | The handoff note parses, and matches the current Under Contract record and version; no rescission for the version | Deal `disposition_open`; Selection `no_selection` | Invalid or missing handoff: no Board #10 state is shown, and the reason is named | None new. The existing handoff note is the record |
| T1 | Deal `disposition_open`; no match for this buyer | Brad adds a buyer as a candidate | Brad | The buyer is an existing GHL contact in this location, is not the seller contact, and is not already a candidate on this deal | Match `candidate`; Engagement `not_engaged`; Qualification `unqualified` | Refuses a duplicate, the seller as buyer, or a deal that isn't open | `buyer-candidate-added` (deal, buyer contact, at, operator) |
| T2 | Match `candidate`, `criteria_*` | Brad records the buyer's stated buy-box criteria | Brad | The criteria as stated, marked `buyer_claim`, with date and channel | (inputs to T3) | Refuses an empty criteria set, or a claim without date or channel | `buyer-criteria-claim` (verbatim) |
| T3 | Match `candidate` or `criteria_*` | The criteria or deal facts are read | System | The latest `buyer-criteria-claim` compared with the handoff snapshot | `criteria_fit` / `criteria_misfit` / `criteria_insufficient` | Missing data gives `criteria_insufficient`, never a guess | None. Derived; inputs are recorded |
| T4 | Any match except `candidate_removed` | Brad records an engagement fact about his own contact | Brad | Brad attestation: date, channel, and outcome (engaged / interested / not interested / unresponsive) | Engagement per the outcome | Refuses a date in the future, or a missing channel or outcome | `buyer-engagement` (attested) |
| T5 | Any qualification except `disqualified` | Brad records a proof-of-funds document received | Brad | The document reference (SHA-256 and file name), stated amount, issuer as shown, document date, received time: `evidence_received` | Qualification unchanged (receipt is not acceptance) | Refuses a missing reference, amount or document date | `pof-received` |
| T6 | A `pof-received` record exists and has no decision | Brad accepts or rejects that POF | Brad | Brad's review. Accept only if the amount covers the required funds, the date is within the freshness window, and the name matches the buyer or entity; otherwise reject, with reason | Qualification unchanged; the POF is `accepted` or `rejected` | Refuses acceptance when amount, window or name fails. Refuses a decision on an already-decided POF | `pof-decision` (`accepted`/`rejected`, reason) |
| T7 | Any qualification except `disqualified` | Brad confirms the buyer's identity and signer | Brad | The legal name or entity, and the signer's name and role, from evidence Brad names | Qualification unchanged | Refuses a missing entity or signer | `buyer-identity-confirmed` |
| T8 | Qualification `unqualified` or `qualification_expired` | Brad marks the buyer qualified for this deal | Brad (system-gated) | All five §4 conditions hold on a fresh read | Qualification `qualified` | Refuses, naming each unmet condition | `buyer-qualification-decision` (`qualified`, with the POF and identity record references) |
| T9 | Any qualification | Brad disqualifies the buyer for this deal | Brad | A reason | Qualification `disqualified` (terminal for this buyer × deal in V1) | Refuses a missing reason | `buyer-qualification-decision` (`disqualified`, reason) |
| T10 | Qualification `qualified` | The accepted POF's freshness window lapses | System | The read-time date check | `qualification_expired` | None | None. Derived |
| T11 | Match not `candidate_removed`; deal `disposition_open` | Brad records a buyer offer | Brad | The buyer's price, terms, closing timing, earnest money as stated (`buyer_claim`), and the date and channel | Offer `offer_received`. A prior open offer from the same buyer becomes `offer_superseded` | Refuses if the deal isn't open, or any required field is missing | `buyer-offer` (verbatim terms; the superseded offer is referenced) |
| T12 | Offer `offer_received` | The buyer withdraws, or Brad declines | Brad | Brad attestation (withdrawn) or decision (declined), with reason | `offer_withdrawn` / `offer_declined` | Refuses a missing reason | `buyer-offer-status` |
| T13 | Deal `disposition_open`; Selection `no_selection` | **Brad selects the buyer** | **Brad only** | On a fresh read: the buyer is `qualified` (not expired); that buyer has a current `offer_received`; the deal is open; the handoff is still valid | Deal `buyer_selected`; Selection `selected`; that offer `offer_selected` | Refuses, naming each unmet precondition. Never auto-selects or suggests | `buyer-selection` (deal, buyer, offer reference, POF and qualification references, at, operator `brad`) |
| T14 | Any deal state | Rescission lifecycle evidence for this agreement and version | System | The Board #9 lifecycle record, as `evaluateDispositionHandoffEligibility` already reads it | Deal `disposition_halted`. No further Brad transitions are accepted | None | None new. The Board #9 lifecycle record is the record |

**Finish line (V1).** The deal is `buyer_selected`, with its
`buyer-selection` record verified by fresh readback. Board #10 V1 ends
there. Anything after it is Board #11.

## 6. Open decisions (for Brad or Jess; not decided here)

1. **Carrier and location.**
   - Which GHL record holds each proposed record, and in what form. For
     example: deal-level records on the seller contact (where the Board #9
     ledger lives), and buyer-level records on the buyer's contact.
   - Each needs a named write operation and scope review. Notes are the
     only sanctioned general write today (`AGENTS.md`).
2. **Identifying a buyer contact.** How a GHL contact is known to be a
   buyer, given that IAOS may not write tags (HARD NO). Reading an existing
   GHL marker is possible; writing one is not.
3. **Required funds.** The formula POF must cover. For example: the
   buyer's offer price plus the buyer's closing costs, or the offer price
   alone. The seller contract price is the floor.
4. **The POF freshness window.** The number of days.
5. **An offer below the seller contract price.** Refuse it at selection, or
   allow it with Brad's recorded override.
6. **Withdrawing a selection in V1.** Whether Brad may undo `buyer_selected`
   back to `disposition_open` with a reason, or whether that is Board #11.
7. **POF document preservation.** Whether POF bytes are preserved like
   Board #9's executed artifact, or referenced by hash only.
8. **Offer before qualification.** Whether an offer from an unqualified
   buyer may be recorded at all. This draft allows recording it, but not
   selecting it.
