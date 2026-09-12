/**
 * Contract Sent -- eligibility, evidence-building, and provider-response
 * classification. B9-08 / INV-63.
 *
 * Pure. No I/O, no React, no writes, no fetch. Consumes
 * `contract-authorization-model.ts`'s `evaluateBradAuthorizationCurrency`
 * (B9-07), `contract-document-model.ts`'s `ContractDocumentPreview` (B9-06),
 * `contract-facts-model.ts`'s `SellerContractFactsReport` (B9-05), and
 * `board9-contract-model.ts`'s `ContractVersionIdentity`/
 * `evaluateContractSentEligibility` (B9-03) directly -- REUSED, never
 * reimplemented.
 *
 * SEND ELIGIBILITY REUSES AUTHORIZATION CURRENCY, NEVER RE-DERIVES IT.
 * Item 5's own locked requirement ("preview complete / exact template /
 * exact revision and content authorized / signer+delivery present /
 * authorization not revoked") is, apart from the idempotency guard, EXACTLY
 * `evaluateBradAuthorizationCurrency`'s own contract -- `previewComplete`,
 * `TEMPLATE_CHANGED`, `REVISION_CHANGED`, and `CONTENT_CHANGED` are already
 * independently checked there, and `CONTENT_CHANGED` already subsumes a
 * changed signer or changed delivery detail (both are ordinary
 * `ContractDocumentLine`s in the same content snapshot). This module adds
 * exactly two things authorization currency does not already cover: an
 * explicit, separately-named signer/delivery-presence check (defense in
 * depth -- it can never actually fire once authorization is current, since
 * currency already requires `previewComplete`, exactly like B9-07's own
 * `TEMPLATE_CHANGED` cannot currently fire against fixed template
 * constants) and the idempotency/concurrency guard against an existing
 * send record for the exact same revision.
 *
 * IDEMPOTENCY IS VERSION-SCOPED, NOT OPPORTUNITY-SCOPED. An `accepted` or
 * `in_progress` send for THIS exact `ContractVersionIdentity` blocks a new
 * attempt (`ALREADY_SENT` / `SEND_IN_PROGRESS`); a `failed` or `ambiguous`
 * prior attempt for the same revision does not block a retry -- fail once,
 * retry the same authorized document, is the intended failure-recovery
 * path. A DIFFERENT (later, corrected) revision is never blocked by an
 * older revision's send record, by construction (each check is exact-
 * version-scoped) -- resend-after-correction is INV-64's own tracking
 * surface, not built here, but this module's version-scoping does not
 * accidentally foreclose it either.
 *
 * PROVIDER RESPONSE CLASSIFICATION IS CONSERVATIVE, AND IS NOW TWO
 * INDEPENDENT STAGES (correction round, 2026-09-11 -- item 5: "a
 * successful POST response is not sufficient"). Stage 1
 * (`classifyProviderSendResponse`) reads only the POST response, and its
 * best possible outcome is `"provider_accepted_pending_readback"` --
 * NEVER `"accepted"` directly, no matter how clean the POST response
 * looks. Stage 2 (`classifyDocumentReadback`) performs an independent
 * `GET /proposals/document` (List Documents) call and is the ONLY path
 * that can ever produce `"accepted"` -- it re-derives the document from
 * the provider's own list, cross-checks the confirmed recipient, the
 * confirmed sender (`links[].createdBy`), the environment (`locationId`),
 * and -- the specific, concrete gap this correction round exists for --
 * whether the document actually carries any `fillableFields[]` at all.
 * Per `docs/BOARD9_CONTRACT_INVENTORY_V1.md` item 8's own findings
 * (BLOCKED, not UNSUPPORTED, on several response-shape sub-points), both
 * stages treat anything short of their own affirmative criteria as
 * `"ambiguous"`, never `"accepted"` -- a network/HTTP failure is
 * `"failed"`, distinctly. Per Jess Gate correction already recorded in
 * that same document (2026-09-09, "provider-side event timestamps...
 * withdrawn"), this module NEVER claims IAOS's own request-observed
 * timestamp is the provider's own reported transmission time --
 * `iaosObservedAcceptanceAt` on the persisted record is named and
 * documented as exactly what it is: the instant IAOS observed the FINAL
 * (readback-confirmed) acceptance, not a provider-reported "sent at"
 * fact (which the documented API does not expose).
 *
 * CONTRACT SENT ITSELF IS B9-03's OWN THREE-FACT MODEL, UNCHANGED.
 * `docs/SELLER_CONTRACT_STATE_MACHINE_V1.md`'s locked Contract Sent entry
 * evidence (Brad authorization + confirmed provider transmission
 * identifier/timestamp + an explicit expiration) is NOT re-decided or
 * narrowed here -- `buildContractSentEvidence` below is purely an ADAPTER
 * that maps this module's own real facts onto `board9-contract-model.ts`'s
 * already-built, already-tested `ContractSentEvidence`/
 * `evaluateContractSentEligibility`, so "is Contract Sent true" is
 * answered by that one existing function, never a second implementation.
 * `expirationAt` is captured as IAOS's OWN durable fact (the documented
 * Send Template request body has no expiry parameter, per the same
 * inventory item), exactly as `contractReady`/`bradSendAuthorization`
 * are already IAOS-side facts in that same locked model.
 */

