/**
 * Board #9 Phase B (B9-13) -- executed-PDF durable preservation, the
 * authenticated chunked-upload endpoint. Product Owner ruling, 2026-09-21:
 * controlled operator upload through the EXISTING Netlify Function
 * architecture, chunked (never an Edge Function -- classic Functions
 * carry a documented ~4.5 MB effective binary-payload ceiling, and the
 * real executed PDF is ~9.6 MB). See `contract-executed-artifact-storage-model.ts`'s
 * own header for the full architecture rationale.
 *
 * FOUR PHASES, ONE ENDPOINT, SAME AUTH/ORIGIN GATE EVERY BOARD #9 WRITE
 * USES: "chunk" accepts one ordered chunk into a pending session; "finalize"
 * reassembles, validates, hashes, stores, RE-VERIFIES BY READING BACK, and
 * records durable metadata; "download-chunk" is the Brad-only readback
 * path (the SAME size ceiling applies to responses, so download is
 * chunked too); "abort" discards an incomplete session's pending chunks
 * without ever touching a verified final artifact.
 *
 * NEVER A CALLER-CONTROLLED BLOB KEY. Every blob key here is derived
 * server-side from `opportunityId` + `contractVersionStorageKey(version)`
 * (+ `uploadId` for pending sessions) -- never accepted as a raw client
 * input, per the Product Owner's explicit ruling.
 */

