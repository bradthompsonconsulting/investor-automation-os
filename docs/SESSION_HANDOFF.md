# IAOS — Session Handoff

**Refreshed 2026-08-14 (second pass).** Repo tip `b357dc1` on `main`,
pushed, working tree clean. Deployed and verified: 170 harness checks
green against the served bundle, plus 140 unit checks across two
runners -- 53 on the calculation core, 87 on the resolver. `tsc
--noEmit` clean. Zero GHL writes today.

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

The underwriting module is shipped but wired to nothing. Five files
under `app/src/lib/underwriting/`, exercised by two standalone runners:

    types.ts             the calculation contract
    compute.ts           the waterfall and acquisition position
    starters.ts          PB-D56 section IV, decimal fractions
    resolver-types.ts    wire shapes and the resolution contract
    resolver.ts          parsers, seed-then-supersede, the hierarchy

    app/scripts/test-underwriting-core.cjs      53 checks
    app/scripts/test-underwriting-resolver.cjs  87 checks

Both runners compile the TypeScript with `tsc --strict` into a temp
directory carrying its own `package.json` declaring commonjs, because
`app/package.json` sets `"type": "module"`. Both have an exact-equality
floor gate: a deleted case fails the run rather than passing quietly.
Neither touches GHL, the network, or a fixture record.

`app/scripts/repin-harnesses.cjs` re-pins all three to the served bundle
in one command. Run it after every app-code deploy, then run the three
harnesses. The pin lives in three files and drifted three times when
edited by hand.

**Bundle-hash behaviour is unstable. Do not predict it; measure it.**
Run `repin-harnesses.cjs` after EVERY app-code deploy regardless of what
kind of file changed or what you expect. This paragraph previously
recorded a mechanism -- pure types erase, unimported modules never reach
the entry chunk -- and that mechanism produced a wrong prediction the
same day it was written.

The evidence, all OBSERVED 2026-08-14. `f64e37b`, unimported TypeScript
plus a `.cjs` runner: hash HELD. `d2a6522`, imported config: hash MOVED,
expected. `0be60c2`, `.cjs` only: HELD. `a3e4dcf`, unimported TypeScript
plus two edited-but-still-unimported core files: hash MOVED, contradicting
`f64e37b`. `b357dc1`, `.cjs` only: HELD.

So `.cjs`-only commits have held twice, and unimported TypeScript both
held and moved. Vite emits content-addressed names and anything altering
build inputs or module ordering can shift one. The operational rule is
the only durable part.

No live hash literal is recorded here on purpose. It went stale twice
within three hours of being written. `repin-harnesses.cjs` reads the
served bundle and is the source of truth.

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
That is a historical snapshot of a moving population, not an invariant.
OBSERVED 2026-08-14: 45 contacts, queue still 34, so eleven are now
excluded. Which contact and which predicate is UNKNOWN -- nobody has
checked. Do not restate the 2026-08-12 figures as current.

**PB-D53 -- durable carriers for engagement and reachability.** Seller
Follow-Up stage for engagement, `contact.phone_status` for reachability.
All five implementation steps discharged.

**Two endpoints retired 2026-08-13.** `mao-webhook.ts` and
`deal-submit.ts` were unauthenticated production write surfaces with no
caller and zero invocations over the full log retention window. Deleted,
deployed, confirmed absent from the marketing site's function list. Their
rationale is preserved in the architecture reference and the function
surface audit rather than lost with the code.

**Workspace spec contradiction resolved 2026-08-14** (`9215510`).
The spec defined Seller MAO as End-Buyer Max minus a Planned Assignment
Fee, while PB-D56 defines it as End-Buyer Max minus Required Assignment
Spread. Equal at default, so no worked example distinguished them.
PB-D56 section II.6 already provides Manual mode as the human override,
so Planned was a second lever for a concept that had one. Resolved in
favor of PB-D56: one effective Assignment Spread, three modes, no
separate Planned Assignment Fee. PB-D56 was not amended.

**Underwriting calculation core shipped 2026-08-14** (`f64e37b`).
`app/src/lib/underwriting/types.ts` and `compute.ts`, exercised by
`app/scripts/test-underwriting-core.cjs` at 53 checks, all green.
Pure functions: no GHL identifiers, no I/O, no React, no writes. The
runner compiles the core with `tsc --strict` to a temp directory that
carries its own `package.json` declaring commonjs, because
`app/package.json` sets `"type": "module"`. The zone 4 worked example
from the workspace spec is test 1 and reproduces PB-D56's own figures.
Every designed-against failure mode is pinned: human percentage units,
NaN, financing-off versus unresolved, no profit-share fallback, the
$5,000 / $4,999.99 warning boundary, mixed-level provenance, and
accumulated missing inputs.

