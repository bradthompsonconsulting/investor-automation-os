/**
 * Board #9 verified full execution -- signer-level provider verification,
 * executed-artifact retrieval/hash binding, executed-term safety, and the
 * ONE authoritative path that may ever produce Under Contract evidence.
 * B9-10 / INV-65.
 *
 * Pure. No I/O, no React, no fetch, no `ghl.notes.create()`. This module
 * performs no persistence itself -- `contract-execution-carriers.ts`
 * defines the durable note shape, and no netlify function/live-wiring
 * call site is added by this issue (see the module-level LIMITATIONS
 * section below for exactly why, and what remains unbuilt as a result).
 *
 * REUSE, NEVER REIMPLEMENTATION -- every piece below is a thin, fail-
 * closed orchestration over already-shipped Board #9 primitives:
 *   - `ContractVersionIdentity`, `isSameContractVersion`,
 *     `detectMaterialConflicts`, `validateSignerRequirements`,
 *     `evaluateUnderContractEligibility` (`board9-contract-model.ts`,
 *     B9-03/INV-58) -- `evaluateUnderContractEligibility` remains the
 *     SINGLE eligibility decision; this module builds its inputs
 *     correctly and calls it, never reimplements or bypasses its own
 *     three-fact joint requirement.
 *   - `ParsedContractSend` (`contract-send-carriers.ts`, B9-08/INV-63) --
 *     the accepted-send record IS Contract Sent's own proof; nothing here
 *     re-derives it.
 *   - `verifyAcceptedSendBinding`, `filterRecordsForVersion`,
 *     `deriveLatestProviderStatus`, `LifecycleRecord`,
 *     `ProviderObservationRecord` (`contract-lifecycle-model.ts`,
 *     B9-09/INV-64, exported for this reuse) -- the SAME binding check
 *     that already guards INV-64's own provider-observation/resend/
 *     rescission/decline builders now guards this module's artifact
 *     binding too; the SAME chronology/history reading proves GHL's
 *     completed signal is not stale, superseded, or contradicted by a
 *     later lifecycle event.
 *
 * GOVERNING SOURCES:
 *   - `docs/SELLER_CONTRACT_STATE_MACHINE_V1.md` -- Under Contract's own
 *     locked three-fact entry evidence ("no single signal alone creates
 *     Under Contract... any one or two present without the third means
 *     Under Contract has not been reached"), already implemented by
 *     `evaluateUnderContractEligibility` and NOT re-decided here.
 *   - `docs/BOARD9_CONTRACT_INVENTORY_V1.md` item 7/8/9 -- what GHL's own
 *     documented List Documents response actually exposes per recipient
 *     (`role`, `email`, `contactName`, `hasCompleted`, `signingOrder`) and
 *     what it does NOT expose (any price/property/party CONTENT field, or
 *     a documented document-download/export endpoint) -- both facts are
 *     load-bearing for the two LIMITATIONS below.
 *
 * TWO REAL, REPORTED LIMITATIONS (STOP CONDITIONS PER THIS ISSUE'S OWN
 * INSTRUCTIONS) -- neither is silently worked around:
 *
 * 1. EXECUTED-ARTIFACT RETRIEVAL HAS NO VERIFIED, DOCUMENTED GHL PATH
 * TODAY. `BOARD9_CONTRACT_INVENTORY_V1.md`'s own minimal-proof-plan
 * section states plainly: "No document-download/export endpoint was
 * named in what was fetched... would need to be identified during any
 * approved test, not designed around here." This module therefore takes
 * artifact bytes as an already-retrieved `ArtifactRetrievalOutcome` --
 * exactly the same "classify the outcome a caller's own fetch produced"
 * shape `contract-send-model.ts`/`contract-lifecycle-model.ts` already
 * use for send/readback classification -- and never invents, guesses at,
 * or wires a specific GHL download endpoint. NO NETLIFY FUNCTION
 * PERFORMING A REAL ARTIFACT DOWNLOAD IS ADDED BY THIS ISSUE. Until a
 * future, separately-authorized technical-discovery pass confirms a real
 * retrieval path, `buildVerifiedUnderContractRecord` cannot be exercised
 * against a genuine execution -- it is fully built, fully tested against
 * deterministic fixtures, and ready the moment that path exists.
 *
 * 2. GHL'S DOCUMENTED READBACK EXPOSES NO PRICE/PROPERTY/PARTY CONTENT
 * FIELD. Per the same inventory document, List Documents' own fields are
 * exhaustively: `documentId`, `_id`, `locationId`, `status`,
 * `paymentStatus`, `documentRevision`, `recipients`, `updatedAt`,
 * `grandTotal`, `type`, `name`, `deleted`, `isExpired`, `locale` -- none
 * of which carries the executed agreement's actual price, property
 * address, or party names. This module therefore does NOT, and cannot,
 * derive `executedTermsSnapshot` from any GHL field -- doing so would
 * require inventing a provider field this codebase has no evidence for,
 * which this issue's own instruction forbids outright ("Do not invent
 * PDF parsing, mappings, provider fields, or legal conclusions").
 * `buildVerifiedUnderContractRecord` instead requires the CALLER to
 * supply `executedTermsSnapshot` as a real, structured `MaterialTermSnapshot`
 * -- never a naked boolean -- sourced from IAOS's OWN already-authoritative,
 * version-scoped internal facts (`contract-facts-model.ts`/
 * `contract-document-model.ts`, B9-05/B9-06, already shipped and already
 * the source of what was actually templated into the sent document) --
 * the closest evidence "tied to the executed artifact" that a real GHL
 * readback can support today, comparing it against the Agreement Reached
 * snapshot via the EXACT SAME `detectMaterialConflicts` bright-line test
 * every other Board 9 correction check already uses. This module performs
 * the comparison itself (never trusts a pre-computed result) and fails
 * closed on any conflict via `evaluateUnderContractEligibility`'s own
 * existing `executedTermsMatchAgreement` gate.
 *
 * WHAT "BUILDING THE RECORD" DOES NOT MEAN. `buildVerifiedUnderContractRecord`
 * returns a CANDIDATE record ready to be written -- it performs no write.
 * Per this issue's own "AUTHORIZED GHL WRITE" section, "the Under Contract
 * transition IS the successfully written and read-back verified Under
 * Contract evidence record" -- that write-then-read-back step belongs to
 * a future, separately-authorized netlify function (mirroring INV-63's
 * own reserve/execute/readback split), not to this pure module.
 * `verifyReadbackMatchesWritten` is the pure equality check that future
 * call site will use; it is tested here against fixtures, but nothing in
 * this module ever calls `ghl.notes.create()` or reads real GHL notes.
 */

