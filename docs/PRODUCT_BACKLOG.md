# IAOS Product Backlog

## Purpose

IAOS is being built with two simultaneous goals:

1. To become Brad's daily operating system for acquiring and managing
   investment opportunities.
2. To evolve into a SaaS platform that delivers the same capabilities to
   other real estate investors.

## Guiding principle

Every hour spent should either reduce Brad's daily work or increase the
app's value for every future investor.

## How to read this document

Priority groups items by business value, not by engineering category.
P1 improves every working session. P2 is what a paying investor would
notice. P3 is the platform work that turns a single-user tool into a
product. P4 is technical debt. P5 is research and validation.

Platform identifies where the work is performed. Prioritization is
always by business value, never by platform. IAOS rows change code in
this repository. GHL rows change workflows, fields, or account settings
inside GoHighLevel and produce no commit; they are verified by live
observation rather than by a diff.

Owner is Jeff for IAOS implementation, Brad for product decisions and
tests, and Brad (GHL) for GoHighLevel configuration.

Effort for IAOS rows is measured in Jeff sessions:

- S -- less than one Jeff session
- M -- one to three Jeff sessions
- L -- more than three Jeff sessions

Effort for Brad (GHL) rows is wall-clock:

- S -- under an hour
- M -- an afternoon
- L -- a project

Status is one of Open, Blocked, Pending, Done, Deferred, Parked,
Ongoing, or Future. A Blocked row names what it waits on.

This document records what to build next. The PHASE_B_SPEC decisions
record how IAOS must behave. Keep them separate.

## P1 -- Daily workflow

| Item | Platform | Priority | Value | Effort | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Exclude terminal-stage contacts from both queues | IAOS | P1 | High | S | Jeff | Done |
| Exclude opt-outs from Unanswered Inbound | IAOS | P1 | High | S | Jeff | Done |
| Call or note clears the unanswered flag | IAOS | P1 | High | S | Jeff | Open |
| Define disposition effect on queue placement | IAOS | P1 | High | S | Brad | Open |
| Live disposition test (real softphone call) | IAOS | P1 | High | S | Brad | Done |
| Apply PB-D48 classification to FIELD_REGISTER | IAOS | P1 | High | M | Jeff | Open |
| Contact Workspace field editors | IAOS | P1 | High | L | Jeff | Open |
| Contact Workspace conversation parity: SMS + email collapse | IAOS | P1 | High | S | Jeff | Done |
| Seller 2 CTA: ask for the appointment | GHL | P1 | High | S | Brad (GHL) | Done |
| Requested Appointment workflow automation | GHL | P1 | High | M | Brad (GHL) | Done |
| Incorrect Number: clear phone to Previous Phone | GHL | P1 | High | S | Brad (GHL) | Open |
| Seller 3: remove from Seller 6 on appointment booked | GHL | P1 | High | S | Brad (GHL) | Done |
| Refresh IAOS_WEBHOOK_SECRET and repair stale app/.env | GHL | P1 | High | S | Brad (GHL) | Done |
| Shared GHL config module, Contact Workspace path | IAOS | P1 | High | M | Jeff | Done |

Queue filtering is the highest-value work on this list. A contact moved
to Lost / Not Interested still appears in Waiting on Me, and opt-outs
whose inbound body is STOP sit permanently at the top of the highest
priority section. Both were found in live use on 2026-08-06. Detail is
recorded in this file only. PB-D49 covers the terminal-stage half and
PB-D50 the opt-out half; both were implemented and verified live on
2026-08-07.

The live disposition test closed CONTACT_WORKSPACE_SPEC_v2 section 9.4 on
2026-08-07, and nothing on that surface is outstanding. A real dispositioned
call wrote both the note and a fresh last_call_attempt, and X-IAOS-Secret
passed, so the GHL Custom Value and the Netlify env var agree. One open
observation: the note duration read 10s against a 19-second Call Summary,
so that number is not call length.

Four GHL rows sit above the remaining IAOS work. The Seller 2 CTA
shipped 2026-08-10: Wait 15 Min followed by Send SMS - Seller Booking
Link carrying go.investorautomationos.com/seller-calendar. Verified
live from the Seller 2 execution log -- wait finished, SMS executed,
Remove from Workflow ran after it. That ordering required moving
Remove from Workflow to the bottom; in its prior position it
terminated every run at step 6.

