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
6. `Approve ARV` or `Override` records Brad's explicit decision, writes and
   confirms the current ARV on the selected Opportunity, then appends one
   valuation-history note to the Contact.

## Persistence added by B7-08

The B7-07 evidence workspace remains session-based: CSV rows, assessments and
per-comp detail are not copied into GHL. B7-08 adds a narrow persistence
boundary only after explicit approval. It writes the existing authoritative
`opportunity.arv_after_repair_value` carrier, confirms it by singular GET, and
then appends one Contact note containing the minimum valuation provenance.

Re-approval replaces the single current Opportunity value and appends another
note; earlier notes remain unchanged. If the ARV write fails or is not
confirmed, no note is created. If the ARV is confirmed but the note fails, the
workspace reports the partial state and does not attempt rollback.

No new GHL field or carrier is added. `contact.arv` remains a seed and is never
synchronized. PB-D59's three-field underwriting Approve payload is unchanged.

PropStream authentication remains browser-owned. IAOS stores no PropStream
username/password, drives no login DOM, and uses no bot or private API.

## Verification

`node app/scripts/test-arv-workspace.cjs` compiles and exercises the pure
workspace orchestration against the known B7-04 fixture, verifies carrier
seeding and malformed/controlled-expansion paths, and statically verifies the
operator actions. `node app/scripts/test-arv-persist.cjs` exercises the pure
approval gate, named writer boundary, note ordering, re-approval history,
partial failure, and prohibited surfaces with injected mocks only.
