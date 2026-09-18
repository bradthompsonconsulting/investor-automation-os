/**
 * Board #9 -> Board #10 disposition-handoff snapshot -- durable,
 * append-only GHL note carrier. B9-11 / INV-66.
 *
 * Pure. No I/O, no React. Same proven per-file carrier pattern as every
 * other B8/B9 carrier (versioned header, positional parsing, canonical
 * ISO timestamp, exact-key JSON validation for every scalar/enum field).
 * The caller is responsible for `ghl.notes.create()`, one of AGENTS.md's
 * three sanctioned writes -- this module performs no write and no fourth
 * write class is introduced.
 *
 * VALIDATION DEPTH, STATED PLAINLY. Every top-level field, every `kind`
 * discriminant, and every scalar leaf this module itself defines
 * (`DocumentReference`, `SellerContactSnapshot`, `ApprovedArvSnapshot`)
 * is validated exact-key and exact-shape on parse, matching every sibling
 * carrier's own discipline. For the ONE deeply-nested field sourced from
 * an upstream module this carrier does not own the shape of
 * (`propertyLegalDescription`, `contract-facts-model.ts`'s own
 * `PropertyLegalDescriptionReport`), this carrier validates that each of
 * its seven named keys is present and is a well-formed `FieldDisposition`
 * envelope (`kind` is one of the three real variants, with `value`/
 * `confirmedBy`/`at`/`note` shaped correctly for that `kind`) -- it does
 * NOT re-validate the internal shape of a `not_applicable`/`unresolved`-
 * adjacent leaf value that `contract-facts-model.ts` itself defines
 * (e.g. `ReservationsFact`'s own internal fields), since that would
 * require this carrier to duplicate a type it does not own and could
 * drift from. This is a deliberate, narrower validation boundary than
 * this codebase's other single-purpose carriers, stated here rather than
 * silently assumed.
 *
 * SEVEN-KEY CORRECTION (Product Owner ruling, this session). INV-67 Phase
 * 2A (`8e75497`, 2026-09-16) added `legalMunicipality` to
 * `PropertyLegalDescriptionReport` three days after this carrier shipped
 * (`5db1306`, 2026-09-13) with a six-key allowlist that was never updated.
 * Because `hasExactKeys` requires an exact key-COUNT match, every
 * authoritative write (which always serializes the current, real
 * `PropertyLegalDescriptionReport`) was silently rejected on read --
 * `parsePropertyLegalDescriptionJson` returned `null`, which discarded the
 * ENTIRE disposition-handoff record, not just the legal-description field.
 * Product Owner ruling: the six-key shape is OBSOLETE, not a legacy format
 * to keep accepting -- it fails closed, exactly like any other malformed
 * payload this carrier already rejects. No V1/V2 dispatch was added (unlike
 * `seller-contract-facts-carriers.ts`'s own precedent for this same gap):
 * any old IAOS Test handoff note written under the six-key shape must be
 * regenerated from current authoritative facts, never accepted downstream
 * with a null/unresolved `legalMunicipality` standing in for missing data.
 *
 * APPEND-ONLY, NEVER RESOLVED-TO-ONE, matching every sibling carrier's
 * own convention -- `allDispositionHandoffsForOpportunity` returns EVERY
 * parsed record for an opportunity, unfiltered.
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
import { type VerifiedSignerMatch } from "./contract-execution-model";
import { type FieldDisposition, type PropertyLegalDescriptionReport } from "./contract-facts-model";
import { type ValueOrNone } from "./seller-contract-facts-carriers";
import { type RequiredSigner } from "./contract-signer-mapping-model";
import {
  type DispositionHandoffRecord,
  type DocumentReference,
  type ApprovedArvSnapshot,
  type SellerContactSnapshot,
} from "./contract-disposition-handoff-model";

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

/** Validates ONE `FieldDisposition<T>` envelope generically -- `kind` must be one of the three real variants, with the shape each variant itself requires. `value`'s own internal shape (when `T` is not a bare string) is accepted as any JSON value the envelope carries -- see this module's own header for why. */
function isWellFormedFieldDispositionEnvelope(v: unknown): v is { kind: string; [k: string]: unknown } {
  if (!isPlainObject(v)) return false;
  if (v.kind === "populated") {
    return "value" in v && typeof v.authority === "string" && ("recordedAt" in v) && (v.recordedAt === null || typeof v.recordedAt === "string");
  }
  if (v.kind === "not_applicable") {
    return ("confirmedBy" in v) && (v.confirmedBy === null || typeof v.confirmedBy === "string") && typeof v.at === "string" && ("note" in v) && (v.note === null || typeof v.note === "string");
  }
  if (v.kind === "unresolved") {
    return Object.keys(v).length === 1;
  }
  return false;
}