**Underwriting identifiers moved into shared config 2026-08-14**
(`d2a6522`). Eleven Custom Value ids and three Opportunity field ids now
live in `app/shared/ghl-config.ts` under `customValues` and
`opportunityFields`, separate from `fields`, which remains the contact
map. The two legacy Custom Values are deliberately excluded -- nothing
reads them. Every id was asserted against
`UNDERWRITING_FIELD_REFERENCE.md` by the writing script before the file
was touched, so none was transcribed by hand. `getConfig`'s completeness
check is now derived from the config maps rather than a hand-maintained
list of sixteen literals; adding an identifier can no longer silently
escape the fail-loud invariant.

**Underwriting resolver shipped 2026-08-14** (`a3e4dcf`). Three parsers
and two resolvers, 87 checks. `parsePolicy` owns unit conversion and is
the last place a human-unit percentage exists; it returns issues
alongside the policy so one malformed Custom Value cannot prevent the
other ten resolving. `resolveDealFacts` implements PB-D55 seed-then-
supersede: the Opportunity wins, the Contact seeds, both absent names
both. `resolveInputs` runs Deal Override -> Investor Policy -> IAOS
Starter per assumption independently, so financing can take its switch
from one level and its LTV, rate and points from three others -- proven,
not merely compiled.

**Assignment can now be unresolved** (`a3e4dcf`). `UnderwritingInputs.
assignment` became `AssignmentResolution`: a valid strategy, or a
statement that none could be determined. `Assignment` itself is
unchanged -- "unresolved" is not a way of assigning a deal. An absent or
unrecognized mode, or Manual with no amount, now fails closed and blocks
the calculation. Before this change the resolver substituted Standard
Minimum, which would have given an operator who chose Manual a different
deal than the one they chose, silently.

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
mismatch rather than through find-and-replace in the editor.

**Check line endings on the target file before scripting an exact-text
edit.** The working tree contains both LF and CRLF documents -- OBSERVED
2026-08-14: `UNDERWRITING_WORKSPACE_SPEC.md` is pure CRLF while
`SESSION_HANDOFF.md` is pure LF. Match the file's observed line endings;
never assume them from another file. A pattern joined on the wrong
terminator matches zero times and a shape guard reports success.
`tr -cd '\r' | wc -c` against `tr -cd '\n' | wc -c` is the reliable
check; `file` and `cat -A` both misreported this repo at least once.

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

**`UnitsError` throws rather than resolving to unresolved.** A percentage
arriving in human units, or a non-finite number, throws out of
`computeUnderwriting` rather than returning `status: "unresolved"`. That
is deliberate -- a malformed value is an adapter bug, not a missing
input, and reporting it as missing would send the operator to populate a
field that is already populated. The consequence is a requirement on the
UI layer: whatever renders the workspace must catch it, or one bad Custom
Value takes the zone down instead of showing a missing-input state. Not
yet written into `UNDERWRITING_WORKSPACE_SPEC.md`.

**The workspace spec's lifecycle ordering is imperfect, deliberately
left.** "The economic lifecycle" claims five quantities "in the order
they come to exist" and lists Assignment Spread first, but the spread is
consumed at the Seller MAO step and, under profit-share mode, is computed
from Required Buyer Profit. The defect predates the 2026-08-14
correction and was excluded from it deliberately to keep that diff
reviewable. Fixing it is a separate judgment about the document's own
logic.

**Profit-share below the minimum is floored silently; manual below the
minimum warns.** PB-D56 line 2096 specifies `max(share, minimum)`, so a
profit-share spread under the floor is lifted with no warning, while a
manual spread in the identical position emits
`MANUAL_SPREAD_BELOW_STANDARD_MINIMUM`. Both behaviors are now pinned by
tests, so a future change to either breaks a check rather than passing
unnoticed. Whether the asymmetry is intended is not reopened here.

