# Buyer Disposition V1 — design contract (DRAFT)

**INV-71 · B10-01.** "Lock Buyer Disposition V1 contract, state machine,
qualification rules, and finish line."

**Status: DRAFT, revision 3 (after Jess's review of revision 2, 2026-09-30).**
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
  (T5a–T5c, §5a). Brad picks that one buyer, that channel and that exact content,
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

**Buy-box evidence classes (INV-71 requires four; revision 3 adds the
structure).**
- Every `buyer-criteria-claim` (T3) carries exactly **one** of the four
  buy-box evidence classes INV-71 defines. Match (T4) and gate G2 evaluate
  criteria per class.
- **PENDING: the four class names, and which of them may satisfy G2, come
  from the INV-71 issue text.** Jeff couldn't read it (the Linear
  connection needs re-authentication), so no class is named or ranked here.
- **Placeholders:** until then the schema carries `evidenceClass` with four
  placeholder values, `B1`–`B4`. G2 treats every criteria claim as
  `buyer_claim` provenance: necessary, never sufficient.

**Funds and POF freshness (PROPOSED concrete rules, for Brad's
confirmation).**
- **Required funds** for a buyer on a deal identity =
  **that buyer's current offer price** (the latest un-superseded `buyer-offer`)
  **+ the end-buyer closing-cost allowance**.
- **The allowance** is the resolved underwriting input `closingCost`, which
  is exactly "End-Buyer Purchase/Closing Costs" in the underwriting
  computation (`app/src/lib/underwriting/compute.ts:216`, OBSERVED). Its
  policy default is 2500, from the GHL custom value
  `default_closing_cost_estimate`, and it can be overridden per deal
  (`docs/UNDERWRITING_FIELD_REFERENCE.md`). It is read at check time for
  this opportunity.
- **No fallback.** If the buyer has no current offer, or the allowance is
  unresolved, **G4 cannot pass**.
- **Coverage is a read-time check, not a stored verdict.** G4 passes only
  while an accepted POF's stated amount is at least the *current* required
  funds. An upward offer revision re-tests it automatically. So in V1,
  qualification requires a current offer.
- **POF freshness window: 30 days.** A POF's document date must not be in
  the future, and must be no more than 30 days before the time of the
  check. It is checked at T8, at T11, at T17 and at every read, so a POF
  that ages out lapses qualification (T12) without a write.
- **Seller-price relationship: undecided.** These rules set no relationship
  between an offer and the seller contract price. That offer-economics rule
  remains open (§7).

**Qualification gates (PROPOSED).** Each is checked on a fresh read, both
when the qualification decision is recorded and again at every later read.

