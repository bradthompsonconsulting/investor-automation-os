# Approved repair table — maintenance and review

## What this document is

The process that keeps the repair calculator's values current. It is
**periodic market maintenance, not calibration from deal outcomes.**

It **supersedes and replaces** the deal-by-deal calibration model proposed for
INV-15 at `fa5580b27e4954d4864c955f84d7e22603027329`, which Brad rejected on
2026-09-04. That model is not how IAOS works, and nothing from it is carried
forward. In particular this document contains no observation record, no
observation counts, no minimum-N rule, no same-direction rule, no median-error
threshold, no percentage or dollar trigger, no unpriced-risk frequency trigger,
no actual-repair-cost collection, and no automatic change to any value.

> *"We had several repairs in an area come in differently, therefore change the
> calculator"* is explicitly **not** the IAOS model.

Status: the process below is the approved architecture. §8 names the one thing
that is not yet built and deliberately was not built here.

---

## 1. The model

```
        APPROVED REPAIR TABLE
                 │
                 ▼
         REPAIR CALCULATOR
```

and, about every six months:

```
   WHOLE-TABLE DFW MARKET RESEARCH
                 │
                 ▼
      CURRENT vs PROPOSED VALUES
                 │
                 ▼
           BRAD: YES / NO
            │           │
         YES│           │NO
            ▼           ▼
   UPDATE APPROVED   KEEP CURRENT
        TABLE           TABLE
```

Plus one standing capability, independent of the six-month cycle:

```
   BRAD EDITS AN APPROVED VALUE  →  that value is the calculator default
                                     until it is changed again
```

Three properties define the whole design:

- **One table is the source.** The calculator reads approved values and holds
  none of its own.
- **Nothing changes automatically.** Every change to an approved value is a
  deliberate Brad decision — from the six-month review, or from a manual edit.
- **The review is whole-table.** It looks at every category and every state
  together, on a schedule, rather than reacting to individual deals.

## 2. What the approved table contains

Every calculator category, and both states for each. The current approved
contents are the fourteen values plus the untouched fallback, authorized by the
**2026-09-04 amendment** in `ESTIMATED_REPAIRS_STANDARD.md`, which remains the
policy authority:

| Category | Repair | Replace / Major / Material issue |
|---|---:|---:|
| Roof | $2,500 | $15,000 |
| HVAC | $2,500 | $8,000 |
| Electrical — whole house | $3,500 | $12,500 |
| Electrical panel | $1,500 | $3,000 |
| Plumbing / sewer | $3,500 | $12,500 |
| Foundation | $5,000 | $15,000 |
| Windows | $750 per window | $750 per window |

Plus the **untouched-estimator fallback, $20,000**, which is an approved table
value and is reviewed on the same cycle as the rest.

Unit-based values stay unit-based. Windows is `$750 per window`; the review
proposes a new per-window rate, not a lump sum.

## 3. Where the approved values live — OBSERVED

**The approved table is a single data file:**

    app/src/data/approved_repair_table.json

It holds all seven categories with their `repairDefault` and `severeDefault`,
the per-window note, and `untouchedFallbackAmount`. Its `_meta` block names the
canonical amendment as its authority, states the `IAOS DFW POLICY` provenance,
and records that nothing edits the file automatically.

**Everything downstream reads it and authors nothing:**

- `app/src/lib/repair-estimation/operator-model.ts` imports the file and
  derives `OPERATOR_ROWS` and `UNTOUCHED_FALLBACK_AMOUNT` from it. The module
  holds the behaviour and none of the numbers.
- `UnderwritingWorkspace.tsx` maps `OPERATOR_ROWS`; `defaultAmountFor()`
  returns the two fields. There is no other input to a loaded default.

**The policy authority is still the document**, and the chain is asserted:

- `docs/ESTIMATED_REPAIRS_STANDARD.md` — the "Approved V1 operator defaults"
  table in the 2026-09-04 amendment. The data file is downstream of it.
- `app/scripts/test-repair-operator.cjs` **parses that markdown table** and
  compares it to the loaded module, then asserts the module's rows are byte-
  identical to the data file. So the guard is `policy document → data file →
  module`, each link checked. A value edited in the JSON without a
  corresponding canonical amendment fails the harness.

That guard is live, not decorative: changing HVAC severe from `$8,000` to
`$9,999` in the data file fails with
`FAIL approved severe default: hvac — expected "8000", actual "9999"`.

**Changing an approved value is now a one-line edit to the data file**, plus
the canonical amendment that authorizes it. No code change, no third
transcription to keep in step. It still requires a commit, a build and a
deploy — see §8.

**Two other value sets exist and are NOT the approved table:**

- `app/src/lib/repair-estimation/reference.ts` — the superseded six-row
  canonical reserve table from the 2026-09-02 amendment. No longer read by the
  operator surface; still exercised by `test:repair-estimation` as the
  historical record. **Do not edit it during a review.**
- `app/src/data/repair_bid_sheet.json` — the FMTM cost book, the source of
  `BOOK` provenance. Consumed only by the superseded MAO calculator, never by
  the estimator. **Not part of the approved table and not reviewed here.**

## 4. The source-of-truth mechanism — BUILT

Delivered, not proposed. `app/src/data/approved_repair_table.json` is the
single authored copy of the approved values, and it collapsed the previous
three (code literals, canonical table, harness constants) to one plus the
policy document that authorizes it.

Shape:

