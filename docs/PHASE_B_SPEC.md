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

### PB-D33 -- B4 field designation and designated test value

**Decision.** `estimated_repairs` (`contact.estimated_repairs`, `OQnud97MfdxMcTgMVTgf`, MONETORY) is designated as B4 from the remaining MONETORY candidates: `asking_price`, `estimated_repairs`, and `loan_amount`.

**Selection boundary.** The rationale is inference from field purpose: Estimated Repairs is more operationally relevant than Loan Amount and appears less likely than Asking Price to participate directly in seller-facing automation. This is not a safety finding. Per section 4.6, workflow triggers are not API-derivable, and `estimated_repairs` must prove its own field-specific write safety through the complete inert-proof cycle.

**Designated test value.** `8642.75` is approved before the write under the PB-D30 amendment dated 2026-08-03. It is deliberately selected, not observed production data: non-integer to remain on the proven MONETORY decimal path, distinct from ARV `187500.25` and Carrying Cost `4321.25`, recognizable in evidence, and required to be restored immediately after the proof cycle.

**Registry entry is not proof.** Adding the B4 registry entry makes the field eligible to enter the proof sequence; it does not establish safety or authorize the field for application use. Safety is established only if capture, write, verify, and restore complete successfully and the fixture returns to baseline.

### PB-D34 -- B5 field designation and designated test value

**Decision.** `loan_amount` (`contact.loan_amount`, `3ZlSKldh0jR2MWhjOmHe`, MONETORY) is designated as B5 from the remaining MONETORY candidates: `asking_price` and `loan_amount`.

**Selection boundary.** The rationale is inference from field purpose: Loan Amount is less central to seller communication than Asking Price, which sits closer to offer logic and the existing `offer_` HARD-NO pathway. This is not a safety finding. Per section 4.6, workflow triggers are not API-derivable, and `loan_amount` must prove its own field-specific write safety through the complete inert-proof cycle.

**Designated test value.** `24680.25` is approved before the write under the PB-D30 amendment dated 2026-08-03. It is deliberately selected, not observed production data: non-integer to remain on the proven MONETORY decimal path, distinct from ARV `187500.25`, Carrying Cost `4321.25`, and Estimated Repairs `8642.75`, recognizable in evidence, and required to be restored immediately after the proof cycle.

**Registry entry is not proof.** Adding the B5 registry entry makes the field eligible to enter the proof sequence; it does not establish safety or authorize the field for application use. Safety is established only if capture, write, verify, and restore complete successfully and an independent re-capture confirms the fixture returned to baseline. The independent re-capture overwrites the runner's step-1 evidence file in place. Because the runner does not auto-archive, the pre-write step-1 capture must be archived before re-capture or that artifact is lost. Observed at designation: `deal-submit.ts` includes `LOAN_AMOUNT` in the production intake write path, alongside other submitted deal fields. This does not establish field safety, and no safety inference is drawn from it; it does mean B5 exercises a field already writable through production application code.