| Gate | Requirement | Provenance that can satisfy it |
|---|---|---|
| **G1 Usable buyer contact** | The buyer's GHL contact has at least one contact method that isn't DND for its channel. Brad has recorded that the buyer was actually reached and responded on it (a T6 `responded` fact) | `brad_decision` on engagement facts |
| **G2 Deal-criteria fit** | Match is `criteria_fit` against the **accepted** handoff snapshot for this deal identity, evaluated per buy-box evidence class (class rules PENDING, from INV-71) | System derivation. Fit is necessary, never sufficient |
| **G3 Identity** | The legal buyer name or entity, and the signer's name and role, confirmed by Brad from named evidence | `brad_decision` |
| **G4 Funds** | An accepted POF's stated amount is at least the current required funds (offer price + end-buyer closing-cost allowance), and its document date is inside the 30-day window | `brad_decision` on `evidence_received`, plus a read-time computation |
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
| T2b | Match not `candidate_removed` | Brad removes a buyer candidate | Brad | A reason | Match `candidate_removed` (terminal for this buyer × deal identity) | Refuses a missing reason | `buyer-candidate-removed` |
| T5a | Deal `disposition_ready`; Match not `candidate_removed`; **no unresolved send for this buyer × deal (§5a)** | **Brad authorizes one outreach send: reserve** | **Brad only** | Brad selects this buyer, one channel and the exact content. The channel's contact method exists and isn't DND | Send `reserved` (nothing sent yet) | Refuses a missing selection, DND, a removed candidate, a deal that isn't ready, or an existing unresolved send. If the reservation isn't confirmed by readback, **nothing is sent** | `buyer-outreach-reservation` (sendId, buyer, channel, verbatim content hash and text, at, operator `brad`) |
| T5b | Send `reserved` | Send, then provider readback | System, executing Brad's T5a authorization exactly once | The reservation read back. One provider send call for that sendId. A fresh provider readback of the message | `sent_confirmed` → Engagement `contacted`; or `refused` (definite pre-acceptance refusal); or `uncertain` | **Never retried.** A timeout, network error, ambiguous response or failed readback gives `uncertain`. Partial success is also treated as `uncertain`: the send may have happened, but the outcome record wasn't written or wasn't read back | `buyer-outreach-outcome` (sendId, outcome, provider message ref if any, at) |
| T5c | Send `uncertain`, or a reservation with no outcome record | **Brad resolves the uncertain send** | Brad | Brad's check of the buyer's GHL conversation for that sendId's content, recorded as `confirmed_sent` (with the provider message ref) or `confirmed_not_sent` | `confirmed_sent` → Engagement `contacted`; `confirmed_not_sent` → no engagement change | Refuses a missing basis. A resend is **never** part of T5c: after `confirmed_not_sent` or `refused`, a new send is a new T5a with a new sendId and re-approved content | `buyer-outreach-resolution` (sendId, resolution, basis) |
| T6 | Any engagement | Brad records an engagement fact | Brad | Brad attestation: date, channel, and outcome (`responded`, `interested`, `not_interested`, `unresponsive`) | Engagement per the outcome | Refuses a future date, or a missing channel or outcome | `buyer-engagement` |
| T7 | Qualification not `disqualified` | Brad records a POF received | Brad | The reference (SHA-256 and file name), stated amount, issuer as shown, document date, received time | Qualification unchanged | Refuses a missing reference, amount or date | `pof-received` |
| T8 | A `pof-received` record with no decision | Brad accepts or rejects that POF | Brad | Accept only if Brad judges it reliable, the name matches the buyer or entity, and its document date is within the 30-day window; otherwise reject, with reason. Coverage of required funds is **not** decided here: G4 tests it at read time against the current offer | That POF is `accepted` or `rejected` | Refuses an acceptance with a stale or future date or a name mismatch, or a second decision on the same POF | `pof-decision` |
| T9 | Qualification not `disqualified` | Brad confirms identity and signer | Brad | The legal name or entity, and the signer's name and role, from named evidence | (gate G3) | Refuses a missing entity or signer | `buyer-identity-confirmed` |
| T10 | Qualification not `disqualified` | Brad records ability to meet closing | Brad | The buyer's committed closing date (`buyer_claim`) plus Brad's decision and basis. Requires the date to be on or before the handoff `closingDate` | (gate G5) | Refuses if `closingDate` is `unresolved`, the committed date is later, or the basis is missing | `buyer-closing-capability` |
| T11 | Qualification `unqualified` or `qualification_lapsed` | **Brad records the qualification decision** | Brad (system-gated) | G1–G7 all pass on a fresh read | Qualification `qualified` | Refuses, naming each failing gate. Never records on its own | `buyer-qualification-decision` (`qualified`, with references to every gate-satisfying record) |
| T12 | Qualification `qualified` | A relied-on gate stops passing (for example: POF older than 30 days, offer raised above POF coverage, contact now DND) | System | Read-time re-check of G1–G7 | `qualification_lapsed` | None | None. Derived |
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

### 5a. Outreach sends — partial success and uncertainty (T5a–T5c)

The pattern mirrors Board #9's reserve-then-execute send path
(`ghl-contract-send-reserve.ts`, `ghl-contract-send-execute.ts`, OBSERVED
to exist). The mechanism is still an open decision (§7).

- **One authorization, one send.** A T5a reservation authorizes exactly one
  provider send call for its `sendId`, once. Nothing re-sends it: not a
  retry, a reload, a second click, another browser or another operator.
- **Terminal outcomes:**
  - `sent_confirmed`: fresh provider readback shows the message;
  - `refused`: a definite refusal before the provider accepted anything;
  - `confirmed_sent` / `confirmed_not_sent`: Brad's T5c resolution.
- **Everything else is `uncertain`,** including:
  - a timeout or network error after the call left;
  - an ambiguous provider response;
  - a failed or unavailable readback;
  - a reservation with no outcome record, for example an interrupted
    function or a failed outcome write. This is the partial-success case.
