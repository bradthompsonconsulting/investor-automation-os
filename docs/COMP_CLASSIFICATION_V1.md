# Comp classification and controlled expansion V1 — B7-05 / INV-22

## Boundary

`app/src/lib/comp-classification.ts` consumes the normalized comparable
evidence produced by B7-04. It classifies every candidate as `ACCEPTED`,
`SUPPORTING`, or `REJECTED` and controls the Level 1 to Level 2 to manual-review
sequence. It performs no valuation, persistence, network, GHL, repair, MAO,
offer, or Production operation.

## Canonical policy

The exported `BOARD_7_COMP_POLICY` carries PB-D61's five classification and
expansion constants: 6 months, 15 percent, 12 months, 20 percent, and a target
of 3 accepted comps. PB-D61's 5 percent reconciliation constant belongs to
B7-06 and is deliberately absent from this engine.

Primary requirements remain gates, never scored factors: closed sale,
compatible fundamental property type, competitive/local buyer market, and a
credible transaction price. Failing or failing to establish any primary
requirement produces `REJECTED`. A candidate that passes those gates but falls
outside the active level's recency, size, or geographic criteria is
`SUPPORTING`. A candidate meeting both the gates and active criteria is
`ACCEPTED`.

## Explicit human facts

The CSV cannot establish whether two properties share a buyer market or
whether a facially plausible transaction is arm's-length. Callers therefore
provide a `CompAssessment` with categorical market relationship, transaction
reliability, and human-readable provenance. An optional explicit anomaly and
physical-difference warnings are also accepted. IAOS does not derive
neighborhood intelligence, grade condition photos, or invent those facts.

Differences in square footage, beds, baths, age, pool, market location, and
caller-supplied physical observations produce plain-language warnings. No
dollar adjustment is calculated or suggested.

## Controlled expansion

- Level 1 `STANDARD`: closed sales within 6 months, same property type,
  +/-15 percent subject square footage, and same subdivision or established
  local competitive market.
- If Level 1 has fewer than 3 accepted comps, the engine returns the constant
  `LEVEL_2_PROPSTREAM_INSTRUCTION`, containing the exact bounded PropStream
  search instruction.
- Level 2 `EXPANDED`: closed sales within 12 months, same property type,
  +/-20 percent subject square footage, and established immediate competitive
  area.
- If Level 2 still has fewer than 3 accepted comps, the engine returns
  `LIMITED COMP EVIDENCE`, requires manual review, and supplies no further
  search instruction.

## Deterministic evidence

Run `node app/scripts/test-comp-classification.cjs`. The harness compiles the
classifier with the B7-04 importer and proves all three dispositions, both
automatic stop points, the exact expansion instruction, the manual stop,
unreliable transactions, obvious anomalies, warnings, and prohibited-surface
absence.