**No GHL field holds the manual assignment spread amount.** Assignment
Mode records WHICH mode governs; nothing records the manual dollar
figure. Manual mode is computable, testable and displayable, but an
approved manual underwriting cannot round-trip -- reload and the number
is gone. That constrains what Approve can mean for one of the three
modes, and it is a PB-D56 gap rather than a missing lookup.

**The OFF representation of Purchase Financing Enabled is UNKNOWN.**
OBSERVED: "On" is what the Custom Value holds when on. What it holds
when off has never been read. `parsePolicy` therefore resolves only
"On" and treats every other token -- including "Off", "false", "0" and
blank -- as unresolved, never as false. Seven tokens are pinned by tests.
Consequence: `Financing.kind === "off"` has no production route today,
so the core's financing-off path is exercised only by hand-built test
inputs. Add the observed token and its test when the GHL builder pass
reads it; do not infer it.

**Six identifiers are needed before the resolver can be wired live.**
Opportunity ARV, Opportunity Repair Estimate and Opportunity Asking
Price -- PB-D55 names the fields on the schema but their ids have never
been read. Contact Estimated Repairs and Contact Asking Price -- almost
certainly in `CONTACT_FIELD_REFERENCE.md`, a file read rather than a GHL
read. Contact ARV is already in config. Ground all of them in one pass
rather than one at a time.

**There is no Custom Values read path.** OBSERVED 2026-08-14, recursive
read of `app/netlify/functions/` and `app/src/`: the only code touching
that endpoint is `mailer-digest.ts`, which fetches one value by
hardcoded id. No function serves the collection and nothing in
`app/src/` reads investor policy at all. PB-D56's "OBSERVED through the
deployed proxy" was a one-off investigation, not a capability.

**ARCHITECTURAL RULING -- the browser must never receive the full
Custom Values collection.** PB-D56 section VIII records
`iaos_webhook_secret` as residing in the location's Custom Values in
plaintext; the collection itself has not been re-read this session, so
that is OBSERVED by prior committed decision rather than by direct read.
The endpoint, when built, returns only the eleven underwriting Custom
Values named in shared config -- a server-side allowlisted policy read,
never a generic Custom Values proxy.

**Transient empty endpoint responses are a class, not incidents.**
OBSERVED twice on two different endpoints: `/contacts` list, and the
per-contact conversations read. Both returned an empty payload where
data existed and both recovered on an immediate re-run with no code
change. The harnesses have no retry, so a transient produces a red run
that looks like a regression. A single harness failure warrants a
re-run before it is believed. Collateral figures moving in lockstep --
body length, scroll height -- distinguish an empty read from a real
data change.

---

## Immediate next steps

1. **Ground the six missing identifiers** in one pass. Three
   opportunity-side and two contact-side, listed under Known-stale.
   The contact pair is a file read; the opportunity trio needs a live
   GHL read. Nothing downstream can be wired until they exist.

2. **The allowlisted underwriting-policy read.** A server-side function
   returning only the eleven policy values, never the collection. Its
   response shape is already specified by what `parsePolicy` accepts --
   `{id, value}` pairs -- so the endpoint has one boring translation job
   rather than a design of its own. That ordering is deliberate: the
   resolver tests are the endpoint's specification, which is why the
   resolver was built first.

3. **The read path and zones 1, 2 and 4**, Approve disabled. The two
   open questions in the workspace spec -- where the workspace lives,
   and how Opportunity selection is presented -- gate the surface but
   not the calculation. The UI must catch `UnitsError`, or one malformed
   Custom Value takes the zone down instead of showing a missing-input
   state.

4. **The GHL builder pass.** One session answers two questions that no
   API read can: whether any workflow watches Opportunity creation or
   stage entry, and whether either legacy Custom Value is referenced.
   The first is the missing input for the fixture decision; the second
   unblocks deleting the deliberate duplicate.

5. **The opportunity fixture decision**, which is not decidable before
   step 4. Creating a fixture opportunity touches the one trigger type
   known to be armed in this location; writing to a live seller deal
   repeats the failure already recorded above at
   `1AP9BfFPJ2xYZ0RPTm9U`. Neither is obviously smaller until the
   trigger inventory exists.

6. **The opportunity-side inert proof**, then Approve.

**On parallelizing.** The calculation core is now a proven bounded
module and is suitable for higher-throughput engineering. The broader
workspace is not, until the adapter and read contracts settle -- their
shapes are decided but unbuilt, and parallel work against an unbuilt
contract produces rework rather than throughput.
