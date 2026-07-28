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

Write separation. Each PUT in an inert-proof — the step-2 write and the step-5 restore, and in the first proof the temporary write and the clear — is independently approved, independently executed, and independently verified before the next PUT begins. No procedure runs two writes under a single approval. This spec fixes the invariant, not the tooling that satisfies it.

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
  1. Every Additional Info field — all 73, all four subgroups — on BOTH fixtures:
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

B1 — Class 1 field set. Selected from B0 output against all of:
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

B1 PINNED (2026-07-27). One field satisfies every criterion above.

Property Notes
  field ID   k7O0TYVMpqCpnMHRLPol
  fieldKey   contact.property_notes
  dataType   TEXT
  parentId   qYS1wakeOTmfgjyeSJ8M (Additional Info)
  subgroup   Investor — config-derived; the schema exposes no subgroup

Not import-owned: the operational determination required by the criterion
above is that Property Notes is human-maintained free text. No import
populates it.

Neelima FiIT0hUaxVCIuokQpZuc — POPULATED. Value OBSERVED on the wire
2026-07-27 via singular GET, verbatim:
  This is a property note on Neelima!  Yep it is!
Two spaces between "Neelima!" and "Yep". Harness check 2 asserts this
string exactly.

Provenance: populated by Brad through the GHL UI 2026-07-27 to qualify the
field. Recorded here rather than relaxing any criterion.

bradt75 9fbH2VCcZvzVNhsR9zjc — UNPOPULATED per B0. The wire representation
of an unpopulated field, key absent versus empty string, is UNKNOWN and is
established by the first inert-proof (10.3).

Property subgroup yielded zero candidates: 20 fail on dataType, 9 are
import-owned, Property Type is feed-derived, property_address is read-only
per CONTACTS_OPPORTUNITIES_SPEC.md §4.3. The human-maintained fields are in
Investor.

### 10.7 B1 unlock decisions — property_notes

PB-D2 — Control shape. The unlocked control is a `<textarea>`, not `<input type="text">`. Property Notes is free-form and grows past one line. Explicit Save and explicit Cancel controls. NO blur autosave — the §9.4 note-field onBlur pattern is not the Class 1 pattern. Newlines are entered naturally and are not intercepted.

PB-D3 — Harness hook. The textarea, its Save control, and its Cancel control each carry a `data-testid` keyed to the field ID, conforming to §10.5 checks 1, 3 and 4. An earlier `data-field-id` proposal is WITHDRAWN; `data-testid` is the existing convention.

PB-D4 — Check 1 scope. §10.5 check 1 additionally asserts the textarea is neither `disabled` nor `readonly`. This sits within check 1 and does NOT change the 4-per-field count.

PB-D5 — B1 pin. N = 1. Floor = 119 + 4(1) = 123. The `checksRun` equality constant is updated in the same commit as the unlock. `k7O0TYVMpqCpnMHRLPol` is the only ID on the allowlist.

Fixture note: `property_notes` is populated on Neelima / `FiIT0hUaxVCIuokQpZuc`, so §10.5 check 2 compares non-empty against non-empty and is not vacuous.

### 10.8 Editor taxonomy

Design principle: editor classes are implemented once; fields are proven individually. UI is reusable. Workflow-trigger risk is field-specific and not API-derivable (§4.6), so every field keeps its own inert-proof regardless of how many fields already share its editor.

PB-D6 - B2 is the MONETORY editor class. The specific proof field is selected from the Investor subgroup (ARV, Asking Price, Estimated Repairs, Carrying Cost) immediately before the inert-proof, not now. All four are human-maintained per 10.6, absent on bradt75, and share a dataType. Only ARV is currently populated on Neelima; choosing any other requires populating it there first to satisfy 10.5's vacuity rule.

PB-D7 - Editor and commit behavior are separate axes. `editor` answers how a field is edited. `commitBehavior` answers when the write fires. They are declared independently. Combining them into single names (inlineCurrency, saveText) conflates two concerns and does not scale.

