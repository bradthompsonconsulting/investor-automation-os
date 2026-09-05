# Deal Economics + Offer Readiness Contract V1 — B8-01 / INV-44

## What this document is

This is the locked Board #8 product/economics contract Brad's INV-44 outcome
requires: the shared naming and conceptual boundaries that every later Board
#8 item — Seller Call Workspace, standalone Deal Calculator, detailed
Underwriting, negotiation — must build against, so that no interface invents
its own economics.

**It authorizes no code, creates no carrier, and changes no Production
data.** It decides no formula and no policy value that is not already fixed
by an existing decision. Where a name below needs a formula this document
does not supply, that is stated explicitly rather than filled in — B8-02
(INV-45) inventories what exists; a later Board #8 decision supplies what is
missing, on its own terms.

**Canceled INV-33 ("B8-01 — Lock MAO / offer / negotiation V1 contract") is
historical only.** It never shipped a contract — its state history shows it
returned to Backlog before being canceled — and no document or carrier from
it exists to reconcile against. Nothing here resurrects its scope by
default; where a term below happens to resemble one INV-33 named, that is
because both drew on the same underlying product intent Brad restated in
INV-44, not because INV-33's semantics govern.

**This document restates and reconciles-by-naming; it does not re-decide.**
Every quantity that already has a locked formula (PB-D55, PB-D56) is left
exactly as decided there and is cited, not rewritten. Every quantity INV-44
names that has no existing formula is defined only as far as INV-44's own
words define it, with the gap to a mathematically authoritative definition
named as a B8-02 reconciliation item.

---

## Governing product model — one deal engine, three faces

**Seller Call Workspace, standalone Deal Calculator, and detailed
Underwriting are different interfaces over ONE authoritative deal engine.**
They may present different faces but must not produce conflicting
economics. This is INV-44's outcome statement, and it is also
FOUNDATIONAL_PRINCIPLES.md principle 11 (one source of truth) applied to
Board #8: if two surfaces can disagree about what a deal supports, the
design is wrong regardless of which one is "more correct."

**This principle is not yet true of the current codebase, and this document
does not make it true.** OBSERVED, by inspection of the current repository:

- `app/src/lib/underwriting/{types,compute,resolver,resolver-types,
  starters,selectOpportunity,view-model}.ts` implements PB-D55/PB-D56's
  engine — the six-deduction waterfall, the eleven-assumption resolution
  hierarchy, End-Buyer Maximum Purchase Price, and Seller MAO — and is
  consumed by `app/src/pages/UnderwritingWorkspace.tsx`. This is the
  leading candidate for "the one engine," but this document does not
  designate it as such; that assignment is a B8-02/B8-03 implementation
  question.

- `app/src/pages/MaoCalculator.tsx` exists in the repository but is **not
  routed** — it does not appear in `app/src/App.tsx` and is unreachable in
  the live app today. Its own code comment states a different formula:
  `MAO = ARV − Rehab − Selling/Holding − Target Buyer Profit − Assignment
  Fee`, and its build spec (`docs/specs/mao_calculator_spec.md`) states
  `MAO = (ARV × wholesale_pct / 100) − repair_total − assignment_fee` with
  `wholesale_pct` defaulting to 70. Neither matches PB-D56's waterfall:
  neither distinguishes End-Buyer Maximum Purchase Price from Seller MAO,
  neither treats financing as a divisor, and neither resolves assumptions
  through PB-D56's three-level hierarchy.
  `docs/UNDERWRITING_FIELD_REFERENCE.md` already records the 70%-rule's GHL
  Custom Value as legacy and "not read by the PB-D56 model" for
  underwriting purposes — but the calculator surface and formula this
  contract must unify under "standalone Deal Calculator" are still on
  record and still disagree with PB-D56.

- `app/src/lib/rail.ts` (Board #5's persistent call rail, live in
  `ContactWorkspace.tsx`) already renders Seller Ask and Seller MAO from the
  PB-D55/56 engine, and carries two cells — `Current Seller Position` and
  `Current Investor Offer` — permanently in a waiting state with the literal
  message "WAITING on negotiation carrier" / "WAITING on negotiation
  semantics / carrier contract." This is current, OBSERVED behavior, not a
  historical note: the negotiation-state carrier `SELLER_ACQUISITION_
  WORKFLOW.md` lists as absent is still absent.

So: one engine exists and is authoritative for detailed Underwriting today.
A second, conflicting formula is on record for the standalone Deal
Calculator but is not live. The Seller Call Workspace beyond the rail does
not yet exist. **Locking the "one engine" principle here does not resolve
which engine that is or how the other two surfaces come to share it — see
B8-02 reconciliation items below.**

---

## Locked names