import { createHash } from "crypto";
import {
  type ContractVersionIdentity,
  type SignerRequirement,
  type MaterialTermSnapshot,
  type MaterialConflict,
  type PreservedDocumentEvidence,
  type ExecutionEvidence,
  type UnderContractEvidence,
  type TransitionReason,
  isSameContractVersion,
  detectMaterialConflicts,
  validateSignerRequirements,
  evaluateUnderContractEligibility,
} from "./board9-contract-model";
import { type ParsedContractSend } from "./contract-send-carriers";
import {
  type LifecycleRecord,
  type ProviderObservationRecord,
  type LifecycleReason,
  verifyAcceptedSendBinding,
  filterRecordsForVersion,
  deriveLatestProviderStatus,
  orderRecordsChronologically,
} from "./contract-lifecycle-model";

function isValidIsoInstant(at: string): boolean {
  return Number.isFinite(new Date(at).getTime());
}

/* ==================================================================== */
/* 1. Signer-level provider verification -- never recipient counts alone */
/* ==================================================================== */

/** One recipient row as GHL's own documented List Documents response actually carries it (`BOARD9_CONTRACT_INVENTORY_V1.md` item 7) -- `role`, `contactName`, `hasCompleted` are documented; `recipientId`/`completedAt` are carried through only when available, never fabricated. */
export type ProviderSignerRow = {
  role: string | null;
  contactName: string | null;
  recipientId: string | null;
  hasCompleted: boolean;
  completedAt: string | null;
};

