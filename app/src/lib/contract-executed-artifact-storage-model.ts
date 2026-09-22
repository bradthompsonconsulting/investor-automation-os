/**
 * Board #9 Phase B (B9-13) -- executed-PDF durable preservation. Product
 * Owner ruling, 2026-09-21: GHL exposes no supported retrieval path for
 * the executed document's actual bytes (confirmed from official
 * documentation plus a live, read-only call against the real completed
 * Test document -- every field on `GET /proposals/document` is metadata,
 * never file content). V1 therefore uses CONTROLLED OPERATOR UPLOAD:
 * Brad downloads the completed executed PDF from GHL himself and uploads
 * it through the IAOS Contract Workspace; IAOS stores the actual bytes
 * durably and independently re-verifies them before Under Contract may
 * ever proceed.
 *
 * CHUNKED, NEVER AN EDGE FUNCTION -- Product Owner ruling, same session.
 * Classic Netlify Functions carry a documented 6 MB request payload
 * limit (4.5 MB effective once base64-encoded), and the real executed
 * PDF is 10,102,475 bytes -- one request cannot carry it. `CHUNK_SIZE_BYTES`
 * below is chosen so a base64-encoded chunk (4/3 the raw size) stays
 * comfortably under that effective ceiling.
 *
 * PURE. No I/O, no React, no fetch, no Blobs SDK. This module decides
 * chunk acceptance, finalize-readiness, and preservation idempotency from
 * already-fetched session/artifact facts; the actual chunk storage,
 * reassembly, hashing, and Blobs read/write live in the dedicated
 * Netlify Function (`ghl-executed-artifact-upload.ts`), which is the ONLY
 * place bytes are ever touched.
 */

import { type ContractVersionIdentity } from "./board9-contract-model";

/** ~3 MB raw per chunk -> base64 ≈ 4 MB, safely under Netlify's ~4.5 MB effective binary-payload ceiling for classic (Lambda-compatible) Functions. */
export const CHUNK_SIZE_BYTES = 3_000_000;

/** Generous ceiling well above any real TREC contract PDF -- an oversized upload is refused before a single chunk is accepted, never discovered only at finalize. */
export const MAX_TOTAL_BYTES = 60_000_000;

/** Deterministic, collision-safe key for a contract version -- used to scope both the pending-upload session store and the permanent artifact store. Never derived from caller-supplied text. */
export function contractVersionStorageKey(version: ContractVersionIdentity): string {
  return `${version.agreementAt}__${version.versionSeq}__${version.supersedesVersionSeq ?? "none"}`;
}

export type ChunkAcceptReasonCode =
  | "OPPORTUNITY_ID_BLANK"
  | "UPLOAD_ID_BLANK"
  | "INVALID_CHUNK_INDEX"
  | "INVALID_CHUNK_COUNT"
  | "INVALID_TOTAL_BYTE_COUNT"
  | "TOTAL_BYTE_COUNT_OVERSIZED"
  | "CHUNK_TOO_LARGE"
  | "INVALID_EXPECTED_FULL_SHA256"
  | "CHUNK_INDEX_OUT_OF_RANGE"
  | "CROSS_OPPORTUNITY_OR_VERSION"
  | "CHUNK_COUNT_MISMATCH"
  | "TOTAL_BYTE_COUNT_MISMATCH"
  | "FILENAME_MISMATCH"
  | "EXPECTED_HASH_MISMATCH"
  | "DUPLICATE_CHUNK";

export type ChunkAcceptReason = { code: ChunkAcceptReasonCode; message: string };

/**
 * Gate-review closure -- PR #85 chunk-ingestion redesign. Each chunk is
 * stored and evaluated ENTIRELY independently, keyed deterministically by
 * (opportunityId, version, uploadId, chunkIndex) -- never by reading a
 * shared manifest object another invocation may have just written and
 * this one cannot yet see. This is the self-describing record already
 * stored (as the Blobs object's own metadata) at THIS chunk's own
 * deterministic key, if any -- NEVER any other chunk's record.
 */
export type ChunkRecordMetadata = {
  opportunityId: string;
  agreementAt: string;
  version: ContractVersionIdentity;
  uploadId: string;
  chunkCount: number;
  totalByteCount: number;
  originalFileName: string;
  /** The FULL reconstructed file's expected SHA-256, declared identically by every chunk in this upload -- part of the immutable request metadata every chunk carries, so finalize can cross-validate without any shared session object. */
  expectedFullSha256: string;
  /** SHA-256 of this ONE chunk's own bytes -- lets a retry of an already-stored index be told apart from an attempted overwrite. Never the reassembled file's own hash. */
  chunkSha256: string;
};