import { connectLambda, getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";
import { requireAppWriter } from "./lib/app-write-auth";
import { requireAppWriteOrigin } from "./lib/app-write-origin";
import { configuredBoundary } from "./lib/ghl-write-boundary";
import { lockContact } from "./lib/write-receipts";
import { isSameContractVersion, type ContractVersionIdentity } from "../../src/lib/board9-contract-model";
import { looksLikePdfContent, countPdfPages } from "../../src/lib/contract-execution-model";
import {
  evaluateChunkAcceptance, evaluateFinalizeReadiness, evaluatePreservationIdempotency,
  contractVersionStorageKey, CHUNK_SIZE_BYTES, type UploadSessionManifest,
} from "../../src/lib/contract-executed-artifact-storage-model";
import {
  formatPreservedExecutedArtifactNote, latestPreservedExecutedArtifactForVersion,
} from "../../src/lib/contract-executed-artifact-carriers";

const json = (statusCode: number, data: unknown) => ({ statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(data) });

/**
 * Gate-review closure -- PR #85 live failure (Blobs initialization).
 * Mirrors ghl-write.ts's own describeCaughtError/logWriteFailure pair --
 * never throws on its own, regardless of what was actually thrown. Logs
 * ONLY correlation and error metadata (phase, uploadId -- both plain
 * client-supplied session identifiers, never free text) plus the error's
 * own name/message/stack. NEVER the request body/chunk bytes, PDF
 * content, tokens, or any GHL contact/document data -- none of those are
 * referenced here at all, structurally, not merely filtered out.
 */
function describeCaughtError(error: unknown): { name: string; message: string; stack: string | null } {
  if (error instanceof Error) {
    return {
      name: typeof error.name === "string" ? error.name : "Error",
      message: typeof error.message === "string" ? error.message : "",
      stack: typeof error.stack === "string" ? error.stack : null,
    };
  }
  let message: string;
  try { message = String(error); } catch { message = "[unloggable thrown value]"; }
  return { name: "NonErrorThrow", message, stack: null };
}

function logUploadFailure(phase: unknown, uploadId: unknown, error: unknown): void {
  const described = describeCaughtError(error);
  console.error("[ghl-executed-artifact-upload]", JSON.stringify({
    phase: typeof phase === "string" ? phase : null,
    uploadId: typeof uploadId === "string" ? uploadId : null,
    errorName: described.name,
    errorMessage: described.message,
    stack: described.stack,
  }));
}

function isValidVersion(v: any): v is ContractVersionIdentity {
  return typeof v === "object" && v !== null && typeof v.agreementAt === "string" && typeof v.versionSeq === "number";
}

function sessionScope(opportunityId: string, version: ContractVersionIdentity, uploadId: string) {
  return `sessions/${opportunityId}/${contractVersionStorageKey(version)}/${uploadId}`;
}
function manifestKey(opportunityId: string, version: ContractVersionIdentity, uploadId: string) {
  return `${sessionScope(opportunityId, version, uploadId)}/manifest.json`;
}
function chunkKey(opportunityId: string, version: ContractVersionIdentity, uploadId: string, chunkIndex: number) {
  return `${sessionScope(opportunityId, version, uploadId)}/chunk-${chunkIndex}`;
}
function artifactKey(opportunityId: string, version: ContractVersionIdentity) {
  return `${opportunityId}/${contractVersionStorageKey(version)}.pdf`;
}

/**
 * Gate-review closure, requirement 4 -- housekeeping cleanup NEVER masks a
 * result the caller already determined (a genuine success or a genuine
 * conflict refusal). A transient failure deleting a pending chunk or the
 * session manifest after that determination is logged and swallowed, never
 * allowed to turn an already-correct response into a false failure.
 */
async function safeCleanupSession(uploads: ReturnType<typeof getStore>, opportunityId: string, version: ContractVersionIdentity, uploadId: string, chunkIndexes: readonly number[]) {
  for (const idx of chunkIndexes) {
    try { await uploads.delete(chunkKey(opportunityId, version, uploadId, idx)); } catch (e) { console.error("[ghl-executed-artifact-upload] chunk cleanup failed (non-fatal)", idx, e); }
  }
  try { await uploads.delete(manifestKey(opportunityId, version, uploadId)); } catch (e) { console.error("[ghl-executed-artifact-upload] manifest cleanup failed (non-fatal)", e); }
}

/**
 * Gate-review closure, requirement 4 -- "metadata exists but stored bytes
 * are missing or corrupted" must never be treated as a verified preserved
 * artifact by ANY code path that reads the artifact back, not only the
 * stage-transition gate. Re-reads the stored bytes and independently
 * recomputes SHA-256/byte-count against the durable metadata's own claim
 * -- never trusts that a successful `.set()` sometime in the past still
 * holds.
 */
/**
 * Gate-review closure, requirements 3-6 -- each chunk (and finalize) is a
 * SEPARATE Lambda invocation; the in-process `lockContact` mutex cannot
 * coordinate across them, and Netlify Blobs' default ("eventual")
 * consistency does not guarantee chunk N's read of the session manifest
 * observes chunk (N-1)'s write immediately. Two independent layers:
 *
 *   1. `consistency: "strong"` is requested on every read below --
 *      genuinely supported by the installed SDK (`GetOptions.consistency`),
 *      but it requires an `uncachedEdgeURL` in the environment context
 *      that `connectLambda(event)` does not supply (confirmed by reading
 *      the SDK's own source: connectLambda sets only `{deployID,
 *      edgeURL, siteID, token}`). Requesting it costs nothing when
 *      unsupported -- the SDK's own `BlobsConsistencyError` is caught
 *      here and the read is retried at the default consistency, never a
 *      new crash in place of the old race.
 *   2. A short, bounded retry for reads that GENUINELY expect a prior
 *      write to already be visible (a later chunk's or finalize's own
 *      manifest read -- never chunk 0, which correctly expects no
 *      session yet) -- the actual, environment-independent guarantee
 *      that a real prior write becomes visible before this request is
 *      refused as out-of-order/missing, regardless of whether strong
 *      consistency ends up available in this deployment.
 */
const MANIFEST_READ_RETRY_DELAYS_MS = [50, 150, 300];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getWithConsistencyFallback(store: ReturnType<typeof getStore>, key: string, type: "json" | "arrayBuffer"): Promise<any> {
  try {
    return await store.get(key, { type, consistency: "strong" } as any);
  } catch (e: any) {
    if (e?.name !== "BlobsConsistencyError") throw e;
    return store.get(key, { type } as any);
  }
}

async function readManifest(uploads: ReturnType<typeof getStore>, mKey: string, expectExisting: boolean): Promise<UploadSessionManifest | null> {
  let manifest = (await getWithConsistencyFallback(uploads, mKey, "json")) as UploadSessionManifest | null;
  if (manifest !== null || !expectExisting) return manifest;
  for (const waitMs of MANIFEST_READ_RETRY_DELAYS_MS) {
    await delay(waitMs);
    manifest = (await getWithConsistencyFallback(uploads, mKey, "json")) as UploadSessionManifest | null;
    if (manifest !== null) return manifest;
  }
  return manifest;
}

async function reverifyStoredArtifactBytes(artifacts: ReturnType<typeof getStore>, blobKey: string, expectedSha256: string, expectedByteCount: number): Promise<Buffer> {
  const raw = await getWithConsistencyFallback(artifacts, blobKey, "arrayBuffer");
  if (!raw) throw new Error("Preserved artifact metadata exists but its stored bytes could not be read");
  const buffer = Buffer.from(raw);
  if (buffer.byteLength !== expectedByteCount) throw new Error("Stored artifact byte count no longer matches its durable metadata -- refusing to treat it as verified");
  if (createHash("sha256").update(buffer).digest("hex") !== expectedSha256) throw new Error("Stored artifact hash no longer matches its durable metadata -- refusing to treat it as verified");
  return buffer;
}

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  let operator: string;
  try { operator = requireAppWriter(event); } catch { return json(401, { error: "Application write sign-in required" }); }
  try { requireAppWriteOrigin(event); } catch { return json(403, { error: "Application write origin refused" }); }

  let request: any;
  try {
    if (event.isBase64Encoded) throw new Error("Unexpected request encoding");
    request = JSON.parse(event.body ?? "null");
    if (typeof request !== "object" || request === null) throw new Error("Invalid body");
  } catch { return json(400, { error: "Invalid request body" }); }

  const { phase, opportunityId, agreementAt, version } = request;
  if (typeof phase !== "string" || typeof opportunityId !== "string" || opportunityId.trim() === "" || typeof agreementAt !== "string" || !isValidVersion(version)) {
    return json(400, { error: "Missing or invalid opportunityId/agreementAt/version" });
  }

  try {
    // Gate-review closure -- PR #85 live failure. This Lambda-style
    // handler must call connectLambda(event) BEFORE any getStore() call,
    // exactly like ghl-write.ts's own established pattern -- the SDK has
    // no other supported way to discover the Blobs context in Netlify's
    // real runtime (the offline test harness's own @netlify/blobs mock
    // never exercised this, which is why the gap went unnoticed until a
    // live Test attempt hit HTTP 502/MissingBlobsEnvironmentError).
    // Wrapped inside this try so a genuine initialization failure is a
    // safe, logged, controlled 409 -- never an uncaught 502.
    connectLambda(event);
    const uploads = getStore("iaos-executed-artifact-uploads");
    const artifacts = getStore("iaos-executed-artifacts");
    const boundary = configuredBoundary();
    const opportunity = await boundary.opportunity(opportunityId);
    const contactId = opportunity.contactId;

    if (phase === "chunk") {
      const { uploadId, chunkIndex, chunkCount, totalByteCount, originalFileName, chunkBase64 } = request;
      if (typeof uploadId !== "string" || typeof chunkIndex !== "number" || typeof chunkCount !== "number" || typeof totalByteCount !== "number" || typeof originalFileName !== "string" || typeof chunkBase64 !== "string") {
        return json(400, { error: "Missing or invalid chunk fields" });
      }
      let chunkBytes: Buffer;
      try { chunkBytes = Buffer.from(chunkBase64, "base64"); } catch { return json(400, { error: "chunkBase64 is not valid base64" }); }
      const chunkSha256 = createHash("sha256").update(chunkBytes).digest("hex");

      const release = await lockContact(contactId);
      try {
        const mKey = manifestKey(opportunityId, version, uploadId);
        const existingSession = await readManifest(uploads, mKey, chunkIndex > 0);
        const evaluation = evaluateChunkAcceptance({
          incoming: { opportunityId, agreementAt, version, uploadId, chunkIndex, chunkCount, totalByteCount, originalFileName, chunkByteLength: chunkBytes.byteLength, chunkSha256 },
          isSameVersion: isSameContractVersion,
          existingSession,
        });
        if (!evaluation.ok) {
          // Gate-review closure, requirement 2 -- a safe reason code
          // (structural, never bytes/tokens/PII) reaches both the
          // diagnostic log and the client's own error display.
          logUploadFailure(phase, uploadId, new Error("Chunk refused: " + evaluation.reasons.map((r) => r.code).join(", ")));
          return json(409, { error: "Chunk refused", reasons: evaluation.reasons });
        }
        if (evaluation.kind === "duplicate_identical") {
          // An ordinary retry of the same bytes -- already stored, never re-stored, never an error.
          return json(200, { accepted: true, duplicate: true, receivedChunkIndexes: existingSession!.receivedChunkIndexes });
        }

        await uploads.set(chunkKey(opportunityId, version, uploadId, chunkIndex), chunkBytes);
        const nextManifest: UploadSessionManifest = existingSession
          ? { ...existingSession, receivedChunkIndexes: [...existingSession.receivedChunkIndexes, chunkIndex], receivedChunkHashes: { ...existingSession.receivedChunkHashes, [chunkIndex]: chunkSha256 } }
          : { opportunityId, agreementAt, version, uploadId, chunkCount, totalByteCount, originalFileName, receivedChunkIndexes: [chunkIndex], receivedChunkHashes: { [chunkIndex]: chunkSha256 } };
        await uploads.setJSON(mKey, nextManifest);
        return json(200, { accepted: true, duplicate: false, receivedChunkIndexes: nextManifest.receivedChunkIndexes });
      } finally { await release(); }
    }

    if (phase === "abort") {
      const { uploadId } = request;
      if (typeof uploadId !== "string") return json(400, { error: "Missing uploadId" });
      const mKey = manifestKey(opportunityId, version, uploadId);
      const session = await readManifest(uploads, mKey, false);
      if (session) await safeCleanupSession(uploads, opportunityId, version, uploadId, session.receivedChunkIndexes);
      return json(200, { aborted: true });
    }

    if (phase === "finalize") {
      const { uploadId, providerDocumentId } = request;
      if (typeof uploadId !== "string" || typeof providerDocumentId !== "string" || providerDocumentId.trim() === "") {
        return json(400, { error: "Missing uploadId/providerDocumentId" });
      }
      const release = await lockContact(contactId);
      try {
        const mKey = manifestKey(opportunityId, version, uploadId);
        const session = await readManifest(uploads, mKey, true);
        if (!session) {
          logUploadFailure(phase, uploadId, new Error("No such upload session"));
          return json(409, { error: "No such upload session" });
        }
        if (session.opportunityId !== opportunityId || session.agreementAt !== agreementAt || !isSameContractVersion(session.version, version)) {
          return json(409, { error: "Session does not match the requested opportunity/agreement/version" });
        }
        const readiness = evaluateFinalizeReadiness(session);
        if (!readiness.ok) {
          logUploadFailure(phase, uploadId, new Error("Not all chunks received: " + readiness.reasons.map((r) => r.code).join(", ")));
          return json(409, { error: "Not all chunks received", reasons: readiness.reasons });
        }

        const parts: Buffer[] = [];
        for (let i = 0; i < session.chunkCount; i++) {
          const part = await getWithConsistencyFallback(uploads, chunkKey(opportunityId, version, uploadId, i), "arrayBuffer");
          if (!part) return json(409, { error: `Chunk ${i} is missing from storage` });
          parts.push(Buffer.from(part));
        }
        const reconstructed = Buffer.concat(parts);
        if (reconstructed.byteLength !== session.totalByteCount) {
          return json(409, { error: "Reconstructed byte count does not match the declared total -- refusing to preserve" });
        }
        if (!looksLikePdfContent(new Uint8Array(reconstructed))) {
          return json(409, { error: "Reconstructed bytes do not look like a PDF -- refusing to preserve" });
        }
        const sha256 = createHash("sha256").update(reconstructed).digest("hex");

        const notes = await boundary.notes(contactId);
        const existingArtifact = latestPreservedExecutedArtifactForVersion(notes, opportunityId, agreementAt, version);
        const idempotency = evaluatePreservationIdempotency({
          existing: existingArtifact ? { opportunityId: existingArtifact.opportunityId, agreementAt: existingArtifact.agreementAt, version: existingArtifact.version, sha256: existingArtifact.sha256, byteCount: existingArtifact.byteCount } : null,
          newSha256: sha256, newByteCount: reconstructed.byteLength,
        });
        if (idempotency.kind === "conflict") {
          await safeCleanupSession(uploads, opportunityId, version, uploadId, session.receivedChunkIndexes);
          return json(409, { error: "A different executed artifact is already preserved for this exact contract version", existing: idempotency.existing });
        }
        if (idempotency.kind === "no_op_already_preserved") {
          // Gate-review closure, requirement 4 -- a hash/byte-count match
          // against the DURABLE METADATA's claim is not itself proof the
          // STORED BYTES still exist and are intact. Re-read and
          // re-verify before ever reporting this as preserved; if the
          // stored artifact is missing or corrupted, this is refused
          // (never silently re-trusted, never silently "healed" by
          // overwriting without saying so).
          try {
            await reverifyStoredArtifactBytes(artifacts, existingArtifact!.blobKey, existingArtifact!.sha256, existingArtifact!.byteCount);
          } catch (e: any) {
            return json(409, { error: "Durable metadata exists but the previously-stored artifact could not be independently re-verified: " + (e?.message ?? "unknown") });
          }
          await safeCleanupSession(uploads, opportunityId, version, uploadId, session.receivedChunkIndexes);
          return json(200, { preserved: true, alreadyPreserved: true, sha256, byteCount: reconstructed.byteLength, artifact: existingArtifact });
        }

        const aKey = artifactKey(opportunityId, version);
        await artifacts.set(aKey, reconstructed);
        // Re-read independently -- never trust the write call's own success alone.
        const readBack = await getWithConsistencyFallback(artifacts, aKey, "arrayBuffer");
        if (!readBack) throw new Error("Artifact write was not confirmed by readback");
        const readBackBuffer = Buffer.from(readBack);
        if (readBackBuffer.byteLength !== reconstructed.byteLength) throw new Error("Readback byte count differs from what was written");
        const readBackSha256 = createHash("sha256").update(readBackBuffer).digest("hex");
        if (readBackSha256 !== sha256) throw new Error("Readback SHA-256 differs from what was written");

        const pageCount = await countPdfPages(new Uint8Array(readBackBuffer));
        const nowIso = new Date().toISOString();
        const record = {
          opportunityId, at: nowIso, operator, agreementAt, version,
          originalFileName: session.originalFileName, byteCount: readBackBuffer.byteLength, sha256: readBackSha256,
          pageCount, providerDocumentId, uploadedAt: nowIso, blobKey: aKey,
        };
        // Gate-review closure, requirement 4 -- if THIS throws (network
        // error, or `boundary.note`'s own readback-mismatch check), the
        // blob bytes above are already durably stored, but NO durable
        // metadata note exists yet. `latestPreservedExecutedArtifactForOpportunity`
        // resolves ONLY from notes, never from blob existence alone, so
        // the system correctly does NOT consider this artifact preserved
        // until this call succeeds -- it falls through to the outer catch
        // below and reports failure, exactly as it must. A subsequent
        // retry safely reconciles: `artifacts.set` on the same
        // deterministic key is idempotent, and a fresh note write is
        // attempted again.
        await boundary.note(contactId, formatPreservedExecutedArtifactNote(record));

        // Cleanup happens AFTER the artifact is genuinely verified and
        // durably recorded -- its own failure must never mask that
        // already-achieved success (requirement 4).
        await safeCleanupSession(uploads, opportunityId, version, uploadId, session.receivedChunkIndexes);

        return json(200, { preserved: true, alreadyPreserved: false, sha256: readBackSha256, byteCount: readBackBuffer.byteLength, pageCount, artifact: record });
      } finally { await release(); }
    }

    if (phase === "download-chunk") {
      const { chunkIndex } = request;
      if (typeof chunkIndex !== "number" || !Number.isInteger(chunkIndex) || chunkIndex < 0) return json(400, { error: "Missing or invalid chunkIndex" });
      const notes = await boundary.notes(contactId);
      const existing = latestPreservedExecutedArtifactForVersion(notes, opportunityId, agreementAt, version);
      if (!existing) {
        return json(409, { error: "No preserved artifact exists for this exact opportunity/agreement/version" });
      }
      // Gate-review closure, requirement 4 -- "metadata exists but stored
      // bytes are missing or corrupted" must fail closed on the DOWNLOAD
      // path too, not only the stage-transition gate; Brad must never be
      // served silently-wrong bytes.
      let buffer: Buffer;
      try {
        buffer = await reverifyStoredArtifactBytes(artifacts, existing.blobKey, existing.sha256, existing.byteCount);
      } catch (e: any) {
        return json(409, { error: e?.message ?? "Preserved artifact could not be independently re-verified" });
      }
      const chunkCount = Math.ceil(buffer.byteLength / CHUNK_SIZE_BYTES);
      if (chunkIndex >= chunkCount) return json(400, { error: "chunkIndex is outside the artifact's chunk range" });
      const start = chunkIndex * CHUNK_SIZE_BYTES;
      const chunk = buffer.subarray(start, start + CHUNK_SIZE_BYTES);
      return json(200, { chunkIndex, chunkCount, totalByteCount: buffer.byteLength, sha256: existing.sha256, chunkBase64: chunk.toString("base64") });
    }

    return json(400, { error: "Unknown phase" });
  } catch (error) {
    logUploadFailure(phase, request?.uploadId, error);
    return json(409, { error: "Write refused or unconfirmed; refresh and inspect before retrying" });
  }
};
