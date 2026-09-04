# Repair Estimation V1 — the field-calibration loop

## What this document is

A **process**, not a system. It defines how real deal outcomes improve the
repair policy after V1 is operational, using evidence that already exists.

It builds nothing. There is no new carrier, no warehouse, no automation, no
scheduled job and no code. That is deliberate: the point of this loop is to
stop Dollar #1 waiting on hypothetical precision, and a loop that needs
infrastructure before it can run would do the opposite.

It implements `ESTIMATED_REPAIRS_STANDARD.md` locked principle 14 — *real
outcomes calibrate the model; coefficients are not theorised to perfection
before use* — and the calibration path already stated there:

    Error = Actual Repair Cost − Estimated Repair Cost

Status: **the process below is proposed and not yet approved.** The threshold
numbers in §4 are the part that needs a Product Owner decision. Nothing here
changes any policy value on its own.

---

## 1. What V1 actually gives us

OBSERVED, not assumed. These constraints shape everything below.

- **Only the approved TOTAL persists**, through `estimated_repairs`
  (INV-13). Locked principle 7 — no persisted itemization in V1 — is
  unchanged by this document.
- **Row answers are session state.** The conditions and Known Amounts that
  produced a total are gone when the page reloads. They are not recoverable
  after the fact.
- **Provenance is visible at the moment of approval** — `BOOK`,
  `IAOS DFW POLICY`, `MANUAL` — but is not persisted either.
- **Unpriced risks are visible at approval** and are likewise not persisted.

So the **deal-level total is the only comparison unit V1 hands us for free.**
Anything finer has to be written down deliberately, by a person, at the moment
of approval. That is a real cost and this loop keeps it as small as possible.

## 2. The observation record

One row per closed deal, recorded by hand. Six fields, and no more:

| # | Field | Where it comes from |
|---|---|---|
| 1 | Deal identifier | contact / opportunity id |
| 2 | Approved repair total | already in `estimated_repairs` |
| 3 | Actual repair cost | see below |
| 4 | Source and date of the actual | final rehab spend, contractor bid, or inspection scope |
| 5 | Which rows drove the estimate, and each row's provenance class | copied from the screen at approval, if captured |
| 6 | Unpriced risks at approval | copied from the screen at approval, if captured |

**Fields 5 and 6 are optional and best-effort.** They are the ones V1 does not
persist. An observation carrying only 1–4 is still a valid observation: it
supports the deal-level error and nothing else. Do not delay the loop waiting
for perfect row capture, and do not build a carrier to automate it.

**Where the record lives:** one spreadsheet, or the existing note surface on
the contact. That is the whole storage design. If a durable
`actual_repair_cost` carrier is later wanted, it is a separate Product Owner
decision requiring its own inert-proof, and it is explicitly **not** authorized
by this document.

**"Actual" needs its source named.** A contractor bid, an inspection scope and
a final rehab spend are three different claims about cost with three different
error characteristics. An observation whose source is unstated cannot be used —
it is not known what it is evidence of.

## 3. Provenance decides who may act on an error

This is the part that keeps the loop honest. An error is attributed to the
provenance class of the amount that produced it, and each class has exactly one
legitimate response:

| Class | What an error means | Legitimate response |
|---|---|---|
| `BOOK` | the cost-book line is wrong or stale | a cost-book correction; **not** a policy change |
| `IAOS DFW POLICY` | the approved policy amount is mis-set | **the only class a canonical amendment may change** |
| `MANUAL` | the operator's own figure was off | operator judgment; **never** evidence for a policy change |
| `UNPRICED RISK` at approval | a coverage gap, not an accuracy error | counted separately, per §4 |

Two rules follow, and they matter more than the arithmetic:

- **A MANUAL error is never policy evidence.** If the operator typed the
  number, the policy default was not what produced it. Folding manual errors
  into a policy average would let operator judgment silently rewrite policy.
- **A BOOK error is not fixed by moving policy.** Restating a cost-book figure
  as policy to make an error go away falsifies provenance. The 2026-09-04
  amendment's rule stands: historical BOOK values are not rewritten.

**Market and localization signal is RECORDED ONLY.** If observations start
clustering by area, write it down — and change nothing. Geography, ZIP, city
and market are not V1 repair-pricing inputs, this loop does not make them one,
and no volume of evidence turns a recorded observation into a pricing input
without a Product Owner decision that says so explicitly.

## 4. When a discrepancy is large enough to propose a change

**Proposed. Requires Brad's approval to become binding.**

The design constraint is that the cost book supplies no frequencies and this
loop must not invent any. So the trigger is deliberately crude, signed and
count-based, rather than statistical:

- **One deal never changes policy.** Ever. A single outlier is a story, not
  evidence.
- **A `system + state` qualifies for a proposal when all three hold:**
  1. at least **5** observations exist for that system and state;
  2. the error has the **same sign in at least 4 of 5** of them — the estimate
     is consistently high, or consistently low, not merely noisy;
  3. the **median absolute error** is at least **`max(25% of the policy
     default, $2,500)`**.
- **A coverage gap qualifies separately:** where an `UNPRICED RISK` for the
  same system appears in **3 of the last 10** closed deals, propose adding a
  reference row for it rather than changing an existing value.

The `max(25%, $2,500)` floor exists so a small default cannot qualify on a
trivial dollar swing, and a large default cannot hide a material one behind a
small percentage. Both halves are needed.

**These numbers are the proposal.** If Brad prefers different thresholds, the
structure survives unchanged — only the constants move.

## 5. What a qualifying discrepancy produces

A **dated amendment proposal** for Brad and Jess, under the PB-D43 convention.
Nothing else. Specifically:

- It **never** changes a value automatically. There is no auto-recalibration
  in V1 and none is authorized here.
- It cites the observations that triggered it — count, sign consistency, median
  error — so the reader can disagree with the evidence rather than the
  conclusion.
- It names the provenance class, and proposes a change only where §3 permits.
- Approved proposals land as a dated amendment to
  `ESTIMATED_REPAIRS_STANDARD.md`, exactly as the 2026-09-02 and 2026-09-04
  amendments did. Historical text is preserved, not rewritten.

## 6. Cadence

- **Check when a threshold trips.** The record is small enough to scan.
- **Otherwise review at every 10 closed deals, or quarterly, whichever comes
  first.**
- **Budget: fifteen minutes.** If a review is routinely taking longer than
  that, the loop has grown something it was not supposed to grow — cut it back
  rather than accepting the cost.

A review that finds nothing is a successful review. The expected outcome most
of the time is "no proposal", and recording that is worth the fifteen minutes.

## 7. Explicitly out of scope

Stated so the loop cannot quietly become the thing V1 was built to avoid:

- **No contractor estimating.** The loop compares totals; it does not price
  scopes, and it does not push line-item discipline back into the seller call.
- **No data warehouse.** One spreadsheet or note. No pipeline, no schema, no
  store.
- **No V1 seller-call redesign.** The accepted seven-row low-question surface
  is untouched by this document.
- **No persisted V1 line-item detail.** Locked principle 7 stands.
- **No automatic recalibration**, and no coefficient that moves without a
  Product Owner decision.
- **No geographic pricing input.** See §3.

## 8. Status

The process is defined and repeatable as written. Two things remain open and
are named rather than assumed:

1. **The §4 thresholds are proposals** and need Brad's approval before a
   proposal can be said to "qualify".
2. **Field 3, the actual repair cost, has no durable home.** It lives wherever
   the operator writes it. Giving it a carrier is a separate decision with its
   own inert-proof and is not authorized here.

Neither blocks the loop from running today on the deals V1 has already
approved.
