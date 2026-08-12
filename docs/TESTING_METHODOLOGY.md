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