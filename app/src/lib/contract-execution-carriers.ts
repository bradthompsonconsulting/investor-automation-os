/**
 * Board #9 verified Under Contract -- durable, append-only GHL note
 * carrier. B9-10 / INV-65.
 *
 * Pure. No I/O, no React. Same proven per-file carrier pattern as every
 * other B8/B9 carrier (versioned header, positional parsing, canonical ISO
 * timestamp). Local helpers are duplicated rather than imported, matching
 * every prior carrier file's own stated relationship to its siblings
 * (`contract-lifecycle-carriers.ts`'s own header). This is a NEW record
 * kind, not an extension of the lifecycle ledger's own schema -- Under
 * Contract is a distinct, terminal fact with its own exhaustive evidence
 * requirement (`contract-execution-model.ts`'s `UnderContractRecordEntry`),
 * not one more `LifecycleEventKind` value. The caller is responsible for
 * `ghl.notes.create()`, one of AGENTS.md's three sanctioned writes -- this
 * module performs no write and no fourth write class is introduced.
 *
 * ONE VERSIONED, EXACT-SCHEMA RECORD. `formatUnderContractNote` serializes
 * exactly one `UnderContractRecordEntry`; `parseUnderContractNote`
 * independently re-verifies every field's shape and every cross-field
 * consistency rule on read-back -- a hand-edited or corrupted note can
 * never round-trip into a record claiming evidence it does not actually
 * carry. Rejected outright: a mismatched top-level `Agreement Reached at`
 * vs. the JSON `Version`'s own `agreementAt` ("mixed-version" confusion);
 * an `Authority` value other than the single literal `"system_derived"`
 * this record kind may ever carry ("authority-confused" rejection); a
 * non-empty `Executed terms conflicts` array (a record with any real
 * conflict should never have been built at all -- its presence here is
 * proof of tampering or a caller bug, never trusted); an empty `Signers`
 * array; a malformed SHA-256 (not exactly 64 hex characters).
 *
 * APPEND-ONLY, NEVER RESOLVED-TO-ONE. `allUnderContractRecordsForOpportunity`
 * returns EVERY parsed record for an opportunity, unfiltered -- duplicates
 * included, matching `contract-lifecycle-carriers.ts`'s own convention.
 * "A duplicate exact record may be recognized" (`contract-execution-
 * model.ts`'s `isDuplicateUnderContractRecord`), "but prior history must
 * never be overwritten or deleted" -- this reader never collapses or
 * removes anything.
 *
 * Embedded newlines in `evidenceSummary` would break this schema's
 * one-line-per-field contract on read-back -- `formatUnderContractNote`
 * replaces any `\n` with a single space before writing, so a note this
 * module writes always round-trips through its own parser.
 *
 * SCHEMA V2 (B9-13/INV-96): adds `pageCount` -- see
 * `UnderContractRecordEntry.pageCount`'s own header
 * (`contract-execution-model.ts`) and `PreservedDocumentEvidence.
 * pageCount`'s (`board9-contract-model.ts`). Nullable (`"UNAVAILABLE"`
 * sentinel, same convention as `providerDocumentReference`/
 * `providerDocumentRevision`), audit-only, never gated on.
 */

function ledgerValue(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "UNAVAILABLE" : String(value);
}

