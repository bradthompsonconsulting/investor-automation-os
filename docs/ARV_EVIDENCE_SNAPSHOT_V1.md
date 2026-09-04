# ARV valuation evidence snapshots and versions — B7-09 / INV-26

## What this is

The contract for the IAOS-side record of **why a valuation produced the result
it did**, and for the rule that a later comp refresh never destroys an earlier
one.

INV-26's outcome in one sentence: **never destroy the evidence supporting an
approved ARV.** Its acceptance in one sentence: **two sequential valuation runs
can be inspected independently and the prior approved evidence remains
recoverable after refresh.**

Implementation: `app/src/lib/arv-evidence-snapshot.ts`.
Proof: `node app/scripts/test-arv-snapshot.cjs` — 149 deterministic checks.

## Boundary against B7-08 — these are two different things

| | B7-08 / INV-25 | B7-09 / INV-26 |
|---|---|---|
| Question | what ARV was approved, by whom, when | why that valuation produced that number |
| Lives in | GHL — the `arv_after_repair_value` carrier plus an append-only Contact note ledger | IAOS — the valuation ledger described here |
| Granularity | the durable **minimum** approval provenance | the full evidence set behind each run |
| Owner | B7-08 Tranche 2 | this document |

The note ledger does **not** replace this, and this does **not** replace the
note ledger. B7-09 creates no GHL field, writes nothing to GHL, and contains no
setter. The two responsibilities stay distinct and neither module may grow into
the other.

## The model

A **ledger** holds two append-only sequences for one subject:

```
ValuationLedger
  subjectKey
  snapshots[]   one per valuation run, versioned 1..n, immutable
  decisions[]   one per approval/override, sequenced 1..m, immutable
```

### Snapshots — the evidence

A snapshot is one valuation run frozen at capture. **It invents no new
representation of anything Board #7 already produces**; it holds the existing
types verbatim:

| INV-26 requirement | Type held | From |
|---|---|---|
| source / import metadata | `PropStreamCompImport["source"]` — kind, contract version, file name, import instant, exact headers, row count | B7-04 |
| comps considered | `PropStreamComparable[]` | B7-04 |
| duplicate-property groups | `PropertyEvidenceGroup[]` | B7-04 |
| import issues | `CompImportIssue[]` | B7-04 |
| subject facts used | `SubjectForCompClassification` | B7-05 |
| operator-established facts | `CompAssessment[]` | B7-05 |
| disposition of each comp | `CompSearchResult.classifications` | B7-05 |
| search level | `CompSearchResult.level` | B7-05 |
| median sale indication | `ArvReconciliationResult.primaryMedianSoldPrice` | B7-06 |
| median PPSF indication | `ArvReconciliationResult.medianAcceptedPricePerSquareFoot` | B7-06 |
| recommended ARV | `ArvReconciliationResult.recommendedArv` | B7-06 |
| evidence state | `ArvReconciliationResult.evidenceState` | B7-06 |

Only **two** things INV-26 requires had no existing representation, and each
gets exactly one new type: the retained source **artifact** reference, and the
approval/override **decision**.

**The operator assessments are preserved deliberately.** A comp's disposition is
not explicable from the CSV alone — B7-05 needs buyer-market and
transaction-credibility facts a CSV cannot establish. Keeping the outputs and
dropping those inputs would preserve the *what* and lose the *why*, which is the
thing this issue exists to keep.

### Decisions — the approvals

**Decisions are a separate append-only sequence, not a field on the snapshot.**
This is the load-bearing design choice.

Approval happens *after* a run is computed. Writing it into the snapshot would
force one of two bad outcomes: editing a frozen record, which is exactly what
INV-26 forbids; or refusing to snapshot a run until it is approved, which would
silently discard every run the operator considered and did not approve — and
those are precisely the comps INV-26 wants kept.

So a decision names the version it applies to, carries the amount, the
approver, the time, whether it was an approval or an override, the override
reason, and **what IAOS recommended at the moment it was made**. An override is
only legible beside the number it departed from.