export type VerifiedSignerMatch = {
  role: string;
  displayName: string;
  providerRecipientId: string | null;
  providerCompletedAt: string | null;
};

export type SignerVerificationReasonCode =
  | "SIGNER_REQUIREMENTS_INVALID"
  | "SIGNER_MISSING"
  | "SIGNER_ROLE_AMBIGUOUS"
  | "SIGNER_IDENTITY_NOT_ESTABLISHED"
  | "SIGNER_IDENTITY_MISMATCH"
  | "SIGNER_RECIPIENT_ID_MISMATCH"
  | "SIGNER_INCOMPLETE"
  | "SIGNER_EXTRA_UNMAPPED";

export type SignerVerificationReason = { code: SignerVerificationReasonCode; message: string };

/**
 * Matches EVERY required signer individually -- never trusts an aggregate
 * "document completed" flag as a substitute. `validateSignerRequirements`
 * (`board9-contract-model.ts`, reused verbatim) rejects an empty or
 * duplicate-role requirement list before any provider row is even
 * consulted. For each requirement: find provider rows sharing its exact
 * `role`; if more than one and the requirement's own `displayName`
 * disambiguates to exactly one by `contactName`, use that one -- otherwise
 * the role is ambiguous and this fails closed (`SIGNER_ROLE_AMBIGUOUS`),
 * never guessing. The chosen row's `contactName` must equal the
 * requirement's `displayName` exactly (`SIGNER_IDENTITY_MISMATCH`
 * otherwise -- catches an unexpected substitution) and, when the caller
 * supplies an independently-known expected recipient id for that role,
 * the row's own `recipientId` must agree (`SIGNER_RECIPIENT_ID_MISMATCH`).
 * `hasCompleted` must be exactly `true` (`SIGNER_INCOMPLETE` otherwise).
 * Finally, any provider row never consumed by a requirement match is an
 * unmapped extra signer this function cannot prove doesn't matter
 * (`SIGNER_EXTRA_UNMAPPED`) -- a document with more recipients than
 * expected required signers is never silently accepted.
 */