- **An unresolved send blocks further outreach.** While any send for a
  buyer × deal identity is `reserved` or `uncertain`, T5a refuses every new
  send to that buyer, on **every** channel, until Brad resolves it (T5c). A
  later read showing the message doesn't resolve it by itself; Brad's T5c
  does.
- **No blind retry, ever.** A new message after `refused` or
  `confirmed_not_sent` is a new T5a, with a new `sendId` and content Brad
  approves again.
- **A reservation doesn't count as contact.** Only `sent_confirmed` and
  `confirmed_sent` set Engagement `contacted`.

### 5b. Factual, reason-coded comparison (System, read-only)

- **What it is.** Board #10 may present candidate buyers and their offers
  side by side, as **facts with reason codes**. It writes nothing, and it
  never selects, pre-selects or recommends. **Selection stays T17, Brad
  only.**
- **Permitted content, per buyer or offer:**
  - each gate G1–G7 as `PASS` or `FAIL:<code>`. For example:
    - `G1_FAIL_NO_RESPONSE`, `G1_FAIL_DND`;
    - `G2_FAIL_MISFIT`, `G2_FAIL_INSUFFICIENT`;
    - `G4_FAIL_NO_OFFER`, `G4_FAIL_ALLOWANCE_UNRESOLVED`, `G4_FAIL_SHORT_BY:<amount>`,
      `G4_FAIL_POF_STALE:<days>`;
    - `G5_FAIL_AFTER_SELLER_CLOSING`, `G5_FAIL_CLOSING_UNRESOLVED`;
  - offer facts as recorded:
    - price;
    - earnest money;
    - committed closing date, with its relation to the seller closing
      date (`CLOSES_ON_OR_BEFORE` / `CLOSES_AFTER`);
    - POF days remaining;
    - required funds and the POF stated amount;
    - the plain signed difference *offer price − seller contract price*.
      Shown as a number only, with no pass/fail, color or judgment,
      because that economics rule is undecided (§7);
  - `SELECTABLE`, or `NOT_SELECTABLE:<codes>`, stating exactly which T17
    preconditions fail.
- **Prohibited:**
  - any score, weight, composite or index;
  - ranking or ordering by desirability. The default order is the offer's
    received time; Brad may sort by any **single** factual column;
  - "best", "recommended", "top" or similar labels, or highlighting;
  - any AI-generated assessment;
  - any automatic action taken from the comparison.

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
| **Rescission** of this agreement/version | Brad-only; this agreement is terminal | **Halted** (T20), terminal for the identity; any selection is `selection_void` in IAOS. Buyer communication about it is a separate Brad-authorized send (T5a–T5c), never automatic |
| **Expired / Declined** | Pre-execution outcomes | **Not applicable.** They cannot follow a verified Under Contract for the same version (INFERRED from the state order; confirm with Jess) |

**IAOS makes no legal determination.** As in Board #9, these states govern
IAOS's own downstream behavior only. They never declare a buyer arrangement
legally void or superseded.

## 7. Open decisions (for Brad or Jess; not decided here)

1. **Carriers and locations: confirm or amend the proposal in §8.** Each
   record still needs a named write operation and scope review.
   `ghl.notes.create()` is the only sanctioned general write today.
2. **The outreach send mechanism (T5a–T5c).** Which GHL send path is used, and
   its named operation, Production scope and proof. Is a send in Board #10
   V1, or only recorded?
3. **Identifying a buyer contact,** given that IAOS may not write tags.
4. **Required funds (G4): confirm or amend the proposal in §4.** Offer
   price + the end-buyer closing-cost allowance (underwriting `closingCost`),
   with no fallback.
5. **The POF freshness window (G4): confirm or amend the proposed 30 days**
   (§4).
6. **The closing margin (G5).** Whether a buffer before the seller closing
   date is required.
7. **Offer economics: undecided.** Whether any relationship between an
   offer and the seller contract price constrains selection, and if so,
   what. This contract asserts none. The comparison (§5b) shows only the
   plain signed difference.
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
13. **The four buy-box evidence class names** and their G2 rules, from the
    INV-71 issue text (§4). Currently placeholders `B1`–`B4`.

