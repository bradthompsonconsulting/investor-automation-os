# Seller Contract State Machine V1 — B9-01 / INV-56

## What this document is

The implementation-ready Board #9 product contract, locked before any
contract-generation, e-sign, or provider work begins. This is
**documentation and product-contract work only** — no code, no carrier,
no UI, no Production access. It follows the same pattern INV-44 set for
`DEAL_ECONOMICS_OFFER_READINESS_V1.md`: name the state machine precisely,
cite what already exists rather than re-describe it, and name every
remaining Product Owner decision explicitly rather than resolve it by
assumption (FOUNDATIONAL_PRINCIPLES principle 19).

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

**Entry evidence.** Two facts, both required:
1. **Brad's explicit send authorization** — a durable record of who
   authorized the send and when. Verbal or in-app acceptance earlier in
   the flow (Agreement Reached) is never sufficient; this is a
   *separate*, explicit act specific to authorizing transmission of the
   actual contract document, per this issue's locked invariant ("Brad
   explicitly authorizes sending the agreement").
2. **Confirmed transmission** — evidence the document was actually sent,
   distinct from authorization to send. A failure between authorization
   and confirmed transmission must not read as Contract Sent (see
   Failure behavior).

**What this document does not decide:** the transmission mechanism
itself (which provider, which document template, how "confirmed
transmission" evidence is obtained) — see Product Owner decisions below.
`UNDERWRITING_WORKSPACE_SPEC.md` already flags that whether this GHL
location's Documents & Contracts capability can merge per-deal
Opportunity fields is **unverified**, not merely undecided — a factual
gap, not a policy one, and one this issue does not close.

**Authority.** Brad, explicitly, per the locked invariant. Never
automatic, never inferred from Contract Ready alone, regardless of how
the future carrier records it.

**Transition trigger IN.** Brad's send authorization plus confirmed
transmission (mechanism undecided — INV-57).

**Transition trigger OUT.** To Under Contract (verified full execution,
below), or to Rescinded/Expired/Declined (below). No path back to
Contract Ready or Agreement Reached for the *same* agreement — see
No-reentry below.

**Failure behavior.** If authorization is recorded but transmission
cannot be confirmed, the state must read as "send authorized, not yet
confirmed sent" — never silently promoted to Contract Sent. This is a
distinct, visible state from both Contract Ready (transmission never
attempted) and Contract Sent (transmission confirmed), so an operator can
tell "needs retry" from "awaiting signature."

**Audit.** Who authorized the send, when, and (once the mechanism is
decided) which document/version was transmitted — append-only.

### Under Contract

**Meaning.** The agreement has been fully executed by every required
party. This is the only state in which IAOS treats the deal as a binding
contract. Per this issue's own locked invariant: **verbal or text
acceptance never means Under Contract** — only verified full execution
does, and **only verified full execution can create Under Contract.**

**Entry evidence.** Two facts, both required jointly — neither alone is
sufficient, per this issue's own locked invariant ("Under Contract
requires verified execution and preserved executed document"):
1. **Verified full execution** — confirmation, from an authoritative
   source, that every required signature/party has executed the
   document. "Sent" or "appears signed" is not "verified." The
   authoritative source (an e-sign provider's completion status, a
   manually confirmed and witnessed signature, or something else) is
   undecided here — see Product Owner decisions below.
2. **The executed document is preserved** — durably stored and
   retrievable, tied to this specific agreement. If verification succeeds
   but the document fails to preserve, Under Contract must not be
   asserted; the two facts are jointly necessary, not independently
   sufficient.

**Authority.** System-observed (the verification signal), not a human
"mark as complete" action alone — though depending on the undecided
mechanism, a human confirmation step may still be required to receive or
acknowledge that signal. Undecided which — see Product Owner decisions.

**Transition trigger IN.** Verified full execution plus preserved
document, together.

**Transition trigger OUT.** None, in the successful case — Under
Contract with a preserved document is this document's terminal success
state. **Corrected** (below) is the one controlled exception: it amends
the same underlying deal without un-reaching Under Contract.

**Failure behavior.** Ambiguous or unconfirmed verification must never
read as Under Contract — fail closed, exactly as this codebase already
does everywhere a durable state gates downstream authority (the
Offer-Ready-decision-invalidation pattern is the direct precedent, not a
new one invented here).

**Audit.** The preserved executed document is the primary audit
artifact — durably retrievable, immutably tied to this specific
agreement, with an append-only record of any later Corrected amendments.

---

## Branch and terminal states

### Corrected

**Meaning.** An executed (Under Contract) agreement is amended after the
fact — a correction to a term, without renegotiating or reopening the
underlying deal.

**Locked here:** a correction is an **append**, never an overwrite,
mirroring the append-only decisions-ledger pattern already proven
throughout this codebase (`ARV_EVIDENCE_SNAPSHOT_V1.md`,
`seller-call-outcome.ts`, INV-68's invalidation ledger) — the original
executed document and its preserved record are never destroyed or
replaced, only superseded by a new, linked record naming what changed and
why.

**Not decided here:** whether a correction requires its own
send-and-verify cycle (a new Contract Sent → Under Contract pass for the
amendment specifically) or a lighter addendum process, and what changes
qualify as "correctable" versus requiring an entirely new agreement. See
Product Owner decisions below.

### Rescinded

**Meaning.** The agreement — at any stage from Contract Ready onward —
is withdrawn or cancelled before or after execution, by mutual agreement
or a party's unilateral action.

**Not decided here:** who may record a rescission and what evidence is
required (a verbal report, written confirmation, or something else). See
Product Owner decisions below.

**No-reentry.** Once Rescinded, this specific agreement (`agreementAt`)
is terminal. See No-reentry disposition handoff below.

### Expired

**Meaning.** A Contract Sent agreement exceeds some time boundary without
reaching verified full execution.

**Not decided here:** the expiration window itself, and whether
expiration is a derived, automatic state (consistent with Offer Ready's
own automatic revocation, FOUNDATIONAL_PRINCIPLES principle 14) or
requires an explicit operator action. Manufacturing a specific window
without a real basis is exactly what principle 19 forbids — this is a
genuine Product Owner decision, not a default this document assumes. See
Product Owner decisions below.

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
(`agreementAt`) — Under Contract with a preserved document, Rescinded,
Expired, or Declined — the Seller Call negotiation surface (Board #8)
must not reopen or renegotiate *that specific agreement*. This is a
direct, consistent extension of INV-68's already-proven rule that a new
agreement at the same price and property does not inherit a prior
agreement's progress: pursuing this seller again after a terminal
non-Under-Contract state requires a genuinely new Agreement Reached (a
new `agreementAt`), never a reopening of the terminal one. Corrected is
the sole controlled exception, and only for an agreement that reached
Under Contract — it amends the same deal without reopening negotiation,
per its own (partially undecided) process above.

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
divergence is exactly what the Corrected state (above) exists to record;
this document does not invent a new pre-execution price field.

## GHL as the sole system of record

No new IAOS-side database or shadow copy of contract state is authorized
here (FOUNDATIONAL_PRINCIPLES principle 15). Every state's evidence must
ultimately be derivable from data GHL actually holds — the existing
notes-ledger pattern, and/or GHL's native Documents & Contracts objects
if a future issue determines this location supports the fields Board #9
needs (unverified per `UNDERWRITING_WORKSPACE_SPEC.md` — see Product
Owner decisions). This document authorizes no carrier; it defines what a
future carrier (INV-57's scope) must satisfy.

---

## Explicit Product Owner decisions still required

Per ALIGNMENT_PROCESS.md's format, each ending **Decide** — none are
resolved here, none are assumed, none are defaulted:

**Claim:** The mechanism for transmitting the agreement to the seller
(Contract Sent's entry evidence) is undecided, and whether this GHL
location's Documents & Contracts capability can merge the specific
per-deal Opportunity fields Board #9 needs is unverified.
**What this claim is based on:** `UNDERWRITING_WORKSPACE_SPEC.md`'s own
"Contracting reading Opportunity fields is the architectural direction,
not an observed capability" — a repository read.
**Recommendation:** Decide the mechanism (and separately verify the GHL
capability) before INV-57 begins.

**Claim:** What counts as "verified full execution" for Under Contract —
whose signal is authoritative (an e-sign provider's completion status, a
manually witnessed and confirmed signature, or another mechanism) — is
undecided.
**What this claim is based on:** this document's own state definition
above; no existing code or prior decision names a mechanism.
**Recommendation:** Decide before INV-57 begins — this gates whether
Under Contract can ever be reached at all.

**Claim:** Who may record a Rescission, and what evidence is required
(verbal report, written confirmation, or otherwise), is undecided.
**What this claim is based on:** this document's own state definition
above.
**Recommendation:** Decide before INV-57 begins.

**Claim:** The Expired window (how long a Contract Sent agreement may sit
unexecuted before it expires) and whether expiration is derived
(automatic) or requires an explicit operator action are both undecided.
**What this claim is based on:** this document's own state definition
above; FOUNDATIONAL_PRINCIPLES principle 19 forbids manufacturing a
specific window without a real basis.
**Recommendation:** Decide before INV-57 begins.

**Claim:** Whether a Corrected amendment requires its own full
Contract-Sent-to-Under-Contract cycle, or a lighter addendum process, and
which categories of change are "correctable" versus requiring an entirely
new agreement, is undecided.
**What this claim is based on:** this document's own state definition
above.
**Recommendation:** Decide before INV-57 needs to implement correction
handling — not necessarily before INV-57 begins, if V1 can defer
Corrected entirely.

**Claim:** Where the preserved executed document is stored (a GHL
Documents/file object, an external document-storage integration, or
something else) is undecided, and depends on the same unverified GHL
capability named above.
**What this claim is based on:** this document's own "preserved executed
document" requirement for Under Contract; `UNDERWRITING_WORKSPACE_SPEC.md`'s
capability gap.
**Recommendation:** Decide (and verify the underlying GHL capability)
before INV-57 begins.

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
