/**
 * Board #9 executed-terms attestation -- Brad's own factual, visual
 * comparison of the material terms printed on the selected, hash-verified
 * executed PDF against the authoritative Agreement Reached record. B9-10 /
 * INV-65, Product Owner ruling, 2026-09-13:
 *
 *   "For single-user IAOS V1, Brad's factual visual attestation may
 *   verify that the material terms visible in the selected, hash-verified
 *   executed PDF match the authoritative Agreement Reached record."
 *
 * PURE. No I/O, no React, no OCR/extraction, no PDF parsing. IAOS never
 * reads, interprets, or judges the PDF's own content -- Brad does,
 * visually, entirely outside this module. This module only:
 *
 *   1. Builds the checklist items Brad is shown (`buildExecutedTermsChecklist`),
 *      sourced ENTIRELY from IAOS's own already-held authoritative facts
 *      (the Agreement Reached `MaterialTermSnapshot`, the fixed buyer
 *      identity, and the deterministically-derived expected signers) --
 *      NEVER from the PDF itself, which this module never touches.
 *   2. Validates Brad's own responses are complete, well-formed, and
 *      UNANIMOUS `"MATCHES"` before ever treating an attestation as real
 *      evidence (`buildExecutedTermsAttestationRecordArgs`) -- any single
 *      `"DOES_NOT_MATCH"` or `"CANNOT_VERIFY"` blocks the whole record
 *      from ever being built, per the ruling's own item 3.
 *   3. Re-checks, independently, that a previously-recorded attestation
 *      is still CURRENT for the EXACT opportunity/version/provider
 *      document/revision/artifact hash being verified today
 *      (`verifyExecutedTermsAttestationCurrency`) -- a stale, cross-
 *      version, cross-document, or cross-artifact attestation is never
 *      silently reused, matching the ruling's item 5 ("missing,
 *      mismatched, stale, cross-version, malformed, or uncertain
 *      evidence must fail closed").
 *
 * NEVER LEGAL JUDGMENT (ruling item 6). No function in this file
 * interprets contract language, determines legal validity, or gives
 * legal advice -- it only compares IAOS's own already-recorded facts
 * against Brad's own plain per-item MATCHES/DOES_NOT_MATCH/CANNOT_VERIFY
 * responses, and enforces that the comparison is complete and unanimous
 * before it can count as evidence.
 *
 * SINGLE-USER V1 AUTHORITY. `operator`/`authorizedBy` are hardcoded
 * literal `"brad"` inside `buildExecutedTermsAttestationRecordArgs` --
 * never accepted as a caller-supplied value -- exactly matching
 * `contract-authorization-model.ts`'s own `buildAuthorizationRecordArgs`
 * precedent (its own `NOT_BRAD`/`OPERATOR_NOT_BRAD` reason codes are
 * mirrored here as `ATTESTATION_NOT_BRAD`).
 */

import { type ContractVersionIdentity, isSameContractVersion, type MaterialTermSnapshot } from "./board9-contract-model";

function isValidIsoInstant(at: string): boolean {
  return Number.isFinite(new Date(at).getTime());
}

function formatUsd(price: number): string {
  return `$${price.toLocaleString("en-US")}`;
}

/* ==================================================================== */
/* 1. The checklist -- items sourced from IAOS's OWN authoritative facts */
/* ==================================================================== */

export type ChecklistItemKind =
  | "property_identity"
  | "purchase_price"
  | "buyer_identity"
  | "signing_party"
  | "other_material_terms";

export type ChecklistItem = {
  kind: ChecklistItemKind;
  /** Only meaningful for `kind: "signing_party"` -- which required signer this item names. `null` for every other kind. */
  signerRole: string | null;
  /** The authoritative value/description Brad compares the PDF against -- sourced entirely from IAOS's own already-held facts, never from the PDF. */
  authoritativeLabel: string;
};

/**
 * Builds the REQUIRED checklist, in a fixed, deterministic order: property
 * identity, purchase price, buyer identity, one item PER required signing
 * party (ruling item 1: "every required seller/signing party" -- never
 * merged into one item), and a single catch-all "other material terms"
 * item for whatever `detectMaterialConflicts`' own bright-line fields
 * beyond price/property/parties would otherwise flag.
 */
