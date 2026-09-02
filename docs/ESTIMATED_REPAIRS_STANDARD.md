# IAOS Estimated Repairs — Standard

## What this document is

This is a **product and implementation contract**. It defines how IAOS
arrives at an Estimated Repairs figure, and it is binding on any work that
produces, consumes or displays that figure.

It sits alongside `FOUNDATIONAL_PRINCIPLES.md` (how we think) and
`SELLER_ACQUISITION_WORKFLOW.md` (what we are building toward). Where this
document and a hard constraint in a specification appear to conflict, the
constraint governs — in particular the §4.1 HARD NO on `offer_` fields,
tags, pipeline stage and workflow triggers, and the rule that IAOS never
writes a field that has not passed its own inert-proof.

**Living document.** It changes by dated amendment under the PB-D43
supersession convention. Historical text is preserved rather than
rewritten; later reasoning governs.

**Status at authoring, 2026-08-31.**

| Element | State |
|---|---|
| Architecture — the five-layer model | **LOCKED** |
| Unknown major-system policy | **LOCKED** |
| Disclosure requirement | **LOCKED** |
| Dollar coefficients, band packages, reserves, contingency | **OPEN** |
| Implementation | **NOT AUTHORIZED** |

---

## Acceptance criterion

> A competent operator should be able to produce a conservative,
> transparent initial repair allowance during one normal seller phone
> call, without performing line-item estimating, and with the result
> explicitly subject to inspection.
>
> The operator must be able to see how much of that allowance comes from
> indicated repairs versus reserves caused by unknown major-system
> condition.

Both sentences are requirements. The second is not a UX preference — see
**Disclosure**.

---

## The model

    Repair Allowance =  Scaling Repairs
                     +  Fixed Room / Package Repairs
                     +  Major-System Repairs
                     +  Unknown / Risk Reserves
                     +  Contingency

### Why this shape and not a single $/sf rate

This is a measured result, not a design preference. Five representative
rehab packages were assembled from real `repair_bid_sheet.json` items and
priced against four canonical houses — 1,000 / 1,500 / 2,000 / 3,000 sf —
with the book's own 10% factor applied.

**A single $/sf band rate is unstable.** Effective $/sf across those four
house sizes spread by:

| Band | spread |
|---|---|
| Cosmetic | 35% |
| Light | 74% |
| Moderate | 43% |
| Heavy | 58% |
| Gut | 71% |

The cause is arithmetic rather than judgment: a $12,000 kitchen and a
$6,500 HVAC system cost the same in a 1,000 sf house as in a 3,000 sf one,
so they dominate the small house and dilute in the large one. A rate
calibrated on 1,500 sf over-estimates 3,000 sf by roughly 40%.

**Separating scaling items from fixed items fixes it.** Re-testing the
same packages with `sf`/`lf` items in the scaling layer and `ea`/`ls`
items pulled out as fixed:

| Band | scaling $/sf, 1,000 → 3,000 sf | spread |
|---|---|---|
| Cosmetic | $3.42 · $3.42 · $3.42 · $3.42 | **0%** |
| Light | $5.95 · $5.95 · $5.95 · $5.95 | **0%** |
| Moderate | $8.41 · $8.56 · $8.63 · $8.56 | **3%** |
| Heavy | $12.95 · $13.10 · $13.17 · $13.10 | **2%** |
| Gut | $15.51 · $15.66 · $15.73 · $15.66 | **1%** |

**35–74% collapses to 0–3%.** The layered architecture is what this cost
book's own structure produces once fixed costs stop being forced through a
per-sf average.

⚠ **Those dollar figures are not coefficients.** The package compositions
used in that experiment were scaffolding — placeholder item selections and
placeholder quantities — built to make the test runnable. The *structural*
finding is robust to those choices because it concerns fixed-versus-scaling
behaviour. The *rates* are not proposals and must not be treated as such.

---

## Locked principles

