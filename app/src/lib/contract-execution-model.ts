/**
 * Board #9 verified full execution -- signer-level provider verification,
 * manual executed-artifact bridge/hash binding, executed-term safety, and
 * the ONE authoritative path that may ever produce Under Contract
 * evidence. B9-10 / INV-65. Jess Gate repair round, 2026-09-13 (approved
 * V1 boundary, following two rounds of GHL Test discovery).
 *
 * Pure. No I/O, no React, no fetch, no `ghl.notes.create()`. This module
 * performs no persistence itself -- `contract-execution-carriers.ts`
 * defines the durable note shape, and no netlify function/live-wiring
 * call site is added by this issue.
 *
 * REUSE, NEVER REIMPLEMENTATION -- every piece below is a thin, fail-
 * closed orchestration over already-shipped Board #9 primitives:
 *   - `ContractVersionIdentity`, `isSameContractVersion`,
 *     `detectMaterialConflicts`, `evaluateUnderContractEligibility`
 *     (`board9-contract-model.ts`, B9-03/INV-58) -- the single eligibility
 *     decision, never reimplemented or bypassed.
 *   - `ParsedContractSend` (`contract-send-carriers.ts`, B9-08/INV-63) --
 *     the accepted-send record IS Contract Sent's own proof.
 *   - `verifyAcceptedSendBinding`, `filterRecordsForVersion`,
 *     `deriveLatestProviderStatus`, `LifecycleRecord`,
 *     `ProviderObservationRecord` (`contract-lifecycle-model.ts`,
 *     B9-09/INV-64, exported for this reuse).
 *
 * GOVERNING SOURCES, INCLUDING TWO ROUNDS OF LIVE, AUTHORIZED GHL TEST
 * DISCOVERY (2026-09-13):
 *   - `docs/SELLER_CONTRACT_STATE_MACHINE_V1.md` -- Under Contract's own
 *     locked three-fact entry evidence, already implemented by
 *     `evaluateUnderContractEligibility` and not re-decided here.
 *   - `docs/BOARD9_CONTRACT_INVENTORY_V1.md` item 7/8/9 -- the documentation-
 *     only pass.
 *   - LIVE, read-only GET calls against the real Test location
 *     (`SoTgVoaFGHtBdRFvXWQV`), authorized by Brad, 2026-09-13, after he
 *     granted the `documents_contracts/list.readonly` and
 *     `documents_contracts_template/list.readonly` scopes: `GET
 *     /proposals/document` confirmed a genuinely completed Test document
 *     whose `recipients[]` carries `id`, `hasCompleted`, and a REAL,
 *     POPULATED `signedDate` per recipient (previously unconfirmed) --
 *     but whose `role` field is the LITERAL, GENERIC STRING `"signer"`
 *     for every recipient, never a contract-specific role like "Seller"
 *     or "Buyer". No `templateId` field exists anywhere on a completed
 *     document. No file URL, download link, or artifact bytes exist in
 *     either the List Documents or (attempted, 401-blocked) single-
 *     document response. `fillableFields[].value` is real when present,
 *     but the one live example observed was a `"Signature"`-type field
 *     (a signature-stroke image), not `TextField` merge content -- and no
 *     document generated from the actual TREC 20-19 template exists yet
 *     to observe at all.
 *
 * THREE LOCKED V1 BOUNDARIES THIS REPAIR ROUND ESTABLISHES, EACH REPLACING
 * WHAT THE PRE-REPAIR VERSION OF THIS FILE GUESSED AT:
 *
 * 1. EXECUTED-ARTIFACT RETRIEVAL IS A MANUAL, BRAD-DRIVEN BRIDGE, NEVER AN
 * AUTOMATED GHL DOWNLOAD. Confirmed live and by GHL's own official
 * changelog (`ideas.gohighlevel.com/changelog/documents-contracts-public-
 * apis`): the ENTIRE public Documents & Contracts API surface is exactly
 * List Documents / Send Document / List Templates / Send Template -- no
 * download endpoint exists, confirmed, not merely unreachable by this
 * codebase's own tooling. `verifyManualArtifactSelection` below therefore
 * NEVER models a fetch outcome -- it models Brad manually downloading the
 * completed PDF from GHL's own UI, then explicitly selecting that exact
 * local file through an IAOS file input, with the browser reading the
 * bytes locally. GHL's native completed document remains the sole
 * authoritative artifact; IAOS preserves only the verified reference,
 * evidence, and a SHA-256 computed from the exact selected bytes -- never
 * a second copy of the PDF itself (see that function's own header for
 * the full fail-closed matrix).
 *
 * 2. SIGNER IDENTITY IS BOUND BY PROVIDER RECIPIENT ID, NEVER GHL'S
 * GENERIC `role` FIELD. Live evidence proved `role: "signer"` for every
 * recipient on the one completed Test document observed -- a platform-
 * level label, not a contract-role signal. `verifyRequiredSigners` below
 * therefore takes an `ExpectedSignerMapping[]` (IAOS's own already-
 * established role/identity, each bound to a specific `providerRecipientId`)
 * and matches PRIMARILY by that id -- an exact, provider-assigned primary
 * key -- never by role-string comparison. GHL's own reported `role` is
 * carried through on `ProviderSignerRow` for audit only and is NEVER
 * consulted for matching.
 *
 * 3. EXECUTED-TERM VERIFICATION IS UNAVAILABLE FOR V1, EXPLICITLY, NOT
 * SILENTLY SKIPPED. The pre-repair version of this file accepted a
 * caller-supplied `executedTermsSnapshot` "as though it came from the
 * executed PDF" -- Jess's own correction: that was never proven evidence
 * tied to the executed artifact, only IAOS's own internal facts dressed
 * up as if they were. Live discovery confirmed no completed document
 * carries a `templateId`, and no document from the actual TREC 20-19
 * template exists yet to observe whether its own fields would even be
 * readable. The TREC template ALSO remains `POPULATION_NOT_VERIFIED`
 * (`ghl-config.ts`) -- sending it is refused by INV-63's own GATE 2 and
 * its dedicated reservation/execution endpoints regardless of anything in
 * this file. `buildVerifiedUnderContractRecord` therefore has NO
 * parameter through which a caller can supply executed-term evidence at
 * all -- the pipeline fails closed, unconditionally, at a distinct
 * `executed_terms` stage with `EXECUTED_TERMS_EVIDENCE_UNAVAILABLE`,
 * BEFORE `evaluateUnderContractEligibility` is ever reached. The
 * deterministic bright-line conflict logic itself
 * (`evaluateExecutedTermsConflicts`, a thin, tested, reused wrapper over
 * `detectMaterialConflicts`) is preserved and exported, unwired, so a
 * future issue that confirms a real, deterministic evidence source needs
 * only to wire that function into the pipeline in place of the
 * unconditional failure below -- this module's own conflict-detection
 * logic requires no change when that day comes.
 *
 * WHAT "BUILDING THE RECORD" DOES NOT MEAN. `buildVerifiedUnderContractRecord`
 * returns a CANDIDATE record ready to be written -- it performs no write.
 * Given boundary 3 above, IT CANNOT RETURN `ok: true` IN V1 AT ALL --
 * every call fails at the `executed_terms` stage, by design, proven by
 * this module's own test harness. `verifyReadbackMatchesWritten` is the
 * pure equality check a future write+readback call site will use once
 * boundary 3 is lifted; it is tested here against fixtures, but nothing
 * in this module ever calls `ghl.notes.create()` or reads real GHL notes.
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
/* 1. Signer-level provider verification -- provider recipient id is the */
/*    PRIMARY join; GHL's own generic "role" is audit-only, never trusted */
/* ==================================================================== */

