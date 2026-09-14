/**
 * Contract projection sync -- append-only audit evidence, INV-67 / B9-12
 * contract-population repair.
 *
 * Pure. No I/O, no React. Same proven idiom every existing B9 carrier file
 * uses (`contract-lifecycle-carriers.ts`, `seller-contract-facts-carriers.ts`):
 * a versioned header line, one fact per positional line, JSON for structured
 * sub-fields, a canonical ISO timestamp, and a "latest entry wins, scoped to
 * ONE Opportunity" reader. Every entry is a NEW append-only note; nothing
 * here ever overwrites or deletes a prior one. The write itself is
 * `ghl.notes.create()` (AGENTS.md's three sanctioned writes) -- this module
 * only formats/parses the note body.
 *
 * BOUND TO THE EXACT `ContractVersionIdentity` (locked requirement, this
 * repair). A record names the exact `agreementAt`/`versionSeq` its
 * projection plan was built from, so a later reader can tell whether a past
 * sync evidence record still describes the CURRENT contract version or an
 * earlier one (`isSameContractVersion`, `board9-contract-model.ts`, reused
 * verbatim -- no second version-equality check).
 *
 * WHAT THIS RECORDS, per sync attempt: which projection fields were
 * attempted, how many landed, which (if any) failed readback by key, the
 * current-offer cross-check result, and -- when a Contract Draft Request
 * transition was also attempted -- whether it was allowed and why not when
 * refused. This is EVIDENCE OF WHAT HAPPENED, never a second copy of the
 * projected field VALUES themselves (those live only in the GHL Opportunity
 * fields `ghl.ts`'s writer targets -- GHL remains the sole system of record,
 * AGENTS.md's own hard constraint).
 */

import { type ContractVersionIdentity, isSameContractVersion } from "./board9-contract-model";
import type { ContractProjectionFieldKey } from "./contract-ghl-projection-model";

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
/* The record                                                           */
/* ==================================================================== */

export type ContractDraftRequestAttempt = {
  attempted: boolean;
  allowed: boolean;
  reason: string | null;
  fromState: string | null;
  toState: string | null;
};

export type ContractProjectionSyncRecord = {
  at: string;
  opportunityId: string;
  version: ContractVersionIdentity;
  ok: boolean;
  entriesAttempted: number;
  entriesLanded: number;
  /** Exactly the keys whose readback did not match what was sent -- empty when `ok` is true. */
  failedKeys: ContractProjectionFieldKey[];
  currentOfferCrossCheckOk: boolean;
  draftRequest: ContractDraftRequestAttempt;
  operator: string;
};

export const CONTRACT_PROJECTION_SYNC_LEDGER_VERSION = "iaos-contract-projection-sync-v1" as const;
const HEADER = `IAOS CONTRACT PROJECTION SYNC — ${CONTRACT_PROJECTION_SYNC_LEDGER_VERSION}`;
const LABELS = [
  "Recorded at",
  "Opportunity",
  "Version",
  "Overall ok",
  "Entries attempted",
  "Entries landed",
  "Failed keys",
  "Current offer cross-check ok",
  "Draft request",
  "Operator",
] as const;

export function formatContractProjectionSyncNote(record: ContractProjectionSyncRecord): string {
  return [
    HEADER,
    `${LABELS[0]}: ${record.at}`,
    `${LABELS[1]}: ${record.opportunityId}`,
    `${LABELS[2]}: ${formatVersionJson(record.version)}`,
    `${LABELS[3]}: ${ledgerBooleanValue(record.ok)}`,
    `${LABELS[4]}: ${record.entriesAttempted}`,
    `${LABELS[5]}: ${record.entriesLanded}`,
    `${LABELS[6]}: ${JSON.stringify(record.failedKeys)}`,
    `${LABELS[7]}: ${ledgerBooleanValue(record.currentOfferCrossCheckOk)}`,
    `${LABELS[8]}: ${JSON.stringify(record.draftRequest)}`,
    `${LABELS[9]}: ${ledgerValue(record.operator)}`,
  ].join("\n");
}

export function parseContractProjectionSyncNote(body: string): ContractProjectionSyncRecord | null {
  const values = matchPositionalSchema(body, HEADER, LABELS);
  if (!values) return null;
  const [
    at, opportunityId, versionRaw, okRaw, entriesAttemptedRaw, entriesLandedRaw,
    failedKeysRaw, currentOfferCrossCheckOkRaw, draftRequestRaw, operatorRaw,
  ] = values;

  if (!isCanonicalIsoTimestamp(at)) return null;
  const version = parseVersionJson(versionRaw);
  if (!version) return null;
  if (okRaw !== "true" && okRaw !== "false") return null;
  const entriesAttempted = Number(entriesAttemptedRaw);
  const entriesLanded = Number(entriesLandedRaw);
  if (!Number.isInteger(entriesAttempted) || entriesAttempted < 0) return null;
  if (!Number.isInteger(entriesLanded) || entriesLanded < 0) return null;

  const failedKeysParsed = safeJsonParse(failedKeysRaw);
  if (!failedKeysParsed.ok || !Array.isArray(failedKeysParsed.value)) return null;
  if (!failedKeysParsed.value.every((k) => typeof k === "string")) return null;
  const failedKeys = failedKeysParsed.value as ContractProjectionFieldKey[];

  if (currentOfferCrossCheckOkRaw !== "true" && currentOfferCrossCheckOkRaw !== "false") return null;

  const draftRequestParsed = safeJsonParse(draftRequestRaw);
  if (!draftRequestParsed.ok || !isPlainObject(draftRequestParsed.value)) return null;
  const dr = draftRequestParsed.value;
  if (
    typeof dr.attempted !== "boolean" ||
    typeof dr.allowed !== "boolean" ||
    (dr.reason !== null && typeof dr.reason !== "string") ||
    (dr.fromState !== null && typeof dr.fromState !== "string") ||
    (dr.toState !== null && typeof dr.toState !== "string")
  ) {
    return null;
  }
  const draftRequest: ContractDraftRequestAttempt = {
    attempted: dr.attempted,
    allowed: dr.allowed,
    reason: dr.reason as string | null,
    fromState: dr.fromState as string | null,
    toState: dr.toState as string | null,
  };

  if (operatorRaw.trim() === "" || operatorRaw === "UNAVAILABLE") return null;

  return {
    at,
    opportunityId,
    version,
    ok: okRaw === "true",
    entriesAttempted,
    entriesLanded,
    failedKeys,
    currentOfferCrossCheckOk: currentOfferCrossCheckOkRaw === "true",
    draftRequest,
    operator: operatorRaw,
  };
}

/** Latest entry wins, scoped to ONE Opportunity -- the same reader shape every existing B9 carrier uses. */
export function latestContractProjectionSyncForOpportunity(
  notes: { body: string }[],
  opportunityId: string,
): ContractProjectionSyncRecord | null {
  let latest: ContractProjectionSyncRecord | null = null;
  for (const note of notes) {
    const parsed = parseContractProjectionSyncNote(note.body);
    if (!parsed || parsed.opportunityId !== opportunityId) continue;
    if (!latest || new Date(parsed.at).getTime() > new Date(latest.at).getTime()) latest = parsed;
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
  record: ContractProjectionSyncRecord | null,
  currentVersion: ContractVersionIdentity,
): boolean {
  if (!record) return true;
  return !isSameContractVersion(record.version, currentVersion);
}
