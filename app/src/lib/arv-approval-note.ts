/**
 * Reads Board #7's EXISTING ARV approval ledger note back into structured
 * evidence. B8-07 / INV-50. Jess Gate correction 2026-09-05; Jess Re-Gate
 * correction 2026-09-05 (2nd round, amount-matching).
 *
 * WHY THIS EXISTS. Jess Gate on this issue's first PASS found
 * `arv` hardcoded to `null` in Seller Call's Offer Readiness inputs,
 * meaning Board #7 ARV evidence never reached Offer Readiness. The
 * required fix is explicit: "Reuse the existing Board #7 append-only ARV
 * approval ledger/provenance (`arv-persist.ts`)... Do not infer evidence
 * quality from the ARV dollar amount, and do not invent a carrier."
 *
 * THE CARRIER ALREADY EXISTS AND IS ALREADY READABLE. `arv-persist.ts`'s
 * `formatArvApprovalNote` already writes a structured, IAOS-authored
 * Contact note on every ARV approval/override -- evidence state,
 * reconciliation outcome, comp count, search level, all included. GHL
 * notes are already read-only-fetchable via `ghl.notes.list`, already
 * used by `ContactWorkspace.tsx` and `Conversations.tsx`. Nothing here is
 * a new GHL capability, a new field, or a new write -- it is a READ of an
 * already-approved, already-written record, through an already-approved,
 * already-used read call.
 *
 * FAILS CLOSED, NEVER GUESSES. This module is the strict inverse of
 * `formatArvApprovalNote`. Any note that does not match the EXACT locked
 * format -- wrong version header, a missing field, an evidence-state
 * value outside the four locked states, a malformed decision, a
 * non-finite/non-positive `Approved ARV`, or an unparseable
 * `Approval timestamp` -- returns `null`. A future format change is a
 * version-string mismatch here, not a silent misread:
 * `ARV_APPROVAL_LEDGER_VERSION` is imported from `arv-persist.ts` itself,
 * never duplicated, so the two can never drift out of agreement about
 * which version this parser understands.
 *
 * AMOUNT-MATCHING (Jess Re-Gate, round 2). Evidence state alone is not
 * enough: a ledger note is only usable evidence for the ARV amount it was
 * ACTUALLY approved for. `matchingArvApprovalForOpportunity` is the
 * bounded fix -- it reads `Approved ARV` back (never inferring quality
 * FROM the number, only comparing identity TO the current authoritative
 * amount) and requires the latest valid ledger entry to match
 * `screen.known.arv` exactly before treating its evidence state as usable.
 * Without this, an old approved note -- still "latest" only because
 * nothing superseded it -- could lend HIGH/MODERATE evidence to a
 * DIFFERENT ARV amount that later reached the Opportunity by some other
 * path outside IAOS's approval flow. A newer ledger entry that does not
 * match current ARV is never skipped in favor of an older matching one:
 * that would replay stale history instead of correctly demanding
 * re-approval.
 */

import { ARV_APPROVAL_LEDGER_VERSION } from "./arv-persist";
import type { ArvEvidenceState } from "./arv-reconciliation";

const EXPECTED_HEADER = `IAOS ARV APPROVAL LEDGER — ${ARV_APPROVAL_LEDGER_VERSION}`;
const EVIDENCE_STATES: ReadonlySet<string> = new Set(["HIGH", "MODERATE", "LOW", "INSUFFICIENT"]);

export type ParsedArvApprovalNote = {
  opportunityId: string;
  evidenceState: ArvEvidenceState;
  decision: "APPROVED" | "OVERRIDE";
  approvedAt: string;
  approvedArv: number;
};

/**
 * Parses one note body. Returns `null` on ANY deviation from the exact
 * format `formatArvApprovalNote` produces -- see the module header. Two
 * fields are validated beyond mere presence, both load-bearing elsewhere
 * in this module: `Approval timestamp` must parse to a real, finite
 * instant (it drives `latestArvApprovalForOpportunity`'s recency
 * ordering), and `Approved ARV` must be a positive finite number (it
 * drives `matchingArvApprovalForOpportunity`'s amount check). Either
 * failing fails the WHOLE note closed -- never a partial/best-effort
 * result.
 */