export function verifyRequiredSigners(args: {
  requirements: readonly SignerRequirement[];
  providerRecipients: readonly ProviderSignerRow[];
  /** Independent, already-known expected recipient id per role (e.g. from the accepted send's own confirmed recipient), keyed by role. Optional; absence is never itself a failure. */
  expectedRecipientIdByRole?: Readonly<Record<string, string>>;
}): { ok: true; matches: VerifiedSignerMatch[] } | { ok: false; reasons: SignerVerificationReason[] } {
  const reqCheck = validateSignerRequirements([...args.requirements]);
  if (!reqCheck.valid) {
    return {
      ok: false,
      reasons: [{ code: "SIGNER_REQUIREMENTS_INVALID", message: reqCheck.reasons.map((r) => r.message).join(" ") }],
    };
  }

  const matches: VerifiedSignerMatch[] = [];
  const reasons: SignerVerificationReason[] = [];
  const usedProviderIndices = new Set<number>();

  for (const req of args.requirements) {
    if (req.displayName === null || req.displayName.trim() === "") {
      reasons.push({
        code: "SIGNER_IDENTITY_NOT_ESTABLISHED",
        message: `Required signer role "${req.role}" has no established display name to verify identity against.`,
      });
      continue;
    }
    const candidates = args.providerRecipients
      .map((row, i) => ({ row, i }))
      .filter(({ row, i }) => !usedProviderIndices.has(i) && row.role === req.role);

    if (candidates.length === 0) {
      reasons.push({ code: "SIGNER_MISSING", message: `No provider recipient reported for required role "${req.role}".` });
      continue;
    }
    let chosen = candidates;
    if (candidates.length > 1) {
      const byName = candidates.filter(({ row }) => row.contactName === req.displayName);
      if (byName.length === 1) {
        chosen = byName;
      } else {
        reasons.push({
          code: "SIGNER_ROLE_AMBIGUOUS",
          message: `Multiple provider recipients report role "${req.role}" and identity could not be disambiguated.`,
        });
        continue;
      }
    }
    const { row, i } = chosen[0];
    usedProviderIndices.add(i);

    if (row.contactName === null || row.contactName !== req.displayName) {
      reasons.push({
        code: "SIGNER_IDENTITY_MISMATCH",
        message: `Provider recipient for role "${req.role}" does not match the expected signer identity "${req.displayName}".`,
      });
      continue;
    }
    const expectedRecipientId = args.expectedRecipientIdByRole?.[req.role] ?? null;
    if (expectedRecipientId !== null && row.recipientId !== null && row.recipientId !== expectedRecipientId) {
      reasons.push({
        code: "SIGNER_RECIPIENT_ID_MISMATCH",
        message: `Provider recipient identifier for role "${req.role}" does not match the expected recipient.`,
      });
      continue;
    }
    if (row.hasCompleted !== true) {
      reasons.push({
        code: "SIGNER_INCOMPLETE",
        message: `Required signer "${req.displayName}" (role "${req.role}") has not completed execution.`,
      });
      continue;
    }
    matches.push({ role: req.role, displayName: req.displayName, providerRecipientId: row.recipientId, providerCompletedAt: row.completedAt });
  }

  if (usedProviderIndices.size < args.providerRecipients.length) {
    reasons.push({
      code: "SIGNER_EXTRA_UNMAPPED",
      message: "The provider document reports more recipients than expected required signers -- the extra recipient(s) cannot be proven not to matter.",
    });
  }

  if (reasons.length > 0) return { ok: false, reasons };
  return { ok: true, matches };
}

/* ==================================================================== */
/* 2. Executed-artifact retrieval, identity binding, and hashing         */
/* ==================================================================== */

export type ArtifactRetrievalOutcome =
  | { kind: "network_error"; message: string }
  | { kind: "retrieved"; bytes: Uint8Array };

export type ArtifactReasonCode =
  | "ARTIFACT_DOCUMENT_MISMATCH"
  | "ARTIFACT_VERSION_MISMATCH"
  | "ARTIFACT_RETRIEVAL_FAILED"
  | "ARTIFACT_EMPTY";

export type ArtifactReason = { code: ArtifactReasonCode; message: string };

/** Deterministic, pure SHA-256 over exactly the bytes supplied -- Node's built-in `crypto`, no I/O, no network. */
export function computeSha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * "Never treat a URL alone, an unverified response body, or a locally
 * computed hash without confirmed GHL document identity as preservation."
 * Identity/version binding is checked BEFORE the hash is ever computed or
 * trusted: the artifact must be confirmed retrieved for the EXACT provider
 * document the accepted send was bound to (`confirmedProviderDocumentId`,
 * itself only ever produced by `verifyAcceptedSendBinding`) and the EXACT
 * contract version under verification -- a caller cannot substitute a
 * document/version pair that merely looks right.
 */
export function verifyExecutedArtifact(args: {
  outcome: ArtifactRetrievalOutcome;
  confirmedProviderDocumentId: string;
  retrievedForDocumentId: string;
  retrievedForVersion: ContractVersionIdentity;
  expectedVersion: ContractVersionIdentity;
}): { ok: true; sha256: string } | { ok: false; reasons: ArtifactReason[] } {
  const reasons: ArtifactReason[] = [];
  if (args.retrievedForDocumentId !== args.confirmedProviderDocumentId) {
    reasons.push({
      code: "ARTIFACT_DOCUMENT_MISMATCH",
      message: "The retrieved artifact's own document id does not match the accepted send's confirmed provider document.",
    });
  }
  if (!isSameContractVersion(args.retrievedForVersion, args.expectedVersion)) {
    reasons.push({
      code: "ARTIFACT_VERSION_MISMATCH",
      message: "The retrieved artifact is not confirmed bound to the exact contract version under verification.",
    });
  }
  if (reasons.length > 0) return { ok: false, reasons };

  if (args.outcome.kind === "network_error") {
    return { ok: false, reasons: [{ code: "ARTIFACT_RETRIEVAL_FAILED", message: `Artifact retrieval failed: ${args.outcome.message}` }] };
  }
  if (args.outcome.bytes.length === 0) {
    return { ok: false, reasons: [{ code: "ARTIFACT_EMPTY", message: "The retrieved artifact contained zero bytes." }] };
  }
  return { ok: true, sha256: computeSha256Hex(args.outcome.bytes) };
}

