/**
 * IAOS Starter Policy -- PB-D56 section IV.
 *
 * The third and last resolution level: Deal Override -> Investor Policy ->
 * IAOS Starter -> unresolved. These exist so a new investor can calculate
 * immediately without first configuring their own policy.
 *
 * These are UNDERWRITING POLICY ASSUMPTIONS, NOT OBSERVED MARKET CONSTANTS.
 * PB-D56 section IV is explicit on that point, and records them as selected
 * under the conservative bias rule: where a reasonable range exists, prefer
 * the assumption protecting wholesaler margin over the one maximizing
 * Seller MAO.
 *
 * These are IAOS product policy, not GHL configuration. They deliberately do
 * NOT live in app/shared/ghl-config.ts, which holds identifiers and
 * environment wiring only.
 *
 * UNITS: percentages are decimal fractions here, matching what the
 * calculation core requires. GHL stores the same values in human units
 * (10 for 10%); converting those is the policy parser's job, not this
 * file's. PB-D56 section IV lists them in human units.
 */

/** The financing switch is a switch, not a quantity. Typed separately. */
export type StarterPolicy = {
  sellingCostPct: number;
  closingCost: number;
  monthlyCarry: number;
  holdMonths: number;
  buyerProfitPct: number;
  financingEnabled: boolean;
  financingLtv: number;
  financingRate: number;
  financingPoints: number;
  standardMinimum: number;
  profitSharePct: number;
};

export const IAOS_STARTERS: StarterPolicy = {
  sellingCostPct:   0.10,  // PB-D56 IV: 10% of ARV
  closingCost:      2500,  // PB-D56 IV: $2,500 flat
  monthlyCarry:     500,   // PB-D56 IV: $500 per month
  holdMonths:       5,     // PB-D56 IV: 5 months
  buyerProfitPct:   0.15,  // PB-D56 IV: 15% of ARV
  financingEnabled: true,  // PB-D56 IV: On
  financingLtv:     0.70,  // PB-D56 IV: 70% of purchase price
  financingRate:    0.12,  // PB-D56 IV: 12% annual
  financingPoints:  0.02,  // PB-D56 IV: 2% of loan
  standardMinimum:  5000,  // PB-D56 IV: $5,000 flat
  profitSharePct:   0.25,  // PB-D56 IV: 25% of required profit
};
