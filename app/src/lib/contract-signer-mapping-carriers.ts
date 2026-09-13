/**
 * Board #9 signer-recipient mapping attestation -- durable, append-only
 * GHL note carrier. B9-10 / INV-65, Product Owner ruling, 2026-09-13.
 *
 * Pure. No I/O, no React. Same proven per-file carrier pattern as every
 * other B8/B9 carrier (versioned header, positional parsing, canonical
 * ISO timestamp, exact-key JSON validation). Local helpers are
 * duplicated rather than imported, matching every prior carrier file's
 * own stated relationship to its siblings. The caller is responsible for
 * `ghl.notes.create()`, one of AGENTS.md's three sanctioned writes --
 * this module performs no write and no fourth write class is
 * introduced.
 *
 * ONE VERSIONED, EXACT-SCHEMA RECORD. `formatSignerMappingAttestationNote`
 * serializes exactly one `SignerMappingAttestationRecord`;
 * `parseSignerMappingAttestationNote` independently re-verifies every
 * field's shape and every cross-field consistency rule on read-back -- a
 * hand-edited or corrupted note can never round-trip into a record
 * claiming evidence it does not actually carry. Rejected outright: a
 * mismatched top-level `Agreement Reached at` vs. the JSON `Version`'s
 * own `agreementAt`; an `Operator`/`Authorized by` value other than the
 * literal `"brad"`; zero mappings; a duplicate role or duplicate
 * provider recipient id within the parsed mapping array (this carrier's
 * own central gate, defense in depth against a hand-edited note -- a
 * record built by `buildSignerMappingAttestationRecordArgs` can never
 * carry either).
 *
 * APPEND-ONLY, NEVER RESOLVED-TO-ONE, matching every sibling carrier's
 * own convention -- `allSignerMappingAttestationRecordsForOpportunity`
 * returns EVERY parsed record for an opportunity, unfiltered. Callers
 * needing "the current mapping for this exact evidence" run
 * `verifySignerMappingAttestationCurrency`
 * (`contract-signer-mapping-model.ts`) against each one, or against the
 * latest by `attestedAt` via `latestSignerMappingAttestationForOpportunity`
 * -- this module makes no "latest wins" decision on their behalf beyond
 * that one plain convenience.
 */

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

function ledgerValue(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "UNAVAILABLE" : String(value);
}

import { type ContractVersionIdentity } from "./board9-contract-model";
import { type SignerMappingAttestationRecord, type SignerRecipientMapping } from "./contract-signer-mapping-model";

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

const MAPPING_KEYS = ["role", "displayName", "providerRecipientId"] as const;
function formatMappingsJson(mappings: readonly SignerRecipientMapping[]): string {
  return JSON.stringify(mappings);
}
function parseMappingsJson(raw: string): SignerRecipientMapping[] | null {
  const parsed = safeJsonParse(raw);
  if (!parsed.ok || !Array.isArray(parsed.value) || parsed.value.length === 0) return null;
  const out: SignerRecipientMapping[] = [];
  for (const item of parsed.value) {
    if (!isPlainObject(item)) return null;
    if (!hasExactKeys(item, MAPPING_KEYS)) return null;
    if (typeof item.role !== "string" || item.role === "") return null;
    if (typeof item.displayName !== "string" || item.displayName === "") return null;
    if (typeof item.providerRecipientId !== "string" || item.providerRecipientId === "") return null;
    out.push({ role: item.role, displayName: item.displayName, providerRecipientId: item.providerRecipientId });
  }
  const roles = out.map((m) => m.role);
  if (new Set(roles).size !== roles.length) return null;
  const ids = out.map((m) => m.providerRecipientId);
  if (new Set(ids).size !== ids.length) return null;
  return out;
}

export const SIGNER_MAPPING_ATTESTATION_LEDGER_VERSION = "iaos-signer-mapping-attestation-v1" as const;
const HEADER = `IAOS SIGNER MAPPING ATTESTATION — ${SIGNER_MAPPING_ATTESTATION_LEDGER_VERSION}`;
const LABELS = [
  "Attested at",
  "Opportunity",
  "Agreement Reached at",
  "Version",
  "Provider document id",
  "Provider document revision",
  "Accepted send attempt id",
  "Operator",
  "Authorized by",
  "Mappings",
  "Evidence summary",
] as const;