/* ==================================================================== */
/* 3. Provider completion -- reusing INV-64's own chronology, never a    */
/*    single stale/isolated observation                                  */
/* ==================================================================== */

export type ProviderCompletionReasonCode =
  | "PROVIDER_COMPLETION_EVIDENCE_TAINTED"
  | "PROVIDER_COMPLETION_NOT_LATEST"
  | "PROVIDER_COMPLETION_HISTORY_EMPTY"
  | "PROVIDER_COMPLETION_TIMESTAMP_MISSING";

export type ProviderCompletionReason = { code: ProviderCompletionReasonCode; message: string };

/**
 * "A prior executed version remains authoritative under the locked
 * correction rules until a replacement independently satisfies the
 * complete gate or Brad records the applicable authorized rescission
 * fact" -- conversely, THIS version's own lifecycle history must be
 * clean. `filterRecordsForVersion` (reused verbatim from
 * `contract-lifecycle-model.ts`) already implements the asymmetry this
 * locked rule requires: a `resend`/`rescission`/`decline` record is
 * scoped to the SAME `ContractVersionIdentity` it concerns, so any such
 * record for this exact version taints it outright
 * (`PROVIDER_COMPLETION_EVIDENCE_TAINTED`) regardless of an earlier
 * "completed" observation -- but a `correction` record is scoped to the
 * NEW version it creates (its own `newVersion`), never to the version it
 * was corrected FROM, so a later correction existing does NOT, by itself,
 * taint the version being verified here -- exactly matching the locked
 * doc's own words above. `deriveLatestProviderStatus` (reused verbatim)
 * must resolve to exactly `"completed"` -- a later `"expired"`,
 * `"voided_or_canceled"`, `"unknown"`, or any other status supersedes an
 * earlier completed one and blocks this path entirely.
 */
export function verifyProviderCompletion(args: {
  opportunityId: string;
  version: ContractVersionIdentity;
  lifecycleHistory: readonly LifecycleRecord[];
}): { ok: true; completedAt: string } | { ok: false; reasons: ProviderCompletionReason[] } {
  const scoped = filterRecordsForVersion(args.lifecycleHistory, args.version).filter((r) => r.opportunityId === args.opportunityId);

  const tainting = scoped.find((r) => r.kind !== "provider_observation");
  if (tainting) {
    return {
      ok: false,
      reasons: [{
        code: "PROVIDER_COMPLETION_EVIDENCE_TAINTED",
        message: `Lifecycle history contains a "${tainting.kind}" record for this exact contract version -- Under Contract cannot be created from stale, corrected, resent, declined, or rescinded evidence.`,
      }],
    };
  }

  const latestStatus = deriveLatestProviderStatus(scoped, args.version);
  if (latestStatus !== "completed") {
    return {
      ok: false,
      reasons: [{
        code: "PROVIDER_COMPLETION_NOT_LATEST",
        message: `The latest provider-observed status for this contract version is "${latestStatus ?? "none"}", not "completed".`,
      }],
    };
  }

  const completedObservations = scoped.filter(
    (r): r is ProviderObservationRecord => r.kind === "provider_observation" && r.status === "completed" && r.authority === "provider_reported",
  );
  if (completedObservations.length === 0) {
    return { ok: false, reasons: [{ code: "PROVIDER_COMPLETION_HISTORY_EMPTY", message: "No provider-reported completed observation exists for this contract version." }] };
  }
  const latestCompleted = orderRecordsChronologically(completedObservations)[completedObservations.length - 1];
  if (latestCompleted.providerReportedAt === null) {
    return { ok: false, reasons: [{ code: "PROVIDER_COMPLETION_TIMESTAMP_MISSING", message: "The completed observation carries no provider-reported completion timestamp." }] };
  }
  return { ok: true, completedAt: latestCompleted.providerReportedAt };
}

