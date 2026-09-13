/**
 * Board #9 required signer set + Brad's own recipient-mapping attestation.
 * B9-10 / INV-65, Product Owner ruling, 2026-09-13:
 *
 *   "For single-user IAOS V1, Brad may factually map each GHL provider
 *   recipient ID to its corresponding required contract signer after
 *   visually verifying that mapping in GHL. This is factual evidence
 *   only. IAOS must not determine legal signing authority, contractual
 *   validity, or legal consequences."
 *
 * PURE. No I/O, no React. Two distinct, independently-verified facts
 * live in this module, matching the ruling's own two-part structure:
 *
 *   1. THE REQUIRED SIGNER SET (`buildRequiredSignerSet`,
 *      `validateRequiredSignerSet`) -- WHO must sign, derived from
 *      IAOS's own already-durable authoritative contract facts: BTC
 *      LLC's configured buyer signer (`SellerContractFactsReport.
 *      noticeContact.buyerSignerName`/`buyerSignerRole`, sourced from
 *      `BuyerBusinessConfigFacts`) and EVERY recorded seller signer
 *      (`SellerContractFactsReport.parties.sellerSigners`, sourced from
 *      `PartySignerFacts`) -- NEVER from the INV-63 accepted send's own
 *      `signers[]` field. That field describes who IAOS asked GHL to
 *      send a document to at send time; it is evidence of a REQUEST, not
 *      an authoritative statement of who a contract legally requires as
 *      a party. Conflating the two was the exact failure mode the prior
 *      round's `deriveDeterministicSignerMappingsFromAcceptedSend`
 *      (`contract-send-carriers.ts`, now removed) risked normalizing --
 *      this module replaces it entirely, not merely alongside it.
 *
 *   2. THE RECIPIENT MAPPING (`buildSignerMappingAttestationRecordArgs`,
 *      `verifySignerMappingAttestationCurrency`) -- Brad's own manual,
 *      one-to-one assignment of each required signer above to exactly
 *      one provider recipient ID observed in the live GHL readback for
 *      the exact document being verified. NEVER auto-paired by array
 *      order, GHL's own generic `role` string, or a guessed name/email
 *      match -- the caller (`ContractWorkspace.tsx`) presents Brad with
 *      the full, plain list of required signers and the full, plain
 *      list of provider recipient IDs, and Brad picks. This module only
 *      validates that whatever Brad picked is complete (every required
 *      signer mapped), exhaustive (every observed provider recipient
 *      mapped -- never a silently-ignored extra recipient), and
 *      unambiguous (no duplicate signer, no duplicate recipient id) --
 *      it never infers or suggests a pairing itself.
 *
 * NEVER LEGAL JUDGMENT. Nothing here determines legal signing authority
 * or contractual validity -- `signingAuthorityNote` (carried through from
 * `SellerSignerFact`, `seller-contract-facts-carriers.ts`) remains
 * disclosure-level only, exactly as `board9-contract-model.ts`'s own
 * `SignerRequirement` type already documents.
 *
 * SINGLE-USER V1 AUTHORITY. `operator`/`authorizedBy` are hardcoded
 * literal `"brad"` inside `buildSignerMappingAttestationRecordArgs` --
 * never caller-supplied -- matching `contract-authorization-model.ts`'s
 * and `contract-executed-terms-attestation-model.ts`'s own precedent.
 */

import { type ContractVersionIdentity, isSameContractVersion } from "./board9-contract-model";
import { type SellerContractFactsReport } from "./contract-facts-model";

function isValidIsoInstant(at: string): boolean {
  return Number.isFinite(new Date(at).getTime());
}

/* ==================================================================== */
/* 1. The required signer set -- WHO must sign, never derived from send  */
/* ==================================================================== */

export type RequiredSigner = { role: string; displayName: string };

export type RequiredSignerSetReasonCode =
  | "BUYER_SIGNER_UNRESOLVED"
  | "BUYER_SIGNER_BLANK"
  | "SELLER_SIGNERS_UNRESOLVED"
  | "NO_SELLER_SIGNERS"
  | "SIGNER_BLANK_ROLE"
  | "SIGNER_BLANK_NAME"
  | "DUPLICATE_SIGNER_ROLE";

export type RequiredSignerSetReason = { code: RequiredSignerSetReasonCode; message: string };