```json
{
  "_meta": { "authority": "…ESTIMATED_REPAIRS_STANDARD.md — 2026-09-04",
             "provenance": "IAOS DFW POLICY…", "lastApproved": "2026-09-04" },
  "untouchedFallbackAmount": 20000,
  "rows": [ { "system": "roof", "label": "Roof",
              "repairDefault": 2500, "severeDefault": 15000,
              "severeLabel": "Replace" } ]
}
```

To change an approved value: edit the number, record the dated amendment that
authorizes it, run `pnpm test:repair-operator`. The harness will refuse the
change if the amendment does not match.

**What it deliberately does not do:** the file is in git, so a change is still
a commit, a build and a deploy. It does not make the table editable by Brad on
demand. That remains §8.

## 5. The semiannual review

About every six months. Whole table, every time.

1. **Research the entire table** — all categories, both states, and the
   unit-based values — using current DFW market and internet pricing evidence
   comparable in kind to the research that established the present values.
2. **Produce a plain current-versus-proposed list.** Only rows that would
   change need to appear:

   ```
   Roof Repair
     Current:  $2,500
     Proposed: $2,750

   Roof Replace
     Current:  $15,000
     Proposed: $16,000

   HVAC Replace
     Current:  $8,000
     Proposed: $8,500

   Apply proposed repair-price updates?   YES / NO
   ```

3. **Brad answers YES or NO.** One decision for the pass is enough; he may
   also accept some rows and decline others.
4. **YES** → the approved table changes and the calculator uses the new values
   from the next deploy. **NO** → the current approved values stand unchanged.
5. **Record the pass either way** as a dated amendment to
   `ESTIMATED_REPAIRS_STANDARD.md` under the PB-D43 convention — including a
   pass that changed nothing, because "we looked and kept them" is itself worth
   knowing six months later.

A review that proposes no change is a successful review.

**On geography.** This research is for the single operating market, and it
prices the table, not the deal. It does not reintroduce geography as a V1
pricing input: no ZIP, city or market is read at estimate time, no per-deal
localization exists, and the "geography is not a V1 pricing input" rule is
unchanged. Researching the market that the one approved table serves is not the
same as selecting an amount by location.

## 6. Manual editing, any time

The approved table is editable on demand and **does not wait for the six-month
cycle.**

An authorized manual change follows the same discipline as a review outcome: it
is Brad's decision, it is recorded as a dated amendment, and once approved that
value is the calculator default until it is changed again. There is no separate
class of "temporary" value.

## 7. Provenance — preserved, and not calibration machinery

The three classes stay distinct, for the reason they always did: an amount
declared by policy must never read as a cost-book fact, and an operator's own
figure must never read as either.

| Class | What it is | Relationship to the approved table |
|---|---|---|
| `BOOK` | an accepted cost-book value | the cost book, not the approved table; not reviewed here |
| `IAOS DFW POLICY` | a Brad-approved policy amount | **is** the approved table; what the review proposes changes to |
| `MANUAL` | an operator's figure on one deal | never feeds the table, and never proposes a change to it |

The last row is the important one. A manual override is one operator's judgment
about one property. It does not accumulate, it is not counted, and it is not
evidence about a policy value. That is precisely the rejected model, and
preserving provenance must not smuggle it back in.

## 8. Implementation boundary — STOPPED HERE, deliberately

**What this tranche delivered:** the architecture and process above, the
inventory in §3, and the source-of-truth file in §4 — the approved table is now
one authored artifact that the calculator reads and the harness checks against
canon. No storage added, no carrier created, no job scheduled, no UI built, and
no runtime behaviour changed: the values the estimator loads are identical.

**What an actually-editable approved table would require** — a follow-on
tranche, not INV-15:

- **Storage Brad can write to without a deploy.** IAOS already has a precedent
  worth considering first: investor-policy constants live in GHL **custom
  values** and are read at runtime through the existing
  `ghl-underwriting-policy` function and `ghl.underwriting.policy()`. Extending
  that pattern to repair defaults would need **new custom values**, which are
  new carriers — a Product Owner decision with its own inert-proof, and
  explicitly not created here.
- **A read path and a fallback** for when the store is unreachable, so a failed
  fetch can never silently zero a repair default.
- **An edit surface.** A spreadsheet Brad edits, or a small admin screen. Either
  is new UI beyond INV-15's scope.
- **Authorization**, since an edit changes underwriting for every future deal.

**What a six-month research mechanism would require**, if it is ever to be more
than a calendar reminder: external market-research access, and somewhere to
stage a proposed table beside the approved one. That is external infrastructure
and is likewise a follow-on.

**Recommended sequence:** §4's data file is done. What remains is deciding
whether operator-editability justifies the carrier, read-path and UI work
above — a Product Owner call, not an engineering one. The six-month research
pass can run as a human task against the current table today, with no mechanism
at all.

## 9. Out of scope

- No contractor estimating, and no line-item pricing in the seller call.
- No data warehouse, no per-deal observation store, no outcome collection.
- No V1 seller-call redesign — the accepted seven-row surface is untouched.
- No persisted V1 line-item detail; locked principle 7 stands.
- No automatic change to any approved value, from any source.
- No geography as a per-deal pricing input.

## 10. Status

The process is defined and repeatable as written, and can run today as a human
task against the values in §2.

**The approved table is now a single authored artifact** — one data file,
checked against the canonical amendment by the harness (§3, §4). That part is
done, and changing an approved value is a one-line edit.

One thing remains open and named rather than assumed: **the table is not
editable without a deploy.** A value change is still a commit and a release, so
it is a developer operation. Making it operator-editable needs the storage,
read path, edit surface and authorization set out in §8 — including new GHL
carriers, which is a Product Owner decision not taken here. Neither that nor
the research mechanism blocks the six-month review or a manual value change
from happening now.
