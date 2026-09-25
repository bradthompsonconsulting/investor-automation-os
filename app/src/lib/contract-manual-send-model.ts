/**
 * Board #9 manual GHL send record -- the "record Brad's own completed
 * manual GHL send" bridge. B9-13 / INV-96.
 *
 * Pure. No I/O, no React. Product Owner architecture ruling, 2026-09-17:
 * V1's send step is a MANUAL bridge -- IAOS generates the populated PDF,
 * Brad reviews/authorizes it, Brad manually uploads it to GHL Documents &
 * Contracts himself, GHL handles signature/execution, and the verified
 * executed artifact returns through the existing Board #9 lifecycle. This
 * module builds the ONE record of step 3 -- that Brad actually did the
 * upload/send -- from his own manual entry of what he sees in GHL, never
 * from an automated POST response (`ghl-proxy.ts` GATE 2 unconditionally
 * refuses the automated send in every environment; see
 * `contract-send-model.ts`'s own, separate, not-live attempt/result
 * builders).
 *
 * REUSE, NEVER A NEW SCHEMA. `buildManualContractSendRecordArgs` below
 * produces args shaped for `contract-send-carriers.ts`'s own
 * `formatContractSendNote` -- the SAME durable Contract Sent note shape
 * every downstream INV-63/64/65 verification stage already reads via
 * `latestContractSendForOpportunity`/`verifyAcceptedSendBinding`. This
 * record is written directly at `status: "accepted"` -- the manual bridge
 * has no separate POST/readback pair to stage through (the two-stage
 * pending/terminal design in `contract-send-model.ts` exists specifically
 * to avoid trusting a bare POST response for the AUTOMATED path, which
 * does not apply here: Brad's own attestation that he completed the
 * upload IS the fact being recorded).
 *
 * AUTHORIZED REVISION/HASH BINDING. `authorizedRecord` must be the
 * CURRENT `ParsedBradContractAuthorization` for this exact opportunity,
 * and its `version` must exactly match the `version` this send record is
 * being built for (`AUTHORIZATION_VERSION_MISMATCH`) -- a stale or
 * cross-version authorization is never silently reused. The authorized
 * record's own `artifactSha256` is copied verbatim into the send record's
 * `authorizedArtifactSha256` field (schema v3, `contract-send-carriers.
 * ts`), so the exact authorized PDF hash is preserved durably on the send
 * record itself, not only recoverable by a separate cross-reference.
 *
 * RECIPIENTS ARE IAOS'S OWN REQUIRED SIGNER SET, NEVER FREE TEXT. `
 * recipients` must be supplied by the caller from `buildRequiredSignerSet`
 * (`contract-signer-mapping-model.ts`) -- the same authoritative required-
 * signer set every other Board #9 verification stage uses -- so the
 * recorded "recipient identities/order" can never drift from IAOS's own
 * facts through a retyped name.
 */

import { type ContractVersionIdentity, isSameContractVersion } from "./board9-contract-model";
import { type ParsedBradContractAuthorization } from "./contract-authorization-carriers";
import { type SignerSnapshot, type ProviderResponseSummary } from "./contract-send-carriers";

/** Matches `contract-send-carriers.ts`'s own `isCanonicalIsoTimestamp` exactly -- `requestAt` also becomes this record's `attemptId`, and `parseContractSendNote` requires BOTH to round-trip through `Date#toISOString()` unchanged, never merely "parseable." Duplicated per this codebase's own "local helpers duplicated rather than imported" carrier convention. */
function isCanonicalIsoTimestamp(at: string): boolean {
  const ms = new Date(at).getTime();
  if (!Number.isFinite(ms)) return false;
  return new Date(ms).toISOString() === at;
}

/** The manual bridge's own template-source marker -- audit-only, never gated on by any verification stage (`verifyAcceptedSendBinding` reads only `status`/`providerResponse.documentId`/`opportunityId`/`version`). */
export const MANUAL_SEND_TEMPLATE_SOURCE = "manual_ghl_upload" as const;