import {
  type ContractVersionIdentity,
  type ContractSentEvidence,
  type TransitionReason,
  isSameContractVersion,
} from "./board9-contract-model";
import { type ContractDocumentPreview } from "./contract-document-model";
import {
  type SellerContractFactsReport,
} from "./contract-facts-model";
import {
  evaluateBradAuthorizationCurrency,
  type BradAuthorizationReason,
} from "./contract-authorization-model";
import type { ParsedBradContractAuthorization } from "./contract-authorization-carriers";
import type {
  ParsedContractSend,
  SignerSnapshot,
  ProviderResponseSummary,
  ContractSendStatus,
} from "./contract-send-carriers";
import { POPULATION_VERIFIED } from "../../shared/ghl-config";

/* ==================================================================== */
/* 1. Send eligibility -- gate on ATTEMPTING a new send                  */
/* ==================================================================== */

export type ContractSendReasonCode =
  | BradAuthorizationReason["code"]
  | "MISSING_SIGNER_OR_DELIVERY_INFO"
  | "ALREADY_SENT"
  | "SEND_IN_PROGRESS"
  | "READBACK_VERIFICATION_INCOMPLETE"
  | "TEMPLATE_POPULATION_NOT_VERIFIED";

export type ContractSendReason = { code: ContractSendReasonCode; message: string };

export type SendEligibility = { eligible: true } | { eligible: false; reasons: ContractSendReason[] };

export type EvaluateSendEligibilityArgs = {
  authRecord: ParsedBradContractAuthorization | null;
  preview: ContractDocumentPreview;
  /** The latest known send record for this SAME opportunity (carrier-scoped, never another opportunity's) -- `null` when none exists. */
  existingSend: ParsedContractSend | null;
  /**
   * The non-secret `documentsContracts.populationVerification` status
   * string, as projected to the browser (ghl-config.ts's RUNTIME_GROUPS)
   * -- the caller reads it via `getRuntimeConfig()`; this function stays
   * pure and never reads it itself. Compared against `POPULATION_VERIFIED`
   * (ghl-config.ts). INFORMATIONAL ONLY -- `ghl-proxy.ts`'s GATE 2 is the
   * authoritative, server-side enforcement of this same fact and cannot
   * be bypassed by anything this function decides.
   */
  populationVerification: string;
};

