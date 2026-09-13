/**
 * Board #9 -> Board #10 no-reentry disposition-start handoff. B9-11 /
 * INV-66.
 *
 * PURE. No I/O, no React, no `ghl.notes.create()`. This module performs
 * no persistence itself -- `contract-disposition-handoff-carriers.ts`
 * defines the durable note shape.
 *
 * REUSE, NEVER REIMPLEMENTATION OR RECALCULATION -- every fact in the
 * handoff snapshot is copied verbatim from an already-canonical upstream
 * source, never recomputed:
 *   - `UnderContractRecordEntry` (`contract-execution-carriers.ts`,
 *     B9-10/INV-65) -- the ONE verified Under Contract fact, parsed
 *     through the canonical carrier by the caller, never re-derived here.
 *   - `SellerContractFactsReport` (`contract-facts-model.ts`, B9-04/
 *     INV-59) -- property legal description, closing/possession,
 *     seller notice contact. Every value is a `FieldDisposition<T>`
 *     copied field-for-field, never re-decided.
 *   - `RequiredSigner[]` (`contract-signer-mapping-model.ts`, B9-10/
 *     INV-65) -- the required signer set, already assembled from
 *     authoritative facts, never re-derived here.
 *   - `InheritedAgreementEconomics`/`OutcomeSnapshot`
 *     (`board9-contract-model.ts`/`seller-call-outcome.ts`) -- the
 *     accepted price, approved ARV, and approved repairs, frozen at
 *     Agreement Reached, never recomputed.
 *   - `ParsedArvApprovalNote` (`arv-approval-note.ts`, B8-07/INV-50) --
 *     the ARV evidence-state/decision provenance, matched to the
 *     authoritative ARV amount via the EXISTING
 *     `matchingArvApprovalForOpportunity`, never a new comparison.
 *
 * TWO DISTINCT CONCERNS, NEVER CONFLATED:
 *   1. ELIGIBILITY (`evaluateDispositionHandoffEligibility`) -- may
 *      Start Disposition even be offered right now. Fails closed on a
 *      missing/mismatched/stale/invalidated Under Contract record, or an
 *      equivalent handoff that already exists.
 *   2. THE SNAPSHOT ITSELF (`buildDispositionHandoffRecordArgs`) --
 *      once eligible, assembles the actual frozen package. Fails closed
 *      independently on any ESSENTIAL fact (needed to identify the deal,
 *      contract, execution, or economics) being missing or invalid.
 *      Every OPTIONAL fact is disclosed truthfully via the SAME
 *      `FieldDisposition<T>` vocabulary `contract-facts-model.ts`
 *      already uses -- never a parallel disclosure type, never silently
 *      omitted, never fabricated.
 *
 * NO UPSTREAM CARRIER EXISTS for property access/showing instructions or
 * for photos/documents (`docs/BOARD9_CONTRACT_INVENTORY_V1.md` item 7,
 * reconfirmed by a fresh source-tree search this issue: zero matches for
 * "access", "showing", "photo", "gallery", or "lockbox" anywhere in
 * `app/src/lib` outside this module and its own test fixtures). Access/
 * showing is represented with the SAME `FieldDisposition<string>`
 * vocabulary as every other optional fact -- honestly `unresolved` today,
 * never a fabricated instruction, and never presented as a distinct
 * "missing" concept requiring its own type. Photo/document references are
 * a plain array, honestly empty today for the same reason -- an empty
 * array is not a fabrication, and the type itself is proven to carry
 * zero, one, or many real entries once a future issue supplies a source.
 *
 * NO ESCROW/TITLE/BUYER LOGIC. This module produces Board #10's future
 * INPUT contract; it makes no buyer-facing decision, drafts no
 * assignment language, and contacts nobody.
 */