export type IncomingChunk = {
  opportunityId: string;
  agreementAt: string;
  version: ContractVersionIdentity;
  uploadId: string;
  chunkIndex: number;
  chunkCount: number;
  totalByteCount: number;
  originalFileName: string;
  expectedFullSha256: string;
  chunkByteLength: number;
  /** SHA-256 of this chunk's own bytes, computed by the caller from the actual received bytes -- never trusted as a claim about content this function cannot see; used only to tell an identical retry apart from a genuine overwrite attempt. */
  chunkSha256: string;
};

export type ChunkAcceptOutcome =
  | { ok: true; kind: "new" }
  /** The exact same chunk index, with the exact same content (by hash) AND the exact same declared metadata, arrived again -- a safe network-retry, never re-stored, never an error. */
  | { ok: true; kind: "duplicate_identical" }
  | { ok: false; reasons: ChunkAcceptReason[] };

function isValidSha256Hex(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

/**
 * Refuses (fails closed) a chunk that is structurally invalid, oversized,
 * or that disagrees with a record ALREADY stored at this EXACT
 * (opportunityId, version, uploadId, chunkIndex) key -- never silently
 * coerced or merged. NO ordering requirement of any kind: chunks 1-3 are
 * exactly as acceptable before chunk 0 as after it, and a request never
 * needs to read any OTHER chunk's record to be evaluated -- this is the
 * whole point of the redesign (PR #85: the prior design required chunk N
 * to read a manifest chunk N-1 had just written, which raced Netlify
 * Blobs' own eventual consistency across separate Lambda invocations).
 * A chunk repeating an already-stored index is accepted as a no-op ONLY
 * when both its content hash AND its declared metadata exactly match what
 * was already stored there; ANY difference is refused as `DUPLICATE_CHUNK`
 * -- an index is never silently overwritten. `existingChunk` is `null`
 * for a chunk index never before stored under this uploadId.
 */
export function evaluateChunkAcceptance(args: {
  incoming: IncomingChunk;
  isSameVersion: (a: ContractVersionIdentity, b: ContractVersionIdentity) => boolean;
  existingChunk: ChunkRecordMetadata | null;
}): ChunkAcceptOutcome {
  const { incoming } = args;
  const reasons: ChunkAcceptReason[] = [];

  if (incoming.opportunityId.trim() === "") reasons.push({ code: "OPPORTUNITY_ID_BLANK", message: "opportunityId is blank." });
  if (incoming.uploadId.trim() === "") reasons.push({ code: "UPLOAD_ID_BLANK", message: "uploadId is blank." });
  if (!Number.isInteger(incoming.chunkIndex) || incoming.chunkIndex < 0) reasons.push({ code: "INVALID_CHUNK_INDEX", message: "chunkIndex must be a non-negative integer." });
  if (!Number.isInteger(incoming.chunkCount) || incoming.chunkCount < 1) reasons.push({ code: "INVALID_CHUNK_COUNT", message: "chunkCount must be a positive integer." });
  if (!Number.isInteger(incoming.totalByteCount) || incoming.totalByteCount <= 0) reasons.push({ code: "INVALID_TOTAL_BYTE_COUNT", message: "totalByteCount must be a positive integer." });
  if (Number.isInteger(incoming.totalByteCount) && incoming.totalByteCount > MAX_TOTAL_BYTES) {
    reasons.push({ code: "TOTAL_BYTE_COUNT_OVERSIZED", message: `totalByteCount exceeds the maximum accepted size of ${MAX_TOTAL_BYTES} bytes.` });
  }
  if (incoming.chunkByteLength > CHUNK_SIZE_BYTES) {
    reasons.push({ code: "CHUNK_TOO_LARGE", message: `A single chunk exceeds the maximum accepted chunk size of ${CHUNK_SIZE_BYTES} bytes.` });
  }
  if (!isValidSha256Hex(incoming.expectedFullSha256)) {
    reasons.push({ code: "INVALID_EXPECTED_FULL_SHA256", message: "expectedFullSha256 is not a well-formed 64-character lowercase hex SHA-256." });
  }
  if (reasons.length > 0) return { ok: false, reasons };

  if (incoming.chunkIndex >= incoming.chunkCount) {
    return { ok: false, reasons: [{ code: "CHUNK_INDEX_OUT_OF_RANGE", message: "chunkIndex is outside [0, chunkCount)." }] };
  }

  if (args.existingChunk) {
    const c = args.existingChunk;
    if (c.opportunityId !== incoming.opportunityId || c.agreementAt !== incoming.agreementAt || !args.isSameVersion(c.version, incoming.version)) {
      reasons.push({ code: "CROSS_OPPORTUNITY_OR_VERSION", message: "This chunk's opportunity/agreement/version does not match the record already stored at this exact chunk key." });
    }
    if (c.chunkCount !== incoming.chunkCount) reasons.push({ code: "CHUNK_COUNT_MISMATCH", message: "chunkCount does not match the already-stored record's declared chunk count." });
    if (c.totalByteCount !== incoming.totalByteCount) reasons.push({ code: "TOTAL_BYTE_COUNT_MISMATCH", message: "totalByteCount does not match the already-stored record's declared total." });
    if (c.originalFileName !== incoming.originalFileName) reasons.push({ code: "FILENAME_MISMATCH", message: "originalFileName does not match the already-stored record's declared filename." });
    if (c.expectedFullSha256 !== incoming.expectedFullSha256) reasons.push({ code: "EXPECTED_HASH_MISMATCH", message: "expectedFullSha256 does not match the already-stored record's declared value." });
    if (reasons.length > 0) return { ok: false, reasons };
    if (c.chunkSha256 === incoming.chunkSha256) return { ok: true, kind: "duplicate_identical" };
    return { ok: false, reasons: [{ code: "DUPLICATE_CHUNK", message: "This exact chunk index already holds DIFFERENT content -- refusing a silent overwrite." }] };
  }

  return { ok: true, kind: "new" };
}

export type FinalizeReasonCode = "MISSING_CHUNKS" | "INCONSISTENT_CHUNK_METADATA";
export type FinalizeReason = { code: FinalizeReasonCode; message: string };

/**
 * Gate-review closure -- PR #85 chunk-ingestion redesign. Finalize is now
 * the ONLY place chunk-count/completeness is ever judged -- never an
 * intermediate chunk request. `expected` is what THIS finalize request
 * itself declares (the same immutable metadata every chunk also carried);
 * `foundChunks` is whatever the handler actually managed to read back
 * (with its own bounded-visibility handling for any chunk not yet
 * observable). Fails closed on either a genuinely missing index or a
 * found chunk whose own declared metadata disagrees with this finalize
 * request -- never attempts reassembly from an incomplete or
 * inconsistent set.
 */
export function evaluateFinalizeReadiness(args: {
  expected: { opportunityId: string; agreementAt: string; version: ContractVersionIdentity; chunkCount: number; totalByteCount: number; originalFileName: string; expectedFullSha256: string };
  isSameVersion: (a: ContractVersionIdentity, b: ContractVersionIdentity) => boolean;
  foundChunks: readonly ({ chunkIndex: number } & ChunkRecordMetadata)[];
}): { ok: true } | { ok: false; reasons: FinalizeReason[] } {
  const have = new Map(args.foundChunks.map((c) => [c.chunkIndex, c]));
  const missing: number[] = [];
  for (let i = 0; i < args.expected.chunkCount; i++) if (!have.has(i)) missing.push(i);
  if (missing.length > 0) {
    return { ok: false, reasons: [{ code: "MISSING_CHUNKS", message: `Not all ${args.expected.chunkCount} chunks are visible yet (missing: ${missing.join(", ")}).` }] };
  }
  const inconsistent = args.foundChunks.some((c) =>
    c.opportunityId !== args.expected.opportunityId ||
    c.agreementAt !== args.expected.agreementAt ||
    !args.isSameVersion(c.version, args.expected.version) ||
    c.chunkCount !== args.expected.chunkCount ||
    c.totalByteCount !== args.expected.totalByteCount ||
    c.originalFileName !== args.expected.originalFileName ||
    c.expectedFullSha256 !== args.expected.expectedFullSha256,
  );
  if (inconsistent) {
    return { ok: false, reasons: [{ code: "INCONSISTENT_CHUNK_METADATA", message: "One or more received chunks declare metadata that does not match this finalize request -- refusing to reconstruct from inconsistent evidence." }] };
  }
  return { ok: true };
}

export type PreservedExecutedArtifactIdentity = {
  opportunityId: string;
  agreementAt: string;
  version: ContractVersionIdentity;
  sha256: string;
  byteCount: number;
};

export type PreservationIdempotencyOutcome =
  | { kind: "fresh" }
  | { kind: "no_op_already_preserved"; existing: PreservedExecutedArtifactIdentity }
  | { kind: "conflict"; existing: PreservedExecutedArtifactIdentity };

/**
 * A re-upload for the same contract version whose reconstructed bytes hash
 * and byte-count EXACTLY match the already-preserved artifact is a no-op
 * success (never a duplicate write). Any other pre-existing artifact for
 * the same version, with differing bytes, is a conflicting duplicate --
 * refused, never silently overwritten.
 */
export function evaluatePreservationIdempotency(args: {
  existing: PreservedExecutedArtifactIdentity | null;
  newSha256: string;
  newByteCount: number;
}): PreservationIdempotencyOutcome {
  if (!args.existing) return { kind: "fresh" };
  if (args.existing.sha256 === args.newSha256 && args.existing.byteCount === args.newByteCount) {
    return { kind: "no_op_already_preserved", existing: args.existing };
  }
  return { kind: "conflict", existing: args.existing };
}