function singleLine(value: string): string {
  return value.replace(/\r?\n/g, " ");
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

function hasExactKeys(v: Record<string, unknown>, keys: readonly string[]): boolean {
  const vKeys = Object.keys(v);
  if (vKeys.length !== keys.length) return false;
  return keys.every((k) => vKeys.includes(k));
}

function safeJsonParse(raw: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

function isValidSha256(value: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(value);
}

import { type ContractVersionIdentity } from "./board9-contract-model";
import { type UnderContractRecordEntry, type VerifiedSignerMatch } from "./contract-execution-model";

const VERSION_KEYS = ["agreementAt", "versionSeq", "supersedesVersionSeq", "replacesAgreementAt"] as const;
function formatVersionJson(v: ContractVersionIdentity): string {
  return JSON.stringify(v);
}
function parseVersionJson(raw: string): ContractVersionIdentity | null {
  const parsed = safeJsonParse(raw);
  if (!parsed.ok || !isPlainObject(parsed.value)) return null;
  const v = parsed.value;
  if (!hasExactKeys(v, VERSION_KEYS)) return null;
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

const SIGNER_MATCH_KEYS = ["role", "displayName", "providerRecipientId", "providerCompletedAt"] as const;
function formatSignersJson(signers: readonly VerifiedSignerMatch[]): string {
  return JSON.stringify(signers);
}
function parseSignersJson(raw: string): VerifiedSignerMatch[] | null {
  const parsed = safeJsonParse(raw);
  if (!parsed.ok || !Array.isArray(parsed.value)) return null;
  const out: VerifiedSignerMatch[] = [];
  for (const item of parsed.value) {
    if (!isPlainObject(item)) return null;
    if (!hasExactKeys(item, SIGNER_MATCH_KEYS)) return null;
    if (typeof item.role !== "string" || item.role === "") return null;
    if (typeof item.displayName !== "string" || item.displayName === "") return null;
    // providerRecipientId is REQUIRED (Jess Gate repair round, 2026-09-13:
    // it is now the PRIMARY signer-identity join, never optional).
    if (typeof item.providerRecipientId !== "string" || item.providerRecipientId === "") return null;
    if (item.providerCompletedAt !== null && (typeof item.providerCompletedAt !== "string" || !isCanonicalIsoTimestamp(item.providerCompletedAt))) return null;
    out.push({
      role: item.role,
      displayName: item.displayName,
      providerRecipientId: item.providerRecipientId,
      providerCompletedAt: item.providerCompletedAt as string | null,
    });
  }
  if (out.length === 0) return null;
  // Every role must be distinct -- a parsed record with a duplicate role is malformed, never trusted.
  const roles = out.map((s) => s.role);
  if (new Set(roles).size !== roles.length) return null;
  return out;
}

function parseConflictsJson(raw: string): [] | null {
  const parsed = safeJsonParse(raw);
  if (!parsed.ok || !Array.isArray(parsed.value)) return null;
  // A valid Under Contract record NEVER carries a real conflict -- any
  // non-empty array here is proof of tampering or a caller bug.
  return parsed.value.length === 0 ? [] : null;
}

export const UNDER_CONTRACT_LEDGER_VERSION = "iaos-under-contract-v2" as const;
const HEADER = `IAOS UNDER CONTRACT — ${UNDER_CONTRACT_LEDGER_VERSION}`;
const LABELS = [
  "Recorded at",
  "Opportunity",
  "Agreement Reached at",
  "Version",
  "Accepted send attempt id",
  "Provider document id",
  "Provider document reference",
  "Provider document revision",
  "Provider reported completion at",
  "Signers",
  "Artifact SHA-256",
  "Page count",
  "Executed terms conflicts",
  "Authority",
  "Evidence summary",
  "Related prior record id",
] as const;

/**
 * SCHEMA V1 (RETAINED, READ-ONLY). B9-13/INV-96 correction: schema v2
 * inserted "Page count" -- a real, already-durable v1 note (15 lines, no
 * page-count field) must remain readable, never stranded. This module
 * never WRITES a v1 note again (`formatUnderContractNote` only ever
 * produces v2), but `parseUnderContractNote` tries v2 first, then falls
 * back to this exact original shape.
 */
const LEGACY_V1_LEDGER_VERSION = "iaos-under-contract-v1" as const;
const LEGACY_V1_HEADER = `IAOS UNDER CONTRACT — ${LEGACY_V1_LEDGER_VERSION}`;
const LEGACY_V1_LABELS = [
  "Recorded at",
  "Opportunity",
  "Agreement Reached at",
  "Version",
  "Accepted send attempt id",
  "Provider document id",
  "Provider document reference",
  "Provider document revision",
  "Provider reported completion at",
  "Signers",
  "Artifact SHA-256",
  "Executed terms conflicts",
  "Authority",
  "Evidence summary",
  "Related prior record id",
] as const;

/** Serializes ONE verified `UnderContractRecordEntry`. Never invoked on a record whose own `executedTermsConflictCount` is non-zero -- the type itself pins that field to the literal `0`. */
export function formatUnderContractNote(record: UnderContractRecordEntry): string {
  return [
    HEADER,
    `${LABELS[0]}: ${record.iaosVerifiedAt}`,
    `${LABELS[1]}: ${record.opportunityId}`,
    `${LABELS[2]}: ${record.agreementAt}`,
    `${LABELS[3]}: ${formatVersionJson(record.version)}`,
    `${LABELS[4]}: ${record.acceptedSendAttemptId}`,
    `${LABELS[5]}: ${record.providerDocumentId}`,
    `${LABELS[6]}: ${ledgerValue(record.providerDocumentReference)}`,
    `${LABELS[7]}: ${ledgerValue(record.providerDocumentRevision)}`,
    `${LABELS[8]}: ${record.providerReportedCompletionAt}`,
    `${LABELS[9]}: ${formatSignersJson(record.signers)}`,
    `${LABELS[10]}: ${record.artifactSha256}`,
    `${LABELS[11]}: ${ledgerValue(record.pageCount)}`,
    `${LABELS[12]}: []`,
    `${LABELS[13]}: ${record.authority}`,
    `${LABELS[14]}: ${singleLine(record.evidenceSummary)}`,
    `${LABELS[15]}: ${ledgerValue(record.relatedPriorRecordId)}`,
  ].join("\n");
}

function buildParsedUnderContractFromV2Values(values: string[]): UnderContractRecordEntry | null {
  const [
    at, opportunityId, agreementAt, versionRaw, acceptedSendAttemptId, providerDocumentIdRaw,
    providerDocumentReferenceRaw, providerDocumentRevisionRaw, providerReportedCompletionAt,
    signersRaw, artifactSha256, pageCountRaw, conflictsRaw, authorityRaw, evidenceSummary, relatedPriorRecordIdRaw,
  ] = values;

  if (opportunityId === "" || providerDocumentIdRaw === "" || evidenceSummary === "") return null;
  if (!isCanonicalIsoTimestamp(at)) return null;
  if (!isCanonicalIsoTimestamp(agreementAt)) return null;
  if (!isCanonicalIsoTimestamp(acceptedSendAttemptId)) return null;
  if (!isCanonicalIsoTimestamp(providerReportedCompletionAt)) return null;

  const version = parseVersionJson(versionRaw);
  if (!version) return null;
  // Mixed-version rejection: the top-level Agreement Reached identity must
  // agree with the version's OWN agreementAt -- never two disagreeing
  // identities in the same record.
  if (agreementAt !== version.agreementAt) return null;

  if (authorityRaw !== "system_derived") return null;

  const providerDocumentId = providerDocumentIdRaw;
  const providerDocumentReference = providerDocumentReferenceRaw === "UNAVAILABLE" ? null : providerDocumentReferenceRaw;
  const providerDocumentRevisionParsed = providerDocumentRevisionRaw === "UNAVAILABLE" ? null : Number(providerDocumentRevisionRaw);
  if (providerDocumentRevisionRaw !== "UNAVAILABLE" && (!Number.isFinite(providerDocumentRevisionParsed) || !Number.isInteger(providerDocumentRevisionParsed))) return null;

  const signers = parseSignersJson(signersRaw);
  if (!signers) return null;

  if (!isValidSha256(artifactSha256)) return null;

  const pageCount = pageCountRaw === "UNAVAILABLE" ? null : Number(pageCountRaw);
  if (pageCountRaw !== "UNAVAILABLE" && (!Number.isFinite(pageCount) || !Number.isInteger(pageCount) || (pageCount as number) < 1)) return null;

  const conflicts = parseConflictsJson(conflictsRaw);
  if (conflicts === null) return null;

  const relatedPriorRecordId = relatedPriorRecordIdRaw === "UNAVAILABLE" ? null : relatedPriorRecordIdRaw;

  return {
    kind: "under_contract",
    opportunityId,
    agreementAt,
    version,
    acceptedSendAttemptId,
    providerDocumentId,
    providerDocumentReference,
    providerDocumentRevision: providerDocumentRevisionParsed,
    providerReportedCompletionAt,
    signers,
    artifactSha256,
    pageCount,
    executedTermsConflictCount: 0,
    iaosVerifiedAt: at,
    authority: "system_derived",
    evidenceSummary,
    relatedPriorRecordId,
  };
}

/** Parses the ORIGINAL, pre-B9-13 schema v1 shape (one fewer field, no `pageCount`) -- `pageCount` is always `null` on the result, honestly, since a v1 note never carried it. */
function buildParsedUnderContractFromLegacyV1Values(values: string[]): UnderContractRecordEntry | null {
  const [
    at, opportunityId, agreementAt, versionRaw, acceptedSendAttemptId, providerDocumentIdRaw,
    providerDocumentReferenceRaw, providerDocumentRevisionRaw, providerReportedCompletionAt,
    signersRaw, artifactSha256, conflictsRaw, authorityRaw, evidenceSummary, relatedPriorRecordIdRaw,
  ] = values;

  if (opportunityId === "" || providerDocumentIdRaw === "" || evidenceSummary === "") return null;
  if (!isCanonicalIsoTimestamp(at)) return null;
  if (!isCanonicalIsoTimestamp(agreementAt)) return null;
  if (!isCanonicalIsoTimestamp(acceptedSendAttemptId)) return null;
  if (!isCanonicalIsoTimestamp(providerReportedCompletionAt)) return null;

  const version = parseVersionJson(versionRaw);
  if (!version) return null;
  if (agreementAt !== version.agreementAt) return null;

  if (authorityRaw !== "system_derived") return null;

  const providerDocumentId = providerDocumentIdRaw;
  const providerDocumentReference = providerDocumentReferenceRaw === "UNAVAILABLE" ? null : providerDocumentReferenceRaw;
  const providerDocumentRevisionParsed = providerDocumentRevisionRaw === "UNAVAILABLE" ? null : Number(providerDocumentRevisionRaw);
  if (providerDocumentRevisionRaw !== "UNAVAILABLE" && (!Number.isFinite(providerDocumentRevisionParsed) || !Number.isInteger(providerDocumentRevisionParsed))) return null;

  const signers = parseSignersJson(signersRaw);
  if (!signers) return null;

  if (!isValidSha256(artifactSha256)) return null;

  const conflicts = parseConflictsJson(conflictsRaw);
  if (conflicts === null) return null;

  const relatedPriorRecordId = relatedPriorRecordIdRaw === "UNAVAILABLE" ? null : relatedPriorRecordIdRaw;

  return {
    kind: "under_contract",
    opportunityId,
    agreementAt,
    version,
    acceptedSendAttemptId,
    providerDocumentId,
    providerDocumentReference,
    providerDocumentRevision: providerDocumentRevisionParsed,
    providerReportedCompletionAt,
    signers,
    artifactSha256,
    pageCount: null,
    executedTermsConflictCount: 0,
    iaosVerifiedAt: at,
    authority: "system_derived",
    evidenceSummary,
    relatedPriorRecordId,
  };
}

/**
 * Dual-read (B9-13/INV-96): tries the CURRENT schema (v2) first; only
 * when a note's header/line-count does not match v2 at all does it try
 * the exact original schema v1 shape. A note matching neither is `null`
 * (never a best-effort partial record), same as always.
 */
export function parseUnderContractNote(body: string): UnderContractRecordEntry | null {
  const v2Values = matchPositionalSchema(body, HEADER, LABELS);
  if (v2Values) return buildParsedUnderContractFromV2Values(v2Values);
  const v1Values = matchPositionalSchema(body, LEGACY_V1_HEADER, LEGACY_V1_LABELS);
  if (v1Values) return buildParsedUnderContractFromLegacyV1Values(v1Values);
  return null;
}

/**
 * EVERY parsed Under Contract record for one Opportunity -- append-only,
 * unfiltered, duplicates included. This ledger is never "latest wins":
 * once ANY genuinely verified Under Contract record exists for an exact
 * agreement/version, its own history is preserved exactly as written,
 * forever, per `SELLER_CONTRACT_STATE_MACHINE_V1.md`'s own "Transition
 * trigger OUT: None" for Under Contract.
 */
export function allUnderContractRecordsForOpportunity(
  notes: { body: string }[],
  opportunityId: string,
): UnderContractRecordEntry[] {
  const out: UnderContractRecordEntry[] = [];
  for (const note of notes) {
    const parsed = parseUnderContractNote(note.body);
    if (!parsed || parsed.opportunityId !== opportunityId) continue;
    out.push(parsed);
  }
  return out;
}
