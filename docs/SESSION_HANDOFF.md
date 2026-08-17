# IAOS — Session Handoff

**Refreshed 2026-08-17.** Repo tip `152e7b1` on `main`, pushed, working
tree clean. Deployed and verified: 197 harness checks green across four
harnesses on `index-cQyZ3TPY.js`, plus 186 unit checks across two
runners -- 53 on the calculation core, 133 on the resolver and view
model. `tsc --noEmit` and `pnpm build` clean.

**PB-D56 prerequisite 5 is DISCHARGED.** The gate on Approve since
PB-D55 closed 2026-08-17 by evidence, not argument. Fifteen proof steps
across three cycles, six production mutations, every one restored to
origin and verified. The fixture opportunity was restored to its
captured origin state, and the production harness reconfirmed the same
underwriting result afterward.

**CORRECTION to an earlier claim in this file and repeated in
conversation: today was NOT "zero GHL writes."** Production writes
occurred, all of them on the disposable IAOS Test Probe contact: one
opportunity creation, three opportunity-field writes populating the
fixture, and legacy `offer_*` contact writes made by the superseded MAO
Calculator. The writes were deliberate and confined to a throwaway
record, but the earlier statement was wrong and is corrected here rather
than quietly dropped.

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
        All PB decisions, PB-D1 through PB-D59. The most recent are the
        live ones: PB-D53 and PB-D54 govern the Dashboard queues, PB-D55
        and PB-D56 govern underwriting, PB-D57 governs browser-facing
        read-endpoint policy -- positive allowlisting, non-secret and
        non-personal exposure, and the temporary unauthenticated V1
        risk -- PB-D58 the opportunity-side inert proof, and PB-D59 the
        Approve write contract.

    docs/SELLER_ACQUISITION_WORKFLOW.md
        Product-design authority. What IAOS is being built toward: the
        conversation is the unit of work, the software helps the
        wholesaler listen rather than ask, and readiness is measured in
        stages rather than call counts. Read this before proposing any
        new capability -- it carries the test a feature has to pass.

    docs/CALL_FLOW_OF_WHOLESALER_TO_SELLER.txt
        The source behind the above, written by Brad. A complete seller
        call from prep through contract readiness, with what IAOS should
        be doing at each point. Transcribed into the repo rather than
        copied; content preserved, whitespace normalized.

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
harnesses, 197 checks total, all green against the deployed bundle at
the time of their last run:

    app/scripts/verify-contacts.cjs        138 checks
    app/scripts/verify-conversations.cjs    24 checks
    app/scripts/verify-dashboard.cjs         8 checks
    app/scripts/verify-underwriting.cjs     27 checks

The underwriting module is wired end-to-end and production-verified. Six
files under `app/src/lib/underwriting/` feed the live
`/contacts/:id/underwriting` route through the allowlisted policy
endpoint, and are exercised by two standalone runners as well as by the
live harness below:

    types.ts             the calculation contract
    compute.ts           the waterfall and acquisition position
    starters.ts          PB-D56 section IV, decimal fractions
    resolver-types.ts    wire shapes and the resolution contract
    resolver.ts          parsers, seed-then-supersede, the hierarchy
    view-model.ts        page state, operator labels, known facts

    app/scripts/test-underwriting-core.cjs      53 checks
    app/scripts/test-underwriting-resolver.cjs 133 checks

**The underwriting workspace is now live and machine-verified.**
`verify-underwriting.cjs` runs against the deployed page at
`/contacts/:id/underwriting` and covers BOTH production-reachable
states: UNRESOLVED on Neelima, whose Assignment Mode is absent, and
RESOLVED on the IAOS Test Probe. Each fixture's branch is detected from
its own rendered page rather than assumed from GHL, so a legitimate data
change reclassifies rather than fails.

The resolved branch asserts ARITHMETIC, not values. It reads ARV and
repairs off the rail, recomputes PB-D56's waterfall independently from
starter-policy constants hardcoded in the harness, and asserts the
rendered Seller MAO matches. That survives someone editing the fixture
and still fails on a calculation defect. It is the first end-to-end
verification that the deployed page computes PB-D56 correctly, as
opposed to the unit runners verifying the module in isolation.

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

