/**
 * Reads Board #7's EXISTING ARV approval ledger note back into structured
 * evidence. B8-07 / INV-50, Jess Gate correction 2026-09-05.
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
 * value outside the four locked states, a malformed decision -- returns
 * `null`. A future format change is a version-string mismatch here, not
 * a silent misread: `ARV_APPROVAL_LEDGER_VERSION` is imported from
 * `arv-persist.ts` itself, never duplicated, so the two can never drift
 * out of agreement about which version this parser understands.
 *
 * NO INFERENCE FROM THE DOLLAR AMOUNT. This module reads ONLY the
 * `Evidence state:` line the ledger note itself already carries -- it
 * never looks at, or derives anything from, an approved ARV number. A
 * contact whose Opportunity holds an approved ARV but no matching ledger
 * note (impossible through IAOS's own approval path, but not excluded
 * for a record touched outside it) correctly returns `null` here.
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
};

/**
 * Parses one note body. Returns `null` on ANY deviation from the exact
 * format `formatArvApprovalNote` produces -- see the module header.
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

  if (!approvedAt || !opportunityId || !decisionRaw || !evidenceStateRaw) return null;
  if (decisionRaw !== "APPROVED" && decisionRaw !== "OVERRIDE") return null;
  if (!EVIDENCE_STATES.has(evidenceStateRaw)) return null;

  return {
    opportunityId,
    evidenceState: evidenceStateRaw as ArvEvidenceState,
    decision: decisionRaw,
    approvedAt,
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
