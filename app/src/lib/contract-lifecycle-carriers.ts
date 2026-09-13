/**
 * Board #9 lifecycle -- durable, append-only GHL note carrier. B9-09 /
 * INV-64.
 *
 * Pure. No I/O, no React. Same proven per-file carrier pattern as every
 * other B8/B9 carrier (versioned header, positional parsing, canonical ISO
 * timestamp, "latest wins scoped to one Opportunity/version"). Local
 * helpers are duplicated rather than imported, matching every prior
 * carrier file's own stated relationship to its siblings
 * (`contract-send-carriers.ts`'s own header). Every entry is a NEW
 * append-only note; the caller is responsible for `ghl.notes.create()`,
 * one of AGENTS.md's three sanctioned writes -- this module performs no
 * write and no fourth write class is introduced.
 *
 * ONE NOTE SHAPE FOR EVERY LIFECYCLE EVENT KIND. `contract-lifecycle-
 * model.ts`'s five `LifecycleRecord` variants (`provider_observation`,
 * `correction`, `resend`, `rescission`, `decline`) all serialize through
 * the SAME positional schema -- fields that do not apply to a given kind
 * are written as the ledger's own `UNAVAILABLE` sentinel, exactly as
 * `contract-send-carriers.ts` already does for its own optional fields.
 * `formatContractLifecycleNote` NEVER writes a note that mixes fields
 * from two different kinds -- `parseContractLifecycleNote` independently
 * re-derives and re-checks the same per-kind shape on read-back, so a
 * hand-edited or malformed note can never round-trip into a record that
 * claims an authority or evidence its own fields do not support.
 *
 * PROVIDER FACTS CANNOT IMPERSONATE HUMAN FACTS, OR VICE VERSA -- ENFORCED
 * AT PARSE TIME, NOT ASSUMED. `parseContractLifecycleNote` rejects (returns
 * `null` for) any note where: the `Authority` column does not match the
 * kind implied by `Event kind` exactly (`provider_reported` for the nine
 * provider statuses, `operator_attested` for `corrected`/`operator_
 * declined`, `brad_authorized` for `resent`/`rescinded`); a provider-kind
 * note carries a non-blank `Operator`/`Authorized at`/`Detail`; a human-
 * kind note carries any raw provider evidence field (`Raw provider
 * status`, `Raw is expired`, `Raw deleted`, `Recipients completed/total`,
 * `Provider document reference/revision`, `Provider reported at`); or a
 * `resent`/`rescinded` note's `Operator` is anything other than the
 * literal `"brad"`. This is what makes "a human fact cannot impersonate a
 * provider event" (and vice versa) a property of every note this codebase
 * will ever read back, not merely of the notes this codebase itself
 * writes.
 *
 * RAW PROVIDER EVIDENCE IS PRESERVED SEPARATELY FROM THE NORMALIZED STATE
 * (Jess Gate repair round, 2026-09-12, item 3). `Event kind` carries the
 * NORMALIZED IAOS status (e.g. `"sent"`, `"unknown"`); `Raw provider
 * status`, `Raw is expired`, `Raw deleted`, and `Recipients completed`/
 * `Recipients total` carry the provider's own opaque, as-reported facts
 * -- including an unmapped/unrecognized raw status string that produced a
 * normalized `"unknown"`. The two are never conflated: a reader can
 * always distinguish "what IAOS concluded" from "what the provider
 * literally said."
 *
 * APPEND-ONLY, NEVER RESOLVED-TO-ONE. Unlike `contract-send-carriers.ts`'s
 * `latestContractSendForOpportunity` (which collapses a multi-note attempt
 * lifecycle down to ONE current record because an attempt genuinely has a
 * single current status), this module's `allContractLifecycleRecordsFor`
 * returns EVERY parsed record for an opportunity, unfiltered and
 * unresolved -- duplicates included. Order is NOT guaranteed here --
 * callers wanting chronology use `contract-lifecycle-model.ts`'s
 * `orderRecordsChronologically` explicitly, so "what order" is always a
 * visible, separate decision.
 *
 * Embedded newlines in free-text fields (`evidenceSummary`, `reason`/
 * `reasonOrEvidence`) would break this schema's one-line-per-field
 * contract on read-back -- `formatContractLifecycleNote` replaces any
 * `\n` in those fields with a single space before writing, so a note this
 * module writes always round-trips through its own parser. Callers should
 * keep these fields short, single-line, and non-secret.
 */

function ledgerValue(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "UNAVAILABLE" : String(value);
}

function ledgerBooleanValue(value: boolean | null): string {
  return value === null ? "UNAVAILABLE" : value ? "true" : "false";
}