**Six deal-fact identifiers grounded and configured 2026-08-14**
(`d1a08dc`). Three contact-side from `CONTACT_FIELD_REFERENCE.md`, three
opportunity-side from a live schema read. The writing script re-read the
live endpoint and confirmed each opportunity id carried its expected
fieldKey before touching config, and asserted that none of the seven
`offer_*` ids had crept in. Full provenance is under Known-stale.

**PB-D57 -- inbound authentication posture** (`559d4dd`). The recurring
description of the unauthenticated function surface as "deferred by
decision" was not accurate. OBSERVED: `FUNCTION_SURFACE_AUDIT.md` records
the approach as UNDECIDED and states three times that remediation is
unauthorized by that document, and a search of the spec for
authentication terms returned two incidental notes and no decision.
PB-D57 states the posture that was already being practised: new
browser-facing endpoints may ship unauthenticated when they are read-only
AND their response is a positive allowlist of non-secret, non-personal
data, as an explicitly accepted temporary risk of the single-tenant
phase. It authorizes no existing endpoint -- `ghl-proxy.ts` and
`ghl-mailers.ts` are named as out of scope and still UNDECIDED, so the
decision cannot be read as laundering them.

**The underwriting-policy endpoint shipped and passed acceptance**
(`e1d2bc0`). `app/netlify/functions/ghl-underwriting-policy.ts`, GET-only,
returning `{ values: [{ id, value }] }` -- the resolver's PolicyValue
contract, so `parsePolicy` remains the authority on parsing and unit
conversion. The allowlist is derived from `getConfig().customValues`
rather than hardcoded, so no id can be served that is not already in
shared configuration. OBSERVED against the live deploy: HTTP 200, exactly
eleven entries, every id in the allowlist, all eleven present, every entry
carrying exactly `id` and `value`, and `iaos_webhook_secret` absent from
the raw response. That is PB-D57's positive-allowlist rule verified in
production rather than merely implemented.

**The product direction became a durable artifact** (`6437884`).
`SELLER_ACQUISITION_WORKFLOW.md` and its source. The finding that matters:
the unit of work is the seller conversation, not the calculation, and the
software should help the wholesaler listen rather than turn the call into
a questionnaire. It also names three distinct readiness gates --
Underwriting, Offer, Contract -- where the specs previously had one
defined gate and an unsettled question.

**Workspace location and Opportunity selection decided** (`af8a71c`).
Two of the workspace spec's four open questions are now decisions with
their reasoning attached, and a third has a name. See that file.

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

**A production opportunity fixture now exists.** IAOS Underwriting Test,
opportunity id `OcGWOP9n666i4Q1MLd31`, on the IAOS Test Probe contact
`HGZAby6snRZfpl0go2Yb`. It carries the three populated fields the
resolved path needs -- ARV, Repair Estimate and Assignment Mode -- and is
what `verify-underwriting.cjs` exercises for the RESOLVED branch. DO NOT
modify or delete it: the resolved production branch and its
independent arithmetic assertions depend on it existing and staying
populated.

**PB-D56 prerequisite 5 is no longer blocked by the absence of a
fixture.** The reason the opportunity-side inert proof could not start
was that every opportunity in the location was a live seller lead. That
is no longer true. The prerequisite itself is NOT discharged and the
inert proof has NOT been run -- what changed is that the controlled work
can now begin on a disposable record rather than a real deal.

**Stray `offer_*` values sit on the IAOS Test Probe contact.** Written by
the superseded MAO Calculator during today's fixture work. Contact-side,
not opportunity-side, and on a throwaway record -- but they are real
values on a real contact and nobody has cleaned them up. Same class as
the `offer_*` test data recorded above on Neelima's opportunity.

**Duplicate ARV and repair field families are a demonstrated
operator-confusion hazard, not a theoretical one.** Both the Contact and
the Opportunity carry ARV and repair-estimate fields, and the resolver's
seed-then-supersede rule means the Opportunity silently wins. Today that
cost real time: values were entered in one place and read from the
other. The duplication is inherent to PB-D55's authority model and is not
a defect, but nothing in the UI tells an operator which copy is being
used.