export function buildExecutedTermsChecklist(args: {
  agreement: MaterialTermSnapshot;
  buyerIdentity: string;
  expectedSigners: readonly { role: string; displayName: string }[];
}): readonly ChecklistItem[] {
  const items: ChecklistItem[] = [
    { kind: "property_identity", signerRole: null, authoritativeLabel: args.agreement.propertyAddress },
    { kind: "purchase_price", signerRole: null, authoritativeLabel: formatUsd(args.agreement.price) },
    { kind: "buyer_identity", signerRole: null, authoritativeLabel: args.buyerIdentity },
  ];
  // Gate-review closure -- Finding H, Product Owner ruling: "Manager" is
  // IAOS's own internal authority/capacity metadata (preserved on
  // `signerRole` below for the durable signer mapping) and is never
  // printed beside a signature on the executed PDF. The operator is
  // asked to verify the printed PERSONAL identity only -- never asked to
  // attest that an internal capacity label appears on the document.
  for (const s of args.expectedSigners) {
    items.push({ kind: "signing_party", signerRole: s.role, authoritativeLabel: s.displayName });
  }
  items.push({
    kind: "other_material_terms",
    signerRole: null,
    authoritativeLabel: "Any other negotiated material term (price, property, or party detail not already covered above)",
  });
  return items;
}

/* ==================================================================== */
/* 2. Brad's responses -- MATCHES/DOES_NOT_MATCH/CANNOT_VERIFY, unanimous */
/*    MATCHES required (ruling items 2-3)                                */
/* ==================================================================== */

export type ChecklistResponseValue = "MATCHES" | "DOES_NOT_MATCH" | "CANNOT_VERIFY";

export type ChecklistItemResult = ChecklistItem & { result: ChecklistResponseValue };

export type ExecutedTermsAttestationRecord = {
  kind: "executed_terms_attestation";
  opportunityId: string;
  version: ContractVersionIdentity;
  agreementAt: string;
  providerDocumentId: string;
  providerDocumentRevision: number | null;
  selectedArtifactSha256: string;
  /** Reuses `contract-authorization-model.ts`'s own single-user V1 vocabulary -- hardcoded, never caller-supplied. See that module's `operator`/`authorizedBy` split. */
  operator: "brad";
  authorizedBy: "brad";
  attestedAt: string;
  items: readonly ChecklistItemResult[];
  evidenceSummary: string;
};

export type AttestationBuildReasonCode =
  | "OPPORTUNITY_ID_BLANK"
  | "ATTESTED_AT_INVALID"
  | "EVIDENCE_SUMMARY_BLANK"
  | "PROVIDER_DOCUMENT_ID_BLANK"
  | "ARTIFACT_SHA256_MALFORMED"
  | "AGREEMENT_VERSION_MISMATCH"
  | "NO_CHECKLIST_ITEMS"
  | "RESPONSE_COUNT_MISMATCH"
  | "RESPONSE_DUPLICATE_ITEM"
  | "RESPONSE_ITEM_MISMATCH"
  | "NOT_UNANIMOUS_MATCHES";

export type AttestationBuildReason = { code: AttestationBuildReasonCode; message: string };

function checklistItemKey(x: { kind: ChecklistItemKind; signerRole: string | null }): string {
  return `${x.kind}::${x.signerRole ?? ""}`;
}

/**
 * Validates and builds ONE `ExecutedTermsAttestationRecord`. Fails closed
 * (never a best-effort partial record) on: blank/invalid identity or
 * timestamp fields, a malformed (non-64-hex) SHA-256, a mismatched
 * Agreement Reached/version identity, zero required items, a response
 * count that does not exactly match the required items, a duplicate
 * response for the same item, a response set that does not correspond
 * exactly one-to-one to the required items (extra, missing, or
 * substituted items), or -- the ruling's own central gate -- any response
 * other than unanimous `"MATCHES"` across every single item.
 */