/**
 * One recipient row exactly as the live, authorized Test readback proved
 * GHL actually returns it (2026-09-13): `id` (the provider-assigned
 * recipient identifier), `hasCompleted`, and a real, populated
 * `signedDate` are all confirmed real fields. `reportedRole` is carried
 * through for audit/display only -- confirmed live to be the generic
 * literal `"signer"` for every recipient on the one completed document
 * observed, never a contract-specific role, and NEVER consulted by
 * `verifyRequiredSigners` below.
 */
export type ProviderSignerRow = {
  providerRecipientId: string;
  hasCompleted: boolean;
  signedDate: string | null;
  reportedRole: string | null;
  reportedContactName: string | null;
};

/**
 * IAOS's OWN already-established mapping between an expected contract
 * role/identity and the specific provider recipient id GHL assigned to
 * it -- the deterministic join this repair round requires ("Use provider
 * recipient ID as the primary lifecycle join"). This module does not
 * invent, discover, or independently verify WHERE this mapping came from
 * (that remains a future wiring issue's job, per the "narrow extension,
 * not a new carrier" scope of this repair round) -- it only enforces
 * that the mapping, once supplied, is well-formed and matches the live
 * readback evidence deterministically.
 */
export type ExpectedSignerMapping = {
  role: string;
  displayName: string;
  providerRecipientId: string;
};