**The superseded MAO Calculator is retired from operator navigation; what
remains is dormant write-helper cleanup.** Its formula does not model
financing and does not separate the two PB-D56 outputs, so anything it
produced disagreed with the underwriting workspace -- two surfaces
computing different numbers for the same deal, one of which wrote. That
exposure is closed:

    removed    the sidebar entry, the Header title-map entry, the
               /mao-calculator route and its import, and the per-row
               "Analyze in Deal Calculator" link on the Pipeline page
    retained   MaoCalculator.tsx, still in the repo, now imported by
               nothing and omitted from the production bundle
    retained   ghl.contacts.saveOfferFields and
               ghl.opportunities.saveOfferFields in ghl.ts, both defined
               with ZERO callers

The remaining issue is the two dormant write helpers, not operator
exposure. They are unreachable through the UI but still available to any
future caller, so removing them is a deliberate decision rather than
something the retirement already accomplished.

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

**The six deal-fact identifiers are DISCHARGED 2026-08-14** (`d1a08dc`).
All six are in `app/shared/ghl-config.ts`. Provenance differs per id and
is recorded here because the opportunity trio appears in no other
repository document:

    contact.arv                          wMBTGWMs97yysQFx7Vad
        pre-existing in shared config; corroborated this session
        against CONTACT_FIELD_REFERENCE.md line 65
    contact.estimated_repairs            OQnud97MfdxMcTgMVTgf
        CONTACT_FIELD_REFERENCE.md line 66, MONETORY
    contact.asking_price                 60UCjsYT1Ak3Kyy5ZCL8
        CONTACT_FIELD_REFERENCE.md line 64, MONETORY
    opportunity.arv_after_repair_value   cBkygqcHRseZUGCYYeba
    opportunity.repair_estimate          hId4Yog6u5GP1Iwz1aNx
    opportunity.asking_price             YxCDaX7dLhBJL9GLGFpJ
        all three NUMERICAL, OBSERVED from a live read of
        /locations/jmHG4B8RdzwpfqruNf68/customFields?model=opportunity
        through the deployed proxy. The writing script re-read that
        endpoint and confirmed each id carried its expected fieldKey
        before the config was touched.

The contact pair lives in the `fields` block; the opportunity trio in a
new `opportunityFacts` block, kept distinct from `opportunityFields`
because facts about a deal are not the same kind of thing as the
underwriting state IAOS produces.

OBSERVED in the same read: the opportunity model carries sixteen custom
fields, of which `UNDERWRITING_FIELD_REFERENCE.md` documents three. The
full inventory is not recorded anywhere and is not recorded here; it
belongs in a field reference, not a session handoff. Seven of the sixteen
are the `offer_*` HARD NO set and none may enter shared config -- the
writing script asserted their absence explicitly.

**`ghl-proxy` returns a bare empty body on a GHL 404.** OBSERVED
2026-08-14: `path=/customFields?model=opportunity` without the location
scope returns HTTP 404 with zero bytes and no error payload, because
`ghl-proxy.ts` passes `res.text()` through verbatim. Two runs of that
call produced nothing and looked like the transient-empty class until a
third run captured the status with `curl -w '%{http_code}'`. Any
diagnostic through this proxy needs the status code or it is blind. The
working path is location-scoped:
`/locations/{locationId}/customFields?model=opportunity`.

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

**The GHL builder pass is done — OBSERVED 2026-08-16.** No workflow uses
Opportunity Created. Pipeline Stage Changed workflows were inspected for
the Seller pipeline, and Seller 1 is triggered by Form Submitted rather
than by opportunity creation or stage entry. The controlled fixture was
created at Seller Leads Pipeline -> New Lead - Seller -> Open and
remained inert. Brad confirmed the two recently created legacy Custom
Values have not been added to any workflow, because no workflow has been
modified since those values were created.

This is the OBSERVED CURRENT PRODUCTION CONFIGURATION and nothing more.
It does not prove that no future workflow could watch opportunity
creation or stage entry, and it is not a substitute for the per-field
inert proof -- PB-D56 section 4.6 still holds that trigger config is not
API-derivable. What it establishes is that the fixture work performed
today was inert, and that the inert proof can proceed against a known
trigger inventory rather than an unknown one.