/* ==================================================================== */
/* 4. The Under Contract record -- built ONLY via joint verification     */
/* ==================================================================== */

export type UnderContractRecordEntry = {
  kind: "under_contract";
  opportunityId: string;
  agreementAt: string;
  version: ContractVersionIdentity;
  acceptedSendAttemptId: string;
  providerDocumentId: string;
  providerDocumentReference: string | null;
  providerDocumentRevision: number | null;
  providerReportedCompletionAt: string;
  signers: VerifiedSignerMatch[];
  artifactSha256: string;
  /** Always `0` -- a record is only ever built once `evaluateUnderContractEligibility` has already confirmed no conflict exists; carried explicitly so a reader never has to trust that claim without a corroborating field. */
  executedTermsConflictCount: 0;
  iaosVerifiedAt: string;
  /** Reuses `board9-contract-model.ts`'s own `ContractFactAuthority` vocabulary -- `"system_derived"` names exactly what this fact is: IAOS's own joint verification of multiple independently-sourced facts, never a bare provider report or a bare human attestation. */
  authority: "system_derived";
  evidenceSummary: string;
  relatedPriorRecordId: string | null;
};

export type VerificationStage = "input" | "binding" | "signers" | "provider_completion" | "artifact" | "eligibility";

export type VerifiedExecutionFailure = {
  stage: VerificationStage;
  reasons: readonly (
    | { code: string; message: string }
  )[];
};

export type InputReasonCode = "OPPORTUNITY_ID_BLANK" | "VERIFIED_AT_INVALID" | "EVIDENCE_SUMMARY_BLANK" | "AGREEMENT_VERSION_MISMATCH";

export type BuildVerifiedExecutionArgs = {
  opportunityId: string;
  agreementAt: string;
  version: ContractVersionIdentity;
  acceptedSend: ParsedContractSend;
  requirements: readonly SignerRequirement[];
  providerRecipients: readonly ProviderSignerRow[];
  expectedRecipientIdByRole?: Readonly<Record<string, string>>;
  lifecycleHistory: readonly LifecycleRecord[];
  artifactOutcome: ArtifactRetrievalOutcome;
  retrievedForDocumentId: string;
  retrievedForVersion: ContractVersionIdentity;
  /** The authoritative Agreement Reached snapshot (price/property/parties), never recomputed here. */
  agreementTermsSnapshot: MaterialTermSnapshot;
  /**
   * IAOS's OWN current, version-scoped authoritative record of what was
   * actually templated into the sent document -- NEVER a GHL-provided
   * field (none exists; see LIMITATION 2 above) and NEVER a caller's bare
   * boolean claim. This module performs the comparison itself via
   * `detectMaterialConflicts`; it never trusts a pre-computed result.
   */
  executedTermsSnapshot: MaterialTermSnapshot;
  iaosVerifiedAt: string;
  evidenceSummary: string;
  relatedPriorRecordId: string | null;
};

function fail(stage: VerificationStage, reasons: readonly { code: string; message: string }[]): { ok: false; failure: VerifiedExecutionFailure } {
  return { ok: false, failure: { stage, reasons } };
}