Each name is defined exactly as far as INV-44's own words and existing
locked decisions define it. Nothing below invents a formula or a policy
value beyond that.

### Target Acquisition Price

> The acquisition price that produces desired economics under Investor
> Policy.

Locked as a **named concept, not a formula.** No existing Investor Policy
assumption (PB-D56 section IV's eleven values) expresses a "desired"
economics point distinct from the minimum-acceptable ceiling — the eleven
values set Required Buyer Profit and the Standard Minimum / 25%-of-profit
Assignment Spread, both of which already feed Seller MAO as the *minimum
acceptable* ceiling. Nothing today produces a *better-than-minimum* target
number. **B8-02 must determine whether Target Acquisition Price requires a
new Investor Policy assumption, a fixed relationship to Max Supported
Offer, or something else — this document does not guess, per INV-44's own
HARD NO on inventing Target/Max formulas.**

### Max Supported Offer

> The highest supported acquisition price that still preserves minimum
> acceptable economics under current approved assumptions.

This is, in words, the same question PB-D56's **Seller MAO** already
answers: the ceiling acquisition price that preserves minimum acceptable
buyer and wholesaler economics under the assumptions currently resolved
through Deal Override → Investor Policy → IAOS Starter. **Whether "Max
Supported Offer" is a rename/presentation label for Seller MAO, or names a
distinct quantity, is not decided here.** INV-45 (B8-02) is explicitly
scoped to distinguish reuse, rename-only, real logic gap, and real carrier
gap for exactly this kind of pairing — this document flags the pairing and
leaves the classification to it.

### Opening Offer and Current Offer

> Operator-controlled negotiation strategy in V1; IAOS does not invent it.

This restates, without changing, what PB-D55/PB-D56 and
`UNDERWRITING_WORKSPACE_SPEC.md` zone 3 already establish for **Opening
Offer**: a human decision, entered by the human, that never changes Seller
MAO and that IAOS does not calculate in V1. **Current Offer** names the
same negotiation-state concept `SELLER_ACQUISITION_WORKFLOW.md`'s call rail
already calls **Current Investor Offer** — where the negotiation stands
right now, as movements happen after the opening number.

**Locking this name pairing creates no carrier.** `SELLER_ACQUISITION_
WORKFLOW.md`'s list of capabilities with "No carrier exists for" —
including Opening Offer and Current Investor Offer — stands unchanged, and
`rail.ts`'s two permanently-waiting cells are current evidence that it is
still true today. Naming Opening/Current Offer as one governing pair here
is a vocabulary decision, not an implementation.

### Expected Spread and its reference price

> Expected Spread must always state its reference price (Current Offer in
> Seller Call; Test Price in standalone calculator).

PB-D56 section I already fixes the identity `Assignment Spread = End-Buyer
Maximum Purchase Price − Seller MAO`. Expected Spread generalizes that same
subtraction to any candidate acquisition price rather than to the resolved
Seller MAO specifically:

    Expected Spread = End-Buyer Maximum Purchase Price − <reference price>

This restates an identity PB-D56 already locks; it introduces no new
deduction, no new policy value, and no formula of its own. The reference
price is Current Offer on the Seller Call surface and **Test Price** — a
new name, not observed to exist anywhere in the current documentation or
code, meaning a candidate price the operator is trying out on the
standalone calculator — on the standalone Deal Calculator surface.

**What this does not resolve:** which End-Buyer Maximum Purchase Price the
standalone calculator's Test Price nets against — PB-D56's waterfall, or
the older MaoCalculator formula described above — is exactly the "one
engine" question left open above. Expected Spread cannot be made
mathematically authoritative on the standalone surface until that question
is answered. **B8-02 reconciliation item.**

### Calculated vs actionable

> A calculated number is not automatically an actionable number.

This is the same distinction `UNDERWRITING_WORKSPACE_SPEC.md`'s Open
Questions section and `SELLER_ACQUISITION_WORKFLOW.md` already draw between
**Underwriting Readiness** (can IAOS calculate a defensible Seller MAO —
Gate 1: ARV and Repairs present) and **Offer Readiness** (do we know enough
to negotiate responsibly from that calculation). A Target Acquisition Price
or Max Supported Offer can be *calculated* the moment Gate 1 resolves;
neither is *actionable* — safe to present to a seller — until Offer Ready
holds. This governs every quantity in this document: calculability is a
math property, actionability is an evidence-and-approval property, and the
two are never conflated.

---

## Offer Ready vs Contract Ready

Two distinct gates, already named as distinct in `SELLER_ACQUISITION_
WORKFLOW.md` ("Offer Readiness -- CONCEPT ESTABLISHED, CRITERIA UNDECIDED"
and "Contract Readiness -- DISTINCT, DETAIL DEFERRED"). INV-44 supplies the
category-level criteria Offer Readiness was missing; Contract Readiness's
detail remains deferred exactly as before.

### Offer Ready — the minimum contract

Offer Ready requires **enough supported knowledge** of:

    property
    repairs / condition
    ARV
    deal economics
    transaction / deal-structure assumptions
    seller price position

and **no unresolved material unknown that could significantly change the
supported offer.**

**"Enough supported knowledge" is stated at the category level, not as a
numeric or per-field threshold.** INV-44 names the six categories; it does
not name how many facts within a category must reach SUPPORTED, nor does it
define "significantly change" numerically. Inventing either would be
exactly the manufactured-precision failure FOUNDATIONAL_PRINCIPLES
principle 19 forbids. That determination is not made here and is not
assumed to be simple.

**Offer Ready is a derived state, not a persisted flag.** Consistent with
FOUNDATIONAL_PRINCIPLES principle 14 (derive for display, persist
decisions): Offer Ready is a live read of the six categories' current
evidence levels, recomputed whenever an underlying fact changes. This is
what makes automatic revocation (below) a property of the design rather
than a mechanism someone has to remember to invoke. Whether any part of
Offer Ready's determination requires its own carrier is a B8-02 question,
not decided here.

### The evidence ladder: UNKNOWN → PRELIMINARY → SUPPORTED

Every material fact within the six Offer Ready categories resolves to
exactly one of three states:

    UNKNOWN        nothing established yet
    PRELIMINARY    a working answer exists but is not yet defensible
    SUPPORTED      enough evidence exists to rely on for a supported offer

**This ladder is new, and is distinct from two other evidence
classifications the codebase already carries — they answer different
questions and this document creates no mapping between them:**

- PB-D61 (`docs/ARV_RECONCILIATION_V1.md`) already locks a **categorical
  ARV evidence state** — `HIGH / MODERATE / LOW / INSUFFICIENT` — produced
  by the comp-classification and reconciliation engine specifically for
  ARV. That ladder is about how strong a particular ARV *calculation's*
  supporting comp evidence is. Board 8's ladder is about whether a
  *category of fact* (of which ARV is one) is known well enough to act on
  at all. Whether an ARV of `LOW` or `INSUFFICIENT` should force the ARV
  category to `UNKNOWN` or `PRELIMINARY` here is a real question and is
  not answered by this document.

- `docs/ESTIMATED_REPAIRS_STANDARD.md`'s 2026-09-04 operator-defaults
  amendment uses the condition vocabulary `Not asked | Good | Repair |
  <severe>` for **per-system** repair condition, and deliberately removed
  `Unknown` from that vocabulary. That is a different axis again — per-item
  condition data feeding a dollar estimate — from whether the *repairs/
  condition category as a whole* is SUPPORTED enough to act on. No mapping
  is asserted.

**How a fact's evidence level is determined — rep judgment, a derived
completeness check, or some combination — is not decided here.** Per
FOUNDATIONAL_PRINCIPLES principle 19, a mechanism that manufactures a
SUPPORTED state without a real basis for it is exactly what this contract
must not authorize by omission.

### APPROVED and OVERRIDDEN are human actions, not evidence levels

APPROVED and OVERRIDDEN sit **above** the evidence ladder, not inside it.
The ladder describes what is known; these describe what a human decided to
do about it:

- **APPROVED** — a human accepts that the evidence, as it currently stands,
  is sufficient to act on.
- **OVERRIDDEN** — a human proceeds despite the evidence not reaching
  SUPPORTED, exercising the same override authority `SELLER_ACQUISITION_
  WORKFLOW.md` and PB-D56 already give the investor over underwriting facts
  and out-of-parameters conditions — flagged, never blocked.

This mirrors a pattern already proven in this repository:
`ARV_EVIDENCE_SNAPSHOT_V1.md` (B7-09) already implements an append-only
decisions ledger distinguishing an approval from an override, recording
what was recommended at the moment of departure. That is a precedent for
the *shape* a future Offer Ready approval/override carrier could take, not
an authorization to build one — B7-09's ledger has no carrier of its own
yet either, and none is created here for Offer Ready.

### Revocation

**Newly discovered material information can revoke Offer Ready.** Because
Offer Ready is derived (above), this is automatic in principle: if a new
fact drops a category from SUPPORTED, the next read of Offer Ready reflects
that without any explicit "revoke" action.

**What is not decided:** whether revocation has any retroactive effect on
an offer already APPROVED or already presented to a seller under the prior
evidence state. `ARV_EVIDENCE_SNAPSHOT_V1.md`'s append-only, versioned
decisions ledger is the closest existing precedent for how such a case
could be represented without destroying the record of what was true when
the decision was made — but applying that pattern to Offer Ready is a
future decision, not this one. **B8-02 reconciliation item.**

### Contract Ready

Contract Ready is later than Offer Ready and may include: ownership /
decision authority, title / vesting / payoff / liens where relevant, agreed
price, closing date, occupancy / possession, earnest money,
contingencies / access, and execution requirements. These items are **not**
pushed backward into Offer Ready unless they materially affect
underwriting.

This is the same gate `SELLER_ACQUISITION_WORKFLOW.md` already names
"Contract Readiness -- DISTINCT, DETAIL DEFERRED" and the same state
`UNDERWRITING_WORKSPACE_SPEC.md` names `CONTRACTING-READY`. Its detailed
definition remains deferred to contracting work that has not begun, exactly
as those documents already state. This contract does not narrow that
deferral further.

---

## HARD NO

Restated from INV-44, binding on this document and on everything that
cites it:

No resurrection of canceled INV-33–42 semantics by default. No autonomous
or AI economic authority. No hard-coded Target Acquisition Price or Max
Supported Offer formula, and no policy value, invented by an executor. No
new carriers. No change to existing economics without inventory and proof.
No Production mutation.

## What this document does not do

It does not implement the Seller Call UI, the Deal Calculator UI, or any
negotiation UI. It does not write a single field, create a single custom
value, or touch a single Production record. It does not choose which
existing engine becomes "the one engine." It does not supply the Target
Acquisition Price or Max Supported Offer formula, the numeric or structural
definition of "enough supported knowledge," the mechanism that assigns a
fact's evidence level, or the retroactive treatment of a revoked Offer
Ready. Each remains its own decision, most of them B8-02's or later.

---

## B8-02 (INV-45) reconciliation items — explicit list

1. **Standalone Deal Calculator formula conflict.** `MaoCalculator.tsx` /
   `docs/specs/mao_calculator_spec.md`'s pre-PB-D56 formula
   (`ARV × 70% − repairs − assignment_fee`) versus PB-D56's buyer-economics
   waterfall. The page is currently unrouted, but the formula is the only
   thing on record for "standalone Deal Calculator." Which becomes
   authoritative, or how they reconcile, is undecided.

2. **Max Supported Offer vs Seller MAO.** Same question in words; whether
   the same quantity, a rename, or a distinct one is undecided.

3. **Target Acquisition Price has no supporting Investor Policy
   assumption today.** PB-D56's eleven values set a minimum-acceptable
   ceiling, not a "desired" target above it. Whether a new assumption,
   a fixed relationship to Max Supported Offer, or another mechanism
   supplies it is undecided.

4. **Opening Offer / Current Offer carrier remains absent.** OBSERVED
   live in `rail.ts` today ("WAITING on negotiation carrier" /
   "WAITING on negotiation semantics / carrier contract"). Naming the
   pair here does not create it.

5. **Expected Spread's standalone-calculator arithmetic depends on
   item 1.** Which End-Buyer Maximum Purchase Price Test Price nets
   against cannot be fixed until the engine question is resolved.

6. **No mapping between three evidence classifications.** Board 8's
   UNKNOWN/PRELIMINARY/SUPPORTED, PB-D61's ARV-specific
   HIGH/MODERATE/LOW/INSUFFICIENT, and Board 6's per-system
   `Not asked/Good/Repair/<severe>` condition vocabulary answer different
   questions at different granularities. Whether any of them should
   constrain another (e.g., ARV `INSUFFICIENT` forcing the ARV category
   below SUPPORTED) is undecided.

7. **Evidence-level determination mechanism is undecided** — rep
   judgment, derived completeness, or a hybrid — for any of the six
   Offer Ready categories.

8. **Offer Ready's approval/override carrier, if any, is undecided.**
   `ARV_EVIDENCE_SNAPSHOT_V1.md`'s decisions ledger is a proven shape for
   representing an approval or override with provenance; nothing
   authorizes applying it to Offer Ready.

9. **Revocation's retroactive effect on an already-approved or
   already-presented offer is undecided.**

---

## Provenance

This contract restates, without reinterpretation, the outcome and Offer
Ready minimum contract Brad wrote directly into INV-44's issue body, which
is Board #8's Product Owner ruling for this first RESET issue. It cites and
does not amend PB-D55, PB-D56, and PB-D61, and it cites and extends —
without contradicting — `SELLER_ACQUISITION_WORKFLOW.md`'s existing
Underwriting Readiness / Offer Readiness / Contract Readiness framing. Per
AGENTS.md's resolution order step 2, later Board #8 work should build
against this written contract rather than against conversation memory or
INV-44's issue text directly.
