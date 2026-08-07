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

Effort is measured in Jeff sessions:

- S -- less than one Jeff session
- M -- one to three Jeff sessions
- L -- more than three Jeff sessions

Owner distinguishes coding work from work only Brad can perform.

This document records what to build next. The PHASE_B_SPEC decisions
record how IAOS must behave. Keep them separate.

## P1 -- Daily workflow

| Item | Priority | Value | Effort | Owner | Status |
| --- | --- | --- | --- | --- | --- |
| Exclude terminal-stage contacts from both queues | P1 | High | S | Jeff | Done |
| Exclude opt-outs from Unanswered Inbound | P1 | High | S | Jeff | Done |
| Call or note clears the unanswered flag | P1 | High | S | Jeff | Open |
| Define disposition effect on queue placement | P1 | High | S | Brad | Open |
| Live disposition test (real softphone call) | P1 | High | S | Brad | Pending |
| Apply PB-D48 classification to FIELD_REGISTER | P1 | High | M | Jeff | Open |
| Contact Workspace field editors | P1 | High | L | Jeff | Open |

Queue filtering is the highest-value work on this list. A contact moved
to Lost / Not Interested still appears in Waiting on Me, and opt-outs
whose inbound body is STOP sit permanently at the top of the highest
priority section. Both were found in live use on 2026-08-06. Detail is
recorded in this file only. PB-D49 covers the terminal-stage half and
PB-D50 the opt-out half; both were implemented and verified live on
2026-08-07.

The live disposition test closes CONTACT_WORKSPACE_SPEC_v2 section 9.4,
which is the only outstanding item on that surface. The webhook path is
built and authenticated but has never fired from a real dispositioned
call. The GHL disposition prompt is transient, roughly one to two
minutes after hangup.

## P2 -- Investor experience

| Item | Priority | Value | Effort | Owner | Status |
| --- | --- | --- | --- | --- | --- |
| Opportunity create and edit depth | P2 | High | L | Jeff | Open |
| Contact search improvements | P2 | Medium | M | Jeff | Open |
| Navigation and cross-surface flow | P2 | Medium | M | Jeff | Open |
| Conversations send and compose path | P2 | High | L | Jeff | Deferred |
| Calendars booking and reschedule | P2 | Medium | L | Jeff | Deferred |

Conversations and Calendars both shipped read-only. Their write paths
are separately scoped later phases per the master architecture
reference, not omissions.

## P3 -- Platform

| Item | Priority | Value | Effort | Owner | Status |
| --- | --- | --- | --- | --- | --- |
| Multi-tenant OAuth | P3 | High | L | Jeff | Deferred until client #1 |
| Agency Pro subscription | P3 | High | S | Brad | Deferred until client #1 |
| Inbound auth on remaining functions | P3 | High | M | Jeff | Deferred |
| ghl-proxy OAuth successor | P3 | High | L | Jeff | Deferred |

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

| Item | Priority | Value | Effort | Owner | Status |
| --- | --- | --- | --- | --- | --- |
| Resolve the Phase B naming collision | P4 | Medium | S | Jeff | Open |
| Amend provenance markers for direct reads | P4 | Medium | S | Jeff | Open |
| Record transport findings in JEFF_OUTPUT_RULES | P4 | Medium | S | Jeff | Open |
| Retention decision on the apply-*.cjs scripts | P4 | Low | S | Brad | Open |
| Backlog grooming | P4 | Medium | S | Brad | Ongoing |

The Phase B label denotes multi-tenancy in the master architecture
reference and the field write-proving arc in PHASE_B_SPEC. Recorded at
PB-D48, renaming deferred.

The provenance vocabulary at FUNCTION_SURFACE_AUDIT defines OBSERVED as
established in the working transcript. There are now two read channels,
one of which Jeff cannot see. The definition should name both.

## P5 -- Research and validation

| Item | Priority | Value | Effort | Owner | Status |
| --- | --- | --- | --- | --- | --- |
| Verify no workflow fires on contact-field write | P5 | High | S | Brad | Open |
| Tier cadence demotion verification | P5 | Low | S | Brad | Parked |
| Decide rescore behavior after edits exist | P5 | Low | S | Brad | Open |
| AI layer | P5 | Medium | L | Jeff | Future |
| Map view | P5 | Low | L | Jeff | Future |

The workflow-trigger check is the load-bearing premise of PB-D48's
classification rule. That decision is scoped to the currently
implemented workflows and specifies reclassification if a new one is
found, so the check is a sanity confirmation rather than a blocker.

Rescoring is inert today because scores drive mail-group assignment
only. If rescore-all runs after fields have been edited, some contacts
will change mail group. The consequence is a few misrouted mailers, not
a broken lead state.