/**
 * THE ONE authoritative path that may ever produce Under Contract
 * evidence. Every stage below is REQUIRED and INDEPENDENTLY verified,
 * matching this issue's own "All must be true" list exactly:
 *
 *   1. Contract Sent -- `verifyAcceptedSendBinding` requires an actually-
 *      accepted `ParsedContractSend`.
 *   2. Provider document bound to opportunity/agreement/version/document/
 *      revision -- the SAME binding check, cross-checked again for the
 *      retrieved artifact in `verifyExecutedArtifact`.
 *   3. Every required signer matched individually -- `verifyRequiredSigners`.
 *   4. GHL independently reports completed -- `verifyProviderCompletion`,
 *      reusing INV-64's own chronology (never a stale/tainted signal).
 *   5-6. Executed artifact retrieved and hashed -- `verifyExecutedArtifact`
 *      / `computeSha256Hex`.
 *   7. Durable preservation shape assembled as `PreservedDocumentEvidence`
 *      (board9-contract-model.ts's own type, reused verbatim).
 *   8. Executed material terms compared against the Agreement Reached
 *      snapshot via `detectMaterialConflicts` (reused verbatim).
 *   9-10. Append-only write and readback equality are NOT this function's
 *      job -- see the module header's "WHAT BUILDING THE RECORD DOES NOT
 *      MEAN." This function returns the verified CANDIDATE record.
 *
 * `evaluateUnderContractEligibility` (board9-contract-model.ts, reused
 * verbatim) is the actual, final, single eligibility decision -- every
 * stage above exists to build ITS inputs correctly, never to duplicate or
 * bypass its own joint three-fact requirement.
 */
export function buildVerifiedUnderContractRecord(
  args: BuildVerifiedExecutionArgs,
): { ok: true; value: UnderContractRecordEntry } | { ok: false; failure: VerifiedExecutionFailure } {
  const inputReasons: { code: InputReasonCode; message: string }[] = [];
  if (args.opportunityId.trim() === "") inputReasons.push({ code: "OPPORTUNITY_ID_BLANK", message: "opportunityId is blank." });
  if (!isValidIsoInstant(args.iaosVerifiedAt)) inputReasons.push({ code: "VERIFIED_AT_INVALID", message: "iaosVerifiedAt is not a valid instant." });
  if (args.evidenceSummary.trim() === "") inputReasons.push({ code: "EVIDENCE_SUMMARY_BLANK", message: "evidenceSummary is required." });
  if (args.agreementAt !== args.version.agreementAt) {
    inputReasons.push({ code: "AGREEMENT_VERSION_MISMATCH", message: "The declared Agreement Reached identity does not match this contract version's own agreementAt." });
  }
  if (inputReasons.length > 0) return fail("input", inputReasons);

  const binding = verifyAcceptedSendBinding({ acceptedSend: args.acceptedSend, opportunityId: args.opportunityId, version: args.version });
  if (!binding.ok) return fail("binding", binding.reasons);

  const signerResult = verifyRequiredSigners({
    requirements: args.requirements,
    providerRecipients: args.providerRecipients,
    expectedRecipientIdByRole: args.expectedRecipientIdByRole,
  });
  if (!signerResult.ok) return fail("signers", signerResult.reasons);

  const completion = verifyProviderCompletion({ opportunityId: args.opportunityId, version: args.version, lifecycleHistory: args.lifecycleHistory });
  if (!completion.ok) return fail("provider_completion", completion.reasons);

  const artifact = verifyExecutedArtifact({
    outcome: args.artifactOutcome,
    confirmedProviderDocumentId: binding.value.providerDocumentId,
    retrievedForDocumentId: args.retrievedForDocumentId,
    retrievedForVersion: args.retrievedForVersion,
    expectedVersion: args.version,
  });
  if (!artifact.ok) return fail("artifact", artifact.reasons);

  const conflicts: MaterialConflict[] = detectMaterialConflicts(args.agreementTermsSnapshot, args.executedTermsSnapshot);
  const executedTermsMatchAgreement = conflicts.length === 0;

  const preservedDocument: PreservedDocumentEvidence = {
    sha256: artifact.sha256,
    providerReference: binding.value.providerDocumentReference ?? binding.value.providerDocumentId,
    completionTime: completion.completedAt,
    boundVersion: args.version,
    providerDocumentRevision: binding.value.providerDocumentRevision !== null ? String(binding.value.providerDocumentRevision) : null,
  };

  const executionEvidence: ExecutionEvidence = {
    signers: signerResult.matches.map((m) => ({ role: m.role, hasCompleted: true as const })),
    providerReportedCompletionAt: completion.completedAt,
    preservedDocument,
  };

  const underContractEvidence: UnderContractEvidence = {
    contractSent: true,
    requirements: [...args.requirements],
    execution: executionEvidence,
    currentVersion: args.version,
    executedTermsMatchAgreement,
  };

  const eligibility = evaluateUnderContractEligibility(underContractEvidence);
  if (!eligibility.eligible) return fail("eligibility", eligibility.reasons);

  return {
    ok: true,
    value: {
      kind: "under_contract",
      opportunityId: args.opportunityId,
      agreementAt: args.agreementAt,
      version: args.version,
      acceptedSendAttemptId: args.acceptedSend.attemptId,
      providerDocumentId: binding.value.providerDocumentId,
      providerDocumentReference: binding.value.providerDocumentReference,
      providerDocumentRevision: binding.value.providerDocumentRevision,
      providerReportedCompletionAt: completion.completedAt,
      signers: signerResult.matches,
      artifactSha256: artifact.sha256,
      executedTermsConflictCount: 0,
      iaosVerifiedAt: args.iaosVerifiedAt,
      authority: "system_derived",
      evidenceSummary: args.evidenceSummary,
      relatedPriorRecordId: args.relatedPriorRecordId,
    },
  };
}

