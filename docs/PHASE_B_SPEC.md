## 10. Phase B — Controlled Editability

### 10.1 Scope
Phase B introduces per-field editability to the Contacts detail view
(/contacts/:id, ContactWorkspace). It is a fresh scope, not a
continuation of Phase A. Phase A's read-only display remains the
default state.

This file is the build/verification spec for Phase B. It does NOT
define the write model. The write classes, the HARD NO set, and the
identity rules are defined in CONTACTS_OPPORTUNITIES_SPEC.md §4 and
are not restated here.

A field earns an input. It does not receive one merely because it
exists.

### 10.2 Field classes — defined elsewhere, cited here
Class definitions are owned by CONTACTS_OPPORTUNITIES_SPEC.md §4:
  Class 1 — field-edit, non-identity native + custom fields (§4.4)
  Class 2 — identity: primary email, primary phone (§4.3, dedup
    anchors, OBSERVED contactUniqueIdentifiers = ["email","phone"]
    with allowDuplicateContact: false), plus the address-identity set
    address1/city/state/postalCode on a separate business-rule
    justification, country excluded (§4.3)
  Class 3 — create new contact (§4.5)

Phase B implements Class 1 only. Class 2 receives no input. Class 3
is not started in Phase B.

Carried bounds, restated for build reference only — the authority is
CONTACTS_OPPORTUNITIES_SPEC.md §4.1:
  - offer_ fields: HARD NO. Read and display only. Never editable,
    never carry an input, in any phase.
  - tags, pipeline stage, workflow triggers: HARD NO. A field edit is
    never a licence to touch them.

Excluded from Phase B1 candidacy by CONTACTS_OPPORTUNITIES_SPEC.md
§4.3: additionalEmails and additionalPhones. They are PROVISIONAL —
read-only until a fixture collision-test proves they sit outside the
dedup set, and their element shape (bare string vs object) is UNKNOWN
and unobservable from location data. Not a B1 candidate.

### 10.3 Inert-proof — procedure
CONTACTS_OPPORTUNITIES_SPEC.md §4.2 and §4.4 require a per-field
inert-proof before any field is exposed as editable. This section is
the procedure for executing one. It adds no permission and relaxes no
bound.

Fixture: bradt75 / 9fbH2VCcZvzVNhsR9zjc, per
CONTACTS_OPPORTUNITIES_SPEC.md §4.2. The clean no-DnD fixture. Not
Neelima. Every PUT in an inert-proof targets this contact ID
explicitly — never .first(), never a queue index.

Executed as a read/write script. Never by UI action.

Steps:
1. Capture before-state from the singular contact GET:
     - the complete custom-field map as returned
     - tags
     - the seven offer_ fields
   Capture opportunity stage via the opportunity read path (10.6).
2. Write exactly one field in one PUT.
3. Poll the singular contact GET until the target value is observed or
   timeout. Never a fixed wait. Never the list endpoint — it lags the
   singular GET and will render a stale value as a failed write.
4. Confirm:
   OBSERVED (direct before/after comparison):
     - target field changed exactly as intended
     - no custom field other than the target changed. GHL returns only
       populated custom fields, so this is not a fixed schema: the
       comparison is over the union of keys present in the before and
       after snapshots. A key present in one and absent from the other
       is a change.
     - tags unchanged
     - opportunity stage unchanged
     - all seven offer_ fields unchanged
   INFERRED (no direct observation available):
     - no workflow enrollment fired. Per
       CONTACTS_OPPORTUNITIES_SPEC.md §4.6, workflow trigger config is
       not API-derivable — /workflows/{id} and /workflows/{id}/triggers
       both 404. This clause is proven only by the absence of its side
       effects, for which the full custom-field diff above is the
       primary instrument. It is not a direct observation and is not
       recorded as one. Do not infer triggers from workflow names.
5. Restore the original value with a second one-field PUT. Verify
   restoration by the same polling read.

Restore constraint. Where the target field is populated on bradt75,
restore is a write of the known prior string. Where it is unpopulated —
the ordinary case, since bradt75 is not a property lead — restore is a
clear, and clear semantics for a TEXT field are UNKNOWN.

The FIRST inert-proof establishes those semantics as part of its own
restore step. It is not an extra step; on an unpopulated field the
clear IS the restore:
  1. write a temporary value to the target field
  2. poll the singular GET until the value is observed
  3. run the 10.3 step-4 confirmation on that write
  4. clear the field
  5. poll and record the EXACT observed result: does the field's key
     disappear from the customFields array, or does it return with an
     empty-string value?
  6. record the observed behavior verbatim in 10.4 Part 1 before any
     second field is proven

If the key returns as empty string rather than disappearing, the
fixture is permanently altered — a field that was absent now exists
as empty. Record that as residue in 10.4 Part 1. It does not
invalidate the proof.

Once observed, clear semantics are OBSERVED for every subsequent
field and this procedure is not repeated.

### 10.4 Evidence record
docs/PHASE_B_INERT_PROOFS.md. One entry per field, in two dated parts.
The parts are written at different times and must not be merged.

Part 1 — inert-proof. Written BEFORE the field's input is exposed.
Contains the before and after values transcribed from the wire, the
PUT issued, the restore confirmation, and the 10.3 step-4 result.
Part 1 passing is what authorizes the unlock commit.