import {
  type ContractVersionIdentity,
  isSameContractVersion,
} from "./board9-contract-model";
import {
  type UnderContractRecordEntry,
  type VerifiedSignerMatch,
} from "./contract-execution-model";
import {
  type LifecycleRecord,
  filterRecordsForVersion,
} from "./contract-lifecycle-model";
import {
  type FieldDisposition,
  type PropertyLegalDescriptionReport,
} from "./contract-facts-model";
import { type ValueOrNone } from "./seller-contract-facts-carriers";
import { type RequiredSigner } from "./contract-signer-mapping-model";
import { type ArvEvidenceState } from "./arv-reconciliation";

function isValidIsoInstant(at: string): boolean {
  return Number.isFinite(new Date(at).getTime());
}

/* ==================================================================== */
/* 1. Eligibility -- may Start Disposition even be offered right now     */
/* ==================================================================== */

export type HandoffEligibilityReasonCode =
  | "UNDER_CONTRACT_MISSING"
  | "UNDER_CONTRACT_OPPORTUNITY_MISMATCH"
  | "UNDER_CONTRACT_AGREEMENT_MISMATCH"
  | "UNDER_CONTRACT_VERSION_MISMATCH"
  | "UNDER_CONTRACT_INVALIDATED_BY_LIFECYCLE_EVIDENCE"
  | "HANDOFF_ALREADY_EXISTS";

export type HandoffEligibilityReason = { code: HandoffEligibilityReasonCode; message: string };

/**
 * Never infers Under Contract from pipeline stage, document status alone,
 * operator memory, or an unverified local candidate -- `underContract`
 * must already be a genuinely parsed `UnderContractRecordEntry` (via
 * `parseUnderContractNote`/`allUnderContractRecordsForOpportunity`,
 * `contract-execution-carriers.ts`), never constructed by this function
 * or its caller from raw fields.
 *
 * "No later correction, rescission, or lifecycle evidence invalidates
 * that execution": scoped, via the EXISTING `filterRecordsForVersion`,
 * to lifecycle records for this exact version -- a `rescission` record
 * for this exact agreementAt/version is the one lifecycle fact that
 * retroactively invalidates an already-reached Under Contract record
 * (`SELLER_CONTRACT_STATE_MACHINE_V1.md`, "Corrected": "the prior
 * executed version remains the authoritative one in IAOS until... Brad
 * records a separate, authorized Rescission"). A later `correction`
 * record is explicitly NOT invalidating -- it names a NEW version, and
 * does not retroactively void this one.
 */
export function evaluateDispositionHandoffEligibility(args: {
  opportunityId: string;
  agreementAt: string;
  version: ContractVersionIdentity;
  underContract: UnderContractRecordEntry | null;
  lifecycleHistory: readonly LifecycleRecord[];
  existingHandoffsForOpportunity: readonly { agreementAt: string; version: ContractVersionIdentity; underContractVerifiedAt: string }[];
}): { eligible: true } | { eligible: false; reasons: HandoffEligibilityReason[] } {
  if (args.underContract === null) {
    return {
      eligible: false,
      reasons: [{ code: "UNDER_CONTRACT_MISSING", message: "No valid, canonical-carrier-parsed Under Contract record exists for this evidence." }],
    };
  }
  const uc = args.underContract;
  const reasons: HandoffEligibilityReason[] = [];
  if (uc.opportunityId !== args.opportunityId) {
    reasons.push({ code: "UNDER_CONTRACT_OPPORTUNITY_MISMATCH", message: "The Under Contract record's opportunityId does not match this evidence." });
  }
  if (uc.agreementAt !== args.agreementAt) {
    reasons.push({ code: "UNDER_CONTRACT_AGREEMENT_MISMATCH", message: "The Under Contract record's Agreement Reached identity does not match this evidence." });
  }
  if (!isSameContractVersion(uc.version, args.version)) {
    reasons.push({ code: "UNDER_CONTRACT_VERSION_MISMATCH", message: "The Under Contract record's contract version does not match this evidence." });
  }
  if (reasons.length > 0) return { eligible: false, reasons };

  const scoped = filterRecordsForVersion(args.lifecycleHistory, args.version).filter((r) => r.opportunityId === args.opportunityId);
  const rescinded = scoped.find((r) => r.kind === "rescission");
  if (rescinded) {
    reasons.push({
      code: "UNDER_CONTRACT_INVALIDATED_BY_LIFECYCLE_EVIDENCE",
      message: "A Rescission record exists for this exact contract version -- this Under Contract execution is no longer authoritative and cannot be handed off.",
    });
  }

  const duplicate = args.existingHandoffsForOpportunity.find(
    (h) => h.agreementAt === args.agreementAt && isSameContractVersion(h.version, args.version) && h.underContractVerifiedAt === uc.iaosVerifiedAt,
  );
  if (duplicate) {
    reasons.push({ code: "HANDOFF_ALREADY_EXISTS", message: "An equivalent disposition handoff already exists for this exact verified Under Contract execution." });
  }

  return reasons.length > 0 ? { eligible: false, reasons } : { eligible: true };
}

