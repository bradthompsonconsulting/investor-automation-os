# Testing Methodology

Reusable techniques and observed GHL platform behaviors for verifying
IAOS workflows. Findings here are not decisions. Each records what was
observed, when, and what it lets a future test assume.

## GHL platform behaviors

**A failed outbound call still fires the Call details trigger.**
OBSERVED 2026-08-11 and 2026-08-12. A call to a 555 number returns
Call Ended / Failed with a 00:00 duration and the reason "Invalid
destination number or unreachable", and the softphone still presents
the Custom Disposition panel. Selecting a disposition fires Call
details triggers normally. Disposition workflows can therefore be
verified end to end without placing a call to a real person. 555
numbers are valid fixtures for this purpose.

**A backward pipeline stage move requires the previous-stage toggle.**
The Update opportunity action carries "Allow opportunity to move to any
previous stage in pipeline", default OFF. With it off, a move to a
stage earlier than the opportunity's current stage is refused and the
action still logs Executed. Any workflow whose stage move could run
against an opportunity further along the pipeline needs it ON.

**Executed means fired, not effective.** GHL logs an action as Executed
when it ran, not when it changed anything. Three instances OBSERVED:
Update contact field writing an empty value to a SINGLE_OPTIONS field
(2026-08-11, PB-D53); Seller 2.5's Add to Workflow when Seller 2
rejected the contact on re-entry; and the refused backward stage move
above. Verification reads the affected record, never the acting
workflow's log.

**A cross-workflow action is verified from the receiving side.** Add to
Workflow and Remove from Workflow log Executed in the sending workflow
regardless of whether the receiving workflow enrolls or unenrolls. The
receiving workflow's Enrollment history and Execution logs are
authoritative.

**Transient empty endpoint responses are a class, not incidents.**
OBSERVED 2026-08-14, twice, on two different endpoints: the `/contacts`
list, and the per-contact conversations read. Both returned an empty
payload where data existed and both recovered on an immediate re-run
with no code change. The verification harnesses have no retry, so a
transient produces a red run that looks like a regression. A single
harness failure warrants a re-run before it is believed. Collateral
figures moving in lockstep -- body length, scroll height -- distinguish
an empty read from a real data change. Related but distinct from the
list-endpoint eventual-consistency and record-drop finding at
`CONTACT_WORKSPACE_SPEC_v2.md` §11, which is a different mechanism on
the same endpoint family.

## Verification harness maintenance

**Re-pin all verification harnesses to the served bundle after EVERY
app-code deploy, regardless of what kind of file changed or what you
expect.** `app/scripts/repin-harnesses.cjs` does this in one command; run
it, then run the harnesses. The bundle-hash pin lives in multiple files
and drifted three times when edited by hand -- each time a deploy
re-pinned the harness under test and left the others behind, so the next
run aborted at its gate against a bundle nobody had verified.

**Bundle-hash behaviour is unstable. Do not predict it from a rule;
measure it.** An earlier version of this guidance recorded a mechanism --
pure types erase, unimported modules never reach the entry chunk -- and
that mechanism produced a wrong prediction the same day it was written.
The evidence, all OBSERVED 2026-08-14: `f64e37b`, unimported TypeScript
plus a `.cjs` runner -- hash HELD. `d2a6522`, imported config -- hash
MOVED, expected. `0be60c2`, `.cjs` only -- HELD. `a3e4dcf`, unimported
TypeScript plus two edited-but-still-unimported core files -- hash
MOVED, contradicting `f64e37b`. `b357dc1`, `.cjs` only -- HELD. So
`.cjs`-only commits have held twice, and unimported TypeScript both held
and moved. Vite emits content-addressed names and anything altering
build inputs or module ordering can shift one. The operational rule
above is the only durable part -- do not record a live hash literal
anywhere as a substitute for re-pinning; `repin-harnesses.cjs` reading
the served bundle is the source of truth.

## Test construction

**A negative result proves nothing without its precondition.** A test
that a contact is absent from a workflow, or that a field is unchanged,
passes identically when the contact was never enrolled or the field
never set. Establish and confirm the starting state before firing the
action under test. OBSERVED 2026-08-12: two consecutive runs of a
Remove from Workflow test passed vacuously, once because the contact
had no opportunity and once because it reached the terminal stage
without ever entering the cadence being removed from.

**Fixtures start from a true baseline.** A disposable contact created
for the test, with the relevant field absent, discriminates more than a
reused contact carrying state from an earlier run.