PB-D8 - Every field declares an editor, including locked ones. The config is total across all 96 custom fields. `editor: "none"` means deliberately not editable, and is distinct from a missing entry, which means undecided. `offer_` fields declare `none`; the 4.1 HARD NO remains the governing rule and the declaration only makes it visible in the same table as everything else. The unlock allowlist is derived from this config, not maintained separately.

PB-D9 - Editor classes. Editor is a declared property of the field. `dataType` supplies the default only; per-field override is routine, not exceptional. Three overrides are already known: property_notes is TEXT but uses textarea, Owner Occupied is TEXT but reads as a yes/no, Timeline to Sell is MULTIPLE_OPTIONS but is operationally single-choice.

  inlineText  - default for TEXT
  textarea    - LARGE_TEXT, and TEXT by override
  currency    - MONETORY
  number      - NUMERICAL, FLOAT
  date        - DATE
  choice      - SINGLE_OPTIONS, and MULTIPLE_OPTIONS by override
  phone       - PHONE
  file        - FILE_UPLOAD, expected `none` in practice
  none        - not editable

PB-D10 - Commit behaviors.

  explicit  - Save and Cancel controls. Save writes. Cancel restores the wire value and writes nothing.
  inline    - Enter, Tab, or clicking out of the field saves. Escape cancels and restores the wire value. No persistent Save/Cancel controls. Unchanged value fires no PUT. State shown as Saving / Saved / Failed. The pre-edit value is held in component state for the page session so a failed write restores it.
  immediate - selecting a value writes at once.

Accepted risk on `inline`: every exit path except Escape commits, and a successful write of a wrong value is committed to GHL with no undo. Component state protects a FAILED write within the page session only. No post-save undo in V1; adding one would require a second compensating PUT workflow and is out of scope. Unchanged-value no-op reduces pointless writes and is NOT undo protection.

Caution on `immediate`: it is the only commit mode with no user-visible moment to reconsider. Its first inert-proof carries a correspondingly higher bar.

PB-D11 - Permitted pairs. Editor and commitBehavior are not freely composable. Only these pairs are valid:

  textarea + explicit
  inlineText + inline
  currency + inline
  number + inline
  date + inline
  choice + immediate
  phone + inline
  file + none
  none + none

`textarea + inline` is explicitly NOT permitted. Click-out saving a long free-text note is the accidental-write case this taxonomy exists to avoid.

PB-D12 - property_notes is FROZEN as implemented. It is textarea + explicit. It is not retrofitted to any later pattern, and its harness checks 120-123 stand unchanged. It is the proof of concept, not the template.

PB-D13 - 10.5 amendment. The floor formula 119 + 4N is UNCHANGED. Every unlocked field contributes exactly four checks; the floor stays trivially auditable. What varies is the check TEMPLATE, selected by the editor + commitBehavior pair, not the count. 10.5's literal check list (input present / value from wire / Save present / Cancel present) is hereby scoped to the textarea + explicit template only.

  textarea + explicit:  control present, value from wire, Save present, Cancel present
  inlineText + inline:  control present, value from wire, editable (not disabled, not readonly), NO commit controls rendered

Templates for the remaining pairs are defined when their first field is unlocked, not speculatively. Each template is exactly four checks.

PB-D14 - MONETORY read contract, OBSERVED 2026-07-28 on `contact.arv` / `wMBTGWMs97yysQFx7Vad`, Neelima. Value returns as a raw JavaScript number: `{"id":"wMBTGWMs97yysQFx7Vad","value":250000.5}`, `typeof` number. Decimals preserved. No currency symbol, no thousands separator, no string wrapper. Currency formatting is presentation only. Independently corroborated by the seven `offer_` fields, which also return bare numbers.

RESOLVED 2026-07-28 by the B2 inert-proof, recorded here rather than deleted — see PB-D16 and PHASE_B_INERT_PROOFS.md contact.arv Part 1. The write accepts an unquoted number, GHL neither coerces nor rounds, and `field_value: ""` clears to KEY_ABSENT. As written before the proof: whether the write accepts a number or a string, whether GHL coerces or rounds on readback, and what clears a MONETORY field. TEXT clears with `field_value: ""`; DATE ignores empty string and requires null (see the setCallbackDatetime comment in ghl.ts). MONETORY may follow either; the B2 inert-proof must handle both outcomes and must not assume the TEXT result carries over. It did, and MONETORY followed TEXT.

