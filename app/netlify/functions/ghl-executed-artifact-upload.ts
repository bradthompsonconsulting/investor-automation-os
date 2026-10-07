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
 * USES: "chunk" independently stores ONE self-describing chunk, keyed
 * deterministically, with no dependency on any other chunk having
 * arrived; "finalize" is the ONLY place completeness/consistency/
 * reassembly is ever judged -- it locates every expected chunk (with
 * bounded visibility handling for one not yet observable), reassembles
 * in order, verifies total bytes and the declared full SHA-256, and
 * records durable metadata only after that verification; "download-chunk"
 * is the Brad-only readback path (the SAME size ceiling applies to
 * responses, so download is chunked too); "abort" discovers and discards
 * a session's pending chunks (by listing its own key prefix, never a
 * manifest) without ever touching a verified final artifact.
 *
 * GATE-REVIEW CLOSURE -- PR #85 CHUNK-INGESTION REDESIGN. The prior
 * design required chunk N to read a shared "manifest" object chunk N-1
 * had just written, in a SEPARATE Lambda invocation -- a genuine,
 * reproduced race against Netlify Blobs' own eventual consistency that
 * a bounded read retry alone did not reliably close. This redesign
 * removes that dependency structurally: every chunk request carries its
 * own complete, immutable description of the upload it belongs to
 * (opportunity/version identity, upload id, chunk index/count, total
 * byte count, filename, and the FULL file's expected SHA-256 -- computed
 * by the client, from the same local selection already shown to the
 * operator, before any chunk is sent) and is evaluated and stored purely
 * against whatever (if anything) already exists at its OWN deterministic
 * key. No chunk request ever reads any OTHER chunk's data. Completeness
 * and cross-chunk consistency are judged exactly once, at finalize.
 *
 * NEVER A CALLER-CONTROLLED BLOB KEY. Every blob key here is derived
 * server-side from `opportunityId` + `contractVersionStorageKey(version)`
 * (+ `uploadId` for pending sessions) -- never accepted as a raw client
 * input, per the Product Owner's explicit ruling.
 */

import { createHash } from "node:crypto";
import { requireAppWriter } from "./lib/app-write-auth";
import { requireAppWriteOrigin } from "./lib/app-write-origin";
import { digest } from "./lib/ghl-write-boundary";
import { VerifiedStore, UPLOADS_STORE, ARTIFACTS_STORE } from "./lib/verified-store";
import { legacyEventFrom, toResponse, echoedActivation, type LambdaResult, type LegacyEvent } from "./lib/modern-runtime";
import { invocation, boundaryFor, refusalResult, sessionCapabilityBranch, withLockWarning, type Invocation } from "./lib/endpoint-kit";
import { WriteRefused } from "./lib/write-gate";
import { acquireLock, lockKey, LockHeld, LockUnknown } from "./lib/contact-lock-v2";
import { getConfig } from "../../shared/ghl-config";
import { evaluateProductionArtifactUploadScope, evaluateProductionArtifactContactScope, PRODUCTION_WRITE_SCOPE_REFUSAL } from "./lib/production-write-scope";
import { isSameContractVersion, type ContractVersionIdentity } from "../../src/lib/board9-contract-model";
import { looksLikePdfContent, countPdfPages } from "../../src/lib/contract-execution-model";
import {
  evaluateChunkAcceptance, evaluateFinalizeReadiness, evaluatePreservationIdempotency,
  contractVersionStorageKey, CHUNK_SIZE_BYTES, type ChunkRecordMetadata,
} from "../../src/lib/contract-executed-artifact-storage-model";
import {
  formatPreservedExecutedArtifactNote, latestPreservedExecutedArtifactForVersion,
} from "../../src/lib/contract-executed-artifact-carriers";