The routing still depends on it: when the Requested Appointment
disposition is recorded, GHL determines whether an appointment exists.
If one exists, the contact continues through Seller 3 -- Appointment
Booked. Otherwise the contact is enrolled in Seller 2 -- Engagement
Detected, whose purpose is to obtain the appointment through automated
follow-up. Seller 3's trigger is Appointment status, filtered to event
type Normal, status confirmed, calendar Seller Calendar Consultation,
so it fires on a real booking and not on the disposition tap. No
workflow currently listens on the Requested Appointment disposition.

Seller 3 did not remove a contact from Seller 6 -- Follow-Up Reminder.
A contact who booked stayed enrolled in Seller 6 and would later have
the opportunity moved to Long-Term Nurture by Seller 6's tail,
overwriting Seller Call Booked. Found and fixed 2026-08-10 by adding
Seller 6 to Seller 3's Remove from Workflow list, now four workflows.
Two contacts were enrolled at the time of the fix.

Seller 2's Add to Workflow -- Seller 6 is skipped for a contact already
enrolled in Seller 6. Allow re-entry governs re-entry after leaving; a
still-enrolled contact is skipped regardless of that setting. Observed
2026-08-10, recorded so the absent execution-log row is not
rediscovered as a defect.

Requested Appointment routing shipped 2026-08-10 as a separate workflow,
Seller 2.5 - Routing Requested Appointment Disposition. Trigger Call
details, Custom disposition contains any of Requested Appointment;
single action Add to Workflow, Seller 2 - Engagement Detected.
Published. The architecture is GHL-native by decision: GHL already
holds the disposition at the originating trigger, so routing needs no
IAOS change, no new custom field, and no expansion of the write
contract. The alternative considered and set aside was persisting the
disposition to a contact field for GHL to watch; that remains available
if durable disposition state is later wanted for queue placement, and
should be authorized for that reason rather than as a side effect of
routing.

Verified live 2026-08-10 by a real dispositioned call on Brad Thompson
9fbH2VCcZvzVNhsR9zjc. Two findings, one of them general.

Seller 2.5 executed and Seller 2 did not enroll. Seller 2 has Allow
re-entry OFF and the contact had completed Seller 2 at 4:42 pm the same
day, so the add was rejected on re-entry. This is the accepted
behavior: a contact already in Seller 2 is already in the sequence that
asks for the booking, and restarting it buys nothing. The unresolved
case is a contact who completed Seller 2 earlier and later taps
Requested Appointment, which is what this test exercised. Turning
re-entry ON was rejected because it changes Seller 2 for every
enrollment path. A Remove-then-Add sequence inside Seller 2.5 was also
rejected: with re-entry OFF the re-add fails too, leaving the contact
removed and not re-enrolled, which is worse than the skip.

Add to Workflow logs Executed whether or not the receiving workflow
accepts. Seller 2.5's execution log read Executed at 5:49:28 pm while
Seller 2's Enrollment history shows nothing after 4:26:54 pm. The
sending workflow's log therefore cannot verify an enrollment; only the
receiving workflow's Enrollment history can. This is general GHL
behavior, not specific to these two workflows.

Requested Appointment is the second of the six dispositions proven end
to end through ghl-disposition.ts; No Answer was the first, at
CONTACT_WORKSPACE_SPEC_v2 section 9.4. The note read
Call: Requested Appointment -- 2s against a 6-second Call Summary,
repeating the duration discrepancy already recorded there.

A Contact changed workflow trigger exists and was characterized 2026-08-10
without being used. It fires on selected contact fields only, targets an
individual custom field by name, and offers Has changed and Has changed
to, the latter with a free-text value input. That is the mechanism a
persisted-disposition design would use. Recorded as verified rather than
assumed so the design does not have to re-establish it.

Contact Workspace conversation parity shipped 2026-08-11 as D5 in
CONTACTS_DETAIL_SPEC, which superseded the section 3 preservation of the
TYPE_EMAIL-only filter. ContactWorkspace.tsx now allows TYPE_EMAIL and
TYPE_SMS, and email bodies clamp to five CSS line boxes with an Expand
control shown only on measured overflow. Implementation b134755, harness
cfd56b2 at exact floor 136, verification record at
CONTACT_WORKSPACE_SPEC_v2 section 9.6. Run result 136 of 136, zero
failures.

