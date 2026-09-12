/**
 * Repair Estimation V1 — the persistence boundary. INV-13.
 *
 * INV-70 / B9-07A Phase 2 correction round 3 — REMOVED the Contact-
 * targeted write path (`persistApprovedRepairTotal` / `RepairPersistGhl`,
 * which wrote `contact.estimated_repairs` via `ghl.contacts.
 * setEstimatedRepairs`). A repository-wide audit
 * (`app/scripts/test-legacy-repairs-writer-removed.cjs`) found and closed
 * its last two live callers: `UnderwritingWorkspace.tsx` (already switched
 * to the Opportunity-targeted path below, in the earlier Phase 2 pass) and
 * `DealCalculator.tsx`'s standalone scratchpad (its own "Save Repairs to
 * {contact}" action, removed this round). `contact.estimated_repairs` is
 * now Family 3's read-only legacy fallback/migration input ONLY — no
 * application code writes it, anywhere, and this module no longer offers
 * a way to.
 *
 * WHAT REMAINS: the approval gate (`persistGate`, unchanged — validation
 * does not depend on which carrier the approved value lands in) and the
 * Opportunity-targeted persistence path
 * (`persistApprovedRepairTotalToOpportunity`), which is now this module's
 * ONLY write path.
 *
 * ⚠ NO NEW CARRIER, NO SHADOW COPY. GHL stays the sole system of record.
 */

/**
 * Operator approval, carrying WHAT was approved and WHEN.
 *
 * `revision` is the estimator's edit counter at the moment of approval. It is
 * what makes a stale approval detectable: an approval is authorization for one
 * specific number the operator actually saw, not a standing permission.
 */
export type RepairApproval =
  | { kind: "none" }
  | { kind: "approved"; total: number; revision: number };

/** The decision to write, or the reason there is no authorization to. */
export type PersistGate =
  | { kind: "blocked"; reason: string }
  | { kind: "allowed"; value: number };

/**
 * Whether this state may write, and exactly what.
 *
 * Pure and total. Every path that could reach the carrier passes through
 * here, so "unapproved cannot write" is a property of one readable function
 * rather than a claim about a component's control flow.
 */
export function persistGate(
  approval: RepairApproval,
  revision: number,
  total: number,
): PersistGate {
  if (approval.kind === "none") {
    return { kind: "blocked", reason: "no operator approval — the total is not authoritative" };
  }
  if (approval.revision !== revision) {
    return { kind: "blocked", reason: "the estimate changed after approval — re-approve before saving" };
  }
  if (approval.total !== total) {
    return { kind: "blocked", reason: "the approved total no longer matches the estimate — re-approve before saving" };
  }
  if (!Number.isFinite(total) || total < 0) {
    return { kind: "blocked", reason: "the approved total is not a valid amount" };
  }
  return { kind: "allowed", value: total };
}

/**
 * The terminal states, all explicit.
 *
 * PB-D21 governs the vocabulary: "saved" means GHL was read back and
 * confirmed, never that the PUT returned 2xx. `written` says whether a PUT
 * actually left, because "we could not confirm it" and "nothing was sent" are
 * different facts and the operator needs to know which one they have.
 */
export type PersistResult =
  | { ok: true; value: number; confidence: "saved" }
  | { ok: true; value: number; confidence: "unconfirmed" }
  | { ok: false; stage: "blocked"; error: string; written: false }
  | { ok: false; stage: "write"; error: string; written: false }
  | { ok: false; stage: "unverified"; error: string; written: true };

/**
 * INV-70 / B9-07A Phase 2 — the Opportunity-targeted persistence path,
 * added in the earlier Phase 2 pass alongside the (now-removed)
 * Contact-targeted one, and the sole write path remaining after this
 * correction round.
 *
 * WHY A SEPARATE FUNCTION, NOT A PARAMETER ON A GENERIC ONE. Contact and
 * Opportunity have genuinely different wire shapes (Contact read back via
 * `getDetail`'s `{id, value}` array; Opportunity via a singular
 * `GET /opportunities/{id}` parsed by `readSingularFieldValue`) and
 * different named writers (`setEstimatedRepairs`, removed; `setRepairEstimate`,
 * below). PB-D16's named-wrapper rule forbids one setter parameterized
 * over a target; this module extends that discipline to the persistence
 * boundary itself.
 *
 * WHO CALLS THIS. `UnderwritingWorkspace.tsx`'s `RepairEstimator` — the
 * real, Opportunity-bound approval flow — per
 * `docs/BOARD9_GHL_IAOS_FIELD_CANONICALIZATION_V1.md` Family 3's approved
 * ruling: "opportunity.repair_estimate becomes the authoritative carrier
 * ... Change IAOS repair approval/persistence to write the linked
 * Opportunity." `DealCalculator.tsx`'s standalone scratchpad no longer
 * calls anything in this module for repairs at all (INV-70 correction
 * round 3) — it remains a session-only calculation surface, exactly like
 * its own pre-existing treatment of ARV.
 */
export interface RepairPersistGhlOpportunity {
  opportunities: {
    setRepairEstimate: (opportunityId: string, value: number) => Promise<{ ok: boolean }>;
  };
}

/**
 * Persist the approved total to the linked Opportunity. The write's own
 * readback (inside `setRepairEstimate`) already confirms the value landed
 * — this function's job is translating that `{ok}` into the standard
 * `PersistResult` vocabulary this module uses.
 *
 * NEVER OVERWRITES A NON-EMPTY AUTHORITATIVE OPPORTUNITY VALUE FROM
 * CONTACT. This function does not read or touch `contact.estimated_
 * repairs` at all — the write goes to the Opportunity and nothing else,
 * so there is no path by which a Contact value could clobber it. Family
 * 3's "never overwrite" rule is upheld structurally, not by a runtime
 * check this function would otherwise need.
 */
export async function persistApprovedRepairTotalToOpportunity(
  client: RepairPersistGhlOpportunity,
  opportunityId: string,
  gate: PersistGate,
): Promise<PersistResult> {
  if (gate.kind === "blocked") {
    return { ok: false, stage: "blocked", error: gate.reason, written: false };
  }

  const value = gate.value;

  let result: { ok: boolean };
  try {
    result = await client.opportunities.setRepairEstimate(opportunityId, value);
  } catch (e) {
    return {
      ok: false, stage: "write", written: false,
      error: `Couldn't save the repair total to the opportunity: ${(e as Error).message}`,
    };
  }

  // setRepairEstimate performs its own PUT-then-readback cycle (matching
  // setApprovedArv/setAskingPrice), so by the time it resolves the value
  // has already been confirmed on the wire or the promise would have
  // rejected above. There is no separate poll loop here the way the
  // Contact path needed one -- the write call IS the verification.
  if (!result.ok) {
    return {
      ok: false, stage: "unverified", written: true,
      error: "The repair total was sent but the opportunity readback did not confirm it.",
    };
  }
  return { ok: true, value, confidence: "saved" };
}
