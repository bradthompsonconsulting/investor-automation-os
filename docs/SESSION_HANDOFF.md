# IAOS — Session Handoff

**Refreshed 2026-08-14.** Repo tip `6714fb6` on `main`, pushed, working
tree clean.

This file replaces the 2026-07-29 handoff wholesale rather than amending
it. That version described the repo at `6f79044`, before the Dashboard
queue work, the underwriting architecture, and two endpoint retirements.
Correcting it would have been slower than writing this. The superseded
content remains in git history.

---

## Read first

These are the governing documents. Read them rather than trusting any
summary of them, including this one.

    docs/FOUNDATIONAL_PRINCIPLES.md
        How decisions are made. Nineteen principles in four sections.
        Governs from PB-D56 forward. Section I -- how facts are
        established -- applies to every claim in the project, including
        claims made in conversation.

    docs/PHASE_B_SPEC.md
        All PB decisions, PB-D1 through PB-D56. The most recent are the
        live ones: PB-D53 and PB-D54 govern the Dashboard queues, PB-D55
        and PB-D56 govern underwriting.

    docs/UNDERWRITING_WORKSPACE_SPEC.md
        The workspace surface. Implements PB-D55 and PB-D56 and decides
        no economics of its own.

    docs/UNDERWRITING_FIELD_REFERENCE.md
        GHL identifiers for the underwriting carriers. Custom Values and
        Opportunity fields, with ids and keys.

    docs/JEFF_OUTPUT_RULES.md
        How Jeff reports. Read before relying on any summary he gives.

Also current: `CONTACT_FIELD_REFERENCE.md` (98 contact custom fields),
`TESTING_METHODOLOGY.md`, `FUNCTION_SURFACE_AUDIT.md`,
`CONTACT_WORKSPACE_SPEC_v2.md`, `DASHBOARD_SPEC_v2.txt`,
`CONVERSATIONS_SPEC.md`.

---

## Where things stand

**Shipped and verified live.** Dashboard, Contact Workspace,
Conversations read-only, Calendars read-only. Three verification
harnesses, 170 checks total, all green against the deployed bundle at
the time of their last run:

    app/scripts/verify-contacts.cjs        138 checks
    app/scripts/verify-conversations.cjs    24 checks
    app/scripts/verify-dashboard.cjs         8 checks

`app/scripts/repin-harnesses.cjs` re-pins all three to the served bundle
in one command. Run it after every app-code deploy, then run the three
harnesses. The pin lives in three files and drifted three times when
edited by hand.

**Live bundle at last check:** `index-BOtn59it.js`. Any app-code deploy
moves it and stales all three pins.

---

## Recent decisions, most consequential first

**PB-D56 -- the underwriting model.** IAOS underwrites wholesale
acquisitions backward from a representative end buyer's economics. Six
deductions, eleven investor-policy assumptions with starter values, a
three-level resolution hierarchy, and the GHL carriers that hold them.
Two named outputs: End-Buyer Maximum Purchase Price and Seller MAO.
Gate 1 is ARV and repairs; everything else resolves from policy.

**PB-D55 -- underwriting authority belongs to the Opportunity.** Contact
carries the person; Opportunity carries the deal. Approved underwriting
persists to a selected Opportunity and is never mirrored to the Contact.
Proposed, approved, and presented are distinct states.

**PB-D54 -- six cold-outreach exclusion predicates** govern Lead Queue
membership. OBSERVED 2026-08-12: 10 of 44 contacts excluded, queue at 34.

**PB-D53 -- durable carriers for engagement and reachability.** Seller
Follow-Up stage for engagement, `contact.phone_status` for reachability.
All five implementation steps discharged.

**Two endpoints retired 2026-08-13.** `mao-webhook.ts` and
`deal-submit.ts` were unauthenticated production write surfaces with no
caller and zero invocations over the full log retention window. Deleted,
deployed, confirmed absent from the marketing site's function list. Their
rationale is preserved in the architecture reference and the function
surface audit rather than lost with the code.

---

## The active work: the Underwriting Workspace

**What exists.** The economics are decided (PB-D56), the surface is
specified (`UNDERWRITING_WORKSPACE_SPEC.md`), and the GHL carriers are
created and recorded (`UNDERWRITING_FIELD_REFERENCE.md`).

**PB-D56's five implementation prerequisites:**

    1. Custom Values write capability      UNKNOWN, not blocking
    2. Workflow references to two legacy
       Custom Values                       UNKNOWN, needs GHL builder
    3. Ten Custom Values                   DISCHARGED 2026-08-14
    4. Two Opportunity fields              DISCHARGED 2026-08-14
    5. Opportunity-side inert proof        OPEN -- the gate

