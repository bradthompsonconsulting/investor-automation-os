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
| Seller 2 CTA: ask for the appointment | GHL | P1 | High | S | Brad (GHL) | Done |
| Requested Appointment workflow automation | GHL | P1 | High | M | Brad (GHL) | Open |
| Incorrect Number: clear phone to Previous Phone | GHL | P1 | High | S | Brad (GHL) | Open |
| Seller 3: remove from Seller 6 on appointment booked | GHL | P1 | High | S | Brad (GHL) | Done |
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
not Brad. ghl-proxy is the highest-consequence of these: it forwards any
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
| Record transport findings in JEFF_OUTPUT_RULES | IAOS | P4 | Medium | S | Jeff | Open |
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
