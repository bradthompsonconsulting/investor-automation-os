/**
 * Repair Estimation V1 -- the small common-repair reference table.
 *
 * These six rows are the complete authorized value set of V1, transcribed
 * from the governing 2026-09-02 amendment in
 * docs/ESTIMATED_REPAIRS_STANDARD.md. Nothing else in IAOS may supply a
 * repair amount on its own authority.
 *
 * There are no square-footage bands for these reserves. The IAOS POLICY
 * amounts are conservative underwriting placeholders -- Wholesaler
 * Underwriting Reserves -- and are not contractor bids. They are neutral
 * policy values, not amounts selected for any market.
 *
 * The table grows only after a recurring real-world need is observed and
 * a normal value is approved. Anticipated future needs do not authorize
 * rows, coefficients, ranges or derivation machinery in V1.
 */

import type { Condition, MajorSystem, ReferenceRow } from "./types";

export const REFERENCE_TABLE: readonly ReferenceRow[] = [
  {
    system: "roof",
    conditions: ["replace", "unknown"],
    amount: 15000,
    provenance: "IAOS_POLICY",
    overrideAllowed: false,
    note: "Wholesaler Underwriting Reserve",
  },
  {
    system: "electrical_whole_house",
    conditions: ["replace", "unknown"],
    amount: 12500,
    provenance: "IAOS_POLICY",
    overrideAllowed: false,
    note: "Wholesaler Underwriting Reserve",
  },
  {
    system: "plumbing_sewer",
    conditions: ["major", "unknown"],
    amount: 12500,
    provenance: "IAOS_POLICY",
    overrideAllowed: false,
    note: "Wholesaler Underwriting Reserve",
  },
  {
    system: "foundation",
    conditions: ["material_issue", "unknown"],
    amount: 15000,
    provenance: "IAOS_POLICY",
    overrideAllowed: true,
    note: "Wholesaler Underwriting Reserve; operator may override",
  },
  {
    system: "hvac",
    conditions: ["replace", "unknown"],
    amount: 6500,
    provenance: "BOOK",
    overrideAllowed: false,
    note: "Accepted cost-book value",
  },
  {
    /**
     * Priced only when panel replacement is the actual scope. It is
     * deliberately not reachable from `unknown`: an unestablished
     * electrical condition is the whole-house reserve, not this row.
     */
    system: "electrical_panel",
    conditions: ["replace"],
    amount: 2500,
    provenance: "BOOK",
    overrideAllowed: false,
    note: "Accepted cost-book value; not the whole-house reserve",
  },
];

/**
 * The authorized row for a system and condition, or null when the table
 * does not price it. Null is not zero: the caller keeps the line blank
 * for operator entry, and it remains an unpriced risk until a known
 * amount is entered. IAOS never invents or derives the missing price.
 */
export function findReferenceRow(
  system: MajorSystem,
  condition: Condition,
): ReferenceRow | null {
  for (const row of REFERENCE_TABLE) {
    if (row.system === system && row.conditions.indexOf(condition) !== -1) {
      return row;
    }
  }
  return null;
}
