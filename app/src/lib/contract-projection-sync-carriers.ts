/**
 * Contract Draft Request sync -- append-only, two-phase attempt/resolution
 * audit evidence, INV-67 / B9-12 contract-population repair.
 *
 * Pure. No I/O, no React. Formats/parses `contract-draft-request-model.ts`'s
 * `ContractDraftRequestSyncRecord` -- ONE shape, reused across the
 * "in_progress" attempt note and the terminal resolution note for the SAME
 * `attemptId`, exactly `contract-send-carriers.ts`'s own established
 * pattern for Contract Sent (`ParsedContractSend`, `formatContractSendNote`,
 * `latestContractSendForOpportunity`'s rank-then-latest-attempt reader) --
 * reused by direct mirroring, not reinvented. The write itself is
 * `ghl.notes.create()` (AGENTS.md's three sanctioned writes); this module
 * only formats/parses the note body.
 *
 * JESS GATE CORRECTION (this session) -- AUDIT ORDERING. The prior version of
 * this module recorded ONE post-hoc note, after "Requested" was already
 * written, best-effort. Corrected: the "in_progress" note is now durable
 * evidence written and confirmed BEFORE the "Requested" PUT is ever
 * attempted (`contract-draft-request-model.ts`'s own header explains why),
 * and a SEPARATE terminal resolution note, bound to the same `attemptId`,
 * records the actual outcome -- `"accepted"`, `"failed"` (the PUT itself
 * never landed), or `"indeterminate"` (the PUT succeeded but its own
 * readback, or this resolution note itself, could not be confirmed -- a
 * draft may have been triggered and this must never be silently treated as
 * either success or safe-to-retry).
 *
 * BOUND TO THE EXACT `ContractVersionIdentity`. Both notes for one attempt
 * name the exact `agreementAt`/`versionSeq` the projection plan was built
 * from (`isSameContractVersion`, reused verbatim, no second version-equality
 * check).
 */

import { type ContractVersionIdentity, isSameContractVersion } from "./board9-contract-model";
import type { ContractProjectionFieldKey } from "./contract-ghl-projection-model";
import type { ContractDraftRequestSyncRecord, ContractDraftRequestSyncStatus, ContractDraftRequestState } from "./contract-draft-request-model";
import { validateSellerSigningAuditEvidenceValue } from "./contract-seller-signing-model";

/* ------------------------------------------------------------------ */
/* Shared helpers -- same idiom every existing carrier file repeats    */
/* ------------------------------------------------------------------ */

function ledgerValue(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "UNAVAILABLE" : String(value);
}

function ledgerBooleanValue(value: boolean | null | undefined): string {
  return value === null || value === undefined ? "UNAVAILABLE" : value ? "true" : "false";
}

function isCanonicalIsoTimestamp(at: string): boolean {
  const ms = new Date(at).getTime();
  if (!Number.isFinite(ms)) return false;
  return new Date(ms).toISOString() === at;
}

