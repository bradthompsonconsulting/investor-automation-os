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

PB-D19 - Escape cancellation is synchronous. Under `inline`, Escape MUST set a cancellation flag via `useRef`, never `useState` — a state update is not visible to the blur handler in the same event sequence, so a state-based flag reads stale and the blur commits the value Escape was pressed to discard. The blur handler MUST check the ref before committing. The flag resets after the blur handler has consumed it. Per PB-D10's accepted risk, a successful wrong write has no undo, which makes Escape the ONLY protection on the entire `inline` class; a blur that commits after Escape defeats that protection silently and leaves no trace. Part 2 manual verification for any `inline` field MUST include: edit the value, press Escape, and confirm ZERO PUT requests in the Network panel. A reverted display alone proves nothing — the app can write the new value and repaint the old one, and the two are indistinguishable on screen.

PB-D20 - Currency input syntax and invalid handling, `currency + inline`. Accepted at commit, after trimming leading and trailing whitespace: optional leading `-`, optional `$`, digits with EITHER correctly grouped thousands commas OR no commas at all, optional single decimal point followed by digits. Commas must form correct thousands groups, `\d{1,3}(,\d{3})*`. Malformed grouping is INVALID and is NEVER silently stripped — `25,00,0` must not become `25000`.

  valid:    187500.25   $187,500.25   187,500   $250000   -1200   (empty)
  invalid:  25,00,0   1,2345   12.3.4   abc   $   -   1,234,56

Empty input is valid SYNTAX — it is not rejected and does not raise the validation message. It is NOT a clear. See PB-D22: an empty draft exits edit mode and restores the current persisted value, and issues no PUT. Normalization for the wire: strip `$` and commas from an ACCEPTED string, then parse. GHL receives a bare unquoted number.

Invalid input does NOT commit and does NOT cancel. The editor REMAINS OPEN with the draft preserved, fires no PUT, and shows an inline validation message. On Enter, focus stays in the field. On click-out or Tab, focus moves normally — the editor stays open but unfocused, and clicking it returns focus. Focus is NEVER forced back on blur; an input that recaptures focus on every exit is a trap the user cannot leave. Escape is the only cancel, and reaching it after focus has moved requires clicking back into the field, which is acceptable because the draft remains visible.

Silent cancellation of invalid input is FORBIDDEN. A vanished value and a saved value are indistinguishable on screen — the same defect class PB-D19 exists to prevent.

PB-D21 - What "Saved" asserts, `inline` class. "Saved" means GHL was read back and confirmed. It does NOT mean the PUT returned 2xx.

  PUT 2xx                          -> "Verifying..."
  readback matches expected         -> "Saved"
  readback completes, no match      -> "Save accepted — not yet confirmed"
  PUT non-2xx or throws             -> "Save failed"
  readback GET errors or throws     -> "Couldn't verify save"

Verification is a bounded poll of the SINGULAR contact GET — the same instrument the inert-proofs use — and NEVER the PUT echo, which can reflect what was sent rather than what was stored. Bound: 3 attempts, 1s apart, beginning after the PUT resolves. The first attempt runs immediately; the 1s interval separates attempts and does not precede the first.

The bound governs BOTH unsuccessful outcomes, not only a completed read that fails to match. A read that THROWS consumes one attempt and the poll continues. The transport helper throws on any non-2xx as well as on a rejected fetch, so a transient proxy 5xx and a dead socket arrive as the same exception with nothing to distinguish them; a transient 5xx is precisely the case a bounded poll exists to absorb, and abandoning verification on the first one forfeits that for the sake of two seconds.

Which terminal state an exhausted poll settles to depends on whether the instrument ever worked. The two failure states in the table above make different claims and must not be collapsed:

  at least one read COMPLETED, none matched       -> "Save accepted — not yet confirmed"
  all 3 reads THREW, none completed               -> "Couldn't verify save"
  mixed: some threw, some completed, none matched -> "Save accepted — not yet confirmed"

A completed read is evidence ABOUT THE DATA — GHL answered and the value was not there yet. A thrown read is evidence ABOUT THE INSTRUMENT — nothing was learned either way. One clean read is enough to make the weaker data claim, so the mixed case follows the completed rule. "Couldn't verify save" is reserved for a poll that never once reached GHL.

This does not weaken the no-repeat rule. The PUT is still never reissued. Retrying is retrying the READ.

Readback equality is SEMANTIC, not textual. A numeric save is confirmed when the returned value compares equal AS A NUMBER to the value sent. A clear is confirmed when the field key is ABSENT from customFields. Never compare formatted strings such as `$187,500.25`. Never treat an absent key and a numeric `0` as equivalent — they are different states.

The PUT is NEVER automatically repeated. A lagging read is not a failed write, and a retry would write twice. This is why timeout reads "accepted — not yet confirmed" rather than "failed": the wording must not invite the user to click again. "Save failed" is reserved for a PUT that did not succeed; a verification GET that errors is a separate and weaker claim, since the write may well have landed.

Supersedes the optimistic post-PUT pattern in `setPropertyNotes` for the `inline` class ONLY. PB-D12 freezes property_notes as implemented; it is not retrofitted.

PB-D22 - An empty draft is not a clear, `inline` class. On Enter, Tab, or blur with an empty draft, the inline editor exits edit mode and restores the current persisted value. No PUT is issued. Clearing the field is intentionally NOT available through the inline monetary editor.

Editing and clearing are different intents. Editing changes an existing value; clearing removes the existence of one. They share a wire representation but not a risk profile, and the inline editor was designed for the first. PB-D16 defines `field_value:""` -> KEY_ABSENT as the API contract and that contract is UNCHANGED; `setARV(contactId, "")` still performs a real clear. What PB-D22 removes is the KEYSTROKE that reaches it. An API operation existing does not oblige every surface to expose it.

The failure this prevents was OBSERVED, not hypothetical (PHASE_B_INERT_PROOFS.md Parts 5-7). Invalid input leaves the editor open with a bad draft, per PB-D20. The natural recovery is select-all-delete. Under the prior rule that draft was then VALID, so Enter committed a clear and the field's value was gone. Both halves were individually spec-compliant; the destructive act sat one keystroke behind the most common correction gesture, with nothing on screen distinguishing it from an edit.

Two alternatives were considered and rejected.
  - Leave it as written. Internally consistent, but keeps a destructive write behind the recovery gesture for no benefit.
  - Suppress the clear only when the row was previously invalid. Fixes the observed path by making Enter mean two different things on an identical-looking empty field, depending on session history the user cannot see. That is an invisible mode, which is the defect class PB-D19 exists to prevent. It also requires a clear affordance in the row, which PB-D17 forbids for this class.

PB-D22 is stateless. It does not depend on how the draft became empty, and it adds no control to the row.

This does not weaken PB-D19. Escape remains the general cancel for ANY draft. PB-D22 governs only the empty case, and its restore is the same visible outcome, reached differently.

Scope note: for a field that is ALREADY absent, behavior is unchanged — `beginEdit` opens with an empty draft, so PB-D10's unchanged-value guard already fires no PUT. PB-D22 changes exactly one path: a populated field emptied and committed.

Consequence accepted: there is currently NO way to clear a MONETARY field from the UI. That is deliberate. An explicit clear action is deferred until there is a real requirement for one; designing it will mean reopening PB-D17's no-commit-controls rule for a narrow case, and that is a better trade taken on demand than pre-built.

### PB-D23 — The inert-proof runner is parameterized by field, not by dataType

**Decision.** PB-D15's parameterized inert-proof runner takes a field as its parameter. It does not consult a dataType contract table. No such table is built at this time.

**What is observed, and its scope.** Two fields have completed inert-proof verification: `property_notes` (TEXT, B1, Parts 1–2) and `contact.arv` (MONETORY, B2, Parts 1–7). Their inert-proof behavior is uniform. This is an observation across two fields, one of each dataType — not across dataTypes. One field has been exercised for each dataType (n = 1 per dataType). It is recorded as uniform-as-observed for the fields exercised so far, and carries no claim about any field or dataType not yet proven.

**Fixed-pair rejected.** A two-entry table whose entries hold identical values discriminates nothing. The runner behaves identically with it or without it, and every lookup against it succeeds regardless of whether the runner is correct. It asserts something true before the code under test runs — the tautology trap in structural form.

**Open-registry rejected.** Its first consumer does not exist. No third dataType is unlocked, is a Phase B candidate, or has a proof record. Building it now is abstraction ahead of its first consumer, which §-no-abstraction forbids on every build.

**DATE is not the third entry.** DATE is excluded, and the reason is not that its behavior is known to differ — it is that its behavior is largely UNKNOWN. What is OBSERVED: DATE-typed GHL fields silently truncate time-of-day to midnight UTC, which is why the `_precise` companion TEXT field pattern exists. Its clear semantics and its inert-proof behavior have never been exercised. DATE cannot serve as a third table entry because there is no inert-proof evidence to record for it.

**Trigger to revisit.** Build a dataType contract table only when a third dataType enters inert-proof verification and at least one proven behavior differs from the others. At that point the variation is real, the table has a consumer, and its shape is informed by observed behavior rather than prediction. Fixed-pair versus open-registry is decided then, against the actual third case.

**Unchanged.** This decision governs the runner's parameterization only. It does not alter any field's unlock status, any existing proof record, or PB-D16's wire contract.

### PB-D24 — Rollback semantics when the original wire state is KEY_ABSENT, and the PB-D16 promotion gate

**Decision — strict restoration.** An inert-proof captures both the prior value AND the key's presence before writing. Rollback restores the exact original wire state: if the key was present, PUT the original value; if the key was absent, restore absence. Rollback is not complete until a read confirms the restored wire state. A successful restoring PUT is necessary but not sufficient, per PB-D21.

**Absent-origin mechanism for MONETORY.** `field_value: ""` → KEY_ABSENT, per PB-D16's wire contract. No new mechanism is designed; the restoring call is the same shape as the clearing call already in use.

**Evidence boundary.** That contract was observed through `contact.arv` alone. PB-D16 states the governing distinction directly: dataType proves serialization, not field safety. Clear-on-empty is serialization, so PB-D24 relies on it at the level PB-D16 already generalizes. Field safety is not generalized and is not generalizable — per PB-D16 §4.6, workflow triggers are not API-derivable, so "safe to write" remains a per-field fact. The B3 field must prove its own write safety independently. MONETORY tells the runner how to serialize. It does not tell the runner a field is safe to write.

**Not a cross-dataType rule.** DATE ignores empty string and requires `null` (per the `setCallbackDatetime` comment in `ghl.ts`, recorded in the clear-semantics note at PB-D14). PB-D24's absent-origin mechanism is MONETORY-specific and carries no claim about DATE or any dataType not yet proven. This is the same TEXT/MONETORY-versus-DATE split PB-D23 relies on.

**Alternatives rejected.**
- *Value-only rollback* — restores prior values but leaves an originally-absent field populated. A proof that can leave the record changed is not an inert-proof. Rejected on definition, not preference.
- *Require prepopulation* — a field must be populated before participating. This does not remove the absent-origin case; it relocates it. Establishing the precondition means writing into an absent field, which is an unrollbackable absent-origin write, unless the precondition is satisfied by hand for every run — in which case the runner carries a permanent manual step and the absent-origin path stays unproven. Rejected.

**Fixture state at the time of this decision.** On `FiIT0hUaxVCIuokQpZuc` (Neelima), all three candidates are POPULATED — `contact.asking_price` 115000, `contact.estimated_repairs` 15000, `contact.carrying_cost` 6000, wire-confirmed, dataType MONETORY confirmed against the location custom-field schema. On `9fbH2VCcZvzVNhsR9zjc` (bradt75), all three are ABSENT. Both origin states are therefore available deliberately: populated-origin rollback provable on Neelima, absent-origin rollback provable on bradt75. Neither path need be discovered accidentally.

**Promotion gate — eligibility, not authorization.** PB-D16 restricts the public surface to `setARV(contactId, value)`, keeps `putMonetaryField` private, and defers revisiting a class-scoped public setter until a SECOND MONETORY field has passed its own inert-proof. The B3 field is that second field. A passing second MONETORY inert-proof satisfies the eligibility condition for review. It does not itself change the public API. It does not authorize exporting `putMonetaryField`, generalizing it, or adding any public method beyond the named wrapper the newly proven field earns by its own decision. Two safe fields do not prove every MONETORY field safe. The review is a separate named decision, taken deliberately after the proof passes — never as a side effect of it.

**Unchanged.** PB-D16's wire contract, PB-D22's keystroke removal, PB-D23's runner parameterization, and every existing proof record are untouched.

### PB-D25 — Post-write assertion is value equality, not presence

**Decision.** Every TEXT or MONETORY inert-proof write step asserts that the field's read-back value equals the value sent. Presence of the field key is not a sufficient pass condition.

**What is observed, and its scope.** `inert-proof-property-notes-step3.cjs` gates on `deepEqual(entry.value, tempValue)`. `inert-proof-arv-step3.cjs` gates on `!!entry` alone, and states its reason in-line: MONETORY stored representation was unknown, and ARV was absent at capture, so presence alone was taken to prove the write landed. That script also records `observedValue`, `observedType`, and `strictEqualsTemp` without asserting on them.

**The presence-only path is a closed bootstrap.** PB-D14 established the MONETORY read contract — bare JavaScript number, `typeof` number, decimals preserved, no wrapper — corroborated across the seven `offer_` fields. The unknown that justified presence-only is closed. The weaker assertion was an artifact of discovery order, not a property of MONETORY, and does not transfer to any subsequent field.

**Origin state does not weaken the assertion.** Absent-origin versus present-origin determines what the rollback restores to, per PB-D24. It does not determine assertion strength. An absent-origin field is written and then read back for equality like any other.

**DATE is not in scope.** DATE's stored representation is unproven, and DATE truncates time-of-day. Whether equality is assertable for DATE is UNKNOWN and is not decided here. This is the same TEXT/MONETORY-versus-DATE split PB-D23 relies on.

**Trigger to revisit.** A dataType whose read-back representation is not yet observed. The first inert-proof for such a dataType may record its observed representation without asserting equality, exactly as ARV-step3 did, and that recording is what closes the unknown for subsequent fields of that dataType.

**Unchanged.** PB-D14's read contract, PB-D16's wire contract, PB-D23's runner parameterization, PB-D24's restoration semantics and promotion gate, and every existing proof record are untouched. Passing the write assertion does not reduce the requirement to verify restored state afterward.

### PB-D26 — Runner stage ownership and boundaries

**Decision.** The parameterized inert-proof runner is organized into four stages with exclusive responsibilities: **capture**, **write**, **verify**, and **restore**. Each stage owns one concern. Cross-stage responsibilities are prohibited. Write does not poll or verify its own effect; verify does not issue writes.

**What is observed, and its scope.** The existing hand-written proofs already demonstrate this separation. `inert-proof-arv.cjs` performs two GETs and no writes, capturing the full `customFields` array, `tags`, the seven `offer_` IDs, and the opportunity/pipeline IDs. `inert-proof-arv-step2.cjs` performs exactly one PUT, captures `responseStatus` and the response body, and comments its own boundary: no re-read, no poll. `inert-proof-arv-step3.cjs` is read-only and performs the poll and comparison. The runner formalizes stage boundaries already present in the hand-written proofs rather than introducing a new execution model.

**Preconditions belong to write, not verify.** The write stage may perform observational reads to establish that a write is safe to perform — `inert-proof-arv-step2.cjs` gates on both the step-1 evidence file and a live re-read requiring the record unchanged. A precondition establishes that the write *should be issued*; verification establishes what the write *did*. The boundary is by purpose, not by method.

**Why the write/verify split is load-bearing.** PB-D21's retry-on-thrown-read remains UNVERIFIED because every PUT in Parts 2–7 was followed by exactly one successful verify read, so no retry condition ever arose. Keeping verification separate preserves PB-D21's independently testable retry path.

**Each stage records evidence before terminating.** A failed PUT is an observation, not an aborted run. `inert-proof-arv-step2.cjs` writes failure evidence to its evidence path before `exit 5`. Every stage persists what it observed prior to any non-zero exit.

**Stage count is not file count.** The four stages are responsibilities, not a mapping onto the existing five-file layout. The current files split write across two stages and have no restore stage; that reflects the structure of the existing proofs rather than the architectural stage model. PB-D24 governs what restore does.

**Unchanged.** PB-D14's read contract, PB-D16's wire contract, PB-D21's retry requirement, PB-D23's runner parameterization, PB-D24's restoration semantics, and PB-D25's assertion contract are untouched.

### PB-D27 — One stage per process invocation

**Decision.** A single invocation of the inert-proof runner executes exactly one stage. The stage is a required selector. There is no `all`, no default stage, no implicit sequencing, and no automatic transition to the next stage. Advancing requires a separate command.

**Guards.** A missing stage selector, an unrecognized stage, or more than one stage argument each exit non-zero without performing any network call.

**Why the checkpoint is the point.** The hand-written proofs placed a human decision between every step: capture, then write, then verify, then clear, then verify again — each a separate deliberate command. That interval is where a wrong temp value, a wrong fixture, or an unexpected before-state gets caught before the next write compounds it. Collapsing the runner into a single sequenced invocation would remove the checkpoint while leaving every other safety property intact, which is what makes the erosion easy to justify and hard to notice.

**This does not follow from PB-D26.** PB-D26 assigns exclusive responsibilities to stages. It does not constrain how many stages one process may run. Stage separation and invocation separation are different properties; this decision supplies the second.

**Unchanged.** PB-D24's restoration semantics, PB-D25's assertion contract, and PB-D26's stage ownership are untouched.

### PB-D28 — Runner field configuration is an in-file keyed registry

**Decision.** All field-specific configuration lives in a keyed registry inside the runner file. Invocation accepts exactly two bounded selectors: `<stage> <fieldKey>`. No field ID, temporary value, clear value, or comparison rule is accepted from the command line.

**Guards.** An unrecognized field key exits non-zero before any network call, as does a stage/field combination the registry does not support. Validation precedes network access.