export type VerifiedSignerMatch = {
  role: string;
  displayName: string;
  providerRecipientId: string;
  providerCompletedAt: string | null;
};

export type SignerVerificationReasonCode =
  | "SIGNER_MAPPING_INVALID"
  | "SIGNER_RECIPIENT_NOT_FOUND"
  | "SIGNER_RECIPIENT_ID_DUPLICATED_IN_EVIDENCE"
  | "SIGNER_INCOMPLETE"
  | "SIGNER_EXTRA_UNMAPPED";

export type SignerVerificationReason = { code: SignerVerificationReasonCode; message: string };

/**
 * Matches EVERY required signer individually, by provider recipient id --
 * never by GHL's own generic `role` string, and never by trusting an
 * aggregate "document completed" flag. The expected mapping itself is
 * validated first: no blank role/displayName/providerRecipientId, no
 * duplicate role, no duplicate providerRecipientId within the mapping
 * (`SIGNER_MAPPING_INVALID` otherwise -- this is what "reject ... ambiguous
 * identity" means at the INPUT layer). The live evidence is then checked
 * for its own internal integrity: two rows sharing the same
 * `providerRecipientId` is itself malformed/ambiguous evidence, never
 * trusted (`SIGNER_RECIPIENT_ID_DUPLICATED_IN_EVIDENCE`). For each
 * mapping entry, the provider row with the MATCHING id must exist
 * (`SIGNER_RECIPIENT_NOT_FOUND` otherwise) and must report
 * `hasCompleted === true` exactly (`SIGNER_INCOMPLETE` otherwise) --
 * `signedDate` is preserved from that row when available, never
 * fabricated when absent. Finally, any provider row never claimed by a
 * mapping entry is an unmapped extra signer this function cannot prove
 * doesn't matter (`SIGNER_EXTRA_UNMAPPED`).
 */