/* ==================================================================== */
/* 2. The handoff snapshot itself                                        */
/* ==================================================================== */

export type DocumentReference = { label: string; kind: "photo" | "document"; reference: string; note: string | null };

export type ApprovedArvSnapshot = {
  amount: number;
  /** `null` when no matching approval-ledger entry exists for this exact amount -- the amount itself is still essential and always present; only its evidence-state provenance is optional. */
  approvalEvidenceState: ArvEvidenceState | null;
  approvalDecision: "APPROVED" | "OVERRIDE" | null;
  approvedAt: string | null;
};

export type SellerContactSnapshot = {
  noticeAddress: FieldDisposition<string>;
  noticePhone: FieldDisposition<string>;
  noticeEmail: FieldDisposition<string>;
};

export type DispositionHandoffRecord = {
  kind: "disposition_handoff";
  handoffId: string;
  createdAt: string;
  opportunityId: string;
  contactId: string;
  agreementAt: string;
  version: ContractVersionIdentity;

  underContract: {
    acceptedSendAttemptId: string;
    providerDocumentId: string;
    providerDocumentReference: string | null;
    providerDocumentRevision: number | null;
    providerReportedCompletionAt: string;
    artifactSha256: string;
    verifiedAt: string;
  };

  propertyAddress: FieldDisposition<string>;
  propertyLegalDescription: PropertyLegalDescriptionReport;

  sellerContractPrice: number;
  approvedArv: ApprovedArvSnapshot;
  approvedRepairs: number;

  closingDate: FieldDisposition<string>;
  possessionDetails: FieldDisposition<ValueOrNone>;
  accessShowingInformation: FieldDisposition<string>;

  sellerContact: SellerContactSnapshot;
  requiredSigners: readonly RequiredSigner[];
  verifiedSigners: readonly VerifiedSignerMatch[];

  documentReferences: readonly DocumentReference[];
  documentReferencesNote: string;

  evidenceSummary: string;
};

export type HandoffBuildReasonCode =
  | "HANDOFF_ID_BLANK"
  | "CREATED_AT_INVALID"
  | "EVIDENCE_SUMMARY_BLANK"
  | "OPPORTUNITY_ID_BLANK"
  | "CONTACT_ID_BLANK"
  | "AGREEMENT_VERSION_MISMATCH"
  | "PROPERTY_ADDRESS_MISSING"
  | "SELLER_CONTRACT_PRICE_MISSING"
  | "APPROVED_ARV_MISSING"
  | "APPROVED_REPAIRS_MISSING"
  | "REQUIRED_SIGNERS_EMPTY"
  | "NOT_ELIGIBLE";

export type HandoffBuildReason = { code: HandoffBuildReasonCode; message: string };