export function buildExecutedTermsAttestationRecordArgs(args: {
  opportunityId: string;
  version: ContractVersionIdentity;
  agreementAt: string;
  providerDocumentId: string;
  providerDocumentRevision: number | null;
  selectedArtifactSha256: string;
  attestedAt: string;
  requiredItems: readonly ChecklistItem[];
  responses: readonly { kind: ChecklistItemKind; signerRole: string | null; result: ChecklistResponseValue }[];
  evidenceSummary: string;
}): { ok: true; value: ExecutedTermsAttestationRecord } | { ok: false; reasons: AttestationBuildReason[] } {
  const reasons: AttestationBuildReason[] = [];
  if (args.opportunityId.trim() === "") reasons.push({ code: "OPPORTUNITY_ID_BLANK", message: "opportunityId is blank." });
  if (!isValidIsoInstant(args.attestedAt)) reasons.push({ code: "ATTESTED_AT_INVALID", message: "attestedAt is not a valid instant." });
  if (args.evidenceSummary.trim() === "") reasons.push({ code: "EVIDENCE_SUMMARY_BLANK", message: "evidenceSummary is required." });
  if (args.providerDocumentId.trim() === "") reasons.push({ code: "PROVIDER_DOCUMENT_ID_BLANK", message: "providerDocumentId is blank." });
  if (!/^[0-9a-f]{64}$/.test(args.selectedArtifactSha256)) {
    reasons.push({ code: "ARTIFACT_SHA256_MALFORMED", message: "selectedArtifactSha256 is not a real 64-character lowercase hex SHA-256." });
  }
  if (args.agreementAt !== args.version.agreementAt) {
    reasons.push({ code: "AGREEMENT_VERSION_MISMATCH", message: "The declared Agreement Reached identity does not match this contract version's own agreementAt." });
  }
  if (args.requiredItems.length === 0) {
    reasons.push({ code: "NO_CHECKLIST_ITEMS", message: "At least one checklist item is required -- an attestation over zero items proves nothing." });
  }
  if (reasons.length > 0) return { ok: false, reasons };

  if (args.responses.length !== args.requiredItems.length) {
    return {
      ok: false,
      reasons: [{
        code: "RESPONSE_COUNT_MISMATCH",
        message: `Expected exactly ${args.requiredItems.length} checklist response(s) (one per required item), got ${args.responses.length}.`,
      }],
    };
  }

  const responseKeys = args.responses.map(checklistItemKey);
  if (new Set(responseKeys).size !== responseKeys.length) {
    return { ok: false, reasons: [{ code: "RESPONSE_DUPLICATE_ITEM", message: "The supplied responses contain a duplicate checklist item." }] };
  }
  const requiredKeySet = new Set(args.requiredItems.map(checklistItemKey));
  const responseKeySet = new Set(responseKeys);
  const oneToOne = requiredKeySet.size === responseKeySet.size && [...requiredKeySet].every((k) => responseKeySet.has(k));
  if (!oneToOne) {
    return { ok: false, reasons: [{ code: "RESPONSE_ITEM_MISMATCH", message: "The supplied responses do not correspond exactly, one-to-one, to the required checklist items." }] };
  }

  const items: ChecklistItemResult[] = args.requiredItems.map((item) => {
    const response = args.responses.find((r) => checklistItemKey(r) === checklistItemKey(item))!;
    return { ...item, result: response.result };
  });

  if (!items.every((i) => i.result === "MATCHES")) {
    return {
      ok: false,
      reasons: [{
        code: "NOT_UNANIMOUS_MATCHES",
        message: "Every checklist item must be answered MATCHES -- any DOES_NOT_MATCH or CANNOT_VERIFY blocks executed-term verification (ruling item 3: only unanimous MATCHES may satisfy it).",
      }],
    };
  }

  return {
    ok: true,
    value: {
      kind: "executed_terms_attestation",
      opportunityId: args.opportunityId,
      version: args.version,
      agreementAt: args.agreementAt,
      providerDocumentId: args.providerDocumentId,
      providerDocumentRevision: args.providerDocumentRevision,
      selectedArtifactSha256: args.selectedArtifactSha256,
      operator: "brad",
      authorizedBy: "brad",
      attestedAt: args.attestedAt,
      items,
      evidenceSummary: args.evidenceSummary,
    },
  };
}