PB-D15 - Parameterized inert-proof runner is OUT OF SCOPE until after the MONETORY proof. B2 uses hand-written, separately approved proof steps following the property_notes precedent. With two completed proofs in hand, the runner is defined from two observed contracts rather than one, and parameterizes only what genuinely varies: field ID, dataType, temporary value, clear value, restore value (distinct from clear, since a field arriving populated must be restored rather than cleared), comparison strategy, and fixture expectations. The runner is the next leverage slice after B2 and before any third class.

Also record, non-blocking:
- Owner Occupied returns the STRING "No" on a TEXT field, not a boolean. A checkbox is correct UX but must serialize to whatever GHL expects, likely "Yes"/"No". UNKNOWN until proven.
- Timeline to Sell returns `["90+ Days"]`, a single-element array, on BOTH fixtures. MULTIPLE_OPTIONS write shape is UNKNOWN.

PB-D16 - Monetary write shape. The shared transport is a PRIVATE `putMonetaryField(fieldId, value)` helper. The public surface is `setARV(contactId, value)` and nothing else. 4.4 permits a private one-field PUT helper and forbids a public generic setter; a class-scoped public `setMonetaryField(fieldId, value)` is the forbidden shape with a narrower domain. dataType proves serialization, not field safety. Per 4.6, workflow triggers are not API-derivable, so "safe to write" is a per-field fact — MONETORY tells you how to serialize Asking Price, not whether writing it fires a seller cadence. With a named wrapper, unproven fields are unwritable by construction; with a class setter they are unwritable only by policy, and the inert-proof degrades from a structural gate to a convention. Each newly unlocked MONETORY field earns its own named public method by its own decision. Revisit promoting the helper to a public class-scoped setter only after a SECOND MONETORY field has passed its own inert-proof — two observed consumers, not one anticipated.

PB-D17 - `currency + inline` template, defined per PB-D13 at first unlock. Rendering is display-to-edit swap (Model B): formatted currency at rest, raw numeric while editing. Model A (always-rendered input) is rejected — Phase A built a read surface, and permanently-rendered form controls across a 96-field record degrade it, compounding with every unlock.

Four checks:

  currency-display-present     at rest, field-display-{ID} renders and NO input exists for that field ID
  currency-display-formatted   display text equals the wire number formatted en-US currency
  currency-edit-raw-value      after activating the display, EXACTLY ONE field-input-{ID} appears, holding the raw number (no symbol, no separator), enabled and not readonly
  currency-no-commit-controls  while still in edit mode, NO field-save-{ID} and NO field-cancel-{ID} render

Relationship to PB-D5's allowlist inversion: the at-rest no-input allowlist still governs the DOM at rest and still protects display-to-edit fields there. It does NOT prove editability for them — a display-to-edit field renders no input at rest, so that check passes for it regardless of configuration, which is true before the code under test runs. Editability for display-to-edit fields is proven through activation-specific checks instead, per check 3.

Harness write-safety, binding: the harness MUST NOT modify the value. Activate, assert, exit with Escape, no keystrokes between. Under `inline`, blur commits, and TARGET is a live record with ARV populated. PB-D10's unchanged-value no-op is a second line of defense only — relying on it as the first would make harness safety depend on the behavior under test. Checks run after the at-rest snapshot, and edit mode is exited before any subsequent check.

PB-D18 - `contact.arv` has NO app-side consumer. OBSERVED 2026-07-28. MaoCalculator reads opportunity-side fields exclusively: `const cf = opp?.customFields ?? []`, with `SOURCE_FIELD_IDS.arv = cBkygqcHRseZUGCYYeba`, a different field from the contact ARV `wMBTGWMs97yysQFx7Vad`. The contact field appears nowhere in app/src except ADDITIONAL_INFO_SUBGROUPS, which files it under Investor for display. Unlocking it cannot trigger a calculator recompute. The MAO-recompute question raised against Part 1 is closed here rather than carried into Part 2. Prepopulate is mount-time into component state with no reactive subscription — recorded for future reference, not load-bearing here.
