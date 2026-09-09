# AGENTS.md — the IAOS engineering entry point

Read this before doing anything in this repository. It is the same entry
point for every engineering agent — Claude Code, Codex, or any successor.
`CLAUDE.md` points here rather than restating it, so there is one IAOS
doctrine and not one per tool.

**IAOS governs its tools.** Tools adapt to IAOS; IAOS does not reshape
itself around a tool's preferred workflow. A tool's observed limitation is
a fact to record. A tool's preference is never IAOS policy.

## Primary objective

IAOS's immediate objective is to help the investor operate successfully:

    seller lead -> contact -> conversation -> qualification -> underwriting
    -> real offer -> contract -> buyer -> Dollar #1

When authorized work competes for priority, prefer the work that materially
advances that chain. Dollar #1 wins ties. Evidence, safety, scope and
existing product rulings constrain execution; they do not replace the
objective.

## What this repository is

Two deployed surfaces, and the governing record:

    /            the public marketing site
    app/         the IAOS investor application, with its own Netlify
                 functions, verification harnesses and netlify.toml
    docs/        doctrine, decisions, specifications, evidence

The IAOS investor application under `app/` is the primary engineering
surface. The marketing site is a separate IAOS surface and must not be
mistaken for the application. `CLAUDE.md` describes the marketing site only.

## Read these before making a claim about IAOS

    docs/FOUNDATIONAL_PRINCIPLES.md     how decisions are made. Section I
                                        governs every factual claim made in
                                        this project, agents included
    docs/PHASE_B_SPEC.md                every PB decision, PB-D1 onward
    docs/ALIGNMENT_PROCESS.md           the claim / source / recommendation
                                        format, and when it is required
    docs/JEFF_OUTPUT_RULES.md           the evidence standard for reporting
    docs/SELLER_ACQUISITION_WORKFLOW.md what IAOS is being built toward

A decision's amendments govern, not its original text. Verify a claim
against a decision's LAST statement on a point, never its first (PB-D43).

## Resolution order — what to do when you do not know

Promoted here from a Brad/Jess ruling, 2026-09-01. This file promotes the
ruling into the canonical record.

1. **Read IAOS.** Inspect the governing documents, the current code and the
   relevant evidence. This record exists in part so Brad does not answer
   the same question twice. Do not substitute conversation memory, a
   session summary, a rollover prompt or recollection for a source that can
   be read directly.

2. **If IAOS already answered it, follow the ruling.** Do not reopen a
   settled decision because another approach seems attractive or a tool
   prefers a different one. If new evidence materially undermines a
   decision's premise, surface the evidence and say why reconsideration may
   be warranted — never silently replace the ruling.

3. **If a factual input is missing, establish it.** Repository state,
   implementation behaviour, runtime behaviour, GHL capability, external
   product capability, cost. Do not ask Brad to research what the
   engineering team can establish itself.

4. **If a Product Owner decision remains, ask Brad.** Intent, operator
   preference, product behaviour, business policy, scope, priorities,
   acceptable tradeoffs, authorization. Do not guess, do not manufacture
   policy, and do not decide what Brad "probably wants" in order to keep
   moving. Bring the smallest useful decision, and say what you checked.

5. **While waiting on Brad, continue only work that is already authorized,
   clearly independent, and cannot reasonably be invalidated by his
   answer.** Never continue through the unresolved decision itself.

Asking Brad a necessary question is not a failure or an interruption.
Asking him one the record already answers is.

## Hard constraints

Stated here rather than by reference, because a reference is one skipped
read away from a violation that review cannot undo.

**HARD NO** — `CONTACTS_OPPORTUNITIES_SPEC.md` §4.1. Tags, pipeline stage,
`offer_` fields, workflow triggers. IAOS never fires a workflow. No write
class relaxes this.

**`contact.do_not_mail` is never editable in IAOS, under any write class.**
It gates physical mail to real sellers.

**No field is written before its own inert-proof.** Whether a field change
fires a GHL workflow is not API-derivable, so no field is writable on
assumption. `dataType` proves serialization; it does not prove safety.

**The three sanctioned writes, and no fourth:** `ghl.notes.create()`,
`ghl.contacts.setLastCallAttempt()`, `ghl.contacts.setCallbackDatetime()`.

**GHL is the sole system of record.** No app-side shadow copy. Inspect the
wire before designing the screen.

