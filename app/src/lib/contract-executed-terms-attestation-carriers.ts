/**
 * Board #9 executed-terms attestation -- durable, append-only GHL note
 * carrier. B9-10 / INV-65, Product Owner ruling, 2026-09-13.
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
 * ONE VERSIONED, EXACT-SCHEMA RECORD. `formatExecutedTermsAttestationNote`
 * serializes exactly one `ExecutedTermsAttestationRecord`;
 * `parseExecutedTermsAttestationNote` independently re-verifies every
 * field's shape and every cross-field consistency rule on read-back -- a
 * hand-edited or corrupted note can never round-trip into a record
 * claiming evidence it does not actually carry. Rejected outright: a
 * mismatched top-level `Agreement Reached at` vs. the JSON `Version`'s
 * own `agreementAt`; an `Operator`/`Authorized by` value other than the
 * literal `"brad"`; zero checklist items; a duplicate checklist item; a
 * malformed SHA-256; and -- the ruling's own central gate -- ANY item
 * whose `result` is not `"MATCHES"` (a record built by
 * `buildExecutedTermsAttestationRecordArgs` can never carry one, so its
 * presence here is proof of tampering or corruption, never trusted).
 *
 * APPEND-ONLY, NEVER RESOLVED-TO-ONE, matching
 * `contract-execution-carriers.ts`'s own convention --
 * `allExecutedTermsAttestationRecordsForOpportunity` returns EVERY parsed
 * record for an opportunity, unfiltered. Callers needing "the current
 * attestation for this exact evidence" run
 * `verifyExecutedTermsAttestationCurrency`
 * (`contract-executed-terms-attestation-model.ts`) against each one, or
 * against the latest by `attestedAt` -- this module makes no "latest
 * wins" decision on their behalf.
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

function isValidSha256(value: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(value);
}

import { type ContractVersionIdentity } from "./board9-contract-model";
import {
  type ExecutedTermsAttestationRecord,
  type ChecklistItemResult,
  type ChecklistItemKind,
  type ChecklistResponseValue,
} from "./contract-executed-terms-attestation-model";

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

const CHECKLIST_ITEM_KINDS: readonly ChecklistItemKind[] = [
  "property_identity", "purchase_price", "buyer_identity", "signing_party", "other_material_terms",
];
const CHECKLIST_RESPONSE_VALUES: readonly ChecklistResponseValue[] = ["MATCHES", "DOES_NOT_MATCH", "CANNOT_VERIFY"];
const ITEM_KEYS = ["kind", "signerRole", "authoritativeLabel", "result"] as const;

function formatItemsJson(items: readonly ChecklistItemResult[]): string {
  return JSON.stringify(items);
}

/**
 * Rejects: a non-array; an empty array; a malformed item shape; an
 * unrecognized `kind`/`result` literal; `signerRole` present when `kind`
 * is not `"signing_party"` (or absent/non-string when it is); a blank
 * `authoritativeLabel`; a duplicate `(kind, signerRole)` pair; and --
 * this carrier's own central gate, matching the model's own build-time
 * refusal -- ANY item whose `result` is not exactly `"MATCHES"`.
 */
function parseItemsJson(raw: string): ChecklistItemResult[] | null {
  const parsed = safeJsonParse(raw);
  if (!parsed.ok || !Array.isArray(parsed.value) || parsed.value.length === 0) return null;
  const out: ChecklistItemResult[] = [];
  for (const item of parsed.value) {
    if (!isPlainObject(item)) return null;
    if (!hasExactKeys(item, ITEM_KEYS)) return null;
    if (typeof item.kind !== "string" || !CHECKLIST_ITEM_KINDS.includes(item.kind as ChecklistItemKind)) return null;
    const kind = item.kind as ChecklistItemKind;
    if (kind === "signing_party") {
      if (typeof item.signerRole !== "string" || item.signerRole === "") return null;
    } else if (item.signerRole !== null) {
      return null;
    }
    if (typeof item.authoritativeLabel !== "string" || item.authoritativeLabel === "") return null;
    if (typeof item.result !== "string" || !CHECKLIST_RESPONSE_VALUES.includes(item.result as ChecklistResponseValue)) return null;
    // The carrier's own central gate: a record that ever reaches this
    // note format must be unanimous MATCHES -- anything else is proof of
    // tampering/corruption, never trusted on read-back.
    if (item.result !== "MATCHES") return null;
    out.push({
      kind,
      signerRole: kind === "signing_party" ? (item.signerRole as string) : null,
      authoritativeLabel: item.authoritativeLabel,
      result: item.result as ChecklistResponseValue,
    });
  }
  const keys = out.map((i) => `${i.kind}::${i.signerRole ?? ""}`);
  if (new Set(keys).size !== keys.length) return null;
  return out;
}

export const EXECUTED_TERMS_ATTESTATION_LEDGER_VERSION = "iaos-executed-terms-attestation-v1" as const;
const HEADER = `IAOS EXECUTED TERMS ATTESTATION — ${EXECUTED_TERMS_ATTESTATION_LEDGER_VERSION}`;
const LABELS = [
  "Attested at",
  "Opportunity",
  "Agreement Reached at",
  "Version",
  "Provider document id",
  "Provider document revision",
  "Artifact SHA-256",
  "Operator",
  "Authorized by",
  "Items",
  "Evidence summary",
] as const;

