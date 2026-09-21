/**
 * Board #9 Phase B (B9-13) -- the durable record of a preserved executed
 * PDF. This note carries METADATA ONLY -- never the bytes themselves,
 * which live in the permanent Netlify Blobs store keyed by
 * `contractVersionStorageKey` (`contract-executed-artifact-storage-model.ts`).
 * `blobKey` is recorded here as an already-server-derived fact, never a
 * caller-controlled input -- see that module's own header.
 *
 * Same carrier convention as every other Board #9 ledger note: a fixed
 * HEADER line, exact positional labels, round-trip byte-exact, `null`
 * only where a real "not applicable" sentinel is used (never a blank
 * string standing in for null).
 */

import { type ContractVersionIdentity, isSameContractVersion } from "./board9-contract-model";

export const EXECUTED_ARTIFACT_LEDGER_VERSION = "iaos-executed-artifact-v1" as const;
const HEADER = `IAOS EXECUTED ARTIFACT — ${EXECUTED_ARTIFACT_LEDGER_VERSION}`;
const LABELS = [
  "Recorded at", "Operator", "Opportunity", "Agreement at", "Version",
  "Original filename", "Byte count", "SHA-256", "Page count",
  "Provider document id", "Uploaded at", "Blob key",
] as const;

export type PreservedExecutedArtifact = {
  opportunityId: string;
  at: string;
  operator: string | null;
  agreementAt: string;
  version: ContractVersionIdentity;
  originalFileName: string;
  byteCount: number;
  sha256: string;
  /** `null` only when page counting genuinely could not run against the reconstructed bytes -- never fabricated. */
  pageCount: number | null;
  providerDocumentId: string;
  uploadedAt: string;
  blobKey: string;
};

function isValidIsoInstant(at: string): boolean {
  return Number.isFinite(new Date(at).getTime());
}

export function formatPreservedExecutedArtifactNote(args: PreservedExecutedArtifact): string {
  return [
    HEADER,
    `${LABELS[0]}: ${args.at}`,
    `${LABELS[1]}: ${args.operator ?? "UNAVAILABLE"}`,
    `${LABELS[2]}: ${args.opportunityId}`,
    `${LABELS[3]}: ${args.agreementAt}`,
    `${LABELS[4]}: ${JSON.stringify(args.version)}`,
    `${LABELS[5]}: ${args.originalFileName}`,
    `${LABELS[6]}: ${args.byteCount}`,
    `${LABELS[7]}: ${args.sha256}`,
    `${LABELS[8]}: ${args.pageCount === null ? "UNAVAILABLE" : args.pageCount}`,
    `${LABELS[9]}: ${args.providerDocumentId}`,
    `${LABELS[10]}: ${args.uploadedAt}`,
    `${LABELS[11]}: ${args.blobKey}`,
  ].join("\n");
}