const json = (statusCode: number, data: unknown): LambdaResult => ({ statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(data) });

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
function chunkKey(opportunityId: string, version: ContractVersionIdentity, uploadId: string, chunkIndex: number) {
  return `${sessionScope(opportunityId, version, uploadId)}/chunk-${chunkIndex}`;
}
function artifactKey(opportunityId: string, version: ContractVersionIdentity) {
  return `${opportunityId}/${contractVersionStorageKey(version)}.pdf`;
}

/**
 * Gate-review closure -- PR #85 chunk-ingestion redesign, requirements
 * 3-7, as corrected by the storage correction (plan v6 §2): every chunk and
 * artifact read is STRONG through the verified adapter (the silent
 * eventual-read fallback is removed; an unavailable strong read fails
 * closed). The short, bounded finalize retry is kept for a chunk finalize
 * genuinely expects to already be visible.
 */
const CHUNK_READ_RETRY_DELAYS_MS = [50, 150, 300];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ChunkRead = { data: ArrayBuffer; metadata: ChunkRecordMetadata };

async function getChunkOnce(uploads: VerifiedStore, key: string): Promise<ChunkRead | null> {
  const result = await uploads.readBinary(key);
  if (!result) return null;
  return { data: result.data, metadata: result.metadata as unknown as ChunkRecordMetadata };
}

/** Bounded retry -- only used at finalize, which genuinely expects every chunk to already exist. A chunk request evaluating its OWN key never needs this: a chunk index being written for the first time correctly finds nothing. */
async function getChunkWithRetry(uploads: VerifiedStore, key: string): Promise<ChunkRead | null> {
  let result = await getChunkOnce(uploads, key);
  if (result !== null) return result;
  for (const waitMs of CHUNK_READ_RETRY_DELAYS_MS) {
    await delay(waitMs);
    result = await getChunkOnce(uploads, key);
    if (result !== null) return result;
  }
  return result;
}

async function getMetadataOnly(uploads: VerifiedStore, key: string): Promise<ChunkRecordMetadata | null> {
  const result = await uploads.readMeta(key);
  return result ? (result.metadata as unknown as ChunkRecordMetadata) : null;
}

/**
 * Gate-review closure, requirement 3 -- every chunk this uploadId has
 * ever stored is discovered by LISTING its own deterministic key prefix,
 * never by reading a shared manifest object. Used for both the "which
 * chunks actually exist" finalize step and for abort's own bounded
 * cleanup. A listing failure is logged and treated as "nothing found" --
 * never thrown, never blocks a genuine finalize/abort outcome the caller
 * already reached some other way.
 */
async function listSessionChunkKeys(uploads: VerifiedStore, opportunityId: string, version: ContractVersionIdentity, uploadId: string): Promise<string[]> {
  try {
    return await uploads.list(`${sessionScope(opportunityId, version, uploadId)}/chunk-`);
  } catch (e) {
    console.error("[ghl-executed-artifact-upload] session chunk listing failed (non-fatal)");
    return [];
  }
}

/**
 * Gate-review closure, requirement 4 (prior repair) -- housekeeping
 * cleanup NEVER masks a result the caller already determined (a genuine
 * success or a genuine conflict refusal). A transient failure discarding a
 * pending chunk after that determination is logged and swallowed, never
 * allowed to turn an already-correct response into a false failure.
 */
async function cleanupSessionChunks(uploads: VerifiedStore, opportunityId: string, version: ContractVersionIdentity, uploadId: string): Promise<void> {
  const keys = await listSessionChunkKeys(uploads, opportunityId, version, uploadId);
  for (const key of keys) {
    if (!(await uploads.discardPendingChunk(key))) console.error("[ghl-executed-artifact-upload] chunk cleanup failed (non-fatal)");
  }
}

/**
 * Gate-review closure, requirement 4 (prior repair) -- "metadata exists
 * but stored bytes are missing or corrupted" must never be treated as a
 * verified preserved artifact by ANY code path that reads the artifact
 * back, not only the stage-transition gate. Re-reads the stored bytes
 * (strongly) and independently recomputes SHA-256/byte-count against the
 * durable metadata's own claim.
 */
