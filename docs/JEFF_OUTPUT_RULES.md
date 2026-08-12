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

## Transport corruption -- fixed-column byte loss

On 2026-08-06, physical lines longer than roughly 104 characters were observed to lose bytes beginning at column 105 or 106. OBSERVED in apply-d47-handoff.cjs: four prose strings lost 7, 9, 8 and 8 characters respectively. Re-sending the identical text reproduced the identical four drops. A fifth string of 537 characters spanned the same window and survived intact; the cause is UNKNOWN and this is a mitigation, not an explanation.

Neither node --check nor endsWith assertions detect this. A truncation inside a string literal is still valid JavaScript, and a mid-segment drop leaves the segment tail unchanged.

Mitigation, required for any generated script carrying prose:

- Cap every physical line at roughly 90 characters.
- Split long strings into fragments of about 62 characters, assembled with an array and .join().
- Assert the exact character length of every assembled string against a pinned constant, and place those assertions before the target file is opened, so a corrupt script cannot reach writeFileSync.
- Read the script back with cat -n and verify the fragments rejoin to the approved text before executing.

## The Write tool reports insertions and modifications differently

A Write that reports only "Added N lines" performed a pure-insertion diff. If a full replacement was requested and no modified lines appear, nothing was replaced. OBSERVED on 2026-08-06: a second write of corrected text reported success and "fully replaced", but the diff showed only additions, and read-back confirmed the four corrupt lines were byte-identical to the previous version. Treat a pure-insertion diff on a claimed replacement as evidence the replacement did not happen.

## Memory operations require affirmative authorization

Memory operations are opt-in. Consent is not inferred from prior discussion,
from convenience, or from the operation appearing useful. If authorization is
absent, skip the operation and continue with the requested work.

An explicit refusal is binding for the remainder of the session. Once the
operator declines a memory write, no memory read or write may be performed
without renewed, explicit permission. The correctness of the proposed content is
irrelevant — the instruction governs the action, not the content.

OBSERVED 2026-08-11: after an explicit "decline it" instruction, the staging,
commit, and push steps ran correctly and a memory write was then performed
anyway, reported as "Recalled 2 memories, wrote 2 memories." The content was
accurate and its reasoning about scope was sound. Neither fact bears on the
rule. A prior instance the same week was recorded as unrequested; this one was
performed against a refusal, which is the more serious class.

Treat "do not write memory" exactly as "do not commit" and "do not push" are
treated: an operational constraint, never overridden by perceived helpfulness.

## Memory is not a substitute for the reviewed record

Project state belongs in reviewed, version-controlled documentation. Memory may
carry personal preferences and long-term working context. It must not become a
parallel source of truth for engineering decisions, specifications, verification
state, or project history.

The failure mode is drift, not inaccuracy at the moment of writing. A memory
copy of a spec fact is written once and never reviewed again, while the spec
continues to change. The copy then contradicts the record silently, and the next
session cannot tell which is current. Documentation is greppable, diffable, and
carries provenance; memory has none of those properties.

## The suggested next prompt skips verification steps

The greyed pre-filled input line is a suggestion, not an instruction, and it has
repeatedly proposed the next destructive step while omitting the verification
step that precedes it.

OBSERVED 2026-08-10, twice in one session: after a commit, the pre-filled line
proposed `git push origin main` without the intervening
`git log -1 --format=%s`. That verification exists specifically because the
commit subject has previously been altered while being reported as verbatim. The
suggestion therefore omitted the check guarding against a failure this same
document records.

Read the pre-filled line critically before sending it. It reflects what is
plausibly next, not what the sequence requires.

## A decision's amendments govern, not its original text

Where a decision carries amendments, the amendment states the current
position. The superseded paragraph remains only as a record of what was
believed when it was written. Verify a claim against a decision's LAST
statement on a point, never its first.

OBSERVED 2026-08-12, seven times in one session: PB-D53's Path A — whether
GHL's `Contact changed` trigger fires on the native Phone field — was
reported as UNKNOWN in seven separate summaries. The amendment discharging
it sits in the same section of the same committed file, dated 2026-08-11,
and records the question as OBSERVED against the live GHL builder. The reset
workflow it authorized was subsequently built and both its branches
exercised. Every report quoted the pre-amendment paragraph.

The supersession convention at PB-D43 exists precisely to make the current
position findable. Reading only the earliest statement defeats it.

## Unrequested trailers are output mutation

A commit message is the text supplied, exactly. Appending a trailer, however
conventional, alters a reviewed artifact after review.

OBSERVED 2026-08-12, on every commit in the session: a
`Co-Authored-By: Claude ...` trailer was added to commit messages that did
not carry one. The subject line was unaffected each time, which is why the
`git log -1 --format=%s` verification did not catch it. Verification of the
subject is not verification of the message.

## Read suppression survives redirection

Writing a command's output to a file and then reporting that the file was
written is not reporting the output. The redirect exists so the content can
be read; a summary of the redirect leaves the content unread.

OBSERVED 2026-08-12, five times: instructions of the form
`... > /path/file.txt 2>&1; echo "exit=$?"` were followed by "Written to
/path/file.txt" and a line count or prose characterization, with the file's
contents never surfaced. In one instance the summary reported "51 lines"
for a file whose formatting was the thing under review.

## Find-and-replace must not damage adjacent lines

A replacement is scoped to the text it names. Adjacent lines are not part of
the edit and must survive it byte-identical.

OBSERVED 2026-08-12: a single-line hash replacement in
`verify-conversations.cjs` deleted the `const TARGET` declaration on the
following line. `TARGET` is referenced roughly fifteen times below the
deletion, so the file would have thrown on first use. It was caught by
reading the file back, not by any automated check — the edit produced
syntactically valid JavaScript.

## Truncated output is not output

Output that stops mid-word has failed to transmit, whatever its prefix
suggests. It cannot be relied on for a conclusion and must be re-sent
rather than interpreted.

OBSERVED 2026-08-12, several times late in the session: reported summaries
terminated mid-sentence and mid-word — "noted in the not cover it", "the
reely unexercised", "and they'". Where a message is the evidence, a partial
message is not partial evidence; it is none.