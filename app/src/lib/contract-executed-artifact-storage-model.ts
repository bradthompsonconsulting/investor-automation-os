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
  | "CHUNK_INDEX_OUT_OF_RANGE"
  | "CROSS_OPPORTUNITY_OR_VERSION"
  | "CHUNK_COUNT_MISMATCH"
  | "TOTAL_BYTE_COUNT_MISMATCH"
  | "FILENAME_MISMATCH"
  | "OUT_OF_ORDER_CHUNK"
  | "DUPLICATE_CHUNK";

export type ChunkAcceptReason = { code: ChunkAcceptReasonCode; message: string };

export type UploadSessionManifest = {
  opportunityId: string;
  agreementAt: string;
  version: ContractVersionIdentity;
  uploadId: string;
  chunkCount: number;
  totalByteCount: number;
  originalFileName: string;
  /** Strictly ascending, gap-free by construction -- chunks are only ever accepted in order. */
  receivedChunkIndexes: number[];
  /**
   * SHA-256 of each received chunk's own bytes, by chunk index -- gate-review
   * closure item: lets a retry of an already-received index be told apart
   * from an attempted overwrite. Never used for anything but that
   * comparison; the reassembled file's own SHA-256 (computed at finalize
   * from the ACTUAL reassembled bytes) is the only hash that ever reaches a
   * durable record.
   */
  receivedChunkHashes: Record<number, string>;
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
  chunkByteLength: number;
  /** SHA-256 of this chunk's own bytes, computed by the caller from the actual received bytes -- never trusted as a claim about content this function cannot see; used only to tell an identical retry apart from a genuine overwrite attempt. */
  chunkSha256: string;
};

export type ChunkAcceptOutcome =
  | { ok: true; kind: "new" }
  /** The exact same chunk index, with the exact same content (by hash), arrived again -- a safe network-retry, never re-stored, never an error. */
  | { ok: true; kind: "duplicate_identical" }
  | { ok: false; reasons: ChunkAcceptReason[] };

/**
 * Refuses (fails closed) a chunk that is structurally invalid, oversized,
 * out of order, or that disagrees with the session it claims to belong to
 * on opportunity, agreement, version, chunk count, total byte count, or
 * filename -- never silently coerced or merged. A chunk repeating an
 * already-received index is accepted as a no-op ONLY when its content hash
 * matches what was already received at that index (an ordinary retry of
 * the same bytes); DIFFERENT content at an already-used index is refused
 * as `DUPLICATE_CHUNK` -- an index is never silently overwritten with new
 * content. `existingSession` is `null` only for a genuinely new session's
 * first chunk (which must be index 0).
 */
export function evaluateChunkAcceptance(args: {
  incoming: IncomingChunk;
  isSameVersion: (a: ContractVersionIdentity, b: ContractVersionIdentity) => boolean;
  existingSession: UploadSessionManifest | null;
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
  if (reasons.length > 0) return { ok: false, reasons };

  if (incoming.chunkIndex >= incoming.chunkCount) {
    return { ok: false, reasons: [{ code: "CHUNK_INDEX_OUT_OF_RANGE", message: "chunkIndex is outside [0, chunkCount)." }] };
  }

  if (args.existingSession) {
    const s = args.existingSession;
    if (s.opportunityId !== incoming.opportunityId || s.agreementAt !== incoming.agreementAt || !args.isSameVersion(s.version, incoming.version)) {
      reasons.push({ code: "CROSS_OPPORTUNITY_OR_VERSION", message: "This chunk's opportunity/agreement/version does not match the session it was started under." });
    }
    if (s.chunkCount !== incoming.chunkCount) reasons.push({ code: "CHUNK_COUNT_MISMATCH", message: "chunkCount does not match this session's declared chunk count." });
    if (s.totalByteCount !== incoming.totalByteCount) reasons.push({ code: "TOTAL_BYTE_COUNT_MISMATCH", message: "totalByteCount does not match this session's declared total." });
    if (s.originalFileName !== incoming.originalFileName) reasons.push({ code: "FILENAME_MISMATCH", message: "originalFileName does not match this session's declared filename." });
    if (reasons.length > 0) return { ok: false, reasons };
    if (s.receivedChunkIndexes.includes(incoming.chunkIndex)) {
      if (s.receivedChunkHashes[incoming.chunkIndex] === incoming.chunkSha256) return { ok: true, kind: "duplicate_identical" };
      return { ok: false, reasons: [{ code: "DUPLICATE_CHUNK", message: "This exact chunk index has already been received with DIFFERENT content -- refusing a silent overwrite." }] };
    }
    if (incoming.chunkIndex !== s.receivedChunkIndexes.length) {
      return { ok: false, reasons: [{ code: "OUT_OF_ORDER_CHUNK", message: `Chunks must arrive strictly in order; expected chunkIndex ${s.receivedChunkIndexes.length}, got ${incoming.chunkIndex}.` }] };
    }
  } else if (incoming.chunkIndex !== 0) {
    return { ok: false, reasons: [{ code: "OUT_OF_ORDER_CHUNK", message: "The first chunk of a new session must be chunkIndex 0." }] };
  }

  return { ok: true, kind: "new" };
}

export type FinalizeReasonCode = "MISSING_CHUNKS";
export type FinalizeReason = { code: FinalizeReasonCode; message: string };

/** Pre-reassembly gate: every declared chunk index must actually have been received. Never attempts reassembly on a partial session. */
export function evaluateFinalizeReadiness(session: UploadSessionManifest): { ok: true } | { ok: false; reasons: FinalizeReason[] } {
  const have = new Set(session.receivedChunkIndexes);
  const missing: number[] = [];
  for (let i = 0; i < session.chunkCount; i++) if (!have.has(i)) missing.push(i);
  if (missing.length > 0) {
    return { ok: false, reasons: [{ code: "MISSING_CHUNKS", message: `Not all ${session.chunkCount} chunks have been received yet (missing: ${missing.join(", ")}).` }] };
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
