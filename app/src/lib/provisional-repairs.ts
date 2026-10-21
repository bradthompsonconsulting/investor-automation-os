/**
 * Incomplete repairs -> provisional presentation. B15-26 (INV-134) with
 * B15-01 (INV-100); Jess ruling 2026-10-21 on Spock's Test finding (a green
 * "Meets" spread status shown while every repair row was unknown).
 *
 * Pure wording only. Completeness is never inferred from an amount: a known
 * total of $0 can be complete (explicit $0 / Good answers) or incomplete
 * (nothing answered). The caller passes the repair estimate's own
 * `incomplete` flag (operator-model.ts) -- no math, no allowance, no change
 * to the known-only total.
 */

/** The repair estimate's own completeness, plus its known-only total. */
export type RepairCompleteness = { incomplete: boolean; knownRepairs: number };

export const PROVISIONAL_HEADLINE = "Provisional — repairs incomplete.";
export const KNOWN_REPAIRS_INCOMPLETE_LABEL = "Known repairs (incomplete)";
export const PROVISIONAL_SPREAD_LABEL = "Provisional spread";
export const PROVISIONAL_NET_LABEL = "Provisional estimated net";

/** `knownRepairsText` is the already-formatted known-only total, e.g. "$0". */
export function provisionalSupportText(knownRepairsText: string): string {
  return `Based on known repairs of ${knownRepairsText}. Complete the repair estimate before assessing profitability.`;
}