function parseLedgerBoolean(raw: string): { ok: true; value: boolean | null } | { ok: false } {
  if (raw === "UNAVAILABLE") return { ok: true, value: null };
  if (raw === "true") return { ok: true, value: true };
  if (raw === "false") return { ok: true, value: false };
  return { ok: false };
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

/** A non-negative integer literal exactly (rejects "3.5", "-1", "", "abc", leading/trailing whitespace). */
function parseNonNegativeInt(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

import {
  type ContractVersionIdentity,
  type MaterialConflict,
} from "./board9-contract-model";
import {
  type LifecycleRecord,
  type ProviderLifecycleStatus,
  PROVIDER_LIFECYCLE_STATUSES,
} from "./contract-lifecycle-model";

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

const MATERIAL_CONFLICT_KEYS = ["field", "agreementValue", "candidateValue"] as const;
function isMaterialConflict(v: unknown): v is MaterialConflict {
  if (!isPlainObject(v)) return false;
  if (!hasExactKeys(v, MATERIAL_CONFLICT_KEYS)) return false;
  if (v.field !== "price" && v.field !== "property_address" && v.field !== "parties") return false;
  return typeof v.agreementValue === "string" && typeof v.candidateValue === "string";
}

/** Every lifecycle event kind this ledger can hold -- the nine provider statuses plus the four human-recorded kinds. `"operator_declined"` is deliberately distinct from the provider status `"declined"` -- the two must never collide in the shared `Event kind` column. */
export type LifecycleEventKind = ProviderLifecycleStatus | "corrected" | "resent" | "rescinded" | "operator_declined";
const HUMAN_EVENT_KINDS = ["corrected", "resent", "rescinded", "operator_declined"] as const;
const ALL_EVENT_KINDS: readonly LifecycleEventKind[] = [...PROVIDER_LIFECYCLE_STATUSES, ...HUMAN_EVENT_KINDS];

export const CONTRACT_LIFECYCLE_LEDGER_VERSION = "iaos-contract-lifecycle-v1" as const;
const HEADER = `IAOS CONTRACT LIFECYCLE — ${CONTRACT_LIFECYCLE_LEDGER_VERSION}`;
const LABELS = [
  "Recorded at",
  "Opportunity",
  "Event kind",
  "Version",
  "Provider document id",
  "Provider document reference",
  "Provider document revision",
  "Provider reported at",
  "Raw provider status",
  "Raw is expired",
  "Raw deleted",
  "Recipients completed",
  "Recipients total",
  "Authority",
  "Operator",
  "Authorized at",
  "Evidence summary",
  "Related prior record id",
  "Detail",
] as const;

type CorrectionDetail = { priorVersion: ContractVersionIdentity; classification: "new_agreement_required" | "same_agreement_reentry"; materialConflicts: MaterialConflict[] };
type ResendDetail = { priorAttemptId: string; newAttemptId: string };
type RescissionDetail = { reason: string };
type DeclineDetail = { reasonOrEvidence: string };

function formatDetail(record: LifecycleRecord): string {
  if (record.kind === "correction") {
    const detail: CorrectionDetail = {
      priorVersion: record.priorVersion,
      classification: record.classification,
      materialConflicts: record.materialConflicts,
    };
    return JSON.stringify(detail);
  }
  if (record.kind === "resend") {
    const detail: ResendDetail = { priorAttemptId: record.priorAttemptId, newAttemptId: record.newAttemptId };
    return JSON.stringify(detail);
  }
  if (record.kind === "rescission") {
    const detail: RescissionDetail = { reason: singleLine(record.reason) };
    return JSON.stringify(detail);
  }
  if (record.kind === "decline") {
    const detail: DeclineDetail = { reasonOrEvidence: singleLine(record.reasonOrEvidence) };
    return JSON.stringify(detail);
  }
  return "UNAVAILABLE";
}

/** Serializes ANY `LifecycleRecord` variant into the one shared note shape. Never mixes fields across kinds -- see module header. */
export function formatContractLifecycleNote(record: LifecycleRecord): string {
  const eventKind: LifecycleEventKind =
    record.kind === "provider_observation" ? record.status
    : record.kind === "correction" ? "corrected"
    : record.kind === "resend" ? "resent"
    : record.kind === "rescission" ? "rescinded"
    : "operator_declined";
  const version = record.kind === "correction" ? record.newVersion : record.version;
  const providerDocumentId =
    record.kind === "provider_observation" ? record.providerDocumentId
    : record.kind === "rescission" ? record.providerDocumentIdAtRescission
    : record.kind === "decline" ? record.providerDocumentIdAtDecline
    : null;
  const providerDocumentReference = record.kind === "provider_observation" ? record.providerDocumentReference : null;
  const providerDocumentRevision = record.kind === "provider_observation" ? record.providerDocumentRevision : null;
  const providerReportedAt = record.kind === "provider_observation" ? record.providerReportedAt : null;
  const rawProviderStatus = record.kind === "provider_observation" ? record.rawProviderStatus : null;
  const rawIsExpired = record.kind === "provider_observation" ? record.isExpired : null;
  const rawDeleted = record.kind === "provider_observation" ? record.deleted : null;
  const recipientsCompleted = record.kind === "provider_observation" ? (record.recipients?.completed ?? null) : null;
  const recipientsTotal = record.kind === "provider_observation" ? (record.recipients?.total ?? null) : null;
  const operator =
    record.kind === "correction" ? record.recordedBy
    : record.kind === "resend" ? record.authorizedBy
    : record.kind === "rescission" ? record.authorizedBy
    : record.kind === "decline" ? record.recordedBy
    : null;
  const authorizedAt =
    record.kind === "resend" ? record.authorizedAt
    : record.kind === "rescission" ? record.authorizedAt
    : record.kind === "decline" ? record.declinedAt
    : null;

  return [
    HEADER,
    `${LABELS[0]}: ${record.iaosObservedAt}`,
    `${LABELS[1]}: ${record.opportunityId}`,
    `${LABELS[2]}: ${eventKind}`,
    `${LABELS[3]}: ${formatVersionJson(version)}`,
    `${LABELS[4]}: ${ledgerValue(providerDocumentId)}`,
    `${LABELS[5]}: ${ledgerValue(providerDocumentReference)}`,
    `${LABELS[6]}: ${ledgerValue(providerDocumentRevision)}`,
    `${LABELS[7]}: ${ledgerValue(providerReportedAt)}`,
    `${LABELS[8]}: ${ledgerValue(rawProviderStatus)}`,
    `${LABELS[9]}: ${ledgerBooleanValue(rawIsExpired)}`,
    `${LABELS[10]}: ${ledgerBooleanValue(rawDeleted)}`,
    `${LABELS[11]}: ${ledgerValue(recipientsCompleted)}`,
    `${LABELS[12]}: ${ledgerValue(recipientsTotal)}`,
    `${LABELS[13]}: ${record.authority}`,
    `${LABELS[14]}: ${ledgerValue(operator)}`,
    `${LABELS[15]}: ${ledgerValue(authorizedAt)}`,
    `${LABELS[16]}: ${singleLine(record.evidenceSummary)}`,
    `${LABELS[17]}: ${ledgerValue(record.relatedPriorRecordId)}`,
    `${LABELS[18]}: ${formatDetail(record)}`,
  ].join("\n");
}

/**
 * Parses ANY note this module writes back into its exact `LifecycleRecord`
 * variant -- returns `null` (never a best-effort partial record) for
 * anything malformed, ambiguous, or carrying a fact its own kind does not
 * support. This is the read-side half of "a human fact cannot impersonate
 * a provider event, or vice versa": the checks below are not merely
 * mirrored from `formatContractLifecycleNote`, they are independently
 * re-verified on every read.
 */
export function parseContractLifecycleNote(body: string): LifecycleRecord | null {
  const values = matchPositionalSchema(body, HEADER, LABELS);
  if (!values) return null;
  const [
    at, opportunityId, eventKindRaw, versionRaw, providerDocumentIdRaw, providerDocumentReferenceRaw,
    providerDocumentRevisionRaw, providerReportedAtRaw, rawProviderStatusRaw, rawIsExpiredRaw, rawDeletedRaw,
    recipientsCompletedRaw, recipientsTotalRaw, authorityRaw, operatorRaw, authorizedAtRaw,
    evidenceSummary, relatedPriorRecordIdRaw, detailRaw,
  ] = values;

  if (opportunityId === "" || evidenceSummary === "") return null;
  if (!isCanonicalIsoTimestamp(at)) return null;
  if (!(ALL_EVENT_KINDS as readonly string[]).includes(eventKindRaw)) return null;
  const eventKind = eventKindRaw as LifecycleEventKind;

  const version = parseVersionJson(versionRaw);
  if (!version) return null;

  const providerDocumentId = providerDocumentIdRaw === "UNAVAILABLE" ? null : providerDocumentIdRaw;
  const providerDocumentReference = providerDocumentReferenceRaw === "UNAVAILABLE" ? null : providerDocumentReferenceRaw;
  const providerDocumentRevisionParsed = providerDocumentRevisionRaw === "UNAVAILABLE" ? null : Number(providerDocumentRevisionRaw);
  if (providerDocumentRevisionRaw !== "UNAVAILABLE" && (!Number.isFinite(providerDocumentRevisionParsed) || !Number.isInteger(providerDocumentRevisionParsed))) return null;
  const providerReportedAt = providerReportedAtRaw === "UNAVAILABLE" ? null : providerReportedAtRaw;
  if (providerReportedAt !== null && !isCanonicalIsoTimestamp(providerReportedAt)) return null;

  const rawProviderStatus = rawProviderStatusRaw === "UNAVAILABLE" ? null : rawProviderStatusRaw;
  const isExpiredParsed = parseLedgerBoolean(rawIsExpiredRaw);
  if (!isExpiredParsed.ok) return null;
  const deletedParsed = parseLedgerBoolean(rawDeletedRaw);
  if (!deletedParsed.ok) return null;
  const recipientsCompletedParsed = recipientsCompletedRaw === "UNAVAILABLE" ? null : parseNonNegativeInt(recipientsCompletedRaw);
  if (recipientsCompletedRaw !== "UNAVAILABLE" && recipientsCompletedParsed === null) return null;
  const recipientsTotalParsed = recipientsTotalRaw === "UNAVAILABLE" ? null : parseNonNegativeInt(recipientsTotalRaw);
  if (recipientsTotalRaw !== "UNAVAILABLE" && recipientsTotalParsed === null) return null;
  // Both present or both absent, and completed can never exceed total.
  if ((recipientsCompletedParsed === null) !== (recipientsTotalParsed === null)) return null;
  if (recipientsCompletedParsed !== null && recipientsTotalParsed !== null && recipientsCompletedParsed > recipientsTotalParsed) return null;
  const recipients = recipientsCompletedParsed !== null && recipientsTotalParsed !== null
    ? { total: recipientsTotalParsed, completed: recipientsCompletedParsed }
    : null;

  const operator = operatorRaw === "UNAVAILABLE" ? null : operatorRaw;
  const authorizedAt = authorizedAtRaw === "UNAVAILABLE" ? null : authorizedAtRaw;
  const relatedPriorRecordId = relatedPriorRecordIdRaw === "UNAVAILABLE" ? null : relatedPriorRecordIdRaw;

  const isProviderKind = (PROVIDER_LIFECYCLE_STATUSES as readonly string[]).includes(eventKind);

  if (isProviderKind) {
    // A provider fact can NEVER carry a human authority, an operator, an
    // authorization timestamp, or a Detail payload -- any of these present
    // means the note is malformed or tampered; reject outright.
    if (authorityRaw !== "provider_reported") return null;
    if (operator !== null || authorizedAt !== null) return null;
    if (detailRaw !== "UNAVAILABLE") return null;
    if (providerDocumentId === null) return null;
    return {
      kind: "provider_observation",
      opportunityId,
      version,
      status: eventKind as ProviderLifecycleStatus,
      rawProviderStatus,
      isExpired: isExpiredParsed.value,
      deleted: deletedParsed.value,
      recipients,
      providerDocumentId,
      providerDocumentReference,
      providerDocumentRevision: providerDocumentRevisionParsed,
      providerReportedAt,
      iaosObservedAt: at,
      authority: "provider_reported",
      evidenceSummary,
      relatedPriorRecordId,
    };
  }

  // Every human-recorded kind below carries NO raw provider evidence at
  // all -- a human fact cannot impersonate a provider event (Jess Gate
  // repair round, 2026-09-12, item 2/3's read-side counterpart).
  if (
    providerDocumentReference !== null || providerDocumentRevisionParsed !== null || providerReportedAt !== null ||
    rawProviderStatus !== null || isExpiredParsed.value !== null || deletedParsed.value !== null || recipients !== null
  ) {
    return null;
  }

  if (eventKind === "corrected") {
    if (authorityRaw !== "operator_attested") return null;
    if (operator === null) return null;
    if (authorizedAt !== null) return null;
    // A correction carries no provider document id at all -- it is an
    // IAOS/human-side product-record event, never a provider observation.
    if (providerDocumentId !== null) return null;
    const detailParsed = safeJsonParse(detailRaw);
    if (!detailParsed.ok || !isPlainObject(detailParsed.value)) return null;
    const d = detailParsed.value;
    if (!hasExactKeys(d, ["priorVersion", "classification", "materialConflicts"])) return null;
    const priorVersionRaw = d.priorVersion;
    if (!isPlainObject(priorVersionRaw)) return null;
    const priorVersion = parseVersionJson(JSON.stringify(priorVersionRaw));
    if (!priorVersion) return null;
    if (d.classification !== "new_agreement_required" && d.classification !== "same_agreement_reentry") return null;
    if (!Array.isArray(d.materialConflicts) || !d.materialConflicts.every(isMaterialConflict)) return null;
    return {
      kind: "correction",
      opportunityId,
      priorVersion,
      newVersion: version,
      classification: d.classification,
      materialConflicts: d.materialConflicts,
      recordedBy: operator,
      iaosObservedAt: at,
      authority: "operator_attested",
      evidenceSummary,
      relatedPriorRecordId,
    };
  }

  if (eventKind === "operator_declined") {
    if (authorityRaw !== "operator_attested") return null;
    if (operator === null) return null;
    // Declined always requires the agreement to have reached Contract
    // Sent -- a real provider document id is therefore always required,
    // unlike Rescission's conditional one.
    if (providerDocumentId === null) return null;
    if (authorizedAt === null || !isCanonicalIsoTimestamp(authorizedAt)) return null;
    const detailParsed = safeJsonParse(detailRaw);
    if (!detailParsed.ok || !isPlainObject(detailParsed.value)) return null;
    const d = detailParsed.value;
    if (!hasExactKeys(d, ["reasonOrEvidence"])) return null;
    if (typeof d.reasonOrEvidence !== "string" || d.reasonOrEvidence.trim() === "") return null;
    return {
      kind: "decline",
      opportunityId,
      version,
      reasonOrEvidence: d.reasonOrEvidence,
      recordedBy: operator,
      declinedAt: authorizedAt,
      providerDocumentIdAtDecline: providerDocumentId,
      iaosObservedAt: at,
      authority: "operator_attested",
      evidenceSummary,
      relatedPriorRecordId,
    };
  }

  // Remaining kinds ("resent", "rescinded") are both brad_authorized --
  // the literal operator identity is enforced here, on read, not merely
  // trusted from what a caller once wrote.
  if (authorityRaw !== "brad_authorized") return null;
  if (operator !== "brad") return null;
  if (authorizedAt === null || !isCanonicalIsoTimestamp(authorizedAt)) return null;

  if (eventKind === "resent") {
    if (providerDocumentId !== null) return null;
    const detailParsed = safeJsonParse(detailRaw);
    if (!detailParsed.ok || !isPlainObject(detailParsed.value)) return null;
    const d = detailParsed.value;
    if (!hasExactKeys(d, ["priorAttemptId", "newAttemptId"])) return null;
    if (typeof d.priorAttemptId !== "string" || d.priorAttemptId === "") return null;
    if (typeof d.newAttemptId !== "string" || d.newAttemptId === "" || d.newAttemptId === d.priorAttemptId) return null;
    return {
      kind: "resend",
      opportunityId,
      version,
      priorAttemptId: d.priorAttemptId,
      newAttemptId: d.newAttemptId,
      authorizedBy: operator,
      authorizedAt,
      recordedBy: operator,
      iaosObservedAt: at,
      authority: "brad_authorized",
      evidenceSummary,
      relatedPriorRecordId,
    };
  }

  // eventKind === "rescinded"
  const detailParsed = safeJsonParse(detailRaw);
  if (!detailParsed.ok || !isPlainObject(detailParsed.value)) return null;
  const d = detailParsed.value;
  if (!hasExactKeys(d, ["reason"])) return null;
  if (typeof d.reason !== "string" || d.reason.trim() === "") return null;
  return {
    kind: "rescission",
    opportunityId,
    version,
    reason: d.reason,
    authorizedBy: operator,
    authorizedAt,
    providerDocumentIdAtRescission: providerDocumentId,
    iaosObservedAt: at,
    authority: "brad_authorized",
    evidenceSummary,
    relatedPriorRecordId,
  };
}

/**
 * EVERY parsed lifecycle record for one Opportunity -- append-only,
 * unresolved, unfiltered, duplicates included. This is deliberately NOT a
 * "latest wins" resolver (contrast `contract-send-carriers.ts`'s
 * `latestContractSendForOpportunity`): the whole point of this ledger is
 * that no earlier send, correction, resend, decline, expiration,
 * completion, or rescission record is ever superseded or hidden by a
 * later one.
 */
export function allContractLifecycleRecordsForOpportunity(
  notes: { body: string }[],
  opportunityId: string,
): LifecycleRecord[] {
  const out: LifecycleRecord[] = [];
  for (const note of notes) {
    const parsed = parseContractLifecycleNote(note.body);
    if (!parsed || parsed.opportunityId !== opportunityId) continue;
    out.push(parsed);
  }
  return out;
}