/**
 * INV-98 manual-send evidence correction. A manual GHL upload uses NO GHL
 * Documents & Contracts template, so the durable Contract Sent record's
 * `requestedTemplateId` and `templateName` state that explicitly -- never a
 * configured template id (Test) or the Production send-not-authorized
 * placeholder, either of which would read as a template claim. The builder
 * below always writes this value and accepts no caller-supplied template
 * identity; `write-note-guard.ts` refuses a manual send carrying anything
 * else. Existing notes are unaffected: `parseContractSendNote` still
 * round-trips any non-empty value they carry.
 */
export const MANUAL_SEND_NO_GHL_TEMPLATE = "NONE_MANUAL_GHL_UPLOAD" as const;

export type ManualSendBuildReasonCode =
  | "OPPORTUNITY_ID_BLANK"
  | "AGREEMENT_VERSION_MISMATCH"
  | "REQUEST_AT_INVALID"
  | "EXPIRATION_AT_INVALID"
  | "PROVIDER_DOCUMENT_ID_BLANK"
  | "RECIPIENTS_EMPTY"
  | "RECIPIENT_BLANK_ROLE"
  | "RECIPIENT_BLANK_NAME"
  | "DUPLICATE_RECIPIENT_ROLE"
  | "AUTHORIZATION_MISSING"
  | "AUTHORIZATION_VERSION_MISMATCH"
  | "AUTHORIZATION_HASH_INVALID"
  | "LOCATION_ID_BLANK";

export type ManualSendBuildReason = { code: ManualSendBuildReasonCode; message: string };

function isValidSha256(value: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(value);
}

export type ManualContractSendRecordArgs = {
  opportunityId: string;
  at: string;
  operator: string | null;
  attemptId: string;
  status: "accepted";
  version: ContractVersionIdentity;
  templateName: string;
  templateSource: string;
  requestedTemplateId: string;
  authorizedAt: string;
  authorizedArtifactSha256: string;
  signers: SignerSnapshot[];
  confirmedRecipientId: null;
  expirationAt: string | null;
  requestAt: string;
  iaosObservedAcceptanceAt: null;
  providerResponse: ProviderResponseSummary;
  failureReason: null;
};

/**
 * Validates and builds ONE manual Contract Send record, ready to be
 * serialized via `formatContractSendNote` and persisted through the same
 * sanctioned `ghl.notes.create()` every other Board #9 write uses.
 * Refuses to build (fails closed, never a partial/best-effort record) on
 * any blank required field, an invalid timestamp, a stale/cross-version
 * authorization, or a recipient list that is empty, has a blank role/
 * name, or a duplicate role.
 */
