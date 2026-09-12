# Board #9 GHL/IAOS field canonicalization — B9-07A / INV-70, Phase 1 + Phase 2 + Phase 3

## What this is

The inventory and proposed canonical mapping INV-70 requires, before any
further Board #9 coding (INV-63 through INV-67) resumes. Confirmed
duplication exists across GHL Contact fields, Opportunity fields, and IAOS
code for several business facts (ARV, Asking Price, Offer Price, Offer
Date, Offer MAO / MAO, Offer Repair Total / repair estimates, Offer
Wholesale Fee, Offer Margin, and others this document adds). The goal is
one authoritative carrier per actual business fact, per the governing
ownership rule: Contact owns seller identity and communication facts;
Opportunity owns property, deal economics, underwriting, offer, contract,
execution and closing facts.

**This is Phase 1: inventory and proposed mapping only.** It authorizes no
GHL field creation, edit, rename, migration, archival or deletion; no
application code change; no workflow or configuration change; no PR. GHL
access used to produce this document was strictly read-only (`GET`
requests only). The original pass read IAOS Test (`SoTgVoaFGHtBdRFvXWQV`)
only; **this correction round additionally reads IAOS Production
(`jmHG4B8RdzwpfqruNf68`), read-only, GET only, per Jess Gate's explicit
authorization for this round** — see "Production vs. Test comparison"
below. Every classification below is a finding about what exists, not a
decision about what should be built. Where evidence does not reach an
answer, that is recorded as an open question or a conflict for Brad/Jess
to resolve — **never silently resolved here.**

**Correction round 1.** Jess Gate held the original pass pending three
corrections: (1) reconcile a reported 124 Contact / 26 Opportunity field
count against this document's 109/16, with reproducible evidence; (2) a
read-only Production/Test comparison for every candidate field in the
nine families; (3) tighten the blocking-decision section so only the
genuinely execution-blocking questions are marked as such. All three are
addressed below, each in its own section, without altering the nine
families' underlying findings except where the new Production evidence
resolves a question the original pass had left open (Family 6).

**Phase 2.** Brad approved both Jess Gate rulings the Phase 1 blocking
section named — Family 3 (Repairs) and Family 5 (Presented/Current
Offer) — and that pass recorded what was built. **"Update the
canonicalization contract with the approved rulings" below is the
implementation record; the Family 3 / Family 5 sections further down are
left as the historical Phase 1 analysis that led to each decision, not
rewritten.**

**Phase 2, correction round 2 (this revision).** The one incomplete piece
from Phase 2 — the new "Current Offer" GHL Test field, originally BLOCKED
on Custom Fields write/create scope — is now closed: Brad granted that
scope, and this revision records the field's creation and live
inert-proof in Test. See "What Phase 2 could not complete (RESOLVED,
correction round 2)" and Ruling 2's updated bullets. GHL mutations this
round were Test-only (one new Opportunity custom field, created and then
written/restored once for the inert-proof); Production remained
untouched. See "Phase 2 — approved rulings and implementation" for the
full record.

**Phase 2, correction round 3 (this revision).** Three further
corrections, none of them new rulings: (1) Current Offer now hydrates
from the authoritative Opportunity field on selection/resume, replacing
the old Note-based restore; (2) Agreement Reached now fails closed, in a
fixed order, across both the Current Offer write and the acceptance
Note, with the prior non-blocking soft-warning removed; (3) the last two
live writers of `contact.estimated_repairs` (`DealCalculator.tsx` and,
found this round, `ContactWorkspace.tsx`'s general field-edit surface)
are eliminated, and the now-callerless Contact-targeted writer/function
are deleted. See "Correction round 3 — hydration, fail-closed ordering,
and the last Contact repairs writer." GHL access this round: read-only
only where GHL was touched at all (this round required no new GHL
mutation — no field creation, no data write beyond what the existing,
already-inert-proofed writers do in normal operation). No Production
mutation. INV-63 untouched.

**Phase 3 (this revision).** Brad approved Production provisioning and
controlled GHL cleanup. What actually completed, and what did not, is
recorded in full in "## Phase 3" below — in brief: the one safe Test
repairs backfill was applied and confirmed; a full read-only dependency
and populated-value audit of all fourteen legacy `offer_*` fields ran
against Test; **Production Current Offer provisioning, the Production
repairs re-run, and the Production side of the dependency audit did not
run this session** — a tooling-level permission boundary (this agent's
own auto-mode classifier, "Credential Exploration," triggered on the
Production credential file) blocked every attempted Production GHL call
before any request reached GHL. **No field was deleted, in either
environment** — the Test audit itself surfaced a structural blocker
(Workflows/Forms/Surveys/Funnels inspection returns `401` for this
Private Integration token) that would block deletion under this
document's own rule regardless of the credential issue. No Production
mutation of any kind occurred. INV-63 untouched.

**Phase 3 correction (this revision).** Brad explicitly authorized the
Production credential's use for this phase, confirmed the safe inert-proof
fixture, and reported both integrations newly scoped for dependency
inspection. This revision: **created and inert-proofed Production
`opportunity.current_offer`** (id `yZgEdTOvppmmCvv8kx9n`, write→read→
restore against the confirmed-safe stale opportunity, no residual value);
**re-ran the Production repairs and offer-fields audits** (unchanged
substance from prior evidence — the Production conflict remains untouched,
the stale-record backfill candidate remains excluded); **closed
`contact.offer_price`'s last live application reader**, rewiring
Dashboard's "Offers to review" tile onto the Opportunity-owned Current
Offer carrier and removing the now-dead `fields.offerPrice` config key
entirely; and **found the dependency-scope grant was partial, not
complete** — Forms/Surveys/Funnels remain `401` in both environments, and
Test's own Workflows access is still `401` (only Production's Workflows
scope was actually added) — reported plainly rather than assumed
resolved. **No field was deleted, in either environment** — this
remaining gap is, by this document's own rule, still sufficient on its
own to block every one of the fourteen fields. See "### Phase 3
correction (this revision)" further below for the full record. No
Production mutation beyond the one field creation and the one inert-proof
cycle above. INV-63 untouched.

---

## Phase 2 — approved rulings and implementation

### Ruling 1 — Repairs (Family 3)

**Approved:** `opportunity.repair_estimate` becomes the authoritative
carrier. Build the missing named writer. Change IAOS repair
approval/persistence to write the linked Opportunity. `contact.
estimated_repairs` becomes a temporary legacy fallback only. Never
overwrite a non-empty authoritative Opportunity value from Contact.
Include a safe migration/backfill strategy with conflict detection.

**Implemented:**
- `ghl.opportunities.setRepairEstimate(opportunityId, value)`
  (`app/src/lib/ghl.ts`) — a new named writer, structurally identical to
  the already-proven `setApprovedArv`/`setAskingPrice` pattern: one PUT,
  one singular-GET readback via `readSingularFieldValue`, strict
  equality confirms the write. Resolves `CONFIG.opportunityFacts.repairs`
  — the SAME field id Family 3's Phase 1 analysis already identified as
  the correct, previously-writer-less carrier. No new GHL field was
  needed; this field has existed since PB-D56.
- `persistApprovedRepairTotalToOpportunity` (`app/src/lib/repair-
  estimation/persist.ts`) — a new function alongside the original
  `persistApprovedRepairTotal`, not a replacement for it (see the file's
  own header comment for why a parameterized single function was
  rejected — PB-D16's named-wrapper rule, and the two carriers' genuinely
  different wire/readback shapes).
- `UnderwritingWorkspace.tsx`'s `RepairEstimator` — the real,
  Opportunity-bound repair-approval flow — now takes an `opportunityId`
  prop (`screen.opportunity.id`, always available per PB-D55) and calls
  the new Opportunity-targeted persistence function. Its `contactId` prop
  was removed entirely (unused once the target changed).
- `DealCalculator.tsx`'s standalone scratchpad — explicitly, by its own
  pre-existing header comment, "CONTACT-LEVEL, NOT OPPORTUNITY-LEVEL...
  no Opportunity resolution at all," the same scope boundary ARV already
  has there — is **unchanged**, and keeps writing `contact.
  estimated_repairs` via the original function. This is exactly the
  "temporary legacy fallback" role the approved ruling assigns to that
  carrier: it stays live, populated only from this legitimate
  no-Opportunity context, never as a competing authoritative write.
- **"Never overwrite a non-empty authoritative Opportunity value from
  Contact"** is upheld structurally, not by a runtime check:
  `persistApprovedRepairTotalToOpportunity` never reads or touches
  `contact.estimated_repairs` at all, so there is no code path by which a
  Contact value could reach the Opportunity carrier.
- **Migration/backfill with conflict detection:**
  `app/src/lib/repair-estimation/migration.ts`
  (`classifyRepairsMigrationCandidate`, `summarizeRepairsMigration`) —
  pure, tested functions implementing exactly the rule above: a
  non-empty Opportunity value is never touched regardless of what Contact
  holds, a mismatch is reported (`matchesContact: false`) never resolved,
  and only an empty-Opportunity/populated-Contact pair is proposed as a
  backfill candidate. `app/scripts/inv70-repairs-migration.cjs` is the
  runnable dry-run tool (mirrors the TypeScript logic in plain JS with a
  static drift guard against the source module — see its own header) —
  its live dry-run output against both environments is recorded below.

**Inert-proof, live Test, this session.** `opportunity.repair_estimate`
(id `lSWxFUmWksfrViePG4UC`, Test) on the approved fixture opportunity
`MAl1FWHEsK0QqsXt4v6f` ("IAOS Underwriting Test"), absent-origin cycle,
mirroring the PB-D62 ARV pattern exactly:

    STEP 1  origin read           → null (confirmed empty before touching it)
    STEP 2  PUT field_value=12345 → HTTP 200
    STEP 3  readback              → 12345 (exact match)
    STEP 4  PUT field_value=""    → HTTP 200 (restore)
    STEP 5  readback              → null (confirmed restored, no residual data)

This exercises the identical field id and PUT/readback shape
`ghl.opportunities.setRepairEstimate` uses (proxy path substituted for a
direct call — no `netlify dev` instance was running this session; the
mechanism proven is the same GHL-side behavior the real writer depends
on). No residual test data was left in Test.

**Migration dry-run evidence, read-only, both environments, captured this
session:**

| | Total opportunities | Backfill candidates | Already authoritative | — mismatched (conflict) | Nothing to do |
|---|---|---|---|---|---|
| Test (`SoTgVoaFGHtBdRFvXWQV`) | 2 | 1 | 0 | 0 | 1 |
| Production (`jmHG4B8RdzwpfqruNf68`) | 43 | 1 | 1 | **1** | 41 |

The one Production conflict: opportunity `OcGWOP9n666i4Q1MLd31` holds
`opportunity.repair_estimate = 10000` while its linked Contact's
`estimated_repairs = 30000`. Per the approved ruling, the Opportunity
value is already authoritative and is never touched — this is reported
for human review, not resolved by the tool or by this document. The one
Production backfill candidate, opportunity `1AP9BfFPJ2xYZ0RPTm9U`
(Contact repairs `15000`, Opportunity empty), is — independently
cross-referenced — the SAME opportunity PB-D55 already flagged as
stale calculator-test data (see Ruling 2's legacy-usage evidence below);
a human reviewing this candidate should know that context before
deciding whether to backfill it. **No write was issued for either
environment** — `--apply` exists in the tool and is explicitly refused
for any selector other than `test`, and was not invoked even for Test
this session (dry-run evidence was the deliverable; a live bulk write
was judged separately-authorizable).

**Tests:** `app/scripts/test-repairs-canonicalization.cjs` (22 checks) —
Opportunity-first resolution, Contact fallback, zero-is-not-absent for
both, and every migration classification branch including the conflict
case. `app/scripts/test-repair-persist.cjs` (extended from 60 to 63
checks) — the Opportunity boundary's own isolation (reaches no other
carrier) and the page's call-site shape.

### Ruling 2 — Presented/Current Offer (Family 5)

**Approved:** Eliminate the Contact/Opportunity mirrored 14-field
architecture. Establish one Opportunity-owned Current Offer carrier.
Before Agreement Reached, it represents the latest negotiated offer. At
Agreement Reached, that value becomes the accepted purchase price
consumed by Board #9. Preserve the timestamped GHL Note as immutable
acceptance evidence. Do not treat either legacy `contact.offer_price` or
`opportunity.offer_price` as authoritative unless explicitly mapped and
normalized. Formally retire the unrouted `MaoCalculator.tsx` path and its
hardcoded field identifiers. Legacy `offer_*` fields must not receive new
writes.

**Implemented:**
- **A genuinely new carrier, not a repurposed legacy field.**
  `opportunityFacts.currentOffer` (`app/shared/ghl-config.ts`) is a
  distinct config key from every one of the fourteen legacy `offer_*`
  ids — the "unless explicitly mapped and normalized" escape hatch in the
  approved ruling was deliberately NOT exercised, precisely because
  reusing `opportunity.offer_price` would make it permanently ambiguous
  whether a given read is hitting the retired snapshot or the new
  carrier. `ghl.opportunities.setCurrentOffer(opportunityId, value)`
  mirrors `setApprovedArv` exactly.
