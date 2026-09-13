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
 * GENERIC `role` FIELD -- AND WHO MUST SIGN, PLUS THE RECIPIENT MAPPING,
 * ARE TWO SEPARATE, NEVER-DERIVED-FROM-SEND-EVIDENCE FACTS. Product
 * Owner ruling, 2026-09-13 (superseding the immediately prior repair
 * round's `deriveDeterministicSignerMappingsFromAcceptedSend`, now
 * removed from `contract-send-carriers.ts` entirely): "Brad may factually
 * map each GHL provider recipient ID to its corresponding required
 * contract signer after visually verifying that mapping in GHL. This is
 * factual evidence only. IAOS must not determine legal signing
 * authority, contractual validity, or legal consequences."
 *
 *   2a. THE REQUIRED SIGNER SET (WHO must sign) is assembled by
 *   `buildRequiredSignerSet` (`contract-signer-mapping-model.ts`) from
 *   IAOS's own already-durable authoritative contract facts -- BTC LLC's
 *   configured buyer signer plus EVERY recorded seller signer -- NEVER
 *   from the accepted send's own `signers[]` field, which describes a
 *   REQUEST made at send time, not an authoritative statement of who a
 *   contract requires as a party. `buildVerifiedUnderContractRecord`
 *   below re-validates a caller-supplied `requiredSigners` at its own
 *   `required_signers` stage (`validateRequiredSignerSet`) as defense in
 *   depth, never trusting it unchecked.
 *
 *   2b. THE RECIPIENT MAPPING (which recipient id belongs to which
 *   required signer) is Brad's own manual, one-to-one attestation
 *   (`SignerMappingAttestationRecord`, `contract-signer-mapping-carriers.
 *   ts`) -- never auto-paired by array order, GHL's generic `role`
 *   string, or a guessed name/email match. `verifySignerMappingAttestation
 *   Currency` re-checks that a previously-recorded mapping is still
 *   CURRENT for the exact opportunity/version/provider document/
 *   revision/accepted-send/required-signer-set being verified today,
 *   failing closed at the `signer_mapping` stage on any mismatch.
 *
 * Live evidence proved `role: "signer"` for every recipient on the one
 * completed Test document observed -- a platform-level label, not a
 * contract-role signal. `verifyRequiredSigners` below still matches
 * PRIMARILY by `providerRecipientId` -- an exact, provider-assigned
 * primary key -- never by role-string comparison; GHL's own reported
 * `role` is carried through on `ProviderSignerRow` for audit only and is
 * NEVER consulted for matching. It NOW ALSO requires a real, valid
 * signed timestamp for every matched, completed signer -- "provider
 * completion" alone is no longer sufficient (ruling item 3).
 * `ProviderSignerRow[]` (the LIVE per-recipient readback evidence --
 * `hasCompleted`/`signedDate`/id) is still supplied by the caller, since
 * it is genuinely per-verification-run live evidence.
 *
 * NODE `crypto` IS NEVER IMPORTED HERE (Jess Gate repair round,
 * 2026-09-13, item 1). This module is now imported by browser-facing UI
 * code (`ContractWorkspace.tsx`), so it must never pull in a Node
 * built-in. Hashing is NOT this module's job at all: `verifyManualArtifact
 * Selection` below validates identity/binding and passes a CALLER-SUPPLIED
 * `sha256` string straight through -- it never touches raw bytes or
 * computes a digest. `classifySelectedFileBytes` validates PDF-ness/
 * emptiness from raw bytes (pure array indexing, fully portable, zero
 * crypto dependency) and hands the validated bytes BACK to the caller for
 * hashing in whatever way its own environment supports. The browser path
 * hashes via `browser-artifact-hash.ts`'s own `computeManualArtifactSha256Hex`,
 * which explicitly uses `globalThis.crypto.subtle.digest` -- never a
 * Node-only API. This module's own deterministic test harness
 * independently reproduces the SAME Web Crypto call (Node has supported
 * `globalThis.crypto.subtle` natively since v19) to prove the two never
 * diverge, without needing an actual browser.
 *
 * 3. EXECUTED-TERM VERIFICATION IS BRAD'S OWN FACTUAL VISUAL ATTESTATION,
 * NEVER AN AUTO-EXTRACTED OR CALLER-ASSERTED VALUE. Product Owner ruling,
 * 2026-09-13: "For single-user IAOS V1, Brad's factual visual attestation
 * may verify that the material terms visible in the selected, hash-
 * verified executed PDF match the authoritative Agreement Reached
 * record." The pre-repair version of this file once accepted a caller-
 * supplied `executedTermsSnapshot` "as though it came from the executed
 * PDF" -- Jess's own prior correction: that was never proven evidence
 * tied to the executed artifact, only IAOS's own internal facts dressed
 * up as if they were. Live discovery confirmed GHL exposes no field-value
 * merge content anywhere in its Documents & Contracts API surface -- this
 * remains true, and this module still computes and trusts NOTHING about
 * the PDF's own content itself. What changed is narrower: Brad's own
 * plain, per-item MATCHES/DOES_NOT_MATCH/CANNOT_VERIFY comparison
 * (`contract-executed-terms-attestation-model.ts`) is now sanctioned
 * evidence, gated hard: unanimous `"MATCHES"` across property identity,
 * purchase price, buyer identity, EVERY required signing party
 * individually, and a catch-all "other material terms" item, or the
 * attestation cannot even be built
 * (`buildExecutedTermsAttestationRecordArgs`); a previously-recorded
 * attestation is re-checked for currency against THIS exact opportunity/
 * version/provider document/revision/artifact hash every time
 * (`verifyExecutedTermsAttestationCurrency`) -- stale, cross-version, or
 * cross-artifact attestations are never silently reused. IAOS still never
 * interprets contract language or judges legal validity; it only
 * compares its own already-held facts against Brad's own responses. The
 * deterministic bright-line conflict logic itself
 * (`evaluateExecutedTermsConflicts`, a thin, tested, reused wrapper over
 * `detectMaterialConflicts`) remains preserved and exported, still unwired
 * into this pipeline directly -- it is the logic a FUTURE issue with a
 * real deterministic (non-attestation) evidence source would wire in
 * instead, not something this ruling replaces.
 *
 * WHAT "BUILDING THE RECORD" DOES NOT MEAN. `buildVerifiedUnderContractRecord`
 * returns a CANDIDATE record ready to be written -- it performs no write.
 * It can now return `ok: true` ONLY when every earlier stage (binding,
 * signer mapping, signer completion, provider completion, artifact) AND
 * a current, unanimous executed-terms attestation ALL independently
 * pass -- in practice, for real live evidence, this remains unreached
 * today (no document has ever been generated from the real TREC
 * template; see `contract-execution-model.ts`'s own INV-65 test suite for
 * the exact fixture-only cases where it is reachable). `verifyReadback
 * MatchesWritten` is the pure equality check a future write+readback call
 * site will use; it is tested here against fixtures, but nothing in this
 * module ever calls `ghl.notes.create()` or reads real GHL notes.
 */

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
import {
  type ParsedContractSend,
} from "./contract-send-carriers";
import {
  type LifecycleRecord,
  type ProviderObservationRecord,
  type LifecycleReason,
  verifyAcceptedSendBinding,
  filterRecordsForVersion,
  deriveLatestProviderStatus,
  orderRecordsChronologically,
} from "./contract-lifecycle-model";
import {
  type ExecutedTermsAttestationRecord,
  verifyExecutedTermsAttestationCurrency,
} from "./contract-executed-terms-attestation-model";
import {
  type RequiredSigner,
  type SignerRecipientMapping,
  type SignerMappingAttestationRecord,
  validateRequiredSignerSet,
  verifySignerMappingAttestationCurrency,
} from "./contract-signer-mapping-model";

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

export type ProviderSignerRowExtractionResult =
  | { ok: true; rows: readonly ProviderSignerRow[] }
  | { ok: false; reason: string };

/**
 * The ONE place raw `GET /proposals/document` ("List Documents") JSON is
 * turned into `ProviderSignerRow[]` -- a thin, fail-closed field mapping
 * over exactly the shape live-confirmed above (`documents[]`, each with
 * `documentId`/`locationId`/`recipients[]`; each recipient with
 * `id`/`hasCompleted`/`signedDate`/`role`/`contactName`), never an
 * invented shape. Mirrors `classifyProviderLifecycleReadback`
 * (`contract-lifecycle-model.ts`)'s own raw-JSON extraction discipline:
 * fails closed (a reason, not a guess) on a missing document, a location
 * mismatch, a missing/malformed `recipients[]`, or a recipient with no
 * provider-assigned id -- the one field `verifyRequiredSigners` above
 * joins on and can never fabricate.
 */
export function extractProviderSignerRowsFromListDocumentsBody(args: {
  body: unknown;
  expectedDocumentId: string;
  expectedLocationId: string;
}): ProviderSignerRowExtractionResult {
  if (typeof args.body !== "object" || args.body === null) {
    return { ok: false, reason: "The List Documents response was not a JSON object." };
  }
  const documents = (args.body as Record<string, unknown>).documents;
  if (!Array.isArray(documents)) {
    return { ok: false, reason: "The List Documents response carried no documents[] array." };
  }
  const match = documents.find(
    (d) => typeof d === "object" && d !== null && (d as Record<string, unknown>).documentId === args.expectedDocumentId,
  ) as Record<string, unknown> | undefined;
  if (!match) {
    return { ok: false, reason: "The expected provider document id was not present in this List Documents page." };
  }
  if (typeof match.locationId !== "string" || match.locationId !== args.expectedLocationId) {
    return { ok: false, reason: "The matched document's locationId does not match the expected environment -- refusing to trust its recipients." };
  }
  const recipientsRaw = match.recipients;
  if (!Array.isArray(recipientsRaw)) {
    return { ok: false, reason: "The matched document carried no recipients[] array." };
  }
  const rows: ProviderSignerRow[] = [];
  for (const r of recipientsRaw) {
    if (typeof r !== "object" || r === null) {
      return { ok: false, reason: "A recipient entry was not a JSON object -- refusing to trust malformed evidence." };
    }
    const row = r as Record<string, unknown>;
    if (typeof row.id !== "string" || row.id.trim() === "") {
      return { ok: false, reason: "A recipient entry carried no provider recipient id -- refusing to trust evidence that cannot be joined." };
    }
    rows.push({
      providerRecipientId: row.id,
      hasCompleted: row.hasCompleted === true,
      signedDate: typeof row.signedDate === "string" ? row.signedDate : null,
      reportedRole: typeof row.role === "string" ? row.role : null,
      reportedContactName: typeof row.contactName === "string" ? row.contactName : null,
    });
  }
  return { ok: true, rows };
}

/**
 * The deterministic join this module requires ("Use provider recipient
 * ID as the primary lifecycle join") -- a plain alias for
 * `contract-signer-mapping-model.ts`'s own `SignerRecipientMapping`, the
 * ONE type Brad's recipient-mapping attestation is ever expressed as
 * (Product Owner ruling, 2026-09-13: no second, independently-defined
 * mapping shape). `verifyRequiredSigners` below only enforces that the
 * mapping, once supplied, is well-formed and matches the live readback
 * evidence deterministically -- it does not itself derive OR attest the
 * mapping; see `buildVerifiedUnderContractRecord`, which consumes a
 * currency-verified `SignerMappingAttestationRecord` for that.
 */
export type ExpectedSignerMapping = SignerRecipientMapping;

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
  | "SIGNER_SIGNED_TIMESTAMP_MISSING"
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
    // Ruling item 3, 2026-09-13: provider completion ALONE is no longer
    // sufficient -- every required signer must also carry a real, valid
    // signed timestamp. `hasCompleted === true` with no signedDate is
    // now treated the same as incomplete, never silently accepted.
    if (typeof row.signedDate !== "string" || !isValidIsoInstant(row.signedDate)) {
      reasons.push({
        code: "SIGNER_SIGNED_TIMESTAMP_MISSING",
        message: `Required signer "${m.displayName}" (role "${m.role}") is reported complete but carries no valid signed timestamp.`,
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
 * Byte-level classification ONLY -- pure array indexing, zero crypto
 * dependency, fully portable to a browser. `"valid_bytes"` is reached only
 * when real, non-empty, PDF-shaped bytes were actually read; the caller
 * (browser or test) is then responsible for hashing those bytes in
 * whatever way its own environment supports (Web Crypto in the browser)
 * and constructing a `ManualArtifactSelectionOutcome` from the result --
 * this function never sees or produces a hash itself.
 */
export type ManualFileBytesOutcome =
  | { kind: "no_file" }
  | { kind: "invalid_file_type"; mimeType: string | null; fileName: string | null }
  | { kind: "empty_file" }
  | { kind: "valid_bytes"; bytes: Uint8Array; fileName: string; mimeType: string };

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
 * supplied (spoofable) mime type or filename alone. Performs no binding/
 * identity check (that happens later, in `verifyManualArtifactSelection`)
 * and computes no hash (hashing is the caller's own environment-specific
 * next step -- see the module header).
 */
export function classifySelectedFileBytes(args: {
  fileName: string | null;
  mimeType: string | null;
  bytes: Uint8Array | null;
}): ManualFileBytesOutcome {
  if (args.bytes === null) return { kind: "no_file" };
  if (args.bytes.length === 0) return { kind: "empty_file" };
  if (!looksLikePdfContent(args.bytes)) {
    return { kind: "invalid_file_type", mimeType: args.mimeType, fileName: args.fileName };
  }
  return { kind: "valid_bytes", bytes: args.bytes, fileName: args.fileName ?? "selected.pdf", mimeType: args.mimeType ?? "application/pdf" };
}

/**
 * What a future browser-side flow observes AFTER hashing (or failing to
 * reach hashing), classified honestly -- NEVER a fetch/network outcome
 * (there is no automated retrieval path). `"selected"` carries only the
 * already-computed `sha256` -- never raw bytes -- so this type, and every
 * function that consumes it, can never leak the original bytes through
 * its own shape.
 */
export type ManualArtifactSelectionOutcome =
  | { kind: "no_file" }
  | { kind: "invalid_file_type"; mimeType: string | null; fileName: string | null }
  | { kind: "empty_file" }
  | { kind: "unreadable"; message: string }
  | { kind: "selected"; sha256: string; fileName: string; mimeType: string };

export type ArtifactReasonCode =
  | "NO_FILE_SELECTED"
  | "INVALID_FILE_TYPE"
  | "FILE_EMPTY"
  | "FILE_UNREADABLE"
  | "ARTIFACT_DOCUMENT_MISMATCH"
  | "ARTIFACT_VERSION_MISMATCH";

export type ArtifactReason = { code: ArtifactReasonCode; message: string };

/**
 * "Never treat a URL alone, an unverified response body, or a locally
 * computed hash without confirmed GHL document identity as preservation."
 * `outcome` is checked FIRST (no_file/invalid_file_type/empty_file/
 * unreadable each fail closed on their own, distinct reason) -- only once
 * a real `sha256` is confirmed present is document/version identity
 * checked (`selectedForDocumentId`/`selectedForVersion`, declared by the
 * caller alongside the file picker, against `confirmedProviderDocumentId`
 * -- itself only ever produced by `verifyAcceptedSendBinding` -- and
 * `expectedVersion`). This function computes NO hash and touches NO raw
 * bytes at all -- it only validates and passes the caller-supplied hash
 * through, which is what makes it safe to call from either Node (tests)
 * or a browser bundle without pulling in any environment-specific crypto
 * API itself.
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
  return { ok: true, sha256: args.outcome.sha256 };
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

export type VerificationStage = "input" | "binding" | "required_signers" | "signer_mapping" | "signers" | "provider_completion" | "artifact" | "executed_terms" | "eligibility";

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
  /** WHO must sign -- assembled by `buildRequiredSignerSet` (`contract-signer-mapping-model.ts`) from IAOS's own authoritative contract facts, NEVER from `acceptedSend.signers`. Re-validated here at the `required_signers` stage as defense in depth (Product Owner ruling, 2026-09-13). */
  requiredSigners: readonly RequiredSigner[];
  /** Brad's own manual, one-to-one recipient-mapping attestation -- currency-verified at the `signer_mapping` stage against this exact opportunity/version/document/revision/accepted-send/required-signer-set. `null` when none has been recorded yet; fails closed either way. There is no separate caller-supplied mapping parameter -- the mapping used by `verifyRequiredSigners` below comes ONLY from this currency-verified record. */
  signerMappingAttestation: SignerMappingAttestationRecord | null;
  providerRecipients: readonly ProviderSignerRow[];
  lifecycleHistory: readonly LifecycleRecord[];
  manualArtifactOutcome: ManualArtifactSelectionOutcome;
  selectedForDocumentId: string;
  selectedForVersion: ContractVersionIdentity;
  /** Brad's own recorded, unanimous, currency-checked visual comparison -- see `verifyExecutedTermsAttestationCurrency` and this module's own header, boundary 3. `null` when none has been recorded yet; fails closed at the `executed_terms` stage either way. */
  executedTermsAttestation: ExecutedTermsAttestationRecord | null;
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
 *   2b. WHO must sign -- `args.requiredSigners`, re-validated at its own
 *      `required_signers` stage (`validateRequiredSignerSet`) -- assembled
 *      by the caller from IAOS's own authoritative contract facts, NEVER
 *      from the accepted send's own `signers[]`.
 *   2c. Brad's own recipient-mapping attestation, currency-verified at
 *      its own `signer_mapping` stage (`verifySignerMappingAttestationCurrency`)
 *      against this exact opportunity/version/document/revision/
 *      accepted-send/required-signer-set -- missing, stale, cross-version,
 *      cross-document, non-Brad, or changed-required-signer-set evidence
 *      fails closed here by name.
 *   3. Every required signer matched individually, by provider recipient
 *      id, WITH a valid signed timestamp -- `verifyRequiredSigners`.
 *   4. GHL independently reports completed -- `verifyProviderCompletion`,
 *      reusing INV-64's own chronology (never a stale/tainted signal).
 *   5-6. Executed artifact selected (the manual bridge) and hashed by the
 *      CALLER's own environment (Web Crypto in the browser) -- this
 *      module only validates and passes the resulting hash through
 *      (`verifyManualArtifactSelection`).
 *   7. Executed material terms -- Brad's own current, unanimous MATCHES
 *      visual attestation, at its own named stage (`executed_terms`) --
 *      see the module header, boundary 3, and
 *      `verifyExecutedTermsAttestationCurrency`
 *      (`contract-executed-terms-attestation-model.ts`). Missing, stale,
 *      cross-version, cross-document, cross-artifact, non-Brad, or
 *      non-unanimous evidence fails closed here by name.
 *   9-10. Append-only write and readback equality are NOT this function's
 *      job -- see the module header's "WHAT BUILDING THE RECORD DOES NOT
 *      MEAN."
 *
 * `evaluateUnderContractEligibility` (board9-contract-model.ts, reused
 * verbatim) remains the actual, final, single eligibility decision --
 * every earlier stage exists to build ITS inputs correctly, never to
 * duplicate or bypass its own joint three-fact requirement.
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

  // WHO must sign -- re-validated here as defense in depth, never trusted
  // unchecked even though the caller (`buildRequiredSignerSet`) already
  // validated it once (module header, item 2a).
  const requiredSignersCheck = validateRequiredSignerSet(args.requiredSigners);
  if (!requiredSignersCheck.ok) return fail("required_signers", requiredSignersCheck.reasons);

  // Brad's own recipient-mapping attestation, currency-verified against
  // THIS exact evidence -- never derived, never a caller assertion made
  // some other way (module header, item 2b).
  const mappingResult = verifySignerMappingAttestationCurrency({
    attestation: args.signerMappingAttestation,
    opportunityId: args.opportunityId,
    version: args.version,
    providerDocumentId: binding.value.providerDocumentId,
    providerDocumentRevision: binding.value.providerDocumentRevision,
    acceptedSendAttemptId: args.acceptedSend.attemptId,
    requiredSigners: args.requiredSigners,
  });
  if (!mappingResult.ok) return fail("signer_mapping", mappingResult.reasons);

  const signerResult = verifyRequiredSigners({
    mappings: mappingResult.mappings,
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

  // BOUNDARY 3 (module header): the manual PDF bridge above proves
  // artifact POSSESSION and INTEGRITY only -- it does not, by itself,
  // prove price/property/party equality. Brad's own current, unanimous
  // MATCHES attestation is the ONLY evidence this pipeline ever accepts
  // for that; missing, stale, cross-version, cross-document, cross-
  // artifact, non-Brad, or non-unanimous evidence fails closed here.
  const attestationCheck = verifyExecutedTermsAttestationCurrency({
    attestation: args.executedTermsAttestation,
    opportunityId: args.opportunityId,
    version: args.version,
    providerDocumentId: binding.value.providerDocumentId,
    providerDocumentRevision: binding.value.providerDocumentRevision,
    selectedArtifactSha256: artifact.sha256,
  });
  if (!attestationCheck.ok) return fail("executed_terms", attestationCheck.reasons);

  const requirements: SignerRequirement[] = mappingResult.mappings.map((m) => ({ role: m.role, displayName: m.displayName, signingAuthorityNote: null }));

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