export function parseArvApprovalNote(body: string): ParsedArvApprovalNote | null {
  if (typeof body !== "string") return null;
  const lines = body.split("\n");
  if (lines[0] !== EXPECTED_HEADER) return null;

  function field(label: string): string | null {
    const line = lines.find((l) => l.startsWith(label + ": "));
    return line ? line.slice(label.length + 2) : null;
  }

  const approvedAt = field("Approval timestamp");
  const opportunityId = field("Opportunity");
  const decisionRaw = field("Decision");
  const evidenceStateRaw = field("Evidence state");
  const approvedArvRaw = field("Approved ARV");

  if (!approvedAt || !opportunityId || !decisionRaw || !evidenceStateRaw || !approvedArvRaw) return null;
  if (decisionRaw !== "APPROVED" && decisionRaw !== "OVERRIDE") return null;
  if (!EVIDENCE_STATES.has(evidenceStateRaw)) return null;

  const approvedAtMs = new Date(approvedAt).getTime();
  if (!Number.isFinite(approvedAtMs)) return null;

  const approvedArv = Number(approvedArvRaw);
  if (!Number.isFinite(approvedArv) || approvedArv <= 0) return null;

  return {
    opportunityId,
    evidenceState: evidenceStateRaw as ArvEvidenceState,
    decision: decisionRaw,
    approvedAt,
    approvedArv,
  };
}

/**
 * Finds the CURRENT standing ARV evidence for one Opportunity from a
 * contact's full note list -- the latest ledger entry BY THE NOTE'S OWN
 * embedded approval timestamp, never by list order or GHL's `dateAdded`.
 * Re-approval APPENDS a new note (arv-persist.ts's own append-only
 * design, mirroring ARV_EVIDENCE_SNAPSHOT_V1.md's ledger); this must
 * never return a superseded entry.
 *
 * Matches ONLY notes for the given `opportunityId` -- a contact holding
 * more than one Opportunity's history in its notes must never have one
 * deal's evidence attributed to another (PB-D55).
 *
 * Non-ledger notes (call notes, dispositions, anything else) parse to
 * `null` above and are silently skipped here, not treated as an error --
 * a Contact's note list is not exclusively ARV history.
 *
 * Does NOT check the approved amount against anything -- that is
 * `matchingArvApprovalForOpportunity`'s job, below. This function alone
 * is not sufficient to treat evidence as usable (see that function's
 * header); it is exported separately so callers needing to distinguish
 * "no ledger entry at all" from "an entry exists but does not match" for
 * truthful UI text can do so.
 */
export function latestArvApprovalForOpportunity(
  notes: { body: string }[],
  opportunityId: string,
): ParsedArvApprovalNote | null {
  let latest: ParsedArvApprovalNote | null = null;
  for (const note of notes) {
    const parsed = parseArvApprovalNote(note.body);
    if (!parsed || parsed.opportunityId !== opportunityId) continue;
    if (!latest || new Date(parsed.approvedAt).getTime() > new Date(latest.approvedAt).getTime()) {
      latest = parsed;
    }
  }
  return latest;
}

/**
 * THE ONLY function Seller Call is allowed to treat ARV ledger evidence
 * as usable through. Requires the latest valid ledger entry for this
 * Opportunity (per `latestArvApprovalForOpportunity` above) to match
 * `currentArv` -- the ARV amount actually authoritative right now
 * (`screen.known.arv`) -- EXACTLY. Fails closed (returns `null`) when:
 *   - there is no valid ledger entry for this Opportunity at all;
 *   - `currentArv` is `null` (nothing to compare against);
 *   - the latest entry's `approvedArv` does not equal `currentArv`.
 *
 * Never falls back to an older entry that happens to match: if the
 * LATEST entry does not match, evidence is withheld entirely, even if an
 * earlier one would have matched. A superseding approval that no longer
 * matches current ARV means the deal moved after that approval; the
 * correct response is to require re-approval, not to resurrect stale
 * history.
 */
export function matchingArvApprovalForOpportunity(
  notes: { body: string }[],
  opportunityId: string,
  currentArv: number | null,
): ParsedArvApprovalNote | null {
  if (currentArv === null) return null;
  const latest = latestArvApprovalForOpportunity(notes, opportunityId);
  if (!latest) return null;
  return latest.approvedArv === currentArv ? latest : null;
}