**Prerequisite 5 is the only gate on writing**, and it blocks the Approve
action, not the workspace. Read, calculate, and display can all be built
first with Approve disabled.

**What prerequisite 5 needs, none of which exists:**

*A fixture.* All 42 opportunities in the location are live seller leads;
none is a test record. The probe contact `HGZAby6snRZfpl0go2Yb` has no
opportunity on any of the three pipelines. Creating one is itself a
production write and needs its own approval, separately from the proof it
enables -- the same write-separation invariant §10.3 fixes for PUTs.

*A registry that can express opportunity entries.* Every entry in
`inert-proof-runner.cjs`'s FIELDS registry hardcodes `contactId`. Adding
an opportunity is a schema change to code that seven proven proofs depend
on. The decision taken 2026-08-13 was to hand-write the first opportunity
proof rather than extend the runner, following the PB-D15 precedent.

*Clear semantics for opportunity NUMERICAL.* §10.3 established `""` →
KEY_ABSENT for contact TEXT and MONETORY. Nothing establishes it on the
opportunity model. The first opportunity proof must establish it as part
of its own restore step.

**Proposed target field:** `End-Buyer Maximum Purchase Price`,
`zOVIPwzLe41a0SQmwVAJ`. Created 2026-08-13, absent on every opportunity,
and too new for any workflow to reference -- which is INFERRED from GHL's
field-selection model, not OBSERVED, since no complete workflow inventory
exists.

**Inertness argument, such as it is.** OBSERVED at architecture reference
line 118, verified live: a custom-fields-only PUT -- no `pipelineStageId`,
no `status` -- cannot fire stage triggers. That is the mechanism keeping
Save Offer inert. Three trigger types are known in this location: pipeline
stage changed, contact tag added, form submitted. None watches an
opportunity custom field. But there is no complete workflow inventory and
§4.6 says trigger config is not API-derivable, so "no workflow watches an
opportunity custom field" is unproven rather than disproven.

---

## Working invariants

**GHL is the sole system of record.** No app-side shadow copy. Inspect
the wire before designing the screen.

**The three sanctioned Dashboard writes**, and no fourth: `notes.create`,
`setLastCallAttempt`, `setCallbackDatetime`.

**HARD NO, unchanged:** tags, pipeline stage, `offer_` fields, workflow
triggers. `CONTACTS_OPPORTUNITIES_SPEC.md` §4.1.

**No field is written before its own inert proof.** dataType proves
serialization; it does not prove field safety.

**Commit discipline.** diff → STOP → stage → STOP → status → STOP →
commit → STOP → verify subject from `git log -1 --format=%s` → STOP →
push. No chaining. Commit messages are the exact text supplied; the
`Co-Authored-By` trailer was instructed to stop 2026-08-13 and stopped.

**Guarded scripts over hand edits.** Any multi-file or exact-text edit
goes through a validate-all-then-write script that aborts on a count
mismatch rather than through find-and-replace in the editor. Note that
several docs are CRLF in the working tree: a script matching `\n`-joined
patterns must normalize first or it will silently match zero times.

---

## Known-stale and unresolved

**Two Custom Values are a deliberate duplicate.** `Default Assignment Fee
Minimum` and `Standard Minimum Assignment Spread` both hold 5000. PB-D56
names the second authoritative. The first is held until workflow
references are verified in the GHL builder.

**`Default Wholesale Percentage` = 70 is orphaned.** It belongs to the
70%-rule formula retired with `mao-webhook.ts`. Obsolete for underwriting,
retained pending the same verification.

**`MaoCalculator.tsx` is superseded but not retired.** Its formula does
not model financing and does not separate the two outputs. It still reads
`opportunity.assignment_fee_target`, which is why that field is not free
to redefine.

**One production record carries `offer_` test data.** Opportunity
`1AP9BfFPJ2xYZ0RPTm9U` (Neelima Bale) holds seven `offer_*` values at a
negative margin -- a calculator test that persisted. Not a presented
offer. That contact also serves as the record-view fixture, the D5
regression fixture, and `verify-dashboard.cjs`'s eligible control.

**Six Netlify functions have no inbound authentication.** Deferred by
decision while single-tenant; the trigger to fix is the first user who
isn't Brad. Only `ghl-disposition` verifies a secret.

**No v1 definition exists.** What "done" means for a first release --
your own deals, another investor's, or the AI assistant -- is undecided,
which makes any timeline estimate unfounded.

---

## Immediate next steps

1. **The workspace read path.** Read opportunity custom fields, resolve
   the three-level hierarchy, compute the waterfall, render zones 1, 2
   and 4. Approve stays disabled. Unblocked by anything.

2. **The opportunity fixture decision**, then the inert proof, then
   Approve.

3. **Workflow-reference verification** in the GHL builder for the two
   legacy Custom Values, which unblocks deleting them.