async function reverifyStoredArtifactBytes(artifacts: VerifiedStore, blobKey: string, expectedSha256: string, expectedByteCount: number): Promise<Buffer> {
  const raw = await artifacts.readBinary(blobKey);
  if (!raw) throw new Error("Preserved artifact metadata exists but its stored bytes could not be read");
  const buffer = Buffer.from(raw.data);
  if (buffer.byteLength !== expectedByteCount) throw new Error("Stored artifact byte count no longer matches its durable metadata -- refusing to treat it as verified");
  if (createHash("sha256").update(buffer).digest("hex") !== expectedSha256) throw new Error("Stored artifact hash no longer matches its durable metadata -- refusing to treat it as verified");
  return buffer;
}

/**
 * Storage correction (plan v6 §5, §7): modern runtime. Every phase that
 * writes passes the write gate (published production deploy, captured and
 * echoed activation, kill switch); finalize additionally passes G5 and the
 * legacy block for its GHL note and runs under its own budget row (T_dispatch
 * 8 s, GHL timeout 12 s). Chunk and artifact bytes are written by conditional
 * create and read back strongly.
 */
export default async (req: Request, context: any): Promise<Response> => {
  const event = await legacyEventFrom(req, { requireJson: true });
  // Finalize has its own budget row; the phase is known only after parsing, so peek.
  let finalize = false;
  try { finalize = !event.isBase64Encoded && JSON.parse(event.body ?? "null")?.phase === "finalize"; } catch { finalize = false; }
  const inv = invocation(finalize ? "ghl-executed-artifact-upload:finalize" : "ghl-executed-artifact-upload", context);
  let header: Record<string, string> | undefined;
  try {
    const r = await handle(event, inv, (h) => { header = { "X-IAOS-Storage": h }; });
    return toResponse(r, header);
  } finally { inv.scope.close(); }
};