/** Returns `null` for any note that is not a well-formed, exact-shape executed-artifact note -- never a partial/best-effort parse. */
export function parsePreservedExecutedArtifactNote(body: string): PreservedExecutedArtifact | null {
  if (typeof body !== "string") return null;
  const lines = body.split("\n");
  if (lines.length !== 1 + LABELS.length) return null;
  if (lines[0] !== HEADER) return null;
  const line = (idx: number): string | null => {
    const raw = lines[1 + idx];
    const prefix = `${LABELS[idx]}: `;
    if (!raw.startsWith(prefix)) return null;
    return raw.slice(prefix.length);
  };
  const at = line(0);
  const operatorRaw = line(1);
  const opportunityId = line(2);
  const agreementAt = line(3);
  const versionRaw = line(4);
  const originalFileName = line(5);
  const byteCountRaw = line(6);
  const sha256 = line(7);
  const pageCountRaw = line(8);
  const providerDocumentId = line(9);
  const uploadedAt = line(10);
  const blobKey = line(11);
  if (
    at === null || operatorRaw === null || opportunityId === null || agreementAt === null || versionRaw === null ||
    originalFileName === null || byteCountRaw === null || sha256 === null || pageCountRaw === null ||
    providerDocumentId === null || uploadedAt === null || blobKey === null
  ) return null;
  if (!isValidIsoInstant(at) || !isValidIsoInstant(agreementAt) || !isValidIsoInstant(uploadedAt)) return null;
  if (opportunityId === "" || originalFileName === "" || providerDocumentId === "" || blobKey === "") return null;
  if (!/^[0-9a-fA-F]{64}$/.test(sha256)) return null;
  const byteCount = Number(byteCountRaw);
  if (!Number.isInteger(byteCount) || byteCount <= 0 || String(byteCount) !== byteCountRaw) return null;
  let version: ContractVersionIdentity;
  try {
    const parsed = JSON.parse(versionRaw);
    if (typeof parsed !== "object" || parsed === null || typeof parsed.agreementAt !== "string" || typeof parsed.versionSeq !== "number") return null;
    version = parsed;
  } catch { return null; }
  let pageCount: number | null = null;
  if (pageCountRaw !== "UNAVAILABLE") {
    pageCount = Number(pageCountRaw);
    if (!Number.isInteger(pageCount) || pageCount <= 0 || String(pageCount) !== pageCountRaw) return null;
  }
  const operator = operatorRaw === "UNAVAILABLE" ? null : operatorRaw;
  return { opportunityId, at, operator, agreementAt, version, originalFileName, byteCount, sha256, pageCount, providerDocumentId, uploadedAt, blobKey };
}

/** Latest-by-`at` valid record for this exact opportunity -- same resolution rule as every other Board #9 carrier's `latest*ForOpportunity`. */
export function latestPreservedExecutedArtifactForOpportunity(notes: { body: string }[], opportunityId: string): PreservedExecutedArtifact | null {
  let latest: PreservedExecutedArtifact | null = null;
  for (const note of notes) {
    const parsed = parsePreservedExecutedArtifactNote(note.body);
    if (!parsed || parsed.opportunityId !== opportunityId) continue;
    if (!latest || new Date(parsed.at).getTime() > new Date(latest.at).getTime()) latest = parsed;
  }
  return latest;
}

/**
 * Every valid preserved-artifact record for this opportunity, across
 * every contract version it has ever carried -- gate-review closure.
 * `latestPreservedExecutedArtifactForOpportunity` resolves the single
 * most-recent-by-`at` record for an opportunity REGARDLESS of version,
 * which is correct for "what does Brad see right now" display but WRONG
 * for any caller that must compare against the record for one EXACT
 * version (finalize's own idempotency check, the stage-transition
 * re-verification, download-chunk) -- a later artifact preserved for a
 * DIFFERENT version must never shadow or be mistaken for an earlier
 * version's own artifact. Callers needing an exact-version match should
 * filter this array themselves (matching `agreementAt` and comparing
 * `version` via `isSameContractVersion`), never rely on "latest" alone.
 */
export function allPreservedExecutedArtifactsForOpportunity(notes: { body: string }[], opportunityId: string): PreservedExecutedArtifact[] {
  const out: PreservedExecutedArtifact[] = [];
  for (const note of notes) {
    const parsed = parsePreservedExecutedArtifactNote(note.body);
    if (parsed && parsed.opportunityId === opportunityId) out.push(parsed);
  }
  return out;
}

/**
 * The latest-by-`at` preserved-artifact record matching this EXACT
 * opportunity/agreement/version -- the correct resolver for every caller
 * that must compare against or read back "the artifact for this specific
 * contract version," never "whatever is latest for the opportunity."
 */
export function latestPreservedExecutedArtifactForVersion(
  notes: { body: string }[],
  opportunityId: string,
  agreementAt: string,
  version: ContractVersionIdentity,
): PreservedExecutedArtifact | null {
  let latest: PreservedExecutedArtifact | null = null;
  for (const record of allPreservedExecutedArtifactsForOpportunity(notes, opportunityId)) {
    if (record.agreementAt !== agreementAt || !isSameContractVersion(record.version, version)) continue;
    if (!latest || new Date(record.at).getTime() > new Date(latest.at).getTime()) latest = record;
  }
  return latest;
}
