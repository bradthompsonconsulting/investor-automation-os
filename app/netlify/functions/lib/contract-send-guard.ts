/**
 * Contract-send concurrency guard — B9-08 / INV-63 correction round,
 * 2026-09-11 (item 7: "the server must own an atomic/idempotent send
 * boundary").
 *
 * Pure, minimal, server-side-only parse of a durable contract-send note
 * body -- deliberately DUPLICATES (never imports) the header/label shape
 * from `app/src/lib/contract-send-carriers.ts`, matching that module's
 * own stated "local helpers are duplicated rather than imported"
 * convention (never cross the netlify/functions <-> src/lib boundary
 * this codebase otherwise keeps separate -- see `netlify/functions/lib/
 * contact-parse.ts` for the established precedent of server-side-only
 * shared helpers). This file deliberately parses FAR LESS than that
 * module's own full `ParsedContractSend` -- only what a same-version
 * conflict check needs: opportunityId, attemptId, status, the raw
 * version JSON string (compared as an opaque string, never re-parsed).
 *
 * KEEP THE LABEL ORDER AND HEADER IN EXACT SYNC WITH
 * `app/src/lib/contract-send-carriers.ts`. A version bump there
 * (`CONTRACT_SEND_LEDGER_VERSION`) or a label reorder requires the same
 * edit here, by hand -- there is no shared import to keep them aligned
 * automatically, by design.
 */

const HEADER = "IAOS CONTRACT SEND — iaos-contract-send-v2";
const LABEL_COUNT = 17;
// Index within the note body's lines (line 0 is the header) of each field
// this guard actually needs -- mirrors contract-send-carriers.ts's LABELS
// array positions (2, 3, 4, 5), not re-declared here since only the
// index, not the label text, is used for parsing.
const IDX_OPPORTUNITY = 2;
const IDX_ATTEMPT_ID = 3;
const IDX_STATUS = 4;
const IDX_VERSION = 5;

const PENDING_OR_ACCEPTED = new Set(["in_progress", "provider_accepted_pending_readback", "accepted"]);

export type MinimalContractSend = {
  opportunityId: string;
  attemptId: string;
  status: string;
  versionRaw: string;
};

/** Returns null for any note that is not a well-formed contract-send note of the exact expected header/shape -- never a partial/best-effort parse. */
export function parseMinimalContractSend(body: string): MinimalContractSend | null {
  if (typeof body !== "string") return null;
  const lines = body.split("\n");
  if (lines.length !== 1 + LABEL_COUNT) return null;
  if (lines[0] !== HEADER) return null;
  const line = (idx: number): string | null => {
    const raw = lines[1 + idx];
    const colonIdx = raw.indexOf(": ");
    return colonIdx === -1 ? null : raw.slice(colonIdx + 2);
  };
  const opportunityId = line(IDX_OPPORTUNITY);
  const attemptId = line(IDX_ATTEMPT_ID);
  const status = line(IDX_STATUS);
  const versionRaw = line(IDX_VERSION);
  if (!opportunityId || !attemptId || !status || !versionRaw) return null;
  return { opportunityId, attemptId, status, versionRaw };
}

export type ContractSendConflictCheck =
  | { conflict: false }
  | { conflict: true; status: string; attemptId: string };

/**
 * Resolves each attemptId to its own latest-by-rank status (pending <
 * terminal, mirroring `contract-send-carriers.ts`'s own resolution --
 * duplicated here rather than imported, same rationale as the module
 * header), then reports a conflict if ANY resolved attempt for this
 * exact opportunityId + version is still pending or already accepted.
 * `failed`/`ambiguous` attempts never conflict -- retry is the intended
 * failure-recovery path (contract-send-model.ts's own idempotency rule).
 */
export function findConflictingContractSend(
  notes: { body: string }[],
  opportunityId: string,
  versionRaw: string,
): ContractSendConflictCheck {
  const rankOf = (status: string): number => (status === "in_progress" ? 0 : status === "provider_accepted_pending_readback" ? 1 : 2);
  const byAttempt = new Map<string, MinimalContractSend>();
  for (const note of notes) {
    const parsed = parseMinimalContractSend(note.body);
    if (!parsed || parsed.opportunityId !== opportunityId) continue;
    const existing = byAttempt.get(parsed.attemptId);
    if (!existing || rankOf(parsed.status) >= rankOf(existing.status)) {
      byAttempt.set(parsed.attemptId, parsed);
    }
  }
  for (const resolved of byAttempt.values()) {
    if (resolved.versionRaw === versionRaw && PENDING_OR_ACCEPTED.has(resolved.status)) {
      return { conflict: true, status: resolved.status, attemptId: resolved.attemptId };
    }
  }
  return { conflict: false };
}