async function handle(event: LegacyEvent, inv: Invocation, setStorageHeader: (h: string) => void): Promise<LambdaResult> {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  let operator: string;
  try { operator = requireAppWriter(event); } catch { return json(401, { error: "Application write sign-in required" }); }
  try { requireAppWriteOrigin(event); } catch { return json(403, { error: "Application write origin refused" }); }
  const cap = await sessionCapabilityBranch(event, inv);
  if (cap) { if (cap.header) setStorageHeader(cap.header); return cap.result; }

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

  // INV-98 Board #9 Production proof write scope -- before any Blob store,
  // or any GHL call. Test deployments are unaffected.
  const config = inv.config;
  const scope = evaluateProductionArtifactUploadScope(config, opportunityId);
  if (!scope.ok) return json(403, { error: "Production write refused by the proof write scope", by: PRODUCTION_WRITE_SCOPE_REFUSAL, code: scope.code });

  try {
    // Every phase that stores or sends passes the write gate first (download-chunk only reads).
    if (phase !== "download-chunk") await inv.gate.enter(echoedActivation(event));
    const uploads = new VerifiedStore(inv.scope, UPLOADS_STORE);
    const artifacts = new VerifiedStore(inv.scope, ARTIFACTS_STORE);
    const boundary = boundaryFor(inv);
    const opportunity = await boundary.opportunity(opportunityId);
    const contactId = opportunity.contactId;
    // Defense in depth, still before any Blob read or write: the pinned
    // opportunity must still belong to the pinned contact.
    const contactScope = evaluateProductionArtifactContactScope(config, contactId);
    if (!contactScope.ok) return json(403, { error: "Production write refused by the proof write scope", by: PRODUCTION_WRITE_SCOPE_REFUSAL, code: contactScope.code });

    if (phase === "chunk") {
      // Gate-review closure, requirement 1-2/7 -- each chunk is evaluated
      // and stored ENTIRELY independently, against only its OWN
      // deterministic key -- never a shared manifest, never an
      // in-process lock, never any expectation about which OTHER chunks
      // have arrived or in what order.
      const { uploadId, chunkIndex, chunkCount, totalByteCount, originalFileName, expectedFullSha256, chunkBase64 } = request;
      if (
        typeof uploadId !== "string" || typeof chunkIndex !== "number" || typeof chunkCount !== "number" ||
        typeof totalByteCount !== "number" || typeof originalFileName !== "string" ||
        typeof expectedFullSha256 !== "string" || typeof chunkBase64 !== "string"
      ) {
        return json(400, { error: "Missing or invalid chunk fields" });
      }
      let chunkBytes: Buffer;
      try { chunkBytes = Buffer.from(chunkBase64, "base64"); } catch { return json(400, { error: "chunkBase64 is not valid base64" }); }
      const chunkSha256 = createHash("sha256").update(chunkBytes).digest("hex");

      const cKey = chunkKey(opportunityId, version, uploadId, chunkIndex);
      const existingChunk = await getMetadataOnly(uploads, cKey);
      const evaluation = evaluateChunkAcceptance({
        incoming: { opportunityId, agreementAt, version, uploadId, chunkIndex, chunkCount, totalByteCount, originalFileName, expectedFullSha256, chunkByteLength: chunkBytes.byteLength, chunkSha256 },
        isSameVersion: isSameContractVersion,
        existingChunk,
      });
      if (!evaluation.ok) {
        // Gate-review closure, requirement 2 -- a safe reason code
        // (structural, never bytes/tokens/PII) reaches both the
        // diagnostic log and the client's own error display.
        logUploadFailure(phase, uploadId, new Error("Chunk refused: " + evaluation.reasons.map((r) => r.code).join(", ")));
        return json(409, { error: "Chunk refused", reasons: evaluation.reasons });
      }
      if (evaluation.kind === "duplicate_identical") {
        // An ordinary retry of the same bytes and metadata -- already stored, never re-stored, never an error.
        return json(200, { accepted: true, duplicate: true });
      }

      const metadata: ChunkRecordMetadata = { opportunityId, agreementAt, version, uploadId, chunkCount, totalByteCount, originalFileName, expectedFullSha256, chunkSha256 };
      const stored = await uploads.createBinaryOnce(cKey, chunkBytes, metadata as any);
      if (stored.result === "conflict") {
        // Another request stored this chunk index first: identical metadata is a duplicate, anything else a refusal.
        const now = await getMetadataOnly(uploads, cKey);
        if (now && JSON.stringify(now) === JSON.stringify(metadata)) return json(200, { accepted: true, duplicate: true });
        return json(409, { error: "Chunk refused", reasons: [{ code: "CHUNK_CONFLICT" }] });
      }
      return json(200, { accepted: true, duplicate: false });
    }

    if (phase === "abort") {
      const { uploadId } = request;
      if (typeof uploadId !== "string") return json(400, { error: "Missing uploadId" });
      await cleanupSessionChunks(uploads, opportunityId, version, uploadId);
      return json(200, { aborted: true });
    }

    if (phase === "finalize") {
      // Gate-review closure, requirement 5-6 -- finalization, and ONLY
      // finalization, ever judges completeness and cross-chunk
      // consistency. Every chunk is located independently (with bounded
      // visibility handling for one not yet observable); a genuinely
      // missing chunk returns a safe, specific reason and creates no
      // receipt.
      const { uploadId, providerDocumentId, chunkCount, totalByteCount, originalFileName, expectedFullSha256 } = request;
      if (
        typeof uploadId !== "string" || typeof providerDocumentId !== "string" || providerDocumentId.trim() === "" ||
        typeof chunkCount !== "number" || typeof totalByteCount !== "number" ||
        typeof originalFileName !== "string" || typeof expectedFullSha256 !== "string"
      ) {
        return json(400, { error: "Missing uploadId/providerDocumentId/chunkCount/totalByteCount/originalFileName/expectedFullSha256" });
      }
      await inv.gate.checkSubject(`contact:${contactId}`, ["executed_artifact", "note"]);
      let lock;
      try { lock = await acquireLock(inv.store, inv.scope, lockKey(inv.env, config.locationId, contactId), { opId: null, deployId: inv.deploy.id! }); }
      catch (e) {
        if (e instanceof LockHeld || e instanceof LockUnknown) return json(409, { error: "Write refused or unconfirmed; refresh and inspect before retrying" });
        throw e;
      }
      let finalized: LambdaResult;
      try { finalized = await (async (): Promise<LambdaResult> => {
        const reads: (ChunkRead | null)[] = [];
        for (let i = 0; i < chunkCount; i++) {
          reads.push(await getChunkWithRetry(uploads, chunkKey(opportunityId, version, uploadId, i)));
        }
        const foundChunks = reads
          .map((r, chunkIndex) => (r ? { chunkIndex, ...r.metadata } : null))
          .filter((r): r is { chunkIndex: number } & ChunkRecordMetadata => r !== null);

        const readiness = evaluateFinalizeReadiness({
          expected: { opportunityId, agreementAt, version, chunkCount, totalByteCount, originalFileName, expectedFullSha256 },
          isSameVersion: isSameContractVersion,
          foundChunks,
        });
        if (!readiness.ok) {
          logUploadFailure(phase, uploadId, new Error("Not all chunks visible: " + readiness.reasons.map((r) => r.code).join(", ")));
          return json(409, { error: "Not all chunks received", reasons: readiness.reasons });
        }

        const parts = reads.map((r) => Buffer.from(r!.data)); // readiness.ok guarantees every entry is non-null
        const reconstructed = Buffer.concat(parts);
        if (reconstructed.byteLength !== totalByteCount) {
          return json(409, { error: "Reconstructed byte count does not match the declared total -- refusing to preserve" });
        }
        const sha256 = createHash("sha256").update(reconstructed).digest("hex");
        if (sha256 !== expectedFullSha256) {
          return json(409, { error: "Reconstructed SHA-256 does not match the declared expected hash -- refusing to preserve" });
        }
        if (!looksLikePdfContent(new Uint8Array(reconstructed))) {
          return json(409, { error: "Reconstructed bytes do not look like a PDF -- refusing to preserve" });
        }

        const notes = await boundary.notes(contactId);
        const existingArtifact = latestPreservedExecutedArtifactForVersion(notes, opportunityId, agreementAt, version);
        const idempotency = evaluatePreservationIdempotency({
          existing: existingArtifact ? { opportunityId: existingArtifact.opportunityId, agreementAt: existingArtifact.agreementAt, version: existingArtifact.version, sha256: existingArtifact.sha256, byteCount: existingArtifact.byteCount } : null,
          newSha256: sha256, newByteCount: reconstructed.byteLength,
        });
        if (idempotency.kind === "conflict") {
          await cleanupSessionChunks(uploads, opportunityId, version, uploadId);
          return json(409, { error: "A different executed artifact is already preserved for this exact contract version", existing: idempotency.existing });
        }
        if (idempotency.kind === "no_op_already_preserved") {
          // Gate-review closure, requirement 4 (prior repair) -- a
          // hash/byte-count match against the DURABLE METADATA's claim
          // is not itself proof the STORED BYTES still exist and are
          // intact. Re-read and re-verify before ever reporting this as
          // preserved.
          try {
            await reverifyStoredArtifactBytes(artifacts, existingArtifact!.blobKey, existingArtifact!.sha256, existingArtifact!.byteCount);
          } catch (e: any) {
            return json(409, { error: "Durable metadata exists but the previously-stored artifact could not be independently re-verified: " + (e?.message ?? "unknown") });
          }
          await cleanupSessionChunks(uploads, opportunityId, version, uploadId);
          return json(200, { preserved: true, alreadyPreserved: true, sha256, byteCount: reconstructed.byteLength, artifact: existingArtifact });
        }

        const aKey = artifactKey(opportunityId, version);
        // Conditional create: a retry finds the same bytes already stored (verified below); different bytes are refused.
        try { await artifacts.createBinaryOnce(aKey, reconstructed, {}); } catch { /* verified by the strong readback below */ }
        // Re-read independently (strong) -- never trust the write call's own success alone.
        const readBackRec = await artifacts.readBinary(aKey);
        if (!readBackRec) throw new Error("Artifact write was not confirmed by readback");
        const readBackBuffer = Buffer.from(readBackRec.data);
        if (readBackBuffer.byteLength !== reconstructed.byteLength) throw new Error("Readback byte count differs from what was written");
        const readBackSha256 = createHash("sha256").update(readBackBuffer).digest("hex");
        if (readBackSha256 !== sha256) throw new Error("Readback SHA-256 differs from what was written");

        const pageCount = await countPdfPages(new Uint8Array(readBackBuffer));
        const nowIso = new Date().toISOString();
        const record = {
          opportunityId, at: nowIso, operator, agreementAt, version,
          originalFileName, byteCount: readBackBuffer.byteLength, sha256: readBackSha256,
          pageCount, providerDocumentId, uploadedAt: nowIso, blobKey: aKey,
        };
        // Gate-review closure, requirement 4 (prior repair) -- if THIS
        // throws (network error, or `boundary.note`'s own readback-
        // mismatch check), the blob bytes above are already durably
        // stored, but NO durable metadata note exists yet.
        // `latestPreservedExecutedArtifactForVersion` resolves ONLY from
        // notes, never from blob existence alone, so the system
        // correctly does NOT consider this artifact preserved until this
        // call succeeds. A subsequent retry safely reconciles:
        // `artifacts.set` on the same deterministic key is idempotent,
        // and a fresh note write is attempted again.
        await boundary.note(contactId, formatPreservedExecutedArtifactNote(record), undefined, { requestId: `v2-art-${digest(`${opportunityId}:${uploadId}:${readBackSha256}`).slice(0, 40)}`, opId: "-", attemptId: "-" }, ["executed_artifact"]);

        // Cleanup happens AFTER the artifact is genuinely verified and
        // durably recorded -- its own failure must never mask that
        // already-achieved success.
        await cleanupSessionChunks(uploads, opportunityId, version, uploadId);

        return json(200, { preserved: true, alreadyPreserved: false, sha256: readBackSha256, byteCount: readBackBuffer.byteLength, pageCount, artifact: record });
      })(); }
      catch (e) { await lock.release(); throw e; }
      return withLockWarning(finalized, await lock.release());
    }

    if (phase === "download-chunk") {
      const { chunkIndex } = request;
      if (typeof chunkIndex !== "number" || !Number.isInteger(chunkIndex) || chunkIndex < 0) return json(400, { error: "Missing or invalid chunkIndex" });
      const notes = await boundary.notes(contactId);
      const existing = latestPreservedExecutedArtifactForVersion(notes, opportunityId, agreementAt, version);
      if (!existing) {
        return json(409, { error: "No preserved artifact exists for this exact opportunity/agreement/version" });
      }
      // Gate-review closure, requirement 4 (prior repair) -- "metadata
      // exists but stored bytes are missing or corrupted" must fail
      // closed on the DOWNLOAD path too, not only the stage-transition
      // gate; Brad must never be served silently-wrong bytes.
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
    if (error instanceof WriteRefused) return refusalResult(error);
    logUploadFailure(phase, request?.uploadId, error);
    return json(409, { error: "Write refused or unconfirmed; refresh and inspect before retrying" });
  }
}
