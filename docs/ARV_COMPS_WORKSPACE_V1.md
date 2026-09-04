# ARV/comps operator workspace V1 — B7-07 / INV-24

## Operator boundary

The seller-call underwriting route now contains a dedicated ARV evidence
workspace. It reuses the approved B7-02 browser handoff, B7-04 CSV importer,
B7-05 classifier/controlled expansion, and B7-06 reconciliation engine. No
calculation policy is duplicated in React.

The summary exposes preliminary ARV, categorical evidence state, accepted
count, median sold-price indication, PPSF cross-check, conflict/manual-review
states, and the exact Level 2 PropStream instruction. The detailed view retains
imported raw evidence and shows each comp's disposition, reasons, and warnings.

## Seller-call flow

1. `Get Comps` copies the existing native subject address and launches the
   approved PropStream login URL in the investor's browser/profile/session.
2. `Import PropStream CSV` reads a local export into the B7-04 seam.
3. Existing subject-property carriers prefill property type, living square
   feet, beds, baths, and year built when present. No subject-subdivision
   carrier exists, so subdivision is an explicit session fact.
4. Brad records the buyer-market and transaction-credibility facts the CSV
   cannot establish. B7-05 produces the disposition, reasons, warnings, and
   controlled expansion outcome.
5. B7-06 produces the preliminary ARV or an explicit manual-review result.
6. `Approve ARV` or `Override` records Brad's explicit decision in component
   memory for the current session only.

## No persistence in B7-07

The workspace deliberately writes nowhere. CSV evidence, assessment facts,
preliminary calculation, approval, and override disappear when the page
unmounts or reloads. The UI states this directly. Persisting approved ARV and
provenance belongs to separately gated B7-08; B7-07 adds no GHL setter, field,
carrier, browser storage, network write, or Production mutation.

PropStream authentication remains browser-owned. IAOS stores no PropStream
username/password, drives no login DOM, and uses no bot or private API.

## Verification

`node app/scripts/test-arv-workspace.cjs` compiles and exercises the pure
workspace orchestration against the known B7-04 fixture, verifies carrier
seeding and malformed/controlled-expansion paths, and statically verifies the
operator actions and prohibited-surface absence.