function matchPositionalSchema(body: string, header: string, labels: readonly string[]): string[] | null {
  if (typeof body !== "string") return null;
  const lines = body.split("\n");
  if (lines.length !== 1 + labels.length) return null;
  if (lines[0] !== header) return null;
  const values: string[] = [];
  for (let i = 0; i < labels.length; i++) {
    const line = lines[i + 1];
    const prefix = labels[i] + ": ";
    if (!line.startsWith(prefix)) return null;
    values.push(line.slice(prefix.length));
  }
  return values;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function safeJsonParse(raw: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

const VERSION_KEYS = ["agreementAt", "versionSeq", "supersedesVersionSeq", "replacesAgreementAt"] as const;
function formatVersionJson(v: ContractVersionIdentity): string {
  return JSON.stringify(v);
}
function parseVersionJson(raw: string): ContractVersionIdentity | null {
  const parsed = safeJsonParse(raw);
  if (!parsed.ok || !isPlainObject(parsed.value)) return null;
  const v = parsed.value;
  const vKeys = Object.keys(v);
  if (vKeys.length !== VERSION_KEYS.length || !VERSION_KEYS.every((k) => vKeys.includes(k))) return null;
  if (typeof v.agreementAt !== "string" || !isCanonicalIsoTimestamp(v.agreementAt)) return null;
  if (typeof v.versionSeq !== "number" || !Number.isInteger(v.versionSeq) || v.versionSeq < 1) return null;
  if (v.supersedesVersionSeq !== null && (typeof v.supersedesVersionSeq !== "number" || !Number.isInteger(v.supersedesVersionSeq))) return null;
  if (v.replacesAgreementAt !== null && typeof v.replacesAgreementAt !== "string") return null;
  return {
    agreementAt: v.agreementAt,
    versionSeq: v.versionSeq,
    supersedesVersionSeq: v.supersedesVersionSeq as number | null,
    replacesAgreementAt: v.replacesAgreementAt as string | null,
  };
}

/* ==================================================================== */
/* The ledger                                                           */
/* ==================================================================== */

/** Pending is never terminal and is always superseded by ANY later note for the same attemptId -- see `latestContractDraftRequestSyncForOpportunity`. Mirrors `contract-send-carriers.ts`'s identical PENDING_RANK/TERMINAL_STATUSES split. */
const PENDING_RANK: Record<string, number> = { in_progress: 0 };
const TERMINAL_STATUSES = new Set<ContractDraftRequestSyncStatus>(["accepted", "failed", "indeterminate"]);

/**
 * v2 -> v3 (INV-67 Phase 1 Jess re-gate correction, this session): adds
 * "Seller signing evidence" as a seventeenth positional field, JSON-
 * encoded exactly like "Version" already is. A v2 note (none exist in any
 * live GHL environment yet -- Contract Draft Request remains sentinel-
 * filled in both Test and Production) simply fails this version's header
 * match and parses as `null`, matching this ledger's own established
 * schema-bump precedent.
 */
export const CONTRACT_PROJECTION_SYNC_LEDGER_VERSION = "iaos-contract-draft-request-sync-v3" as const;
const HEADER = `IAOS CONTRACT DRAFT REQUEST SYNC — ${CONTRACT_PROJECTION_SYNC_LEDGER_VERSION}`;
const LABELS = [
  "Recorded at",
  "Operator",
  "Opportunity",
  "Attempt id",
  "Status",
  "Version",
  "Entries attempted",
  "Entries landed",
  "Failed keys",
  "Current offer cross-check ok",
  "Observed state before write",
  "Intended to state",
  "Sent value",
  "Observed value",
  "Provider status",
  "Failure reason",
  "Seller signing evidence",
] as const;

export function formatContractProjectionSyncNote(record: ContractDraftRequestSyncRecord): string {
  return [
    HEADER,
    `${LABELS[0]}: ${record.at}`,
    `${LABELS[1]}: ${ledgerValue(record.operator)}`,
    `${LABELS[2]}: ${record.opportunityId}`,
    `${LABELS[3]}: ${record.attemptId}`,
    `${LABELS[4]}: ${record.status}`,
    `${LABELS[5]}: ${formatVersionJson(record.version)}`,
    `${LABELS[6]}: ${record.entriesAttempted}`,
    `${LABELS[7]}: ${record.entriesLanded}`,
    `${LABELS[8]}: ${JSON.stringify(record.failedKeys)}`,
    `${LABELS[9]}: ${ledgerBooleanValue(record.currentOfferCrossCheckOk)}`,
    `${LABELS[10]}: ${record.observedStateBeforeWrite}`,
    `${LABELS[11]}: ${record.intendedToState}`,
    `${LABELS[12]}: ${ledgerValue(record.sentValue)}`,
    `${LABELS[13]}: ${ledgerValue(record.observedValue)}`,
    `${LABELS[14]}: ${ledgerValue(record.providerStatus)}`,
    `${LABELS[15]}: ${ledgerValue(record.failureReason)}`,
    `${LABELS[16]}: ${JSON.stringify(record.sellerSigningEvidence)}`,
  ].join("\n");
}

export function parseContractProjectionSyncNote(body: string): ContractDraftRequestSyncRecord | null {
  const values = matchPositionalSchema(body, HEADER, LABELS);
  if (!values) return null;
  const [
    at, operatorRaw, opportunityId, attemptId, statusRaw, versionRaw,
    entriesAttemptedRaw, entriesLandedRaw, failedKeysRaw, currentOfferCrossCheckOkRaw,
    observedStateBeforeWriteRaw, intendedToStateRaw, sentValueRaw, observedValueRaw,
    providerStatusRaw, failureReasonRaw, sellerSigningEvidenceRaw,
  ] = values;

  if (!isCanonicalIsoTimestamp(at)) return null;
  if (!isCanonicalIsoTimestamp(attemptId)) return null;
  if (opportunityId === "") return null;
  if (statusRaw !== "in_progress" && statusRaw !== "accepted" && statusRaw !== "failed" && statusRaw !== "indeterminate") return null;
  const status = statusRaw as ContractDraftRequestSyncStatus;

  const version = parseVersionJson(versionRaw);
  if (!version) return null;

  const entriesAttempted = Number(entriesAttemptedRaw);
  const entriesLanded = Number(entriesLandedRaw);
  if (!Number.isInteger(entriesAttempted) || entriesAttempted < 0) return null;
  if (!Number.isInteger(entriesLanded) || entriesLanded < 0) return null;

  const failedKeysParsed = safeJsonParse(failedKeysRaw);
  if (!failedKeysParsed.ok || !Array.isArray(failedKeysParsed.value)) return null;
  if (!failedKeysParsed.value.every((k) => typeof k === "string")) return null;
  const failedKeys = failedKeysParsed.value as ContractProjectionFieldKey[];

  if (currentOfferCrossCheckOkRaw !== "true" && currentOfferCrossCheckOkRaw !== "false") return null;

  if (observedStateBeforeWriteRaw !== "Idle" && observedStateBeforeWriteRaw !== "Requested") return null;
  const observedStateBeforeWrite = observedStateBeforeWriteRaw as ContractDraftRequestState;

  if (intendedToStateRaw !== "Requested") return null;

  if (operatorRaw.trim() === "" || operatorRaw === "UNAVAILABLE") return null;

  const providerStatus = providerStatusRaw === "UNAVAILABLE" ? null : Number(providerStatusRaw);
  if (providerStatus !== null && !Number.isInteger(providerStatus)) return null;

  const sellerSigningEvidenceParsed = safeJsonParse(sellerSigningEvidenceRaw);
  if (!sellerSigningEvidenceParsed.ok) return null;
  const sellerSigningEvidence = validateSellerSigningAuditEvidenceValue(sellerSigningEvidenceParsed.value);
  if (!sellerSigningEvidence) return null;

  return {
    at,
    operator: operatorRaw,
    opportunityId,
    attemptId,
    status,
    version,
    entriesAttempted,
    entriesLanded,
    failedKeys,
    currentOfferCrossCheckOk: currentOfferCrossCheckOkRaw === "true",
    observedStateBeforeWrite,
    intendedToState: "Requested",
    sentValue: sentValueRaw === "UNAVAILABLE" ? null : sentValueRaw,
    observedValue: observedValueRaw === "UNAVAILABLE" ? null : observedValueRaw,
    providerStatus,
    failureReason: failureReasonRaw === "UNAVAILABLE" ? null : failureReasonRaw,
    sellerSigningEvidence,
  };
}

/**
 * "Latest wins, scoped to ONE Opportunity" -- but resolved by RANK within
 * each `attemptId` first, never by `at` alone, exactly
 * `latestContractSendForOpportunity`'s own algorithm: a terminal note
 * (`accepted`/`failed`/`indeterminate`) ALWAYS supersedes an `in_progress`
 * note for the SAME attempt regardless of exact timestamp ordering, and the
 * most recent ATTEMPT overall is the one whose own `attemptId` is latest --
 * not whichever attempt happened to be written to last.
 */
export function latestContractProjectionSyncForOpportunity(
  notes: { body: string }[],
  opportunityId: string,
): ContractDraftRequestSyncRecord | null {
  const parsedForOpp: ContractDraftRequestSyncRecord[] = [];
  for (const note of notes) {
    const parsed = parseContractProjectionSyncNote(note.body);
    if (!parsed || parsed.opportunityId !== opportunityId) continue;
    parsedForOpp.push(parsed);
  }
  if (parsedForOpp.length === 0) return null;

  const rankOf = (status: ContractDraftRequestSyncStatus): number =>
    TERMINAL_STATUSES.has(status) ? 1 : (PENDING_RANK[status] ?? 0);

  const byAttempt = new Map<string, ContractDraftRequestSyncRecord>();
  for (const p of parsedForOpp) {
    const existing = byAttempt.get(p.attemptId);
    if (!existing) {
      byAttempt.set(p.attemptId, p);
      continue;
    }
    const pRank = rankOf(p.status);
    const existingRank = rankOf(existing.status);
    if (pRank > existingRank) {
      byAttempt.set(p.attemptId, p);
    } else if (pRank === existingRank && new Date(p.at).getTime() > new Date(existing.at).getTime()) {
      byAttempt.set(p.attemptId, p);
    }
  }

  let latest: ContractDraftRequestSyncRecord | null = null;
  for (const p of byAttempt.values()) {
    if (!latest || new Date(p.attemptId).getTime() > new Date(latest.attemptId).getTime()) latest = p;
  }
  return latest;
}

/**
 * Whether the latest recorded sync evidence still describes the CURRENT
 * contract version -- reuses `isSameContractVersion` verbatim, no second
 * version-equality implementation. `true` (stale) when no record exists at
 * all, matching this codebase's fail-closed convention: absence is never
 * treated as "still current."
 */
export function isContractProjectionSyncStale(
  record: ContractDraftRequestSyncRecord | null,
  currentVersion: ContractVersionIdentity,
): boolean {
  if (!record) return true;
  return !isSameContractVersion(record.version, currentVersion);
}