Re-deciding **appends**. `effectiveDecision(version)` answers "what stands now";
`decisionsFor(version)` answers "what happened". An ARV approved at one figure
and later overridden leaves both on the record with their times — the same shape
Brad ruled for B7-08 on 2026-09-04: the current value may be replaced, the
history may not.

## Immutability is structural, not a promise

Every snapshot, decision and ledger is deep-frozen on creation. `readonly` is
erased at runtime and stops nobody; `Object.freeze` does not. `appendValuation`
and `recordDecision` return a **new** ledger, so a caller holding the ledger as
it stood before a refresh still holds exactly that.

Each snapshot also carries a **non-cryptographic content fingerprint** over its
own body, and `verifyLedger` recomputes them. This makes accidental corruption
and careless edits visible. It is **not** a security control and must never be
described as one: it does not resist anyone who recomputes the fingerprint too.

## Source artifacts — retained, never parsed

INV-26 permits a Complete Analysis PDF or a PropStream export to be retained
"for audit/reference without extracting every contained field". A snapshot
therefore carries `ValuationSourceArtifact` — kind, file name, byte length,
optional fingerprint, and a note saying why it was kept.

That is a **reference**, not a parser contract. Nothing in IAOS reads inside a
retained artifact. Field-by-field PDF extraction, PropStream API integration,
browser automation, and PropStream credential storage are all out of scope by
name, and the harness asserts their absence from the module.

## Serialization

A ledger is plain JSON-able data with an explicit schema tag.
`serializeLedger` emits **key-ordered** text, so the same ledger always produces
the same bytes — which is what lets the harness assert that version 1 is
*byte*-recoverable after version 2 exists rather than merely deep-equal.
`deserializeLedger` checks the schema tag before the shape, so a payload written
under a different contract fails loudly instead of half-loading and being
mistaken for evidence.

## What is NOT delivered, stated plainly

**Cross-session durability is not delivered by B7-09.** The ledger is a model
and a serializer; nothing writes it anywhere.

That is a scope boundary, not an oversight:

- New per-comp GHL carriers are a **HARD NO** in both INV-25 and INV-26.
- B7-07 recorded that the workspace adds no browser storage, and INV-26 did not
  authorize adding any.
- The GHL Contact note ledger belongs to B7-08 and is the *minimum approval*
  provenance, not a home for full comp evidence.

INV-26's acceptance is about a later **comp refresh** not destroying an earlier
run — its own words: "a later comp refresh creates a new valuation
version/snapshot rather than rewriting the evidence behind an earlier approved
ARV." That is what this proves, deterministically.

**Where a ledger comes to rest is a carrier decision no issue has yet
authorized.** Because the ledger serializes to stable text with a versioned
schema tag, whichever carrier is later approved can persist it without
redesigning any of the above. Naming that carrier is a Product Owner decision
and is not taken here.

## Not wired into the workspace

B7-09 ships the model and its proof. It does **not** modify
`ArvCompsWorkspace.tsx`, `UnderwritingWorkspace.tsx`, `ghl.ts`,
`arv-persist.ts` or `app/package.json` — every one of those is in flight for
B7-08 Tranche 2, and entering them would create a merge collision for no gain
that INV-26's acceptance requires. Wiring the workspace to capture a snapshot
per run is a bounded follow-on once B7-08 has landed.

## Verification

```
node app/scripts/test-arv-snapshot.cjs      149 checks, 0 failures
```

Two sequential runs are built from two committed CSV fixtures through the
**real** B7-04 importer, B7-05 classifier and B7-06 reconciliation engine — no
stubs — and the harness asserts, among the rest: version 1 is byte-identical
after version 2 and again after a third refresh; source metadata, subject facts,
comp dispositions, search level, both median indications, recommended ARV,
evidence state and every decision stay bound to the correct version; an attempt
to mutate history does not take; a tampered snapshot fails its fingerprint; and
the module contains no GHL client, custom-field id, network call, browser
storage, clock, ARV writer, note ledger, per-comp carrier, PropStream credential
or PDF parser.