**Why in-file rather than CLI or a separate JSON.** Every write-bearing value stays under version control and appears in a diff before it can reach a record — the same review path that caught wording in this spec. A mistyped temporary value at a prompt is a real write to a real contact with no reviewer between the keystroke and the PUT. A separate JSON file adds an artifact and load path without any independent consumer or reuse requirement; the registry is internal for the same reason, per the no-abstraction-without-its-first-consumer rule.

**Restore is a strategy, not a stored value.** PB-D15 lists "restore value (distinct from clear, since a field arriving populated must be restored rather than cleared)" among the runner's parameters. Its own parenthetical grounds that in what capture observed, and PB-D24 settled it: restore targets the exact original wire state, value or absence. The registry therefore carries a restore *strategy*, never a hardcoded restore value. This refines how PB-D15's parameter may be used in the same way PB-D23 refined its `dataType` parameter; it does not remove the parameter.

**The absence mechanism is registry configuration; the restore target is not.** What value achieves KEY_ABSENT is dataType-dependent — MONETORY uses `field_value: ""` per PB-D24, the proven TEXT clear path uses `""`, and DATE requires `null` and is out of scope. That mechanism belongs in the registry. The value a populated field is restored *to* comes from capture and never from the registry.

**Unchanged.** PB-D15's parameter list, PB-D23's parameterization, PB-D24's restoration semantics, PB-D25's assertion contract, PB-D26's stage ownership, and PB-D27's invocation constraint are untouched.

### PB-D29 — Stage exit codes and evidence path derivation

**Decision.** Two things the runner's stages require that no prior decision allocates: exit-code ownership and evidence file paths.

**Exit codes.** Dispatcher exit codes remain 10–13 per PB-D27. Each implemented stage allocates distinct exit codes for its own distinct failure branches. Future stage ranges are assigned when those stages are implemented.

**Evidence path is derived, not stored.** The registry carries no evidence path. A directory constant plus a filename derived from stage and field. The field portion is produced by applying the existing script-name convention to the registry key — observed: `property_notes` → `property-notes`.

**Existing evidence filenames are retained.** Stage evidence keeps the `-step<N>.json` form already on disk for both proof families. The runner maps stage to step number internally. No migration of the existing proof corpus is undertaken, as no benefit from renaming has been identified.

**Not §10.4.** §10.4 governs `docs/PHASE_B_INERT_PROOFS.md` — markdown, per field, two dated parts, authorizing the unlock commit. Transient stage evidence JSON is a separate artifact and is not governed by those rules.

**Unchanged.** PB-D23 through PB-D28 are untouched.

### PB-D30 — Write stage contract: absent-origin only, observed temp values, five exit codes

**Decision.** The write stage inherits the existing step-2 contract without relaxation. It writes only to fields observed absent both in capture evidence and live, only with temporary values observed from existing scripts, and reports five distinct failure classes.

**Overwrite guards are inherited unchanged.** Write aborts if the live field is already populated, and aborts if capture evidence records `fieldPresent !== false`. The two protect different things — the live check protects the contact's current state, the evidence check protects the integrity of the proof sequence. Neither is relaxed to make PB-D24's populated-origin restore reachable.

**Populated-origin restoration requires a separately specified mechanism.** An explicit mode or a separate proof fixture, specified on its own terms. It is not an expansion of ordinary write, and PB-D24's populated-origin path remains unexercised until that mechanism exists.

**`tempValue` is registry configuration, observed only.** `arv` receives `tempValue: 187500.25`, observed from `inert-proof-arv-step2.cjs`. `property_notes` receives none; no TEXT temporary value has been observed. `write property_notes` therefore aborts before any network call with `write aborted: config.tempValue is not defined for fieldKey=property_notes`. A registry key being supported is distinct from its being write-enabled.

**Write stage exit codes, per PB-D29's allocation rule.** 30 file/config precondition — missing capture evidence, malformed evidence, contact or field identity mismatch, missing `tempValue`, recorded `fieldPresent !== false`. 31 live precondition — contact id mismatch, field presently populated, the live `customFields` or `tags` no longer deep-equal the capture snapshot. 32 PUT returned non-2xx, with response evidence written under the seven-key contract. 33 evidence persistence failure. 34 transport failure before a response, response-body handling failure, or any unexpected runtime exception not classified above. The exit code identifies the failure class; the abort message identifies the specific predicate.

**Evidence persistence failure takes precedence.** Any failure to persist stage evidence exits 33, regardless of whether the PUT returned 2xx, returned non-2xx, or failed after a response was received. A non-2xx response earns 32 only when the seven-key evidence record was successfully written. The dangerous condition is a mutation attempt that is no longer durably recorded, and that condition outranks the response status in classification.

**Live precondition is contact-only.** Step 2 issues no opportunity search and the runner's write stage does not add one. Opportunity and pipeline state is captured by the capture stage and is not re-verified before a write.

**Unchanged.** PB-D23 through PB-D29 are untouched.

**Amendment (2026-08-03): designated test values.** A temporary proof value may be either a previously observed value or a deliberately selected test value explicitly approved before the write. A designated test value must be valid for the field, recognizable during verification, unlikely to be confused with production data, and restored immediately after the proof cycle. The registry entry labels which of the two a value is; a designated test value is never described as observed. `arv`'s `187500.25` remains an observed value per the record above. This amendment supersedes the "observed only" constraint in this section's heading, its Decision paragraph, and its `tempValue` paragraph for future proof values, while preserving the historical provenance of values already recorded.

### PB-D31 — Verify stage contract: equality poll, fixed evidence schema, five exit codes

**Decision.** The verify stage polls the target field until its read-back value equals the value the write sent, runs a four-item confirmation battery against the step-1 snapshot, and persists a fixed-shape evidence record before every non-zero exit except one. It allocates exit codes 40–44 under PB-D29's rule. It performs no writes and re-runs no write preconditions.

**Inputs and their validation.** Verify reads the step-1 and step-2 evidence files for the invoked field, obtains `tempValue` from step-2, and rejects a missing file, a parse failure, a `contactId` or `fieldId` mismatch against the registry, or a step-2 evidence record that does not represent a successful write. This is input validation, not a live precondition: it establishes that verify has a coherent record to verify against, not that a write should be issued. Verify does not re-check whether the live record is still safe to write; per PB-D26 that check belongs to write and does not recur here.

**Poll.** Fifteen attempts, two seconds between, on the singular contact GET. The gate is `!!entry && deepEqual(entry.value, tempValue)` — presence and equality, per PB-D25. This is the assertion; nothing downstream restates it. The poll breaks on the first hit and records the attempt count reached.

**Confirmation battery, four items.** `othersUnchanged` over the union of step-1 and live custom-field ids excluding the target, `tagsUnchanged`, `offersAbsent` across the seven `offer_` ids, and `stageUnchanged` against the step-1 opportunity snapshot.

**Redundant target confirmations are intentionally omitted.** `targetEqualsTemp`, `targetPresent`, and `strictEqualsTemp` each restate information already established by the equality poll from the same live value. Once the poll succeeds, none can independently fail. They are therefore omitted from the confirmation battery, per PB-D23's rejection of structurally tautological assertions.

**`observedValue` and `observedType` are diagnostic, not assertions.** They record what the wire returned so a mismatch is legible rather than merely false. PB-D25 reserves record-without-assert as the bootstrap for a dataType whose read-back representation is unobserved; TEXT and MONETORY are both observed, so recording these is a diagnostic convenience and confers no assertion strength.

**Evidence schema.** The evidence record contains the following top-level keys. Every key is present on every persisted record regardless of outcome. Unavailable values are `null`; keys are never omitted.

`timestamp`, `contactId`, `fieldId`, `fieldKey`, `tempValue`, `pollAttempts`, `observedValue`, `observedType`, `liveCustomFields`, `liveTags`, `opportunity`, `confirmations`, `error`, `outcome`

`confirmations` is a partial object carrying whatever battery items completed, `{}` if none ran. `error` is `null` on every non-exception path. `outcome` is one of `passed`, `poll_exhausted`, `confirmation_failed`, `input_invalid`, `error`.

`fieldKey` is included because invocation is `<stage> <fieldKey>` per PB-D28 and the evidence path derives from stage and field per PB-D29 — it identifies which field a near-empty `input_invalid` record concerns. Its inclusion follows from verify's inputs and does not disturb PB-D30's seven-key write contract, which remains as written.

**Evidence path.** Derived, not stored, per PB-D29: the Temp directory constant plus the existing `-step3.json` filename for the invoked field. Verify is step 3.

**Exit codes.** 40 input invalid — missing, unparseable, or identity-mismatched step-1/step-2 evidence, or a step-2 record that does not represent a successful write; evidence persisted with `outcome: "input_invalid"` where a record can be constructed at all. 41 poll exhausted — fifteen attempts without an equality hit; evidence persisted with `outcome: "poll_exhausted"`, `confirmations: {}`, and `observedValue`/`observedType` from the final attempt. 42 confirmation failed — one or more battery items returned false; evidence persisted with `outcome: "confirmation_failed"` and the full battery. 43 evidence persistence failure. 44 outer catch — any thrown read, including the opportunity GET, and any unexpected runtime exception not classified above; evidence persisted with `outcome: "error"`, the thrown message in `error`, and whatever was observed before the throw.

**A thrown read is not a confirmation failure.** `confirmation_failed` means the instrument completed and produced a negative comparison. A thrown GET means the comparison could not be made. A throw during the opportunity read yields `opportunity: null`, the confirmations that completed before it, the error message, and `outcome: "error"` — exit 44.

**Evidence persistence failure is the single exemption from persist-before-exit.** PB-D26 requires every stage to persist what it observed prior to any non-zero exit. When the persistence itself fails there is no record to write; verify exits 43 and logs the intended path and the serialization or filesystem error to stderr. No fallback path and no second persistence mechanism is introduced: a second write path is an unproven mechanism added to handle the failure of the proven one, and verify risks no mutation, so an unrecorded failure here costs diagnostics rather than integrity. This differs from PB-D30's precedence rule by situation, not by principle — write's exit 33 outranks its response classification because an unrecorded mutation is the dangerous condition; verify performs no mutation, so no precedence question arises.

**PB-D21's retry-on-thrown-read remains unimplemented and UNVERIFIED.** Any retry on a thrown verification read would belong in the verify stage under PB-D26's stage boundaries. This decision does not add it; a thrown read exits 44 without retry. Adding retry is a separate decision taken when a retry condition has actually been observed.

**Unchanged.** PB-D24's restoration semantics and its requirement that a confirming read closes rollback — that read belongs to restore, and verify's equality assertion does not discharge it. PB-D25's assertion contract. PB-D26's stage ownership and boundaries. PB-D28's registry and invocation shape. PB-D29's exit-code and evidence-path derivation rules. PB-D30's write contract, including its seven-key evidence record.

**Amendment (2026-08-05): confirmation renamed to `offersUnchanged`.** The third battery item is `offersUnchanged`, a step-1-versus-live comparison across the seven `offer_` ids, replacing `offersAbsent` per PB-D39. The battery remains four items and the key remains inside `confirmations`. The assertion changed with the name: `offersAbsent` required the seven ids to be absent from the live read, while `offersUnchanged` requires each id and value to match the step-1 snapshot, so a fixture whose `offer_` fields are populated at step 1 no longer fails the battery. This amendment supersedes the `offersAbsent` name in this section's "Confirmation battery, four items" paragraph for records produced after commit `3fd305a`, while preserving archived records produced before that commit, each of which carries `confirmations.offersAbsent` as written and is not rewritten.

### PB-D32 — Restore stage contract: absent-origin only, bounded confirming poll, six exit codes

**Decision.** Restore issues the restoring PUT and performs the confirming read in one stage. Per PB-D24 a successful restoring PUT is necessary but not sufficient; rollback is not complete until a read confirms the restored wire state. That read belongs to restore and is not discharged by verify's equality assertion, per PB-D31.

**Scope is absent-origin only.** PB-D30's write contract holds populated-origin restoration behind a separately specified mechanism. This contract does not supply that mechanism and does not reach it. A capture record whose `fieldPresent !== false` is rejected at input validation rather than handled.

**Inputs and their validation.** Restore reads the step-1 and step-2 evidence files for the invoked field, obtains the origin state from step-1 and confirmation of an issued write from step-2, and rejects a missing file, a parse failure, a `contactId` or `fieldId` mismatch against the registry, a step-2 record that does not represent a successful write, or a step-1 record whose `fieldPresent !== false`. This is input validation, not a live precondition: it establishes that restore has a coherent record to restore from. Per PB-D26 the live safe-to-write check belongs to write and does not recur here.

**The restoring call.** One PUT, `field_value: ""`, per PB-D24's absent-origin mechanism for MONETORY. No new mechanism is designed; this is the same shape as the clearing call already in use. Per PB-D28 the absence mechanism is registry configuration; the restore target comes from capture and never from the registry. This first restore implementation is write-enabled only for the MONETORY `arv` configuration. `property_notes` remains unsupported until its restore mechanism and write-enablement are established.

**The confirming read is a bounded poll.** 15 attempts, 2 seconds apart, gate is that the field's key is absent from the live `customFields` array. The timing model is PB-D31's, reused rather than duplicated. A single successful immediate observation on the hand-written step-5 does not establish that absence is always immediately visible; polling prevents a successful clear from being classified as a failure on propagation delay.

**Confirmation battery.** The same four items as verify: `othersUnchanged`, `tagsUnchanged`, `offersAbsent`, `stageUnchanged`.

**Evidence persistence failure outranks response classification.** Restore mutates. PB-D31's exit-43 exemption from PB-D26's persist-before-exit rule was grounded explicitly in verify performing no mutation and therefore risking diagnostics rather than integrity; that reasoning does not transfer. Restore inherits write's PB-D30 precedence rule: if evidence persistence fails after the PUT was attempted or a response was received, restore exits 53 regardless of whether the response was 2xx or non-2xx, and logs whether the PUT was issued, whether a response arrived, and the response status. An unrecorded mutation is the dangerous condition. No fallback writer is introduced.

**Exit codes.** 50 `input_invalid` / 51 `poll_exhausted` / 52 `confirmation_failed` / 53 evidence-persistence / 54 outer catch. 0 on pass. The decade follows PB-D29.

**Sixteen-key evidence, all keys always present, null when unavailable.** `timestamp`, `contactId`, `fieldId`, `fieldKey`, `originState`, `restoreStrategy`, `requestBody`, `responseStatus`, `pollAttempts`, `observedAbsent`, `liveCustomFields`, `liveTags`, `opportunity`, `confirmations`, `error`, `outcome`. `outcome` is one of `passed`, `poll_exhausted`, `confirmation_failed`, `input_invalid`, `error`.

**`originState` is an object.** `{ fieldPresent, value }`, carrying `false` and `null` in this implementation. The object shape holds what capture already records rather than a flattened restatement of it; it is not a pre-authorization of populated-origin restoration, which remains held behind PB-D30's populated-origin restriction and will be specified on its own terms.

**Unchanged.** PB-D24's restoration semantics, including its requirement that a confirming read closes rollback. PB-D25's assertion contract. PB-D26's stage ownership and its persist-before-exit rule, which restore satisfies in full. PB-D28's registry and invocation shape. PB-D29's exit-code and evidence-path derivation rules. PB-D30's write contract and precedence rule. PB-D31's verify contract, including its fourteen-key evidence record and its exit-43 exemption, which is not extended here.

**Amendment — non-2xx restore PUT.** A restore PUT that returns non-2xx is a handled failure, not poll exhaustion and not an outer exception. Evidence is persisted with `requestBody`, `responseStatus`, `responseBody`, and `outcome: "put_failed"`, and restore exits 55. Exit 53 retains precedence if that evidence cannot be persisted. The evidence record therefore contains seventeen keys, adding `responseBody` alongside `responseStatus`; `outcome` is one of `passed`, `put_failed`, `poll_exhausted`, `confirmation_failed`, `input_invalid`, or `error`.

**Amendment (2026-08-05): confirmation renamed to `offersUnchanged`.** The third battery item is `offersUnchanged`, a step-1-versus-live comparison across the seven `offer_` ids, replacing `offersAbsent` per PB-D39. The battery remains four items. This amendment supersedes the `offersAbsent` name in this section's "Confirmation battery" paragraph for records produced after commit `3fd305a`, while preserving archived records produced before that commit, each of which carries `confirmations.offersAbsent` as written and is not rewritten.

### PB-D33 -- B4 field designation and designated test value

**Decision.** `estimated_repairs` (`contact.estimated_repairs`, `OQnud97MfdxMcTgMVTgf`, MONETORY) is designated as B4 from the remaining MONETORY candidates: `asking_price`, `estimated_repairs`, and `loan_amount`.

**Selection boundary.** The rationale is inference from field purpose: Estimated Repairs is more operationally relevant than Loan Amount and appears less likely than Asking Price to participate directly in seller-facing automation. This is not a safety finding. Per section 4.6, workflow triggers are not API-derivable, and `estimated_repairs` must prove its own field-specific write safety through the complete inert-proof cycle.

**Designated test value.** `8642.75` is approved before the write under the PB-D30 amendment dated 2026-08-03. It is deliberately selected, not observed production data: non-integer to remain on the proven MONETORY decimal path, distinct from ARV `187500.25` and Carrying Cost `4321.25`, recognizable in evidence, and required to be restored immediately after the proof cycle.

**Registry entry is not proof.** Adding the B4 registry entry makes the field eligible to enter the proof sequence; it does not establish safety or authorize the field for application use. Safety is established only if capture, write, verify, and restore complete successfully and the fixture returns to baseline.

**Amendment (2026-08-06):** The conditions this decision stated as pending have been discharged. `docs/FIELD_REGISTER.md` records the Estimated Repairs row as Write, Verify, and Restore Proven, Safety `Proven on bradt75 only`, with a full four-stage cycle exercised 2026-08-04 under PB-D33. The restoration required by `Designated test value.` and the completion conditions stated in `Registry entry is not proof.` are therefore satisfied as of that cycle. Both paragraphs remain as written, and the `Decision.` and `Selection boundary.` paragraphs are unaffected.

