/**
 * Repairs canonicalization migration/backfill — pure classification.
 * INV-70 / B9-07A Phase 2, Family 3's approved ruling.
 *
 * Pure. No I/O, no GHL, no React. One deal (one Contact/Opportunity pair)
 * in, one classification out — the migration script (`scripts/inv70-
 * repairs-migration.cjs`) walks every deal in a location and calls this
 * once per deal, so "never overwrite a non-empty authoritative Opportunity
 * value from Contact" and "stop on any conflicting non-empty values, never
 * silently choose one" are properties of this one readable function, not
 * a claim about the script's control flow.
 *
 * THE RULE, STATED ONCE. `opportunity.repair_estimate` is authoritative
 * the moment it is non-empty — full stop, regardless of what
 * `contact.estimated_repairs` holds, matching or not. This function NEVER
 * proposes a write when the Opportunity already has a value; there is no
 * "conflict resolution" branch because there is nothing to resolve — the
 * Opportunity always wins when present. A mismatch is reported
 * (`matchesContact: false`) for human review, never silently resolved by
 * this function or by the script that calls it.
 */

export type RepairsMigrationClassification =
  | {
      /** Opportunity is empty, Contact has a value — safe, zero-risk backfill. */
      kind: "backfill_candidate";
      value: number;
    }
  | {
      /** Opportunity already holds a value. Never touched, regardless of `matchesContact`. */
      kind: "already_authoritative";
      opportunityValue: number;
      /** `false` is a data-quality flag for human review, never a write trigger. */
      matchesContact: boolean;
    }
  | {
      /** Neither carrier has a value. Nothing to migrate, nothing to flag. */
      kind: "nothing_to_do";
    };

export function classifyRepairsMigrationCandidate(args: {
  contactValue: number | null;
  opportunityValue: number | null;
}): RepairsMigrationClassification {
  if (args.opportunityValue !== null) {
    return {
      kind: "already_authoritative",
      opportunityValue: args.opportunityValue,
      matchesContact: args.contactValue !== null && args.contactValue === args.opportunityValue,
    };
  }
  if (args.contactValue !== null) {
    return { kind: "backfill_candidate", value: args.contactValue };
  }
  return { kind: "nothing_to_do" };
}

/** One deal's classification, plus the identifiers needed to act on or report it. */
export type RepairsMigrationRow = {
  contactId: string;
  opportunityId: string;
  contactValue: number | null;
  opportunityValue: number | null;
  classification: RepairsMigrationClassification;
};

/**
 * Summarizes a batch of rows into the counts a migration report needs.
 * Pure aggregation — no GHL, no decision beyond counting what
 * `classifyRepairsMigrationCandidate` already decided per row.
 */
export function summarizeRepairsMigration(rows: RepairsMigrationRow[]): {
  total: number;
  backfillCandidates: number;
  alreadyAuthoritative: number;
  alreadyAuthoritativeMismatched: number;
  nothingToDo: number;
} {
  let backfillCandidates = 0;
  let alreadyAuthoritative = 0;
  let alreadyAuthoritativeMismatched = 0;
  let nothingToDo = 0;
  for (const row of rows) {
    if (row.classification.kind === "backfill_candidate") backfillCandidates++;
    else if (row.classification.kind === "already_authoritative") {
      alreadyAuthoritative++;
      if (!row.classification.matchesContact) alreadyAuthoritativeMismatched++;
    } else nothingToDo++;
  }
  return {
    total: rows.length,
    backfillCandidates,
    alreadyAuthoritative,
    alreadyAuthoritativeMismatched,
    nothingToDo,
  };
}