**One conceptual change is one revert boundary.** No opportunistic cleanup.
Where adjacent work looks valuable but sits outside the authorized scope,
surface it rather than doing it.

**Production writes, real-contact effects, secrets and configuration, and
irreversible actions require Brad's explicit authorization.**

## Editing technique

**Check line endings on the target file before scripting an exact-text
edit.** OBSERVED 2026-08-14: the working tree contains both LF and CRLF
documents (`UNDERWRITING_WORKSPACE_SPEC.md` was pure CRLF while
`SESSION_HANDOFF.md` was pure LF). Match the file's observed line
endings; never assume them from another file. A pattern joined on the
wrong terminator matches zero times and a shape guard reports success.
`tr -cd '\r' | wc -c` against `tr -cd '\n' | wc -c` is the reliable
check; `file` and `cat -A` have both misreported this repo at least
once.

**Guarded scripts over hand edits.** Any multi-file or exact-text edit
goes through a validate-all-then-write script that aborts on a count
mismatch rather than through find-and-replace in the editor. A partial
write that leaves files disagreeing is worse than none, and can look
like a completed edit.

**Open infrastructure gap: `.gitattributes` is missing and
`core.autocrlf` is true.** OBSERVED 2026-08-17: Git normalizes to LF in
the object store and writes CRLF to the working tree, so a file's
line-ending convention reflects how recently Git touched it rather than
how it was authored -- `resolver.ts` was LF in the morning and CRLF by
afternoon, converted by a stash cycle. The guarded-scripts rule above
asserts uniformity and derives the newline from what it finds, which is
correct regardless, but the underlying gap is real. Tracked as technical
debt at `PRODUCT_BACKLOG.md` P4. `git add --renormalize .` would rewrite
the entire repository and must not land anywhere near a write path --
design the fix first, as its own isolated commit.

## `pnpm check` does not pass, and must not be "fixed"

`pnpm check` fails today with two pre-existing `TS2339` errors in
`client/src/components/Navigation.tsx`. They belong to the marketing site,
are unrelated to the IAOS application, and are deliberately unfixed.

Repairing them means editing the published marketing site in order to green
a CI step. Do not. CI runs scoped checks instead; `.github/workflows/ci.yml`
explains its own scope, and this exclusion, at length.

## Reporting

Any command whose output supports a conclusion prints its literal stdout and
stderr, followed by the literal exit code as `exit=<n>`. Prose about what a
command did is not evidence — "passed", "0 matches" and "as designed" are
statements about output, not output. Summaries follow the raw output; they
never replace it. `JEFF_OUTPUT_RULES.md` carries the rule and the failures
that produced it, and it governs every engineering agent, not only Jeff.

Classify every finding OBSERVED, INFERRED or UNKNOWN, and never collapse the
three. An OBSERVED claim names its source. "Nobody has checked" is UNKNOWN,
and saying so is always available.

## Provenance of this file

Everything above is sourced from the governing record except the following
rules, which are promoted here from the Brad/Jess ruling dated 2026-09-01 and
become canonical through this file:

    Primary objective       the Dollar #1 chain and the tie-break rule.
                            The term appears at JEFF_BRIEF_BOARD4_MEASUREMENT
                            but is defined here for the first time.
    Round-peg statement     IAOS governs its tools.
    Resolution order        all five steps.
    Revert boundary         one conceptual change is one revert boundary,
                            and no opportunistic cleanup.
    Authorization rule      the practice is evidenced (SESSION_HANDOFF,
                            FUNCTION_SURFACE_AUDIT) but no general rule
                            was previously stated.
    Editing technique       the line-endings-before-edit and
                            guarded-scripts rules, and the .gitattributes
                            open item. Rescued 2026-09-09 from
                            SESSION_HANDOFF git history (OBSERVED
                            2026-08-14 and 2026-08-17 respectively) during
                            that file's wholesale replacement, per Brad's
                            ruling that standing rules living only in a
                            rolling handoff are functionally lost.

Everything else cites a document that can be read: FOUNDATIONAL_PRINCIPLES.md,
CONTACTS_OPPORTUNITIES_SPEC.md §4.0 and §4.1, PHASE_B_SPEC.md,
JEFF_OUTPUT_RULES.md, PRODUCT_BACKLOG.md and .github/workflows/ci.yml.