export function evaluateSendEligibility(args: EvaluateSendEligibilityArgs): SendEligibility {
  const authStatus = evaluateBradAuthorizationCurrency(args.authRecord, args.preview);
  if (!authStatus.authorized) {
    return { eligible: false, reasons: authStatus.reasons };
  }

  // Defense in depth -- see module header. Cannot currently fire once
  // authStatus.authorized is true (that already required previewComplete,
  // which already required every parties/noticeContact field resolved).
  const missingSignerOrDelivery = args.preview.documentLines.some(
    (l) => (l.group === "parties" || l.group === "noticeContact") && l.status === "unresolved",
  );
  if (missingSignerOrDelivery) {
    return {
      eligible: false,
      reasons: [{ code: "MISSING_SIGNER_OR_DELIVERY_INFO", message: "Required signer or delivery information is missing." }],
    };
  }

  if (args.existingSend && isSameContractVersion(args.existingSend.version, args.preview.version)) {
    if (args.existingSend.status === "accepted") {
      return {
        eligible: false,
        reasons: [{ code: "ALREADY_SENT", message: "This exact revision has already been sent and accepted -- retrying cannot create a second send." }],
      };
    }
    if (args.existingSend.status === "in_progress") {
      return {
        eligible: false,
        reasons: [{ code: "SEND_IN_PROGRESS", message: "A send attempt for this exact revision is already in progress." }],
      };
    }
    if (args.existingSend.status === "provider_accepted_pending_readback") {
      return {
        eligible: false,
        reasons: [{
          code: "READBACK_VERIFICATION_INCOMPLETE",
          message: "The provider already accepted a send for this exact revision, but IAOS's own readback verification did not complete -- a real document may already exist at GHL. Verify directly in GHL before retrying; retrying here would risk a genuine duplicate send.",
        }],
      };
    }
    // "failed" or "ambiguous" for this exact revision -- eligible to retry.
  }

  if (args.populationVerification !== POPULATION_VERIFIED) {
    return {
      eligible: false,
      reasons: [{
        code: "TEMPLATE_POPULATION_NOT_VERIFIED",
        message: "The GHL Documents & Contracts template's field population has not been verified -- sending is refused until Brad confirms the uploaded template carries real population/signature/initial/date fields (see the INV-63 correction-round report for the exact manual GHL configuration required).",
      }],
    };
  }

  return { eligible: true };
}

/* ==================================================================== */
/* 2. Building the send-attempt record -- the "in_progress" write        */
/* ==================================================================== */

export type ContractSendAttemptToPersist = {
  /** The note's own "Recorded at" -- equal to `requestAt` for this, the FIRST note of the attempt. */
  at: string;
  operator: string | null;
  opportunityId: string;
  attemptId: string;
  status: "in_progress";
  version: ContractVersionIdentity;
  templateName: string;
  templateSource: string;
  requestedTemplateId: string;
  authorizedAt: string;
  signers: SignerSnapshot[];
  /** Always `null` on the attempt note -- see contract-send-carriers.ts's module header on `confirmedRecipientId`. */
  confirmedRecipientId: null;
  expirationAt: string;
  requestAt: string;
  iaosObservedAcceptanceAt: null;
  providerResponse: null;
  failureReason: null;
};

export type BuildSendAttemptArgs = {
  opportunityId: string;
  operator: string | null;
  /** Also serves as the attempt's own correlation id (`attemptId`) and this note's own "Recorded at". */
  requestAt: string;
  report: SellerContractFactsReport;
  preview: ContractDocumentPreview;
  authRecord: ParsedBradContractAuthorization | null;
  existingSend: ParsedContractSend | null;
  /**
   * The verified, config-locked GHL templateId this attempt requests --
   * item 2 of the INV-63 correction round: resolved from
   * `documentsContracts.templateId` (ghl-config.ts), never by a live
   * name search. Persisted verbatim so the durable record names exactly
   * what was requested; `ghl-proxy.ts`'s GATE 2 enforces this same value
   * server-side regardless of what any caller supplies.
   */
  requestedTemplateId: string;
  /** IAOS's own explicit expiration fact -- SELLER_CONTRACT_STATE_MACHINE_V1.md's third locked Contract Sent fact. Not read from any provider response (undocumented there). */
  expirationAt: string;
  /** See EvaluateSendEligibilityArgs -- passed through verbatim. */
  populationVerification: string;
};

/**
 * Extracts the exact signer identities/roles from the authoritative
 * report -- never from the preview's own rendered/joined text. A
 * `displayName` of `null` (structurally permitted by `SignerRequirement`,
 * board9-contract-model.ts) fails closed rather than producing a
 * malformed snapshot -- this is defense in depth, not a case expected to
 * occur once a signer record has been resolved through the operator's
 * own capture form (which requires a real name to save).
 */
function extractSignerSnapshots(report: SellerContractFactsReport): SignerSnapshot[] | null {
  const d = report.parties.sellerSigners;
  if (d.kind !== "populated") return null;
  const snapshots: SignerSnapshot[] = [];
  for (const s of d.value) {
    if (s.displayName === null || s.displayName === "") return null;
    snapshots.push({ role: s.role, displayName: s.displayName });
  }
  return snapshots;
}

