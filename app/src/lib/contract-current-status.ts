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
 *   4. a send recorded for this version but no execution (Bones R1, B2).
 *      Every send ATTEMPT for the opportunity is considered, each resolved
 *      to its own latest note by the carrier's own precedence
 *      (resolvedSendAttemptsForOpportunity) -- a later failed attempt never
 *      erases an earlier accepted or unresolved one:
 *      - any attempt accepted and bound (verifyAcceptedSendBinding) ->
 *        "Contract sent"; it says the send is recorded, never that anyone
 *        signed or what the provider shows now;
 *      - else any attempt in progress, awaiting readback, ambiguous, or
 *        "accepted" without a bindable provider document -> "Send outcome
 *        not confirmed"; it must not invite a second send either;
 *      - only failed attempts (or none) -> the readiness guidance stands;
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
import { latestContractSendForOpportunity, parseContractSendNote, type ParsedContractSend } from "./contract-send-carriers";

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

const UNCONFIRMED_SEND_STATUSES = new Set(["in_progress", "provider_accepted_pending_readback", "ambiguous", "accepted"]);

/** Display only: may the page invite a NEW manual upload/send for this version? Only when nothing is recorded beyond readiness. */
export function allowsNewSend(status: ContractCurrentStatus | null): boolean {
  return !!status && (status.kind === "ready_unsent" || status.kind === "not_ready");
}
/** The lower "Manual GHL upload and send" notice's instruction when a send, execution or rescission is recorded (B1). */
export const LOWER_NO_RESEND = "Do not upload or send this contract version again: a send, execution or rescission is already recorded for it. See the status at the top of this page.";
/** The Record GHL Send explanation in the same states (B1): recording stays available, sending again is not invited. */
export const RECORD_SEND_NO_RESEND = "A send, execution or rescission is already recorded for this contract version (see the status at the top of this page). Do not upload or send it again. Record here only a send GHL already shows and IAOS has not recorded -- nothing is sent to GHL from here.";

/**
 * Display only (Bones B2): every send attempt for this opportunity, each resolved to its own latest note
 * by the carrier's own precedence (latestContractSendForOpportunity applied to that attempt's notes alone).
 * The page's existingSend (the single latest attempt) and every gate that uses it are unchanged.
 */
export function resolvedSendAttemptsForOpportunity(notes: readonly { body: string }[], opportunityId: string): ParsedContractSend[] {
  const byAttempt = new Map<string, { body: string }[]>();
  for (const n of notes) {
    const p = parseContractSendNote(n.body);
    if (!p || p.opportunityId !== opportunityId) continue;
    const list = byAttempt.get(p.attemptId) ?? [];
    list.push(n);
    byAttempt.set(p.attemptId, list);
  }
  const out: ParsedContractSend[] = [];
  for (const list of byAttempt.values()) {
    const resolved = latestContractSendForOpportunity(list as { body: string }[], opportunityId);
    if (resolved) out.push(resolved);
  }
  return out;
}

export function deriveContractCurrentStatus(args: {
  opportunityId: string;
  agreementAt: string;
  /** The applicable contract version; `null` when none is established (no send or execution can be substantiated). */
  version: ContractVersionIdentity | null;
  readinessReady: boolean;
  underContract: UnderContractRecordEntry | null;
  dispositionHandoff: DispositionHandoffRecord | null;
  lifecycleHistory: readonly LifecycleRecord[];
  /** Every governed send attempt for this opportunity, each resolved within itself (resolvedSendAttemptsForOpportunity). */
  sendAttempts: readonly ParsedContractSend[];
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

  const scoped = args.sendAttempts.filter((a) => a.opportunityId === args.opportunityId && isSameContractVersion(a.version, v));
  const when = (a: ParsedContractSend) => a.iaosObservedAcceptanceAt ?? a.at;
  const bound = scoped
    .map((a) => ({ a, b: verifyAcceptedSendBinding({ acceptedSend: a, opportunityId: args.opportunityId, version: v }) }))
    .filter((x) => x.b.ok)
    .sort((x, y) => (when(x.a) < when(y.a) ? 1 : when(x.a) > when(y.a) ? -1 : 0));
  if (bound.length > 0) {
    const { a, b } = bound[0];
    const docId = b.ok ? b.value.providerDocumentId : "";
    return {
      kind: "sent_not_executed",
      headline: "Contract sent — execution not yet recorded",
      detail: `A send of this contract version was recorded ${fmt(when(a))} (GHL document ${docId}). IAOS has no verified execution for it yet; this is not a signature status.`,
      next: "Do not upload or send it again. Check that send's signatures and execution in GHL and in the execution records on this page.",
    };
  }
  const unresolved = scoped.filter((a) => UNCONFIRMED_SEND_STATUSES.has(a.status)).sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
  if (unresolved.length > 0) {
    return {
      kind: "send_unconfirmed",
      headline: "Send outcome not confirmed",
      detail: `A send attempt for this contract version (${fmt(unresolved[0].at)}) has no confirmed outcome.`,
      next: "Do not upload or send it again until that send's outcome is resolved. Check the document in GHL Documents & Contracts first.",
    };
  }

  return fallback;
}
