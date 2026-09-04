/**
 * Repair Estimation V1 — the persistence boundary. INV-13.
 *
 * After operator approval, the approved TOTAL is persisted through the
 * existing `estimated_repairs` carrier and nothing else. V1 itemization is
 * not persisted and no line ever leaves the session.
 *
 * ⚠ THE FIELD ID NEVER TRAVELS TO THE WRITE. The caller injects a client
 * exposing the already-named `setEstimatedRepairs` — board item #2B's sixth
 * named write, which spent its own decision and carries its own write-safety
 * clearance. PB-D16 §4.4 forbids a public setter parameterized over a field
 * id, so this module never holds one for writing. The one id it does take is
 * for the READBACK, which is a read and is not gated.
 *
 * ⚠ NO NEW CARRIER, NO SHADOW COPY. GHL stays the sole system of record: the
 * caller re-reads the contact after a confirmed write rather than patching a
 * local copy, so the screen keeps being a claim about what GHL holds.
 *
 * `ghl` is injected rather than imported, on the same reasoning as
 * callbackWrite.ts — it keeps this trivially testable with a mock, and the
 * INV-13 proof runs with no GHL contact and no Production mutation.
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
 * Structural subset of the client this boundary needs. The real `ghl`
 * satisfies it, and so can a mock. Deliberately narrow: the only write
 * reachable from here is `setEstimatedRepairs`. No other setter, no note, no
 * opportunity method, and nothing that could touch an `offer_` field or a
 * workflow trigger is in scope of this type at all.
 */
export interface RepairPersistGhl {
  contacts: {
    setEstimatedRepairs: (contactId: string, value: number | "") => Promise<unknown>;
    getDetail: (contactId: string) => Promise<{ customFields: { id: string; value: unknown }[] }>;
  };
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

const VERIFY_ATTEMPTS = 3;

/**
 * Persist the approved total, then confirm it by reading GHL back.
 *
 * The PUT is issued at most once and is NEVER repeated — PB-D21. A thrown
 * read consumes an attempt and the poll continues; the terminal state then
 * depends on whether the instrument ever worked. One completed read that
 * never matched is "unconfirmed"; a poll that never once reached GHL is
 * "unverified", and the operator is told a write did leave.
 *
 * `readbackFieldId` addresses the READ only. The write above it went through
 * the named setter with no id supplied by this module.
 */
export async function persistApprovedRepairTotal(
  client: RepairPersistGhl,
  contactId: string,
  readbackFieldId: string,
  gate: PersistGate,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<PersistResult> {
  if (gate.kind === "blocked") {
    return { ok: false, stage: "blocked", error: gate.reason, written: false };
  }

  const value = gate.value;

  try {
    await client.contacts.setEstimatedRepairs(contactId, value);
  } catch (e) {
    return {
      ok: false, stage: "write", written: false,
      error: `Couldn't save the repair total: ${(e as Error).message}`,
    };
  }

  let anyCompleted = false;
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt++) {
    if (attempt > 1) await sleep(1000);
    try {
      const detail = await client.contacts.getDetail(contactId);
      anyCompleted = true;
      const entry = detail.customFields.find((cf) => cf.id === readbackFieldId);
      if (entry && Number(entry.value) === value) {
        return { ok: true, value, confidence: "saved" };
      }
    } catch (e) {
      lastErr = e as Error;
    }
  }

  if (!anyCompleted) {
    return {
      ok: false, stage: "unverified", written: true,
      error: `The repair total was sent but GHL could not be read back to confirm it${lastErr ? `: ${lastErr.message}` : ""}.`,
    };
  }
  return { ok: true, value, confidence: "unconfirmed" };
}