1. **Scaling repairs use quantities where cost genuinely scales** (`sf`,
   `lf`). The whole rehab does not scale with house size and must not be
   modelled as if it does.

2. **Kitchen, Bath and other fixed packages are discrete selections.** The
   cost book already tiers them in absolute dollars — Kitchen at High end /
   Median / Low end / Refinish, Bath at Large master / Full / Half,
   appliances at four tiers. Use those tiers. Do not invent a quality
   multiplier for them.

3. **Major systems stay explicit** — roof, HVAC, foundation, electrical,
   plumbing/sewer, windows. A large problem must never be buried inside an
   average. These are precisely the fixed-cost items that destabilised the
   flat model.

4. **Contingency is explicit policy, never hidden fudge.**

5. **Imported property data may prefill; it is never required.** The
   estimator must remain fully operable with every imported dimension
   absent. Prefill is convenience, not architecture.

6. **The detailed cost book is the source and calibration layer, not the
   live-call interface.** Kitchen (19 items), Bath (17), Flooring (15),
   Misc/Permits (13), HVAC/Plumbing (11) and Doors/Trim (11) — 86 of 122
   items — are too decision-heavy to operate during a seller call and
   belong behind tier and override selections.

7. **No persisted itemization in V1.** Only the approved total persists.
   Line-item and category work may exist in session to compute that total.

8. **No MAO, offer authority or negotiation math inside the repair
   estimator.** It feeds the underwriting engine; it does not become one.
   The moment it grows its own economics or `offer_` authority it has
   reproduced the retired MAO calculator under a different name.

9. **Only operator approval makes the total authoritative.** On approval it
   writes to the existing `contact.estimated_repairs` carrier
   (`OQnud97MfdxMcTgMVTgf`, MONETORY) through the existing named setter.
   No new carrier, no new field, no config expansion.

10. **Cost-book arithmetic and operator-policy assumptions stay
    distinguishable** everywhere they appear. A figure traceable to a
    cost-book line and a figure Brad declared are different kinds of fact.

11. **Geographic factor is 1.00 for V1.** Recorded as an explicit operating
    assumption: the cost book declares no market, region or base year, so
    it is being treated as the working basis for the initial operating
    market until real outcomes say otherwise. It is **not** claimed to be
    locally calibrated, and it is **not** claimed to be a national average.
    No ZIP cost index is in scope.

12. **The output is a transparent, traceable estimate.** Not a contractor
    bid, not a guaranteed repair cost. "Defensible" is a claim about the
    quality of the scope and quantities entered and is not asserted here.

13. **Inspection remains the reality check**, and the seller is told so on
    the call.

14. **Real outcomes calibrate the model.** Coefficients are not theorised
    to perfection before use.

---

## Unknown — policy

**A designated major system answered Unknown reserves full replacement
cost** until better information is obtained.

Four constraints, all binding:

- **Unknown does not mean IAOS claims replacement is necessary.** It means
  underwriting is reserving against a condition nobody has established.

- **Unknown minor items do not individually trigger full replacement.** The
  rule applies to designated major systems only.

- **No hidden probability assumptions.** Any *fraction* of replacement cost
  is a probability in disguise — "60% of replacement" asserts a 60% failure
  rate whether or not the word appears. Full replacement is a policy
  containing no statistics; a fraction is not. The cost book supplies
  replacement costs and supplies no frequencies.

- **"Aged but working" carries no coefficient.** The vocabulary is
  `Good / Repair / Replace / Unknown`. An age band immediately raises
  *$0? 25%? remaining life?*, which is where invented probabilities
  re-enter. Age and year data may be **captured** where available; it may
  **not change the dollar result** until real inspection outcomes
  establish what it should mean.

**Second-order property, deliberate:** because a real answer can only
reduce the reserve, this gives the operator a reason to ask. Uncertainty
becomes a call prompt rather than a silent cost.

---

## Disclosure — requirement