export function buildManualContractSendRecordArgs(args: {
  opportunityId: string;
  agreementAt: string;
  version: ContractVersionIdentity;
  requestAt: string;
  /** GHL's own displayed expiration for this document, when one exists -- `null` when GHL reports no explicit expiration (B9-13/INV-96 correction: never fabricated or required). */
  expirationAt: string | null;
  providerDocumentId: string;
  providerDocumentReference: string | null;
  providerDocumentRevision: number | null;
  recipients: readonly SignerSnapshot[];
  authorizedRecord: ParsedBradContractAuthorization | null;
  readbackLocationId: string;
  operator: string | null;
  recordedAt: string;
}): { ok: true; value: ManualContractSendRecordArgs } | { ok: false; reasons: ManualSendBuildReason[] } {
  const reasons: ManualSendBuildReason[] = [];

  if (args.opportunityId.trim() === "") reasons.push({ code: "OPPORTUNITY_ID_BLANK", message: "opportunityId is blank." });
  if (args.agreementAt !== args.version.agreementAt) {
    reasons.push({ code: "AGREEMENT_VERSION_MISMATCH", message: "The declared Agreement Reached identity does not match this contract version's own agreementAt." });
  }
  if (!isCanonicalIsoTimestamp(args.requestAt)) reasons.push({ code: "REQUEST_AT_INVALID", message: "requestAt (when the send actually happened in GHL) is not a valid canonical ISO instant." });
  if (!isCanonicalIsoTimestamp(args.recordedAt)) reasons.push({ code: "REQUEST_AT_INVALID", message: "recordedAt is not a valid canonical ISO instant." });
  if (args.expirationAt !== null && !isCanonicalIsoTimestamp(args.expirationAt)) {
    reasons.push({ code: "EXPIRATION_AT_INVALID", message: "expirationAt, when supplied, is not a valid canonical ISO instant." });
  }
  if (args.providerDocumentId.trim() === "") reasons.push({ code: "PROVIDER_DOCUMENT_ID_BLANK", message: "providerDocumentId is blank -- read the document id GHL shows for the sent document." });
  if (args.readbackLocationId.trim() === "") reasons.push({ code: "LOCATION_ID_BLANK", message: "readbackLocationId is blank." });

  if (args.recipients.length === 0) {
    reasons.push({ code: "RECIPIENTS_EMPTY", message: "No recipients were supplied -- there is nothing to record as sent." });
  } else {
    for (const r of args.recipients) {
      if (r.role.trim() === "") reasons.push({ code: "RECIPIENT_BLANK_ROLE", message: "A recipient has a blank role." });
      if (r.displayName.trim() === "") reasons.push({ code: "RECIPIENT_BLANK_NAME", message: `Recipient role "${r.role}" has a blank display name.` });
    }
    const roles = args.recipients.map((r) => r.role);
    if (new Set(roles).size !== roles.length) {
      reasons.push({ code: "DUPLICATE_RECIPIENT_ROLE", message: "The recipient list contains a duplicate role -- an ambiguous identity." });
    }
  }

  if (args.authorizedRecord === null) {
    reasons.push({ code: "AUTHORIZATION_MISSING", message: "No current Brad Contract Authorization record exists -- a send can never be recorded before the artifact it names has been authorized." });
  } else {
    if (!isSameContractVersion(args.authorizedRecord.version, args.version)) {
      reasons.push({ code: "AUTHORIZATION_VERSION_MISMATCH", message: "The current authorization's contract version does not match the version this send is being recorded for -- a stale or cross-version authorization is never reused." });
    }
    if (!isValidSha256(args.authorizedRecord.artifactSha256)) {
      reasons.push({ code: "AUTHORIZATION_HASH_INVALID", message: "The current authorization's artifactSha256 is not a well-formed SHA-256 hex digest." });
    }
  }

  if (reasons.length > 0) return { ok: false, reasons };

  const authorizedRecord = args.authorizedRecord as ParsedBradContractAuthorization;

  return {
    ok: true,
    value: {
      opportunityId: args.opportunityId,
      at: args.recordedAt,
      operator: args.operator,
      attemptId: args.requestAt,
      status: "accepted",
      version: args.version,
      templateName: MANUAL_SEND_NO_GHL_TEMPLATE,
      templateSource: MANUAL_SEND_TEMPLATE_SOURCE,
      requestedTemplateId: MANUAL_SEND_NO_GHL_TEMPLATE,
      authorizedAt: authorizedRecord.at,
      authorizedArtifactSha256: authorizedRecord.artifactSha256,
      signers: args.recipients.map((r) => ({ role: r.role, displayName: r.displayName })),
      confirmedRecipientId: null,
      expirationAt: args.expirationAt,
      requestAt: args.requestAt,
      iaosObservedAcceptanceAt: null,
      providerResponse: {
        documentId: args.providerDocumentId,
        documentReference: args.providerDocumentReference,
        documentRevision: args.providerDocumentRevision,
        recipientId: null,
        createdBy: null,
        readbackStatus: null,
        readbackLocationId: args.readbackLocationId,
        fillableFieldCount: null,
      },
      failureReason: null,
    },
  };
}