function formatFieldDispositionJson<T>(fd: FieldDisposition<T>): string {
  return JSON.stringify(fd);
}
function parseFieldDispositionJson<T>(raw: string): FieldDisposition<T> | null {
  const parsed = safeJsonParse(raw);
  if (!parsed.ok || !isWellFormedFieldDispositionEnvelope(parsed.value)) return null;
  return parsed.value as unknown as FieldDisposition<T>;
}

const PROPERTY_LEGAL_DESCRIPTION_KEYS = ["lot", "block", "addition", "county", "exclusions", "reservations", "legalMunicipality"] as const;
function parsePropertyLegalDescriptionJson(raw: string): PropertyLegalDescriptionReport | null {
  const parsed = safeJsonParse(raw);
  if (!parsed.ok || !isPlainObject(parsed.value)) return null;
  const v = parsed.value;
  if (!hasExactKeys(v, PROPERTY_LEGAL_DESCRIPTION_KEYS)) return null;
  for (const key of PROPERTY_LEGAL_DESCRIPTION_KEYS) {
    if (!isWellFormedFieldDispositionEnvelope(v[key])) return null;
  }
  return v as unknown as PropertyLegalDescriptionReport;
}

const APPROVED_ARV_KEYS = ["amount", "approvalEvidenceState", "approvalDecision", "approvedAt"] as const;
const ARV_EVIDENCE_STATES: ReadonlySet<string> = new Set(["HIGH", "MODERATE", "LOW", "INSUFFICIENT"]);
function parseApprovedArvJson(raw: string): ApprovedArvSnapshot | null {
  const parsed = safeJsonParse(raw);
  if (!parsed.ok || !isPlainObject(parsed.value)) return null;
  const v = parsed.value;
  if (!hasExactKeys(v, APPROVED_ARV_KEYS)) return null;
  if (typeof v.amount !== "number" || !Number.isFinite(v.amount)) return null;
  if (v.approvalEvidenceState !== null && (typeof v.approvalEvidenceState !== "string" || !ARV_EVIDENCE_STATES.has(v.approvalEvidenceState))) return null;
  if (v.approvalDecision !== null && v.approvalDecision !== "APPROVED" && v.approvalDecision !== "OVERRIDE") return null;
  if (v.approvedAt !== null && (typeof v.approvedAt !== "string" || !isCanonicalIsoTimestamp(v.approvedAt))) return null;
  return v as unknown as ApprovedArvSnapshot;
}

const SELLER_CONTACT_KEYS = ["noticeAddress", "noticePhone", "noticeEmail"] as const;
function parseSellerContactJson(raw: string): SellerContactSnapshot | null {
  const parsed = safeJsonParse(raw);
  if (!parsed.ok || !isPlainObject(parsed.value)) return null;
  const v = parsed.value;
  if (!hasExactKeys(v, SELLER_CONTACT_KEYS)) return null;
  for (const key of SELLER_CONTACT_KEYS) {
    if (!isWellFormedFieldDispositionEnvelope(v[key])) return null;
  }
  return v as unknown as SellerContactSnapshot;
}

const REQUIRED_SIGNER_KEYS = ["role", "displayName"] as const;
function parseRequiredSignersJson(raw: string): RequiredSigner[] | null {
  const parsed = safeJsonParse(raw);
  if (!parsed.ok || !Array.isArray(parsed.value) || parsed.value.length === 0) return null;
  const out: RequiredSigner[] = [];
  for (const item of parsed.value) {
    if (!isPlainObject(item) || !hasExactKeys(item, REQUIRED_SIGNER_KEYS)) return null;
    if (typeof item.role !== "string" || item.role === "") return null;
    if (typeof item.displayName !== "string" || item.displayName === "") return null;
    out.push({ role: item.role, displayName: item.displayName });
  }
  return out;
}

const VERIFIED_SIGNER_KEYS = ["role", "displayName", "providerRecipientId", "providerCompletedAt"] as const;
function parseVerifiedSignersJson(raw: string): VerifiedSignerMatch[] | null {
  const parsed = safeJsonParse(raw);
  if (!parsed.ok || !Array.isArray(parsed.value)) return null;
  const out: VerifiedSignerMatch[] = [];
  for (const item of parsed.value) {
    if (!isPlainObject(item) || !hasExactKeys(item, VERIFIED_SIGNER_KEYS)) return null;
    if (typeof item.role !== "string" || item.role === "") return null;
    if (typeof item.displayName !== "string" || item.displayName === "") return null;
    if (typeof item.providerRecipientId !== "string" || item.providerRecipientId === "") return null;
    if (item.providerCompletedAt !== null && typeof item.providerCompletedAt !== "string") return null;
    out.push({
      role: item.role,
      displayName: item.displayName,
      providerRecipientId: item.providerRecipientId,
      providerCompletedAt: item.providerCompletedAt as string | null,
    });
  }
  return out;
}