The workflow-notification interleave that section 8.7 of
CONVERSATIONS_SPEC warned about was measured on two fixtures before
shipping rather than after. On Brad's own contact record 24 of 28 SMS
were internal notifications, because GHL delivers every workflow
notification to him and his record is where they land. On a real seller,
Ronald Gordon, the ratio is one notification in three SMS and the other
two are a genuine exchange, including an inbound question that had been
sitting unanswered and invisible on this surface. The 24-of-28 figure is
an artifact of Brad's record being structurally unlike a seller's, and
does not generalize. No second filter was added. The observation
section 8.7 asked for arrived before the ship rather than after it, and
it supported shipping.

Two branches are recorded as unexercised rather than covered. No email
body anywhere in the location is short enough to fit inside five line
boxes, so the case where an email does not overflow and renders no
control has no fixture and no check. And section 9.6's bundle-identity
proof inspected the served artifact for the new allowlist and the Show
less string rather than running section 9.2's parent-versus-child hash
discrimination. Both are named in section 9.6; neither is pending work.

Webhook secret timeline, corrected 2026-08-11. The production
IAOS_WEBHOOK_SECRET exposure was closed on 2026-07-24, when the value was
rotated in both the GHL Custom Value and the Netlify environment after
Netlify secret-scanning identified that the previous value matched the
publicly documented Brad fixture contact identifier. That scan failed
harness commit 9ff7ab0 from publishing, which is how the problem
surfaced. SESSION_HANDOFF records that no repository edit was required,
because the production secret lives only in Netlify and GHL.

The 2026-08-10 rotation did not close an ongoing production exposure. It
refreshed the production secret and repaired a stale local development
configuration. Inference, supported by two sources: the July 24 handoff
explicitly states no repository update accompanied the production
rotation, and on August 10 the local app/.env value still matched the
original Brad fixture contact identifier. Together these support that the
local development file retained the pre-July-24 value until it was
updated during the August 10 maintenance. The filesystem cannot confirm
this directly, since app/.env's modification time was reset by the
August 10 edit.

Live verification after the August 10 rotation consisted of a successful
Voicemail disposition end to end, demonstrating that the current GHL
Custom Value and Netlify environment variable remain synchronized and
authenticate correctly. This establishes the current production
configuration; it is not evidence about the July exposure window. Note
that app/.env governs local runs only. The two values that must agree for
ghl-disposition to authenticate are the GHL Custom Value and the Netlify
environment variable, and the Voicemail write is the only evidence they
do.

The general lesson stands and is the reason this entry exists: a secret
must not be any value that appears anywhere in a public repository,
including identifiers that read as harmless. Netlify secret-scanning is
the detection mechanism that caught it once and would catch a
recurrence.

Boundary: IAOS records dispositions. GHL owns workflow enrollment,
branching, timers, and automated communications.

Incorrect Number is the third GHL row and needs no IAOS change at all.
On that disposition, GHL copies the primary phone into Previous Phone
and clears the primary. The Lead Queue already filters on a non-empty
phone, so the contact leaves the queue on the next load and returns
when a valid number is entered. Previous Phone is named neutrally
because the disposition records what the person said, not a proven
fact about the number. One consequence, accepted: the contact still
appears in the Contacts grid with an em-dash for a phone, but nothing
anywhere flags that it needs a new number. A "needs a phone number"
view is a later P2 item.

## P2 -- Investor experience

| Item | Platform | Priority | Value | Effort | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Opportunity create and edit depth | IAOS | P2 | High | L | Jeff | Open |
| Contact search improvements | IAOS | P2 | Medium | M | Jeff | Open |
| Navigation and cross-surface flow | IAOS | P2 | Medium | M | Jeff | Open |
| Conversations send and compose path | IAOS | P2 | High | L | Jeff | Deferred |
| Calendars booking and reschedule | IAOS | P2 | Medium | L | Jeff | Deferred |
| Complete identifier conversion for test-location readiness | IAOS | P2 | Medium | L | Jeff | Open |

Conversations and Calendars both shipped read-only. Their write paths
are separately scoped later phases per the master architecture
reference, not omissions.

The shared configuration module shipped 2026-08-10 as PB-D51 and was
verified live. It covers the Contact Workspace path only -- the
location id across all of app/, contact custom-field ids, and the two
Contact Workspace folder ids. MaoCalculator, the marketing-site
functions, the pipeline stage UUIDs, Dashboard terminal stages, and
the app/scripts harnesses still hold literals by deliberate scope
decision. Each converts when its own surface becomes active work,
which is the test-location readiness row above. That row is a
dependency of any usable GHL test location, not optional cleanup:
until it lands, a test build still reads production stage and
pipeline ids.