/* ==================================================================== */
/* 5. Append-only duplicate recognition, and the write/readback proof    */
/* ==================================================================== */

/**
 * Two Under Contract records are the SAME underlying fact when every
 * evidentiary field agrees -- `iaosVerifiedAt` and `evidenceSummary` are
 * deliberately excluded, since two independently-triggered verification
 * runs of the identical underlying evidence may legitimately record at
 * different moments with different prose. Duplicate recognition NEVER
 * removes anything from the caller's own history -- see
 * `contract-execution-carriers.ts`'s own append-only reader.
 */
export function isDuplicateUnderContractRecord(a: UnderContractRecordEntry, b: UnderContractRecordEntry): boolean {
  return (
    a.opportunityId === b.opportunityId &&
    a.agreementAt === b.agreementAt &&
    isSameContractVersion(a.version, b.version) &&
    a.acceptedSendAttemptId === b.acceptedSendAttemptId &&
    a.providerDocumentId === b.providerDocumentId &&
    a.providerDocumentReference === b.providerDocumentReference &&
    a.providerDocumentRevision === b.providerDocumentRevision &&
    a.providerReportedCompletionAt === b.providerReportedCompletionAt &&
    JSON.stringify(a.signers) === JSON.stringify(b.signers) &&
    a.artifactSha256 === b.artifactSha256
  );
}

/**
 * "IAOS reads the written record back and confirms exact equality before
 * reporting success." A pure function has no I/O -- this is the equality
 * check a FUTURE write+readback call site (not built by this issue; see
 * the module header) must use: `written` is the exact record this module
 * built and asked to be persisted; `readback` is whatever that call site
 * re-parsed from GHL immediately afterward (`null` if the write or the
 * subsequent read failed, or if parsing failed). Field-for-field equality
 * is required -- not merely "a record exists."
 */
export function verifyReadbackMatchesWritten(
  written: UnderContractRecordEntry,
  readback: UnderContractRecordEntry | null,
): { ok: true } | { ok: false; reason: string } {
  if (readback === null) {
    return { ok: false, reason: "No Under Contract record was read back after the write -- the write, the read, or the read's own parse failed." };
  }
  if (JSON.stringify(written) !== JSON.stringify(readback)) {
    return { ok: false, reason: "The read-back Under Contract record does not exactly equal the record that was written." };
  }
  return { ok: true };
}

export type { TransitionReason, LifecycleReason };