## Carrier status for Approve

PB-D59 section I names three carriers. Two are proven inert; one is not.

    endbuyer_maximum_purchase_price   PB-D58 section II   proven inert
    mao_max_allowable_offer           PB-D59 Proof A0     proven inert
    assignment_mode                   Proof A             NOT proven

PB-D58 section IV is explicit that discharge does not generalize:
dataType proves serialization, not field safety. Each carrier earns its
own proof, and Proof B then proves the composition rather than trusting
that three separately-proven fields compose.

**Evidence.** Fifteen files archived to
`C:\Users\brad\Documents\IAOS Evidence\` with `cp -p`, every
SHA-256 pair matched on both sides, every Temp original retained.
Fifteen proof scripts retained in `app/scripts/` so the method is
auditable and not only the result.

**The two opportunity read paths serialize custom fields differently.**
The singular `GET /opportunities/{id}` returns a NUMERICAL value under
`fieldValue` and carries no `type` key; the list endpoint returns the
same field under `fieldValueNumber` WITH a `type`. Same object, same
dataType, different shape. `readNumberField` in
`app/src/lib/underwriting/resolver.ts` is correct for the list shape the
workspace consumes and MUST NOT be reused against the singular shape --
it would read every NUMERICAL field as absent, silently, and report the
deal unresolved rather than erroring. Recorded in PB-D58 section VI and
constraining PB-D59's readback.

---

## Immediate next steps

1. **PB-D59 Proof A — `assignment_mode`.** The first SINGLE_OPTIONS
   write anywhere in IAOS. POPULATED origin, so restoration means the
   original option string returns exactly rather than a clear to
   absence -- a different contract from PB-D58's and A0's. There is no
   consumer-free SINGLE_OPTIONS field to rehearse on: `assignment_mode`
   is the only one on the opportunity model and it is the field Approve
   writes, so discovery and the field proof are the same cycle.

   Writes `25% of Buyer Profit`, verifies, restores `Standard Minimum`
   exactly. That option keeps the fixture fully resolved while
   exercising a materially different spread branch. `Manual` was
   rejected: with no manual-amount carrier it resolves to unresolved,
   which changes the fixture's state class rather than its values.

   `verify-underwriting.cjs` is NOT a valid gate mid-proof and its
   failure then is NOT a regression. The harness hardcodes the standard
   minimum as a verification-only literal and would compare a
   profit-share figure against a standard-minimum recomputation.
   Proof A's final step reruns it after restoration and requires the
   probe to return to RESOLVED with the independent PB-D56 arithmetic
   check passing. That is the boundary between temporary fixture
   mutation and post-restoration regression verification.

   SINGLE_OPTIONS clear semantics remain UNKNOWN and are not required:
   Approve writes a mode over whatever mode is there and never clears
   one. Nobody may read Proof A as having established how to clear a
   SINGLE_OPTIONS field.

2. **PB-D59 Proof B — the combined three-field payload.** One
   custom-fields-only PUT carrying all three carriers together,
   readback on the singular-GET `fieldValue` shape, the full battery,
   and complete restoration of a mixed origin state -- the two
   NUMERICAL carriers to KEY_ABSENT, `assignment_mode` to its original
   option string. Composition is part of the contract and is unproven
   until it is proven.

3. **Then Approve may be rendered.** Not before, and PB-D59 section VI
   forbids rendering it as a disabled control in the meantime.
   `saveUnderwritingFields` may be written but not called from the UI,
   which exists so Proof B can use the real method rather than a
   stand-in.

   What Approve means for Manual mode is still open: no GHL field holds
   the manual assignment spread amount, so an approved manual
   underwriting cannot round-trip.

**On parallelizing.** The calculation core is now a proven bounded
module and is suitable for higher-throughput engineering. The
underwriting read/render path has now crossed that readiness gate:
its adapter and read contracts are implemented, production-verified, and
covered in both resolved and unresolved live states. Higher-throughput
work is appropriate for bounded follow-on slices that do not cross the
still-unproven opportunity write boundary. The opportunity-side inert
proof is DISCHARGED as of 2026-08-17; PB-D59's Proof A and Proof B are
now the gate before parallelizing Approve/write-path work.