/**
 * Builds ONE frozen `DispositionHandoffRecord`. Never called except after
 * `evaluateDispositionHandoffEligibility` above has already returned
 * `eligible: true` for the SAME evidence -- re-checked here as
 * `eligibility` (defense in depth, matching every other Board 9 builder's
 * own pattern of never trusting a caller's prior check unchecked).
 *
 * ESSENTIAL FACTS block outright when missing: property address, seller
 * contract price, approved ARV, approved repairs, and at least one
 * required signer -- all needed to identify the deal, contract,
 * execution, or economics, per this issue's own instruction. Every other
 * fact is OPTIONAL and is disclosed via its own `FieldDisposition`,
 * copied verbatim from its upstream source -- never fabricated, never
 * silently dropped.
 */
export function buildDispositionHandoffRecordArgs(args: {
  handoffId: string;
  createdAt: string;
  opportunityId: string;
  contactId: string;
  agreementAt: string;
  version: ContractVersionIdentity;
  eligibility: { eligible: true } | { eligible: false; reasons: HandoffEligibilityReason[] };
  underContract: UnderContractRecordEntry;
  propertyAddress: FieldDisposition<string>;
  propertyLegalDescription: PropertyLegalDescriptionReport;
  sellerContractPrice: number | null;
  approvedArv: ApprovedArvSnapshot | null;
  approvedRepairs: number | null;
  closingDate: FieldDisposition<string>;
  possessionDetails: FieldDisposition<ValueOrNone>;
  accessShowingInformation: FieldDisposition<string>;
  sellerContact: SellerContactSnapshot;
  requiredSigners: readonly RequiredSigner[];
  documentReferences: readonly DocumentReference[];
  documentReferencesNote: string;
  evidenceSummary: string;
}): { ok: true; value: DispositionHandoffRecord } | { ok: false; reasons: HandoffBuildReason[] } {
  const reasons: HandoffBuildReason[] = [];
  if (args.handoffId.trim() === "") reasons.push({ code: "HANDOFF_ID_BLANK", message: "handoffId is blank." });
  if (!isValidIsoInstant(args.createdAt)) reasons.push({ code: "CREATED_AT_INVALID", message: "createdAt is not a valid instant." });
  if (args.evidenceSummary.trim() === "") reasons.push({ code: "EVIDENCE_SUMMARY_BLANK", message: "evidenceSummary is required." });
  if (args.opportunityId.trim() === "") reasons.push({ code: "OPPORTUNITY_ID_BLANK", message: "opportunityId is blank." });
  if (args.contactId.trim() === "") reasons.push({ code: "CONTACT_ID_BLANK", message: "contactId is blank." });
  if (args.agreementAt !== args.version.agreementAt) {
    reasons.push({ code: "AGREEMENT_VERSION_MISMATCH", message: "The declared Agreement Reached identity does not match this contract version's own agreementAt." });
  }
  if (!args.eligibility.eligible) {
    reasons.push({ code: "NOT_ELIGIBLE", message: "Disposition handoff eligibility was not confirmed for this exact evidence: " + args.eligibility.reasons.map((r) => r.message).join(" ") });
  }
  if (args.propertyAddress.kind !== "populated") {
    reasons.push({ code: "PROPERTY_ADDRESS_MISSING", message: "Property address is essential to identify the deal and is not confirmed." });
  }
  if (args.sellerContractPrice === null || !Number.isFinite(args.sellerContractPrice)) {
    reasons.push({ code: "SELLER_CONTRACT_PRICE_MISSING", message: "The seller contract price is essential deal economics and is missing." });
  }
  if (args.approvedArv === null || !Number.isFinite(args.approvedArv.amount)) {
    reasons.push({ code: "APPROVED_ARV_MISSING", message: "Approved ARV is essential deal economics and is missing." });
  }
  if (args.approvedRepairs === null || !Number.isFinite(args.approvedRepairs)) {
    reasons.push({ code: "APPROVED_REPAIRS_MISSING", message: "Approved repairs is essential deal economics and is missing." });
  }
  if (args.requiredSigners.length === 0) {
    reasons.push({ code: "REQUIRED_SIGNERS_EMPTY", message: "At least one required signer is essential to identify the executed contract and none is present." });
  }
  if (reasons.length > 0) return { ok: false, reasons };

  return {
    ok: true,
    value: {
      kind: "disposition_handoff",
      handoffId: args.handoffId,
      createdAt: args.createdAt,
      opportunityId: args.opportunityId,
      contactId: args.contactId,
      agreementAt: args.agreementAt,
      version: args.version,
      underContract: {
        acceptedSendAttemptId: args.underContract.acceptedSendAttemptId,
        providerDocumentId: args.underContract.providerDocumentId,
        providerDocumentReference: args.underContract.providerDocumentReference,
        providerDocumentRevision: args.underContract.providerDocumentRevision,
        providerReportedCompletionAt: args.underContract.providerReportedCompletionAt,
        artifactSha256: args.underContract.artifactSha256,
        verifiedAt: args.underContract.iaosVerifiedAt,
      },
      propertyAddress: args.propertyAddress,
      propertyLegalDescription: args.propertyLegalDescription,
      sellerContractPrice: args.sellerContractPrice as number,
      approvedArv: args.approvedArv as ApprovedArvSnapshot,
      approvedRepairs: args.approvedRepairs as number,
      closingDate: args.closingDate,
      possessionDetails: args.possessionDetails,
      accessShowingInformation: args.accessShowingInformation,
      sellerContact: args.sellerContact,
      requiredSigners: args.requiredSigners,
      verifiedSigners: args.underContract.signers,
      documentReferences: args.documentReferences,
      documentReferencesNote: args.documentReferencesNote,
      evidenceSummary: args.evidenceSummary,
    },
  };
}