export function verifyRequiredSigners(args: {
  mappings: readonly ExpectedSignerMapping[];
  providerRecipients: readonly ProviderSignerRow[];
}): { ok: true; matches: VerifiedSignerMatch[] } | { ok: false; reasons: SignerVerificationReason[] } {
  const inputReasons: SignerVerificationReason[] = [];
  if (args.mappings.length === 0) {
    inputReasons.push({ code: "SIGNER_MAPPING_INVALID", message: "No expected signer mapping was supplied." });
  }
  for (const m of args.mappings) {
    if (m.role.trim() === "" || m.displayName.trim() === "" || m.providerRecipientId.trim() === "") {
      inputReasons.push({ code: "SIGNER_MAPPING_INVALID", message: "The expected signer mapping contains a blank role, display name, or provider recipient id." });
    }
  }
  const roles = args.mappings.map((m) => m.role);
  if (new Set(roles).size !== roles.length) {
    inputReasons.push({ code: "SIGNER_MAPPING_INVALID", message: "The expected signer mapping contains a duplicate role." });
  }
  const mappedIds = args.mappings.map((m) => m.providerRecipientId);
  if (new Set(mappedIds).size !== mappedIds.length) {
    inputReasons.push({ code: "SIGNER_MAPPING_INVALID", message: "The expected signer mapping contains a duplicate provider recipient id -- an ambiguous identity claim." });
  }
  if (inputReasons.length > 0) return { ok: false, reasons: inputReasons };

  const evidenceIds = args.providerRecipients.map((r) => r.providerRecipientId);
  if (new Set(evidenceIds).size !== evidenceIds.length) {
    return {
      ok: false,
      reasons: [{ code: "SIGNER_RECIPIENT_ID_DUPLICATED_IN_EVIDENCE", message: "The provider evidence itself contains duplicate recipient ids -- ambiguous, never trusted." }],
    };
  }

  const matches: VerifiedSignerMatch[] = [];
  const reasons: SignerVerificationReason[] = [];
  const usedEvidenceIds = new Set<string>();

  for (const m of args.mappings) {
    const row = args.providerRecipients.find((r) => r.providerRecipientId === m.providerRecipientId);
    if (!row) {
      reasons.push({
        code: "SIGNER_RECIPIENT_NOT_FOUND",
        message: `No provider recipient with id matching the expected mapping for role "${m.role}" was found in the readback evidence.`,
      });
      continue;
    }
    usedEvidenceIds.add(row.providerRecipientId);
    if (row.hasCompleted !== true) {
      reasons.push({
        code: "SIGNER_INCOMPLETE",
        message: `Required signer "${m.displayName}" (role "${m.role}") has not completed execution.`,
      });
      continue;
    }
    matches.push({ role: m.role, displayName: m.displayName, providerRecipientId: m.providerRecipientId, providerCompletedAt: row.signedDate });
  }

  if (usedEvidenceIds.size < args.providerRecipients.length) {
    reasons.push({
      code: "SIGNER_EXTRA_UNMAPPED",
      message: "The provider document reports more recipients than the expected signer mapping accounts for -- the extra recipient(s) cannot be proven not to matter.",
    });
  }

  if (reasons.length > 0) return { ok: false, reasons };
  return { ok: true, matches };
}

/* ==================================================================== */
/* 2. The manual executed-artifact bridge -- Brad-driven, browser-local, */
/*    never an automated GHL download (none exists; see module header)  */
/* ==================================================================== */

/**
 * What a future browser-side file input observes, classified honestly --
 * NEVER a fetch/network outcome (there is no automated retrieval path).
 * `"selected"` is reached only when real, non-empty, PDF-shaped bytes
 * were actually read locally.
 */
export type ManualArtifactSelectionOutcome =
  | { kind: "no_file" }
  | { kind: "invalid_file_type"; mimeType: string | null; fileName: string | null }
  | { kind: "empty_file" }
  | { kind: "unreadable"; message: string }
  | { kind: "selected"; bytes: Uint8Array; fileName: string; mimeType: string };

export type ArtifactReasonCode =
  | "NO_FILE_SELECTED"
  | "INVALID_FILE_TYPE"
  | "FILE_EMPTY"
  | "FILE_UNREADABLE"
  | "ARTIFACT_DOCUMENT_MISMATCH"
  | "ARTIFACT_VERSION_MISMATCH";

export type ArtifactReason = { code: ArtifactReasonCode; message: string };

/** Deterministic, pure SHA-256 over exactly the bytes supplied -- Node's built-in `crypto`, no I/O, no network. */
export function computeSha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const PDF_MAGIC_BYTES = [0x25, 0x50, 0x44, 0x46, 0x2d]; // literal ASCII "%PDF-", the real PDF file-format signature