### PB-D34 -- B5 field designation and designated test value

**Decision.** `loan_amount` (`contact.loan_amount`, `3ZlSKldh0jR2MWhjOmHe`, MONETORY) is designated as B5 from the remaining MONETORY candidates: `asking_price` and `loan_amount`.

**Selection boundary.** The rationale is inference from field purpose: Loan Amount is less central to seller communication than Asking Price, which sits closer to offer logic and the existing `offer_` HARD-NO pathway. This is not a safety finding. Per section 4.6, workflow triggers are not API-derivable, and `loan_amount` must prove its own field-specific write safety through the complete inert-proof cycle.

**Designated test value.** `24680.25` is approved before the write under the PB-D30 amendment dated 2026-08-03. It is deliberately selected, not observed production data: non-integer to remain on the proven MONETORY decimal path, distinct from ARV `187500.25`, Carrying Cost `4321.25`, and Estimated Repairs `8642.75`, recognizable in evidence, and required to be restored immediately after the proof cycle.

**Registry entry is not proof.** Adding the B5 registry entry makes the field eligible to enter the proof sequence; it does not establish safety or authorize the field for application use. Safety is established only if capture, write, verify, and restore complete successfully and an independent re-capture confirms the fixture returned to baseline. The independent re-capture overwrites the runner's step-1 evidence file in place. Because the runner does not auto-archive, the pre-write step-1 capture must be archived before re-capture or that artifact is lost. Observed at designation: `deal-submit.ts` includes `LOAN_AMOUNT` in the production opportunity intake payload. No inference is drawn that the corresponding contact custom field is written by production code.

**Amendment (2026-08-06):** The conditions this decision stated as pending have been discharged. `docs/FIELD_REGISTER.md` records the Loan Amount row as Write, Verify, and Restore Proven, Safety `Proven on bradt75 only`, with a full four-stage cycle exercised 2026-08-04 under PB-D34. The restoration required by `Designated test value.` and the completion conditions stated in `Registry entry is not proof.`, including the independent re-capture confirming return to baseline, are therefore satisfied as of that cycle. The archive-before-re-capture instruction in that paragraph remains standing guidance for any future capture. Both paragraphs remain as written, and the `Decision.` and `Selection boundary.` paragraphs are unaffected, including the `deal-submit.ts` observation.

### PB-D35 -- B6 field designation and designated test value

**Decision.** `asking_price` (`contact.asking_price`, `60UCjsYT1Ak3Kyy5ZCL8`, MONETORY) is designated as B6. It is the last remaining MONETORY candidate; no selection among alternatives was made.

**Selection boundary.** B6 is designated by exhaustion rather than by rationale. PB-D33 and PB-D34 each recorded, as inference from field purpose, that Asking Price sits closer to seller-facing offer logic and the existing `offer_` HARD-NO pathway than the field then selected. That prior inference is not a safety finding and neither supports nor weighs against `asking_price`. Per section 4.6, workflow triggers are not API-derivable, and `asking_price` must prove its own field-specific write safety through the complete inert-proof cycle.

**Designated test value.** `135790.25` is approved before the write under the PB-D30 amendment dated 2026-08-03. It is deliberately selected, not observed production data: non-integer to remain on the proven MONETORY decimal path, distinct from ARV `187500.25`, Carrying Cost `4321.25`, Estimated Repairs `8642.75`, and Loan Amount `24680.25`, recognizable in evidence, and required to be restored immediately after the proof cycle.

**Registry entry is not proof.** Adding the B6 registry entry makes the field eligible to enter the proof sequence; it does not establish safety or authorize the field for application use. Safety is established only if capture, write, verify, and restore complete successfully and an independent re-capture confirms the fixture returned to baseline. The independent re-capture overwrites the runner step-1 evidence file in place. Because the runner does not auto-archive, the pre-write step-1 capture must be archived before the re-capture or that artifact is lost, per PB-D34. Observed at designation: `asking_price` is absent from bradt75 `customFields` on a live proxy read, so B6 is an absent-origin proof and PB-D30 write contract applies as written.

**Amendment (2026-08-06):** The conditions this decision stated as pending have been discharged. `docs/FIELD_REGISTER.md` records the Asking Price row as Write, Verify, and Restore Proven, Safety `Proven on bradt75 only`, with a full four-stage cycle exercised 2026-08-04 under PB-D35. The restoration required by `Designated test value.` and the completion conditions stated in `Registry entry is not proof.`, including the independent re-capture confirming return to baseline, are therefore satisfied as of that cycle. The archive-before-re-capture instruction in that paragraph, stated there per PB-D34, remains standing guidance for any future capture. Both paragraphs remain as written, and the `Decision.` and `Selection boundary.` paragraphs are unaffected, including the absent-origin observation.

### PB-D36 -- MULTIPLE_OPTIONS clear-semantics probe, occupancy_status

**Decision.** `occupancy_status` (`contact.occupancy_status`, `op57wOVFSMRBFbHmD6ej`, MULTIPLE_OPTIONS) is designated as the field for a clear-semantics discovery probe. Designated write value is `["Vacant"]`, confirmed against the location schema picklistOptions `["Owner Occupied","Tenant Occupied","Vacant"]` read 2026-08-04.

**Scope.** This decision authorizes a probe only. It does not designate B7, does not write-enable the field, and does not add a FIELDS registry entry. The runner is untouched. A separate decision records the observed clear mechanism before `occupancy_status` receives a `clearValue` and enters the four-stage cycle.

**Absent origin.** OBSERVED 2026-08-05: the field is absent from the probe contact. Prior OBSERVED 2026-08-04: absent from all three known fixtures.

**Clear semantics UNKNOWN.** PB-D24 records `field_value: ""` as the absent-origin mechanism for MONETORY per PB-D16 wire contract. The proven TEXT clear path also uses `""`. DATE requires `null` and ignores empty string. Per the note at spec:512 the value achieving KEY_ABSENT is dataType-dependent, so no MONETORY, TEXT, or DATE precedent extends to MULTIPLE_OPTIONS. Candidate representations are `[]`, `""`, and `null`, tried in that order, stopping at the first observed KEY_ABSENT.

**Fixture.** Dedicated disposable contact `HGZAby6snRZfpl0go2Yb` (IAOS Test Probe), created via CRM UI 2026-08-05 for this purpose. No production contact is required and bradt75 is not used. Baseline OBSERVED: customFieldCount 1, tags `["phone-validated-unknown"]`, type lead, occupancy_status ABSENT.

**Acceptance criteria.** On the write, the custom-field ID set must go from `{1cTefPDpZRypKYHtgZrq}` to `{1cTefPDpZRypKYHtgZrq, op57wOVFSMRBFbHmD6ej}`. On a successful clear it must return to `{1cTefPDpZRypKYHtgZrq}`. The symmetric difference on either transition must be exactly `{op57wOVFSMRBFbHmD6ej}`. Phone Type `1cTefPDpZRypKYHtgZrq` must remain present and unchanged throughout. Any other custom-field drift halts the probe.

**Tag mutations are logged, not halting.** `phone-validated-unknown` appeared on the probe contact without any API call from this project, so tags are not stable on an independent timeline and are outside the probe validation set.

**Endpoint limitation.** Proxy contact reads do not return a `dnd` key when it is absent, so `dnd undefined` is a payload-shape observation and not a state finding. DND is outside the scope of this probe.

**Evidence.** The probe writes `probe-multiple-options-clear-occupancy-status-attemptN.json`, deliberately outside the `inert-proof-<field>-stepN.json` namespace so the archive convention stays collision-free when the four-stage cycle later runs on this field.

**Failure outcome.** If all three representations fail to produce KEY_ABSENT, the probe contact retains `["Vacant"]`, that outcome is recorded as the finding, and the four-stage cycle does not proceed.

**Amendment (2026-08-06):** PB-D38 subsequently observed the clear mechanism reserved by this decision. PB-D40 completed the designation and registry entry that this decision explicitly withheld, and PB-D41 records the completed cycle. This amendment supersedes the `Scope.` and `Clear semantics UNKNOWN.` paragraphs only. Of the three candidate representations named there, `""` was observed to produce `KEY_ABSENT` and the sequence terminated at that point; `null` against `MULTIPLE_OPTIONS` was never executed and remains UNKNOWN. The `Decision.`, `Absent origin.`, `Fixture.`, `Acceptance criteria.`, `Tag mutations are logged, not halting.`, `Endpoint limitation.`, `Evidence.`, and `Failure outcome.` paragraphs remain as written.

### PB-D37 -- MULTIPLE_OPTIONS array round-trip observed on occupancy_status

**Decision.** This decision records the write and read-back observation produced by the PB-D36 probe attempt1 and fixes the attempt numbering convention for the remaining clear attempts. It does not designate occupancy_status for B7, does not enable write, and does not create a FIELDS registry entry.

**Observation.** A PUT carrying `field_value: ["Vacant"]` against contact HGZAby6snRZfpl0go2Yb field op57wOVFSMRBFbHmD6ej returned status 200. The subsequent single-record GET returned the value as a JSON array containing one string element, "Vacant". Write shape equals read shape for this observation. Evidence: probe-multiple-options-clear-occupancy-status-attempt1.json, outcome WRITE_CONFIRMED_ARRAY, error null.

**Scope of the finding.** The observation covers one field, one selected option, and the single-record contact GET path. Multi-element arrays are untested. The other three MULTIPLE_OPTIONS register members are untested. No claim is made that array shape generalizes beyond occupancy_status.

**Fixture integrity.** The custom-field ID set moved from {1cTefPDpZRypKYHtgZrq} to {1cTefPDpZRypKYHtgZrq, op57wOVFSMRBFbHmD6ej}, symmetric difference exactly {op57wOVFSMRBFbHmD6ej}. Phone Type remained "Unknown". Tags remained ["phone-validated-unknown"], unchanged. No unrelated drift was observed.

**Proxy capability.** The deployed ghl-proxy accepts PUT. This was previously unverified and is now OBSERVED via the 200 response above.

**Convergence.** The read converged on poll 1 of 60. This is a single observation on the single-record GET path and is NOT a read-your-writes guarantee. The prior convergence outlier of approximately 105 seconds was observed on a different endpoint. POLL_MAX remains 60 for all remaining attempts.

**Attempt numbering.** The PB-D36 attemptN evidence namespace resolves to five slots: attempt0 pre-write baseline; attempt1 write ["Vacant"] and read back; attempt2 clear with []; attempt3 clear with ""; attempt4 clear with null. PB-D36 did not enumerate these; this decision fixes them.

**Fixture state.** occupancy_status on the probe fixture is now populated with ["Vacant"] and remains populated until a clear representation produces KEY_ABSENT, or until all three representations have failed. If all three fail, the field is left set and documented as stranded but schema-valid per PB-D36.

**Precondition for attempt2.** The attempt1 script refused on field-already-present. The clear scripts require the inverse precondition: occupancy_status MUST be present and equal to the array ["Vacant"] before a clear representation is sent. Refuse otherwise.

**Amendment (2026-08-06):** The clear sequence this decision anticipated was executed. PB-D38 records a clear representation producing KEY_ABSENT, satisfying the condition stated in `Fixture state.`, and the attempt2 step governed by `Precondition for attempt2.` has been performed and cannot recur. This amendment supersedes the `Fixture state.` and `Precondition for attempt2.` paragraphs only. The `Decision.`, `Observation.`, `Scope of the finding.`, `Fixture integrity.`, `Proxy capability.`, `Convergence.`, and `Attempt numbering.` paragraphs remain as written.

### PB-D38 -- MULTIPLE_OPTIONS clear semantics observed for occupancy_status

**Decision.** This decision records the clear-semantics mechanism discovered by the PB-D36 probe and amends the probe termination rule. It does not designate occupancy_status for any B slot, does not enable write, and does not create a FIELDS registry entry. Those remain closed pending separate decisions.

**Clear mechanism.** A PUT carrying `field_value: ""` against field op57wOVFSMRBFbHmD6ej removed the key entirely. The subsequent read returned occupancy_status ABSENT with the custom-field ID set reduced to {1cTefPDpZRypKYHtgZrq}, symmetric difference exactly {op57wOVFSMRBFbHmD6ej}. Evidence: probe-multiple-options-clear-occupancy-status-attempt3.json, outcome CLEARED_KEY_ABSENT, converged poll 1 of 60.

**Empty array is not a clear.** A PUT carrying `field_value: []` returned status 200 and emptied the selection, but the key remained present holding an empty array. Read-back shape ARRAY_EMPTY, keyAbsent false, symmetric difference empty. Evidence: probe-multiple-options-clear-occupancy-status-attempt2.json, outcome NOT_CLEARED_EMPTY_ARRAY. MULTIPLE_OPTIONS therefore distinguishes an empty-selection state from key absence. No other proven dataType exhibits this: TEXT and MONETORY collapse the empty string directly to KEY_ABSENT.

**Convergence with prior dataTypes.** The clear value for MULTIPLE_OPTIONS is the empty string, matching the proven TEXT path and the PB-D24 MONETORY mechanism. PB-D36 declined to assume that precedent would carry across dataTypes; it is now OBSERVED rather than inferred. DATE remains the exception, requiring null.

**attempt4 not run.** PB-D36 stops the sequence at the first representation producing KEY_ABSENT. attempt3 produced it, so attempt4 (null) was not executed and no evidence record exists for that slot. The behavior of null against MULTIPLE_OPTIONS is UNKNOWN and would require a separate decision to characterize.

**Termination rule amended.** The probe terminates on the first observed KEY_ABSENT or on exhaustion of all designated representations, whichever comes first. PB-D36 stated only the former. An exhausted sequence does not imply the representations had no effect: attempt2 demonstrates that a non-clearing representation may produce a novel non-absent state, and a type-mismatched representation may be rejected outright. Failure to clear and failure to act are distinct outcomes and are recorded distinctly.

**Restore artifacts.** PB-D37 enumerated five attempt slots. A non-clearing attempt that leaves the field in a state other than the documented precondition requires a restore before the next attempt may run. Restores are recorded outside the attemptN namespace, named probe-multiple-options-clear-occupancy-status-restore-after-attemptN.json, and are state management rather than discovery. One such artifact exists, restore-after-attempt2, which returned the field from [] to ["Vacant"] and independently confirmed that writing over an empty array behaves identically to writing over an absent field.

**Fixture state.** The probe fixture self-restored to its attempt0 baseline. occupancy_status is ABSENT, the custom-field ID set is {1cTefPDpZRypKYHtgZrq}, Phone Type is "Unknown", and tags are ["phone-validated-unknown"]. Confirmed by an independent read after the sequence terminated. No restore is owed.

**Scope of the finding.** These observations cover one field, a single-option value, and the single-record contact GET path. Multi-element array clearing is untested. The other three MULTIPLE_OPTIONS register members are untested. No claim is made that these semantics generalize beyond occupancy_status.

### PB-D39 -- offersAbsent becomes offersUnchanged in the confirmation battery

**Decision.** The runner confirmation `offersAbsent` is replaced by `offersUnchanged`, a before-and-after comparison of the same shape as its two neighbours `othersUnchanged` and `tagsUnchanged`. PB-D31 four-item battery is preserved; a named explicit offer_ confirmation remains. Scope is the two call sites at inert-proof-runner.cjs 359 and 528 and the stale comment at line 57. No other guard is touched.

**Observed defect.** MaoCalculator.tsx 940 loads every contact in the location through ghl.contacts.listAll with no exclusion list. bradt75 (9fbH2VCcZvzVNhsR9zjc) is both the inert-proof write fixture and a live Lead Queue contact, recorded at CONTACT_WORKSPACE_SPEC_v2 484. Selecting it links it at MaoCalculator.tsx 1019, and handleSave at 1176 calls ghl.contacts.saveOfferFields(linkedContact.id, contactFields), writing all seven offer_ fields. A single Save Offer against that contact is a legitimate, sanctioned action per the FIELD_REGISTER offer_ scoping landed in commit deab683, and it causes subsequent inert-proof runs against that fixture to fail verify (42) and restore (52) until the offer_ fields are cleared. The failure surfaces as confirmation_failed with no indication that the cause was an unrelated app action.

**Redundancy.** `othersUnchanged` at inert-proof-runner.cjs 350 to 356 iterates `new Set([...capById.keys(), ...liveById.keys()])` and skips only the target fieldId. It fails on presence mismatch or deepEqual inequality. OBSERVED: OFFER_IDS occurs at lines 58, 150, 359, and 528 only, and none of those is an exclusion from the union. Drift on an offer_ field during an inert proof is therefore already caught by `othersUnchanged` independently of `offersAbsent`.

**What is deliberately given up.** `offersAbsent` asserts an absolute starting state, not stability. Under `offersUnchanged` a fixture whose offer_ fields are already populated at capture no longer halts the run; the runner proceeds and proves the target field against a populated-origin offer_ state. This is a deliberate reduction in what the battery enforces, not an equivalent rewrite. It is accepted because the state being rejected is one a sanctioned writer legitimately produces, and because drift detection is unaffected.

**Not decided here.** Whether bradt75 remains the write fixture is a separate question. A proof fixture reachable by a normal application action is a fixture-selection concern, and this decision addresses only the guard brittleness.

### PB-D40 -- B7 field designation, occupancy_status

**Decision.** `occupancy_status` (`contact.occupancy_status`, `op57wOVFSMRBFbHmD6ej`, MULTIPLE_OPTIONS) is designated as B7 and receives a `FIELDS` registry entry: `fieldId` `op57wOVFSMRBFbHmD6ej`, `dataType` MULTIPLE_OPTIONS, `contactId` `9fbH2VCcZvzVNhsR9zjc`, `tempValue` `["Vacant"]`, `clearValue` `""`. This supplies the `clearValue` and FIELDS registry entry that PB-D36 explicitly reserved for a separate decision and authorizes entry into the existing four-stage cycle. It does not authorize a run; execution is an operational step taken after the registry change lands.