export function buildSendAttemptArgs(
  args: BuildSendAttemptArgs,
): { ok: true; value: ContractSendAttemptToPersist } | { ok: false; reasons: ContractSendReason[] } {
  const eligibility = evaluateSendEligibility({
    authRecord: args.authRecord,
    preview: args.preview,
    existingSend: args.existingSend,
    populationVerification: args.populationVerification,
  });
  if (!eligibility.eligible) return { ok: false, reasons: eligibility.reasons };

  const signers = extractSignerSnapshots(args.report);
  if (!signers || signers.length === 0) {
    return {
      ok: false,
      reasons: [{ code: "MISSING_SIGNER_OR_DELIVERY_INFO", message: "No seller signer identities are recorded." }],
    };
  }

  // args.authRecord is guaranteed non-null here -- evaluateSendEligibility
  // only returns eligible:true when evaluateBradAuthorizationCurrency
  // returned authorized:true, which itself requires a real record.
  const authRecord = args.authRecord as ParsedBradContractAuthorization;

  return {
    ok: true,
    value: {
      at: args.requestAt,
      operator: args.operator,
      opportunityId: args.opportunityId,
      attemptId: args.requestAt,
      status: "in_progress",
      version: args.preview.version,
      templateName: args.preview.templateName,
      templateSource: args.preview.templateSource,
      requestedTemplateId: args.requestedTemplateId,
      authorizedAt: authRecord.at,
      signers,
      confirmedRecipientId: null,
      expirationAt: args.expirationAt,
      requestAt: args.requestAt,
      iaosObservedAcceptanceAt: null,
      providerResponse: null,
      failureReason: null,
    },
  };
}

/* ==================================================================== */
/* 3. Classifying the provider's response -- conservative, never assumed */
/* ==================================================================== */

export type ProviderResponseClassification = {
  /** Stage 1 can only ever yield "provider_accepted_pending_readback" | "failed" | "ambiguous" -- never "accepted". Typed as the full ContractSendStatus only so it composes with the carrier's own type; buildSendResultArgs asserts the narrower set. */
  status: ContractSendStatus;
  summary: ProviderResponseSummary | null;
  failureReason: string | null;
};

/**
 * `outcome.kind === "network_error"` covers both a transport failure and an
 * authentication failure (both surface identically to this pure function --
 * a raw response never arrived) -- classified "failed", never "ambiguous",
 * since a request that never reached the provider is unambiguously not
 * accepted. `outcome.kind === "http_response"` covers any response that DID
 * arrive, success or not.
 *
 * STAGE 1 OF 2 (correction round, 2026-09-11). This function reads ONLY
 * the POST response and can never itself return `"accepted"` -- its best
 * outcome is `"provider_accepted_pending_readback"`, which still
 * requires `classifyDocumentReadback` below to confirm before Contract
 * Sent can ever be recorded. See the module header, item 5.
 */
export type ProviderSendOutcome =
  | { kind: "network_error"; message: string }
  | { kind: "http_response"; status: number; body: unknown };

export function classifyProviderSendResponse(outcome: ProviderSendOutcome): ProviderResponseClassification {
  if (outcome.kind === "network_error") {
    return { status: "failed", summary: null, failureReason: outcome.message };
  }
  if (outcome.status < 200 || outcome.status >= 300) {
    return { status: "failed", summary: null, failureReason: `Provider returned HTTP ${outcome.status}` };
  }
  const body = outcome.body;
  if (typeof body !== "object" || body === null) {
    return { status: "ambiguous", summary: null, failureReason: "Provider response was not a JSON object." };
  }
  const b = body as Record<string, unknown>;
  if (b.success !== true) {
    return { status: "ambiguous", summary: null, failureReason: "Provider response did not report success: true." };
  }
  const links = b.links;
  if (!Array.isArray(links) || links.length === 0) {
    return { status: "ambiguous", summary: null, failureReason: "Provider response reported success but carried no links[]." };
  }
  const first = links[0];
  if (typeof first !== "object" || first === null) {
    return { status: "ambiguous", summary: null, failureReason: "Provider response's links[0] was not an object." };
  }
  const l = first as Record<string, unknown>;
  const documentId = typeof l.documentId === "string" && l.documentId !== "" ? l.documentId : null;
  if (!documentId) {
    return { status: "ambiguous", summary: null, failureReason: "Provider response carried no documentId -- missing provider identifier." };
  }
  const summary: ProviderResponseSummary = {
    documentId,
    documentReference: typeof l.referenceId === "string" ? l.referenceId : null,
    documentRevision: typeof l.documentRevision === "number" ? l.documentRevision : null,
    recipientId: typeof l.recipientId === "string" ? l.recipientId : null,
    createdBy: typeof l.createdBy === "string" ? l.createdBy : null,
    readbackStatus: null,
    readbackLocationId: null,
    fillableFieldCount: null,
  };
  return { status: "provider_accepted_pending_readback", summary, failureReason: null };
}