/* ==================================================================== */
/* 3. Currency -- a recorded handoff is only ever matched to the EXACT   */
/*    verified execution it was built from                               */
/* ==================================================================== */

export type HandoffCurrencyReasonCode =
  | "HANDOFF_OPPORTUNITY_MISMATCH"
  | "HANDOFF_AGREEMENT_MISMATCH"
  | "HANDOFF_VERSION_MISMATCH"
  | "HANDOFF_UNDER_CONTRACT_MISMATCH";

export type HandoffCurrencyReason = { code: HandoffCurrencyReasonCode; message: string };

/** Confirms a specific recorded handoff genuinely corresponds to the CURRENT verified Under Contract evidence -- used for duplicate detection and for honest display, never for re-deriving the snapshot's own content. */
export function verifyHandoffMatchesUnderContract(args: {
  handoff: DispositionHandoffRecord;
  opportunityId: string;
  agreementAt: string;
  version: ContractVersionIdentity;
  underContract: UnderContractRecordEntry;
}): { ok: true } | { ok: false; reasons: HandoffCurrencyReason[] } {
  const reasons: HandoffCurrencyReason[] = [];
  if (args.handoff.opportunityId !== args.opportunityId) reasons.push({ code: "HANDOFF_OPPORTUNITY_MISMATCH", message: "The recorded handoff's opportunityId does not match this evidence." });
  if (args.handoff.agreementAt !== args.agreementAt) reasons.push({ code: "HANDOFF_AGREEMENT_MISMATCH", message: "The recorded handoff's Agreement Reached identity does not match this evidence." });
  if (!isSameContractVersion(args.handoff.version, args.version)) reasons.push({ code: "HANDOFF_VERSION_MISMATCH", message: "The recorded handoff's contract version does not match this evidence." });
  if (args.handoff.underContract.verifiedAt !== args.underContract.iaosVerifiedAt) reasons.push({ code: "HANDOFF_UNDER_CONTRACT_MISMATCH", message: "The recorded handoff's Under Contract verification identity does not match the current Under Contract record." });
  return reasons.length > 0 ? { ok: false, reasons } : { ok: true };
}