**Origin state.** OBSERVED 2026-08-05 on a single-record GET of `9fbH2VCcZvzVNhsR9zjc`: `customFields` carries five entries -- `1cTefPDpZRypKYHtgZrq`, `LM4bs21UP3i6OJpUirQQ`, `tG4gGFI8JB2VjWeuqYMx`, `2vz1igGMxF3wv7HaWm97`, `lGoNXM9Wrte4m7ShwQPT`. `op57wOVFSMRBFbHmD6ej` is not among them. On this endpoint, populated custom fields appear in `customFields`, so this decision records the field as absent-origin and therefore eligible under PB-D30's absent-origin write contract.

**tempValue provenance.** `["Vacant"]` is adopted from PB-D37, which observed the array round-trip on this field against contact `HGZAby6snRZfpl0go2Yb`. Same field and same location picklist; the value is not re-derived on this fixture.

**clearValue provenance.** `""` is adopted from PB-D38, which observed `field_value: ""` producing KEY_ABSENT on this field. `field_value: []` returns 200 while leaving the key present holding an empty array and is not the clear mechanism. `null` was never sent and its behavior remains UNKNOWN.

**What this proof does not establish.** None of the populated custom fields returned by the observed single-record GET is an `offer_` id. Accordingly, this proof does not exercise `offersUnchanged` against a populated `offer_` state. `offersUnchanged` will execute during the cycle, but this proof does not distinguish its behavior from the superseded `offersAbsent` guard. The populated-origin `offer_` case addressed by PB-D39 remains unexercised.

**Unchanged.** PB-D36's Scope, Fixture, Acceptance criteria, Tag mutations, Endpoint limitation, and Evidence paragraphs. PB-D30's absent-origin restriction and write contract. PB-D31's verify contract as amended. PB-D32's restore contract as amended. PB-D28's registry shape and invocation form. PB-D29's exit-code and evidence-path derivation.

### PB-D41 -- B7 inert-proof result, occupancy_status

**Decision.** The four-stage inert-proof cycle authorized by PB-D40 was executed against `occupancy_status` on `9fbH2VCcZvzVNhsR9zjc` on 2026-08-05. All four stages passed. The register row is updated accordingly at `e682860`. This decision records the outcome; it authorizes nothing further.

**Stage results.** capture: field ABSENT, five custom fields, `fieldPresent` false. write: one PUT, status 200, `requestBody` `customFields` id `op57wOVFSMRBFbHmD6ej` `field_value` `["Vacant"]`, response echoed `value` `["Vacant"]`, custom-field count 5 to 6. verify: poll attempt 1 equality, four-item battery 4/4, `outcome` passed. restore: one PUT `field_value` `""`, poll attempt 1 KEY_ABSENT, four-item battery 4/4, `outcome` passed. An independent single-record GET after restore returned five custom fields with the same five ids recorded in PB-D40's Origin state and tags unchanged.

**Established beyond the field.** An array `tempValue` passes through the runner intact: write shape equals read shape for `["Vacant"]` on a second contact, extending PB-D37's probe-contact-only finding to `9fbH2VCcZvzVNhsR9zjc`. `""` clears MULTIPLE_OPTIONS on a second contact, extending PB-D38 the same way. `offersUnchanged` executed live for the first time, in verify and in restore, both PASS.

**Not established.** All seven `offer_` ids were absent throughout, so `offersUnchanged` passed for the reason `offersAbsent` would have. PB-D39's behavioral change remains unexercised, as PB-D40 stated it would. No currently configured proof field uses a fixture with populated `offer_` state, so the distinctive PB-D39 case cannot currently be exercised through the runner.

**Diagnostic limitations observed.** The write stage's console line interpolates `tempValue` directly, so `["Vacant"]` and `"Vacant"` print identically; the evidence record carries the true shape and is the record of truth. `observedType` returns `"object"` for an array, so it cannot distinguish an array from a plain object; per PB-D31 `observedValue` and `observedType` are diagnostic rather than assertions and `deepEqual` is the gate. Neither affects correctness.

**Evidence.** Steps 1 through 4 archived to Documents/IAOS Evidence/PB-D15 originals/ as `inert-proof-occupancy-status-step1` through `step4`, `original-2026-08-05`, each SHA-256 verified against its Temp source. Steps 3 and 4 are the first archived records carrying `confirmations.offersUnchanged`; the twelve prior verify and restore records carry `confirmations.offersAbsent`.

**Unchanged.** PB-D40's designation and registry entry. PB-D30's absent-origin restriction and write contract. PB-D31's verify contract as amended. PB-D32's restore contract as amended. PB-D37 and PB-D38, which this cycle corroborates on a second fixture without superseding.

### PB-D42 -- PB-D18's locational clause is superseded by the B2 unlock

**Decision.** PB-D18's clause that `contact.arv` "appears nowhere in app/src except ADDITIONAL_INFO_SUBGROUPS" is no longer true and is superseded. PB-D18 remains in place as written; this decision records what has changed since its observation date and does not amend the flat block.

**What is observed.** OBSERVED 2026-08-06: the literal `wMBTGWMs97yysQFx7Vad` occurs exactly once under `app/src`, at `app/src/lib/ghl.ts:45` -- `export const ARV_ID = "wMBTGWMs97yysQFx7Vad"; // MONETORY, PB-D16/PB-D17 -- B2 unlock`. The literal does not occur in `ADDITIONAL_INFO_SUBGROUPS`. The mechanism by which ARV reaches that grouping was not examined in this read. This search covered `app/src` only.

**Why the clause went stale.** PB-D18 was OBSERVED 2026-07-28, before the B2 unlock. The unlock introduced `ARV_ID` as a write-path constant. The clause was accurate at its observation date and is a point-in-time locational finding, not a standing requirement.

**What PB-D18 still establishes.** Its load-bearing finding is unaffected: `contact.arv` has no app-side consumer. `MaoCalculator` reads opportunity-side fields exclusively, `SOURCE_FIELD_IDS.arv` is `cBkygqcHRseZUGCYYeba`, and the contact/opportunity ARV distinction stands. `ghl.ts:45` is a write-path constant consumed at `ghl.ts:493` by `ghl.contacts._putMonetaryField(contactId, ARV_ID, value)`, not a calculator read. PB-D18's conclusion that unlocking `contact.arv` cannot trigger a calculator recompute therefore remains unchanged. PB-D18's display-side observation and its prepopulate note are likewise untouched.

**Unchanged.** PB-D18 apart from the locational clause. PB-D16's private-helper shape and public surface. PB-D17's template. Every field's unlock status.

### PB-D43 -- Flat-block supersession convention, and PB-D8's implementation divergence

**Decision.** Two things. First, it fixes how a flat-form decision is superseded. Second, it records that PB-D8 describes a configuration model the code does not implement, without choosing between implementing that model and replacing it.

**Flat-block supersession convention.** PB-D2 through PB-D22 are single-line entries in a list under §10.7 and §10.8, with no heading delimiting each decision. An `**Amendment (date):**` paragraph inserted between two such entries has nothing binding it to the decision above it, unlike the `###`-delimited decisions where ownership is structural. Flat-form entries therefore receive no in-place amendments. Supersession is recorded in a new top-level decision naming the earlier decision and the specific clause. PB-D42 is the first instance; this decision is the second.

**What PB-D8 asserts.** PB-D8 describes a model in which every field declares an editor, including locked fields, and the editor configuration is complete across all custom fields. Within that model, the unlock allowlist is derived from the editor configuration rather than maintained separately.

**What is observed.** OBSERVED 2026-08-06, searched under `app/` only: no occurrence of `editor:`, `editorType`, or `commitBehavior`. No per-field editor configuration was found under `app/`. The unlock allowlist exists instead as hardcoded constants in two files -- `app/src/lib/ghl.ts:44` and `:45` declaring `PROPERTY_NOTES_ID` and `ARV_ID`, and `app/scripts/verify-contacts.cjs:19` and `:20` declaring the same two ids independently, with a third copy at `:206` and `:207` inside `page.evaluate` because the browser scope cannot see Node constants.

**The duplication is deliberate.** `verify-contacts.cjs:19` carries the comment that the ids are hardcoded per the verification-only rule and never imported from app code. Drift between the copies is guarded: `:313` exits 5 on `PROPERTY_NOTES_ID` mismatch between Node and browser scope, `:334` does the same for `ARV_ID`. A verifier that imports from the code it verifies cannot detect drift in that code, so the harness maintaining its own literals is a correctness requirement, not an oversight.

**What this divergence is not.** Not a discharged condition and not a stale observation. PB-D8 describes a design that was never built. An amendment can record that; it cannot reconcile it.

**Resolution deliberately left open.** Two paths exist and this decision selects neither. Either the declared-editor config is built and the app-side allowlist derived from it, or PB-D8's model is explicitly replaced by a different one. The second path would also put PB-D9's "editor is a declared property of the field" in question. Choosing between them is a design decision taken on its own terms, not a side effect of recording the divergence. The harness's independent literals survive either path.

**Scope of the search.** `app/` only. Any such configuration under other repository roots was not examined.

**Unchanged.** PB-D8 as written. PB-D9's editor taxonomy. PB-D13's template scoping. Every field's unlock status. The harness's verification-only rule and its drift guards.

### PB-D44 -- PB-D16 promotion review, privacy model, and specification drift

**Decision.** Observational only. This decision records what has been established since PB-D16, promotes nothing, and leaves the write architecture unchanged. `_putMonetaryField` remains as implemented and `setARV` remains the only named public monetary write.

**Promotion review.** PB-D16 gates revisiting a public class-scoped setter on a SECOND MONETORY field passing its own inert-proof, stating the rationale as two observed consumers rather than one anticipated. The gating condition has been reached: four MONETORY fields beyond ARV are recorded Proven in `docs/FIELD_REGISTER.md`, the earliest on 2026-08-03. The evidentiary condition has not. OBSERVED 2026-08-06 across `app/`: one helper definition at `app/src/lib/ghl.ts:486`, one named wrapper at `:492`, one call to the helper at `:493`, and one call site at `app/src/pages/ContactWorkspace.tsx:290`. One consumer, not two. PB-D16's own preceding sentence accounts for the gap -- a named public method is earned by a field's own decision, and passing an inert-proof does not itself create one. The review has therefore occurred and promotion is deferred. Promoting on the present evidence would generalize from a single consumer, which is the shape PB-D16 refuses.

**Privacy model.** The implementation documents the mechanism PB-D16's "PRIVATE" describes. OBSERVED at `app/src/lib/ghl.ts:476-479`: the transport is private by convention, not by enforcement; it is exported and reachable as `ghl.contacts._putMonetaryField`; the underscore is the signal, not a barrier; the real guard is that no caller may use it except a named per-field setter admitted by its own decision. `_putMonetaryField` and `setARV` are properties of the same object literal and have identical reachability. PB-D16's structural claim that unproven fields are unwritable by construction is therefore a statement about caller discipline rather than about language-level access. That discipline is currently honored, with exactly one caller and that caller a named per-field setter.

**Specification drift.** Two particulars in which PB-D16's prose no longer exactly describes the implementation. First, PB-D16 names the helper `putMonetaryField`; the implementation is `_putMonetaryField`, and per the comment at `:477` the underscore is load-bearing. Second, PB-D16 renders the signature as `(fieldId, value)`; the implementation at `:486` is `(contactId: string, fieldId: string, value: number | "")`. PB-D16 draws its contrast between a private helper and a forbidden class-scoped setter using the same two-argument form for both. Neither particular changes the decision's meaning or its governing rule.

**Scope of the search.** `app/` only. Consumers or definitions under other repository roots were not examined.

**Unchanged.** PB-D16's named-wrapper-per-field policy. Its rule that each newly unlocked MONETORY field earns its own named public method by its own decision. Its refusal of a public class-scoped setter, which this decision does not lift. The MONETORY write contract recorded at `:484-485` and at PB-D14. PB-D24's promotion gate as eligibility rather than authorization. Every field's unlock status.

### PB-D45 -- PB-D6 and PB-D15 checked against the implementation

**Decision.** Observational only. This decision records three findings comparing PB-D6 and PB-D15, both flat-form entries, against what was subsequently built and recorded. It changes no rule, designates no field, and alters no configuration. Per PB-D43 these are recorded here rather than amended in place.

**PB-D6 timing language is discharged.** PB-D6 states that the specific MONETORY proof field is selected from the Investor subgroup immediately before the inert-proof, not at the time of writing. `arv` was selected as B2 and completed its proof, and four further MONETORY fields have since been designated and proven. The clause described a future state that has now occurred. It no longer carries any pending condition.

**PB-D6's candidate enumeration no longer matches the designation history.** PB-D6 lists the MONETORY candidate pool as ARV, Asking Price, Estimated Repairs, and Carrying Cost. PB-D33 designates B4 "from the remaining MONETORY candidates: `asking_price`, `estimated_repairs`, and `loan_amount`", and `loan_amount` went on to become B5 at PB-D34. `loan_amount` is absent from PB-D6's enumeration but present in the pool actually used. Whether the candidate pool changed after PB-D6 was written, or whether PB-D6's enumeration was incomplete when written, is UNKNOWN and is not determined here; the subgroup membership behind it was not examined. This is a historical inconsistency between two decisions, not a discharged condition.

**PB-D15's parameterization forecast, checked against the built registry.** PB-D15 anticipates the runner parameterizing seven axes: field ID, dataType, temporary value, clear value, restore value, comparison strategy, and fixture expectations. OBSERVED 2026-08-06 at `app/scripts/inert-proof-runner.cjs:19-61`: the `FIELDS` registry holds seven entries -- `arv`, `carrying_cost`, `property_notes`, `estimated_repairs`, `loan_amount`, `asking_price`, `occupancy_status` -- carrying five keys, `fieldId`, `dataType`, `contactId`, `tempValue`, and `clearValue`. `property_notes` carries four, omitting `clearValue`, with `tempValue: null`; the header comment at `:15-18` states that `null` means no temporary value is authorized and that fields without a `clearValue` are not restore-enabled. Four of the anticipated axes were built. Of the remaining three: restore value is carried as a strategy rather than a stored key, per PB-D28, which states the refinement does not remove the parameter, and PB-D30 restricted the runner to absent-origin fields where restore is clear; comparison strategy was fixed by PB-D31's `deepEqual` gate; fixture expectations became the fixed four-item confirmation battery rather than a per-field value. The forecast is recorded as accurate in four particulars. Two anticipated axes were not built, one is carried as a strategy rather than a registry key, and one additional axis (`contactId`) was introduced.

**Scope of the reads.** `app/scripts/inert-proof-runner.cjs` lines 15 through 61, covering the complete `FIELDS` registry through its closing brace. Subgroup membership behind PB-D6's enumeration was not examined.

**Unchanged.** PB-D6's designation of B2 as the MONETORY editor class. PB-D15's requirement that the runner parameterize only what genuinely varies. PB-D28's registry shape and its restore-is-a-strategy rule. PB-D30's absent-origin restriction. PB-D31's equality gate. Every field's unlock status and every existing proof record.

### PB-D46 -- PB-D6's enumeration checked against repository history