export type BuildSendResultArgs = {
  attempt: ContractSendAttemptToPersist;
  operator: string | null;
  observedAt: string;
  classification: ProviderResponseClassification;
};

export type ContractSendResultToPersist = {
  /** The note's own "Recorded at" -- equal to `observedAt`, the moment THIS resolution note is written (later than the attempt's own `at`). */
  at: string;
  operator: string | null;
  opportunityId: string;
  attemptId: string;
  /** "accepted" is reachable ONLY via buildReadbackResultArgs -- buildSendResultArgs never produces it. */
  status: "provider_accepted_pending_readback" | "accepted" | "failed" | "ambiguous";
  version: ContractVersionIdentity;
  templateName: string;
  templateSource: string;
  requestedTemplateId: string;
  authorizedAt: string;
  signers: SignerSnapshot[];
  confirmedRecipientId: string | null;
  expirationAt: string;
  requestAt: string;
  /** Non-null ONLY when status is "accepted" (set exclusively by buildReadbackResultArgs). */
  iaosObservedAcceptanceAt: string | null;
  providerResponse: ProviderResponseSummary | null;
  failureReason: string | null;
};

/** Builds the SECOND note's args (the POST-response resolution) for the SAME attemptId as the first. Never re-validates eligibility -- the attempt already happened; this only records the POST outcome, which is never itself "accepted" -- see classifyProviderSendResponse. */
export function buildSendResultArgs(args: BuildSendResultArgs): ContractSendResultToPersist {
  const status: "provider_accepted_pending_readback" | "failed" | "ambiguous" =
    args.classification.status === "provider_accepted_pending_readback"
      ? "provider_accepted_pending_readback"
      : args.classification.status === "failed"
        ? "failed"
        : "ambiguous";
  return {
    at: args.observedAt,
    operator: args.operator,
    opportunityId: args.attempt.opportunityId,
    attemptId: args.attempt.attemptId,
    status,
    version: args.attempt.version,
    templateName: args.attempt.templateName,
    templateSource: args.attempt.templateSource,
    requestedTemplateId: args.attempt.requestedTemplateId,
    authorizedAt: args.attempt.authorizedAt,
    signers: args.attempt.signers,
    confirmedRecipientId: args.classification.summary?.recipientId ?? null,
    expirationAt: args.attempt.expirationAt,
    requestAt: args.attempt.requestAt,
    iaosObservedAcceptanceAt: null,
    providerResponse: args.classification.summary,
    failureReason: args.classification.failureReason,
  };
}

/* ==================================================================== */
/* 3b. Stage 2: independent provider READBACK -- the ONLY path to        */
/*     "accepted". "A successful POST response is not sufficient."      */
/* ==================================================================== */

export type DocumentReadbackOutcome =
  | { kind: "network_error"; message: string }
  | { kind: "http_response"; status: number; body: unknown };

export type ReadbackClassification = {
  status: "accepted" | "failed" | "ambiguous";
  summary: ProviderResponseSummary | null;
  failureReason: string | null;
};

/**
 * Reads GHL's own `GET /proposals/document` (List Documents) response --
 * NEVER the POST response IAOS already has -- and confirms, independently:
 * the document exists and is not deleted; its `locationId` matches the
 * expected (Test) environment; its `recipients[]` includes the expected
 * confirmed recipient; at least one of its `links[]` carries `createdBy`
 * equal to the expected sender; and -- the specific gap this correction
 * round exists to close -- it actually carries at least one REQUIRED
 * `fillableFields[]` entry. Zero fillable fields (the CURRENT, Brad-
 * confirmed state of the IAOS Test template as of 2026-09-11) is reported
 * as `"ambiguous"`, by name, never `"accepted"` -- there is no threshold
 * below which an unsignable, unpopulated document counts as sent.
 *
 * This function does not know or assume any specific field NAME or type
 * enum GHL uses for signature/initial/date fields (undocumented in the
 * public API) -- it checks only the structural, documented shape:
 * `fillableFields[].isRequired`. A template that has fields placed but
 * none marked required is also `"ambiguous"`, not `"accepted"` -- this
 * function refuses to guess that an optional field is the intended
 * signature block.
 */
