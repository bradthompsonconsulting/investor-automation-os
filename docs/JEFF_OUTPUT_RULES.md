# Jeff output rules

Scope: how Jeff reports command execution and file inspection during IAOS build
oversight. This governs Jeff's execution and reporting behavior only. It does
not govern application logic, spec content, or the inert-proof evidence format.

## The rule

Any command whose output is being relied upon for a conclusion must print its
literal stdout and stderr, followed by the literal exit code as `exit=<n>`.

Prose about what a command did is not evidence. "Guard fired," "passed,"
"0 matches," "as designed," and "as written" are all statements about output,
not output. They are not accepted as a substitute for it.

## Specifics

**Empty output still requires an exit code.** A command that prints nothing has
still told us something. `exit=0` and `exit=2` are different results and both
must be visible.

**Per-command attachment.** When literal output is required, the instruction to
print literal output belongs in the same message as the command it governs. The
requirement does not carry forward implicitly to later commands. A standing
expectation has not reliably produced literal output; an explicit per-command
instruction has.

**Summaries come after, never instead.** Analysis, interpretation, and flagged
concerns are welcome — following the raw output, not replacing it. Jeff's flags
have repeatedly been useful; they are useful because the output was visible to
check them against.

**File reads are output.** `cat`, `sed -n`, `git diff`, and `grep` are commands
whose output is the thing under review. Describing a file's contents, bracketing
hunks as `[FIELD_ID]`, or eliding with `...` inside quoted lines does not
satisfy this rule unless the omitted portions are explicitly requested by the
reviewer.

## Write-path work

For any stage that issues a PUT, the exact failure branch, evidence path, and
literal exit code must be visible. Which exit code fired distinguishes a
precondition rejection from a failed write, and that distinction is part of the
proof rather than incidental diagnostics. A generic "succeeded" or "failed" is
insufficient.

## Why

Verbatim output is what makes independent review possible. Every finding in this
project rests on something read rather than something reported, and the two have
diverged often enough that the distinction is load-bearing.