/** Content-based, not label-based -- a spoofable `mimeType`/filename string is never trusted alone; the actual leading bytes are checked, matching this codebase's own "verify the real underlying fact, not a label" discipline. */
function looksLikePdfContent(bytes: Uint8Array): boolean {
  if (bytes.length < PDF_MAGIC_BYTES.length) return false;
  return PDF_MAGIC_BYTES.every((b, i) => bytes[i] === b);
}

/**
 * Classifies a browser-read file selection HONESTLY, from its own actual
 * bytes -- this is the ONE place "non-PDF input" is decided, and it is
 * decided from the real PDF magic-byte signature, never from a caller-
 * supplied (spoofable) mime type or filename alone. Returns the outcome
 * type `verifyManualArtifactSelection` below consumes; itself performs no
 * binding/identity check (that happens after a real selection is
 * confirmed) and computes no hash (that happens only once binding also
 * passes).
 */
export function classifySelectedFile(args: {
  fileName: string | null;
  mimeType: string | null;
  bytes: Uint8Array | null;
}): ManualArtifactSelectionOutcome {
  if (args.bytes === null) return { kind: "no_file" };
  if (args.bytes.length === 0) return { kind: "empty_file" };
  if (!looksLikePdfContent(args.bytes)) {
    return { kind: "invalid_file_type", mimeType: args.mimeType, fileName: args.fileName };
  }
  return { kind: "selected", bytes: args.bytes, fileName: args.fileName ?? "selected.pdf", mimeType: args.mimeType ?? "application/pdf" };
}

/**
 * "Never treat a URL alone, an unverified response body, or a locally
 * computed hash without confirmed GHL document identity as preservation."
 * `outcome` is checked FIRST (no_file/invalid_file_type/empty_file/
 * unreadable each fail closed on their own, distinct reason) -- only once
 * real bytes are confirmed selected is document/version identity checked
 * (`selectedForDocumentId`/`selectedForVersion`, declared by the caller
 * alongside the file picker, against `confirmedProviderDocumentId` --
 * itself only ever produced by `verifyAcceptedSendBinding` -- and
 * `expectedVersion`). The hash is computed LAST, only once every prior
 * check has passed. This function's own return type never carries the
 * bytes themselves -- only `sha256`, a 64-character hex string -- so
 * nothing downstream of this call can retain, log, or persist the
 * original bytes through this function's own output; discarding the
 * caller's own in-memory byte reference once this returns is that
 * caller's responsibility (a future browser-side concern, not something
 * a pure function can perform).
 */
