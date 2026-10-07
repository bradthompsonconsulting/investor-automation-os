# G5 legacy write-path audit (storage correction, plan v6 §10.2)

**Status:** the code-derived part is delivered with the implementation. The deploy/commit-range part is
**release evidence still to be gathered** (it needs the Netlify deploy inventory, a gated read). Until the
whole path set is established, **the default `{location: ALL effects}` block stays** (plan v6 §10.3).
Nothing in this document narrows anything; narrowing is only by an approved `authz/g5/narrow/<id>` record
under N1–N4 (or the AUDIT record below), applied by the separately authorized `iaos-cutover g5_narrow`.

## Why

A pre-v2 submission whose outcome was uncertain may have left **no durable record** (F10:
`lockContact` callers released on every exit, and pre-v2 conditional writes trusted the SDK's faulty
`modified`, F1). The import cannot block what it cannot see, so v2 refuses every GHL mutation whose
subject and effect classes intersect a block in `authz/g5/table`.

## Paths reachable at `3de480e` (code-derived)

| Path id | Function / branch | Subject (derivation) | Effect classes, including side effects | Uncertainty durably recorded before dispatch? (N1) |
|---|---|---|---|---|
| `ghl-write:note` | `ghl-write` `note.create` (plain notes and every ledger note, incl. derived authorization notes) | `contact:<targetId>` | `note` | Call-log notes and Current Offer outcome notes: a v3/v2 barrier claim existed, but via the faulty `modified` (F1) → **not N1**. Plain notes: receipt only → **no** |
| `ghl-write:contact-fields` | `contact.callLogResult`, `contact.lastCallAttempt`, `contact.callback`, `contact.explicitCallback`, `contact.disposition`, `contact.dispositionAt`, `contact.routing`, `contact.occupancy`, `contact.propertyNotes`, `contact.arv` | `contact:<targetId>` | `custom_field:<id>` per field; `call_result` (callDisposition), `last_touch` (lastCallAttempt[+Precise]) | **no** (F1; receipts only) |
| `ghl-write:opportunity-fields` | `opportunity.arv`, `.repairs`, `.askingPrice`, `.currentOffer`, `.assignmentMode`, `.underwriting` | `opportunity:<targetId>` | `custom_field:<id>`; `opportunity_value` (currentOffer) | Current Offer: barrier claim via F1 → **not N1**; others **no** |
| `ghl-write:stage` | `opportunity.underContractStage` | `opportunity:<targetId>` | `stage` | stage marker claimed via `onlyIfNew` with the F1 defect → **not N1** |
| `ghl-write:task` | `task.complete` | `contact:<targetId>` | `task` | **no** |
| `ghl-disposition` | webhook: note, then last touch (one PUT) | `contact:<customData.contact_id>` | `note`, `last_touch`, `custom_field:<lastCallAttempt ids>` | **no** (lock released on every exit; no outcome record) |
| `ghl-executed-artifact-upload:finalize` | preserved-artifact note | `contact:<opportunity.contactId>` | `note`, `executed_artifact` | **no** |

## Paths in earlier retained deployments (classes, not yet bounded)

| Path class | Known since | Subject / effects | Status |
|---|---|---|---|
| Generic proxy writes before INV-95 (`480abc8`, 2026-09-17) | early 2026 | **unknown subject → `location`; unknown effects → `*`** | keeps the default ALL block unless N2 (absent from every retained deploy) or N3/N4 evidence covers it |
| Automated contract send (`ghl-contract-send-execute`, before its V1 retirement) | `c4526b4` (2026-09-12) | `contact:<…>`: `contract_document`, `note`; possible `stage` | needs the deploy inventory |
| Voice (`voice-attempt`, `cb35c59`, 2026-09-17) | disabled fail-closed | `contact:<…>`: `message` | needs evidence it never dispatched (it stays disabled; plan v6 §13) |
| Any function whose source at a retained deploy's commit is not in git | — | — | **N2 unavailable; the default ALL block stays** |

## Evidence still required (gated)

1. The Netlify deploy inventory for `iaos-app-test` and `iaos-app` (every retained deploy: id, commit,
   published/permalink/preview) and, for each, the presence of each path at that commit (N2).
2. For any narrowing below location-wide: N1 proofs (code path + test), N3 coverage-complete logs, or N4
   identified-and-correlated reconciliation — exactly as `lib/g5-gate.ts` `validateNarrowing` enforces.
3. Reviewer approval of each narrowing record and of the resulting table digest; then a fresh activation
   (a changed digest refuses every write until then).

## The AUDIT narrowing record (shape)

```json
{ "v": 1, "id": "audit-0001", "pathId": "default", "rule": "AUDIT", "scopes": [],
  "auditEntries": [ { "pathId": "ghl-disposition", "scope": "location", "effects": ["note", "last_touch", "custom_field:…"] } ],
  "evidence": { "complete": true, "unresolvedDeploys": 0, "unauditedFunctions": 0, "documentDigest": "<sha256 of this audit>", "pathCount": N },
  "evidenceDigest": "<sha256 of canonical evidence>", "approvalRef": "<review reference>", "createdAt": "…" }
```

`validateNarrowing` refuses it unless the path set is complete; each audited path keeps a
location-wide block for its effect classes until a later N1–N4 record narrows it.
