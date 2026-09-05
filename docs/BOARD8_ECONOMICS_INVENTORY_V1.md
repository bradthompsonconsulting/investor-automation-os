# Board #8 economics inventory & reconciliation — B8-02 / INV-45

## What this is

The authoritative map INV-45 requires: what already exists, in code and in
locked decisions, against every quantity `docs/DEAL_ECONOMICS_OFFER_
READINESS_V1.md` (B8-01) names. B8-03 (INV-46) may build only from this
map, not from assumption.

**It authorizes no code, creates no carrier, and changes no Production
data.** Every classification below is a finding about what exists, not a
decision about what should be built. Where the evidence does not reach a
formula or a policy value, that is reported as an open question — never
filled in here.

**Method.** Every row cites one of: a file and line number (code, read
directly from the working tree on this branch), a document and section
(a locked decision), or an explicit search with a "no matches" result
(verified absence). Nothing below is reported from memory of a prior
session or from `docs/specs/mao_calculator_spec.md`'s aspirational build
plan where that plan was never realized.

---

## Part A — Inventory of existing authoritative sources

### ARV

| | |
|---|---|
| Deal-level authority | `opportunity.arv_after_repair_value` (PB-D55: Opportunity owns underwriting once approved) |
| Field ids | Production `cBkygqcHRseZUGCYYeba`, Test `ppe2ZTO7DJTMao74xvYI` — `app/shared/ghl-config.ts:158,236` (`opportunityFacts.arv`) |
| Seed fallback | `contact.arv`, id `wMBTGWMs97yysQFx7Vad` — `docs/CONTACT_FIELD_REFERENCE.md:65`; consulted only when the Opportunity field is absent, per `resolveDealFacts` (`app/src/lib/underwriting/resolver.ts:312-333`) |
| Read | `parseOpportunityValues` / `parseContactSeeds` (`resolver.ts:224-272`) |
| Approval writer | `setApprovedArv` (`app/src/lib/ghl.ts:933-965`); gated by `arvPersistGate` and recorded by `persistApprovedArv` (`app/src/lib/arv-persist.ts:48-146`); wired into `app/src/components/ArvCompsWorkspace.tsx` (confirmed live consumer — see Approval/override provenance below) |
| Inert-proof status | Proven inert in the IAOS Test location, 2026-09-04, per PB-D62 (`docs/UNDERWRITING_FIELD_REFERENCE.md:83`) |
| Evidence classification (Board #7) | `HIGH / MODERATE / LOW / INSUFFICIENT`, PB-D61 (`docs/ARV_RECONCILIATION_V1.md:39-49`) — a different ladder from Board 8's, see B8-01 |

**Classification: REUSE.** The full path — Opportunity carrier, Contact
seed, resolver, inert-proofed approval writer with append-only note
provenance — is live and already the authoritative ARV source Board 8's
engine must read.

### Repairs

| | |
|---|---|
| Deal-level authority (underwriting input) | `opportunity.repair_estimate`, id `hId4Yog6u5GP1Iwz1aNx` (Prod) / `lSWxFUmWksfrViePG4UC` (Test) — `app/shared/ghl-config.ts:159,237` |
| Named writer for the Opportunity field | **Verified absent.** `Grep "setRepairEstimate\|repair_estimate\|opportunityFacts.repairs"` against `app/src/lib/ghl.ts` returns no matches. `docs/UNDERWRITING_FIELD_REFERENCE.md:84` independently records "Inert proof: none, Named writer: none" for this field. |
| Seed fallback / actually-populated carrier | `contact.estimated_repairs`, id `OQnud97MfdxMcTgMVTgf` (`docs/CONTACT_FIELD_REFERENCE.md:66`). Named writer `setEstimatedRepairs`, gated by `persistGate` (`app/src/lib/repair-estimation/persist.ts:47-65`), Board 6 / INV-13. This is the carrier Board 6's repair estimator actually approves and writes to. |
| Consequence | Because the Opportunity-side field has no writer, `resolveDealFacts`'s seed-then-supersede path (`resolver.ts:327`) means Contact `estimated_repairs` is, in practice, the repairs figure underwriting resolves from today — not a one-time convenience but the operative path, mirroring PB-D55's own observation about ARV before its Opportunity writer existed. |

**Classification: REUSE**, with a named gap already on record rather than
one this document discovers: the Opportunity-side `repair_estimate` field
is a read target with no writer. Board 6's approved-total carrier
(Contact `estimated_repairs`) is the thing to reuse; nothing here
authorizes creating the missing Opportunity-side writer, which is its own
undertaking outside INV-45.

### Assignment logic

| | |
|---|---|
| Model | PB-D56 section II.6 — three modes, one effective Assignment Spread: Standard Minimum, 25% of Buyer Profit, Manual |
| Implementation | `computeUnderwriting`'s assignment branch, `app/src/lib/underwriting/compute.ts:163-174` — exact three-way match to PB-D56 |
| Mode carrier | `opportunity.assignment_mode`, id `TpLo0WRc303TXAaBUbBf` (Prod) / `SsPgqpu3d3aU424Dsve9` (Test) — `app/shared/ghl-config.ts:154,232`; three-option picklist verified against PB-D56 section II verbatim (`docs/UNDERWRITING_FIELD_REFERENCE.md:91-98`) |
| Manual spread amount carrier | **Verified absent.** `parseOpportunityValues` returns `manualSpread: null` unconditionally with the comment "CARRIER GAP: no GHL field holds the manual spread amount" (`resolver.ts:256-258`). `parseDealOverrides` likewise returns every override as unresolved with the comment "no deal-override carrier exists" (`resolver.ts:282-297`). |

**Classification: REUSE** for mode selection and the standard/25% branches;
**REAL CARRIER GAP, already named in code, not newly discovered** for the
Manual mode's dollar amount and for every deal-override value generally.

### Buyer-profit requirement

`Required Buyer Profit = ARV × Effective Buyer Profit %` — `compute.ts:155`,
matching PB-D56 section II.5 exactly. Percentage resolves through
`resolveInputs`'s `pick()` hierarchy (`resolver.ts:349-357,435-439`).
**Classification: REUSE.**

### Holding / carrying costs

`Holding Costs = Effective Monthly Carry × Effective Hold Months` —
`compute.ts:154`, matching PB-D56 section II.3. Both components resolve
independently through the same hierarchy (`resolver.ts:429-434`).
**Classification: REUSE.**

### Selling / closing costs

`Selling Costs = ARV × Effective Selling Cost %` and
`Closing Costs = Effective Closing Cost Estimate` — `compute.ts:152-153`,
matching PB-D56 sections II.1–II.2. **Classification: REUSE.**

### Financing, LTV, interest, points

`k = LTV × [Points% + (Rate × HoldMonths/12)]`, applied as a divisor —
`compute.ts:95-117,161`, matching PB-D56 section II.4 exactly, including
the three-state switch (off / on / unresolved) and the rule that Off
yields a legitimate zero while an unresolved switch never does
(`compute.ts:101-117`, comment citing PB-D56 section II.4).
**Classification: REUSE.**

### Seller MAO

`sellerMAO = endBuyerMaxPrice − assignmentSpread` — `compute.ts:176`.
Written by `saveUnderwritingFields` to `opportunity.mao_max_allowable_offer`
(id `Atu5XCjpFElY8H64VG4h` Prod / `ZfOljSm5fLFCFZhfi0ri` Test —
`app/shared/ghl-config.ts:155,233`) as one of exactly three carriers
(`app/src/lib/ghl.ts:1107-1124`). Read by `app/src/lib/rail.ts:273` for the
persistent call rail's "Seller MAO" cell, live in `ContactWorkspace.tsx`.
**Classification: REUSE.** This is also the quantity B8-01 flags as the
likely referent of "Max Supported Offer" — see Part B.

### End-Buyer Maximum Purchase Price

`endBuyerMaxPrice = baseBuyerCapacity / (1 + k)` — `compute.ts:161`. Written
by the same `saveUnderwritingFields` call to `opportunity.
endbuyer_maximum_purchase_price` (id `zOVIPwzLe41a0SQmwVAJ` Prod /
`EUMpREBOjnHXzpBZHawC` Test — `app/shared/ghl-config.ts:153,231`).
**Classification: REUSE.**

### Opening Offer / Current Offer / negotiation fields

**Verified absent, on two independent sources that agree.**

- `docs/SELLER_ACQUISITION_WORKFLOW.md`'s "No carrier exists for" list
  names Current Seller Position, Current Investor Offer, Seller Stated
  Minimum, Opening Offer, Manual assignment spread (the amount),
  Accepted price, and Stage/readiness state.
- `app/src/lib/rail.ts:426-431` renders exactly two of those cells today —
  `Current Seller Position` and `Current Investor Offer` — each hardcoded
  to a waiting string ("WAITING on negotiation carrier" /
  "WAITING on negotiation semantics / carrier contract"), with no
  underlying field read at all. `Opening Offer` does not appear anywhere
  in `rail.ts`.

Grep of `app/src` for `Opening Offer`, `Current Offer`, `Current Investor
Offer` (already run for B8-01) returns only `rail.ts`, and only as the
literal waiting-state strings above — no field id, no read, no write.

**Classification: REAL CARRIER GAP.** Confirmed live and current, not a
stale doc claim.

### Approved ARV carrier

Covered under ARV above. `opportunity.arv_after_repair_value`, writer
`setApprovedArv`, gate `arvPersistGate`, note-ledger recorder
`persistApprovedArv` (`arv-persist.ts:96-146`), inert-proofed 2026-09-04.
**Classification: REUSE.**

### `estimated_repairs` carrier

Covered under Repairs above. `contact.estimated_repairs`, writer
`setEstimatedRepairs`, gate `persistGate` (`repair-estimation/persist.ts`).
**Classification: REUSE**, with the Opportunity-side sibling field's
missing writer named as a pre-existing, separately-tracked gap.

### Accepted price

**Verified absent.** `docs/SELLER_ACQUISITION_WORKFLOW.md` lists "Accepted
price — contracting concern" under "No carrier exists for." `docs/
UNDERWRITING_WORKSPACE_SPEC.md`'s "Downstream display" section names the
adjacent concept, Actual Contract Price, as "a fact, once a contract
exists... owned by contracting, not by this workspace," and states that
even the architectural path for contracting to read Opportunity fields is
"the architectural direction, not an observed capability" — whether GHL's
Documents/Contracts feature can merge per-deal opportunity custom fields
in this location is explicitly UNKNOWN there.

**Classification: REAL CARRIER GAP for the value itself — but not out of
Board #8 overall.** `SELLER_ACQUISITION_WORKFLOW.md` and `UNDERWRITING_
WORKSPACE_SPEC.md` place the adjacent underwriting-workspace display
concept (Actual Contract Price) under contracting, but Board #8's own
later scope already assigns Accepted Price a home: INV-53 (B8-10)
requires preserving the negotiated result when price is accepted, and
INV-54 (B8-11) explicitly scopes persisting accepted price and
negotiation provenance from this inventory. Accepted Price is outside
**B8-03's immediate implementation scope** — B8-03 should not treat
closing this gap as its own job — but it is not outside Board #8, and
this document does not classify it as a permanent contracting-only
concern.

### Approval/override provenance

Two existing, materially different mechanisms — neither is a general
Offer Ready mechanism:

1. **PB-D59's Approve write** (`saveUnderwritingFields`, wired to the
   single Approve control in `app/src/pages/UnderwritingWorkspace.tsx`
   line ~1011-1052). Outcome type `ApproveState` (`view-model.ts:126-148`)
   is `idle | in_flight | succeeded | failed | partial`. **There is no
   `overridden` state.** Approve either writes all three underwriting
   carriers or it does not; there is no recorded act of proceeding despite
   insufficient evidence.

2. **`arv-persist.ts`'s `ArvApproval`** (`approved | overridden`,
   lines 6-9), gated by `arvPersistGate` and recorded by
   `formatArvApprovalNote` into an append-only Contact note ledger
   (`arv-persist.ts:71-94`) carrying the approved amount, the recommended
   amount it departed from (for an override), the ARV evidence state, the
   reconciliation outcome, accepted comp count, and search level. This is
   a **complete, already-shipped APPROVED/OVERRIDDEN provenance pattern**
   — confirmed wired into `app/src/components/ArvCompsWorkspace.tsx`, not
   merely documented. It is scoped to ARV specifically: its evidence-state
   field is typed `ArvEvidenceState` (PB-D61's HIGH/MODERATE/LOW/
   INSUFFICIENT), and its note format is ARV-specific line-by-line.

**Classification: mixed, stated precisely rather than collapsed.**
- Underwriting-figures approval (End-Buyer Max / Seller MAO / Assignment
  Mode): **REUSE**, but **REAL LOGIC GAP** for attaching an override
  concept to it — PB-D59's Approve has no "proceed anyway" path today.
- A general Offer Ready approval/override mechanism: **no current
  persistence mechanism exists — verified absent**, not classified as a
  gap. B8-01 (`DEAL_ECONOMICS_OFFER_READINESS_V1.md:220-227,279-285`)
  leaves whether Offer Ready needs a carrier at all as an **UNRESOLVED
  PRODUCT DECISION**; this document does not convert that open question
  into a gap B8-03 is scoped to close.
- The *pattern* a future Offer Ready mechanism would follow, if one is
  ever authorized: **REUSE, as precedent only.** `arv-persist.ts` is
  proven, shipped, and structurally exactly what B8-01 already cited as
  precedent. Reusing its shape (gate function, append-only note,
  recommended-vs-actual capture) is not the same as reusing its carrier,
  which remains ARV-specific and does not extend to Offer Ready without
  its own decision — including the decision of whether to make one at
  all.

### All existing Investor Policy values

Eleven values, PB-D56 section IV. Every id below is read directly from
`app/shared/ghl-config.ts`'s Production block (lines 138-150) and cross-
checked against the Test block (lines 216-227) and against
`docs/UNDERWRITING_FIELD_REFERENCE.md:32-42`; the two independent sources
agree on every id.

| Value | fieldKey | id (Production, `ghl-config.ts:138-150`) | Starter (`starters.ts:39-51`) |
|---|---|---|---|
| Default Selling Cost Percentage | `sellingCostPct` | `huOzq1VKscRVL6O2Wp20` (line 139) | 0.10 |
| Default Closing Cost Estimate | `closingCost` | `kapXvTS9tNYVRn7L3WBY` (line 140) | 2500 |
| Default Monthly Holding Cost | `monthlyCarry` | `GLOwuyga9MW2qA7jfGUC` (line 141) | 500 |
| Default Hold Period Months | `holdMonths` | `ZABxPRW2bCYZVnnRuLop` (line 142) | 5 |
| Default Buyer Profit Percentage | `buyerProfitPct` | `Ld3CuvhR9KUxYbfT8keM` (line 143) | 0.15 |
| Purchase Financing Enabled | `financingEnabled` | `dq8qdnXR6qxzGy0shUby` (line 144) | true (On) |
| Default Financing LTV Percentage | `financingLtv` | `kEoZ1afVMK2LrSrvnWUR` (line 145) | 0.70 |
| Default Interest Rate Percentage | `financingRate` | `veTIWiG4s4cvYTMuVbUY` (line 146) | 0.12 |
| Default Financing Points Percentage | `financingPoints` | `9ONatv0Y9FOfpdDTIkGz` (line 147) | 0.02 |
| Standard Minimum Assignment Spread | `standardMinimum` | `MuQih1mjmxVVOQ01Naq1` (line 148) | 5000 |
| Buyer Profit Share Percentage | `profitSharePct` | `XqzNrXRIXXS3dcvAFz6o` (line 149) | 0.25 |

**Classification: REUSE, all eleven.** `parsePolicy` (`resolver.ts:146-206`)
reads every one, converts human-unit percentages to decimal fractions in
exactly one place, and `resolveInputs`'s `pick()` applies the Deal
Override → Investor Policy → IAOS Starter hierarchy uniformly. No
twelfth value exists anywhere in code or config for a "desired" (above-
minimum) economics target — confirmed by reading the full `StarterPolicy`
type (`starters.ts:25-37`), which has exactly eleven members.

---

## Part B — Classification of the six B8-01-named quantities

Per INV-45's required taxonomy: REUSE, RENAME/PRESENTATION-ONLY, REAL
LOGIC GAP, REAL CARRIER GAP, UNRESOLVED PRODUCT DECISION.

### Target Acquisition Price

**REAL LOGIC GAP + UNRESOLVED PRODUCT DECISION.** No existing calculation
produces a "desired economics" acquisition price distinct from the
minimum-acceptable ceiling. The eleven Investor Policy values (Part A)
set Required Buyer Profit and the Standard Minimum / 25%-of-profit
Assignment Spread — both minimum-acceptable, not desired-above-minimum.
There is no twelfth value, no "Target Assignment Spread," no "Target
Buyer Profit," and no existing formula this could reuse under a new name.
This is not classified as a pure logic gap alone, because the missing
piece is not an unwritten function over known inputs — it is a policy
choice (what does "desired," as opposed to "minimum acceptable," mean
numerically) that INV-45's own HARD NO forbids inventing. **B8-03 cannot
close this gap by itself; it requires a product decision first**, most
naturally as its own Investor Policy value (e.g., a Target Assignment
Spread or Target Buyer Profit Percentage) analogous in shape to the
existing eleven, but that shape is a recommendation for a future
decision, not a finding this document is authorized to make.

### Max Supported Offer

**RENAME / PRESENTATION-ONLY.** B8-01's own words for Max Supported Offer
— "the highest supported acquisition price that still preserves minimum
acceptable economics under current approved assumptions" — are, term for
term, PB-D56's definition of Seller MAO: `endBuyerMaxPrice −
assignmentSpread`, the ceiling produced by the currently resolved
Deal Override → Investor Policy → IAOS Starter assumptions
(`compute.ts:176`). No distinct calculation, input, or carrier is implied
by the Max Supported Offer wording that Seller MAO's existing computation
does not already supply. **B8-03 may present the existing
`figures.sellerMAO` value under the label "Max Supported Offer" on Board
8 surfaces without new logic or a new carrier.** This resolves B8-01
reconciliation item 2.

### Expected Spread

**Split by surface, per B8-01's own reference-price framing.**

- **Seller Call surface (reference price = Current Offer): REAL LOGIC
  GAP, thin, and REAL CARRIER GAP for its input.** The arithmetic itself
  — `endBuyerMaxPrice − referencePrice` — is a one-line reuse of an
  already-computed figure (`figures.endBuyerMaxPrice`, `compute.ts:161`);
  no existing function computes it at an arbitrary candidate price today
  (the only existing spread computation, `compute.ts:166-174`, always
  nets against the policy-resolved assignment amount, not an arbitrary
  reference price), so the function itself is a small, non-policy logic
  gap. But it cannot run at all without Current Offer, which Part A
  confirms is a REAL CARRIER GAP. The spread calculation is trivial; what
  it needs is not there.

- **Standalone Deal Calculator surface (reference price = Test Price):
  blocked on an UNRESOLVED PRODUCT DECISION**, not a logic or carrier gap
  in isolation. Test Price itself needs no GHL carrier — it is operator-
  typed input local to that page, not deal state. But which End-Buyer
  Maximum Purchase Price it nets against is exactly B8-01 reconciliation
  item 1: `app/src/pages/MaoCalculator.tsx` (unrouted; confirmed absent
  from `app/src/App.tsx`'s route table) and its spec
  (`docs/specs/mao_calculator_spec.md`) compute a different, pre-PB-D56
  ceiling. Until it is decided whether the standalone calculator adopts
  PB-D56's engine, retires its own formula, or the two are reconciled
  some other way, Expected Spread has no single authoritative End-Buyer
  Maximum Purchase Price to subtract from on that surface. This is a
  product/architecture decision, not something B8-03 can resolve by
  writing code.

### Current Offer

**REAL CARRIER GAP.** Confirmed in Part A on two independent, current
sources (`SELLER_ACQUISITION_WORKFLOW.md`'s capability list and the live
`rail.ts` waiting-state cells). No field, no read path, no write path,
no negotiation-state model of any kind exists.

### Accepted price

**REAL CARRIER GAP — outside B8-03's immediate scope, not outside Board
#8.** Confirmed in Part A. No persistence mechanism exists today, and
B8-03's shared deal/offer engine does not need to, and should not, close
this gap itself. But INV-53 (B8-10) requires preserving the negotiated
result on acceptance and INV-54 (B8-11) explicitly scopes accepted-price
and negotiation-provenance persistence from this inventory — the gap is
Board #8's to close on its own later schedule, not a permanent
contracting-only concern.

### Approval/override provenance

**Mixed — REUSE of pattern (as precedent only), REAL LOGIC GAP for
attaching override to the existing Approve write, and an UNRESOLVED
PRODUCT DECISION whether Offer Ready needs any persistence mechanism at
all — not a REAL CARRIER GAP, since B8-01 leaves that question open
rather than requiring an answer.** Detailed in Part A. These sub-findings
do not collapse into one label without losing information INV-45's
acceptance criterion asks this document to preserve.

---

## Part C — Disposition of B8-01's nine reconciliation items

Resolved as far as existing evidence permits; not guessed where it does
not.

1. **Standalone Deal Calculator formula conflict — confirmed, not
   resolved.** `MaoCalculator.tsx` is confirmed unrouted (absent from
   `App.tsx`) and its formula confirmed to differ from PB-D56's on every
   structural point (no End-Buyer Max/Seller MAO split, no financing
   divisor, no three-level hierarchy). Which formula governs remains an
   **UNRESOLVED PRODUCT DECISION** — this inventory does not pick a
   winner, per the HARD NO on replacing economics because terminology
   changed and on inventing formulas.

2. **Max Supported Offer vs Seller MAO — RESOLVED.** See Part B: RENAME /
   PRESENTATION-ONLY. Seller MAO's existing computation and carrier
   satisfy Max Supported Offer as B8-01 defines it.

3. **Target Acquisition Price's missing policy assumption — confirmed,
   not resolved.** Part A's Investor Policy table confirms exactly eleven
   values exist and none expresses a "desired" (above-minimum) target.
   Remains an **UNRESOLVED PRODUCT DECISION**.

4. **Opening Offer / Current Offer carrier — confirmed absent, currently,
   in code.** Not merely a stale doc claim: `rail.ts` today hardcodes both
   negotiation cells to waiting strings. Remains a **REAL CARRIER GAP**,
   now confirmed live rather than inferred from documentation alone.

5. **Expected Spread's standalone-calculator arithmetic — confirmed
   still blocked on item 1.** See Part B.

6. **No mapping between three evidence classifications — confirmed
   distinct, not merged.** PB-D61's `ArvEvidenceState` type (referenced by
   `arv-persist.ts:1,19`) is a distinct TypeScript type from anything
   Board 8's UNKNOWN/PRELIMINARY/SUPPORTED ladder would need; no shared
   type or conversion function exists between them, confirmed by their
   having no common import site. Remains **UNRESOLVED**, correctly, per
   B8-01: whether ARV `LOW`/`INSUFFICIENT` should force the Board 8 ARV
   category below SUPPORTED is a product decision this inventory does not
   make.

7. **Evidence-level determination mechanism — still undecided; no code
   attempts it.** Grep of `app/src` for the Board 8 ladder tokens
   (`UNKNOWN`, `PRELIMINARY`, `SUPPORTED` as a set) finds no such
   enumeration outside the two documents that name it. **UNRESOLVED
   PRODUCT DECISION**, unchanged.

8. **Offer Ready's approval/override persistence — clarified, not
   resolved.** No current persistence mechanism exists (verified
   absent). Part A now names the specific existing pattern
   (`arv-persist.ts`) a future carrier could follow structurally, as
   precedent only, which B8-01 could only cite in the abstract. Whether
   Offer Ready needs a carrier at all, and on what shape, remains an
   **UNRESOLVED PRODUCT DECISION** — not a gap this document asserts
   must be closed.

9. **Revocation's retroactive effect — unchanged, no code addresses it.**
   No approval/override mechanism in the repository — not PB-D59's
   Approve, not `arv-persist.ts` — models revocation or re-evaluation
   after the fact; both are single-shot writes. **UNRESOLVED PRODUCT
   DECISION**.

---

## Bounded gap list for B8-03

Real gaps B8-03 may be scoped to close, distinguished from decisions it
cannot make for itself:

**Implementable without a prior product decision:**
- Present `figures.sellerMAO` as "Max Supported Offer" on Board 8
  surfaces (presentation only, item 2 above).
- Write the thin `endBuyerMaxPrice − referencePrice` Expected Spread
  function for any surface where both operands already exist.

**Blocked on a carrier decision, not a formula:**
- Current Offer / Opening Offer negotiation-state carrier (item 4).

**Blocked on a product/policy decision this document does not make:**
- Target Acquisition Price's formula and supporting policy value
  (items 1, 3).
- Which engine is authoritative for the standalone Deal Calculator
  (item 1), which also blocks Expected Spread there (item 5).
- The evidence-ladder mapping and determination mechanism (items 6, 7).
- Revocation's retroactive treatment (item 9).
- Whether Offer Ready needs any approval/override persistence mechanism
  at all, and if so its shape (item 8) — UNRESOLVED, not a carrier gap.

**Out of B8-03's immediate scope, not out of Board #8 overall:**
- Accepted Price — its carrier is currently absent, but INV-53 (B8-10)
  and INV-54 (B8-11) already scope preserving and persisting it. B8-03
  need not, and should not, build this itself.

---

## Validation

**No executable test applies to this document**, for the same reason none
applied to B8-01: nothing here is code. Every claim above is either a
citation to a file and line number that can be independently re-read, a
citation to a locked decision section, or the literal result of a search
establishing absence. Consistency was checked, not assumed, by three
kinds of cross-reads performed while writing this document rather than
after:

- Every field id in Part A's Investor Policy table and the Seller MAO /
  End-Buyer Max / ARV / repairs / asking-price ids were read directly from
  `app/shared/ghl-config.ts` and cross-checked against
  `docs/UNDERWRITING_FIELD_REFERENCE.md` and `docs/CONTACT_FIELD_REFERENCE.md`;
  all three sources agree on every id cited.
- The "no writer" claims (Opportunity-side `repair_estimate`; Manual
  spread amount; every deal-override value) were each confirmed by a
  targeted grep against `app/src/lib/ghl.ts` or by reading the resolver's
  own comment naming the same gap in code, not inferred from a document's
  silence.
- The "unrouted" claim for `MaoCalculator.tsx` was confirmed by grepping
  `app/src/App.tsx` for the page name and finding no match, not by
  assuming a page absent from its own build spec's acceptance checklist
  is unrouted.

No field, carrier, formula, or Production record was created, modified,
or written to produce this document.

---

## Scope confirmation

No canceled INV-33–42 semantics resurrected — none is cited as authority
anywhere above; every classification traces to PB-D55, PB-D56, PB-D59,
PB-D61, PB-D62, or directly-read code. No Target or Max formula invented
— Target Acquisition Price is left as an unresolved product decision, and
Max Supported Offer's classification reuses Seller MAO's existing,
already-locked formula rather than proposing a new one. No policy value
invented — the Investor Policy table restates exactly the eleven values
that exist. No field or carrier created or modified. No proven Board #6
or #7 behavior deleted or weakened — every citation into
`arv-persist.ts`, `repair-estimation/persist.ts`, and the ARV/repairs
carriers describes existing behavior without altering it. No B8-03 or
downstream UI implemented. No Production mutation — every command run
while producing this document was a local read (`Read`, `Grep`) against
the working tree; no network call, no PUT, no GHL API request was made.
No merge performed.
