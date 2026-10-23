/**
 * Repair-save completion integration (B15-26 B1, contracts r1-r5.1) --
 * the single switch and the per-environment configuration it needs.
 *
 * DEFAULT-DISABLED, IN CODE. While `enabled` is false:
 *   - the browser renders the existing repair estimator exactly as before
 *     (no new request, no new text);
 *   - both new functions (repair-approval-save, repair-approval-status)
 *     answer 404 before authentication, configuration or any I/O;
 *   - ghl-write's existing `opportunity.repairs` write is unchanged.
 * Turning it on is a reviewed code change, never an environment toggle.
 *
 * Even when enabled, the new path refuses (nothing sent, no fallback) unless:
 *   - IAOS_ENV is "test" (Production is not part of this candidate);
 *   - this environment's `repair_approval_id` field id is provisioned (P5);
 *   - the server has an API-mode Netlify Blobs site id and token for the
 *     authority store (IAOS_REPAIR_AUTHORITY_SITE_ID / _TOKEN; #1149457).
 * When enabled, ghl-write refuses `opportunity.repairs`: the module's own
 * dispatch is then the ONLY way a repair total reaches GHL.
 */
export const REPAIR_APPROVAL_FIELD_NOT_PROVISIONED = "REPAIR_APPROVAL_ID_FIELD_NOT_YET_PROVISIONED" as const;

export type RepairApprovalConfig = Readonly<{
  enabled: boolean;
  /** Environments in which the enabled path may run at all. */
  environments: readonly string[];
  /** Opportunity custom field `repair_approval_id` (single-line TEXT) per environment. */
  approvalFieldId: Readonly<Record<"test" | "production", string>>;
  /** Re-read passes after both writes are definite (the module allows at most 3 in 10 s). */
  verifyPassDelayMs: number;
  /** Whole-save deadline (deadline proposal r3 + r4). PROVISIONAL Test settings, not validated latency bounds. */
  saveDeadline: SaveDeadlineConfig;
}>;

export type SaveDeadlineConfig = Readonly<{
  /** deadline = start + min(budgetMs, remaining runtime budget at entry - responseReserveMs). */
  budgetMs: number;
  responseReserveMs: number;
  /** No request starts with less than this left before its limit. */
  minStartMs: number;
  /** Per-request caps; each timer covers the response body. */
  claimTimeoutMs: number;
  /** Per GET of the Opportunity stage (it makes two: the Opportunity and the derived contact). */
  opportunityReadTimeoutMs: number;
  authorityTimeoutMs: number;
  ghlReadTimeoutMs: number;
  ghlWriteTimeoutMs: number;
  /** Time kept for the zero-send release and for CLOSE (one strong read + one CAS each). */
  releaseReserveMs: number;
  closeReserveMs: number;
  /** A stage starts only if at least its floor is left before the deadline. */
  floorsMs: Readonly<{ claim: number; opportunityRead: number; admission: number; notePost: number; fieldsPut: number; verifyPass: number; close: number }>;
}>;

export const REPAIR_APPROVAL_CONFIG: RepairApprovalConfig = Object.freeze({
  enabled: false,
  environments: Object.freeze(["test"]),
  approvalFieldId: Object.freeze({ test: REPAIR_APPROVAL_FIELD_NOT_PROVISIONED, production: REPAIR_APPROVAL_FIELD_NOT_PROVISIONED }),
  verifyPassDelayMs: 1500,
  saveDeadline: Object.freeze({
    budgetMs: 50_000,
    responseReserveMs: 5_000,
    minStartMs: 250,
    claimTimeoutMs: 3_000,
    opportunityReadTimeoutMs: 5_000,
    authorityTimeoutMs: 5_000,
    ghlReadTimeoutMs: 5_000,
    ghlWriteTimeoutMs: 8_000,
    releaseReserveMs: 12_000,
    closeReserveMs: 12_000,
    // The Opportunity stage is TWO GETs (the Opportunity, then its derived contact), each with its own 5 s timer:
    // up to ~10 s. So opportunityRead = admission 36 + 2 x 5 = 46, and claim = 46 + claim cap 3 = 49.
    floorsMs: Object.freeze({ claim: 49_000, opportunityRead: 46_000, admission: 36_000, notePost: 28_000, fieldsPut: 22_000, verifyPass: 14_000, close: 12_000 }),
  }),
});

/** Stable refusal marker for the disabled endpoints. */
export const REPAIR_APPROVAL_DISABLED = "iaos-repair-approval-disabled" as const;

/**
 * THE server-side switch for the repair-approval path (Jess, 2026-10-23): true
 * only when the shared switch is on AND the server's own environment is Test
 * and listed. ghl-write, both repair-approval functions and the browser
 * capability served by iaos-runtime-config all use this one predicate, so the
 * same commit published to Production keeps Production's legacy repair save.
 * The environment is the server's IAOS_ENV, never a caller's.
 */
export function repairApprovalActiveFor(env: unknown, config: RepairApprovalConfig = REPAIR_APPROVAL_CONFIG): boolean {
  return config.enabled === true && env === "test" && config.environments.includes(env);
}
