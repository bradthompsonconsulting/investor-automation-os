/* Evidence artifact environment provenance — Gate 4C C4a, Stair P-1.
 *
 * WHAT THIS EXISTS FOR. Environment-owned identifiers cross file boundaries
 * through persisted evidence. A producer resolves them under its own parsed
 * ENV, writes them into an artifact, and a later consumer reads them back and
 * uses them. Per-file source-level environment coherence cannot see that
 * crossing, because a filesystem read is not a lookup: the consumer can be
 * perfectly coherent about its own ENV and still consume seven identifiers
 * resolved under a different one.
 *
 * The repair is an explicit stamp written by every producer and an explicit
 * assertion at every consumer read site that takes an environment-owned value
 * out of an artifact.
 *
 * ── WHAT THIS MODULE DOES NOT DO ───────────────────────────────────────────
 * These are the architectural boundary, not style notes. They are here so they
 * outlive whoever reads this next.
 *
 *   does not resolve environment configuration
 *   does not read the carrier
 *   does not choose an environment
 *   does not become a generic evidence-record builder
 *
 * THE CALLER OWNS ENV. This module only records or checks what it is given.
 * It has no default, no fallback, and no opinion about which environment is
 * correct. If it ever grows one, the assertion below stops being independent
 * of the thing it validates and becomes worthless.
 *
 * It also does not know what a record contains. The 27 evidence schemas across
 * this family are deliberately distinct and stay that way — producer
 * invariance means invariant provenance semantics, NOT a unified record shape.
 * stamp() returns a fragment to spread; it never builds a record.
 */

/* Exit code for an artifact environment provenance refusal.
 *
 * Lives here so every present and future consumer inherits one convention
 * rather than reproducing it. Nothing hardcodes the number.
 *
 * 6 is free across the FULL PLANNED ADOPTION POPULATION of 36 files, measured
 * by behaviour across all four exit mechanisms in use: direct literals,
 * fail(code, …), finish(outcome, code), and ternary-carried forms. A
 * literal-only scan is not sufficient — it misses roughly sixty codes on
 * closing-costs alone and nine on the runner. 6 also sits adjacent to 4, the
 * existing cross-cutting environment/argv refusal used with the same meaning
 * on more than one surface, and outside every family and stage block.
 *
 * WHY THIS CHANGED, because the widening is the useful part. This constant was
 * 60. That was CORRECT against the contact surface as measured at the time: 60
 * was genuinely free there against the 29 codes then in service. It became
 * unsuitable the moment the complete adoption surface was measured —
 * inert-proof-opp-closing-costs-step4.cjs L60 already owns 60 for "cannot read
 * step 1 evidence", so a provenance refusal there would have been numerically
 * indistinguishable from an unrelated failure. The constant widened from
 * surface-local measurement to full-adoption measurement. It was not that 6
 * had always been the answer; it is that the question was scoped too narrowly.
 *
 * BOTH failure modes exit 6. The MESSAGE distinguishes a legacy artifact from
 * a detected crossing — the operator needs to tell those apart, but the shell
 * only needs to know the run refused on provenance. Do not split this into two
 * codes without deciding what a caller would do differently with each. */
const PROVENANCE_REFUSAL = 6;

/** The environment stamp, for spreading at the head of a record next to
 *  timestamp. Takes the caller's ALREADY-PARSED env verbatim — not a selector
 *  expression, not a derived label, exactly what the caller parsed. */
function stamp(env) {
  return { environment: env };
}

/** Validates one artifact against an ALREADY-PARSED env, at one read site.
 *
 *  sourceLabel names WHICH artifact failed. A consumer reading two artifacts
 *  needs the message to say which one or the operator is left guessing, and
 *  several consumers here read two.
 *
 *  Refuses rather than returning a boolean: a caller that could ignore the
 *  result is a caller that eventually does. */
function assertEnvironment(artifact, env, sourceLabel) {
  const recorded = artifact == null ? undefined : artifact.environment;

  if (recorded === undefined || recorded === null) {
    console.error(
      `REFUSED: ${sourceLabel} carries no environment stamp. It predates the ` +
      `environment provenance contract, so the environment that produced its ` +
      `identifiers is unrecorded and cannot be checked against "${env}". ` +
      `Refusing rather than assuming.`
    );
    process.exit(PROVENANCE_REFUSAL);
  }

  if (recorded !== env) {
    console.error(
      `REFUSED: ${sourceLabel} was produced under environment ` +
      `"${recorded}", but this consumer parsed "${env}". Identifiers from ` +
      `that artifact belong to a different environment. Refusing rather than ` +
      `consuming them across the boundary.`
    );
    process.exit(PROVENANCE_REFUSAL);
  }
}

module.exports = { stamp, assertEnvironment, PROVENANCE_REFUSAL };