export function classifyDocumentReadback(args: {
  expectedDocumentId: string;
  expectedRecipientId: string;
  expectedSenderUserId: string;
  expectedLocationId: string;
  outcome: DocumentReadbackOutcome;
}): ReadbackClassification {
  const { outcome } = args;
  if (outcome.kind === "network_error") {
    return { status: "failed", summary: null, failureReason: `Readback network error: ${outcome.message}` };
  }
  if (outcome.status < 200 || outcome.status >= 300) {
    return { status: "failed", summary: null, failureReason: `Readback returned HTTP ${outcome.status}` };
  }
  const body = outcome.body;
  if (typeof body !== "object" || body === null) {
    return { status: "ambiguous", summary: null, failureReason: "Readback response was not a JSON object." };
  }
  const documents = (body as Record<string, unknown>).documents;
  if (!Array.isArray(documents)) {
    return { status: "ambiguous", summary: null, failureReason: "Readback response carried no documents[] array." };
  }
  const match = documents.find(
    (d) => typeof d === "object" && d !== null && (d as Record<string, unknown>).documentId === args.expectedDocumentId,
  ) as Record<string, unknown> | undefined;
  if (!match) {
    return { status: "ambiguous", summary: null, failureReason: "Readback did not return the document this attempt just sent -- it cannot be confirmed." };
  }
  if (match.deleted === true) {
    return { status: "failed", summary: null, failureReason: "Readback reports the document as deleted." };
  }
  if (typeof match.locationId !== "string" || match.locationId !== args.expectedLocationId) {
    return { status: "ambiguous", summary: null, failureReason: "Readback's own locationId does not match the expected Test environment -- environment could not be confirmed exact." };
  }
  const recipients = Array.isArray(match.recipients) ? match.recipients : [];
  const recipientConfirmed = recipients.some(
    (r) => typeof r === "object" && r !== null && (r as Record<string, unknown>).id === args.expectedRecipientId,
  );
  if (!recipientConfirmed) {
    return { status: "ambiguous", summary: null, failureReason: "Readback's recipients[] does not include the expected confirmed recipient." };
  }
  const links = Array.isArray(match.links) ? match.links : [];
  const senderConfirmed = links.some(
    (l) => typeof l === "object" && l !== null && (l as Record<string, unknown>).createdBy === args.expectedSenderUserId,
  );
  if (!senderConfirmed) {
    return { status: "ambiguous", summary: null, failureReason: "Readback's links[] does not confirm the expected sender (createdBy) -- sender could not be confirmed exact." };
  }
  if (typeof match.status === "string" && match.status === "draft") {
    return { status: "ambiguous", summary: null, failureReason: "Readback reports the document is still a draft -- it was never actually dispatched." };
  }
  const fillableFields = Array.isArray(match.fillableFields) ? match.fillableFields : [];
  const fillableFieldCount = fillableFields.length;
  const hasRequiredField = fillableFields.some(
    (f) => typeof f === "object" && f !== null && (f as Record<string, unknown>).isRequired === true,
  );
  const readbackStatus = typeof match.status === "string" ? match.status : null;
  const summary: ProviderResponseSummary = {
    documentId: args.expectedDocumentId,
    documentReference: null,
    documentRevision: typeof match.documentRevision === "number" ? match.documentRevision : null,
    recipientId: args.expectedRecipientId,
    createdBy: args.expectedSenderUserId,
    readbackStatus,
    readbackLocationId: typeof match.locationId === "string" ? match.locationId : null,
    fillableFieldCount,
  };
  if (fillableFieldCount === 0) {
    return {
      status: "ambiguous",
      summary,
      failureReason:
        "Readback confirms the document but reports 0 fillable fields -- the delivered document is blank/unpopulated and carries no signature, initial, date, or value fields. This is not a signable agreement; GHL Documents & Contracts template field placement has not been completed for this template.",
    };
  }
  if (!hasRequiredField) {
    return {
      status: "ambiguous",
      summary,
      failureReason: `Readback confirms ${fillableFieldCount} fillable field(s), but none are marked required -- cannot confirm a real signature/initial/date field is present without an operator-reviewed field manifest.`,
    };
  }
  return { status: "accepted", summary, failureReason: null };
}