/** Re-validates an already-assembled required signer set -- reused both by `buildRequiredSignerSet` below and as defense in depth by `contract-execution-model.ts` against a caller-supplied set built some other way. */
export function validateRequiredSignerSet(
  signers: readonly RequiredSigner[],
): { ok: true } | { ok: false; reasons: RequiredSignerSetReason[] } {
  const reasons: RequiredSignerSetReason[] = [];
  if (signers.length === 0) {
    reasons.push({ code: "NO_SELLER_SIGNERS", message: "No required signers are present at all." });
  }
  for (const s of signers) {
    if (s.role.trim() === "") reasons.push({ code: "SIGNER_BLANK_ROLE", message: "A required signer has a blank role." });
    if (s.displayName.trim() === "") reasons.push({ code: "SIGNER_BLANK_NAME", message: `Required signer role "${s.role}" has a blank display name.` });
  }
  const roles = signers.map((s) => s.role);
  if (new Set(roles).size !== roles.length) {
    reasons.push({ code: "DUPLICATE_SIGNER_ROLE", message: "The required signer set contains a duplicate role -- an ambiguous identity." });
  }
  return reasons.length > 0 ? { ok: false, reasons } : { ok: true };
}

/**
 * Assembles the REQUIRED signer set from IAOS's own already-durable
 * authoritative facts: BTC LLC's configured buyer signer PLUS every
 * recorded seller signer. Fails closed (never a partial/best-effort set)
 * when either source is unresolved, blank, empty, or -- across BOTH
 * sources combined -- ambiguous (a duplicate role, e.g. a seller signer
 * accidentally recorded under the same role string as the buyer).
 */
export function buildRequiredSignerSet(
  report: SellerContractFactsReport,
): { ok: true; signers: readonly RequiredSigner[] } | { ok: false; reasons: RequiredSignerSetReason[] } {
  const { buyerSignerName, buyerSignerRole } = report.noticeContact;
  const sellerSigners = report.parties.sellerSigners;

  const reasons: RequiredSignerSetReason[] = [];
  if (buyerSignerName.kind !== "populated" || buyerSignerRole.kind !== "populated") {
    reasons.push({ code: "BUYER_SIGNER_UNRESOLVED", message: "BTC LLC's configured authorized buyer signer has not been recorded yet." });
  } else if (buyerSignerName.value.trim() === "" || buyerSignerRole.value.trim() === "") {
    reasons.push({ code: "BUYER_SIGNER_BLANK", message: "BTC LLC's configured buyer signer name or role is blank." });
  }
  if (sellerSigners.kind !== "populated") {
    reasons.push({ code: "SELLER_SIGNERS_UNRESOLVED", message: "No seller signer(s) have been recorded yet." });
  } else if (sellerSigners.value.length === 0) {
    reasons.push({ code: "NO_SELLER_SIGNERS", message: "The recorded seller signer list is empty -- at least one seller signer is required." });
  }
  if (reasons.length > 0) return { ok: false, reasons };

  // Re-check (narrows for TS, and is a real safety net): both sources
  // must be genuinely populated with a non-blank value by this point.
  if (
    buyerSignerName.kind !== "populated" || buyerSignerRole.kind !== "populated" ||
    buyerSignerName.value.trim() === "" || buyerSignerRole.value.trim() === "" ||
    sellerSigners.kind !== "populated" || sellerSigners.value.length === 0
  ) {
    return { ok: false, reasons: [{ code: "BUYER_SIGNER_UNRESOLVED", message: "Required signer fields resolved inconsistently -- refusing to assemble a partial set." }] };
  }

  const signers: RequiredSigner[] = [
    { role: buyerSignerRole.value, displayName: buyerSignerName.value },
    ...sellerSigners.value.map((s) => ({ role: s.role, displayName: s.displayName ?? "" })),
  ];
  const validated = validateRequiredSignerSet(signers);
  if (!validated.ok) return validated;
  return { ok: true, signers };
}

/* ==================================================================== */
/* 2. Brad's recipient-mapping attestation -- manual, one-to-one, never  */
/*    auto-paired                                                        */
/* ==================================================================== */

export type SignerRecipientMapping = { role: string; displayName: string; providerRecipientId: string };