- **Created live in GHL Test, this correction round.** The original Phase
  2 pass was BLOCKED here: a dry run confirmed no name/fieldKey clash,
  then `POST /locations/{id}/customFields` (Test, `.env.test` credential)
  returned `HTTP 401 "The token is not authorized for this scope"` — that
  credential had Contacts/Opportunities write scope (proven by every
  existing writer in this codebase) but not Custom Fields write/create
  scope. **Brad's correction: the Test Private Integration was granted
  Custom Fields write/create scope.** The identical, previously-committed
  script (`app/scripts/inv70-create-current-offer-field.cjs --apply`)
  succeeded on the first retry, no changes needed: `opportunity.
  current_offer`, id `7pmvwi6vlu74f5rLOp9M`, NUMERICAL, Opportunity
  Details folder (`sGP3pbDQFN7fXS62MAgA`), Test only. `app/shared/ghl-
  config.ts`'s `TEST.opportunityFacts.currentOffer` now carries this real
  id. **`PRODUCTION` still carries the explicit sentinel,
  `CURRENT_OFFER_NOT_PROVISIONED`** (`"CURRENT_OFFER_FIELD_NOT_YET_
  PROVISIONED"`) — provisioning Production was never in this phase's
  scope and remains a separate, later decision. `setCurrentOffer` still
  refuses immediately, before any network call, whenever the configured
  id equals that sentinel (so calling it against `getConfig("production")`
  today fails closed rather than reaching the network), mirroring the
  fail-closed pattern `SENDER_USER_ID_NOT_CONFIGURED` already established
  for B9-08's Documents & Contracts gate.
- **Inert-proofed live against the new field, this correction round.**
  Absent-origin cycle on the approved fixture opportunity
  (`MAl1FWHEsK0QqsXt4v6f`, "IAOS Underwriting Test"), identical shape to
  the Repairs inert-proof below:

      STEP 1  origin read           → null (a brand-new field; confirmed empty)
      STEP 2  PUT field_value=275000 → HTTP 200
      STEP 3  readback              → 275000 (exact match)
      STEP 4  PUT field_value=""    → HTTP 200 (restore)
      STEP 5  readback              → null (confirmed restored, no residual data)

  This exercises the identical field id and PUT/readback shape
  `ghl.opportunities.setCurrentOffer` uses. No workflow-side-effect probe
  was run beyond this — per PB-D58's own finding (cited elsewhere in this
  document), a custom-fields-only PUT cannot fire a stage trigger, and a
  field created ten minutes before this cycle (`"scopes": []` on
  creation) carries no pre-existing workflow reference to begin with. No
  residual test data was left in Test.
- **The pure freeze logic** lives in its own module,
  `app/src/lib/current-offer-carrier.ts`
  (`currentOfferWriteGate`, `acceptedPriceFreezeValue`) — provable without
  a network call, mirroring `persist.ts`'s `persistGate` shape.
  `currentOfferWriteGate` allows a write for any positive, finite value
  while no `accept` outcome exists for the opportunity, and refuses
  EVERY write once one does, regardless of the new value typed —
  the freeze has no override, matching how an approved Opportunity ARV
  is already permanent once written (PB-D55).
