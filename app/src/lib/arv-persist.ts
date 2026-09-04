import type { ArvEvidenceState, ArvOutcome } from "./arv-reconciliation";
import type { SearchLevel } from "./comp-classification";

export const ARV_APPROVAL_LEDGER_VERSION = "iaos-arv-approval-v1" as const;

export type ArvApproval =
  | { kind: "none" }
  | { kind: "approved"; amount: number; recommendedArv: number; revision: number }
  | { kind: "overridden"; amount: number; recommendedArv: number | null; revision: number };

export type ArvPersistGate =
  | { kind: "blocked"; reason: string }
  | { kind: "allowed"; approval: Exclude<ArvApproval, { kind: "none" }> };

export type ArvApprovalProvenance = {
  approvedAt: string;
  operator: string;
  opportunityId: string;
  evidenceState: ArvEvidenceState;
  reconciliationOutcome: ArvOutcome;
  acceptedCompCount: number;
  searchLevel: SearchLevel;
  source: {
    kind: string;
    version: string;
    fileName?: string;
    importedAt?: string;
  };
};

export interface ArvPersistClient {
  opportunities: {
    setApprovedArv: (
      opportunityId: string,
      value: number,
    ) => Promise<{ ok: boolean; sent: number; observed: number | string | null }>;
  };
  notes: { create: (contactId: string, body: string) => Promise<unknown> };
}

export type ArvPersistResult =
  | { ok: true; stage: "saved"; value: number; note: string }
  | { ok: false; stage: "blocked"; written: false; error: string }
  | { ok: false; stage: "arv_write"; written: "unknown"; error: string }
  | { ok: false; stage: "arv_unconfirmed"; written: true; error: string }
  | { ok: false; stage: "note"; written: true; arvConfirmed: true; error: string; note: string };

export function arvPersistGate(
  approval: ArvApproval,
  currentRevision: number,
): ArvPersistGate {
  if (approval.kind === "none") {
    return { kind: "blocked", reason: "no explicit ARV approval — no value is authoritative" };
  }
  if (approval.revision !== currentRevision) {
    return { kind: "blocked", reason: "the ARV evidence changed after approval — re-approve before saving" };
  }
  if (!Number.isFinite(approval.amount) || approval.amount <= 0) {
    return { kind: "blocked", reason: "the approved ARV is not a positive finite amount" };
  }
  if (approval.kind === "approved" && approval.amount !== approval.recommendedArv) {
    return { kind: "blocked", reason: "the approved amount no longer matches the recommendation" };
  }
  return { kind: "allowed", approval };
}

function ledgerValue(value: string | number | null | undefined): string {
  return value == null || value === "" ? "UNAVAILABLE" : String(value);
}

/** Stable, human-readable append-only ledger entry. Contains no per-comp guts. */
export function formatArvApprovalNote(
  approval: Exclude<ArvApproval, { kind: "none" }>,
  provenance: ArvApprovalProvenance,
): string {
  const disposition = approval.kind === "approved" ? "APPROVED" : "OVERRIDE";
  return [
    `IAOS ARV APPROVAL LEDGER — ${ARV_APPROVAL_LEDGER_VERSION}`,
    `Approval timestamp: ${provenance.approvedAt}`,
    `Operator: ${provenance.operator}`,
    `Opportunity: ${provenance.opportunityId}`,
    `Decision: ${disposition}`,
    `Approved ARV: ${approval.amount}`,
    `Recommended ARV: ${ledgerValue(approval.recommendedArv)}`,
    `Evidence state: ${provenance.evidenceState}`,
    `Reconciliation outcome: ${provenance.reconciliationOutcome}`,
    `Accepted comp count: ${provenance.acceptedCompCount}`,
    `Search level: ${provenance.searchLevel}`,
    `Source: ${provenance.source.kind}`,
    `Source version: ${provenance.source.version}`,
    `PropStream CSV: ${ledgerValue(provenance.source.fileName)}`,
    `Imported at: ${ledgerValue(provenance.source.importedAt)}`,
  ].join("\n");
}

export async function persistApprovedArv(
  client: ArvPersistClient,
  contactId: string,
  gate: ArvPersistGate,
  provenance: ArvApprovalProvenance,
): Promise<ArvPersistResult> {
  if (gate.kind === "blocked") {
    return { ok: false, stage: "blocked", written: false, error: gate.reason };
  }
  if (provenance.opportunityId.trim() === "") {
    return { ok: false, stage: "blocked", written: false, error: "no selected Opportunity" };
  }

  let write;
  try {
    write = await client.opportunities.setApprovedArv(
      provenance.opportunityId,
      gate.approval.amount,
    );
  } catch (error) {
    return {
      ok: false,
      stage: "arv_write",
      written: "unknown",
      error: `The approved ARV could not be confirmed: ${(error as Error).message}`,
    };
  }
  if (!write.ok) {
    return {
      ok: false,
      stage: "arv_unconfirmed",
      written: true,
      error: `The ARV write was accepted but readback did not confirm ${write.sent}; no valuation note was written.`,
    };
  }

  const note = formatArvApprovalNote(gate.approval, provenance);
  try {
    await client.notes.create(contactId, note);
  } catch (error) {
    return {
      ok: false,
      stage: "note",
      written: true,
      arvConfirmed: true,
      note,
      error: `ARV saved, but valuation history note failed: ${(error as Error).message}`,
    };
  }
  return { ok: true, stage: "saved", value: write.sent, note };
}