export type SignerMappingAttestationRecord = {
  kind: "signer_mapping_attestation";
  opportunityId: string;
  version: ContractVersionIdentity;
  agreementAt: string;
  providerDocumentId: string;
  providerDocumentRevision: number | null;
  acceptedSendAttemptId: string;
  operator: "brad";
  authorizedBy: "brad";
  attestedAt: string;
  mappings: readonly SignerRecipientMapping[];
  evidenceSummary: string;
};

export type MappingBuildReasonCode =
  | "OPPORTUNITY_ID_BLANK"
  | "ATTESTED_AT_INVALID"
  | "EVIDENCE_SUMMARY_BLANK"
  | "PROVIDER_DOCUMENT_ID_BLANK"
  | "ACCEPTED_SEND_ATTEMPT_ID_BLANK"
  | "AGREEMENT_VERSION_MISMATCH"
  | "REQUIRED_SIGNERS_INVALID"
  | "AVAILABLE_RECIPIENTS_EMPTY"
  | "AVAILABLE_RECIPIENTS_DUPLICATE"
  | "MAPPING_COUNT_MISMATCH"
  | "SIGNER_MISSING"
  | "SIGNER_DUPLICATE"
  | "SIGNER_UNKNOWN"
  | "RECIPIENT_UNKNOWN"
  | "RECIPIENT_DUPLICATE"
  | "RECIPIENT_UNMAPPED";

export type MappingBuildReason = { code: MappingBuildReasonCode; message: string };

/**
 * Validates and builds ONE `SignerMappingAttestationRecord`. Requires a
 * TRUE bijection between `requiredSigners` and `availableProviderRecipientIds`
 * -- every required signer assigned to exactly one recipient, every
 * observed recipient assigned to exactly one required signer, no
 * duplicate on either side, no assignment naming a role or recipient id
 * outside the two supplied sets. Never pairs by array order, a generic
 * provider role string, or a guessed name/email match -- `assignments`
 * must come from Brad's own explicit, per-item selection in the caller.
 */