const DOCUMENT_REFERENCE_KEYS = ["label", "kind", "reference", "note"] as const;
function parseDocumentReferencesJson(raw: string): DocumentReference[] | null {
  const parsed = safeJsonParse(raw);
  if (!parsed.ok || !Array.isArray(parsed.value)) return null;
  const out: DocumentReference[] = [];
  for (const item of parsed.value) {
    if (!isPlainObject(item) || !hasExactKeys(item, DOCUMENT_REFERENCE_KEYS)) return null;
    if (typeof item.label !== "string" || item.label === "") return null;
    if (item.kind !== "photo" && item.kind !== "document") return null;
    if (typeof item.reference !== "string" || item.reference === "") return null;
    if (item.note !== null && typeof item.note !== "string") return null;
    out.push({ label: item.label, kind: item.kind, reference: item.reference, note: item.note as string | null });
  }
  return out;
}

function ledgerValue(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "UNAVAILABLE" : String(value);
}

export const DISPOSITION_HANDOFF_LEDGER_VERSION = "iaos-disposition-handoff-v1" as const;
const HEADER = `IAOS DISPOSITION HANDOFF — ${DISPOSITION_HANDOFF_LEDGER_VERSION}`;
const LABELS = [
  "Handoff id",
  "Created at",
  "Opportunity",
  "Contact",
  "Agreement Reached at",
  "Version",
  "Accepted send attempt id",
  "Provider document id",
  "Provider document reference",
  "Provider document revision",
  "Provider reported completion at",
  "Artifact SHA-256",
  "Execution verified at",
  "Property address",
  "Property legal description",
  "Seller contract price",
  "Approved ARV",
  "Approved repairs",
  "Closing date",
  "Possession details",
  "Access and showing information",
  "Seller contact",
  "Required signers",
  "Verified signers",
  "Document references",
  "Document references note",
  "Evidence summary",
] as const;

/** Serializes ONE `DispositionHandoffRecord`. */
export function formatDispositionHandoffNote(record: DispositionHandoffRecord): string {
  return [
    HEADER,
    `${LABELS[0]}: ${record.handoffId}`,
    `${LABELS[1]}: ${record.createdAt}`,
    `${LABELS[2]}: ${record.opportunityId}`,
    `${LABELS[3]}: ${record.contactId}`,
    `${LABELS[4]}: ${record.agreementAt}`,
    `${LABELS[5]}: ${formatVersionJson(record.version)}`,
    `${LABELS[6]}: ${record.underContract.acceptedSendAttemptId}`,
    `${LABELS[7]}: ${record.underContract.providerDocumentId}`,
    `${LABELS[8]}: ${ledgerValue(record.underContract.providerDocumentReference)}`,
    `${LABELS[9]}: ${ledgerValue(record.underContract.providerDocumentRevision)}`,
    `${LABELS[10]}: ${record.underContract.providerReportedCompletionAt}`,
    `${LABELS[11]}: ${record.underContract.artifactSha256}`,
    `${LABELS[12]}: ${record.underContract.verifiedAt}`,
    `${LABELS[13]}: ${formatFieldDispositionJson(record.propertyAddress)}`,
    `${LABELS[14]}: ${JSON.stringify(record.propertyLegalDescription)}`,
    `${LABELS[15]}: ${record.sellerContractPrice}`,
    `${LABELS[16]}: ${JSON.stringify(record.approvedArv)}`,
    `${LABELS[17]}: ${record.approvedRepairs}`,
    `${LABELS[18]}: ${formatFieldDispositionJson(record.closingDate)}`,
    `${LABELS[19]}: ${formatFieldDispositionJson(record.possessionDetails)}`,
    `${LABELS[20]}: ${formatFieldDispositionJson(record.accessShowingInformation)}`,
    `${LABELS[21]}: ${JSON.stringify(record.sellerContact)}`,
    `${LABELS[22]}: ${JSON.stringify(record.requiredSigners)}`,
    `${LABELS[23]}: ${JSON.stringify(record.verifiedSigners)}`,
    `${LABELS[24]}: ${JSON.stringify(record.documentReferences)}`,
    `${LABELS[25]}: ${singleLine(record.documentReferencesNote)}`,
    `${LABELS[26]}: ${singleLine(record.evidenceSummary)}`,
  ].join("\n");
}

/**
 * Parses ONE disposition-handoff note back into its exact
 * `DispositionHandoffRecord` -- returns `null` (never a best-effort
 * partial record) for anything malformed, incomplete, or mixed-version.
 */