## P3 -- Platform

| Item | Platform | Priority | Value | Effort | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Multi-tenant OAuth | IAOS | P3 | High | L | Jeff | Deferred until client #1 |
| Agency Pro subscription | GHL | P3 | High | S | Brad | Deferred until client #1 |
| Inbound auth on remaining functions | IAOS | P3 | High | M | Jeff | Deferred |
| ghl-proxy OAuth successor | IAOS | P3 | High | L | Jeff | Deferred |

The function surface is fourteen entrypoints across two directories,
per the inventory correction in FUNCTION_SURFACE_AUDIT. Of the five
characterized so far, only ghl-disposition.ts has inbound
authentication. The earlier figure of seven was unsourced. The
deferral is deliberate and the named trigger is the first user who is
not Brad. The repository is public, established 2026-08-10 from an
unauthenticated GitHub API request returning 200. That does not expose
the functions themselves, which are unauthenticated regardless of who
can read the source, but it does mean their URLs, their request shapes,
and the absence of auth on each are discoverable without guessing. The
single-tenant argument for deferring still stands; the assumption that
an attacker would have to find these endpoints does not.
ghl-proxy is the highest-consequence of these: it forwards any
method to any GHL path with the private token, and its own docblock
names the OAuth successor as the Phase B fix. Detail is in
FUNCTION_SURFACE_AUDIT.

OAuth requires GHL Agency Pro at $4,970 per year. Starter issues only
Location API keys. This is a purchase decision before it is an
engineering one.

## P4 -- Technical debt

| Item | Platform | Priority | Value | Effort | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Resolve the Phase B naming collision | IAOS | P4 | Medium | S | Jeff | Open |
| Amend provenance markers for direct reads | IAOS | P4 | Medium | S | Jeff | Done |
| Record transport findings in JEFF_OUTPUT_RULES | IAOS | P4 | Medium | S | Jeff | Done |
| Retention decision on the apply-*.cjs scripts | IAOS | P4 | Low | S | Brad | Open |
| Backlog grooming | IAOS | P4 | Medium | S | Brad | Ongoing |

The Phase B label denotes multi-tenancy in the master architecture
reference and the field write-proving arc in PHASE_B_SPEC. Recorded at
PB-D48, renaming deferred.

The provenance vocabulary at FUNCTION_SURFACE_AUDIT now requires every
OBSERVED finding to name its source. The vocabulary is shared with
PHASE_B_SPEC. The communication format that carries it is recorded in
ALIGNMENT_PROCESS.

## P5 -- Research and validation

| Item | Platform | Priority | Value | Effort | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Verify no workflow fires on contact-field write | GHL | P5 | High | S | Brad | Open |
| Tier cadence demotion verification | GHL | P5 | Low | S | Brad | Parked |
| Identify the Long-Term Nurture bulk-move mechanism | GHL | P5 | Low | S | Brad | Open |
| Decide rescore behavior after edits exist | IAOS | P5 | Low | S | Brad | Open |
| AI layer | IAOS | P5 | Medium | L | Jeff | Future |
| Map view | IAOS | P5 | Low | L | Jeff | Future |

The workflow-trigger check is the load-bearing premise of PB-D48's
classification rule. That decision is scoped to the currently
implemented workflows and specifies reclassification if a new one is
found, so the check is a sanity confirmation rather than a blocker.

Rescoring is inert today because scores drive mail-group assignment
only. If rescore-all runs after fields have been edited, some contacts
will change mail group. The consequence is a few misrouted mailers, not
a broken lead state.

The Long-Term Nurture bulk move is a provenance question, not a
blocker. Thirty-seven opportunities entered that stage inside a
61-second window on 2026-07-20 -- the stage holds thirty-eight, the
other having moved separately -- after being created in a four-second
import window on 2026-07-01. PB-D52 records the observation and
concludes only that current stage occupancy cannot serve as an
engagement signal; nothing operational depends on knowing which
mechanism moved them. Answering it requires GHL Enrollment history,
which the public API does not expose -- /workflows/ returns the
workflow list, and /workflows/{id}, /enrollments, /contacts, /actions
and /history all 404. Seller 8 - Long-Term Nurture is
c5fad4f8-393e-4a9c-92f0-187a4c54218a; enrollments stamped 2026-07-20
near 18:23 would establish the move as workflow-driven, and their
absence would establish it as coming from outside any workflow.
