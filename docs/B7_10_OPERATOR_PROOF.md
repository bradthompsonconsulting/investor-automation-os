# B7-10 / INV-27 — Defensible ARV V1 operator proof

Status: **executed in IAOS Test; pending Jess gate**

Environment: Test location `SoTgVoaFGHtBdRFvXWQV` only

Fixture: Contact `NAGtUZ9aOE5C1GatJzpT`, Opportunity `MAl1FWHEsK0QqsXt4v6f`

This is a proof record, not a new product contract. Board #7's landed handoff,
CSV import, classification, reconciliation, workspace, persistence, and
snapshot/version seams remain authoritative.

## Reproduce

The ignored `.env.test` must contain the Test-location
`GHL_PRIVATE_API_KEY`. The runner refuses Production before loading that file.
It writes one approved ARV, appends its Contact note, then writes one override
and appends its Contact note. Evidence defaults to the operating-system temp
directory and never includes the credential.

```powershell
npx tsx scripts/operator-proof-arv-test.ts `
  --env test `
  --location SoTgVoaFGHtBdRFvXWQV `
  --credential-file .env.test
```

Run the deterministic and browser boundaries independently:

```powershell
node app/scripts/test-propstream-comp-csv.cjs
node app/scripts/test-comp-classification.cjs
node app/scripts/test-arv-reconciliation.cjs
node app/scripts/test-arv-workspace.cjs
node app/scripts/test-arv-persist.cjs
node app/scripts/test-arv-snapshot.cjs
node app/scripts/verify-propstream-handoff.cjs
```

## Observed 2026-09-04

- PropStream handoff: 9/9 checks. The complete subject address was copied,
  exactly one unchanged login URL was opened, manual-copy fallback stayed
  visible, and incomplete-address launch was disabled.
- Import/classification/reconciliation/workspace/persistence/version suites:
  430/430 deterministic assertions.
- Standard run: seven imported rows, four accepted comps, Level 1 stopped;
  median sale indication `658283.5`, PPSF indication `631752.5`, conservative
  recommendation `631752`.
- Expanded run: seven imported rows, five accepted comps, expansion stopped;
  recommendation `644863`.
- Live Test approval: Opportunity ARV `631752`, confirmed before the approval
  note was appended.
- Live Test override/reapproval: Opportunity ARV `639863`, confirmed before
  the override note was appended.
- Exactly two new append-only provenance notes were observed after the writes.
- Recommendation-only evaluation changed nothing before explicit approval.
- Contact ARV seed, offer fields, every non-target Opportunity custom field,
  pipeline stage, and status remained unchanged.
- Version 1 remained byte-identical after version 2; both fingerprints
  verified and both decisions remained independently recoverable.

The deterministic suites separately exercise the `$0`/unreliable public-record
path, all three dispositions with human-readable reasons, Level 2 instruction,
manual/`INSUFFICIENT`, the `<=5%` conservative path, `>5%` evidence conflict
without averaging, stale approval refusal, unconfirmed/partial failure, and
append-only reapproval history.

## Boundary

No Production request or mutation was made. No carrier was created. No Contact
ARV synchronization, per-comp GHL persistence, PropStream credential storage,
MAO/offer work, repair-estimator work, Board #8 work, or B7-11 work is present.
The rich snapshot ledger remains the B7-09 in-memory/versioned model; this proof
does not invent a durable store for it.