export type BuildReadbackResultArgs = {
  attempt: ContractSendAttemptToPersist;
  provisional: ContractSendResultToPersist;
  operator: string | null;
  observedAt: string;
  classification: ReadbackClassification;
};

/** Builds the THIRD, FINAL note's args -- the only note that can ever carry status "accepted". Never re-validates eligibility or re-derives the provisional stage's own facts; only records the readback's own verdict. */
export function buildReadbackResultArgs(args: BuildReadbackResultArgs): ContractSendResultToPersist {
  return {
    at: args.observedAt,
    operator: args.operator,
    opportunityId: args.attempt.opportunityId,
    attemptId: args.attempt.attemptId,
    status: args.classification.status,
    version: args.attempt.version,
    templateName: args.attempt.templateName,
    templateSource: args.attempt.templateSource,
    requestedTemplateId: args.attempt.requestedTemplateId,
    authorizedAt: args.attempt.authorizedAt,
    signers: args.attempt.signers,
    confirmedRecipientId: args.classification.summary?.recipientId ?? args.provisional.confirmedRecipientId,
    expirationAt: args.attempt.expirationAt,
    requestAt: args.attempt.requestAt,
    iaosObservedAcceptanceAt: args.classification.status === "accepted" ? args.observedAt : null,
    providerResponse: args.classification.summary ?? args.provisional.providerResponse,
    failureReason: args.classification.failureReason,
  };
}

/* ==================================================================== */
/* 4. Contract Sent readback -- adapts to board9-contract-model.ts's own */
/*    already-built, three-fact evaluateContractSentEligibility          */
/* ==================================================================== */

export type BuildContractSentEvidenceArgs = {
  /** From evaluateContractReady (board9-contract-model.ts), consuming the existing B9-04 checklist -- not recomputed here. */
  contractReady: boolean;
  authRecord: ParsedBradContractAuthorization | null;
  currentPreview: ContractDocumentPreview;
  send: ParsedContractSend | null;
};

/**
 * Maps this module's own real facts onto `ContractSentEvidence` verbatim.
 * `providerTransmission`/`currentDocumentRevision` are populated ONLY from
 * an `accepted` send record for the EXACT current version -- an
 * `in_progress`, `failed`, `ambiguous`, or version-mismatched send never
 * supplies a transmission fact, exactly matching
 * `evaluateContractSentEligibility`'s own "authorization alone is not
 * Contract Sent" / "TRANSMISSION_NOT_CONFIRMED" failure behavior.
 */
export function buildContractSentEvidence(args: BuildContractSentEvidenceArgs): ContractSentEvidence {
  const authStatus = evaluateBradAuthorizationCurrency(args.authRecord, args.currentPreview);
  const bradSendAuthorization =
    authStatus.authorized
      ? {
          authorizedBy: authStatus.record.authorizedBy,
          at: authStatus.record.at,
          authorizedVersion: authStatus.record.version,
          authorizedDocumentRevision: null,
        }
      : null;

  const sendIsCurrentAndAccepted =
    args.send !== null &&
    args.send.status === "accepted" &&
    isSameContractVersion(args.send.version, args.currentPreview.version);

  const providerTransmission =
    sendIsCurrentAndAccepted && args.send!.iaosObservedAcceptanceAt !== null && args.send!.providerResponse?.documentId
      ? { identifier: args.send!.providerResponse.documentId, at: args.send!.iaosObservedAcceptanceAt }
      : null;

  const currentDocumentRevision =
    sendIsCurrentAndAccepted && args.send!.providerResponse?.documentRevision != null
      ? String(args.send!.providerResponse.documentRevision)
      : null;

  const expiration = sendIsCurrentAndAccepted ? { at: args.send!.expirationAt } : null;

  return {
    contractReady: args.contractReady,
    bradSendAuthorization,
    currentVersion: args.currentPreview.version,
    currentDocumentRevision,
    providerTransmission,
    expiration,
  };
}

export type { TransitionReason };