function ledgerValue(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "UNAVAILABLE" : String(value);
}

/** Serializes ONE `ExecutedTermsAttestationRecord`. Never invoked on a record whose items are not unanimous `"MATCHES"` -- `buildExecutedTermsAttestationRecordArgs` never builds one. */
export function formatExecutedTermsAttestationNote(record: ExecutedTermsAttestationRecord): string {
  return [
    HEADER,
    `${LABELS[0]}: ${record.attestedAt}`,
    `${LABELS[1]}: ${record.opportunityId}`,
    `${LABELS[2]}: ${record.agreementAt}`,
    `${LABELS[3]}: ${formatVersionJson(record.version)}`,
    `${LABELS[4]}: ${record.providerDocumentId}`,
    `${LABELS[5]}: ${ledgerValue(record.providerDocumentRevision)}`,
    `${LABELS[6]}: ${record.selectedArtifactSha256}`,
    `${LABELS[7]}: ${record.operator}`,
    `${LABELS[8]}: ${record.authorizedBy}`,
    `${LABELS[9]}: ${formatItemsJson(record.items)}`,
    `${LABELS[10]}: ${singleLine(record.evidenceSummary)}`,
  ].join("\n");
}

/**
 * Parses ONE executed-terms attestation note back into its exact
 * `ExecutedTermsAttestationRecord` -- returns `null` (never a best-effort
 * partial record) for anything malformed, incomplete, mixed-version,
 * non-Brad, or non-unanimous.
 */
export function parseExecutedTermsAttestationNote(body: string): ExecutedTermsAttestationRecord | null {
  const values = matchPositionalSchema(body, HEADER, LABELS);
  if (!values) return null;
  const [
    attestedAt, opportunityId, agreementAt, versionRaw, providerDocumentIdRaw,
    providerDocumentRevisionRaw, selectedArtifactSha256, operatorRaw, authorizedByRaw,
    itemsRaw, evidenceSummary,
  ] = values;

  if (opportunityId === "" || providerDocumentIdRaw === "" || evidenceSummary === "") return null;
  if (!isCanonicalIsoTimestamp(attestedAt)) return null;
  if (!isCanonicalIsoTimestamp(agreementAt)) return null;

  const version = parseVersionJson(versionRaw);
  if (!version) return null;
  // Mixed-version rejection: the top-level Agreement Reached identity must
  // agree with the version's OWN agreementAt.
  if (agreementAt !== version.agreementAt) return null;

  if (operatorRaw !== "brad" || authorizedByRaw !== "brad") return null;

  const providerDocumentRevisionParsed = providerDocumentRevisionRaw === "UNAVAILABLE" ? null : Number(providerDocumentRevisionRaw);
  if (providerDocumentRevisionRaw !== "UNAVAILABLE" && (!Number.isFinite(providerDocumentRevisionParsed) || !Number.isInteger(providerDocumentRevisionParsed))) return null;

  if (!isValidSha256(selectedArtifactSha256)) return null;

  const items = parseItemsJson(itemsRaw);
  if (!items) return null;

  return {
    kind: "executed_terms_attestation",
    opportunityId,
    version,
    agreementAt,
    providerDocumentId: providerDocumentIdRaw,
    providerDocumentRevision: providerDocumentRevisionParsed,
    selectedArtifactSha256,
    operator: "brad",
    authorizedBy: "brad",
    attestedAt,
    items,
    evidenceSummary,
  };
}

/**
 * EVERY parsed executed-terms attestation record for one Opportunity --
 * append-only, unfiltered, duplicates included, matching
 * `contract-execution-carriers.ts`'s own convention. Callers determine
 * currency/latest-ness themselves (see this file's own header).
 */
export function allExecutedTermsAttestationRecordsForOpportunity(
  notes: { body: string }[],
  opportunityId: string,
): ExecutedTermsAttestationRecord[] {
  const out: ExecutedTermsAttestationRecord[] = [];
  for (const note of notes) {
    const parsed = parseExecutedTermsAttestationNote(note.body);
    if (!parsed || parsed.opportunityId !== opportunityId) continue;
    out.push(parsed);
  }
  return out;
}

/**
 * The single most-recently-attested record for one Opportunity, by
 * `attestedAt` -- the natural "what would currency-checking use by
 * default" convenience, matching `latestContractSendForOpportunity`'s own
 * "latest wins" convention on other B9 carriers. Ties (identical
 * `attestedAt`) resolve to the LAST one encountered in `notes`' own
 * order, never an arbitrary/unstable choice.
 */
export function latestExecutedTermsAttestationForOpportunity(
  notes: { body: string }[],
  opportunityId: string,
): ExecutedTermsAttestationRecord | null {
  const all = allExecutedTermsAttestationRecordsForOpportunity(notes, opportunityId);
  if (all.length === 0) return null;
  return all.reduce((latest, candidate) => (candidate.attestedAt >= latest.attestedAt ? candidate : latest));
}
