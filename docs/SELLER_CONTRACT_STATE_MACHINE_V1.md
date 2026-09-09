# Seller Contract State Machine V1 — B9-01 / INV-56

## What this document is

The implementation-ready Board #9 product contract, locked before any
contract-generation, e-sign, or provider work begins. This is
**documentation and product-contract work only** — no code, no carrier,
no UI, no Production access. It follows the same pattern INV-44 set for
`DEAL_ECONOMICS_OFFER_READINESS_V1.md`: name the state machine precisely,
cite what already exists rather than re-describe it, and name every
remaining Product Owner decision explicitly rather than resolve it by
assumption (FOUNDATIONAL_PRINCIPLES principle 19). This revision
incorporates Brad's rulings on all six decisions the first version of
this document left open (2026-09-08) — each is now locked at the state it
governs, and the "Product Owner decisions" section below records them as
resolved rather than open.

This document **narrows** the deferral `SELLER_ACQUISITION_WORKFLOW.md`
already named — "Contract Readiness — DISTINCT, DETAIL DEFERRED... the
gate's precise definition belongs to contracting work that has not
begun" — and the same deferral `DEAL_ECONOMICS_OFFER_READINESS_V1.md`
explicitly declined to narrow further ("Its detailed definition remains
deferred to contracting work that has not begun... This contract does
not narrow that deferral further"). INV-56 is that contracting work.

## What already exists — this document does not re-decide it

**Agreement Reached is already real, already shipped, already durable.**
B8-10 / INV-53's `seller-call-outcome.ts` writes an `accept`-kind outcome
note through the existing, sanctioned `ghl.notes.create()` write. Its
`OutcomeSnapshot` captures `currentOffer` (the accepted price — the
existing negotiation value, never a second competing field, per that
module's own header: "ACCEPTED PRICE IS THE EXISTING CURRENT OFFER, NEVER
A NEW FIELD"), `sellerPosition`, `targetAcquisitionPrice`,
`maxSupportedOffer`, `expectedSpread`, `arv`, `repairs`, and
`readinessStatus` — all copied verbatim from Board #8's own engines at
the moment of acceptance, never recomputed. The note's own embedded
timestamp (`at`) is the durable agreement identity — already reused as
`agreementAt` by INV-68's Contract Ready checklist carrier.

**Contract Ready's checklist is already real, already durable, already
scoped correctly.** `seller-call-readiness-carriers.ts` Section 7
(`CONTRACT_READY_ITEM_KEYS`: `legal_owners`, `closing_timeline`,
`occupancy_possession`, `liens_title`, `delivery_signing`) plus agreed
price and property address, scoped to the specific `agreementAt` —
proven live (INV-68) that a new agreement at the same price/address does
not inherit a prior agreement's progress, and that reopening the same
agreement preserves it. The Seller Call Workspace already renders this
checklist under an "AGREEMENT REACHED ... not yet Under Contract" banner,
labeled explicitly: **"Board #9 completes the transaction; this is a
handoff, not contract software."**

This document defines the states **from Contract Ready onward that do
not yet exist** — Contract Sent, Under Contract, and the terminal/branch
states — and formalizes Contract Ready's own entry rule precisely,
without touching any of the above.

---

## The state machine

**Agreement Reached → Contract Ready → Contract Sent → Under Contract**,
frozen in that order, per INV-56's own authoritative-state-machine
clarification. Branch/terminal states — Corrected, Rescinded, Expired,
Declined — are defined after the four primary states.

### Agreement Reached

**Meaning.** The seller has accepted the negotiated price and terms.
Board #8's negotiation is complete for this specific agreement.

**Entry evidence.** An `accept`-kind outcome note exists for the
Opportunity (`seller-call-outcome.ts`, already shipped). Nothing new.

**Authority.** The operator, gated on `readiness.effectiveStatus ===
OFFER_READY` (already proven — a legitimate human `OVERRIDDEN` result
still resolves `effectiveStatus` to `OFFER_READY` and unlocks Accept).
Already shipped; unchanged here.

**Transition trigger.** Already shipped: the existing Accept action.

**Failure behavior.** Already governed by the existing fail-closed
pattern this codebase applies everywhere a durable write backs a
readiness-relevant state (see INV-68's invalidation-write correction): if
the outcome note fails to persist, Agreement Reached does not exist —
GHL is the sole system of record (FOUNDATIONAL_PRINCIPLES principle 15),
so there is no optimistic local state to fall back to. Nothing new is
authorized here; this document states the existing principle applies.

**Audit.** The outcome note itself — append-only, versioned, embedded
timestamp is the durable agreement identity (`agreementAt`).

### Contract Ready

**Meaning.** Agreement Reached, **and** every pre-paperwork fact the
existing checklist requires is confirmed for this specific agreement:
correct legal owners, closing timeline, occupancy/possession, known
liens/title complications (disclosure-level — see "Contract Execution
Details vs. Closing Ready" below), and delivery/signing information —
plus the agreed price and property address the checklist already
verifies against the agreement record.

**Entry evidence.** All five `CONTRACT_READY_ITEM_KEYS` true, scoped by
`agreementAt`, exactly as already implemented and proven.

**Contract Ready is a DERIVED state, not a separately persisted flag.**
Consistent with FOUNDATIONAL_PRINCIPLES principle 14 ("derive for
display, persist decisions") and the identical design choice
`DEAL_ECONOMICS_OFFER_READINESS_V1.md` already made for Offer Ready
itself: Contract Ready is a live read of Agreement Reached plus the five
checklist items, recomputed whenever any of them changes — never a sixth
persisted "Contract Ready = true" note that could drift from the facts
that supposedly produced it. This is a design choice this document makes
explicitly, not an invented mechanism: the checklist items are already
individually persisted (per-item, already durable); Contract Ready's
*aggregate* state does not need its own carrier any more than Offer
Ready's did.

**Authority.** The operator, checking each item individually. Already
shipped; unchanged here.

**Transition trigger.** Already shipped: checking the fifth remaining
item. No new mechanism authorized.

**Failure behavior.** Already governed by the existing carrier's
fail-closed validation (exact schema, exact `agreementAt` match, no
silent carry-over). Nothing new authorized here.

**Audit.** The existing per-item checklist notes, scoped to
`agreementAt`.

### Contract Sent

**Meaning.** Brad has explicitly reviewed and authorized sending the
prepared agreement to the seller for execution, and the agreement has
been transmitted. The agreement is **not yet** executed — Contract Sent
and Under Contract are distinct, per this issue's own locked invariant.

**Entry evidence — locked (Brad ruling, 2026-09-08).** Three facts, all
required:
1. **Brad's explicit send authorization** — a durable record of who
   authorized the send and when. Verbal or in-app acceptance earlier in
   the flow (Agreement Reached) is never sufficient; this is a
   *separate*, explicit act specific to authorizing transmission of the
   actual contract document, per this issue's locked invariant ("Brad
   explicitly authorizes sending the agreement").
2. **A confirmed provider transmission identifier and timestamp** — the
   specific evidence transmission requires, locked here: an identifier
   the provider itself assigns to the sent envelope/document, and the
   timestamp the provider reports it was sent. Authorization alone,
   without this identifier and timestamp, never reads as Contract Sent
   (see Failure behavior).
3. **An explicit expiration date/time**, established at or before send —
   the entry point for Expired's own automatic derivation below.

**What this document does not decide, and does not need to:** which
provider is used, and whether this GHL location's Documents & Contracts
capability can merge the specific per-deal Opportunity fields Board #9
needs. `UNDERWRITING_WORKSPACE_SPEC.md` already flags the latter as
**unverified**, not merely undecided — a factual/technical gap, not a
product-policy one. **Provider selection and capability verification are
INV-57's job**, not a remaining Product Owner decision — the evidence
*shape* (identifier + timestamp) this document locks is provider-agnostic
and constrains whichever provider INV-57 selects.

**Authority.** Brad, explicitly, per the locked invariant. Never
automatic, never inferred from Contract Ready alone, regardless of which
provider the future carrier uses.

**Transition trigger IN.** Brad's send authorization, plus the provider
transmission identifier and timestamp, plus the expiration date/time —
all three, together. Which provider supplies the identifier/timestamp is
INV-57's determination, not this document's.

**Transition trigger OUT.** To Under Contract (verified full execution,
below), or to Rescinded/Expired/Declined (below), or superseded by a new
cycle if a material correction is found before full execution (see
Corrected below — correction is not limited to after Under Contract). No
path back to Contract Ready or Agreement Reached for the *same*
agreement — see No-reentry below.

**Failure behavior.** If authorization is recorded but no provider
transmission identifier/timestamp is obtained, the state must read as
"send authorized, not yet confirmed sent" — never silently promoted to
Contract Sent. This is a distinct, visible state from both Contract Ready
(transmission never attempted) and Contract Sent (transmission
confirmed), so an operator can tell "needs retry" from "awaiting
signature."

**Audit.** Who authorized the send and when; the provider transmission
identifier and timestamp; the expiration date/time established — all
append-only.

### Under Contract

**Meaning.** The agreement has been fully executed by every required
party. This is the only state in which IAOS treats the deal as a binding
contract. Per this issue's own locked invariant: **verbal or text
acceptance never means Under Contract** — only verified full execution
does, and **only verified full execution can create Under Contract.**

**Entry evidence — locked (Brad ruling, 2026-09-08).** Three facts, all
required jointly — no single one, nor any two, is sufficient:
1. **Every required signer has completed execution.** Not "sent," not
   "some signatures received" — every party the agreement requires.
2. **The provider reports completion.** The provider's own completion
   signal is required in addition to (1) — per-signer completion and the
   provider's own completion report are two distinct facts, both
   required; neither substitutes for the other. Which provider, and the
   exact technical form its completion report takes, is INV-57's
   determination, not this document's.
3. **The executed document is successfully preserved** — per the
   preservation requirement locked below ("GHL as the sole system of
   record"): the document itself (or a verified GHL-native authoritative
   reference to it), together with the provider/envelope identifier,
   completion time, contract version, and an integrity identifier.

**No single signal alone creates Under Contract.** All three are
required together; any one or two present without the third means Under
Contract has not been reached.

**Authority.** System-observed — the joint signal of (1), (2), and (3)
together, never a human "mark as complete" action standing in for any of
the three. A human may still need to initiate or acknowledge receipt of
the provider's report, depending on the provider INV-57 selects, but that
acknowledgment cannot substitute for any of the three required facts.

**Transition trigger IN.** All three facts above, together.

**Transition trigger OUT.** None, in the successful case — Under
Contract with all three facts preserved is this document's terminal
success state for the executed version. **Corrected** (below) supersedes
it with a new version when a material correction is found — see
Corrected for what that means for the prior version's status.

**Failure behavior.** Any of the three facts missing, ambiguous, or
unconfirmed must never read as Under Contract — fail closed, exactly as
this codebase already does everywhere a durable state gates downstream
authority (the Offer-Ready-decision-invalidation pattern is the direct
precedent, not a new one invented here). Per-signer completion without a
provider completion report, or a provider report without confirmed
preservation, are both explicitly insufficient — this is the locked
answer to what was previously an open question here.

**Audit.** The preserved executed document (or verified GHL-native
authoritative reference) together with the provider/envelope identifier,
completion time, contract version, and integrity identifier — durably
retrievable, immutably tied to this specific agreement, with an
append-only record of any later Corrected supersession.

---

## Branch and terminal states

### Corrected

**Meaning.** A material correction to the agreement is found after it was
sent — a "post-send correction," which may be discovered whether or not
the prior version has already reached Under Contract.

**Locked here (Brad ruling, 2026-09-08): no addendum shortcut in V1.**
Any material post-send correction **voids or supersedes the prior
contract version** and **requires a complete new execution cycle** — a
fresh pass through Contract Sent and Under Contract for the corrected
version, with its own send authorization, its own provider transmission
identifier/timestamp, its own expiration date/time, and its own
three-fact verified-execution requirement. There is no lighter
addendum path that patches a term without a full new cycle. If the
prior version had already reached Under Contract, that version's
executed-document record is preserved (never destroyed or replaced) but
is superseded — the corrected version is now the operative one, and the
prior version's history remains part of the permanent, append-only
record, mirroring the pattern already proven throughout this codebase
(`ARV_EVIDENCE_SNAPSHOT_V1.md`, `seller-call-outcome.ts`, INV-68's
invalidation ledger).

**Not decided here:** which categories of change are material enough to
require this process versus genuinely immaterial (a typo with no effect
on any term) — this document locks the *consequence* of a material
correction, not the threshold for what counts as one. A narrow,
implementation-facing question for INV-57, not a state-machine ambiguity.

### Rescinded

**Meaning.** The agreement — at any stage from Contract Ready onward —
is withdrawn or cancelled before or after execution, by mutual agreement
or a party's unilateral action.

**Authority — locked (Brad ruling, 2026-09-08): Brad-only in V1.** No
other operator or role may record a Rescission for V1.

**Entry evidence / Audit — locked.** The complete history is preserved
(append-only, nothing overwritten or destroyed), recording: the
timestamp of the rescission, the reason, the operator (Brad, per the
authority rule above), and the affected contract and version
(`agreementAt` plus the specific contract version if a Corrected
supersession has already occurred).

**No-reentry.** Once Rescinded, this specific agreement (`agreementAt`)
is terminal. See No-reentry disposition handoff below.

### Expired

**Meaning.** A Contract Sent agreement's established expiration date/time
passes without verified full execution.

**Entry evidence / mechanism — locked (Brad ruling, 2026-09-08).** Contract
Sent's own entry evidence now locks an explicit expiration date/time,
established at or before send (see Contract Sent above) — not a fixed
global window. **Expired is derived automatically**: the moment that
established timestamp passes without the three-fact verified-execution
requirement (above) having been met, the agreement reads as Expired, with
no explicit operator action required to assert it — consistent with
Offer Ready's own automatic revocation (FOUNDATIONAL_PRINCIPLES principle
14). This is the same principle applied to a per-agreement timestamp
that is itself an explicit, recorded fact (never a manufactured default
window), so FOUNDATIONAL_PRINCIPLES principle 19 is satisfied: the
derivation rule is precise, and the input it derives from is always an
explicit, operator-established fact, never an invented constant.

**No-reentry.** Once Expired, this specific agreement is terminal. See
below.

### Declined

**Meaning.** The seller explicitly declines to execute the sent
agreement — a stated refusal, not a timeout (that is Expired's concern,
not this one's).

**Entry evidence.** An explicit, operator-recorded fact that the seller
declined — never inferred from silence or elapsed time.

**No-reentry.** Once Declined, this specific agreement is terminal. See
below.

### No-reentry disposition handoff

Once any terminal state is reached for a given agreement
(`agreementAt`) — Under Contract with all three verified-execution facts
preserved, Rescinded, Expired, or Declined — the Seller Call negotiation
surface (Board #8) must not reopen or renegotiate *that specific
agreement*. This is a direct, consistent extension of INV-68's
already-proven rule that a new agreement at the same price and property
does not inherit a prior agreement's progress: pursuing this seller again
after a terminal non-Under-Contract state requires a genuinely new
Agreement Reached (a new `agreementAt`), never a reopening of the
terminal one.

**Corrected is the sole controlled exception to "terminal," and it is
not itself a reopening of Board #8 negotiation.** A material post-send
correction — locked above to void/supersede the prior version and require
a complete new execution cycle — creates a *new version* of the same
underlying agreement, never a return to Seller Call negotiation. This
applies whether the correction is found while still in Contract Sent
(not yet Under Contract) or after Under Contract was reached; either way,
the new cycle starts from a fresh Contract Sent, never from Agreement
Reached or Contract Ready.

---

## Contract Execution Details vs. later Closing Ready / title-clearance information

Per `SELLER_ACQUISITION_WORKFLOW.md`'s own instruction ("Separate facts
required to prepare and execute the seller agreement from facts required
later for title clearance or closing... do not silently turn Closing
Ready into Contract Ready"):

**In scope for this document (Contract Execution Details):** party
identity and signing authority discovered during the call, the agreed
price and terms (consumed from Board #8, see below), closing timeline,
occupancy/possession terms, delivery/signing mechanics, the fact that
known liens/title complications were disclosed and reviewed (a
disclosure-level fact — the operator is aware of them, not that they are
resolved), verified execution status, and the preserved executed
document.

**Out of scope, deferred to future Closing Ready work:** title search
results, lien payoff verification and amounts, insurance, funds
disbursement, and actual closing completion. The existing "Known liens
and title complications reviewed" checklist item is disclosure only; its
resolution is Closing Ready's concern, not Contract Ready's, and this
document does not pull it forward.

## Consuming Board #8 economics, never recomputing them

Agreement Reached's accepted price is exactly `OutcomeSnapshot.
currentOffer`, captured verbatim at acceptance — never a second,
competing "contract price" field, through Contract Ready and Contract
Sent. `UNDERWRITING_WORKSPACE_SPEC.md` already names the one point where
this can legitimately diverge: **Actual Contract Price**, "a fact about
an executed agreement... contracting is authoritative for it" — relevant
only once Under Contract, and only if the executed terms differ from
what was accepted (e.g., a last-minute change during signing). Any such
divergence is a material post-send correction — exactly what the
Corrected state (above) now locks as voiding/superseding the prior
version and requiring a complete new execution cycle, never a soft
addendum; this document does not invent a new pre-execution price field.

## GHL as the sole system of record

No new IAOS-side database or shadow copy of contract state is authorized
here (FOUNDATIONAL_PRINCIPLES principle 15). **Locked here (Brad ruling,
2026-09-08): GHL remains authoritative for executed-document
preservation.** The preserved record for Under Contract (and for each
Corrected version) must be the executed document itself — or a verified
GHL-native authoritative reference to it — together with the
provider/envelope identifier, completion time, contract version, and an
integrity identifier, exactly as Under Contract's own entry evidence
above requires. **INV-57 must verify and select the supported
mechanism** for satisfying this requirement (a GHL-native Documents &
Contracts object, a GHL file/attachment holding a verified reference, or
another mechanism GHL actually supports for this location) — this
document locks *what* must be preserved and alongside *which* fields,
not *how* GHL stores it. This document authorizes no carrier; it defines
what a future carrier (INV-57's scope) must satisfy.

---

## Product Owner decisions — resolved (Brad ruling, 2026-09-08)

The six decisions this document originally left open are now locked, and
are incorporated at each state above rather than repeated here in full:

1. **Contract Sent's entry evidence** is Brad's explicit authorization
   plus a confirmed provider transmission identifier and timestamp.
   Provider selection and capability verification belong to INV-57.
2. **Verified full execution** requires all three of: every required
   signer completed execution, the provider reports completion, and the
   executed document is successfully preserved. No single signal alone
   creates Under Contract.
3. **Rescission** is Brad-only authority in V1; the complete history is
   preserved, recording timestamp, reason, operator, and the affected
   contract/version.
4. **Expiration** uses an explicit expiration date/time established at or
   before send; Expired is derived automatically once that timestamp
   passes without verified full execution.
5. **Correction** after send is locked to void/supersede the prior
   contract version and require a complete new execution cycle — no
   addendum shortcut in V1.
6. **Document preservation** remains GHL-authoritative: the executed
   document, or a verified GHL-native authoritative reference, must be
   preserved together with the provider/envelope identifier, completion
   time, contract version, and an integrity identifier. INV-57 must
   verify and select the supported mechanism.

**No product-policy decision remains open in this document.** What
remains is exclusively implementation-level determination for INV-57 —
narrower, technical, and already correctly scoped to that future issue
rather than to this contract:

- Which e-sign (or equivalent) provider to use, and verifying its
  capability against this GHL location (`UNDERWRITING_WORKSPACE_SPEC.md`'s
  already-flagged, unverified Documents & Contracts capability gap).
- The exact technical form of "the provider reports completion" for
  whichever provider is selected.
- Which GHL-native mechanism satisfies the document-preservation
  requirement locked above.
- Where the line sits between an immaterial correction (no new cycle
  needed) and a material one (Corrected's full new-cycle process) —
  this document locks the *consequence* of a material correction, not
  the classification threshold itself.

None of these are ambiguous state transitions or authority boundaries —
every transition trigger, every authority, and every failure behavior
above is fully specified regardless of which provider or GHL mechanism
INV-57 ultimately selects.

---

## Hard boundary, restated

This document is a locked product contract, not an implementation. It
authorizes no carrier, no UI control, no e-sign provider integration, no
Production access or mutation, and no work on INV-57 / B9-02 or any
downstream disposition/closing issue. It does not alter `offer-readiness.ts`,
the Offer Ready aggregation rule, `NegotiationOverride`, or anything
INV-55/INV-68/INV-69 already shipped and closed. Legal language and
contract terms are never drafted here or anywhere in IAOS — this document
defines *state, authority, and evidence*, not contract text.

---

## Provenance

This document restates, without reinterpretation, INV-56's own issue
body — the Board #9 Product Owner ruling for this first RESET issue — and
cites, without amending, `SELLER_ACQUISITION_WORKFLOW.md`'s existing
Contract Readiness framing, `DEAL_ECONOMICS_OFFER_READINESS_V1.md`'s
existing Offer Ready / Contract Ready boundary, `UNDERWRITING_WORKSPACE_
SPEC.md`'s existing CONTRACTING-READY section and Actual Contract Price
concept, and FOUNDATIONAL_PRINCIPLES.md principles 14, 15, and 19. It
cites, without altering, the already-shipped and already-Done
`seller-call-outcome.ts` (B8-10/INV-53) and `seller-call-readiness-
carriers.ts` Section 7 (INV-68) as the existing Agreement Reached and
Contract Ready mechanisms. Per AGENTS.md's resolution order step 2, later
Board #9 work should build against this written contract rather than
against conversation memory or INV-56's issue text directly.