export function buildSignerMappingAttestationRecordArgs(args: {
  opportunityId: string;
  version: ContractVersionIdentity;
  agreementAt: string;
  providerDocumentId: string;
  providerDocumentRevision: number | null;
  acceptedSendAttemptId: string;
  attestedAt: string;
  requiredSigners: readonly RequiredSigner[];
  availableProviderRecipientIds: readonly string[];
  assignments: readonly { role: string; providerRecipientId: string }[];
  evidenceSummary: string;
}): { ok: true; value: SignerMappingAttestationRecord } | { ok: false; reasons: MappingBuildReason[] } {
  const reasons: MappingBuildReason[] = [];
  if (args.opportunityId.trim() === "") reasons.push({ code: "OPPORTUNITY_ID_BLANK", message: "opportunityId is blank." });
  if (!isValidIsoInstant(args.attestedAt)) reasons.push({ code: "ATTESTED_AT_INVALID", message: "attestedAt is not a valid instant." });
  if (args.evidenceSummary.trim() === "") reasons.push({ code: "EVIDENCE_SUMMARY_BLANK", message: "evidenceSummary is required." });
  if (args.providerDocumentId.trim() === "") reasons.push({ code: "PROVIDER_DOCUMENT_ID_BLANK", message: "providerDocumentId is blank." });
  if (args.acceptedSendAttemptId.trim() === "") reasons.push({ code: "ACCEPTED_SEND_ATTEMPT_ID_BLANK", message: "acceptedSendAttemptId is blank." });
  if (args.agreementAt !== args.version.agreementAt) {
    reasons.push({ code: "AGREEMENT_VERSION_MISMATCH", message: "The declared Agreement Reached identity does not match this contract version's own agreementAt." });
  }
  const requiredCheck = validateRequiredSignerSet(args.requiredSigners);
  if (!requiredCheck.ok) {
    reasons.push({ code: "REQUIRED_SIGNERS_INVALID", message: "The supplied required signer set is itself invalid: " + requiredCheck.reasons.map((r) => r.message).join(" ") });
  }
  if (args.availableProviderRecipientIds.length === 0) {
    reasons.push({ code: "AVAILABLE_RECIPIENTS_EMPTY", message: "No provider recipients were observed in the readback -- there is nothing to map." });
  }
  const availableIdSet = new Set(args.availableProviderRecipientIds);
  if (availableIdSet.size !== args.availableProviderRecipientIds.length) {
    reasons.push({ code: "AVAILABLE_RECIPIENTS_DUPLICATE", message: "The supplied available provider recipient ids contain a duplicate -- malformed readback evidence, never trusted." });
  }
  if (reasons.length > 0) return { ok: false, reasons };

  // A true bijection requires equal cardinality on both sides -- if the
  // document has a different number of recipients than there are
  // required signers, no valid one-to-one mapping can exist at all.
  if (args.requiredSigners.length !== args.availableProviderRecipientIds.length) {
    return {
      ok: false,
      reasons: [{
        code: "MAPPING_COUNT_MISMATCH",
        message: `The document reports ${args.availableProviderRecipientIds.length} provider recipient(s), but ${args.requiredSigners.length} signer(s) are required -- no one-to-one mapping can exist until this is reconciled.`,
      }],
    };
  }
  if (args.assignments.length !== args.requiredSigners.length) {
    return {
      ok: false,
      reasons: [{ code: "MAPPING_COUNT_MISMATCH", message: `Expected exactly ${args.requiredSigners.length} assignment(s) (one per required signer), got ${args.assignments.length}.` }],
    };
  }

  // Duplicate-role is checked BEFORE missing-role: under the bijection's
  // equal-cardinality precondition (already enforced above), a duplicate
  // assigned role always implies some other required role went
  // unassigned by pigeonhole -- checking missing first would make
  // SIGNER_DUPLICATE structurally unreachable as its own diagnostic.
  const requiredRoles = args.requiredSigners.map((s) => s.role);
  const assignedRoles = args.assignments.map((a) => a.role);
  if (new Set(assignedRoles).size !== assignedRoles.length) {
    return { ok: false, reasons: [{ code: "SIGNER_DUPLICATE", message: "The same required signer role was assigned more than once." }] };
  }
  const missingRoles = requiredRoles.filter((r) => !assignedRoles.includes(r));
  if (missingRoles.length > 0) {
    return { ok: false, reasons: [{ code: "SIGNER_MISSING", message: `No assignment was made for required signer role(s): ${missingRoles.join(", ")}.` }] };
  }
  const unknownRoles = assignedRoles.filter((r) => !requiredRoles.includes(r));
  if (unknownRoles.length > 0) {
    return { ok: false, reasons: [{ code: "SIGNER_UNKNOWN", message: `Assignment names a role that is not a required signer: ${unknownRoles.join(", ")}.` }] };
  }

  const assignedIds = args.assignments.map((a) => a.providerRecipientId);
  const unknownIds = assignedIds.filter((id) => !availableIdSet.has(id));
  if (unknownIds.length > 0) {
    return { ok: false, reasons: [{ code: "RECIPIENT_UNKNOWN", message: `Assignment names a provider recipient id not present in the readback: ${unknownIds.join(", ")}.` }] };
  }
  if (new Set(assignedIds).size !== assignedIds.length) {
    return { ok: false, reasons: [{ code: "RECIPIENT_DUPLICATE", message: "The same provider recipient id was assigned to more than one required signer." }] };
  }
  const unmappedIds = args.availableProviderRecipientIds.filter((id) => !assignedIds.includes(id));
  if (unmappedIds.length > 0) {
    return { ok: false, reasons: [{ code: "RECIPIENT_UNMAPPED", message: `Provider recipient id(s) observed in the readback were never assigned to a required signer: ${unmappedIds.join(", ")}.` }] };
  }

  const mappings: SignerRecipientMapping[] = args.requiredSigners.map((s) => ({
    role: s.role,
    displayName: s.displayName,
    providerRecipientId: args.assignments.find((a) => a.role === s.role)!.providerRecipientId,
  }));

  return {
    ok: true,
    value: {
      kind: "signer_mapping_attestation",
      opportunityId: args.opportunityId,
      version: args.version,
      agreementAt: args.agreementAt,
      providerDocumentId: args.providerDocumentId,
      providerDocumentRevision: args.providerDocumentRevision,
      acceptedSendAttemptId: args.acceptedSendAttemptId,
      operator: "brad",
      authorizedBy: "brad",
      attestedAt: args.attestedAt,
      mappings,
      evidenceSummary: args.evidenceSummary,
    },
  };
}

/* ==================================================================== */
/* 3. Currency -- a recorded mapping attestation is only ever reused for */
/*    the EXACT evidence it was made against                             */
/* ==================================================================== */