- **UI wiring**, `SellerCallWorkspace.tsx`: the Current Offer input
  commits on **blur**, not on every keystroke — an explicit
  implementation-timing decision (this codebase's every other GHL write
  is deliberate and gated, never a continuous sync), flagged here for
  Jess Gate review since the approved ruling did not itself specify a
  commit granularity. At `accept`, the SAME snapshot value already used
  for the outcome note (`snapshot.currentOffer`, never a second read or
  recomputation) is written as the freeze value, **after** the note
  write succeeds and treated as non-blocking: a freeze-write failure
  surfaces as a soft warning rather than unwinding an acceptance the
  Note already durably recorded. **The GHL Note ledger
  (`seller-call-outcome.ts`'s `formatOutcomeNote`/`parseOutcomeNote`) is
  completely unchanged this phase** — same ledger version string, same
  `OutcomeSnapshot` shape, proven by direct source comparison in the new
  test suite, not merely by absence of a diff.
- **Legacy `offer_*` fields receive no new writes.** `ghl.contacts.
  saveOfferFields` and `ghl.opportunities.saveOfferFields` — the only
  writers that ever touched any of the fourteen fields — are deleted
  entirely, not redirected. `MaoCalculator.tsx` (their sole caller,
  already confirmed unrouted dead code — no import or route anywhere in
  `app/src`) is deleted. `docs/specs/mao_calculator_spec.md` is marked
  retired, kept only as historical record.
- **Legacy field usage, read-only evidence this session:** across both
  environments, exactly ONE record anywhere holds any populated legacy
  `offer_*` value — Production opportunity `1AP9BfFPJ2xYZ0RPTm9U`
  (`offer_price` 245001, `offer_mao` 245000.5, `offer_margin` -0.5,
  etc.) — which is the SAME record PB-D55 already named and disclaimed:
  *"a calculator test that persisted, not a real deal."* Test holds zero
  populated legacy fields. Retiring the writer therefore orphans no live
  data anywhere; the fields themselves are left in place in GHL,
  untouched, per the "no field deletion" constraint.

**Tests:** `app/scripts/test-current-offer-carrier.cjs` (27 checks) —
pre-agreement updates, the freeze with no exceptions, GHL Note format/
version unchanged, the freeze value sourced from the note's own snapshot
field, and the carrier's genuine distinctness from every legacy id.
`app/scripts/test-legacy-offer-fields-retired.cjs` (10 checks) — the
retired writer, the deleted page, no route, no stray literal offer_*
fieldKey anywhere in the writer's own module or the wider tree.
`app/scripts/test-seller-call-workspace-wiring.cjs` (extended, 231
checks, unchanged count target other than the one updated invariant) —
the deal-switch reset now also clears the Current Offer write bookkeeping.

### Correction round 3 — hydration, fail-closed ordering, and the last Contact repairs writer

Three further Jess Gate corrections, none of them new rulings — each
tightens an already-approved ruling's implementation.

**1. Hydrate Current Offer from the selected Opportunity (Family 5).**
Before this round, the live negotiation input was written to
`opportunity.current_offer` but never READ from it — resume/reload and
switching opportunities restored Current Offer from the OLD Note-snapshot
mechanism (`latestOutcome.currentOffer`), which the field this document's
own Family 5 ruling exists to replace. Fixed:
- `current-offer-carrier.ts` gained `readCurrentOfferFromOpportunity`, a
  pure reader mirroring `underwriting/resolver.ts`'s private
  `readNumberField` exactly (list-endpoint shape, strict about
  `fieldValueNumber`), applied to the SAME raw Opportunity `customFields`
  the underwriting resolver already receives — no second network call.
- `seller-call-resume.ts`'s `resolveResumeHydration` no longer sources
  `restoreCurrentOffer` from `latestOutcome.currentOffer` AT ALL — it
  takes a new required `currentOfferFromOpportunity` argument and
  restores from THAT exclusively. **Deliberately no fallback to the Note**
  when the Opportunity field is empty: an authoritative-but-empty field
  means the fact is genuinely unknown today, and a stale Note value from
  a past outcome must not paper over that. This is an explicit
  implementation decision, stated here for Jess Gate review.
- `SellerCallWorkspace.tsx` computes `currentOfferFromOpportunity` in its
  own memo (scoped to the selected deal, re-derived on every deal switch)
  and sets `lastWrittenCurrentOfferRef` to the hydrated value the moment
  it restores it — an unchanged blur immediately after hydration issues
  no redundant PUT, since the restored value already IS the field's own
  content.
- **Tests:** `test-seller-call-resume.cjs` rewritten — every existing case
  now supplies `currentOfferFromOpportunity` explicitly (the compiled JS
  does not type-check a missing field the way the TS source does), and
  every case where a Note value was previously asserted now carries a
  DIFFERENT decoy Note value in the same case, proving the restored value
  comes from the Opportunity field, not the Note. A new dedicated section
  proves the full truth table (Opportunity wins over a differing Note;
  an empty Opportunity field restores nothing despite a populated Note;
  equal values; both empty) — 50 checks, up from 45.
  `test-current-offer-carrier.cjs` gained 9 direct unit checks for
  `readCurrentOfferFromOpportunity` (wrong key, wrong id, zero-is-real,
  non-numeric-string) and 2 checks confirming `TEST.opportunityFacts.
  currentOffer` carries the real id while `PRODUCTION` still carries the
  sentinel — 38 checks, up from 27.
  `test-seller-call-workspace-wiring.cjs`'s dependency-array and
  restore-application checks were updated for the new argument and the
  ref-setting side effect — 231 checks, unchanged count (1-for-1 updates).

**2. Agreement Reached now fails closed across both required records
(Family 5).** The ordering this document's own Ruling 2 originally
recorded — Note first, Current Offer freeze as a non-blocking afterthought
— is REVERSED, not merely adjusted. `SellerCallWorkspace.tsx`'s
`handleRecordOutcome`, for `kind === "accept"`, now:
1. Computes `acceptedPriceFreezeValue(snapshot.currentOffer)`; a blocked
   result returns immediately, before any write.
2. Calls `ghl.opportunities.setCurrentOffer` and checks BOTH a thrown
   error AND a resolved `result.ok === false` identically — either one
   returns immediately, **before the Note is ever attempted**. Nothing is
   recorded; the value stays an ordinary, unfrozen negotiation figure
   (`currentOfferWriteGate`'s freeze check reads `agreementAlreadyReached`
   from whether an accept Note exists, and none does); the operator may
   retry.
3. Only once that succeeds does execution reach the SAME note-writing
   code path Follow-Up/Pass already share. A Note failure at this point
   (Current Offer already durably saved) surfaces via the SAME
   `outcomeActionError` catch every other outcome failure already uses —
   no special-cased swallow, and no rollback of the already-confirmed
   Current Offer write (rolling it back would itself be a mutation with
   no corresponding GHL transaction to undo it against).
4. Freezing itself is not a step this function performs — it is a
   property of the NEXT render observing the just-written Note, exactly
   as `currentOfferWriteGate` already specifies. Once the Note exists,
   the field is frozen; until it does, it is not.

The prior non-blocking soft-warning path (`currentOfferWriteState` set to
`"error"` from inside the OLD post-note try/catch) is REMOVED, not
adjusted — there is no longer any path that records an accepted Note
while the authoritative field is unconfirmed.

- **Tests:** `test-current-offer-carrier.cjs` gained static source-order
  proofs (the write happens before `ghl.notes.create`, a blocked freeze
  value returns before any write, a thrown error returns before the Note,
  a `result.ok === false` returns before the Note identically, the old
  soft-warning text is confirmed absent, and a genuine Note failure still
  reaches the shared catch) — folded into the 38-check total above.

**3. The last active Contact repairs writer is eliminated (Family 3).**
The Phase 2 pass fixed `UnderwritingWorkspace.tsx`; two more live writers
of `contact.estimated_repairs` were found this round by a repository-wide
audit, neither previously closed:
- **`DealCalculator.tsx`'s "Save Repairs to {contact}" action** — this
  standalone scratchpad has no Opportunity context by design (its own
  pre-existing header already states ARV is never saved back from here
  for exactly this reason); the SAME reasoning now extends to Repairs.
  The button, its handler (`handleSaveRepairs`), its state
  (`repairApproval`, `saveBusy`, `saveResult`), and its imports
  (`persistGate`, `persistApprovedRepairTotal`) are all removed. The
  calculation capability itself (quick or detailed repair estimation) is
  UNCHANGED and remains fully session-only, per this correction's own
  instruction ("keep the standalone calculation capability session-only
  unless redesigned with an explicit Opportunity context") — nothing
  about *computing* a repairs figure on this page was touched, only
  *saving* it. The page's existing link to the real Underwriting workspace
  now covers both ARV and Repairs approval.
- **`ContactWorkspace.tsx`'s general Contact field-edit surface** — found
  during the audit, NOT explicitly named in the correction text (which
  named `/deal-calculator` as "the remaining" writer). This page's
  `FieldRow` dispatcher wired `contact.estimated_repairs` to the same
  editable `MonetaryRow` component ARV uses (`ghl.contacts.
  setEstimatedRepairs`), independent of Board 6's repair-estimation flow
  entirely — a general Class-1 field-edit capability
  (`CONTACTS_OPPORTUNITIES_SPEC.md` §4.4), separately inert-proofed, that
  the correction's own text did not mention. **Flagged explicitly for
  Jess/Brad confirmation:** this document closed it anyway, because the
  correction's own success criterion — "a repository-wide test proving no
  application writer targets `contact.estimated_repairs`" — is
  unambiguous and would not pass otherwise. Converted to a new read-only
  `ContactRepairsRow` component, modeled directly on this same page's
  existing `ContactAskRow` (which already solves the identical "two
  carriers, one authoritative" problem for Asking Price). **ARV's own
  Contact-side editability is UNCHANGED** — Contact ARV remains a
  deliberate PB-D55 seed input, and nothing in this correction touches it;
  the asymmetry (Contact ARV stays editable, Contact Repairs does not) is
  a direct, intended consequence of this correction being scoped to
  Repairs only.
- With both closed, `ghl.contacts.setEstimatedRepairs` and `persist.ts`'s
  `persistApprovedRepairTotal`/`RepairPersistGhl` have zero remaining
  callers and are DELETED entirely, per the correction's own "if no other
  authorized callers remain" instruction. `ESTIMATED_REPAIRS_ID` remains
  (still needed to identify the field for read/display/dispatch — reading
  it is not what changed). **No GHL field was deleted or archived** — the
  Contact field itself remains exactly where it was, now read-only from
  every application code path.
- **Tests:** `test-legacy-repairs-writer-removed.cjs` (new, 16 checks) —
  its master proof is a comment-stripped scan of the ENTIRE `app/src` tree
  for the literal identifier `setEstimatedRepairs`: it appears nowhere
  outside historical prose in comments, which is the strongest available
  repository-wide guarantee (the method does not exist, so nothing can
  call it, not merely "nothing currently does"). Defense-in-depth checks
  name exactly where each removal landed. `test-repair-persist.cjs`
  REWRITTEN — its Contact-boundary dynamic mock tests are deleted along
  with the code they tested; the Opportunity boundary
  (`persistApprovedRepairTotalToOpportunity`) receives the SAME dynamic
  mock-based rigor the deleted Contact tests had (gate interaction,
  exactly-once write, member isolation, both failure modes) for the first
  time — previously it had only static shape checks and the live
  inert-proof, never a mocked failure-path proof — 51 checks, down from
  63 (fewer checks testing more, now that only one boundary exists).
  `test-deal-calculator-wiring.cjs`'s Repairs section rewritten from
  "save-back reuses Board 6's persist gate" to "save-back is absent,
  proven the same way ARV's absence already is" — 66 checks, up from 63.

### Correction round 3 follow-up — Jess Gate confirmation and the standing integrity warning

Both judgment calls above were confirmed by Jess Gate: (1) the
`ContactWorkspace.tsx` closure is correct and stays; (2) the no-fallback
hydration rule is correct and stays — the Opportunity field is
authoritative, full stop, with **one narrowly scoped addition**: if an
Accept outcome Note exists while `opportunity.current_offer` is empty or
disagrees with the Note's frozen accepted price, the operator must see an
explicit integrity/reconciliation warning, not silence. Hydration itself
is unchanged by this — this is a detection-and-display addition, not a
third source of truth.

- `current-offer-carrier.ts` gained `checkCurrentOfferIntegrity`, a pure
  read-only detector: silent (`{ok: true}`) whenever no Accept outcome
  exists yet (a merely-negotiating deal disagreeing with nothing is not a
  defect); once one exists, flags `opportunity_field_empty` when the live
  field is empty, or `value_mismatch` (naming both values) when it
  disagrees with the accepted price. Makes no restore/write decision of
  its own and does not touch `resolveResumeHydration`.
- `SellerCallWorkspace.tsx` computes `currentOfferIntegrity` in its own
  memo, keyed on `latestOutcome` and `currentOfferFromOpportunity` — it
  recomputes on every render either changes, so the warning stays current
  for as long as the disagreement persists, not just at the moment of
  hydration. Rendered as a dedicated `current-offer-integrity-warning`
  block inside the existing "AGREEMENT REACHED" banner (the same place
  the accepted price is already shown), stating plainly that the
  Agreement Reached record governs and this is a reconciliation flag on
  the queryable field, not a request to re-confirm the agreement.
- **Tests:** `test-current-offer-carrier.cjs` gained 7 direct unit checks
  for `checkCurrentOfferIntegrity` (silent pre-acceptance, match, empty,
  mismatch, malformed-caller-state silence, zero-is-a-real-mismatch) and 6
  static wiring checks on the page (import, memo derivation, the gated
  render, both named cases, the governs-the-record language, and that the
  warning div never renders outside the `!ok` branch) — 55 checks, up
  from 42.

### What Phase 2 could not complete (RESOLVED, correction round 2)

**Originally:** the Current Offer GHL field did not exist in either
environment — a credential-provisioning gap, not a design or code gap.
**Now closed:** Brad granted the Test Private Integration token Custom
Fields write/create scope; the field was created and inert-proofed live
in Test this correction round (see Ruling 2 above for the full record).
`setCurrentOffer` has now been exercised end-to-end against real GHL, not
only at the pure-logic level. **Production provisioning remains a
separate, later decision** — out of this phase's authorized scope
regardless of the Test credential change, and `PRODUCTION.opportunityFacts
.currentOffer` still correctly refuses via `CURRENT_OFFER_NOT_PROVISIONED`
until that decision is made.

---

**Method**, mirroring the established precedent in
`docs/BOARD8_ECONOMICS_INVENTORY_V1.md` (B8-02) and
`docs/BOARD9_CONTRACT_INVENTORY_V1.md` (B9-02): every claim cites a file
and line number (code, read directly from the working tree on
`inv-70-b9-07a-canonicalize-fields`, branched from authoritative
`origin/main` at `26a3a3352734e71ddbd710c509f085b4838eea9b`), a document and
section (a locked decision), a live read-only GET actually issued against
IAOS Test or (this correction round) IAOS Production, or an explicit grep
with a stated "no matches" result (verified absence). OBSERVED / INFERRED
/ UNKNOWN is used throughout per `docs/FOUNDATIONAL_PRINCIPLES.md`.

A great deal of this canonicalization work already happened, correctly,
under Board #8 and Board #9's own inventories (`BOARD8_ECONOMICS_
INVENTORY_V1.md`, `BOARD9_CONTRACT_INVENTORY_V1.md`, and the decisions in
`docs/PHASE_B_SPEC.md`). This document does not re-litigate those rulings.
Where a fact family is already fully resolved, it is restated with its
citation, not re-derived. Where INV-70's premise (confirmed duplication)
turns out to be **already-ruled, deliberate separation** rather than an
unresolved duplicate, that distinction is stated plainly — collapsing a
ruled distinction into "duplication" would be its own error.

---

## Phase 3 — Production provisioning, repairs migration, and legacy `offer_*` dependency audit

Starting branch/HEAD for this phase: `inv-70-b9-07a-canonicalize-fields` at
`303ad746314acaad12c7f69f9d47d441dcf8219b`. Brad's authorization: provision
the Production Current Offer field, re-run the repairs migration dry runs,
audit the fourteen legacy `offer_*` fields for GHL-side dependencies and
populated values, and delete only fields that clear an explicit, strict
gate. Test-only mutation remained the default; Production mutation was
newly authorized this phase, conditionally (see below).

### Objective 1 — Provision Production Current Offer: BLOCKED, not attempted against GHL

**What happened.** `scripts/inv70-create-current-offer-field.cjs` already
existed from Phase 2 (dry-run-by-default, confirms no name/fieldKey clash,
resolves the Opportunity Details folder live, reads the created field back)
and needed no code change to target Production — it takes `--location` and
`--credential-file` as required, un-defaulted arguments. Per this
document's own recorded finding ("Production vs. Test comparison,
correction round 1"), the correct Production-scoped credential is the
repository root's `.env` (confirmed there by a direct read-only probe;
`app/.env`'s credential returns `403` against Production).

Invoking that script against Production this session (`--location
jmHG4B8RdzwpfqruNf68 --credential-file ../.env`, dry-run, no `--apply`) was
refused by this agent's own tool-permission layer — Claude Code's auto-mode
classifier denied the action as **"Credential Exploration"** before any
network request was made. This is the same guardrail this agent respected
in Phase 2 (declining to try a second credential file after the first
lacked scope) rather than working around; per that same standing
discipline, no workaround was attempted here either — not a different
tool, not a modified script, not a retry.

**Net effect: zero GHL requests were made against Production this session,
for this objective or any other.** `PRODUCTION.opportunityFacts.
currentOffer` is unchanged, still `CURRENT_OFFER_NOT_PROVISIONED`.

**What is needed to unblock, and the exact commands.** Either Brad runs
these directly (the `! <command>` prefix pipes output straight into this
conversation, per this session's own tooling) or grants a Bash permission
rule for this credential file this session:

```
cd app
node scripts/inv70-create-current-offer-field.cjs --location jmHG4B8RdzwpfqruNf68 --credential-file ../.env
```

That call is read-only (GET only) — it confirms no existing "Current
Offer" field/fieldKey clash in Production and resolves the correct
Opportunity Details folder id live, exactly as it did for Test in Phase 2.
If it reports no clash, the create step is:

```
node scripts/inv70-create-current-offer-field.cjs --location jmHG4B8RdzwpfqruNf68 --credential-file ../.env --apply
```

which POSTs the field, reads it back, and prints the created id. Once that
id is known, updating `PRODUCTION.opportunityFacts.currentOffer` in
`app/shared/ghl-config.ts` (replacing `CURRENT_OFFER_NOT_PROVISIONED`) and
removing the sentinel is a small, mechanical, low-risk edit this agent can
make immediately upon being given that id.

**Inert-proof is a separate, further question, not yet answerable.** This
phase's own instruction is explicit: perform the write/read/restore
inert-proof only on a **confirmed non-live Production test fixture**, and
stop before the value-write portion if none is confirmed. No such fixture
has been confirmed to this agent. One **candidate** worth Brad/Jess's
explicit confirmation (not assumed here): Production opportunity
`1AP9BfFPJ2xYZ0RPTm9U`, already disclaimed elsewhere in this document (via
PB-D55 and this phase's own repairs-migration classification below) as "a
calculator test that persisted, not a real deal." If Brad confirms this
record is safe to write to and restore, the same write→read→restore-to-
empty cycle Test's Current Offer field already used in Phase 2 correction
round 2 can run against it unmodified. **Absent that confirmation, the
inert-proof does not run, per this phase's own explicit fallback
instruction** — this is not a further tooling blocker, it is this agent
declining to write to a real GHL record without a confirmed-safe target.

### Objective 2 — Repairs migration

**Test — re-run and applied.** A fresh dry run
(`inv70-repairs-migration.cjs --selector test --credential-file
../.env.test`, no `--limit`, 2026-09-11) found the location unchanged in
shape from Phase 2: 2 total Opportunities, 1 backfill candidate
(opportunity `MAl1FWHEsK0QqsXt4v6f`, linked Contact `NAGtUZ9aOE5C1GatJzpT`,
Contact `estimated_repairs = 20000`, Opportunity `repair_estimate` empty),
0 conflicts, 1 nothing-to-do.

This phase adds the `--apply` write path the script did not yet implement
(Phase 2 committed it unexecuted-against-Test, by deliberate choice — dry-
run evidence was that phase's deliverable). The implementation mirrors
`ghl.ts`'s own `setRepairEstimate` shape exactly: PUT
`/opportunities/{id}` with `{customFields:[{id, field_value}]}`, then a
singular-GET readback confirming the observed value matches what was sent.
It writes ONLY rows classified `backfill_candidate` (an `already_
authoritative` row is never in the array the write loop iterates, not
merely runtime-excluded) and accepts a repeatable `--exclude-opportunity`
list to keep any specific record out of a bulk run without editing the
script.

The one Test backfill candidate carries no stale-data flag (unlike
Production's, below) — it is ordinary Test-environment data, and Test
carries no historical PB-D55 disclaimer against it. Applied:

```
node scripts/inv70-repairs-migration.cjs --selector test --credential-file ../.env.test --apply
```

Result: PUT → `200`; readback observed `20000`, matching sent. A follow-up
dry run confirms the write: `backfillCandidates: 0`, `alreadyAuthoritative:
1` (`matchesContact: true`), `nothingToDo: 1`. **This is the one GHL
mutation this phase actually performed** — Test-only, exactly the class of
action this phase's safety rule permits without further confirmation
("Apply safe Test backfills only").

**Production — not re-run this session (same credential blocker as
Objective 1).** The last read-only evidence on record remains Phase 2
correction round 1's: 43 total Opportunities, 1 backfill candidate, 1
conflict, 41 nothing-to-do.

- **The conflict, untouched, per explicit instruction:** opportunity
  `OcGWOP9n666i4Q1MLd31` — Opportunity `repair_estimate = 10000`, linked
  Contact `estimated_repairs = 30000`. The Opportunity value is already
  authoritative per the approved ruling and is never written to by this or
  any other script here; this remains a human-review item, not something
  this document or its tooling resolves.
- **The backfill candidate, explicitly classified, per this phase's
  instruction:** opportunity `1AP9BfFPJ2xYZ0RPTm9U` (Contact repairs
  `15000`, Opportunity empty) is the SAME record this document's Family 5
  section already cross-references as PB-D55's disclaimed stale
  calculator-test data (`offer_price 245001`, `offer_mao 245000.5`,
  `offer_margin -0.5`, "a calculator test that persisted, not a real
  deal"). **Classification: stale test data, not a real deal — the same
  disposition PB-D55 already gave it for the offer_* family.**
  **Retirement (excluding it from any repairs backfill) is safer than
  migration.** Backfilling `15000` into its `repair_estimate` would make
  an already-known-fake Production record LOOK like it carries a real,
  authoritative Opportunity-side repairs figure — exactly the kind of
  contamination Board 8/9 economics and any future reporting are supposed
  to be able to trust an Opportunity-owned field NOT to contain. Leaving
  the field empty preserves a legible "no data" signal on a record already
  flagged as non-representative; a future decision to archive or
  explicitly tag this opportunity as test data (a larger, separate
  decision than this phase's scope) is not foreclosed by leaving it empty
  today, whereas backfilling it would need to be UN-done first. This
  candidate is therefore excluded from any Production backfill this
  document recommends, via the same `--exclude-opportunity
  1AP9BfFPJ2xYZ0RPTm9U` mechanism the Test run above did not need. **No
  Production write occurred or is recommended without this exclusion.**
- `contact.estimated_repairs` remains read-only from every application
  code path (Phase 2 correction round 3), unchanged this phase, and stays
  that way — this phase's own instruction is explicit that it stays
  read-only "until every value and conflict has a safe disposition," and
  the Production conflict above does not yet have one.

### Objective 3 — Legacy `offer_*` dependency audit

New script: `scripts/inv70-offer-fields-dependency-audit.cjs` — read-only
(GET only, no `--apply` flag exists because it performs no mutation of any
kind). For all fourteen Family 5 fieldKeys plus `contact.estimated_repairs`
(needed for the Objective 4 gate below), it: (1) resolves each field's live
GHL record by `fieldKey`, never by hardcoded id; (2) pages every Contact
and every Opportunity once, counting populated values per field in a
single pass; (3) fetches the Workflows list and reports, as an explicitly
weak, non-conclusive signal, whether "offer" appears as a name substring
(GHL's v2 API does not expose workflow TRIGGER configuration — confirmed
on the wire in an earlier IAOS session — so this can never be more than a
name-collision heuristic); (4) attempts Forms, Surveys, and Funnels list
endpoints and reports the literal HTTP result.

**Test — run in full, 2026-09-11 (`.env.test` credential, 4 Contacts / 2
Opportunities scanned — full coverage, not sampled):**

| fieldKey | id (Test) | dataType | populated count |
|---|---|---|---|
| `contact.offer_price` | `oUJHAbPq7tcw67U2Q5Zx` | NUMERICAL | 0 |
| `opportunity.offer_price` | `xjPRKyyzKvPibg9iutmQ` | NUMERICAL | 0 |
| `contact.offer_mao` | `uwANCq7HLT1BuOSGfSOu` | NUMERICAL | 0 |
| `opportunity.offer_mao` | `0Q31sQlUhWxbhGEtFdQ3` | NUMERICAL | 0 |
| `contact.offer_wholesale_fee` | `XEGpmThEZVCZ0Zo8v5iW` | NUMERICAL | 0 |
| `opportunity.offer_wholesale_fee` | `gHrAmtFAOag95Zvay3Wa` | NUMERICAL | 0 |
| `contact.offer_repair_total` | `G3qYa7TSwvKLI4uZJ2XA` | NUMERICAL | 0 |
| `opportunity.offer_repair_total` | `5mmCNT6zM5tGNeAQutbW` | NUMERICAL | 0 |
| `contact.offer_margin` | `beRhLuaz9QRDs0qdwqkU` | NUMERICAL | 0 |
| `opportunity.offer_margin` | `v5Cfdz3odamvyKA3Udpn` | NUMERICAL | 0 |
| `contact.offer_arv` | `VQaObD0PsDjPbsEknHK5` | NUMERICAL | 0 |
| `opportunity.offer_arv` | `2zjZh6Ma4DQX77UBWgCN` | NUMERICAL | 0 |
| `contact.offer_date` | `bNGoqaqvUlhCkbacDarB` | DATE | 0 |
| `opportunity.offer_date` | `Gle5K6Um2FYw1TZZ0Art` | DATE | 0 |
| `contact.estimated_repairs` (Family 3, reference only) | `SU4n8ylrXnUm8xDi729R` | MONETORY | 1 |

All fourteen offer_* fields still exist in Test at the ids this document
already recorded, confirmed live, zero drift. All fourteen carry **zero**
populated values in Test — a fresh re-confirmation of Phase 2's own
finding, not merely a carry-forward.

**Workflows, Forms, Surveys, Funnels — all `401`, Test:**

```
workflows: HTTP 401 "The token is not authorized for this scope."
forms:     HTTP 401 "The token is not authorized for this scope."
surveys:   HTTP 401 "The token is not authorized for this scope."
funnels:   HTTP 401 "The token is not authorized for this scope."
```

This is a **new finding**, distinct from this project's standing GHL
reference note (which recorded Workflows as a *granted, read-only* scope
— apparently true for at least one of the two Private Integration tokens
in this account, but demonstrably **not** the Test token exercised here).
Forms/Surveys/Funnels were already expected to fail (never listed as a
granted scope for either token) and did. **None of these four surfaces
could be inspected for Test this session — the result is INCONCLUSIVE,
not "zero dependencies," for every one of the fourteen fields, on this
axis.**

**Production — not run this session (same credential blocker as
Objectives 1 and 2).** No Production customFields listing, no Production
populated-value scan, no Production Workflows/Forms/Surveys/Funnels check.

### Objective 4 — Controlled cleanup: no field deleted, in either environment

**Per-field disposition, recorded before any deletion was considered, per
this phase's own ordering requirement:**

| fieldKey | environment(s) checked | model | populated values | live app reader/writer | GHL dependency check | disposition |
|---|---|---|---|---|---|---|
| `contact.offer_price` | Test | Contact | 0 (Test) | **YES** — see below | inconclusive (401) | **RETAIN** |
| `opportunity.offer_price` | Test | Opportunity | 0 (Test) | none found | inconclusive (401) | retained (audit incomplete) |
| `contact.offer_mao` / `opportunity.offer_mao` | Test | both | 0 (Test) | none found | inconclusive (401) | retained (audit incomplete) |
| `contact.offer_wholesale_fee` / `opportunity.offer_wholesale_fee` | Test | both | 0 (Test) | none found | inconclusive (401) | retained (audit incomplete) |
| `contact.offer_repair_total` / `opportunity.offer_repair_total` | Test | both | 0 (Test) | none found | inconclusive (401) | retained (audit incomplete) |
| `contact.offer_margin` / `opportunity.offer_margin` | Test | both | 0 (Test) | none found | inconclusive (401) | retained (audit incomplete) |
| `contact.offer_arv` / `opportunity.offer_arv` | Test | both | 0 (Test) | none found | inconclusive (401) | retained (audit incomplete) |
| `contact.offer_date` / `opportunity.offer_date` | Test | both | 0 (Test) | none found | inconclusive (401) | retained (audit incomplete) |
| `contact.estimated_repairs` | Test + Production (Phase 2) | Contact | 1 (Test), unknown current count (Production) | read-only legacy fallback, by design | not run | **RETAIN — Production conflict unresolved, explicit instruction** |

**Why nothing was deleted, even in Test, even for the thirteen fields with
zero live application readers and zero populated Test values.** This
phase's own gate requires, among other conditions, "zero GHL workflow/form/
template dependencies are verified" before a field may be deleted, and "if
dependency inspection is unavailable or inconclusive, do not delete that
field — report the blocker." Workflows/Forms/Surveys/Funnels inspection
returned `401` — unavailable, not zero — for every one of the fourteen
fields, in Test, the only environment reachable this session. **This is a
structural blocker independent of the Production-credential permission
issue above**: even with full Production access, the SAME 401s would very
likely recur there (Forms/Surveys/Funnels were never a granted scope for
either token per this project's own GHL reference notes), and Production's
own Workflows scope status is unconfirmed. Clearing this blocker requires
either (a) Brad granting the Private Integration token(s) the Workflows/
Forms/Surveys/Funnels read scopes GHL exposes, or (b) a human, GHL-UI-side
manual inspection substituting for the API check, explicitly recorded as
such — neither of which this agent can do unilaterally.

**`contact.offer_price` carries a second, independent reason to retain it,
unrelated to the above.** Phase 3's audit (prompted by "populated record
values… inspect read-only dependencies") led to re-checking every
application code path, not just `app/src` (Phase 2's own writer-retirement
test was scoped to `app/src` only) — and found `app/netlify/functions/lib/
contact-parse.ts` still resolves `FIELDS.offerPrice` and maps it onto
every parsed Contact's `offerPrice` property, which `Dashboard.tsx`'s
"Offers to review" tile actively filters on (`c.offerPrice != null`). This
is a genuine, functioning, documented feature — detecting a saved-but-
unsent MAO offer — not dead code, even though the FIELD's WRITER
(`MaoCalculator.tsx` / `saveOfferFields`) was correctly retired in Phase 2.
**`contact.offer_price` fails this phase's "zero live application
readers/writers" gate on its own, independent of the GHL-dependency
question above**, and must be retained regardless of how the
Workflows/Forms/Surveys/Funnels blocker eventually resolves. Pinned by a
new test section, `test-legacy-offer-fields-retired.cjs` §9 (4 checks,
FLOOR 10 → 14): confirms the reader still exists in both
`contact-parse.ts` and `Dashboard.tsx`, and confirms none of the other
thirteen `offer_*` stems has ever been promoted to a named
`ghl-config.ts` key (so this exception is provably scoped to exactly one
field, not a sign of a wider audit gap).

**Shared configuration / test cleanup.** Objective 4 also asked to "remove
any remaining unused legacy IDs/readers from IAOS shared configuration and
tests." Audited: `app/shared/ghl-config.ts` carries exactly one config key
touching the fourteen-field family — `fields.offerPrice` — and it is not
unused (see immediately above). None of the other thirteen fieldKeys was
ever promoted to a named config key at all (confirmed by the new test
check); their only appearances anywhere in this repository are this
document's own historical record and the two already-existing test files
that prove the writer's retirement. **There is nothing to remove.** No
edit was made to `ghl-config.ts` this phase.

**Constraints honored, restated:** `contact.estimated_repairs` was not
deleted (Production conflict unresolved). No intentional Contact seed for
ARV or Asking Price was touched or evaluated for deletion — out of this
objective's scope by explicit instruction, and this phase made no such
attempt. No field was deleted in Test without first being eligible for
Production (moot this session — none was eligible in either environment).

---

### Phase 3 correction (this revision) — Production provisioned, Dashboard dependency closed, deletion still blocked

Brad explicitly authorized this agent's use of the repository-root `.env`
Production credential for INV-70's approved scripts, confirmed Production
opportunity `1AP9BfFPJ2xYZ0RPTm9U` as the safe inert-proof fixture, and
reported both integrations now carry the required read-only dependency
scopes. What actually changed, verified live, is recorded here rather than
rewriting Objectives 1–4 above (which remain the accurate record of the
first, blocked attempt).

**Objective 1 — done.** `inv70-create-current-offer-field.cjs` against
Production: dry run confirmed no existing "Current Offer" field/fieldKey
clash; `--apply` created it. **Production `opportunity.current_offer`:
id `yZgEdTOvppmmCvv8kx9n`, NUMERICAL, Opportunity Details folder
`FQJ2zGEAIJu0JA9NubCL`** (resolved live from `opportunity.
arv_after_repair_value`'s own `parentId`, the same mechanism Test's field
used). `POST` returned `201`; the immediate readback matched. `PRODUCTION.
opportunityFacts.currentOffer` in `app/shared/ghl-config.ts` now carries
this id, replacing `CURRENT_OFFER_NOT_PROVISIONED`.

**Objective 2 (of this correction) — done.** New
`scripts/inv70-current-offer-inert-proof.cjs`: hardcodes the confirmed
location and opportunity id (refuses to run against any other pair — no
flag widens this), then runs precheck → write → verify → restore →
final-verify, gated at every step. Result against
`1AP9BfFPJ2xYZ0RPTm9U`: field absent before (KEY_ABSENT) → wrote `999999`
→ readback confirmed `999999` → restored via `field_value: ""` (the
OBSERVED clear convention `inert-proof-opp-asking-price-step4.cjs`
already established) → final readback confirmed KEY_ABSENT again.
**`restoredToOrigin: true` — no residual value.** Full step-by-step JSON
evidence is this script's own stdout; not separately reproduced in this
document beyond the summary above.

**Objective 3 — re-run against Production, unchanged from Phase 2/3's
prior evidence.** Repairs: 43 total, 1 backfill candidate (`1AP9BfFPJ2xYZ0RPTm9U`,
still classified stale-test / retirement-not-migration per the reasoning
above — NOT applied), 1 conflict (`OcGWOP9n666i4Q1MLd31`, still `10000`
vs `30000`, **untouched** — Objective 7's "never overwrite" constraint
holds by construction: this script's `--apply` structurally refuses any
selector other than `test`). Offer-fields audit: all fourteen fields
confirmed live at their recorded Production ids; **thirteen of the
fourteen now show exactly one populated value each — ALL on the SAME
already-disclaimed stale record** (`contactId FiIT0hUaxVCIuokQpZuc` /
`opportunityId 1AP9BfFPJ2xYZ0RPTm9U`: `offer_price 245001`, `offer_mao
245000.5`, `offer_wholesale_fee 5000`, `offer_repair_total 0`,
`offer_margin -0.5`, `offer_arv 250000.5`, `contact.offer_date` one
timestamp) — `opportunity.offer_date` is the sole field with zero
populated values. `contact.estimated_repairs`: 2 populated (`30000` on
the conflict contact, `15000` on the same stale-test contact).

**Objective 4 (dependency inspection) — PARTIALLY, NOT FULLY, unblocked.
This is reported precisely because it does not match what was
represented.** Re-running the audit found:

| surface | Test | Production |
|---|---|---|
| Workflows | still `401` — "The token is not authorized for this scope" | **now `200`** — 38 workflows fetched |
| Forms | still `401` | still `401` |
| Surveys | still `401` | still `401` |
| Funnels (GHL's Funnels/Websites builder is one product/scope — there is no separate "Websites" API resource to check independently) | still `401` | still `401` |

**Only Production's Workflows scope was actually added.** Forms, Surveys,
and Funnels/Websites remain uninspectable via this token in BOTH
environments, and Test's own Workflows access is still `401`. This is
stated plainly because the correction's own text asserted "the required
read-only dependency scopes" were now present on both integrations, and
that is not what was observed on the wire — the discrepancy is reported,
not silently reconciled or assumed away.

Production's newly-available Workflows list (38 workflows) was checked
for the same weak, non-conclusive name-substring signal this document
already caveats: **one hit** — a published workflow named "Seller 7 -
Offer Sent" (id `9b63147a-ad8f-4418-bc42-8905cc6649c3`). This is a
workflow whose NAME concerns the offer-sent moment; it is NOT evidence
that any of the fourteen `offer_*` CUSTOM FIELDS is a trigger or action
target inside it — GHL's v2 API still does not expose workflow trigger/
action configuration (confirmed again on the wire this round: the same
gap this document has recorded since 2026-07-21). Absent that visibility,
this hit can be neither cleared nor confirmed as a real dependency.

**Objective 5 — done.** `contact.offer_price` is no longer an
authoritative live reader anywhere in this application:
- `netlify/functions/lib/contact-parse.ts` no longer resolves
  `FIELDS.offerPrice` or maps it onto `ContactRow`.
- `app/src/lib/ghl.ts`'s `ContactRow` interface no longer declares an
  `offerPrice` field.
- `Dashboard.tsx`'s "Offers to review" tile (`offersToReview`) now derives
  "has an offer" from **`opportunity.current_offer`** — Family 5's
  approved, Opportunity-owned carrier — read via `current-offer-carrier.ts`'s
  `readCurrentOfferFromOpportunity` against `pipeline.opportunities`,
  data this page already fetches (`ghl.opportunities.listPipeline()`,
  unfiltered `customFields` pass-through). The same "not yet `offer-made`
  tag" exclusion is preserved unchanged — only the SOURCE of "has an
  offer" moved. **No new write of any kind was introduced** — the tile
  remains strictly read-only, correlating two already-fetched datasets by
  `contactId`; no mirrored Contact write was added, per the correction's
  explicit instruction.
- The now-fully-unused `fields.offerPrice` config key is removed from
  `app/shared/ghl-config.ts` (interface and both environment maps). The
  GHL field itself, `contact.offer_price`, is untouched in both
  environments — only the application-side pointer and reader are gone.
- Pinned by `scripts/test-legacy-offer-fields-retired.cjs` §9, REWRITTEN
  (not merely extended) to prove the corrected state: the old reader is
  gone, the new one exists and is correctly shaped, no new write exists,
  and the config key is gone (FLOOR 14 → 21).

**Objective 6 — re-evaluated; conclusion unchanged, for a narrower
reason.** With `contact.offer_price`'s independent live-reader
disqualification now resolved, every one of the fourteen fields'
disposition now turns on ONE remaining axis: GHL-side dependency
inspection. That axis is still incomplete — Forms/Surveys/Funnels remain
`401` in both environments (Objective 4 above) — which is, by this
document's own explicit rule, sufficient on its own to block deletion of
every one of the fourteen fields, regardless of how clean their
populated-value picture is. Separately, thirteen of the fourteen fields
now carry a populated (if already-disclaimed-as-stale) value in
Production, which is a second, independent reason none of them yet clears
"zero legitimate populated values" as cleanly as Test's all-zero picture
does — a question this document flags for Brad/Jess rather than resolving
unilaterally: does a value already disclaimed as non-representative test
data count as "zero legitimate populated values," or does its mere
presence block deletion regardless of legitimacy? This session did not
need to answer that question, because the Forms/Surveys/Funnels blocker
alone is already dispositive.

**Objective 7 — honored.** The Production conflict
(`OcGWOP9n666i4Q1MLd31`, `10000` vs `30000`) was read this session but
never written to — confirmed by the repairs-migration script's own
structural refusal of `--apply` for any selector other than `test`, and
by the dry-run-only invocation actually used.

**Objective 8 — no field deleted, in either environment, this round
either.** The gate is not clearer, only narrower: Workflows are now
inspectable in Production (with one non-conclusive name-hit), but Forms/
Surveys/Funnels remain unavailable everywhere, and Test's Workflows
access is unchanged. **Clearing this fully requires either (a) the
Forms/Surveys/Funnels scopes actually being granted (Workflows read
access for Test as well), or (b) a human, GHL-UI-side manual inspection
of these surfaces for all fourteen fieldKeys, explicitly recorded as
substituting for the API check** — neither of which this agent can do
unilaterally. No GHL field was deleted, no delete request of any kind was
issued, in either environment.

**GHL mutations this correction round, in full:** one field created
(Production `opportunity.current_offer`), one inert-proof write+restore
cycle against the confirmed-safe fixture (net effect: no residual value),
and the read-only re-audits above. No other write. No delete.

---

## Inventory summary

**Live GHL Test location (`SoTgVoaFGHtBdRFvXWQV`) read-only GET:**

- `GET /locations/{id}/customFields` → **109 Contact custom fields**
- `GET /locations/{id}/customFields?model=opportunity` → **16 Opportunity
  custom fields**
- Cross-checked via `GET /locations/{id}/customFields?model=all` →
  **125 total**, exactly 109 + 16 — confirming the two narrower calls are
  neither double-counting nor dropping anything between them
- Every returned object carries `documentType: "field"` on all three
  calls (109/16/125 of 109/16/125, respectively) — **folders are never
  mixed into these arrays**; a folder's name is resolved separately, by a
  singular `GET /locations/{id}/customFields/{parentId}` per distinct
  `parentId`, which is exactly how this document's folder list was built
- No pagination metadata (`nextPage`, cursor, `meta`) appears in any of
  the three responses — each returned exactly `{customFields: [...],
  traceId}`, so the full set was captured in one call each, not a first
  page of more
- 8 folders resolved by parentId (6 Contact-model: Additional Info, IAOS
  Onboarding, General Info, Offer, Contact, Form | IAOS Client Intake
  Form; 2 Opportunity-model: Offer, Opportunity Details)

---

### Field-count reconciliation (correction round 1)

**The reported discrepancy — 124 Contact / 26 Opportunity vs. this
document's 109 / 16 — is not a defect in this document's method. It is a
comparison between two different things: CUSTOM fields (what this
document counts) against a CUSTOM-plus-NATIVE mixture using a stale
snapshot, with one figure mislabeled to the wrong GHL object.**

**Where 124 comes from, reproduced exactly:**

    98  (custom Contact fields, Production, dated 2026-08-12)
  + 26  (native/top-level Contact record keys, dated 2026-07-22/07-24)
  ------
  124

- **98** is a real, dated figure — `docs/CONTACT_FIELD_REFERENCE.md:16-17`:
  *"Date observed: 2026-07-22; re-observed live 2026-08-12 (PB-D53 step
  5) — Previous Phone and Phone Status added, total 96 → 98... Total
  custom fields: 98."* This is Production (`jmHG4B8RdzwpfqruNf68`, same
  file line 15), and it is now **stale by this document's own live
  re-read**: Production custom Contact fields have since grown 98 → 101
  (confirmed live this correction round, below) — a real field count at
  the time it was written, superseded twice since (98 → 101, and Test
  separately now carries 109).
- **26** is a real, correctly-documented figure too — but it is the count
  of **native, top-level keys on a CONTACT record** (`id`, `dateAdded`,
  `firstName`, `tags`, `customFields`, etc.), **not** a custom-field count
  and **not** an Opportunity figure at all. Two independent citations
  agree on it exactly: `docs/CONTACTS_DETAIL_SPEC.md:108` ("26 top-level
  keys: id, dateAdded, type, locationId, lastName...") and
  `docs/CONTACTS_OPPORTUNITIES_SPEC.md:308` ("NATIVE fields — 26
  top-level keys present on the bradt75 record").
- **Reconciliation:** `98 + 26 = 124` exactly. The "124 Contact" figure in
  the earlier inspection appears to be a custom-plus-native total built
  from a since-superseded custom-field snapshot. **The "26 Opportunity"
  figure is the same native-Contact-key count (26), applied to the wrong
  GHL object** — nothing in this session's live Production or Test read,
  and nothing in any document searched (`grep -rn "124" docs/*.md` — no
  match for the figure 124 anywhere in the documentation set), supports
  26 as an Opportunity-model quantity of any kind. Opportunity custom
  fields are independently confirmed at **16 in both Production and Test**
  (below) — the same number this document originally reported, unchanged.
- **This document's own count method, restated for clarity:** it counts
  only objects with `documentType: "field"` returned by the two
  model-scoped custom-field endpoints — never native record keys, never
  folders, never Custom Values (a distinct GHL object type, covered
  separately in Family 8). That is the correct scope for "GHL Contact and
  Opportunity custom field" inventory as the rollover brief defines it,
  and it is the scope this correction round preserves.

---

### Production vs. Test comparison (correction round 1)

**Read-only GET, IAOS Production (`jmHG4B8RdzwpfqruNf68`), this
correction round**, using the credential in the repository root's `.env`
(confirmed by a single read-only probe call to return HTTP 200 against
Production, distinct from `app/.env`'s credential, which returned
`HTTP 403 "The token does not have access to this location"` against
Production — recorded so a future session does not assume `app/.env`'s
key is Production-scoped merely because `IAOS_ENV=production` is set
there; the runtime selector and the credential's own GHL-side scope are
two independent facts).

- `GET /locations/jmHG4B8RdzwpfqruNf68/customFields` → **101 Contact
  custom fields** (up from the 98 recorded 2026-08-12, confirming organic
  growth, not a discrepancy in method)
- `GET /locations/jmHG4B8RdzwpfqruNf68/customFields?model=opportunity` →
  **16 Opportunity custom fields** — identical count to Test
- 8 folders resolved, same 6 Contact-model / 2 Opportunity-model split as
  Test

**Full cross-environment diff, by `fieldKey` (the only stable identifier
across environments — numeric ids are location-specific by design):**

| | Count |
|---|---|
| Distinct `fieldKey`s across both environments | 125 |
| Present in **both** Production and Test | **117** |
| Present in Test **only** | 8 |
| Present in Production **only** | 0 |
| Of the 117 shared keys, with a `dataType` or folder mismatch between environments | **0** |

**The 8 Test-only fields, none relevant to any of the nine families:**
`contact.appointment_scheduled` (CHECKBOX), `contact.business_name`
(TEXT), `contact.contact_source` (TEXT), `contact.how_often_do_you_
normally_workout` (RADIO), `contact.interested_service`
(SINGLE_OPTIONS), `contact.optinlead` (TEXT), `contact.video_1_watched`
(CHECKBOX), `contact.video_2_watched` (CHECKBOX) — onboarding/intake-form
and miscellaneous fields, several bearing no relation to real estate
wholesaling at all (the workout question), consistent with Test carrying
extra template/demo fields Production does not. **This fully accounts for
the raw-count difference**: Production 101 + 16 = 117 total custom
fields; Test 117 (matching) + 8 (Test-only) = 125 total — arithmetic
closes exactly, with zero unexplained remainder.

**Every one of the 30 fields named across this document's nine families
was checked individually. All 30 exist in both environments, under the
identical `fieldKey`, `dataType`, and folder name — only the numeric GHL
id differs per environment, which is expected and by design.** No
semantic (type or folder) drift exists between Production and Test for
any field this document discusses. The full id pairs are already recorded
in each family's table below (Prod / Test), each entry independently
re-verified against this correction round's live Production pull.

**One material finding from this comparison: Family 6's open question is
now resolved** — see the updated Family 6 section below.

**Duplicate/near-duplicate families identified: 9** (named families 1–7
below, matching the rollover's list, plus 2 additional families this
document adds per its "do not assume the list is complete" instruction:
Closing Costs field-vs-value naming collision, and Contact-side deal-
economics fields sitting outside the stated ownership rule).

**Already fully resolved, no blocking decision remaining (updated this
correction round): 5 of the 9** — ARV (1), Asking Price (2), Seller MAO
(4), Assignment Fee Target (7), and — newly resolved this correction
round — Wholesale Fee Percent (6). Two of these (ARV, Asking Price) have
a **clean, working canonical/seed pattern already in production use**;
the other three had an apparent duplicate or open question that this
document's own evidence (and, for Family 6, this correction round's
Production read) closes outright. **2 of the 9 remain genuinely
blocking** (Repairs, Family 3; the presented-offer family, Family 5) —
see "Blocking vs. non-blocking decisions" below. **The remaining 2 of the
9** (Closing Costs naming collision, Family 8; the legacy Contact
economics fields, Family 9) are non-blocking, no-conflict follow-up
items, not open duplicates.

**Fields requiring migration or a backfill decision: 1 confirmed
(Repairs)**, with a second (the "presented offer" family, 14 fields)
pending a prior architecture decision (Current Offer / negotiation-state
carrier) before migration planning is even possible.

**Immediate integrity finding, unrelated to duplication:** the entire
7-key "presented offer" `offer_*` family (14 field ids: 7 keys × 2 models)
exists as **hardcoded literals inside `app/src/pages/MaoCalculator.tsx`**
and is **not present in `app/shared/ghl-config.ts`** at all — a direct
exception to PB-D51's rule that "identifiers move into the shared
configuration module rather than being copied from this file into call
sites" (`docs/UNDERWRITING_FIELD_REFERENCE.md:12-16`). This predates
INV-70 and is recorded here because it bears directly on canonicalization:
one of these 14 ids cannot be found by grepping `ghl-config.ts`, which is
exactly the blind spot that lets a duplicate go unnoticed.

---

## Family 1 — ARV / After Repair Value

**Status: RESOLVED pattern, already in production use. REUSE.**

| Candidate | Object | Key | ID (Prod / Test) | Type | Folder |
|---|---|---|---|---|---|
| ARV (deal authority) | Opportunity | `opportunity.arv_after_repair_value` | `cBkygqcHRseZUGCYYeba` / `ppe2ZTO7DJTMao74xvYI` | NUMERICAL | Opportunity Details |
| ARV (seed) | Contact | `contact.arv` | `wMBTGWMs97yysQFx7Vad` / `QkWl09I9yXGz8OIcs5Xd` | MONETORY | Additional Info |
| Offer ARV | Contact | `contact.offer_arv` | `Z88Y6IqCK1i7hObZcrQM` / `VQaObD0PsDjPbsEknHK5` | NUMERICAL | Offer |
| Offer ARV | Opportunity | `opportunity.offer_arv` | `Nm1LZvQzaCGvXDq7TRCh` / `2zjZh6Ma4DQX77UBWgCN` | NUMERICAL | Offer |

**Ruling (PB-D55, restated from `docs/BOARD8_ECONOMICS_INVENTORY_V1.md`
"ARV" row):** Opportunity owns underwriting ARV once approved; Contact
`arv` is a one-time seed consulted only when the Opportunity field is
absent, never re-consulted once approved underwriting is written, never
mirrored back. **Readers:** `parseOpportunityValues` / `parseContactSeeds`
(`app/src/lib/underwriting/resolver.ts:224-272`), `resolveDealFacts`
(`resolver.ts:312-333`). **Writer:** `setApprovedArv`
(`app/src/lib/ghl.ts:933-965`), gated by `arvPersistGate` and recorded by
`persistApprovedArv` (`app/src/lib/arv-persist.ts:48-146`), wired into
`app/src/components/ArvCompsWorkspace.tsx`. **Inert-proofed** in IAOS Test,
2026-09-04, PB-D62.

**The two `offer_arv` fields are a distinct fact** ("presented offer," see
Family 5) — not part of this canonicalization, but listed here because the
name collision is exactly the kind of thing a superficial grep would
conflate with deal-authority ARV.

**Proposed canonical carrier:** `opportunity.arv_after_repair_value`
(already canonical; no change proposed). **Retirement candidates:** none
— `contact.arv` remains a legitimate, intentional seed, not dead weight.
**Conflict-handling rule (already in force):** Opportunity value, once
written, is permanent; Contact fallback is consulted only when Opportunity
is absent, and is never used to overwrite. **Compatibility/rollback
risk:** none identified — this pattern is live and proven.
**Unresolved questions:** none for this family specifically.

---

## Family 2 — Asking Price

**Status: RESOLVED pattern, already in production use. REUSE.**

| Candidate | Object | Key | ID (Prod / Test) | Type | Folder |
|---|---|---|---|---|---|
| Asking Price (deal authority) | Opportunity | `opportunity.asking_price` | `YxCDaX7dLhBJL9GLGFpJ` / `owIOWnJuIheiwJVdJWQ5` | NUMERICAL | Opportunity Details |
| Asking Price (seed) | Contact | `contact.asking_price` | `60UCjsYT1Ak3Kyy5ZCL8` / `Oeo3jPhh3ICnU7Cv1iTT` | MONETORY | Additional Info |

**Ruling:** identical seed-then-supersede pattern to ARV
(`docs/PHASE_B_SPEC.md:1787-1797`, PB-D55). **Writer (Opportunity):**
`setAskingPrice`, inert-proofed PB-D60, 2026-08-29
(`docs/UNDERWRITING_FIELD_REFERENCE.md:85`). **Contact-side note, exact
as recorded:** PB-D35 designated `contact.asking_price` for its own
inert-proof cycle (2026-08-04) and `docs/FIELD_REGISTER.md:23` records its
write column as "Proven" while also noting "no UI editor and no named
setter" — i.e. the field was proven writable via the inert-proof harness,
but no standing application write path exists for it today. This is not a
contradiction this document resolves; it is restated exactly as found.

**Proposed canonical carrier:** `opportunity.asking_price` (already
canonical). **Retirement candidates:** none. **Conflict-handling rule:**
same as ARV. **Compatibility/rollback risk:** none identified.

---

## Family 3 — Repairs / Estimated Repairs / Repair Estimate

**Status: OPEN GAP — the aspirational canonical carrier has no writer, and
the field actually operative in production differs from the one the
architecture names as authoritative. This is the clearest real instance of
the condition INV-70 exists to catch.**

| Candidate | Object | Key | ID (Prod / Test) | Type | Folder |
|---|---|---|---|---|---|
| Repair Estimate (named deal-authority carrier, PB-D55) | Opportunity | `opportunity.repair_estimate` | `hId4Yog6u5GP1Iwz1aNx` / `lSWxFUmWksfrViePG4UC` | NUMERICAL | Opportunity Details |
| Estimated Repairs (actually-operative carrier) | Contact | `contact.estimated_repairs` | `OQnud97MfdxMcTgMVTgf` / `SU4n8ylrXnUm8xDi729R` | MONETORY | Additional Info |
| Offer Repair Total | Contact | `contact.offer_repair_total` | `2EpRGXb8rj4RtHfFhYbB` / `G3qYa7TSwvKLI4uZJ2XA` | NUMERICAL | Offer |
| Offer Repair Total | Opportunity | `opportunity.offer_repair_total` | `XbW0B973nuaLtIjMkzO9` / `5mmCNT6zM5tGNeAQutbW` | NUMERICAL | Offer |

**The gap, exact, restated from `docs/BOARD8_ECONOMICS_INVENTORY_V1.md`
"Repairs" row (lines 44-58):** `opportunity.repair_estimate` is PB-D55's
named Opportunity-side deal-authority carrier, but it has **no writer,
verified absent** — `Grep "setRepairEstimate\|repair_estimate\|
opportunityFacts.repairs"` against `app/src/lib/ghl.ts` returns no
matches, independently corroborated by `docs/UNDERWRITING_FIELD_
REFERENCE.md:84` ("Inert proof: none, Named writer: none"). The field
Board 6's repair estimator actually approves and writes to is
`contact.estimated_repairs`, via named writer `setEstimatedRepairs`,
gated by `persistGate` (`app/src/lib/repair-estimation/persist.ts:47-65`,
Board 6 / INV-13). Because `resolveDealFacts`'s seed-then-supersede path
(`resolver.ts:327`) reads Opportunity first and Contact only when
Opportunity is absent, and Opportunity is **never populated because
nothing writes it**, **Contact `estimated_repairs` is, in practice, the
repairs figure underwriting resolves from today for every deal** — not a
seed-and-forget convenience as designed, but the sole operative path.

**Readers:** `resolver.ts:327` (seed-then-supersede),
`app/src/lib/seller-call-readiness-inputs.ts:20-23` (explicitly comments
on this exact gap), `app/scripts/test-seller-call-workspace-wiring.cjs:
568-570` (test asserts the Contact-side wiring specifically because
`repair_estimate` "has no writer"), `app/src/pages/UnderwritingWorkspace.
tsx:546,764,773,811`, `app/src/pages/DealCalculator.tsx:82`,
`app/src/config/additionalInfoSubgroups.ts:70`. **Downstream consumer:**
Board 9's contract-facing `OutcomeSnapshot` (`app/src/lib/seller-call-
outcome.ts:67-76`) copies `repairs` verbatim at Agreement Reached — so
this gap's actual value silently flows into every Board 9 contract fact
snapshot today, sourced from Contact, not Opportunity.

**Related, distinct fact:** `offer_repair_total` (Contact and Opportunity)
is the "presented offer" snapshot (Family 5), not this family's deal
input — same dead-writer status as the rest of that family.

**Proposed canonical carrier:** does not choose between the two — **this
is exactly the kind of conflict this document must not silently resolve.**
Two live options, stated with their tradeoffs:
- **(a) Formally re-designate `contact.estimated_repairs` as canonical**
  for repairs, retire the aspirational role of
  `opportunity.repair_estimate` (leave the field in place, orphaned,
  documented as superseded — GHL field deletion is out of scope and risky
  per the existing "deliberate, time-boxed duplicate" precedent at
  `docs/PHASE_B_SPEC.md:2266-2276`). Lowest migration cost: zero data
  movement, zero new writer, matches what already runs in production.
  Breaks the "Opportunity owns deal economics" ownership rule as stated
  in the rollover, for this one fact, unless the rule is read to permit an
  Opportunity-first-then-Contact-seed pattern collapsing to Contact when
  Opportunity has no writer.
- **(b) Build the missing Opportunity-side writer** (a `setRepairEstimate`
  analogous to `setApprovedArv`/`setAskingPrice`) and migrate existing
  Contact `estimated_repairs` values onto the Opportunity carrier for
  every deal that has one, matching the ARV/Asking-Price pattern exactly.
  Higher cost (new writer, its own inert-proof cycle, a backfill pass
  deciding what happens to Contacts with no Opportunity), but brings
  Repairs into architectural parity with ARV and Asking Price and honors
  the ownership rule as written.

**Migration/backfill plan:** not proposed here — it depends entirely on
which of (a)/(b) is chosen, which is a product/architecture decision, not
a Phase 1 finding. **Conflict-handling rule:** N/A until (a) or (b) is
decided — no non-empty-value conflict currently exists because
Opportunity's copy is always empty (unwritten). **Compatibility/rollback
risk:** low for (a) (documentation-only); moderate for (b) (new write
path, its own inert-proof, and a backfill affecting every existing deal
that has both a Contact repairs value and a linked Opportunity).
**Unresolved question, explicit: which of (a)/(b) does Brad/Jess want?**
This is the single highest-value decision this document surfaces.

---

## Family 4 — Seller MAO vs. "Offer MAO" (two deliberately distinct facts, correctly separated — but the presented-offer half is dead code)

**Status: The distinction itself is RESOLVED and correct — restated, not
re-opened. The finding for INV-70 is about the presented-offer half, not
about Seller MAO.**

| Candidate | Object | Key | ID (Prod / Test) | Type | Folder |
|---|---|---|---|---|---|
| Seller MAO (underwriting output) | Opportunity | `opportunity.mao_max_allowable_offer` | `Atu5XCjpFElY8H64VG4h` / `ZfOljSm5fLFCFZhfi0ri` | NUMERICAL | Opportunity Details |
| Offer MAO (presented offer) | Contact | `contact.offer_mao` | `aAMFPmgxGZT422uGAQOx` / `uwANCq7HLT1BuOSGfSOu` | NUMERICAL | Offer |
| Offer MAO (presented offer) | Opportunity | `opportunity.offer_mao` | `9jm2SoN2aDtUtbesL0kG` / `0Q31sQlUhWxbhGEtFdQ3` | NUMERICAL | Offer |

**Ruling, exact, `docs/PHASE_B_SPEC.md:1748-1757`:** "`mao_max_allowable
_offer` and `offer_mao` are deliberately different numbers." Seller MAO
(`sellerMAO = endBuyerMaxPrice − assignmentSpread`, `compute.ts:176`) is
the underwriting ceiling; `offer_mao` is what was actually presented to
the seller, which the current architecture treats as a separate,
timestamped snapshot. **This is not a duplicate to merge.** **Writer
(Seller MAO):** `saveUnderwritingFields`
(`app/src/lib/ghl.ts:1107-1124`), one of exactly three approved
underwriting carriers. **Reader:** `app/src/lib/rail.ts:273` (persistent
call rail "Seller MAO" cell, live in `ContactWorkspace.tsx`).

**What IS a genuine open duplicate, inside the presented-offer half:**
`contact.offer_mao` and `opportunity.offer_mao` are the same fact on two
models, with **no declared canonical between them** — see Family 5, which
covers this and the other six `offer_*` keys together, since all seven
share one writer, one dead-code status, and one open question.

**Proposed canonical carrier (Seller MAO):** `opportunity.mao_max_allowable
_offer` (already canonical; no change proposed). **Unresolved questions:**
none for Seller MAO itself; see Family 5 for `offer_mao`.

---

## Family 5 — the "presented offer" family (`offer_price`, `offer_mao`, `offer_wholesale_fee`, `offer_repair_total`, `offer_margin`, `offer_arv`, `offer_date` — 7 keys × 2 models = 14 fields)

**Status: OPEN — a real Contact-vs-Opportunity duplicate with no declared
canonical, currently moot only because the sole writer is dead code.**

| Key | Contact ID (Prod / Test) | Opportunity ID (Prod / Test) | Type |
|---|---|---|---|
| `offer_price` | `v2VO2wUwTYRojmU7VXyZ` / `oUJHAbPq7tcw67U2Q5Zx` | `4YiACDV4uB3zOlAdNIBb` / `xjPRKyyzKvPibg9iutmQ` | NUMERICAL |
| `offer_mao` | `aAMFPmgxGZT422uGAQOx` / `uwANCq7HLT1BuOSGfSOu` | `9jm2SoN2aDtUtbesL0kG` / `0Q31sQlUhWxbhGEtFdQ3` | NUMERICAL |
| `offer_wholesale_fee` | `qYzkp66x87rG7Pbs36GP` / `XEGpmThEZVCZ0Zo8v5iW` | `GxChepYArmgPllhKPq0R` / `gHrAmtFAOag95Zvay3Wa` | NUMERICAL |
| `offer_repair_total` | `2EpRGXb8rj4RtHfFhYbB` / `G3qYa7TSwvKLI4uZJ2XA` | `XbW0B973nuaLtIjMkzO9` / `5mmCNT6zM5tGNeAQutbW` | NUMERICAL |
| `offer_margin` | `ec06A3RId4Isorc97jeQ` / `beRhLuaz9QRDs0qdwqkU` | `eY5BOqE9juGpBfqwacWT` / `v5Cfdz3odamvyKA3Udpn` | NUMERICAL |
| `offer_arv` | `Z88Y6IqCK1i7hObZcrQM` / `VQaObD0PsDjPbsEknHK5` | `Nm1LZvQzaCGvXDq7TRCh` / `2zjZh6Ma4DQX77UBWgCN` | NUMERICAL |
| `offer_date` | `SJ6x7OqUxTKg1ri8ltb7` / `bNGoqaqvUlhCkbacDarB` | `73oLHWnVjmOGSrBo5sC6` / `Gle5K6Um2FYw1TZZ0Art` | DATE |

(Prod ids for `offer_price`/`offer_mao`/`offer_wholesale_fee`/
`offer_repair_total`/`offer_margin` Contact-side are corroborated
independently by `docs/CONTACT_FIELD_REFERENCE.md:54-57` and
`docs/FIELD_REGISTER.md:47-52`; all 14 Prod ids and both Test folder
memberships are read directly from `app/src/pages/MaoCalculator.tsx:41-60`
and this session's live Test `GET /locations/{id}/customFields`.)

**Semantics, ruled (`docs/PHASE_B_SPEC.md:1748-1757`):** these fields
record "the offer prepared for and ultimately presented to a seller,"
distinct from underwriting outputs. **What is NOT ruled:** which of the
Contact copy or the Opportunity copy is authoritative when they disagree,
or why both need to exist at all if one writer sets both simultaneously.

**Writer, singular, currently dead:** `handleSave`
(`app/src/pages/MaoCalculator.tsx:1157-1193`) calls
`ghl.contacts.saveOfferFields` (`app/src/lib/ghl.ts:608`) and, when an
Opportunity is linked, `ghl.opportunities.saveOfferFields`
(`app/src/lib/ghl.ts:834`) — **writing all seven keys to both models in
one save, unconditionally overwriting, no history.** `MaoCalculator.tsx`
is **confirmed unrouted**: `grep -n "MaoCalculator" app/src/App.tsx`
returns no matches, corroborating `docs/BOARD8_ECONOMICS_INVENTORY_V1.md`'s
and `docs/PHASE_B_SPEC.md:2593-2595`'s independent findings that the page
was retired from navigation 2026-08-16. **This writer cannot currently
run through the live application.**

**Governing constraint, unchanged by this document:** `CONTACTS_
OPPORTUNITIES_SPEC.md §4.1` HARD NO — "Tags, pipeline stage, `offer_`
fields, workflow triggers... Editing a contact field is not a licence to
touch a tag, move a stage, or set an offer field" — and §5.2/§2.4: "the
seven `offer_` fields (GHL folder 'Offer') — never become editable" in
the general Contact field-edit surface. This bars the general editor from
ever touching these fields; it does not itself bar a purpose-built writer
(the now-dead `MaoCalculator.tsx` was exactly that kind of exception).

**Known stale data, restated for anyone who queries live records:**
`docs/PHASE_B_SPEC.md:1759-1771` records that opportunity
`1AP9BfFPJ2xYZ0RPTm9U` (Neelima Bale) is the one Production record
carrying `offer_*` test data (price 245001 vs. MAO 245000.5, margin −0.5)
— a calculator test that persisted, not a real deal. Not verified against
Test in this session; flagged so a future reader does not treat it as
evidence.

**Integrity gap, distinct from the duplication question:** all 14 ids
live only as literals in `MaoCalculator.tsx`, absent from `app/shared/
ghl-config.ts` — see "Inventory summary" above.

**Proposed canonical carrier:** none proposed. This family's disposition
is downstream of a decision `docs/BOARD8_ECONOMICS_INVENTORY_V1.md`
already named as a **REAL CARRIER GAP**: "Current Offer" / negotiation-
state (Part A, "Opening Offer / Current Offer / negotiation fields," and
Part B, "Current Offer"). Building or reviving a "presented offer" carrier
before that decision is made risks creating a second, competing
negotiation-state mechanism. **Recommendation:** treat this whole family
as frozen legacy pending the Current-Offer/negotiation-carrier decision;
do not build new consumers against either the Contact or Opportunity copy
in the meantime; when that decision is made, decide in the same pass
whether these 14 fields are retired (in favor of a new carrier), reused as
that carrier, or one of the two models is dropped in favor of the other.
**Retirement candidates:** all 14, contingent on the above — not proposed
for retirement by this document alone. **Migration/backfill plan:** none
proposed; depends on the above decision. **Compatibility/rollback risk:**
low today (writer is unreachable), but reviving `MaoCalculator.tsx`
without first resolving this would reintroduce a live, unreconciled
duplicate. **Unresolved questions:** (1) does the Current-Offer decision
retire, reuse, or replace this family; (2) if reused, which model
(Contact or Opportunity) is canonical between the two copies; (3) should
`MaoCalculator.tsx` be formally retired (deleted) rather than left as
reachable-if-re-routed dead code carrying 14 ungoverned field ids.

---

## Family 6 — Offer Wholesale Fee vs. Wholesale Fee Percent (two different facts, one orphaned; the historical-memory discrepancy is now RESOLVED)

**Status: fully resolved as non-duplicative. Correction round 1 closes
the one open question the original pass left here.**

| Candidate | Object | Key | ID (Prod / Test) | Type | Folder |
|---|---|---|---|---|---|
| Offer Wholesale Fee (presented offer, a dollar amount) | Contact | `contact.offer_wholesale_fee` | `qYzkp66x87rG7Pbs36GP` / `XEGpmThEZVCZ0Zo8v5iW` | NUMERICAL | Offer |
| Offer Wholesale Fee (presented offer, a dollar amount) | Opportunity | `opportunity.offer_wholesale_fee` | `GxChepYArmgPllhKPq0R` / `gHrAmtFAOag95Zvay3Wa` | NUMERICAL | Offer |
| Wholesale Fee Percent (a rate, not a dollar amount) | Opportunity | `opportunity.wholesale_fee_` | `RS2trZUHrZwaGxadLvHB` / `kRGt4FKC3bW2Kvgsyshw` | NUMERICAL | Opportunity Details |

**`offer_wholesale_fee` is part of Family 5** (presented offer) — same
writer, same dead-code status, same open question. Listed again here only
because its name is easy to confuse with the next field.

**`opportunity.wholesale_fee_` is orphaned, not a live duplicate of
anything.** `docs/PHASE_B_SPEC.md:2301-2305`: "`opportunity.closing_costs`
and `opportunity.wholesale_fee_` were read only by the two functions
retired 2026-08-13 and now have no consumer at all... either may be
deliberately assigned a meaning under this model rather than requiring
archaeology." `docs/UNDERWRITING_FIELD_REFERENCE.md:132-135` corroborates:
listed under "What is not here" (deal-override fields), a "candidate"
with no current reader.

**RESOLVED, correction round 1: the historical-memory discrepancy was a
model-label error, exactly parallel to Family 7's Assignment Fee Target
finding — not a deleted/renamed field, and not an inaccurate memory
about the id itself.** The original pass found no `contact.wholesale_
fee_`/`RS2trZUHrZwaGxadLvHB` in the live Test Contact inventory and left
open whether the field was gone or the memory was wrong, pending a
Production check that Test-only Phase 1 scope did not permit. **This
correction round's read-only Production pull (`GET /locations/
jmHG4B8RdzwpfqruNf68/customFields?model=opportunity`) finds id
`RS2trZUHrZwaGxadLvHB` live, today, in Production — as `opportunity.
wholesale_fee_`, on the Opportunity model, in the Opportunity Details
folder.** The id was never wrong and the field was never deleted; the
~87-day-old memory record's **Contact-model label** was the error, the
same class of mistake Family 7 already identified for Assignment Fee
Target. There is one field, on Opportunity, in both environments, not a
Contact/Opportunity pair and not a vanished field. **Unresolved question
3 from the original pass is closed by this finding.**

**Proposed canonical carrier:** none needed — `opportunity.wholesale_fee_`
has no current consumer and is not in conflict with anything live.
**Retirement candidates:** `opportunity.wholesale_fee_` is a candidate for
either formal retirement or deliberate reassignment, per PHASE_B_SPEC's
own framing — a decision for whoever designs the eventual deal-override
carrier set, not this document. **Compatibility/rollback risk:** none —
no consumer to break. **Memory correction (not a repository change):**
`reference_ghl_mao_fields.md`'s `contact.wholesale_fee_` entry should be
corrected to `opportunity.wholesale_fee_` — noted for whoever next
touches that memory file, alongside the identical correction Family 7
already names for Assignment Fee Target.

---

## Family 7 — Assignment Fee Target (single live carrier; a historical-memory identifier collision, resolved by this document)

**Status: RESOLVED — the apparent Contact/Opportunity duplicate does not
exist. One historical memory record was incorrect.**

| Candidate | Object | Key | ID (Prod / Test) | Type | Folder |
|---|---|---|---|---|---|
| Assignment Fee Target | Opportunity | `opportunity.assignment_fee_target` | `xwbPw1JVkgJevJTPNmxa` / `1UHwussLeAXwsxGpe9w0` | NUMERICAL | Opportunity Details |

**The apparent duplicate, resolved:** a prior session's memory
(`reference_ghl_mao_fields.md`) recorded a **Contact-model**
`contact.assignment_fee_target` at id `xwbPw1JVkgJevJTPNmxa`. That is the
**exact same id** this session confirms, directly from
`app/src/pages/MaoCalculator.tsx:30-34`, as the **Opportunity-model**
field (`SOURCE_FIELD_IDS.assignmentFeeTarget`, whose surrounding comment
states explicitly "Opportunity-side only"). A single GHL custom-field id
cannot simultaneously belong to two different model objects — it is one
field. **This session's live 109-field Test Contact inventory confirms
no field named "Assignment Fee Target" exists on the Contact model.**
**Finding: the memory record's model label was incorrect; there is one
field, on Opportunity, not two.** This document corrects that record
(the memory file should be updated to remove the Contact-model claim —
noted here for whoever next touches that memory, not actioned by this
Phase 1 document since memory files are outside the repository).

**Current reader:** `app/src/pages/MaoCalculator.tsx:32` (`SOURCE_
FIELD_IDS.assignmentFeeTarget`), read-only prepopulate, per its own
comment "read FROM these for prepopulate, never written to." **No
writer exists for this field anywhere in the codebase** (grep of
`app/src` for `assignment_fee_target` and `assignmentFeeTarget` returns
only this one read site). **Disposition tied to `MaoCalculator.tsx`'s own
fate**, exactly as `docs/UNDERWRITING_FIELD_REFERENCE.md:134` states:
"`opportunity.assignment_fee_target` is still referenced by
`MaoCalculator.tsx`" — the same unrouted, dead-in-practice page as
Family 5.

**Proposed canonical carrier:** `opportunity.assignment_fee_target`
(single carrier; no duplicate to resolve). **Retirement candidates:** none
required by this document; tied to whatever happens to `MaoCalculator.tsx`
and Family 5. **Unresolved questions:** none beyond Family 5's.

---

## Family 8 — Closing Costs: a field/value naming collision, not a duplicate fact

**Status: RESOLVED as non-duplicative — flagged because the naming
collision is a real risk for a future reader, per this document's "do not
assume the list is complete" instruction.**

| Candidate | GHL object type | Key | ID (Prod / Test) | Authoritative for |
|---|---|---|---|---|
| Closing Costs (per-deal, orphaned) | Opportunity **custom field** | `opportunity.closing_costs` | `N8Aa9t1SZhU7XnPPzxWk` / `qRfhbMv9wBXmE2o1wbnD` | nothing today — no consumer |
| Default Closing Cost Estimate | Location **custom value** (a different GHL object type entirely) | `custom_values.default_closing_cost_estimate` | `kapXvTS9tNYVRn7L3WBY` / `uSml4RQLMNstTrqeEDtA` | the location-wide default Investor Policy assumption, PB-D56 §IV |

**These are not the same fact.** The custom VALUE is a location-wide
policy default (starter `2500`), read by `parsePolicy`
(`app/src/lib/underwriting/resolver.ts:146-206`) and used in
`compute.ts:153` (`Closing Costs = Effective Closing Cost Estimate`),
authoritative per PB-D56 §IV and confirmed in
`docs/BOARD8_ECONOMICS_INVENTORY_V1.md`'s Investor Policy table. The
custom FIELD is a per-deal Opportunity field with **no live consumer**,
explicitly the subject of `docs/PHASE_B_SPEC.md`'s "discovery cycle"
section (chosen for its own inert-proof specifically because it had zero
consumers to disturb) and confirmed still orphaned
(`docs/PHASE_B_SPEC.md:2301-2305`).

**The risk this document flags, not a current defect:** if
`opportunity.closing_costs` is ever assigned a meaning (e.g., an
investor's per-deal override of the default), its name will be
indistinguishable in casual reference from the location-wide default it
would be overriding. **Recommendation, not a decision:** whoever assigns
`opportunity.closing_costs` a meaning should name it explicitly as a
**per-deal override** of the Investor Policy default in whatever carrier
documentation follows (matching the pattern PB-D56 §II.4 already uses for
financing on/off/unresolved three-state overrides), so the two are never
conflated in a resolver's `pick()` hierarchy without an explicit precedence
statement. **Proposed canonical carrier:** N/A — no merge needed; both may
coexist as distinct facts once the per-deal field is given a use.
**Unresolved questions:** should `opportunity.closing_costs` be retired
outright (GHL field deletion, its own decision) or reserved for the
future per-deal override role PHASE_B_SPEC already floats.

---

## Family 9 — Contact-side deal-economics fields sitting outside the stated ownership rule (Carrying Cost, Loan Amount, Interest Rate, Hold Months)

**Status: not a duplicate family — flagged as a standing tension with the
rollover's own ownership rule, for awareness, not for action in Phase 1.**

| Field | Object | Key | ID (Prod / Test) | Type |
|---|---|---|---|---|
| Carrying Cost | Contact | `contact.carrying_cost` | `FhcyP63sSAtWInl4Q4iI` / `VL1H3LuJCtbgN3WVtneW` | MONETORY |
| Loan Amount | Contact | `contact.loan_amount` | `3ZlSKldh0jR2MWhjOmHe` / `iIDiypNtXr7GJMMF7K77` | MONETORY |
| Interest Rate | Contact | `contact.interest_rate` | `i1mVFCwHIySFFzR1hVfQ` / `JnsOzL61ZlEfBrEPKL59` | FLOAT |
| Hold Months | Contact | `contact.hold_months` | `Ju1U6ROdDNnCFlsn4eeS` / `aztp3NdLgCwzK0m1SWQc` | NUMERICAL |

**Not a duplicate:** none of these four has an Opportunity-model twin —
they are single-carrier facts, so there is no conflicting-value risk of
the kind Families 1-6 have. **The tension:** the rollover's governing
ownership rule states "Opportunity owns... deal economics"; these four are
per-deal financing/holding economics inputs that currently live on
Contact, inert-proofed there under PB-D30/33/34 as part of the pre-PB-D56
generation of MONETORY field designations
(`docs/PHASE_B_SPEC.md:613-644`), predating the Opportunity-centric
underwriting model PB-D55/56 later established. **No named writer exists
for any of the four in `app/src/lib/ghl.ts` today** (grep confirms only
`setEstimatedRepairs`, `setApprovedArv`, `setAskingPrice`, and the three
underwriting/offer writers already covered above; none references
`carrying_cost`, `loan_amount`, `interest_rate`, or `hold_months` as a
write target). They hold historical/inert-proof data only.

**Proposed canonical carrier:** not proposed — these are not yet
duplicated, so there is nothing to canonicalize between two carriers.
Whether they should ever become genuine per-deal Opportunity inputs
(paralleling ARV/Asking-Price/Repairs) is a product question outside
INV-70's stated scope (duplicate resolution), not something this document
recommends deciding now. **Flagged only so a future Board #9/10 financing
feature does not create a *second*, Opportunity-side financing-input set
without first checking whether these four are meant to be reused, seeded,
or retired.**

---

## Cross-cutting findings

**The Accepted Purchase Price — the fact Board 9's contract work actually
needs — is not any field in this document, and is not a `offer_price`.**
Recorded here because it bears directly on why INV-63 (contract sending)
was paused and gated on this document. `docs/BOARD9_CONTRACT_INVENTORY_
V1.md` item 6 and `docs/BOARD8_ECONOMICS_INVENTORY_V1.md`'s "Accepted
price" row both establish that the price actually consumed downstream is
`OutcomeSnapshot.currentOffer`, captured verbatim at seller-call
acceptance and persisted as a **GHL Note** through the sanctioned
`ghl.notes.create()` — never a custom field. `app/src/lib/seller-call-
outcome.ts:40-45` states this as a module-level design invariant, in these
words: **"ACCEPTED PRICE IS THE EXISTING CURRENT OFFER, NEVER A NEW
FIELD."** The same header (lines 47-54) documents a known, accepted,
NOT-closed gap: a GHL note is durable and re-readable but not queryable or
pipeline-reportable, unlike a custom field — recorded there for INV-54,
not solved by anything in this document. **Neither `contact.offer_price`
nor `opportunity.offer_price` (Family 5) is this value.** A future
TREC/contract field-mapping pass that reaches for either `offer_price`
field expecting the accepted price would be reading the wrong carrier
entirely — the real value lives in note text, keyed by `agreementAt`, and
is invisible to a grep across custom-field ids. Stated plainly so it is
not rediscovered as a bug during Board 9's next attempt at INV-63.

**Property Address ownership is a deliberate, already-ruled exception to
the general ownership rule, not a gap.** `contact.property_address`
(`tG4gGFI8JB2VjWeuqYMx` / `1B6u7F1MipquMxVWnAD9`) is READ-ONLY in the
Contact edit surface, explicitly because IAOS treats "a new property = a
new contact" as its identity model
(`docs/CONTACTS_OPPORTUNITIES_SPEC.md:115-118,150`). No Opportunity-model
address field exists (confirmed: none of the 16 live Test Opportunity
fields names an address). This document does not treat this as a Family
to canonicalize — it is a standing architectural choice with its own
citation — but records it because the rollover's ownership rule, read
literally ("Opportunity owns property... facts"), is in tension with it.
Reconciling that tension, if ever needed, is a product decision belonging
to whoever revisits the one-property-per-contact assumption, not to this
document.

**MAO Viability Flag** (`contact.mao_viability_flag`,
`o87cyzuCyScbY72VrOmq` / `jSStfAuqN6Ycb7O9Khp8`, SINGLE_OPTIONS) —
observed live in both Contact inventories, not part of any named family,
but its only historical association (per `docs/FIELD_REGISTER.md` and the
"70% rule" formula in `docs/PHASE_B_SPEC.md:2314-2320`) is the retired
`mao-webhook.ts` calculator. Not confirmed as read or written by any live
code path this session (a targeted grep of `app/src` for
`mao_viability_flag` and `maoViabilityFlag` returns no matches).
**Flagged as a likely-orphaned legacy field, unverified, not asserted as
dead** — a candidate for the same retire-or-reassign treatment as
`opportunity.wholesale_fee_` and `opportunity.closing_costs`, on its own
future review.

**PB-D51's shared-configuration rule has one confirmed exception**
(Family 5's 14 hardcoded `offer_*` ids in `MaoCalculator.tsx`). This is an
integrity finding, not a duplication finding, but it directly enables
duplication risk: identifiers outside `ghl-config.ts` are invisible to
any future grep-based audit (including a repeat of this one) that only
checks the shared config module.

---

## What this document does not do

No GHL field was created, edited, renamed, migrated, archived or deleted,
in either Production or Test. No application code, configuration,
workflow, or test file was changed. No canonical carrier is finally
chosen for Family 3 (Repairs) or Family 5 (presented offer) — both are
surfaced as open, decision-requiring conflicts, per the explicit
instruction never to silently choose between conflicting non-empty values
or an unresolved architecture question — and this document does not
choose between them either. **Every GHL call across both the original
pass and this correction round was `GET`-only** — the original pass
against IAOS Test (`SoTgVoaFGHtBdRFvXWQV`) alone; this correction round
additionally against IAOS Production (`jmHG4B8RdzwpfqruNf68`), per Jess
Gate's explicit authorization for this round, still GET-only throughout.
No Linear issue is marked Done. No PR is opened.

---

## Blocking vs. non-blocking decisions (correction round 1)

Jess Gate's third correction asked this document to say plainly which
open questions actually block INV-70 execution planning, and which are
follow-up items that do not need to hold up the rest of Board #9. This
section makes that separation explicit. **Neither architectural decision
below is made by this document** — both are named as decisions Brad/Jess
must make, not decisions this document takes a position on.

### Blocking — must be decided before INV-70 execution planning proceeds

**1. Family 3 — Repairs.** The only field family where PB-D55's own
stated design (Opportunity owns underwriting, Contact seeds it once) is
**currently false in production code** — the named Opportunity carrier
(`opportunity.repair_estimate`) has no writer, so Contact
(`contact.estimated_repairs`) is what every deal actually resolves from
today, silently, including into Board 9's own `OutcomeSnapshot`. This
blocks execution planning because any Board 9 work that reads "the
repairs figure" (a contract field mapping, an underwriting report) needs
to know NOW which carrier it is reading, and the two live options carry
different costs and different conformance to the stated ownership rule.
**Decision needed:** re-designate `contact.estimated_repairs` as the
permanent canonical carrier for this one fact, or build the missing
`opportunity.repair_estimate` writer and migrate. Not decided here.

**2. Family 5 — the Presented/Current Offer family (14 fields).** Blocks
execution planning for a distinct reason: this family's disposition
depends on a prior, already-named Board 8 gap (the "Current Offer" /
negotiation-state carrier, `docs/BOARD8_ECONOMICS_INVENTORY_V1.md`,
"Opening Offer / Current Offer / negotiation fields," classified REAL
CARRIER GAP) that has to be decided first — building or reviving anything
against either the Contact or Opportunity copy of `offer_price` /
`offer_mao` / etc. before that decision is made risks creating a second,
competing negotiation-state mechanism. **Decision needed:** does resolving
the Current-Offer carrier gap retire, reuse, or replace this 14-field
family; if reused, which model governs between the Contact and
Opportunity copies; and is `MaoCalculator.tsx` (confirmed unrouted dead
code this session — no import or route anywhere in `app/src`) formally
retired or left in place. Not decided here.

**Nothing else in this document blocks INV-70 execution planning.** Every
other family below is either already fully resolved (ARV, Asking Price,
Seller MAO, Assignment Fee Target, and — as of this correction round —
Wholesale Fee Percent) or a non-blocking follow-up item that can be
tracked and closed independently, on its own timeline, without holding up
Board #9 coding that does not touch the specific fields involved.

### Non-blocking follow-up items

- **Family 6/8 — retirement or reassignment of `opportunity.wholesale_
  fee_` and `opportunity.closing_costs`.** Both orphaned, zero current
  consumer, not in conflict with anything live. Whoever eventually
  designs the deal-override carrier set can decide this on its own
  schedule.
- **Family 9 — the four legacy Contact-side deal-economics fields**
  (Carrying Cost, Loan Amount, Interest Rate, Hold Months). No writer
  exists for any of them today; not duplicated (no Opportunity twin);
  purely a standing-tension flag for whenever a future financing feature
  is designed.
- **Cross-cutting — `contact.mao_viability_flag`.** Likely-orphaned,
  unconfirmed as read or written by any live path; a retirement candidate
  for its own future review, not urgent.
- **Two memory-file corrections** (not repository changes): Family 7's
  Assignment Fee Target and Family 6's Wholesale Fee Percent entries in
  `reference_ghl_mao_fields.md` both mislabeled an Opportunity-model field
  as Contact-model. Cosmetic, does not affect any live decision.
- **`MaoCalculator.tsx`'s hardcoded, ungoverned 14 Offer-family ids
  outside `app/shared/ghl-config.ts`.** An integrity/hygiene gap, already
  de-risked by the page being unrouted dead code; folded into whatever
  Family 5's blocking decision produces, not separately urgent.

---

## Unresolved questions, collected

1. **BLOCKING — Family 3 (Repairs):** re-designate
   `contact.estimated_repairs` as canonical (low cost, breaks the stated
   ownership rule for this one fact), or build the missing `opportunity.
   repair_estimate` writer and migrate (higher cost, matches
   ARV/Asking-Price precedent)?
2. **BLOCKING — Family 5 (presented offer, 14 fields):** does resolving
   Board 8's named "Current Offer" carrier gap retire, reuse, or replace
   this family? If reused, which model (Contact or Opportunity) governs
   between the two copies? Should `MaoCalculator.tsx` be formally retired
   rather than left as re-routable dead code?
3. **Non-blocking — Family 6/8:** should `opportunity.wholesale_fee_` and
   `opportunity.closing_costs` be formally retired or reserved for a
   future per-deal override role?
4. **Non-blocking — Family 9:** are Carrying Cost / Loan Amount /
   Interest Rate / Hold Months intended to become genuine per-deal
   Opportunity inputs eventually, or remain permanently Contact-side
   historical fields?
5. **Non-blocking — Cross-cutting:** is `contact.mao_viability_flag`
   fully dead, and if so, is it a retirement candidate?
6. **Non-blocking, memory correction (not a repository change):** the
   session memory file recording GHL MAO field ids should be corrected —
   its `contact.assignment_fee_target` entry names an id that this
   document confirms is actually `opportunity.assignment_fee_target`, and
   (new this correction round) its absence of any `wholesale_fee_` entry
   should gain one, correctly labeled `opportunity.wholesale_fee_`
   (`RS2trZUHrZwaGxadLvHB` Prod / `kRGt4FKC3bW2Kvgsyshw` Test), not
   Contact-model.

**Resolved this correction round, removed from the open list:** whether a
Contact-side `wholesale_fee_` still exists in Production — it never
existed on Contact; see the updated Family 6 section.

Only items 1 and 2 block INV-70 execution planning (see "Blocking vs.
non-blocking decisions" above). None of the six is decided by this
document. Each requires a Product Owner and/or Chief Architect ruling
before the fields it names are touched by any Board #9 coding.
