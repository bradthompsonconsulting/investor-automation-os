/**
 * B15-21 (INV-130) -- the Contract Workspace's top-of-page status and next
 * instruction, from the latest SUBSTANTIATED contract state for the selected
 * deal and contract version. Display only: it reads records the page has
 * already parsed from canonical carriers and writes, sends or gates nothing.
 *
 * Precedence (latest substantiated first), all for this exact opportunity and
 * contract version (the version carries the agreement identity):
 *   1. a Rescission recorded for this version -- with OR without an Under
 *      Contract record (Bones R2: rescission is allowed from Contract Ready
 *      onward, before execution too);
 *   2. a Start Disposition handoff that verifies against the current Under
 *      Contract record (verifyHandoffMatchesUnderContract) -> "Disposition
 *      started";
 *   3. an Under Contract record for this opportunity, agreement and version
 *      -> "Under Contract";
 *   4. a send recorded for this version but no execution (Bones R1):
 *      - accepted and bound (verifyAcceptedSendBinding) -> "Contract sent";
 *        it says the send is recorded, never that anyone signed or what the
 *        provider shows now;
 *      - still in progress, awaiting readback, or ambiguous -> "Send outcome
 *        not confirmed"; it must not invite a second send either;
 *      - failed -> no claim; the readiness guidance stands;
 *   5. otherwise the readiness guidance, unchanged: Contract Ready -> review,
 *      upload and send; not ready -> complete the checklist.
 *
 * Only governed records count. A signed-document email, a matching property
 * address, or a record for another opportunity, agreement or contract version
 * never establishes a send or an execution (Jess, 2026-10-04): such records
 * fail the identity checks below and the readiness guidance stands.
 */
import { isSameContractVersion, type ContractVersionIdentity } from "./board9-contract-model";
import { type UnderContractRecordEntry } from "./contract-execution-model";
import { verifyHandoffMatchesUnderContract, type DispositionHandoffRecord } from "./contract-disposition-handoff-model";
import { filterRecordsForVersion, verifyAcceptedSendBinding, type LifecycleRecord } from "./contract-lifecycle-model";
import { type ParsedContractSend } from "./contract-send-carriers";

export const READY_UNSENT_NEXT = "Contract Ready. Review the populated PDF, then upload and send it manually in GHL.";
export const NOT_READY_NEXT = "Complete the checklist above to reach Contract Ready.";

export type ContractCurrentStatus =
  | { kind: "not_ready"; headline: null; detail: null; next: string }
  | { kind: "ready_unsent"; headline: null; detail: null; next: string }
  | { kind: "sent_not_executed"; headline: string; detail: string; next: string }
  | { kind: "send_unconfirmed"; headline: string; detail: string; next: string }
  | { kind: "under_contract"; headline: string; detail: string; next: string }
  | { kind: "disposition_started"; headline: string; detail: string; next: string }
  | { kind: "rescinded"; headline: string; detail: string; next: string };

const UNCONFIRMED_SEND_STATUSES = new Set(["in_progress", "provider_accepted_pending_readback", "ambiguous"]);

export function deriveContractCurrentStatus(args: {
  opportunityId: string;
  agreementAt: string;
  /** The applicable contract version; `null` when none is established (no send or execution can be substantiated). */
  version: ContractVersionIdentity | null;
  readinessReady: boolean;
  underContract: UnderContractRecordEntry | null;
  dispositionHandoff: DispositionHandoffRecord | null;
  lifecycleHistory: readonly LifecycleRecord[];
  /** The latest governed contract-send record for this opportunity (the page's `existingSend`), or null. */
  latestSend: ParsedContractSend | null;
  formatTime?: (iso: string) => string;
}): ContractCurrentStatus {
  const fmt = args.formatTime ?? ((iso: string) => new Date(iso).toLocaleString());
  const fallback: ContractCurrentStatus = args.readinessReady
    ? { kind: "ready_unsent", headline: null, detail: null, next: READY_UNSENT_NEXT }
    : { kind: "not_ready", headline: null, detail: null, next: NOT_READY_NEXT };
  const v = args.version;
  if (!v || v.agreementAt !== args.agreementAt) return fallback;
  const ucCandidate = args.underContract;
  const uc = ucCandidate && ucCandidate.opportunityId === args.opportunityId && ucCandidate.agreementAt === args.agreementAt && isSameContractVersion(ucCandidate.version, v)
    ? ucCandidate : null;

  const rescission = filterRecordsForVersion(args.lifecycleHistory, v).find((r) => r.kind === "rescission" && r.opportunityId === args.opportunityId);
  if (rescission) {
    return {
      kind: "rescinded",
      headline: "Rescission recorded",
      detail: uc
        ? `A Rescission was recorded for this contract version (${fmt(rescission.iaosObservedAt)}). Its Under Contract record (${fmt(uc.iaosVerifiedAt)}) is no longer authoritative.`
        : `A Rescission was recorded for this contract version (${fmt(rescission.iaosObservedAt)}). No Under Contract record exists for this version.`,
      next: "Nothing to upload or send for this version. Review the records below before any further step.",
    };
  }

  if (uc) {
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

  const send = args.latestSend;
  if (send && send.opportunityId === args.opportunityId && isSameContractVersion(send.version, v)) {
    const binding = verifyAcceptedSendBinding({ acceptedSend: send, opportunityId: args.opportunityId, version: v });
    if (binding.ok) {
      const at = send.iaosObservedAcceptanceAt ?? send.at;
      return {
        kind: "sent_not_executed",
        headline: "Contract sent — execution not yet recorded",
        detail: `A send of this contract version was recorded ${fmt(at)} (GHL document ${binding.value.providerDocumentId}). IAOS has no verified execution for it yet; this is not a signature status.`,
        next: "Do not upload or send it again. Check signatures and execution under Verify Execution & Under Contract below.",
      };
    }
    if (UNCONFIRMED_SEND_STATUSES.has(send.status)) {
      return {
        kind: "send_unconfirmed",
        headline: "Send outcome not confirmed",
        detail: `A send of this contract version was started ${fmt(send.at)} and its outcome is not confirmed.`,
        next: "Do not upload or send it again until that send's outcome is resolved. Check the document in GHL Documents & Contracts first.",
      };
    }
  }

  return fallback;
}