export type MappingCurrencyReasonCode =
  | "MAPPING_ATTESTATION_MISSING"
  | "MAPPING_ATTESTATION_NOT_BRAD"
  | "MAPPING_ATTESTATION_OPPORTUNITY_MISMATCH"
  | "MAPPING_ATTESTATION_VERSION_MISMATCH"
  | "MAPPING_ATTESTATION_DOCUMENT_MISMATCH"
  | "MAPPING_ATTESTATION_REVISION_MISMATCH"
  | "MAPPING_ATTESTATION_SEND_MISMATCH"
  | "MAPPING_ATTESTATION_REQUIRED_SIGNERS_CHANGED";

export type MappingCurrencyReason = { code: MappingCurrencyReasonCode; message: string };

function signerSetKey(signers: readonly RequiredSigner[]): string {
  return JSON.stringify([...signers].map((s) => ({ role: s.role, displayName: s.displayName })).sort((a, b) => a.role.localeCompare(b.role)));
}

/**
 * Re-checks, independently of `buildSignerMappingAttestationRecordArgs`'s
 * own gate, that a previously-recorded mapping attestation is still
 * CURRENT for the exact opportunity/version/provider document/revision/
 * accepted-send/required-signer-set being verified right now. A change
 * to ANY of these -- including the required signer set itself changing
 * (e.g. a seller signer fact edited after Brad mapped recipients) --
 * invalidates the prior mapping; it is never silently reused.
 */
export function verifySignerMappingAttestationCurrency(args: {
  attestation: SignerMappingAttestationRecord | null;
  opportunityId: string;
  version: ContractVersionIdentity;
  providerDocumentId: string;
  providerDocumentRevision: number | null;
  acceptedSendAttemptId: string;
  requiredSigners: readonly RequiredSigner[];
}): { ok: true; mappings: readonly SignerRecipientMapping[]; attestedAt: string } | { ok: false; reasons: MappingCurrencyReason[] } {
  if (args.attestation === null) {
    return { ok: false, reasons: [{ code: "MAPPING_ATTESTATION_MISSING", message: "No signer-recipient mapping has been recorded for this evidence." }] };
  }
  const a = args.attestation;
  const reasons: MappingCurrencyReason[] = [];
  if (a.operator !== "brad" || a.authorizedBy !== "brad") {
    reasons.push({ code: "MAPPING_ATTESTATION_NOT_BRAD", message: "The recorded mapping was not made by Brad -- V1 permits no other attester." });
  }
  if (a.opportunityId !== args.opportunityId) {
    reasons.push({ code: "MAPPING_ATTESTATION_OPPORTUNITY_MISMATCH", message: "The recorded mapping's opportunityId does not match this evidence." });
  }
  if (!isSameContractVersion(a.version, args.version)) {
    reasons.push({ code: "MAPPING_ATTESTATION_VERSION_MISMATCH", message: "The recorded mapping's contract version does not match this evidence -- a stale or cross-version mapping is never reused." });
  }
  if (a.providerDocumentId !== args.providerDocumentId) {
    reasons.push({ code: "MAPPING_ATTESTATION_DOCUMENT_MISMATCH", message: "The recorded mapping's provider document id does not match this evidence." });
  }
  if (a.providerDocumentRevision !== args.providerDocumentRevision) {
    reasons.push({ code: "MAPPING_ATTESTATION_REVISION_MISMATCH", message: "The recorded mapping's provider document revision does not match this evidence -- the document has changed since Brad mapped it." });
  }
  if (a.acceptedSendAttemptId !== args.acceptedSendAttemptId) {
    reasons.push({ code: "MAPPING_ATTESTATION_SEND_MISMATCH", message: "The recorded mapping's accepted-send identity does not match this evidence." });
  }
  if (signerSetKey(a.mappings.map((m) => ({ role: m.role, displayName: m.displayName }))) !== signerSetKey(args.requiredSigners)) {
    reasons.push({ code: "MAPPING_ATTESTATION_REQUIRED_SIGNERS_CHANGED", message: "The required signer set has changed since this mapping was recorded -- it is never silently reused." });
  }
  if (reasons.length > 0) return { ok: false, reasons };
  return { ok: true, mappings: a.mappings, attestedAt: a.attestedAt };
}