Part 2 — UI behavior. Written AFTER the unlock is deployed, since
save/cancel and dirty-state cannot be exercised before the input
exists. Contains manual verification of dirty-state indication, Save
committing the one-field PUT, Cancel discarding without a write, and
the displayed value surviving a failed write (10.5).

A field with Part 1 only is unlocked and not yet behavior-verified.
That is a valid intermediate state and is visible from the record.

Docs-only, never moves the bundle.

### 10.5 Harness impact
Harness remains app/scripts/verify-contacts.cjs. Extended in place. No
second harness file — a second file duplicates the bundle gate and
splits the floor across two constants.

Fixture distinction: the harness reads the Phase A display fixture
Neelima / FiIT0hUaxVCIuokQpZuc. The inert-proof writes bradt75 /
9fbH2VCcZvzVNhsR9zjc (10.3). These are different fixtures for
different purposes and neither substitutes for the other. The harness
issues no write.

Build note — collapsed folders. Collapsed folders stay mounted with
display:none, so an unlocked field's input is present in the DOM and
is counted by the allowlist check regardless of collapse state.
display:none also removes the element from the tab order and from
programmatic focus, so controls inside a collapsed folder are not
interactable until the folder is expanded. Native browser behavior;
Phase B builds no gating for it.

No-input check inverts. It currently asserts zero inputs within
record-section and identity-header. Phase B places inputs inside
record-section, so the assertion becomes an allowlist: the count of
inputs in scope equals the unlocked field count, and every input's
field ID is on the unlocked list. Modified in place; does not increment
the floor. It fails both on an unexpected input appearing and on an
unlocked field's input going missing. offer_ field IDs never join the
allowlist; their input-free state is covered by this check.

Per unlocked field, 4 checks are added:
  1. input present in record-section with data-testid keyed to field ID
  2. input's rendered value equals the wire value for that field
  3. Save control present, data-testid keyed to that field ID
  4. Cancel control present, data-testid keyed to that field ID

Check 2 is vacuous if the field is unpopulated on the harness fixture —
empty compared against empty passes before any Phase B code runs. B1
candidates must therefore be populated on Neelima (10.6).

Floor = 119 + 4N, N = unlocked field count. Restated at each increment.
The equality constant is updated with every unlock commit. Exact
equality prevents either an under-counted or over-counted run from
reporting success.

Excluded from the initial Phase B harness: dirty-state indication and
save/cancel behavior. Verifying them would require controlled live
writes and restoration against the authorized fixture. They are
verified manually and recorded per 10.4 Part 2, and will be specified
as a harness increment only after the rollback contract is locked.

Re-pin discipline carries unchanged from Phase A: EXPECTED must be
re-pinned to the served bundle hash after any app-code deploy that
moves the bundle.

### 10.6 Build sequence
B0 — Read-only recon. No PUT. Output transcribed as message text.
  1. Every Additional Info -> Property field on BOTH fixtures:
       - FiIT0hUaxVCIuokQpZuc (Neelima) — harness display fixture
       - 9fbH2VCcZvzVNhsR9zjc (bradt75) — inert-proof write fixture
     For each: name, fieldKey, field ID, dataType, picklist options if
     the endpoint exposes them, current value. Both dumps are required;
     B1 selection needs populated status on each independently.
  2. Resolve and print the contact -> opportunity -> stage read path.
     CONTACTS_OPPORTUNITIES_SPEC.md carries a RECON FINDINGS block on
     the Opportunities read path (OBSERVED 2026-07-21) — read it first
     and re-confirm rather than re-deriving. Snake_case contact_id and
     location_id are OBSERVED to work; camelCase contactId returns 422.
     Print the call and one live response showing stage.

B1 — First five Class 1 fields. Selected from B0 output against all of:
  - dataType TEXT
  - populated on Neelima (harness check 2 is non-vacuous, 10.5)
  - not computed or import-owned. NOT wire-derivable — B0 confirmed
    the schema exposes no ownership flag. This is an operational
    determination and is recorded per field with the reason.
  - not offer_, not an identity field per
    CONTACTS_OPPORTUNITIES_SPEC.md §4.3, not additionalEmails or
    additionalPhones
  - no companion field or special formatting requirement

Populated status on bradt75 is NOT a criterion. B0 OBSERVED that
bradt75 and Neelima have disjoint populated Property sets — bradt75
carries exactly one Property field (property_address, itself excluded
per CONTACTS_OPPORTUNITIES_SPEC.md §4.3). Requiring both would make
B1 unsatisfiable. Restore on an unpopulated field is handled by the
first-proof clear-semantics procedure (10.3).

  No DATE-typed field in B1. GHL DATE fields truncate time-of-day to
  midnight UTC, which passes an inert-proof cleanly while losing
  precision. Companion-field handling is deferred.
  One field per PUT. Batched multi-field save is deferred; a batched
  payload can carry an unproven field on a dirty-tracking error.

Field names are not pinned until B0 output is read.
B0 OBSERVED (2026-07-27) that Property Status and Property Type are
both dataType TEXT, not picklists. No Property def carries a
picklistOptions key; the key exists in the schema for genuinely
picklist-typed fields elsewhere. Property-subgroup dataTypes observed:
TEXT, NUMERICAL, DATE, MONETORY, FLOAT.

If fewer than five fields satisfy every criterion, B1 ships with fewer.
The criteria are not relaxed to reach five.