/** Serializes ONE `SignerMappingAttestationRecord`. Never invoked on a record whose mappings are not a real, validated bijection -- `buildSignerMappingAttestationRecordArgs` never builds one otherwise. */
export function formatSignerMappingAttestationNote(record: SignerMappingAttestationRecord): string {
  return [
    HEADER,
    `${LABELS[0]}: ${record.attestedAt}`,
    `${LABELS[1]}: ${record.opportunityId}`,
    `${LABELS[2]}: ${record.agreementAt}`,
    `${LABELS[3]}: ${formatVersionJson(record.version)}`,
    `${LABELS[4]}: ${record.providerDocumentId}`,
    `${LABELS[5]}: ${ledgerValue(record.providerDocumentRevision)}`,
    `${LABELS[6]}: ${record.acceptedSendAttemptId}`,
    `${LABELS[7]}: ${record.operator}`,
    `${LABELS[8]}: ${record.authorizedBy}`,
    `${LABELS[9]}: ${formatMappingsJson(record.mappings)}`,
    `${LABELS[10]}: ${singleLine(record.evidenceSummary)}`,
  ].join("\n");
}

/**
 * Parses ONE signer-mapping attestation note back into its exact
 * `SignerMappingAttestationRecord` -- returns `null` (never a best-effort
 * partial record) for anything malformed, incomplete, mixed-version,
 * non-Brad, or carrying a duplicate role/recipient id.
 */
export function parseSignerMappingAttestationNote(body: string): SignerMappingAttestationRecord | null {
  const values = matchPositionalSchema(body, HEADER, LABELS);
  if (!values) return null;
  const [
    attestedAt, opportunityId, agreementAt, versionRaw, providerDocumentIdRaw,
    providerDocumentRevisionRaw, acceptedSendAttemptId, operatorRaw, authorizedByRaw,
    mappingsRaw, evidenceSummary,
  ] = values;

  if (opportunityId === "" || providerDocumentIdRaw === "" || acceptedSendAttemptId === "" || evidenceSummary === "") return null;
  if (!isCanonicalIsoTimestamp(attestedAt)) return null;
  if (!isCanonicalIsoTimestamp(agreementAt)) return null;

  const version = parseVersionJson(versionRaw);
  if (!version) return null;
  if (agreementAt !== version.agreementAt) return null;

  if (operatorRaw !== "brad" || authorizedByRaw !== "brad") return null;

  const providerDocumentRevisionParsed = providerDocumentRevisionRaw === "UNAVAILABLE" ? null : Number(providerDocumentRevisionRaw);
  if (providerDocumentRevisionRaw !== "UNAVAILABLE" && (!Number.isFinite(providerDocumentRevisionParsed) || !Number.isInteger(providerDocumentRevisionParsed))) return null;

  const mappings = parseMappingsJson(mappingsRaw);
  if (!mappings) return null;

  return {
    kind: "signer_mapping_attestation",
    opportunityId,
    version,
    agreementAt,
    providerDocumentId: providerDocumentIdRaw,
    providerDocumentRevision: providerDocumentRevisionParsed,
    acceptedSendAttemptId,
    operator: "brad",
    authorizedBy: "brad",
    attestedAt,
    mappings,
    evidenceSummary,
  };
}

/**
 * EVERY parsed signer-mapping attestation record for one Opportunity --
 * append-only, unfiltered, duplicates included, matching every sibling
 * carrier's own convention.
 */
export function allSignerMappingAttestationRecordsForOpportunity(
  notes: { body: string }[],
  opportunityId: string,
): SignerMappingAttestationRecord[] {
  const out: SignerMappingAttestationRecord[] = [];
  for (const note of notes) {
    const parsed = parseSignerMappingAttestationNote(note.body);
    if (!parsed || parsed.opportunityId !== opportunityId) continue;
    out.push(parsed);
  }
  return out;
}

/**
 * The single most-recently-attested mapping for one Opportunity, by
 * `attestedAt` -- matching `latestExecutedTermsAttestationForOpportunity`'s
 * own "latest wins" convenience. Ties resolve to the LAST one encountered
 * in `notes`' own order.
 */
export function latestSignerMappingAttestationForOpportunity(
  notes: { body: string }[],
  opportunityId: string,
): SignerMappingAttestationRecord | null {
  const all = allSignerMappingAttestationRecordsForOpportunity(notes, opportunityId);
  if (all.length === 0) return null;
  return all.reduce((latest, candidate) => (candidate.attestedAt >= latest.attestedAt ? candidate : latest));
}