## 8. Record scope and schema versions (PROPOSED)

**Carrier.** Every Board #10 record is a GHL note, following the
append-only `IAOS … — iaos-<kind>-vN` note pattern Board #9 uses (OBSERVED
in the pinned fixture's ledger).

**Location, one ledger per deal.** Records are written on the **seller
contact** that already holds the deal's Board #9 ledger.
- **No Board #10 record is written to a buyer contact.** The only thing
  that reaches a buyer contact is a Brad-authorized message (T5b).
- Buyers are identified inside each record by `buyerContactId`.
- V1 has no cross-deal reuse. Re-entry reuse (§6) stays within the same
  opportunity, and so the same seller contact.

**Common scope keys, on every record:**
- `recordId`: a UUID;
- `opportunityId`, `agreementAt` and `versionSeq`: the deal identity;
- `at`: an ISO instant;
- `operator`: `brad`, for Brad records.

Where applicable, records also carry `buyerContactId`, and `supersedes` or
`revokes`, a `recordId` reference.

| Record | Schema version | Written by | Extra scope keys | Required content |
|---|---|---|---|---|
| Disposition acceptance | `iaos-b10-disposition-acceptance-v1` | T1, T21 | `handoffNoteId`, `priorIdentity?` | the result of each re-verification check |
| Buyer candidate added | `iaos-b10-buyer-candidate-v1` | T2 | `buyerContactId` | — |
| Buyer candidate removed | `iaos-b10-buyer-candidate-removed-v1` | T2b | `buyerContactId` | reason |
| Buyer criteria claim | `iaos-b10-buyer-criteria-claim-v1` | T3 | `buyerContactId`, `supersedes?` | criteria verbatim, `evidenceClass` (B1–B4, names PENDING), date, channel |
| Outreach reservation | `iaos-b10-outreach-reservation-v1` | T5a | `buyerContactId`, `sendId` | channel, content text, content SHA-256 |
| Outreach outcome | `iaos-b10-outreach-outcome-v1` | T5b | `buyerContactId`, `sendId` | `sent_confirmed` / `refused` / `uncertain`, provider message ref if any |
| Outreach resolution | `iaos-b10-outreach-resolution-v1` | T5c | `buyerContactId`, `sendId` | `confirmed_sent` / `confirmed_not_sent`, basis, provider message ref if sent |
| Engagement fact | `iaos-b10-buyer-engagement-v1` | T6 | `buyerContactId` | date, channel, outcome |
| POF received | `iaos-b10-pof-received-v1` | T7 | `buyerContactId`, `pofId` | file SHA-256, file name, stated amount, issuer as shown, document date, received time |
| POF decision | `iaos-b10-pof-decision-v1` | T8 | `buyerContactId`, `pofId` | `accepted` / `rejected`, reason |
| Identity confirmed | `iaos-b10-buyer-identity-v1` | T9 | `buyerContactId`, `supersedes?` | legal name or entity, signer name and role, evidence named |
| Closing capability | `iaos-b10-buyer-closing-capability-v1` | T10 | `buyerContactId`, `supersedes?` | committed closing date, basis |
| Qualification decision | `iaos-b10-qualification-decision-v1` | T11, T13 | `buyerContactId` | `qualified` (with refs to the records satisfying G1–G7) / `disqualified` (reason) |
| Decision revocation | `iaos-b10-decision-revocation-v1` | T14 | `revokes` | reason |
| Buyer offer | `iaos-b10-buyer-offer-v1` | T15 | `buyerContactId`, `offerId`, `supersedes?` | price, terms, earnest money, committed closing date, date, channel |
| Offer status | `iaos-b10-offer-status-v1` | T16 | `buyerContactId`, `offerId` | `withdrawn` / `declined`, reason |
| Buyer selection | `iaos-b10-buyer-selection-v1` | T17 | `buyerContactId`, `offerId` | refs: qualification decision, acceptance |

**Rules that apply to every record:**
- **Unknown versions are refused.** A record whose version is unknown to
  the reader is refused, and never guessed at.
- **Schema changes create a new version.** A later schema is a new `-vN`.
  Earlier versions stay readable, following Board #9's pattern.
- **Writes still need approval.** None of these may be written until each
  has a named write operation, a Production scope entry, and a guard in
  the server's note validation.