export function verifyManualArtifactSelection(args: {
  outcome: ManualArtifactSelectionOutcome;
  confirmedProviderDocumentId: string;
  selectedForDocumentId: string;
  selectedForVersion: ContractVersionIdentity;
  expectedVersion: ContractVersionIdentity;
}): { ok: true; sha256: string } | { ok: false; reasons: ArtifactReason[] } {
  if (args.outcome.kind === "no_file") {
    return { ok: false, reasons: [{ code: "NO_FILE_SELECTED", message: "No file was selected." }] };
  }
  if (args.outcome.kind === "invalid_file_type") {
    return {
      ok: false,
      reasons: [{ code: "INVALID_FILE_TYPE", message: `The selected file is not a real PDF (its content does not begin with the PDF file signature; declared mime type: ${args.outcome.mimeType ?? "unknown"}).` }],
    };
  }
  if (args.outcome.kind === "empty_file") {
    return { ok: false, reasons: [{ code: "FILE_EMPTY", message: "The selected file contains zero bytes." }] };
  }
  if (args.outcome.kind === "unreadable") {
    return { ok: false, reasons: [{ code: "FILE_UNREADABLE", message: `The selected file could not be read: ${args.outcome.message}` }] };
  }

  const reasons: ArtifactReason[] = [];
  if (args.selectedForDocumentId !== args.confirmedProviderDocumentId) {
    reasons.push({
      code: "ARTIFACT_DOCUMENT_MISMATCH",
      message: "The selected file's declared document identity does not match the accepted send's confirmed provider document.",
    });
  }
  if (!isSameContractVersion(args.selectedForVersion, args.expectedVersion)) {
    reasons.push({
      code: "ARTIFACT_VERSION_MISMATCH",
      message: "The selected file is not confirmed bound to the exact contract version under verification.",
    });
  }
  if (reasons.length > 0) return { ok: false, reasons };
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
/* 3b. Executed-term conflict logic -- PRESERVED and tested, but NOT     */
/*     wired into the live V1 pipeline (see module header, boundary 3)  */
/* ==================================================================== */

/**
 * A thin, reused wrapper over `detectMaterialConflicts` (board9-contract-
 * model.ts) -- this is the deterministic bright-line conflict logic this
 * repair round requires be "preserved," exported and tested on its own so
 * a future issue that confirms a real, deterministic executed-term
 * evidence source can wire this directly into the pipeline. It is NOT
 * called anywhere in `buildVerifiedUnderContractRecord` today -- see
 * `EXECUTED_TERMS_EVIDENCE_AVAILABLE` below.
 */
export function evaluateExecutedTermsConflicts(agreement: MaterialTermSnapshot, executedTerms: MaterialTermSnapshot): MaterialConflict[] {
  return detectMaterialConflicts(agreement, executedTerms);
}

/**
 * THE V1 BOUNDARY, NAMED AND FLIPPABLE IN ONE PLACE. `false` for as long
 * as: (a) the TREC template remains `POPULATION_NOT_VERIFIED`
 * (`ghl-config.ts`), and (b) no deterministic, provider-evidenced source
 * for executed price/property/party content has been confirmed (live
 * discovery, 2026-09-13: no document generated from the real template
 * exists to observe, and even the one observed completed document's
 * `fillableFields[]` carried a `Signature`-type field, not merge
 * content). This constant is deliberately NOT a parameter any caller can
 * override -- the only way to change this gate's behavior is an
 * authorized code change to this exact line, once real evidence exists.
 */
const EXECUTED_TERMS_EVIDENCE_AVAILABLE = false as const;

export type ExecutedTermsReasonCode = "EXECUTED_TERMS_EVIDENCE_UNAVAILABLE";
export type ExecutedTermsReason = { code: ExecutedTermsReasonCode; message: string };

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

export type VerificationStage = "input" | "binding" | "signers" | "provider_completion" | "artifact" | "executed_terms" | "eligibility";

export type VerifiedExecutionFailure = {
  stage: VerificationStage;
  reasons: readonly { code: string; message: string }[];
};

export type InputReasonCode = "OPPORTUNITY_ID_BLANK" | "VERIFIED_AT_INVALID" | "EVIDENCE_SUMMARY_BLANK" | "AGREEMENT_VERSION_MISMATCH";

export type BuildVerifiedExecutionArgs = {
  opportunityId: string;
  agreementAt: string;
  version: ContractVersionIdentity;
  acceptedSend: ParsedContractSend;
  /** IAOS's own established role/identity/provider-recipient-id mapping -- see `ExpectedSignerMapping`'s own doc comment. `SignerRequirement[]` (board9-contract-model.ts's own type, required by `evaluateUnderContractEligibility`) is derived from this internally; a caller no longer supplies both separately. */
  expectedSignerMappings: readonly ExpectedSignerMapping[];
  providerRecipients: readonly ProviderSignerRow[];
  lifecycleHistory: readonly LifecycleRecord[];
  manualArtifactOutcome: ManualArtifactSelectionOutcome;
  selectedForDocumentId: string;
  selectedForVersion: ContractVersionIdentity;
  iaosVerifiedAt: string;
  evidenceSummary: string;
  relatedPriorRecordId: string | null;
};

function fail(stage: VerificationStage, reasons: readonly { code: string; message: string }[]): { ok: false; failure: VerifiedExecutionFailure } {
  return { ok: false, failure: { stage, reasons } };
}

/**
 * THE ONE authoritative path that may ever produce Under Contract
 * evidence. Every stage below is REQUIRED and INDEPENDENTLY verified:
 *
 *   1. Contract Sent -- `verifyAcceptedSendBinding` requires an actually-
 *      accepted `ParsedContractSend`.
 *   2. Provider document bound to opportunity/agreement/version/document/
 *      revision -- the SAME binding check, cross-checked again for the
 *      manually selected artifact in `verifyManualArtifactSelection`.
 *   3. Every required signer matched individually, by provider recipient
 *      id -- `verifyRequiredSigners`.
 *   4. GHL independently reports completed -- `verifyProviderCompletion`,
 *      reusing INV-64's own chronology (never a stale/tainted signal).
 *   5-6. Executed artifact selected (the manual bridge) and hashed --
 *      `verifyManualArtifactSelection` / `computeSha256Hex`.
 *   7. Executed material terms -- UNAVAILABLE for V1, explicitly, at its
 *      own named stage (`executed_terms` /
 *      `EXECUTED_TERMS_EVIDENCE_UNAVAILABLE`) -- see the module header,
 *      boundary 3. This is why this function cannot return `ok: true`
 *      today; the pipeline below stage 6 is real, reused, tested code
 *      that a future issue activates, not code this issue deletes.
 *   9-10. Append-only write and readback equality are NOT this function's
 *      job -- see the module header's "WHAT BUILDING THE RECORD DOES NOT
 *      MEAN."
 *
 * `evaluateUnderContractEligibility` (board9-contract-model.ts, reused
 * verbatim) remains the actual, final, single eligibility decision for
 * whenever stage 7 above is lifted -- every earlier stage exists to build
 * ITS inputs correctly, never to duplicate or bypass its own joint
 * three-fact requirement.
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
    mappings: args.expectedSignerMappings,
    providerRecipients: args.providerRecipients,
  });
  if (!signerResult.ok) return fail("signers", signerResult.reasons);

  const completion = verifyProviderCompletion({ opportunityId: args.opportunityId, version: args.version, lifecycleHistory: args.lifecycleHistory });
  if (!completion.ok) return fail("provider_completion", completion.reasons);

  const artifact = verifyManualArtifactSelection({
    outcome: args.manualArtifactOutcome,
    confirmedProviderDocumentId: binding.value.providerDocumentId,
    selectedForDocumentId: args.selectedForDocumentId,
    selectedForVersion: args.selectedForVersion,
    expectedVersion: args.version,
  });
  if (!artifact.ok) return fail("artifact", artifact.reasons);

  // BOUNDARY 3 (module header): unconditional, explicit, never silently
  // skipped. The manual PDF bridge above proves artifact POSSESSION and
  // INTEGRITY only -- it does not, by itself, prove price/property/party
  // equality, and nothing past this point in the pipeline is reachable
  // until a future, separately-authorized issue supplies real evidence
  // and flips `EXECUTED_TERMS_EVIDENCE_AVAILABLE`.
  if (!EXECUTED_TERMS_EVIDENCE_AVAILABLE) {
    return fail("executed_terms", [{
      code: "EXECUTED_TERMS_EVIDENCE_UNAVAILABLE",
      message: "The configured TREC template remains POPULATION_NOT_VERIFIED and no deterministic, provider-evidenced source for executed price/property/party content has been confirmed -- Under Contract cannot be created without it. The manual PDF bridge proves artifact possession and integrity only.",
    }]);
  }

  // Unreachable while EXECUTED_TERMS_EVIDENCE_AVAILABLE is false -- kept
  // real, reused, and structurally correct for the moment it is lifted.
  const requirements: SignerRequirement[] = args.expectedSignerMappings.map((m) => ({ role: m.role, displayName: m.displayName, signingAuthorityNote: null }));

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
    requirements,
    execution: executionEvidence,
    currentVersion: args.version,
    executedTermsMatchAgreement: true,
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