**Decision.** Observational only. This decision records repository evidence that resolves part of the UNKNOWN stated at PB-D45's `PB-D6's candidate enumeration no longer matches the designation history.` paragraph. It changes no rule, designates no field, and alters no configuration. PB-D45's text is unaltered; per PB-D43 this is recorded as a new top-level decision rather than an in-place amendment, because it adds evidence rather than correcting wording.

**PB-D6's enumeration was accurate when authored.** `ADDITIONAL_INFO_SUBGROUPS` was created at `b4fb214` dated 2026-07-24, assigning `contact.loan_amount` to the Property subgroup. A pickaxe on the full assignment string returns that single commit, so the assignment has never been reassigned. The config's Investor subgroup at `app/src/config/additionalInfoSubgroups.ts` lines 67 through 80 contains exactly PB-D6's four named MONETORY candidates: `contact.asking_price`, `contact.arv`, `contact.estimated_repairs`, `contact.carrying_cost`. PB-D6 was authored at `0bbbb31` dated 2026-07-28, four days after that config, and a single pickaxe hit on its opening sentence means its text has not been edited since. Both alternative explanations left open by PB-D45 are therefore eliminated: the candidate pool did not change after PB-D6 was written, and PB-D6's enumeration was not incomplete when written.

**The divergence originates at PB-D33.** PB-D33 at line 616 designates `estimated_repairs` as B4 from the remaining MONETORY candidates: `asking_price`, `estimated_repairs`, and `loan_amount`. It names no subgroup and cites no prior decision. PB-D33 restates the candidate pool without reference to PB-D6's Investor scoping and includes `loan_amount`, which repository history shows belonged to the Property subgroup. Whether this reflects a deliberate widening of scope is not determinable from the available artifacts. PB-D33's own selection boundary at line 618 weighs Estimated Repairs against Loan Amount and Asking Price on operational relevance, so `loan_amount` was within its field of view and set aside on that basis rather than overlooked.

**Unchanged.** PB-D45's UNKNOWN is superseded as to origin only. PB-D35's selection boundary at line 642 audited PB-D33 and PB-D34's rationale for ordering, not the composition of the pool those fields were drawn from, and remains as written. PB-D6's designation of B2 as the MONETORY editor class and PB-D34's designation of `loan_amount` as B5 are unchanged. This decision resolves the provenance of the enumeration divergence only.

### PB-D47 -- Five contact-model field IDs are sent in the opportunity payload -- CLOSED BY DELETION 2026-08-13

**Closed by deletion.** `netlify/functions/deal-submit.ts`, the sole subject of this decision, was retired on 2026-08-13 and deleted from the repository. The mismatch this decision recorded -- five contact-model field IDs (HOLD_MONTHS `Ju1U6ROdDNnCFlsn4eeS`, CARRYING_COST `FhcyP63sSAtWInl4Q4iI`, LOAN_AMOUNT `3ZlSKldh0jR2MWhjOmHe`, INTEREST_RATE `i1mVFCwHIySFFzR1hVfQ`, REPAIR_LINE_ITEMS `IwVPbXc9dKUzWGpe4NPx`) POSTed in an opportunity `customFields` payload -- no longer exists, because the only code path that sent them is gone. None of the three candidate remediations it left open was selected; the question they answered is moot.

Retirement evidence: no caller in the repository, no matching GHL webhook among the three configured, and zero Netlify invocations across the full 7-day log retention window. The function was also unauthenticated, so an anonymous POST reached its contact and opportunity write paths carrying the production GHL bearer token.

The UNKNOWN this decision carried -- what GHL does with contact-model field IDs received in an opportunity payload -- was never resolved and is **not** closed by this deletion. It was never established whether GHL accepted, silently discarded, or partially accepted such entries. If a future writer sends cross-model field IDs, that question is open again and no observation here answers it.

`contact.loan_amount` remains the field PB-D46 traced to the Property subgroup in `additionalInfoSubgroups.ts`; PB-D46 is unaffected.

### PB-D48 -- Behavior-based field classification supersedes per-field write adjudication

**Decision.** Fields are classified as writable or restricted by the
observable behavior of a write, not by individual adjudication of each
field. Serialization approval inherits by dataType. A field is writable
by default unless writing it directly affects tags, changes pipeline or
opportunity stage, affects the offer_ fields governed by the
reference-only guardrail at section 14e of the master architecture
reference, modifies GHL system-managed data, or is known to participate
in workflow-triggering behavior.

**Serialization and editors are separate problems.** Serialization
approval inherits by dataType. Editor implementation does not. A proven
dataType does not cause any field of that type to appear in the UI, and
does not reduce the work of building its editor. The current
FIELD_REGISTER records numerous fields whose editor implementation
remains unknown. "TEXT is proven" means the write path is known, not
that TEXT fields are editable in the app.

**Rationale.** This records what Phase B implementation established, not
a relaxation of the standard. Three things are now in evidence that were
not when PB-D16 was written. First, dataType serialization has been
proven independently of individual fields: MONETORY across five fields,
MULTIPLE_OPTIONS across one, with the clear-semantics differences
observed rather than assumed (PB-D24, PB-D36, PB-D37). Second, workflow
behavior in this account is known from the implementation record rather
than from the API. Per PB-D16 section 4.6 workflow triggers are not
API-derivable; the cadences at section 14b trigger on bucket tag and
Seller 7 triggers on pipeline stage, and both are recorded in the master
architecture reference. Third, no currently implemented workflow depends
on recomputation of scoring inputs following ordinary contact edits.
Those fields therefore behave as ordinary editable contact data under
the current implementation.

**What PB-D16 required, and what changes.** PB-D16 restricted the public
surface to a named wrapper per field and required each newly unlocked
field to earn its own decision, on the reasoning that safety is a
per-field fact. That reasoning was correct given the evidence available
at the time. With workflow triggers now inventoried, eligibility for
write capability is determinable by behavioral classification for fields
outside the exclusions above. Per-field promotion decisions are no
longer required for fields that fall clearly inside a classified
category. PB-D16's wire contract is unchanged.

**Classification is scoped to the current implementation.**
Classification is based on the currently implemented IAOS workflows. If
a workflow is later introduced or discovered that is triggered directly
by writes to a contact field, the affected field or fields SHALL be
reclassified before additional write capability is promoted. A field
with documented side effects, or whose behavior cannot yet be
classified, remains individually classified until resolved.

**Intent.** This decision reduces future implementation cost by allowing
fields that share an already-proven behavioral classification and
dataType implementation to inherit write eligibility without requiring
additional architecture decisions. It does not eliminate per-field
implementation, testing, or UI work.

**Naming collision recorded, not resolved.** The label Phase B denotes
two different bodies of work. At sections 5 and 8 of the master
architecture reference it denotes multi-tenancy and OAuth at client #1.
In this document it denotes the field write-proving arc. Both usages are
in active documents. This decision records the collision; renaming is
deferred to a separate decision and is not performed here.

**Unchanged.** PB-D16's wire contract, PB-D22's keystroke removal,
PB-D23's runner parameterization, PB-D24's restoration semantics,
PB-D25's assertion contract, the section 14e offer_ guardrail, and every
existing proof record are untouched.

### PB-D49 -- Terminal-stage exclusion from Dashboard queue sections

**Decision.** A contact is excluded from the Dashboard's Lead Queue and
Unanswered Inbound sections when all opportunities currently associated
with that contact sit in a terminal stage. Display-only filtering; no
write of any kind.

**Rationale.** The Lead Queue and Unanswered Inbound sections are
intended to surface contacts requiring active follow-up. Contacts whose
associated opportunities are exclusively in terminal stages are excluded
because they no longer represent active pipeline work under the current
Dashboard design. Long-Term Nurture remains visible because it
represents deferred work, not completed work.

**Terminal stages.** Two, matched by ID, not by name:
0c45ee3d-7be7-4651-97a4-6df53f53481b Seller Closed-Won
f1960b50-8aa2-4a69-ba58-a7a0dc66ce82 Lost / Not Interested

**Long-Term Nurture is a deliberate exclusion, not an omission.**
Stage a7436df7-e05a-4bf0-bd29-70f7066ec0bd is not terminal under this
decision. Revisit only if live use demonstrates that Long-Term Nurture
contacts should no longer appear in these queues.

**Callbacks are out of scope, deferred not omitted.** Whether a promised
follow-up survives its contact reaching a terminal stage is undecided
product behavior, not a filtering question. A callback may be exactly
where the loop is meant to close. Section 3.2 is unchanged by this
decision and requires its own.

**Zero opportunities means not excluded.** A contact with no opportunity
has no stage and is unaffected by this rule.

**All-opportunities rule.** One non-terminal opportunity keeps the
contact visible regardless of how many terminal ones sit alongside it.

**Match on ID.** The existing name lookup in Dashboard.tsx
(s.name === "Seller Offer Sent") is not the pattern to follow. The IDs
are pinned in the STAGES array in ghl-opportunities.ts.

**Offers Awaiting Response is out of scope.** It already filters to
Seller Offer Sent, a non-terminal stage, so no terminal contact can
reach it. Deliberate exclusion.

**Opt-out exclusion is a separate decision.** ContactRow carries no
dndSettings, so opt-out filtering requires a data-shape change this
decision does not make.

### PB-D50 -- Text-channel opt-out exclusion from Unanswered Inbound

**Decision.** A contact is excluded from the Dashboard's Unanswered
Inbound section when their GHL dndSettings carry an SMS or RCS entry
whose message is exactly STOP_KEYWORD. Display-only filtering; no write
of any kind.

**Rationale.** A seller who has texted STOP should not be treated as an
actionable unanswered text contact unless that opt-out is deliberately
cleared in GHL. Leaving them in the section the spec designates highest
priority makes that section majority noise, which is why it was not
being worked. SMS and RCS are one channel for this purpose.

**Predicate is the message, not the status.** Match on
message === "STOP_KEYWORD". Do not match on status === "permanent".
OBSERVED 2026-08-07 across all 44 contacts in the location: every
permanent entry is STOP_KEYWORD and every STOP_KEYWORD entry is
permanent, so the two are indistinguishable on current data. They are
not the same concept. permanent describes GHL's own irreversibility
claim; STOP_KEYWORD describes what the seller did. The rule follows the
seller.

**The top-level dnd boolean is not the signal.** OBSERVED: contact
05gYdxJcyNTCKWTwkbbs carries dnd false while holding permanent
STOP_KEYWORD entries on both SMS and RCS. The top-level boolean
therefore cannot be relied upon as the opt-out predicate.

**Presence of a dndSettings entry is not an opt-out.** OBSERVED: five
contacts carry SMS entries with status active and messages of the form
TWILIO_ERROR_CODE: 30003, 30005, or 30006. Those are deliverability
failures, not consent withdrawals. Excluding them would hide leads who
never opted out and instead have an unreachable or landline number.
That is a separate problem and this decision does not address it.

**Email unsubscribe is a deliberate exclusion, not an omission.**
OBSERVED: one contact carries Email, status active, message
"User clicked on the unsubscribe link". That is a real consent
withdrawal and STOP_KEYWORD will not catch it. This decision's opt-out
exclusion is scoped to SMS and RCS. Email consent behavior is undecided
and requires its own decision.

**Empty object means no DND.** OBSERVED: dndSettings is present on
44 of 44 contacts; 31 hold an empty object. The key is always defined
on the list read, so the predicate tests entries, never key presence.

**Reversal is manual and lives in GHL.** IAOS stores no opt-out state
and reverses nothing. Clearing DND on the GHL contact record makes the
entry stop matching, and the contact returns on the next Dashboard
load. No IAOS control for this is authorized by this decision; it would
be a write.

**Lead Queue is out of scope.** PB-D49 established that
escalatedContactIds derives from the unfiltered unanswered array, so a
contact hidden here does not re-enter the Lead Queue. Whether a contact
who texted STOP should still appear as a cold call is undecided
product behavior and requires its own decision.

**Data-shape change.** OBSERVED: dndSettings is returned by GHL's
contacts list endpoint but dropped by parseContact
(app/netlify/functions/lib/contact-parse.ts), the shared parser behind
both ghl-contacts and ghl-contact. Carrying it forward there is the
implementation path this decision authorizes.

**Function surface note.** ghl-contacts has no inbound authentication.
Carrying dndSettings adds opt-out state to a publicly reachable
endpoint. Recorded for FUNCTION_SURFACE_AUDIT; it does not block this
decision.

### PB-D51 -- Shared environment-selectable GHL configuration module

**Decision.** GHL identifiers used by the Contact Workspace path move
out of source literals and into one shared configuration module that
exports production and test identifier maps. A single environment
selector determines which map each build or runtime consumes; the
exact selector mechanism is gated on verification below. No behavior
changes. No new writes. Production values are byte-identical before
and after.

**Rationale.** GHL identifiers are location-scoped, so a second GHL
location makes every hardcoded id wrong. They are not secrets -- a
field id is inert without a token, and the token is the security
boundary. That means configuration, not environment variables: one
checked-in module holding both maps, and one variable choosing between
them, rather than ninety variables.

**One module, imported by both sides.** Vite bundles app/src; esbuild
bundles app/netlify/functions and follows relative imports outward. A
pure-data module with no Node and no browser APIs can be consumed by
both. One source of truth, compile-time validation, no duplication
guard.

**Scope, included.** OBSERVED, source: repository read 2026-08-10,
recorded in the Phase 0 inventory.
- The location id jmHG4B8RdzwpfqruNf68, at all eight occurrences
  inside app/: seven Netlify functions and app/src/lib/ghl.ts.
- Contact custom-field ids in app/src/lib/ghl.ts and in
  app/netlify/functions/lib/contact-parse.ts.
- The two folder ids in app/src/pages/ContactWorkspace.tsx.

**The location id converts as a unit.** It cannot be partially
converted. If the Contact Workspace path reads it from config while
ghl-conversations retains a literal, a single Dashboard load reads two
locations at once -- a worse state than not converting. All eight
occurrences inside app/ move together or none do.

**Scope, excluded. Deliberate, not omissions.** Each is correct as it
stands and converts when its own surface becomes active work.
- app/src/pages/MaoCalculator.tsx, seventeen offer and source ids.
- All of netlify/functions/, the marketing site, including its second
  copy of the location id and pipeline id.
- The ten pipeline stage UUIDs in ghl-opportunities.ts.
- TERMINAL_STAGE_IDS in app/src/pages/Dashboard.tsx.
- All fourteen scripts under app/scripts. These are deliberately
  pinned to production fixtures and to the deployed proxy. Making
  them environment-aware adds a surface that would itself need
  verifying, with no current requirement to run them against a test
  location.

**Implementation is gated on two verifications.** No identifier moves
until both are answered from the tooling, not from reasoning.
1. That the proposed module path resolves under both bundlers --
   Vite for app/src and esbuild for app/netlify/functions -- and that
   app/tsconfig.json permits the import in both directions. A neutral
   location such as app/shared/ is expected to be correct; app/src/
   may not be.
2. How the selector is read. Vite statically replaces
   import.meta.env.VITE_*; esbuild does not parse it, and browser code
   cannot read process.env. The module therefore cannot read the
   selector identically on both sides. Either it exports a selector
   function each side calls with its own value, or the value is
   supplied by a build-time define. Neither is chosen here.

**Verification is that nothing changed.** Production identifier values
must be byte-identical after conversion, and the live Dashboard,
Contact Workspace, and Contacts grid must behave exactly as before.
This decision authorizes no new capability.

**The test-map schema exists before the test location does.** No test
identifier values are recorded by this decision. Test selection must
fail loudly while required values are absent; it must never fall back
to production identifiers. The test map is populated only after a GHL
test location is created and its identifiers are read from it.

**Amendment (2026-08-10): implementation gate cleared.** This
supersedes item 1 of the "Implementation is gated on two
verifications" paragraph and answers item 2. Every other paragraph of
PB-D51 remains as written -- Decision, Rationale, One module imported
by both sides, Scope included, The location id converts as a unit,
Scope excluded, Verification is that nothing changed, and The
test-map schema exists before the test location does.

Question 1, module path. OBSERVED, source: probe run against the
working tree at 8fd7e0d. A pure-data module at app/shared/, imported
by relative path from app/src and from app/netlify/functions
simultaneously, resolves under all three toolchains: tsc --noEmit
exit 0, esbuild --bundle --platform=node exit 0, vite build exit 0.
No path alias, no tsconfig edit, no vite resolve.alias was required.
app/shared/ is the module location. Two caveats, neither blocking:
the probe ran tsc --noEmit rather than the tsc -b of the real build
script, so the rootDir class of error is unproven for an emit path;
and app/src/ as an alternative location was not tested.

Question 2, selector mechanism. Decided, not observed. The shared
module exports getConfig(selector). Each side supplies its own value
at the call site: the client calls
getConfig(import.meta.env.VITE_IAOS_ENV), the server calls
getConfig(process.env.IAOS_ENV). No Vite define block and no
envPrefix setting is added, and app/vite.config.ts is not modified.
The environment source stays visible where it is consumed rather
than injected by build configuration.

**The client selector requires a type prerequisite.** OBSERVED,
source: probe run 2026-08-10. app/ has no vite-env.d.ts and no
vite/client reference, and app/tsconfig.json declares no types field.
A file under app/src reading import.meta.env fails type-check with
TS2339, Property 'env' does not exist on type 'ImportMeta', exit 2.
Adding app/src/vite-env.d.ts containing a vite/client triple-slash
reference clears it, exit 0. That file is a prerequisite of the
client selector and part of this implementation. It is a new file,
not an edit to app/tsconfig.json, so the Question 1 finding that no
tsconfig edit was required is unaffected.

**Fail-loud invariant.** getConfig throws when the selector is
absent, unknown, or resolves to a configuration that is incomplete or
internally inconsistent. There is no default and no implicit fallback
to production under any condition. This extends the test-map rule
above to the selector itself.

**Both selectors are out-of-repo deployment dependencies.** Two
deployment variables must be configured for the app site in Netlify:
IAOS_ENV, read at runtime by the functions, and VITE_IAOS_ENV,
consumed during the client build and baked into the generated bundle.
OBSERVED: app/netlify.toml declares only NODE_VERSION and contains no
[context] block of any kind, so no repository check can confirm
either variable is set. A deploy missing one fails loudly by the
invariant above rather than silently reading production.

### PB-D52 -- Call disposition effect on queue placement

**Decision.** Call dispositions define operational meaning, not merely
call history. Lead Queue membership represents contacts with a working
phone who have not meaningfully engaged and remain candidates for
outbound prospecting. Once a disposition records meaningful engagement,
the contact must leave the Lead Queue unless a later explicit business
rule deliberately resets that state. Queue placement is recomputed from
live GHL state; this decision defines the intended semantics and does
not choose the technical carrier for the engagement state. That
mechanism is PB-D53.

**Disposition classifications.**
- No Answer -- no engagement. Remains eligible for Lead Queue. The
  existing last_call_attempt write greys the row for 12 hours, then it
  resurfaces.
- Voicemail -- one-way contact, not meaningful engagement. Remains
  eligible for Lead Queue. Whether voicemail should use a resurfacing
  interval other than 12 hours remains open and is not decided here.
- Requested Appointment -- meaningful engagement. Leaves Lead Queue.
  Routing is already GHL-owned through Seller 2.5 into Seller 2.
- Follow Up -- meaningful engagement. Leaves Lead Queue and belongs in
  Waiting on Me, Follow-Up. The intended durable state is the Seller
  Follow-Up pipeline stage; the carrier and the Dashboard wiring are
  decided separately in PB-D53.
- Incorrect Number -- invalid reachability. Leaves operational queues
  because GHL clears the primary phone; Lead Queue already requires a
  working phone.
- Not Interested -- meaningful engagement with a terminal outcome.
  Leaves operational queues and belongs in Lost / Not Interested. Stage
  movement is GHL-owned; IAOS does not write pipeline stage.

**Queue definitions used by this decision.**
- Lead Queue -- working-phone contacts not yet meaningfully engaged and
  still appropriate for outbound prospecting.
- Waiting on Me -- engaged contacts where Brad owns the next action and
  that action is knowable now or at a scheduled time.
- Long-Term Nurture -- no immediate human action until a timer or new
  engagement matures.
- Terminal -- Closed-Won and Lost / Not Interested; absent from
  operational queues.

**Long-Term Nurture provenance.** OBSERVED, source: opportunity detail
endpoint read 2026-08-11. Thirty-seven opportunities entered Long-Term
Nurture during a 61-second window on 2026-07-20, after the
opportunities had been created during a four-second import window on
2026-07-01. The stage currently holds thirty-eight; the additional one
entered separately, five hours earlier the same day. The bulk operation
demonstrates that current stage occupancy is not derived from
individual engagement history and therefore cannot serve as an
engagement signal. Existing occupancy is not evidence of prior
engagement, nor evidence of its absence. Which mechanism performed the
bulk move is UNKNOWN; GHL enrollment history is not exposed by the
public API and the question is recorded in PRODUCT_BACKLOG P5.

**Status is not terminal state.** OBSERVED, source: same read. All
forty-two Seller Leads opportunities returned status open, including
both opportunities sitting in Lost / Not Interested. Operational
terminality in this account is stage-based, not status-based. PB-D49's
terminal exclusion keys on stage id and is unaffected.

**Opportunity coverage.** OBSERVED, source: same read. Forty-one of the
forty-three contacts carrying a non-empty phone have exactly one Seller
Leads opportunity, and all forty-one are status open. No Lead Queue
contact with a phone holds more than one. This satisfies the
precondition that a stage-based carrier would require, and it is
recorded here so PB-D53 does not have to re-establish it.

**Non-goals.** This decision does not choose the technical engagement
carrier, does not change the 12-hour resurfacing interval, does not
clean up historical Long-Term Nurture occupancy, does not authorize any
new IAOS write, and does not alter pipeline stages directly from IAOS.
Those belong to PB-D53 or to separate backlog work.

**PB-D49's open callback question is untouched.** PB-D49 left
undecided whether a promised follow-up survives its contact reaching a
terminal stage, and this decision does not settle it. Not Interested
leaving operational queues in this decision applies to Lead Queue,
Unanswered Inbound, and Offers Awaiting Response only. Whether a
scheduled callback for a Not Interested contact should still surface in
Waiting on Me remains undecided product behavior and requires its own
decision.

**Amendment (2026-08-11): what leaving the Lead Queue means.** Leaving
the Lead Queue does not mean calling stops. It means cold prospecting
stops. A contact who engaged is still worked, on a different footing
and often through a different surface; only the cold-outreach job
ends. This is the principle behind every classification above, and it
is stated here because "leaves Lead Queue" reads as "done" without it.

The Lead Queue is conceptually the Cold Call Queue: contacts not yet
successfully spoken with, whose primary phone is not known invalid. No
UI name, code identifier, spec section, or API field changes as a
result of this amendment. The term is introduced to explain the
queue's operational purpose, not to rename it. Lead Queue remains the
name everywhere else.

Read that way, the six classifications resolve without further
argument. No Answer and Voicemail keep cold-calling because no live
conversation has occurred. Requested Appointment and Follow Up leave
cold outreach and continue to be worked, the first through Seller 2's
automated booking sequence and the second by hand. Not Interested
stops because the seller ended it. Incorrect Number stops because the
number cannot reach them, and resumes when it can.

**Operational queues, implemented.** Lead Queue, Waiting on Me,
Long-Term Nurture, and Terminal. Each corresponds to something the
Dashboard renders or PB-D49 excludes.

**Anticipated operational states, not yet carried.** Two states follow
from the principle above but have no durable carrier today, and are
named here so their absence is legible rather than mistaken for a
defect. Automation: a contact currently being worked by a workflow,
where the next action is neither cold outreach nor yours. Seller 2
owns that behavior but writes no state on entry and ends with Remove
from Workflow, so nothing observable distinguishes a contact inside it
from one that never entered. Reachability-blocked: a contact still
worth working whose primary phone is unusable. PB-D53 defines the
carrier as Phone Status; it is gated and does not yet exist.


### PB-D53 -- Durable carriers for engagement and reachability state

**Decision.** PB-D52 defines what call dispositions mean for queue
placement. This decision defines the durable GHL-owned state IAOS reads
to implement those semantics. The carriers are distinct by concern:
pipeline stage carries engagement state; a contact custom field carries
primary-phone reachability state. IAOS does not write any PB-D53
carrier.

**Engaged follow-up carrier.** The Seller Follow-Up pipeline stage is
the durable carrier for an engaged contact whose next unscheduled human
action belongs in Waiting on Me, Follow-Up. A GHL workflow triggered by
the Follow Up call disposition moves the contact's Seller Leads
opportunity to that stage. Seller 6 -- Follow-Up Reminder already
triggers on an open Seller Leads opportunity entering it, and therefore
already owns the reminder cadence that follows.

**Terminal carrier.** The Lost / Not Interested pipeline stage is the
durable terminal carrier for the Not Interested disposition. A GHL
workflow triggered by that disposition moves the Seller Leads
opportunity to that stage. PB-D49 already excludes it from the queues
PB-D49 governs. PB-D49's scheduled-callback question remains open per
PB-D52 and is not settled here.

**Requested Appointment is already routed.** Seller 2.5 listens directly
on Call details, Custom disposition Requested Appointment, and adds the
contact to Seller 2. No new carrier is introduced for that disposition.

**Reachability carrier.** A new contact custom field named Phone Status
carries operational state for the primary phone. It is not Phone Type.
Phone Type records carrier line type, Mobile, Landline, VoIP or Unknown,
written by phone-lookup.ts from a Twilio lookup. Phone Status records
whether the primary number is operationally callable for queue
purposes. The two answer different questions about the same number.

Phone Status is SINGLE_OPTIONS and carries two values:
- Incorrect Number
- Callable

Callable was added 2026-08-11 by the reset amendment below. It has a
writer and a semantic role, so it satisfies this decision's own test.
Undeliverable was considered and rejected for now: PB-D50 records five
contacts carrying dndSettings entries of the form TWILIO_ERROR_CODE
30003, 30005 or 30006, which are deliverability failures rather than
consent withdrawals, but nothing is proposed that would write such a
state or act on it. An enum value with no writer and no consumer is
abstraction ahead of its first consumer. It is added when one exists.

**Incorrect Number.** A GHL workflow triggered by that disposition sets
Phone Status to Incorrect Number. IAOS excludes a contact carrying that
value from the Lead Queue. The native primary phone is not cleared.
OBSERVED, source: live GHL builder 2026-08-11 -- the Update contact
field action rejects an empty native Phone value with "Invalid number,
please make sure to add country code", so the earlier copy-then-clear
design is blocked at the action level. Whether the API can clear a
native phone where the UI will not is UNKNOWN and untested, and would
be an IAOS write outside the sanctioned three in any case.

**Reset requirement, and the gate.** Phone Status is not
implementation-complete until the rule that restores a corrected number
to queue eligibility is defined. A new or corrected primary phone must
have an explicit process that clears or changes Phone Status. Until that
rule is specified and verified, creating the field and building the
Incorrect Number workflow are both gated. Excluding a contact with no
defined path back is a one-way door.

**Field placement.** Phone Status belongs in the standard Contact folder
8NV0bLrpGEi4bRflnasN, beside Phone Type. OBSERVED, source: repository
read of CONTACT_FIELD_REFERENCE Part 1 -- that folder is standard true
and currently holds Phone Type alone. It renders flat, so no subgroup
assignment is required and additionalInfoSubgroups.ts is unaffected.

**Previous Phone is currently unused.** It was created 2026-08-11 during
exploration of the Incorrect Number design, before the native-phone
clear mechanism proved unavailable. No workflow writes it, IAOS does not
read it, and it sits in Additional Info. This decision neither removes
it nor assigns it a consumer; its future use is undecided. Its existence
is not evidence of implemented behavior.

**IAOS read consequences.** Implementing this model requires a later app
commit. The Dashboard must exclude Seller Follow-Up from the Lead Queue,
add a Waiting on Me, Follow-Up section sourced from that same stage, and
exclude non-callable Phone Status values from the Lead Queue.

The shared contact parser does not carry arbitrary custom fields.
OBSERVED, source: repository read 2026-08-11 -- parseContact projects
named fields only. Phone Status therefore requires a shared-config field
id, parser output, a ContactRow field, and a Dashboard predicate. This
is the same data-shape extension PB-D50 required for dndSettings. This
decision defines the read model and authorizes no IAOS write.

**Schema-count consequences.** Previous Phone raised the contact
custom-field total from 96 to 97. Phone Status raises it to 98 and the
Contact folder from one field to two. CONTACT_FIELD_REFERENCE Part 1's
folder and field tables and the harness RECORD structure in
verify-contacts.cjs must both be updated to the actual schema.
verify-contacts.cjs currently carries an exact floor of 136; two
additional fields raise the expected floor to 138. The harness aborts on
exact inequality rather than a less-than, so the floor change is part of
implementation and not optional cleanup.

**Opportunity precondition.** OBSERVED, recorded at PB-D52 -- forty-one
of the forty-three contacts carrying a non-empty phone have exactly one
Seller Leads opportunity, and all forty-one are status open. No contact
with a phone holds more than one. Stage-backed routing therefore has
coverage for the current population. A contact with no opportunity is a
separately handled edge case and does not justify a second engagement
carrier.

**Long-Term Nurture is not an engagement carrier.** PB-D52 records the
bulk-move provenance that makes current occupancy of that stage
non-evidentiary for engagement history. This decision does not read it
as an engagement bit.

**Scope of the no-write rule.** GHL owns state mutation and IAOS reads
applies to the PB-D53 carriers only. It is not a claim that IAOS has no
other contact writes. OBSERVED, source: repository read 2026-08-11 --
netlify/functions/phone-lookup.ts issues a PUT to /contacts/{id}
carrying key phone_type, which resolves the question left open at
CONTACT_WORKSPACE_SPEC_v2 section 5.6 item 3 as to whether that function
writes Phone Type back to the contact. It does.

**Implementation is gated, in this order.**
1. Define and verify the Phone Status reset rule for a corrected primary
   phone.
2. Create Phone Status only after item 1 resolves.
3. Build the two GHL disposition workflows, Follow Up and Not
   Interested.
4. Build the IAOS read change: shared config, parser, ContactRow,
   Dashboard predicates, Waiting on Me Follow-Up section.
5. Update CONTACT_FIELD_REFERENCE and the harness to the 98-field schema
   and floor 138 before trusting any verification run.

**PB-D52's Incorrect Number mechanism is superseded.** PB-D52 classifies
that disposition as leaving operational queues "because GHL clears the
primary phone." That clause is superseded by the Incorrect Number
paragraph above: the clear is blocked at the Update contact field action
and no mechanism clears the primary phone today. PB-D52's
classification of the disposition as invalid reachability is unaffected;
only its stated mechanism changes. Every other paragraph of PB-D52
remains as written.

**Amendment (2026-08-11): the reset rule, the gate, and the Callable
transition.** This paragraph replaces the reset mechanism stated
earlier the same day, which held that Phone Status resets to absent by
either of two paths. That mechanism is unbuildable.

OBSERVED, source: live GHL workflow execution 2026-08-11 16:33:36 --
an Update contact field action writing an empty value to a
SINGLE_OPTIONS field executes and changes nothing. The execution log
records Executed; Phone Status remained Incorrect Number; the native
phone and Phone Type were unaffected. An empty value against
SINGLE_OPTIONS is a no-op, not a clear. GHL logs Executed for an
action having fired, not for it having had an effect. Second instance
observed today; the first was Seller 2.5's Add to Workflow when Seller
2 rejected the contact on re-entry.

The reset is therefore an explicit state transition rather than a
clear: Incorrect Number becomes Callable. Callable asserts that the
prior Incorrect Number judgment no longer applies. It does not assert
that the current number is verified.

**The transition invariant.** Callable is written only to a contact
currently holding Incorrect Number. Both reset paths are gated on that
condition, and any path added later inherits the rule. A contact that
never carried Incorrect Number never carries Callable. An ungated
write would reduce Callable to "the phone was edited" or "the contact
was worked", neither of which is the signal this field carries, and
would make the value non-evidentiary within a few months of accrued
edits.

Path A: the native primary Phone field changes, observed by a GHL
Contact changed trigger on that field. A replaced number is a data
correction and the prior invalidity no longer describes it. Path B: a
subsequent disposition that PB-D52 classifies as meaningful
engagement. That classification is PB-D52's and is not restated here;
a seventh disposition classified there governs this reset without
further amendment. Both paths write through the invariant above.

No Answer and Voicemail do not reset. Neither establishes that the
right person was reached -- an unanswered ring and a generic carrier
greeting are both indistinguishable from a wrong but live number.
Incorrect Number describes the wrong person, not a dead line, so
dialability is not the evidence the reset requires.

The Contact changed trigger was characterized 2026-08-10 without being
used: it fires on selected contact fields only, targets an individual
field by name, and offers Has changed and Has changed to. OBSERVED,
source: live GHL builder 2026-08-11 -- it accepts the native Phone
field as the watched field under both operators. Path A is buildable.
This discharges only that question. Whether the API can clear a native
phone where the UI will not, recorded at the Incorrect Number
paragraph above, remains UNKNOWN and untested.

This discharges the gate stated in "Reset requirement, and the gate."
The gate as written was unsatisfiable in its stated order: item 1
required verifying reset semantics against a SINGLE_OPTIONS field, and
that verification required the field to exist. Phone Status was
therefore created 2026-08-11 16:14 ahead of item 1's discharge by
necessity rather than by bypass, and item 1 was discharged at 16:33 by
the execution recorded above. Items 3 through 5 stand as written. Item
5's field-count and harness-floor figures are not amended here and are
not to be trusted until reconciled separately.

**Amendment (2026-08-12): implementation complete, steps 1 through 3.**
Every GHL carrier this decision specifies is built, published, and
verified against live call events. What follows records what was built
and what was observed; it changes no rule stated above.

Incorrect Number writer. Workflow Seller - Phone Status Incorrect
Number. Trigger Call details, filter Custom disposition is Incorrect
Number, single value. Action Update contact field, Phone Status =
Incorrect Number, ungated. OBSERVED 2026-08-11 18:03 -- disposition
fired on a live call, execution log Add to workflow, Update contact
field Executed, End Of Workflow, and the contact record read Incorrect
Number.

Reset workflow. Seller - Reset Phone Status on Phone Change. Trigger
Contact changed, Phone, Has changed. If/Else on Phone Status is
Incorrect Number. YES branch writes Callable; NO branch ends. Both
branches OBSERVED 2026-08-11: a contact holding Incorrect Number took
the Branch and received Callable at 18:13; a contact that had never
held Incorrect Number enrolled, executed the No branch at 18:15, and
its Phone Status remained absent. The transition invariant stated
above is therefore verified rather than merely specified.

Follow Up. Seller - Follow Up. Trigger Call details, Custom
disposition is Follow Up. Find opportunity on Seller Leads Pipeline,
most recently created, splitting Opportunity Found from Opportunity
Not Found. Found branch runs Update opportunity to Seller Follow-Up.
Not Found ends, which makes the no-opportunity edge case legible in
the log rather than silent. OBSERVED 2026-08-11 18:42 -- stage moved
New Lead - Seller to Seller Follow-Up.

Seller 6 enrollment is confirmed, not assumed. This decision states
above that Seller 6 already owns the reminder cadence. OBSERVED
2026-08-11 18:42:30 -- Seller 6 enrolled the contact in the same
second the opportunity entered Seller Follow-Up and advanced to its
Wait - 2 Days step. Seller 6's trigger is Pipeline stage changed,
filtered to Seller Leads Pipeline and Seller Follow-Up, read directly
from the builder rather than inferred from behavior.

Not Interested. Seller - Not Interested. Same shape as Follow Up, with
Update opportunity to Lost / Not Interested. OBSERVED 2026-08-11 18:49
-- stage moved Seller Follow-Up to Lost / Not Interested.

**Seller 6 removal, and where it belongs.** Implementing Not Interested
exposed a gap this decision did not anticipate: the terminal stage move
does not unenroll the contact from Seller 6. OBSERVED 2026-08-11 --
a contact whose opportunity sat in Lost / Not Interested remained in
Seller 6 status Waiting seven minutes later. A seller who ended the
conversation would continue generating internal follow-up reminders
until the cadence exhausted.

Removal is implemented as a Remove from Workflow action inside Seller -
Not Interested, on the Opportunity Found branch, after the stage move.
Two alternatives were considered. A removal condition on Seller 6
itself would cover every exit path including manual stage moves, and is
the more general fix; it was rejected for now because it modifies a
production workflow carrying live enrollments to solve a problem only
this workflow creates. Placing removal in the terminal-transition
workflow follows the precedent already set by Seller 3, which removes
booked contacts from Seller 6 so the reminder tail cannot overwrite
newer state.

Sequence is load-bearing: the stage move precedes the removal, so the
terminal state lands even if the removal step fails.

OBSERVED 2026-08-12 -- a contact was dispositioned Follow Up at
09:37:41, which moved the opportunity to Seller Follow-Up and enrolled
it in Seller 6; dispositioned Not Interested at 09:39, which moved the
opportunity to Lost / Not Interested; and Seller 6's own execution log
records Removed by - External workflow action, Finished, at 09:40:32.
Verification was taken from the receiving workflow's log rather than
the acting workflow's, because a sending workflow logs Executed
whether or not the receiving side acts.

Two earlier runs of this test passed vacuously and are recorded so the
failure mode is legible: a contact with no opportunity, and a contact
that reached the terminal stage without ever passing through Seller
Follow-Up, both produced an absence from Seller 6 that proved nothing.
A removal test requires the contact to be enrolled first, confirmed
before the removing disposition fires.

**Gate status.** Implementation steps 1 through 3 are discharged.
Steps 4 and 5 are not. Step 4, the IAOS read change, is unbuilt; no
app code in this repository implements it. Step 5's 98-field schema
and floor-138 figures conflict with a live reading of the GHL Custom
Fields screen taken 2026-08-11, which reports 153 fields across all
objects and 113 on the Contact object. Which figure is correct, and
what each counts, is UNKNOWN. Step 5 does not proceed until that
reconciliation is done, and no harness floor is pinned from either
number before then.

Phone Status now exists in the GHL schema, so verify-contacts.cjs,
which aborts on checksRun !== 136, will fail on its next run. That
failure is expected and is the same reconciliation step 5 names.

**Amendment (2026-08-12): step 5 discharged.** This supersedes the
"Gate status" paragraph above as to step 5. The 98-vs-113 discrepancy
recorded there is resolved: OBSERVED, source: live read of the
customFields endpoint through the deployed proxy 2026-08-12 -- the
Contact model returns 98 custom fields across six folders, matching
this decision's arithmetic. The Custom Fields screen's 113 counts
something else, most likely GHL standard fields the custom-field
endpoint does not return; that figure is not the one any IAOS artifact
tracks and is not reconciled further.

CONTACT_FIELD_REFERENCE Part 1 now records 98 fields, the Contact
folder at 2, and Additional Info at 74, with a dated re-observation
line rather than a silent rewrite. Previous Phone is assigned to
Reachability in both additionalInfoSubgroups.ts and the reference,
taking that subgroup to 23 and the partition to 23/30/14/7. The
assignment is a placement decision, not a wire fact: GHL exposes no
subgroup, and an unmapped Additional Info field falls to the end of
System, where Previous Phone was rendering until this change.

verify-contacts.cjs carries RECORD at 98 fields, SUBGROUP_EXPECT at
23/30/14/7, and an exact floor of 138. OBSERVED 2026-08-12 -- 138/138,
zero failures, against bundle index-164n205B.js. verify-conversations
passed 24/24 against the same bundle. The three assertions this
decision could previously only reason about are now observed: Phone
Status renders at position 1 of the Contact folder, Previous Phone at
position 22 of Reachability, and Reachability's DOM count is 23.

**Order of execution differed from the stated order.** Step 5 was
completed before step 4. Recorded because the numbered list above
reads as a sequence and this execution did not follow it. It was
harmless: the schema reference and the harness assert what GHL renders
and what the existing client config produces, neither of which depends
on the read model step 4 builds. Step 4 is the sole remaining PB-D53
implementation item.

### PB-D54 -- Cold-outreach eligibility governs Lead Queue membership

**Decision.** A contact is excluded from the Lead Queue when their
current state establishes that cold outreach is no longer the right
work, whether or not that state is rendered anywhere in Waiting on Me.
Membership derives from underlying state, not from what a section
happens to display. Display-only filtering; no write of any kind.

**Why this decision exists.** OBSERVED, source: repository read of
Dashboard.tsx 2026-08-11. The leadQueue memo filters on three
predicates: a non-empty trimmed phone, absence from
escalatedContactIds, and absence from terminalContactIds.
escalatedContactIds derives solely from the unanswered-inbound read.
Neither the callbacks memo nor the offers-awaiting read contributes to
it. A contact with a scheduled callback therefore appears in Waiting on
Me and in the Lead Queue simultaneously, and so does a contact whose
offer is out and awaiting response. The Dashboard can tell you to cold
call someone while also telling you that you owe them a callback.

**The Lead Queue copy already claims this behavior.** OBSERVED, same
read: Dashboard.tsx's Lead Queue blurb states that anyone who has
engaged moves to Waiting on Me and drops out of the list. That is true
for unanswered inbound and false for callbacks and offers. This
decision makes the copy accurate rather than the copy being corrected
to match a narrower implementation.

**Exclusion predicates.** Six. A contact carrying any one of them is
absent from the Lead Queue.
- Live unanswered inbound. Already implemented as
  escalatedContactIds; unchanged by this decision.
- Any scheduled callback, including future-dated and overdue. Reads
  callback_datetime and its precise companion.
- Offer awaiting response. An open opportunity in Seller Offer Sent
  carrying the offer-made tag, the same read DASHBOARD_SPEC_v2 section
  3.3 already performs.
- Terminal stage. Already implemented as terminalContactIds per
  PB-D49; unchanged by this decision.
- The Seller Follow-Up pipeline stage, per PB-D53.
- Phone Status equal to Incorrect Number, per PB-D53.

**The future-dated callback is the case that decides the rule's
shape.** The callbacks memo buckets overdue and due-today only;
a callback scheduled for Thursday renders nowhere until Thursday. An
exclusion keyed on section membership would leave that contact cold
callable Monday through Wednesday, which is precisely the error the
principle at PB-D52's Cold Call Queue amendment exists to prevent. A
promise to call Thursday is engagement the moment it is made. That the
Dashboard does not render it yet is a display gap, and Waiting on Me
may continue to render only overdue and due-today callbacks without
affecting membership.

**Offers Awaiting Response excludes for a different reason.** The
other predicates mark work Brad owes. An offer awaiting response marks
work the seller owes; DASHBOARD_SPEC_v2 section 3.3 describes it as a
no-write read signal rather than an action. It excludes anyway, because
the question the Lead Queue answers is whether cold outreach is still
the right job, and a contact with a live offer out is not a cold
prospect by any reading.

**Callback reset.** Clearing callback_datetime restores cold-outreach
eligibility from the callback predicate. Per CONTACT_WORKSPACE_SPEC_v2
the clear writes setCallbackDatetime(null) alone -- no note, no
last_call_attempt, no grey -- so a cleared callback and a
never-scheduled callback are indistinguishable afterward. That is
intended: clearing is Brad deciding the promise no longer stands, and
the record of the promise lives in the notes rather than in the field.

**Callbacks do not expire.** An overdue callback remains an exclusion
until it is cleared or replaced by hand. A promise made three weeks ago
and never actioned still excludes the contact from cold outreach. The
system treats an unkept promise as still owed rather than silently
returning the contact to the cold list. The consequence, accepted: the
exclusion has no automatic exit, and the only path back is the manual
clear above.

**Relationship to PB-D49.** PB-D49 established terminal-stage exclusion
and was silent on callbacks and offers. This decision does not change
PB-D49's terminal semantics, its two pinned stage ids, its
all-opportunities rule, or its zero-opportunities rule. Terminal becomes
one predicate among six rather than one of two. PB-D49's paragraph
stating that Offers Awaiting Response is out of scope remains correct
as to that section's own filtering; this decision governs Lead Queue
membership, not what section 3.3 renders.

**Implementation, and what is available now.** Four of the six
predicates read data the app already has. unanswered is already
computed; callback_datetime and its precise companion are already on
ContactRow; the offer-awaiting read already runs for section 3.3;
terminal stage is already computed. Seller Follow-Up is available from
the opportunity data the Dashboard already loads. Only Phone Status
requires the shared-config, parser, and ContactRow work PB-D53 names,
so five predicates are implementable independently and the sixth joins
at PB-D53 step 4.

**Not decided here.** Whether an excluded contact should surface
anywhere other than the section that already renders them. A contact
with a future-dated callback is now absent from the Lead Queue and
rendered nowhere until the callback comes due, which is a narrower
version of the same display gap named above. Whether Waiting on Me
should render future callbacks is undecided product behavior and
requires its own decision.

### PB-D55 -- Underwriting authority belongs to the Opportunity

**Decision.** Underwriting state belongs to the deal, not to the person.
The Contact carries seller and person data; the Opportunity carries
property, deal, and underwriting data. Approved underwriting persists to a
selected Opportunity and nowhere else. This decision fixes the data model
and the human-approval boundary; it authorizes no code and no write, and
its implementation is gated below.

**Why the Opportunity.** A seller may hold two properties, sell the same
property twice, or carry more than one deal at once. Underwriting anchored
to the Contact collides in every one of those cases, and the collision is
silent -- the second deal overwrites the first with no record that it
happened. PB-D52 OBSERVED that 41 of the 43 contacts carrying a phone hold
exactly one Seller Leads opportunity, so the one-deal case is today's
normal case; that is a fact about the current population, not a property of
the model. Contact-side fields have better-proven write safety (five
MONETORY fields inert-proofed, PB-D33 through PB-D35). Write safety is
provable on demand. A wrong data model is unwound only by migration.

**Three layers, distinct by owner and by consequence.**

*Proposed underwriting.* Review-only. Not persisted, not readable by any
GHL workflow, and carrying no authority. In v1 its values are entered by
hand; a later AI proposer populates the same layer without changing this
decision or the gate below it. The layer is defined by its lack of
authority, not by what fills it.

*Approved underwriting.* Persisted to the selected Opportunity on an
explicit human action. Approval is an explicit user action that accepts the
proposed underwriting for the selected Opportunity. This is the durable
state, and the only underwriting state a workflow or a downstream read may
rely on. OBSERVED, source: live read of the customFields endpoint with
model=opportunity, 2026-08-12 -- the Opportunity schema already contains
distinct underwriting input fields and seller-offer fields, including
`arv_after_repair_value`, `repair_estimate`, `asking_price`,
`closing_costs`, `assignment_fee_target`, `wholesale_fee_`,
`mao_max_allowable_offer`, and the separate `offer_*` family. The schema
already carries the split this decision names.

*Presented offer.* The seven `offer_*` fields, on both objects. These
record the offer prepared for and ultimately presented to a seller, which
is a different fact from what the deal underwrites to.
`mao_max_allowable_offer` and `offer_mao` are deliberately different
numbers. Current implementation populates these fields before seller
presentation; the Dashboard's `offersToReview` predicate distinguishes
offers prepared but not yet presented by the absence of the `offer-made`
tag. Whether the write moment should move to align with the architectural
model is not decided here. The §4.1 HARD NO on `offer_` writes is unchanged
by this decision and is not relaxed by it.

**One production record carries `offer_` test data.** OBSERVED 2026-08-12
-- opportunity `1AP9BfFPJ2xYZ0RPTm9U` (Neelima Bale) is the only
opportunity in the location holding custom-field data, and all seven values
are `offer_*`: price 245001 against MAO 245000.5, repair total 0, margin
-0.5. A price above MAO at a negative margin is not a deal; it is a
calculator test that persisted. Under this decision that record reads as a
presented offer, and it is not one. It is recorded here so a future
consumer does not treat it as evidence of anything, and so its removal is a
deliberate act rather than a surprise. Note also that this contact already
serves as the record-view fixture, the D5 conversation-parity regression
fixture, and verify-dashboard.cjs's eligible control; adding an
underwriting role to the same record concentrates more fixture weight on
one contact than is comfortable.

**Underwriting never writes `offer_`.** The separation is structural rather
than conventional. PB-D39 OBSERVED that a Save Offer against bradt75
populated its `offer_` fields and broke subsequent inert-proof runs until
the confirmation guard was changed; underwriting that wrote `offer_` would
reproduce that class of failure on every underwritten contact.

**Opportunity selection is required.** The Underwriting workspace operates
on one identified Opportunity, named on screen. It does not assume the
first opportunity is the deal. Where a contact holds more than one, the
deal under underwriting is selected. Where a contact holds none, no
underwriting becomes authoritative and none is written to the Contact as a
substitute; the workspace reports the absence and requires an Opportunity
before proceeding.

**Contact values may seed; the Opportunity owns.** `contact.arv`,
`contact.estimated_repairs`, `contact.asking_price`, `contact.carrying_cost`
and `contact.loan_amount` hold existing data and are not deleted by this
decision. Read order for a proposed value: the Opportunity field first, the
corresponding Contact field only when the Opportunity field is absent. Once
approved underwriting is written, the Opportunity value is authoritative
permanently and the Contact fallback is not consulted again for that deal.
Seeding is a one-time convenience, not an ongoing synchronization
mechanism. Approved values are NOT mirrored back to the Contact. A mirror
recreates the two-source-of-truth condition this decision exists to remove,
and no consumer for it has been identified.

OBSERVED 2026-08-12 -- no opportunity in the location carries any
underwriting input value. All seven fields this decision names as
underwriting inputs are unpopulated across all 42 opportunities, and the
single opportunity holding custom-field data holds only `offer_*` values.
Contact fallback will therefore supply the initial proposed values for
nearly every existing deal, rather than serving only as an edge case.

**Supersession of the contact-side unlocks, for underwriting authority
only.** PB-D16 established `setARV` as the named public writer for
`contact.arv`; PB-D17 defined its `currency + inline` editor; PB-D18
recorded that the field has no app-side consumer; PB-D42 superseded
PB-D18's locational clause. None is revoked. `contact.arv` remains
unlocked, editable, and inert-proof Proven, and its harness checks stand
unchanged. What this decision supersedes is any reading of those decisions
under which `contact.arv` is the authoritative ARV for a deal. It is not,
and was not designed to be; PB-D18 recorded it as having no consumer at
all.

**A named writer, not an overloaded one.** Approved underwriting is written
through a new named method, `saveUnderwritingFields`, distinct from the
existing `opportunities.saveOfferFields`. The existing method's name
describes offers and its body writes arbitrary customFields to
`/opportunities/{id}`; using it for underwriting would make the call site
the only place the distinction lives. This follows PB-D16's rule that the
public surface names what it writes.

**Implementation prerequisites.** No underwriting write occurs until each
is discharged on its own terms.

1. *Opportunity-side inert proof.* Every proof in
   PHASE_B_INERT_PROOFS.md targets a contact, and the runner's FIELDS
   registry carries `contactId` per entry. No opportunity-model field has
   completed a four-stage cycle. At least one underwriting field must,
   before routine writes begin. Whether the runner is extended or a
   separate procedure is used is not decided here.

2. *Opportunity customFields shape.* DISCHARGED 2026-08-12. Every
   opportunity returned by `ghl-opportunities.ts` carries a `customFields`
   key, so the read path is established. The projection is sparse: only
   populated fields appear, the same convention `parseContact` handles on
   the contact side. Entries are `{id, type, fieldValue<Type>}` -- the
   value key varies by type, `fieldValueNumber` for `number` and
   `fieldValueDate` for `date`, and dates arrive as unix milliseconds
   rather than ISO. This differs from the contact model's `{id, value}`, so
   an opportunity read path needs its own parser and cannot reuse
   `parseContact`'s readers. MaoCalculator's three type-specific readers
   (`cfRaw`, `cfNum`, `cfText`) are the existing precedent. Shapes for
   dataTypes absent from the one populated record remain unobserved.

3. *Investor-assumption carrier.* Selling costs, buying costs, holding
   costs, financing costs, and required profit belong to the investor
   rather than the deal. The Opportunity carries `closing_costs`,
   `wholesale_fee_` and `assignment_fee_target`; it carries nothing for
   holding, financing, or required profit. Whether the missing assumptions
   become investor-profile configuration, new Opportunity fields, or both
   with per-deal override, is undecided and requires its own decision.

4. *Migration handling.* The seed-then-supersede rule above states the
   intent. Which contact-side fields participate, whether a value's
   provenance is surfaced in the UI, and what happens to a contact-side
   value edited after its Opportunity value became authoritative, are not
   settled here.

**Consequence.** Underwriting is no longer a calculator. It is a
review-and-approval workflow. Calculations may be recomputed freely as
inputs change, because recomputation carries no authority; nothing becomes
authoritative until explicit approval. Every downstream activity --
presenting an offer, generating a contract, reporting, automation -- reads
approved underwriting and never proposed values. This is the same boundary
PB-D48 draws for field writes and PB-D19 draws for inline edits: the system
may prepare, and a person commits.

**Not decided here.** The Underwriting workspace's layout and controls. The
source of proposed ARV and repair values, including whether an AI proposer
is built and what data would feed it. Contract generation and any state
after a seller accepts. Whether the four cost assumptions above are
per-investor or per-deal. `deal-submit.ts` and `mao-webhook.ts` were
retired 2026-08-13 and deleted, and PB-D47 is closed by deletion --
recorded here because this paragraph previously listed that as undecided.

**Unchanged.** CONTACTS_OPPORTUNITIES_SPEC §4.1's HARD NO on `offer_`
writes, tags, pipeline stage, and workflow triggers. PB-D16's named-wrapper
rule and its private-helper shape. PB-D17's editor template. Every field's
unlock status and every existing proof record. PB-D53's and PB-D54's
carriers and predicates, none of which this decision touches.

### PB-D56 -- Underwriting assumptions, their carriers, and the resolution hierarchy

**Decision.** IAOS underwrites wholesale acquisitions backward from a
representative end buyer's economics. This decision fixes the economic
model, the eleven investor-level policy assumptions it requires, the
three-level resolution hierarchy those assumptions resolve through, and
the GHL carriers that hold them. It authorizes no code and no write. Its
implementation prerequisites are named at the end.

PB-D55 established that underwriting authority belongs to the
Opportunity. This decision says what underwriting consists of and where
its inputs live.

---

## I. The model

**Wholesale-first, buyer-economics-aware.** IAOS does not ask what a
property is worth. It asks what a representative end buyer could pay and
still meet their return requirement, then reserves the wholesaler's
spread from that ceiling. Two outputs, deliberately distinct:

    End-Buyer Maximum Purchase Price
        = the most a representative flip buyer could pay

    Seller MAO
        = End-Buyer Maximum Purchase Price - Required Assignment Spread

**"MAO" alone is ambiguous and is not used.** The two numbers differ by
the assignment spread and answer different questions. Every reference
names which one it means.

**The waterfall.**

        ARV                              deal input
      - Repairs                          deal input
      - End-Buyer Selling Costs
      - End-Buyer Purchase/Closing Costs
      - End-Buyer Holding Costs
      - Required Buyer Profit
      = Base Buyer Capacity

      / (1 + k)                          k = financing factor
      = End-Buyer Maximum Purchase Price

      - Required Assignment Spread
      = Seller MAO

**Financing divides rather than subtracts.** The other deductions reduce
buyer capacity by a fixed amount. Financing cost scales with purchase
price, which is the value being solved for, so it enters as a divisor:

    k = LTV x [Points % + (Annual Rate x Hold Months / 12)]

This is a linear relationship with an exact solution, not an
approximation. It is recorded here so that nobody later "simplifies" the
division into the subtraction list; doing so would change the answer.

**Three economic kinds, which all reduce Seller MAO identically and are
not the same thing.**

- *Buyer expenses* -- selling, purchase/closing, holding, financing.
  Costs a buyer actually incurs.
- *Buyer requirement* -- required profit. Not an expense; a return
  threshold the model reserves.
- *Wholesaler spread* -- the assignment. Not the buyer's at all.

The distinction is recorded because required profit is the deduction
most likely to be mistaken for a cost and "optimized away" by a future
reader.

---

## II. The six deductions

### 1. End-Buyer Selling Costs

*Buyer expense.* Estimated transaction costs the end buyer incurs when
reselling after rehab: agent commissions, seller-side title and escrow,
transfer and recording charges, seller-paid concessions, and other
normal disposition costs. Excludes repairs, holding, financing, and
acquisition costs, each modeled separately.

    Selling Costs = ARV x Effective Selling Cost %

ARV is the resale basis. A separate projected-resale-price input is not
created; ARV already represents what the renovated property is believed
to sell for, and two fields that should always agree are two fields that
can disagree.

Unresolved when ARV is unavailable. This deduction has no independent
failure mode.

Overridable per deal by percentage or fixed dollar.

### 2. End-Buyer Purchase/Closing Costs

*Buyer expense.* Estimated transaction costs the end buyer incurs to
acquire: buyer-side title, escrow, attorney, recording, inspections.
Excludes financing charges -- points, lender fees, interest -- which
belong to the financing deduction.

    Purchase/Closing Costs = Effective Closing Cost Estimate

A flat dollar amount, deliberately not a percentage. A percentage would
have to be of purchase price, which is circular, or of ARV, which is a
convenient denominator rather than an economically correct one.

Always resolves when a default exists. Adds no Gate 1 input.

Overridable per deal by fixed dollar only. A percentage override is not
offered in V1 because "percentage of what" has no good answer here; if a
real need appears, it earns its own decision and its circularity is
solved correctly at that point.

### 3. End-Buyer Holding Costs

*Buyer expense.* Non-financing carrying expenses between acquisition and
resale: property taxes, insurance, utilities, basic maintenance, HOA.
Excludes loan interest and financing charges.

    Holding Costs = Effective Monthly Carry x Effective Hold Months

**Both components or neither.** If either component is unavailable and
has neither a deal value nor a configured default, the entire deduction
is unresolved. No partial calculation from a defaulted hold period times
a missing carry. This is the first deduction with a two-component
structure, which makes the partial case reachable, which is why the rule
is stated.

**Hold period is not derived from repairs.** A banding rule -- $0-25k
repairs is three months, $25-50k is five -- looks rigorous and encodes an
operational assumption nobody has tested. Repair dollars do not reliably
determine construction duration, permitting, contractor availability, or
market time.

Overridable per deal on either component independently. A direct
total-holding-cost override is not offered; the two components explain
the economics and a third path introduces precedence questions with no
current need.

### 4. End-Buyer Financing Costs

*Buyer expense.* Financing expense incurred by the modeled buyer class,
not by any actual buyer. IAOS is not underwriting a specific loan; it is
estimating what a representative financed flip buyer could afford.

    Purchase Loan  = End-Buyer Purchase Price x Effective LTV
    Points Cost    = Purchase Loan x Effective Points %
    Interest Cost  = Purchase Loan x Effective Rate x (Hold Months / 12)
    Financing Cost = Points Cost + Interest Cost

Solved algebraically through the divisor above rather than approximated.

**Purchase Financing Enabled is a switch with three states, not two.**
Off yields a financing cost of exactly zero -- a legitimate zero,
because it is an explicit assumption. On with unresolvable inputs yields
unresolved. Absent configuration yields unresolved. A missing assumption
never becomes an assumption of no cost.

**Rehab financing is NOT modeled in V1. This is a known limitation with
a known direction.** Hard-money products commonly fund renovation as
well as purchase. Omitting that expense understates the buyer's total
financing cost, which overstates End-Buyer Maximum Purchase Price and
therefore overstates Seller MAO. The error is aggressive, not
conservative. It is accepted because the alternative -- an invented
average-utilization factor applied to rehab draws -- would be
unfalsifiable: no available evidence could show it wrong. Rehab
financing is modeled when real draw behavior can inform it, not before.

**Hold Months is shared.** Holding and financing consume the same
Effective Hold Months. A deal-level hold override moves both. IAOS
maintains no separate financing timeline.

### 5. Required Buyer Profit

*Buyer requirement.* The minimum projected gross profit reserved for the
representative buyer after all modeled buyer expenses. Gross profit, not
ROI -- return on capital depends on the financing model and is a
different, derivable number that must not be confused with this one.

    Required Buyer Profit = ARV x Effective Buyer Profit %

Percent of ARV, not of total project cost. Cost includes purchase price,
which is circular; ARV is not.

**Known imprecision, recorded rather than hidden.** Profit scales with
ARV while repairs do not, so a light-rehab and a heavy-rehab deal at the
same ARV reserve the same profit despite different risk. A
percent-of-cost model would fix this and introduce circularity. The ARV
basis is the V1 choice and the limitation is a known one.

Unresolved when ARV or the profit percentage is unavailable.

Overridable per deal by percentage or fixed dollar. A "greater of X% or
$Y" policy is NOT offered in V1. Investors commonly think that way and
it is a legitimate future model, but building it now creates a profit
policy engine ahead of its first consumer; the deal override accomplishes
either requirement today.

### 6. Required Assignment Spread

*Wholesaler spread.* Not a buyer expense. The amount reserved between
End-Buyer Maximum Purchase Price and Seller MAO.

**Three explicit modes.** The mode is durable state, not provenance --
it determines the calculation and cannot be reconstructed from the
resulting number.

    Standard Minimum    Spread = Configured Minimum Assignment Spread

    25% of Buyer Profit Spread = max(Required Buyer Profit x Buyer
                                 Profit Share %, Configured Minimum)

    Manual              Spread = investor-entered amount, which MAY be
                                 below the configured minimum

**"Required" buyer profit, deliberately, not "expected."** At the moment
IAOS calculates, the two are identical: the waterfall solves for maximum
purchase price by reserving required profit, so expected profit equals
required profit exactly at MAO. They diverge only when a seller accepts
below MAO, which is not known at underwriting time and is not what this
calculation sees. A post-acceptance expected-profit view is a different
calculation and is not specified here.

**A mode never silently substitutes for another.** If 25% mode is
selected and Required Buyer Profit is unresolved, the spread is
unresolved -- it does not fall back to the minimum. Falling back would
change the calculation because data was missing, which is the same
defect as unknown-becoming-zero wearing a different hat. An investor who
wants exactly the minimum without requiring buyer profit to resolve
selects Standard Minimum, which is what that mode is for.

**Manual below the minimum is permitted and is an exception.** Selecting
Manual is a deliberate departure from standing policy. A below-minimum
manual spread may be flagged visually as out-of-parameters but is never
blocked; there will be situations where a $3,500 assignment is rational.
It does not become a new default.

**Manual is per-deal and does not persist across deals.** Changing the
selected deal starts from the standard derived rule.

---

## III. Resolution rules

**Unknown is never zero. Zero is allowed only when zero is an explicit
assumption or a known value.** This is the governing rule of the entire
model. A missing input does not become a favorable input. Purchase
Financing Enabled = Off yields zero legitimately, because someone
decided it. A missing LTV yields unresolved.

**Conservative bias on starter assumptions.** When IAOS must select a
starter underwriting assumption from a reasonable range, it prefers the
assumption that protects wholesaler margin and dispositionability over
the one that maximizes Seller MAO. IAOS should rather advise an offer
slightly too low than confidently recommend contracting a deal the buyer
pool will not take. This governs the starter values in section IV and
any future starter value.

**Unresolved propagates.** A deduction that cannot resolve makes Base
Buyer Capacity unresolved, which makes both outputs unresolved. IAOS
reports what is missing. It does not produce a partial number.

**Gate 1: ARV and Repairs are the minimum deal-specific inputs required
to produce PROPOSED underwriting.** Every other input resolves from
policy. Property address, seller motivation, asking price, occupancy,
timeline, and mortgage balance are essential to acquisition and
negotiation and are not required to produce a defensible first number.

**Gate 1 governs proposed underwriting only.** PB-D55 establishes
proposed, approved, and presented as distinct states. That the
calculation can run from two inputs does not mean approval should. What
a human requires before approving is a separate question and is not
settled here.

---

## IV. Investor policy -- eleven values

IAOS V1 starter policy, selected conservatively under the bias rule
above. These are **underwriting policy assumptions, not observed market
constants**, and are recorded as such so no future reader treats them as
facts about real estate.

| Value | Starter | Kind |
|---|---|---|
| Default Selling Cost Percentage | 10% | of ARV |
| Default Closing Cost Estimate | $2,500 | flat |
| Default Monthly Holding Cost | $500 | per month |
| Default Hold Period Months | 5 | months |
| Default Buyer Profit Percentage | 15% | of ARV |
| Purchase Financing Enabled | On | switch |
| Default Financing LTV Percentage | 70% | of purchase price |
| Default Interest Rate Percentage | 12% | annual |
| Default Financing Points Percentage | 2% | of loan |
| Standard Minimum Assignment Spread | $5,000 | flat |
| Buyer Profit Share Percentage | 25% | of required profit |

**Naming convention.** Title-case business names. `Default X` only where
the value is genuinely a default. Policy-specific names where the value
is a mode, floor, switch, or standing rule -- Purchase Financing Enabled
is a switch, Standard Minimum Assignment Spread is a floor, Buyer Profit
Share Percentage is an active policy setting rather than a fallback.

**Provenance of the starter values.** Ten percent selling costs rather
than eight, a fifteen percent buyer profit requirement, financing on at
70/12/2, and a $500 monthly carry are all applications of the
conservative bias rule. If actual dispositions run cheaper, the surplus
becomes buyer room rather than a discovery after contracting. Selling
costs at 10% of ARV is the largest deduction after repairs on most
deals and moves Seller MAO more than any other single assumption; it is
the first value to revisit against real disposition data.

---

## V. The resolution hierarchy

Every assumption resolves through exactly this order:

    Deal Override  ->  Investor Policy  ->  IAOS Starter Policy  ->  Unresolved

**Three levels, each with a distinct owner.** IAOS ships starter policy
so a new investor can calculate immediately without first becoming a
hard-money underwriting expert. An investor configures their own policy
when their economics differ. A deal overrides policy when that specific
deal warrants it.

**A deal override never modifies policy.** Changing an assumption on one
deal does not change the investor default. Changing the investor default
is a deliberate settings action.

**Override precedence within a level.** Where both a dollar and a
percentage override exist for the same value: dollar wins, then
percentage, then the level below. Exactly one drives the calculation.

**Provenance is derived, never stored.** Which level supplied a value
follows deterministically from which levels hold one. No `*_source`
fields are created. The exception is assignment mode, which is not
provenance -- it changes the calculation and cannot be reconstructed
from the resulting number.

---

## VI. Carriers

| Concept | Carrier |
|---|---|
| Investor policy, all eleven values | GHL Custom Values, location-scoped |
| Deal-specific inputs | GHL Opportunity custom fields |
| Deal overrides | Opportunity fields, created on first real need |
| Assignment spread mode | New Opportunity SINGLE_OPTIONS field |
| End-Buyer Maximum Purchase Price | New Opportunity NUMERICAL field |
| Seller MAO | `opportunity.mao_max_allowable_offer` |
| Provenance | Derived, not persisted |
| Ready for Underwriting | Derived, not persisted |
| IAOS-side storage | None. No shadow authority. |

**Custom Values are the policy authority.** OBSERVED 2026-08-12 through
the deployed proxy: the location holds 42 Custom Values, each carrying
an id, a name, a `fieldKey` of the form
`{{ custom_values.default_wholesale_percentage }}` for workflow
interpolation, and a flat string value. They are location-scoped, which
is the right scope for investor policy, and workflow-readable, which
IAOS-side storage would not be.

**Three underwriting-adjacent values already exist and are not equally
useful.** `Default Closing Cost Estimate` = 2500 fits the new model and
is retained. `Default Assignment Fee Minimum` = 5000 carries a surviving
concept under a name this decision replaces. `Default Wholesale
Percentage` = 70 belongs to the 70%-rule formula retired 2026-08-13 with
`mao-webhook.ts` and is **obsolete for underwriting** -- it is not part
of this model and is not read by it.

**None of the three is read by any code.** OBSERVED: all three numbers
were duplicated as hardcoded literals in application code rather than
read from GHL. Two of those literals were deleted with `mao-webhook.ts`;
the third, a $5,000 fee floor, remains in the calculator this model
replaces. Adopting Custom Values as the policy authority resolves a
duplication that already exists rather than creating one.

**A deliberate, time-boxed duplicate.** `Standard Minimum Assignment
Spread` is created as a new Custom Value holding 5000, and is
authoritative. `Default Assignment Fee Minimum` is NOT renamed and NOT
deleted, because renaming may change the `fieldKey` and deleting may
break a GHL workflow that interpolates it -- and whether any workflow
does is UNKNOWN. Both will hold 5000 until that is verified. This is a
two-sources-of-truth condition created on purpose; principle 11 is
satisfied by naming which is authoritative and by time-boxing the
duplicate to the verification, not by pretending the duplicate does not
exist. The same holds for `Default Wholesale Percentage`, which is left
in place and marked obsolete rather than deleted.

**Seller MAO takes `mao_max_allowable_offer`.** OBSERVED 2026-08-13: the
field is empty on all 42 opportunities, and its only writer,
`mao-webhook.ts`, was deleted. It has no surviving consumer and no
semantics to violate. When someone asks a wholesale system "what is my
MAO," the actionable answer is what can be offered to the seller, so
Seller MAO is the natural occupant.

**End-Buyer Maximum Purchase Price gets a new field.** No existing field
on either model represents it. The seven `offer_*` fields on the
Opportunity record a presented offer and are governed by the §4.1 HARD
NO; the contact-side candidates are seller inputs, not a buyer price.

**Assignment mode gets a new SINGLE_OPTIONS field.** OBSERVED: no free
SINGLE_OPTIONS field exists on the contact model -- all six are owned --
and none on the opportunity model carries this concept. Mode belongs on
the Opportunity per PB-D55 regardless, since it is deal state.

**Deal overrides are sparse by design.** A field is created when the
Underwriting Workspace actually persists that override, not because the
override is theoretically possible. This does NOT mean an investor
cannot override an assumption; it means a durable Opportunity field is
created when the override has a consumer.

**Two orphaned candidates, one still in use.** `opportunity.closing_costs`
and `opportunity.wholesale_fee_` were read only by the two functions
retired 2026-08-13 and now have no consumer at all -- there are no
semantics left to violate, and either may be deliberately assigned a
meaning under this model rather than requiring archaeology.
`opportunity.assignment_fee_target` is still referenced by
`MaoCalculator.tsx`, so its disposition is tied to retiring that
calculator rather than free today.

---

## VII. What this supersedes

**The 70% rule is not the IAOS model.** `MAO = (ARV x 70%) - repairs -
assignment fee` folds buyer profit and selling and holding costs into a
single percentage. This model itemizes them. The formula was
implemented in `mao-webhook.ts`, retired 2026-08-13, and is recorded in
the master architecture reference as abandoned deliberately. `Default
Wholesale Percentage` is its last surviving artifact and is obsolete for
underwriting.

**The current calculator's formula is superseded.**
`MaoCalculator.tsx` computes `ARV - repairs - sellingHolding -
targetBuyerProfit - max(feeFloor, assignmentFeeTarget)` with a $5,000
floor hardcoded. It itemizes more than the 70% rule but does not model
financing, does not separate End-Buyer Maximum Purchase Price from
Seller MAO, and reads no configured policy. It is replaced by this
model, not extended.

**PB-D55 is unchanged.** Underwriting authority belongs to the
Opportunity. This decision supplies what underwriting is; PB-D55 already
said where approved underwriting lives.

---

## VIII. Implementation prerequisites

No underwriting write occurs until each is discharged on its own terms.
PB-D55's four prerequisites remain in force and are not restated here.

1. *Custom Values write capability is UNKNOWN.* The collection read is
   OBSERVED. Whether IAOS can create or update an individual Custom
   Value, and how GHL behaves when it does, has not been verified. V1
   may configure policy by hand in GHL. Any settings UI that writes
   Custom Values requires its own wire verification first. Note that the
   location's Custom Values include `iaos_webhook_secret` in plaintext,
   so any write path touches a store holding a credential.

2. *Workflow references to the two superseded Custom Values are
   UNKNOWN.* Whether any GHL workflow interpolates
   `{{ custom_values.default_assignment_fee_minimum }}` or
   `{{ custom_values.default_wholesale_percentage }}` has not been
   checked. Both are left in place until it is. Deletion is a separate
   checked action, not a side effect of this decision.

3. *Ten Custom Values do not exist.* Of the eleven policy values,
   exactly one -- Default Closing Cost Estimate -- exists under its
   authoritative name. The other ten must be created. Creation is a GHL
   action, not a code change, and the starter values in section IV are
   what they are created holding.

   *Amendment 2026-08-13:* this item originally read nine, counting
   Default Assignment Fee Minimum as an existing carrier for Standard
   Minimum Assignment Spread. Section VI states the opposite -- the old
   value is NOT renamed and is NOT the carrier; it is held temporarily
   as a documented duplicate while workflow references are verified.
   Standard Minimum Assignment Spread is therefore among the values to
   create, and the count is ten.

4. *Two Opportunity fields do not exist* -- End-Buyer Maximum Purchase
   Price and the assignment mode enum. Creating an opportunity-model
   custom field via the API is OBSERVED possible per the master
   architecture reference; doing it is not yet done.

5. *No opportunity-side inert proof exists.* PB-D55 records this. It
   applies with more force here, since this model writes two outputs to
   the Opportunity rather than one.

---

## IX. Not decided here

The Underwriting Workspace's layout, controls, and interaction model.
Where the AI proposer's ARV and repair values come from, and whether one
is built. Contract generation and everything after a seller accepts.
Whether `contact.arv` and the other contact-side deal fields are
eventually retired. Whether multiple buyer profiles -- cash, hard money,
private -- are ever built; V1 has exactly one representative flip buyer.
The disposition of `MaoCalculator.tsx` itself.

---

## X. Unchanged

CONTACTS_OPPORTUNITIES_SPEC §4.1's HARD NO on `offer_` fields, tags,
pipeline stage, and workflow triggers. PB-D55 in full. PB-D16's
named-wrapper rule. Every field's unlock status and every existing proof
record. PB-D53's and PB-D54's carriers and predicates.
