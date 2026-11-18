/**
 * B15-21 (INV-130) -- the Contract Workspace's top-of-page status and next
 * instruction, from the latest SUBSTANTIATED contract state for the selected
 * deal and contract version. Display only: it reads records the page has
 * already parsed from canonical carriers and writes, sends or gates nothing.
 *
 * Precedence (latest substantiated first):
 *   1. a Rescission recorded for this exact version -> the Under Contract
 *      record is no longer authoritative (mirrors
 *      evaluateDispositionHandoffEligibility's own rescission rule);
 *   2. a Start Disposition handoff that verifies against the current Under
 *      Contract record (verifyHandoffMatchesUnderContract) -> "Disposition
 *      started";
 *   3. an Under Contract record for this exact opportunity, agreement and
 *      version -> "Under Contract";
 *   4. otherwise the readiness guidance, unchanged: Contract Ready -> review,
 *      upload and send; not ready -> complete the checklist.
 *
 * Only governed records count. A signed-document email, a matching property
 * address, or a record for another opportunity, agreement or contract version
 * never establishes execution (Jess, 2026-10-04): such records fail the
 * identity checks below and the readiness guidance stands.
 */
import { isSameContractVersion, type ContractVersionIdentity } from "./board9-contract-model";
import { type UnderContractRecordEntry } from "./contract-execution-model";
import { verifyHandoffMatchesUnderContract, type DispositionHandoffRecord } from "./contract-disposition-handoff-model";
import { filterRecordsForVersion, type LifecycleRecord } from "./contract-lifecycle-model";

export const READY_UNSENT_NEXT = "Contract Ready. Review the populated PDF, then upload and send it manually in GHL.";
export const NOT_READY_NEXT = "Complete the checklist above to reach Contract Ready.";

export type ContractCurrentStatus =
  | { kind: "not_ready"; headline: null; detail: null; next: string }
  | { kind: "ready_unsent"; headline: null; detail: null; next: string }
  | { kind: "under_contract"; headline: string; detail: string; next: string }
  | { kind: "disposition_started"; headline: string; detail: string; next: string }
  | { kind: "rescinded"; headline: string; detail: string; next: string };

export function deriveContractCurrentStatus(args: {
  opportunityId: string;
  agreementAt: string;
  /** The applicable contract version; `null` when none is established (no execution can be substantiated). */
  version: ContractVersionIdentity | null;
  readinessReady: boolean;
  underContract: UnderContractRecordEntry | null;
  dispositionHandoff: DispositionHandoffRecord | null;
  lifecycleHistory: readonly LifecycleRecord[];
  formatTime?: (iso: string) => string;
}): ContractCurrentStatus {
  const fmt = args.formatTime ?? ((iso: string) => new Date(iso).toLocaleString());
  const fallback: ContractCurrentStatus = args.readinessReady
    ? { kind: "ready_unsent", headline: null, detail: null, next: READY_UNSENT_NEXT }
    : { kind: "not_ready", headline: null, detail: null, next: NOT_READY_NEXT };
  const v = args.version;
  const uc = args.underContract;
  if (!v || !uc) return fallback;
  if (uc.opportunityId !== args.opportunityId || uc.agreementAt !== args.agreementAt || !isSameContractVersion(uc.version, v)) return fallback;

  const rescission = filterRecordsForVersion(args.lifecycleHistory, v).find((r) => r.kind === "rescission" && r.opportunityId === args.opportunityId);
  if (rescission) {
    return {
      kind: "rescinded",
      headline: "Rescission recorded",
      detail: `A Rescission was recorded for this contract version (${fmt(rescission.iaosObservedAt)}). Its Under Contract record (${fmt(uc.iaosVerifiedAt)}) is no longer authoritative.`,
      next: "Nothing to upload or send for this version. Review the records below before any further step.",
    };
  }

  const h = args.dispositionHandoff;
  if (h && verifyHandoffMatchesUnderContract({ handoff: h, opportunityId: args.opportunityId, agreementAt: args.agreementAt, version: v, underContract: uc }).ok) {
    return {
      kind: "disposition_started",
      headline: "Disposition started",
      detail: `Under Contract recorded ${fmt(uc.iaosVerifiedAt)}. Start Disposition handoff created ${fmt(h.createdAt)}.`,
      next: "Nothing to upload or send: this contract is executed and handed off to buyer disposition. The records are under Verify Execution & Under Contract below.",
    };
  }

  return {
    kind: "under_contract",
    headline: "Under Contract",
    detail: `Under Contract recorded ${fmt(uc.iaosVerifiedAt)} for this exact verified execution.`,
    next: "Nothing to upload or send: this contract is executed. Continue under Verify Execution & Under Contract below.",
  };
}
