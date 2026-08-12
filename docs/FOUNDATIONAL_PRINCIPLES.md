# IAOS Foundational Principles

This document exists to preserve the quality of decisions as IAOS grows.
It defines the principles by which new ideas are evaluated before they
become architecture, code, or automation.

IAOS has accumulated a set of recurring patterns through dozens of PB
decisions, implementation reviews, verification harnesses, and production
observations. Those patterns were discovered through experience rather than
invented up front -- most of them were paid for by a specific failure, and
several are named below alongside the decision that produced them. This
document captures them so future work begins from the same foundation
instead of rediscovering them feature by feature.

Beginning with PB-D56, new architectural decisions should be evaluated
against these principles before implementation begins. PB-D1 through PB-D55
remain valid and are interpreted according to the rules that existed when
they were written; nothing here reopens them.

This document guides. It does not constrain. The hard constraints live in
their own specifications and are binding in a way these principles are not:
the §4.1 HARD NO on `offer_` fields, tags, pipeline stage and workflow
triggers; the rule that IAOS never writes a field that has not passed its
own inert-proof; the three sanctioned Dashboard writes. Where a principle
here and a constraint there appear to conflict, the constraint governs.

**Where this sits.**

    FOUNDATIONAL_PRINCIPLES.md   How do we think?
            |
            v
    PB Decisions                 What have we decided?
            |
            v
    Specifications               How should it work?
            |
            v
    Implementation               How is it built?
            |
            v
    Verification Harnesses       Did we build what we intended?

---

## I. How We Establish Facts

These principles apply to every factual claim made within the IAOS project,
regardless of whether it appears in conversation, documentation,
implementation notes, code review, or formal specifications. No
participant -- including the assistant -- receives an exception.

**1. Claims are classified.** Every finding is OBSERVED, INFERRED, or
UNKNOWN, and the three are never collapsed. An OBSERVED claim names its
source: a repository read, terminal output, a live application, a wire
response, or a prior decision. "It should work that way" is INFERRED.
"Nobody has checked" is UNKNOWN, and saying so is always available.

**2. Grounded, not remembered.** A claim is verified against the artifact,
not against recollection of the artifact. Inherited context, session
summaries, and confident prose are all starting points for a read, never
substitutes for one. This applies most strongly to numbers: counts, floors,
totals and field sets drift silently and are the most frequently wrong
thing anyone says.

**3. Verify before designing.** Read the wire, the spec, and the code
before designing against any of them. A design built on an assumed
mechanism has to be rebuilt when the assumption fails, and the failure
usually surfaces late. Where a fact is cheap to establish and load-bearing,
establishing it first is never the slower path.

**4. Amendments supersede.** Earlier reasoning is preserved rather than
edited, and later reasoning governs. Verify a claim against a decision's
last statement on a point, never its first. A decision quoted from its
original text when an amendment exists is a decision misread.

**5. A negative result requires its precondition.** An absence proves
nothing unless the state it should have prevented is confirmed present
first. A test that a contact is missing from a queue passes identically
when the contact never existed. Establish the starting state, then act,
then assert.

**6. Verification is independent of the thing verified.** A harness that
imports the constants it checks cannot detect drift in them. A workflow's
own log records that it fired, not that it had an effect. Read the affected
record; read the receiving side.

---

## II. Why We Build

**7. Build toward the sale.** Before design begins, a feature answers: how
does this help acquire, negotiate, or close more properties? If the answer
is unclear, stop. The goal is not to build software. The goal is to move
deals forward.

**8. Every feature advances a milestone.** Name the one it advances --
lead captured, qualification complete, information complete, underwriting
approved, offer presented, seller responded, contract required, closing.
A feature that advances none of these explains why it exists anyway.
Infrastructure and verification work qualify under that explanation; the
requirement is a stated reason, not a milestone in every case.

**9. Eliminate manual work.** Ask what task disappears, what decision
becomes easier, what repetition ends. "It would be nice to have" is not an
answer. If neither workload nor conversion improves, reconsider.

**10. Reach the next decision with the minimum information necessary.**
Ask what is the earliest point at which the next business decision can be
made, not what would be good to know. Motivation is valuable and is not
required to calculate an MAO. Separate the mathematics from the
negotiation.

---

## III. How We Build

**11. One source of truth.** Every fact has exactly one authority. Who owns
it, who writes it, who reads it, and can any other place disagree? If two
places can disagree, redesign. This is why underwriting belongs to the
Opportunity (PB-D55) and why approved values are not mirrored back to the
Contact.

**12. Automation prepares; a person commits.** Automation may gather,
calculate, estimate, recommend, prioritize and draft. A person approves
underwriting, offers, contracts, and anything that moves money or creates a
legal obligation. Approval boundaries are deliberate, explicit, and visible
in the UI. Nothing becomes authoritative because a calculation produced it.

**13. Proposed, approved, and presented are different states.** They carry
different authority and different consequences. Collapsing them into one
carrier means nothing downstream can tell them apart. A proposal is defined
by its lack of authority, not by what produced it.

**14. Derive for display; persist decisions.** A view that can always be
recomputed should be. Queues, states, and rankings are derived. Persist
when the value is a decision someone made, or when a GHL workflow must read
it -- a workflow cannot see a React memo, which is why PB-D53 gave
engagement and reachability durable carriers rather than deriving them.

**15. GHL-first.** GHL is the system of record. Inspect the wire before
designing the screen, and build a custom path only on an observed finding
that GHL has none. IAOS derives intelligence and orchestrates workflow; it
does not create a competing store of business state.

**16. Optimize for reversibility.** Where two designs solve the same
problem, prefer the one that is easier to change later. Shared config over
hardcoded identifiers. Named wrappers over anonymous writes. Proposal
separated from approval. Derived queues over duplicated status flags. The
cost of a wrong reversible decision is an afternoon; the cost of a wrong
irreversible one is a migration.

**17. No abstraction without its first consumer.** A registry with one
entry discriminates nothing. A parameter with one value proves nothing.
Build the general thing when the second case exists, not when it is
anticipated.

**18. Architecture before implementation.** Answer what is authoritative,
what is proposed, what is approved, what is derived, what is persisted, and
what approval boundary exists -- before discussing React, TypeScript, GHL,
or Netlify. Implementation follows architecture, never the reverse.

---

## IV. Before a PB Decision

A new decision should answer every question below that materially applies.
Where a question does not apply, say so and why. A decision about
documentation conventions has no approval boundary and should say that
rather than inventing one.

1. What business milestone does this advance? If none, why does it exist?
2. What manual work disappears?
3. What is the authoritative source?
4. What is proposed, what is approved, what is presented?
5. What is persisted, and what is derived?
6. Does this introduce a second place the same fact can live?
7. What approval boundary exists, and where is it visible?
8. Does this supersede an existing authority? Name it.
9. What is OBSERVED, what is INFERRED, and what remains UNKNOWN?
10. What must be verified before implementation begins?

If the questions that apply cannot be answered, the decision is not ready
to implement. Recording a question as unanswered is a valid answer and is
better than a confident guess; PB-D51 and PB-D55 both shipped with named
prerequisites and were stronger for it.

---

## North Star

Every decision should move a deal closer to closing while reducing
unnecessary human work without compromising the integrity of the business
process.

When two sound designs compete, that sentence decides.
