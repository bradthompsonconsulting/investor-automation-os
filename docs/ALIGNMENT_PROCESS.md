# IAOS Alignment Process

How IAOS development stays synchronized. This document governs
process. PRODUCT_BACKLOG records what to build. PHASE_B_SPEC records
how IAOS must behave. Keep them separate.

## Guiding principle

Read the Purpose and Guiding Principle in PRODUCT_BACKLOG before
technical work. Thirty seconds. It is the difference between
optimizing the next step and optimizing toward what IAOS is for.

## Communication format

Three lines, used where they earn their place.

    Claim: <the assertion>
    What this claim is based on: <the source>
    Recommendation: <one label>

**When the format is required.** Any statement that would change
project priorities, architecture, scope, or sequencing carries both
the source line and a recommendation. That threshold is the point of
the format. "Don't spend three weeks on Contacts" requires it.

**When it is not.** Routine confirmations where the next action is
obvious carry neither. "Push succeeded, terminal output" needs no
recommendation. Applying the full format to every message buries the
statements that matter.

## Recommendation labels

Five.

- Proceed -- implement or accept as-is.
- Verify -- confirm before acting.
- Decide -- needs a product or business decision.
- Block -- cannot proceed until resolved.
- Note -- record it; no immediate action.

Recommendations express the next action, not the confidence of the
claim. The source line already carries that. A repository read
paired with Decide means the code's behavior is certain and the
product behavior is not yet chosen.

## Provenance

**Inference stated as observation is always corrected.**

Every claim names where it came from. A repository read, terminal
output, a wire response, live user observation, inference, or a
prior decision. The OBSERVED definition in FUNCTION_SURFACE_AUDIT
governs the term itself.

**Sources differ in what they can reach. A finding unavailable to
one source is not thereby unestablished.** The execution agent sees
the working tree and command output. A reviewer reading committed
state sees only what is committed, and only as of its last sync.
Only a person using the running application sees its behavior. No
single source is sufficient for every question.

Inherited claims -- from a rollover, a summary, or an earlier
session -- are re-grounded against the current file before they are
acted on. When repository access is available, read from the
repository rather than from a copy or recall.

## Alignment cadence

Monday and Wednesday, roughly thirty minutes.

0. Provenance, 2 min -- state sources.
1. Purpose and Guiding Principle, 1 min -- read them.
2. Progress, 5 min -- what shipped, what was learned.
3. Backlog review, 10 min -- is P1 still highest value; did live
   usage reveal better.
4. Commit, 10 min -- exactly what gets built next; define done.
5. Architecture -- only if blocked. New decisions only when current
   P1 work cannot proceed without one.

## Session kickoff

1. What are my sources?
2. Do I have the current repository state?
3. If not, what do I need to read?
4. What is today's P1 task?
5. What information is missing to complete it?
6. What did the last session's output claim that has not been
   verified from source?

Grounding required matches the task. Product prioritization or
architecture work reads PRODUCT_BACKLOG first. Implementation review
reads the relevant code first. Bug investigation reads the evidence
first.
