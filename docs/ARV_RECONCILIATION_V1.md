# Conservative ARV reconciliation V1 — B7-06 / INV-23

## Boundary

`app/src/lib/arv-reconciliation.ts` consumes B7-05 classifications and B7-04
normalized comp evidence. Only `ACCEPTED` evidence participates. The pure
function calculates two indications and either returns a bounded preliminary
recommendation or stops for manual review. It performs no persistence,
network, GHL, UI, repair, MAO, offer, or Production operation and makes no
appraisal claim.

## Calculation contract

- Primary indication: median positive sold price from accepted evidence.
- Cross-check: median positive accepted PPSF multiplied by subject living
  square feet.
- The two indications are compared symmetrically using the lower indication as
  the denominator. This is the conservative interpretation of "within 5%": it
  never treats a pair as closer than a denominator based on the higher value
  would.
- At 5% or less, the lower indication is floored to a whole dollar and clamped
  to the minimum/maximum accepted sold-price range. It is never rounded upward
  or recommended outside the evidence-supported range.
- Above 5%, the result is `ARV EVIDENCE CONFLICT`, contains no recommendation,
  and requires manual review. The two methods are never averaged.
- At least three accepted comps with usable positive sold prices and at least
  three usable positive accepted PPSF values are required. Missing subject
  living square feet is also insufficient.

## Outlier boundary

PB-D61 supplies no automatic material-outlier threshold. Creating one here
would add unsupported scoring policy. An accepted comp may therefore carry an
explicit, provenance-bearing `materialOutlierReason`. Any such flag stops the
recommendation as `OUTLIER REVIEW REQUIRED`; the engine preserves the comp and
reason and routes to manual review instead of silently deleting or averaging
the anomaly.

## Categorical evidence state

- `HIGH`: sufficient Level 1 `STANDARD` evidence reconciles.
- `MODERATE`: sufficient Level 2 `EXPANDED` evidence reconciles.
- `LOW`: sufficient evidence exists, but a method conflict or material-outlier
  flag requires manual review.
- `INSUFFICIENT`: fewer than three usable accepted observations prevent the
  required calculation.

These are categorical results. No numeric confidence or similarity score is
created.

## Deterministic evidence

Run `node app/scripts/test-arv-reconciliation.cjs`. The harness proves odd and
even medians, PPSF multiplication, the exact 5% boundary, conflict handling,
supported-range clamping, insufficient evidence, conservative rounding,
categorical states, explicit outlier stopping, and prohibited-surface absence.