The allowance must decompose on screen. Indicated repairs and
unknown-condition reserves are **economically identical in the conservative
total and informationally completely different**. Collapsing them into one
figure destroys the second.

    Known / indicated repairs .......... $41,000
    Unknown-condition reserves ......... $22,000
        Roof — condition unknown           $14,000
        HVAC — condition unknown            $8,000
    Conservative allowance ............. $63,000

The operator sees immediately that one question about the roof is worth
$14,000 of underwriting clarity.

---

## Deliberately not specified

The number of operator questions, the condition-band names, and every
dollar coefficient. These are derived from the verified cost book rather
than declared here.

**Accuracy per second is the target, not a question count.** Nine questions
is acceptable; fourteen is acceptable. Condition bands survive only if each
is defined mathematically — an unquantified band such as "heavy feels like
$65/sf" does not satisfy this standard.

---

## Open items at authoring

1. Four suspected cost-book value errors require verification against the
   original source worksheet. Reusable coefficients derived from an
   unverified value propagate that error invisibly into every estimate.

2. The cost book's 10% factor is described only as a "fudge factor applied
   to category subtotals." Whether it represents trade-level waste and
   overage — in which case Contingency is a genuinely separate layer — or
   already represents project contingency — in which case a second blanket
   contingency double-counts — is **unresolved**. Every measured figure in
   this document already includes it.

3. The unit basis for the paint and interior-scaling items is unconfirmed.
   If they are priced on building square footage, an imported building
   square footage may prefill them directly. If they are priced on
   paintable wall area, building square footage is merely correlated, a
   conversion rule would be required, and **this standard forbids inventing
   one** — those items fall back to operator entry.

4. The band packages themselves, the major-system override set, and
   contingency policy are authored product decisions and are not yet made.

---

## The calibration path

Every figure retains provenance to a cost-book line, so once real
inspections exist the model's error is measurable:

    Error = Actual Repair Cost − Estimated Repair Cost

Coefficients then stop being assumptions and become measured acquisition
data. This is the durable value of the architecture, and it is why band
packages are authored carefully rather than quickly — everything calibrates
against them afterwards.

---

## Governing V1 policy amendment — 2026-09-02

This amendment is the current governing contract for Repair Estimation V1,
identified neutrally as **IAOS Repair Policy — 2026 v1**. Under the PB-D43
supersession convention, it supersedes every conflicting authoring-era status,
open item, geographic assumption, and policy statement above. Historical text
remains to preserve the decision record; this later amendment governs.

### Seller-call outcome and provenance contract

For each repair question or risk, the operator must reach one of exactly three
visible pricing outcomes:

1. **`$0`** — the assessed condition requires no repair allowance.
2. **Authorized `$X`** — a known amount supported by `BOOK`, `IAOS POLICY`, or
   `MANUAL` / operator-entered provenance.
3. **`UNPRICED RISK`** — the risk is genuinely unresolved or there is
   insufficient authorized pricing.

These states must not collapse into one another. A blank or missing price must
never silently become `$0`, and an `UNPRICED RISK` must never silently acquire
an invented amount. Absence from the reference table does not prevent the
operator from entering a known repair amount manually.

Every priced amount remains visibly distinguishable by provenance:

- **`BOOK`** — directly traceable to the accepted cost-book value;
- **`IAOS POLICY`** — an approved Wholesaler Underwriting Reserve;
- **`MANUAL`** — a known amount entered by the operator.

The provenance distinction is required wherever amounts are shown, including
the decomposed allowance. An amount declared by IAOS policy must not be
presented as a cost-book fact, and a manual amount must not be presented as
either one.

### Small common-repair reference table

V1 uses a **small common-repair reference table only**. A known/common issue
with an approved value may prepopulate from this table:

| Repair and matching condition | Amount | Provenance | Governing behavior |
|---|---:|---|---|
| Roof — `Replace` or `Unknown` | $15,000 | `IAOS POLICY` | Wholesaler Underwriting Reserve |
| Electrical, whole-house — `Replace` or `Unknown` | $12,500 | `IAOS POLICY` | Wholesaler Underwriting Reserve |
| Plumbing / Sewer — `Major` or `Unknown` | $12,500 | `IAOS POLICY` | Wholesaler Underwriting Reserve |
| Foundation — `Material Issue` or `Unknown` | $15,000 | `IAOS POLICY` | Wholesaler Underwriting Reserve; operator may override |
| HVAC — `Replace` or `Unknown` | $6,500 | `BOOK` | Accepted cost-book value |
| Electrical panel replacement — when this is the actual scope | $2,500 | `BOOK` | Accepted cost-book value; not the whole-house reserve |

There are **no square-footage bands** for these reserves. The `IAOS POLICY`
amounts are conservative underwriting placeholders, not contractor bids.

A known repair that does not match a row stays blank for operator entry. The
operator may enter the known amount as `MANUAL`; IAOS must not invent or derive
missing pricing. If the risk remains unresolved or lacks authorized pricing,
it remains visibly `UNPRICED RISK`.

The table grows only after a recurring real-world need is observed and a
normal value is approved. Anticipated future needs do not authorize rows,
coefficients, ranges, or derivation machinery in V1.

### Package, quantity, and missing-input rules

Kitchen and appliances remain independent `BOOK` selections. Selecting one
must not select, pair, tier, multiply, or otherwise alter the other. V1 has no
automatic package pairing and no hidden quality multiplier.

Bathroom total count is property context, not repair quantity. Price only the
bathrooms identified as needing work. The same rule applies to all other
property attributes: they are evidence and context, and do not automatically
become repair quantities unless an approved policy explicitly authorizes that
behavior.

Authoritative or imported square footage may prefill and may be corrected by
the operator. If square footage is still unavailable, it is never invented
and no size band is silently selected. Any calculation that genuinely requires
square footage remains visibly `UNPRICED RISK` until the input is available or
a known repair amount is entered manually.

### Inherited allowance and contingency

Preserve the inherited allowance under this exact label:

> **FMTM 10% allowance — historical purpose unverified**

Its historical purpose remains unverified. V1 adds no other blanket IAOS
contingency or discovery reserve. The inherited allowance must not be renamed
or used as authority to imply a newly interpreted purpose.

### Geography is not a V1 pricing input

For Repair Estimation V1, geography, ZIP, city, and market are **not repair-
pricing inputs at all**. This fully supersedes the earlier governing effect of
the geographic-factor `1.00` language and any proposed geographic modifier,
`Market Factor`, `BASELINE_UNLOCALIZED`, or DFW-selected pricing semantics.

Initial research may have used DFW evidence, but the approved policy values
are neutral `IAOS POLICY` values and Wholesaler Underwriting Reserves. They are
not geography-selected amounts.

V1 includes no ZIP coefficients, Craftsman runtime or API, contractor-grade
localization, or future-localization machinery. Future localization is outside
V1 and does not justify present parameters, abstractions, configuration, API
hooks, or scaffolding.

### Calculation and disclosure

The allowance remains transparent and decomposed. Each amount displays its
`BOOK`, `IAOS POLICY`, or `MANUAL` provenance, and every unresolved risk remains
visibly identified as `UNPRICED RISK` rather than being omitted or converted to
zero.

A numeric subtotal may be shown for resolved amounts, but while any
`UNPRICED RISK` remains, that subtotal is **not a complete repair allowance**
and must not be presented as one. The output remains an underwriting estimate,
not a contractor bid or guaranteed repair cost.

Inspection disclosure remains explicit: actual condition and repair scope are
subject to inspection. This disclosure does not resolve, price, or hide an
unpriced risk.

### Status and implementation boundary

The V1 policy questions addressed by this amendment are closed. No unresolved
Product Owner decision capable of changing this contract is identified in the
accepted INV-7, INV-8, INV-9, and INV-10 record.

This documentation amendment does **not** authorize or implement the estimator,
domain model, calculation engine, UI, persistence, Production writes, or any
INV-11+ work. Those remain behind independent review and explicit implementation
authorization.