export function parseDispositionHandoffNote(body: string): DispositionHandoffRecord | null {
  const values = matchPositionalSchema(body, HEADER, LABELS);
  if (!values) return null;
  const [
    handoffId, createdAt, opportunityId, contactId, agreementAt, versionRaw,
    acceptedSendAttemptId, providerDocumentIdRaw, providerDocumentReferenceRaw, providerDocumentRevisionRaw,
    providerReportedCompletionAt, artifactSha256, executionVerifiedAt,
    propertyAddressRaw, propertyLegalDescriptionRaw,
    sellerContractPriceRaw, approvedArvRaw, approvedRepairsRaw,
    closingDateRaw, possessionDetailsRaw, accessShowingRaw,
    sellerContactRaw, requiredSignersRaw, verifiedSignersRaw,
    documentReferencesRaw, documentReferencesNote, evidenceSummary,
  ] = values;

  if (handoffId === "" || opportunityId === "" || contactId === "" || acceptedSendAttemptId === "" || providerDocumentIdRaw === "" || evidenceSummary === "") return null;
  if (!isCanonicalIsoTimestamp(createdAt)) return null;
  if (!isCanonicalIsoTimestamp(agreementAt)) return null;
  if (!isCanonicalIsoTimestamp(providerReportedCompletionAt)) return null;
  if (!isCanonicalIsoTimestamp(executionVerifiedAt)) return null;

  const version = parseVersionJson(versionRaw);
  if (!version) return null;
  if (agreementAt !== version.agreementAt) return null;

  const providerDocumentReference = providerDocumentReferenceRaw === "UNAVAILABLE" ? null : providerDocumentReferenceRaw;
  const providerDocumentRevisionParsed = providerDocumentRevisionRaw === "UNAVAILABLE" ? null : Number(providerDocumentRevisionRaw);
  if (providerDocumentRevisionRaw !== "UNAVAILABLE" && (!Number.isFinite(providerDocumentRevisionParsed) || !Number.isInteger(providerDocumentRevisionParsed))) return null;

  if (!isValidSha256(artifactSha256)) return null;

  const propertyAddress = parseFieldDispositionJson<string>(propertyAddressRaw);
  if (!propertyAddress) return null;
  const propertyLegalDescription = parsePropertyLegalDescriptionJson(propertyLegalDescriptionRaw);
  if (!propertyLegalDescription) return null;

  const sellerContractPrice = Number(sellerContractPriceRaw);
  if (!Number.isFinite(sellerContractPrice)) return null;

  const approvedArv = parseApprovedArvJson(approvedArvRaw);
  if (!approvedArv) return null;

  const approvedRepairs = Number(approvedRepairsRaw);
  if (!Number.isFinite(approvedRepairs)) return null;

  const closingDate = parseFieldDispositionJson<string>(closingDateRaw);
  if (!closingDate) return null;
  const possessionDetails = parseFieldDispositionJson<ValueOrNone>(possessionDetailsRaw);
  if (!possessionDetails) return null;
  const accessShowingInformation = parseFieldDispositionJson<string>(accessShowingRaw);
  if (!accessShowingInformation) return null;

  const sellerContact = parseSellerContactJson(sellerContactRaw);
  if (!sellerContact) return null;

  const requiredSigners = parseRequiredSignersJson(requiredSignersRaw);
  if (!requiredSigners) return null;

  const verifiedSigners = parseVerifiedSignersJson(verifiedSignersRaw);
  if (!verifiedSigners) return null;

  const documentReferences = parseDocumentReferencesJson(documentReferencesRaw);
  if (!documentReferences) return null;

  return {
    kind: "disposition_handoff",
    handoffId,
    createdAt,
    opportunityId,
    contactId,
    agreementAt,
    version,
    underContract: {
      acceptedSendAttemptId,
      providerDocumentId: providerDocumentIdRaw,
      providerDocumentReference,
      providerDocumentRevision: providerDocumentRevisionParsed,
      providerReportedCompletionAt,
      artifactSha256,
      verifiedAt: executionVerifiedAt,
    },
    propertyAddress,
    propertyLegalDescription,
    sellerContractPrice,
    approvedArv,
    approvedRepairs,
    closingDate,
    possessionDetails,
    accessShowingInformation,
    sellerContact,
    requiredSigners,
    verifiedSigners,
    documentReferences,
    documentReferencesNote,
    evidenceSummary,
  };
}

/**
 * EVERY parsed disposition-handoff record for one Opportunity --
 * append-only, unfiltered, duplicates included, matching every sibling
 * carrier's own convention.
 */
export function allDispositionHandoffsForOpportunity(
  notes: { body: string }[],
  opportunityId: string,
): DispositionHandoffRecord[] {
  const out: DispositionHandoffRecord[] = [];
  for (const note of notes) {
    const parsed = parseDispositionHandoffNote(note.body);
    if (!parsed || parsed.opportunityId !== opportunityId) continue;
    out.push(parsed);
  }
  return out;
}