/* ==================================================================== */
/* 3. Currency -- a recorded attestation is only ever reused for the     */
/*    EXACT evidence it was made against (ruling item 5)                 */
/* ==================================================================== */

export type AttestationCurrencyReasonCode =
  | "ATTESTATION_MISSING"
  | "ATTESTATION_NOT_BRAD"
  | "ATTESTATION_OPPORTUNITY_MISMATCH"
  | "ATTESTATION_VERSION_MISMATCH"
  | "ATTESTATION_DOCUMENT_MISMATCH"
  | "ATTESTATION_REVISION_MISMATCH"
  | "ATTESTATION_ARTIFACT_HASH_MISMATCH"
  | "ATTESTATION_NOT_UNANIMOUS_MATCHES";

export type AttestationCurrencyReason = { code: AttestationCurrencyReasonCode; message: string };

/**
 * Re-checks, independently of `buildExecutedTermsAttestationRecordArgs`'s
 * own gate (defense in depth against a hand-edited or corrupted carrier
 * round-trip -- see `contract-executed-terms-attestation-carriers.ts`),
 * that a previously-recorded attestation is still CURRENT for the exact
 * opportunity/version/provider document/revision/artifact hash being
 * verified right now. A stale, cross-version, cross-document, cross-
 * revision, or cross-artifact attestation is never silently reused --
 * each mismatch fails closed under its own named reason.
 */
export function verifyExecutedTermsAttestationCurrency(args: {
  attestation: ExecutedTermsAttestationRecord | null;
  opportunityId: string;
  version: ContractVersionIdentity;
  providerDocumentId: string;
  providerDocumentRevision: number | null;
  selectedArtifactSha256: string;
}): { ok: true; attestedAt: string } | { ok: false; reasons: AttestationCurrencyReason[] } {
  if (args.attestation === null) {
    return { ok: false, reasons: [{ code: "ATTESTATION_MISSING", message: "No executed-terms attestation has been recorded for this evidence." }] };
  }
  const a = args.attestation;
  const reasons: AttestationCurrencyReason[] = [];
  if (a.operator !== "brad" || a.authorizedBy !== "brad") {
    reasons.push({ code: "ATTESTATION_NOT_BRAD", message: "The recorded attestation was not made by Brad -- V1 permits no other attester." });
  }
  if (a.opportunityId !== args.opportunityId) {
    reasons.push({ code: "ATTESTATION_OPPORTUNITY_MISMATCH", message: "The recorded attestation's opportunityId does not match this evidence." });
  }
  if (!isSameContractVersion(a.version, args.version)) {
    reasons.push({ code: "ATTESTATION_VERSION_MISMATCH", message: "The recorded attestation's contract version does not match this evidence -- a stale or cross-version attestation is never reused." });
  }
  if (a.providerDocumentId !== args.providerDocumentId) {
    reasons.push({ code: "ATTESTATION_DOCUMENT_MISMATCH", message: "The recorded attestation's provider document id does not match this evidence." });
  }
  if (a.providerDocumentRevision !== args.providerDocumentRevision) {
    reasons.push({ code: "ATTESTATION_REVISION_MISMATCH", message: "The recorded attestation's provider document revision does not match this evidence -- the document has changed since Brad attested." });
  }
  if (a.selectedArtifactSha256 !== args.selectedArtifactSha256) {
    reasons.push({ code: "ATTESTATION_ARTIFACT_HASH_MISMATCH", message: "The recorded attestation's artifact hash does not match the currently selected PDF -- a different file was selected since Brad attested." });
  }
  if (a.items.length === 0 || !a.items.every((i) => i.result === "MATCHES")) {
    reasons.push({ code: "ATTESTATION_NOT_UNANIMOUS_MATCHES", message: "The recorded attestation is not unanimous MATCHES across every checklist item." });
  }
  if (reasons.length > 0) return { ok: false, reasons };
  return { ok: true, attestedAt: a.attestedAt };
}
