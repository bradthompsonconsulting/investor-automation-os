/**
 * Contract Sent -- durable send-attempt/result carrier. B9-08 / INV-63.
 *
 * Pure. No I/O, no React. Same proven per-file carrier pattern as every
 * other B8/B9 carrier (versioned header, positional parsing, canonical ISO
 * timestamp, "latest wins scoped to one Opportunity"). Local helpers are
 * duplicated rather than imported, matching every prior carrier file's own
 * stated relationship to its siblings. Every entry is a NEW append-only
 * note; the caller is responsible for `ghl.notes.create()`, one of
 * AGENTS.md's three sanctioned writes -- this module performs no write.
 *
 * ONE NOTE SHAPE, WRITTEN UP TO THREE TIMES PER REAL ATTEMPT (correction
 * round, 2026-09-11 -- was two). `attemptId` (the attempt's own
 * `requestAt` ISO timestamp) correlates every write for one real send:
 * (1) a `status: "in_progress"` note, written server-side by the
 * dedicated reservation endpoint BEFORE the provider call (see
 * `netlify/functions/ghl-contract-send-reserve.ts`) -- alone enough to
 * make a concurrent or retried attempt against the SAME exact revision
 * fail closed (`contract-send-model.ts`'s idempotency guard reads this
 * back, and the reservation endpoint itself re-checks server-side); (2)
 * a `status: "provider_accepted_pending_readback" | "failed" |
 * "ambiguous"` note once the provider's POST response resolves -- a
 * successful POST is NEVER written as `"accepted"` directly (item 5,
 * INV-63 correction: "a successful POST response is not sufficient");
 * (3) ONLY when (2) was `provider_accepted_pending_readback`, a final
 * `status: "accepted" | "failed" | "ambiguous"` note once an independent
 * provider READBACK (`GET /proposals/document`, i.e. List Documents)
 * has confirmed the created document, its recipient, its sender, and
 * that it actually carries fillable fields -- see `contract-send-
 * model.ts`'s `classifyDocumentReadback`. The latest note for a given
 * `attemptId`, resolved by pending-vs-terminal rank (never by `at` alone
 * -- see `latestContractSendForOpportunity`), governs that attempt's
 * current status; there is no separate "revoke" write, matching every
 * other B9 carrier's "revocation/resolution is derived from the latest
 * entry" discipline.
 *
 * NO PROVIDER-SIDE SECRET IS EVER STORED HERE. `providerResponseSummary`
 * is a small, pre-selected set of non-secret response fields
 * (documentId, documentRevision, recipientId) -- never a raw
 * Authorization header, token, or the full unfiltered response body.
 *
 * `confirmedRecipientId` (correction round, 2026-09-11 -- was
 * `providerContactId`, a client-supplied placeholder the client
 * structurally cannot know truthfully, since `ghl-proxy.ts`'s GATE 2
 * overwrites the real recipient server-side and never returns it to the
 * browser ahead of the send). This field is `null` on the `in_progress`
 * note -- there is nothing true to record yet -- and is populated ONLY
 * from the PROVIDER'S OWN echoed `recipientId` once a response exists,
 * never from IAOS's own intended value.
 */

function ledgerValue(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "UNAVAILABLE" : String(value);
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

import type { ContractVersionIdentity } from "./board9-contract-model";
import type { AuthorizedLineSnapshot } from "./contract-authorization-carriers";

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

const SIGNER_SNAPSHOT_KEYS = ["role", "displayName"] as const;
export type SignerSnapshot = { role: string; displayName: string };
function isSignerSnapshot(v: unknown): v is SignerSnapshot {
  if (!isPlainObject(v)) return false;
  if (!hasExactKeys(v, SIGNER_SNAPSHOT_KEYS)) return false;
  return typeof v.role === "string" && v.role !== "" && typeof v.displayName === "string" && v.displayName !== "";
}
function formatSignersJson(signers: SignerSnapshot[]): string {
  return JSON.stringify(signers);
}
function parseSignersJson(raw: string): SignerSnapshot[] | null {
  const parsed = safeJsonParse(raw);
  if (!parsed.ok || !Array.isArray(parsed.value)) return null;
  const out: SignerSnapshot[] = [];
  for (const item of parsed.value) {
    if (!isSignerSnapshot(item)) return null;
    out.push(item);
  }
  return out;
}

/**
 * Pre-selected, non-secret fields from the provider's own send/document
 * response -- never the raw body. Correction round, 2026-09-11: extended
 * with `createdBy` (the provider-echoed sender/creator id, `links[].
 * createdBy` in both the Send Template and List Documents response
 * shapes -- verified directly from GHL's own reference pages) and three
 * READBACK-ONLY facts (`readbackStatus`, `readbackLocationId`,
 * `fillableFieldCount`), populated ONLY once an independent `GET
 * /proposals/document` (List Documents) readback has actually run --
 * `null` on the provisional POST-response summary. `fillableFieldCount`
 * is the durable evidence item 4/5 of the INV-63 correction round asks
 * for: whether the delivered document carries ANY fillable
 * (population/signature/initial/date) field at all.
 */
export type ProviderResponseSummary = {
  documentId: string | null;
  documentReference: string | null;
  documentRevision: number | null;
  recipientId: string | null;
  createdBy: string | null;
  readbackStatus: string | null;
  readbackLocationId: string | null;
  fillableFieldCount: number | null;
};
const PROVIDER_RESPONSE_KEYS = [
  "documentId", "documentReference", "documentRevision", "recipientId",
  "createdBy", "readbackStatus", "readbackLocationId", "fillableFieldCount",
] as const;
function formatProviderResponseJson(s: ProviderResponseSummary): string {
  return JSON.stringify(s);
}
function parseProviderResponseJson(raw: string): ProviderResponseSummary | null {
  const parsed = safeJsonParse(raw);
  if (!parsed.ok || !isPlainObject(parsed.value)) return null;
  const v = parsed.value;
  if (!hasExactKeys(v, PROVIDER_RESPONSE_KEYS)) return null;
  if (v.documentId !== null && typeof v.documentId !== "string") return null;
  if (v.documentReference !== null && typeof v.documentReference !== "string") return null;
  if (v.documentRevision !== null && typeof v.documentRevision !== "number") return null;
  if (v.recipientId !== null && typeof v.recipientId !== "string") return null;
  if (v.createdBy !== null && typeof v.createdBy !== "string") return null;
  if (v.readbackStatus !== null && typeof v.readbackStatus !== "string") return null;
  if (v.readbackLocationId !== null && typeof v.readbackLocationId !== "string") return null;
  if (v.fillableFieldCount !== null && typeof v.fillableFieldCount !== "number") return null;
  return {
    documentId: v.documentId as string | null,
    documentReference: v.documentReference as string | null,
    documentRevision: v.documentRevision as number | null,
    recipientId: v.recipientId as string | null,
    createdBy: v.createdBy as string | null,
    readbackStatus: v.readbackStatus as string | null,
    readbackLocationId: v.readbackLocationId as string | null,
    fillableFieldCount: v.fillableFieldCount as number | null,
  };
}

export type ContractSendStatus =
  | "in_progress"
  | "provider_accepted_pending_readback"
  | "accepted"
  | "failed"
  | "ambiguous";

/** Pending statuses are never terminal and are always superseded by ANY later note for the same attemptId, pending or terminal, per rank -- see `latestContractSendForOpportunity`. */
const PENDING_RANK: Record<string, number> = { in_progress: 0, provider_accepted_pending_readback: 1 };
const TERMINAL_STATUSES = new Set(["accepted", "failed", "ambiguous"]);

export const CONTRACT_SEND_LEDGER_VERSION = "iaos-contract-send-v2" as const;
const HEADER = `IAOS CONTRACT SEND — ${CONTRACT_SEND_LEDGER_VERSION}`;
const LABELS = [
  "Recorded at", "Operator", "Opportunity", "Attempt id", "Status", "Version",
  "Template name", "Template source", "Requested template id", "Authorized at", "Signers", "Confirmed recipient id",
  "Expiration at", "Request at", "IAOS observed acceptance at", "Provider response", "Failure reason",
] as const;

export type ParsedContractSend = {
  opportunityId: string;
  at: string;
  operator: string | null;
  attemptId: string;
  status: ContractSendStatus;
  version: ContractVersionIdentity;
  templateName: string;
  templateSource: string;
  /** The verified, config-locked GHL templateId requested for this attempt -- item 2/6 of the INV-63 correction round: never resolved by a live name search, and the server (ghl-proxy.ts GATE 2) enforces this same value regardless of what any caller supplies. */
  requestedTemplateId: string;
  authorizedAt: string;
  signers: SignerSnapshot[];
  /** The provider's OWN echoed recipient id -- null until a provider response exists. Never IAOS's own intended value; see module header. */
  confirmedRecipientId: string | null;
  expirationAt: string;
  requestAt: string;
  /** OBSERVED-BY-IAOS acceptance time -- never claimed as the provider's own reported transmission time (that field is undocumented; see contract-send-model.ts header). */
  iaosObservedAcceptanceAt: string | null;
  providerResponse: ProviderResponseSummary | null;
  failureReason: string | null;
};

export function formatContractSendNote(args: {
  opportunityId: string;
  at: string;
  operator: string | null;
  attemptId: string;
  status: ContractSendStatus;
  version: ContractVersionIdentity;
  templateName: string;
  templateSource: string;
  requestedTemplateId: string;
  authorizedAt: string;
  signers: SignerSnapshot[];
  confirmedRecipientId: string | null;
  expirationAt: string;
  requestAt: string;
  iaosObservedAcceptanceAt: string | null;
  providerResponse: ProviderResponseSummary | null;
  failureReason: string | null;
}): string {
  return [
    HEADER,
    `${LABELS[0]}: ${args.at}`,
    `${LABELS[1]}: ${ledgerValue(args.operator)}`,
    `${LABELS[2]}: ${args.opportunityId}`,
    `${LABELS[3]}: ${args.attemptId}`,
    `${LABELS[4]}: ${args.status}`,
    `${LABELS[5]}: ${formatVersionJson(args.version)}`,
    `${LABELS[6]}: ${args.templateName}`,
    `${LABELS[7]}: ${args.templateSource}`,
    `${LABELS[8]}: ${args.requestedTemplateId}`,
    `${LABELS[9]}: ${args.authorizedAt}`,
    `${LABELS[10]}: ${formatSignersJson(args.signers)}`,
    `${LABELS[11]}: ${ledgerValue(args.confirmedRecipientId)}`,
    `${LABELS[12]}: ${args.expirationAt}`,
    `${LABELS[13]}: ${args.requestAt}`,
    `${LABELS[14]}: ${ledgerValue(args.iaosObservedAcceptanceAt)}`,
    `${LABELS[15]}: ${args.providerResponse ? formatProviderResponseJson(args.providerResponse) : "UNAVAILABLE"}`,
    `${LABELS[16]}: ${ledgerValue(args.failureReason)}`,
  ].join("\n");
}

export function parseContractSendNote(body: string): ParsedContractSend | null {
  const values = matchPositionalSchema(body, HEADER, LABELS);
  if (!values) return null;
  const [
    at, operatorRaw, opportunityId, attemptId, statusRaw, versionRaw, templateName, templateSource, requestedTemplateId,
    authorizedAt, signersRaw, confirmedRecipientIdRaw, expirationAt, requestAt, acceptedAtRaw, providerResponseRaw, failureReasonRaw,
  ] = values;
  if (opportunityId === "" || attemptId === "" || templateName === "" || templateSource === "" || requestedTemplateId === "") return null;
  if (!isCanonicalIsoTimestamp(at)) return null;
  if (!isCanonicalIsoTimestamp(attemptId)) return null;
  if (
    statusRaw !== "in_progress" &&
    statusRaw !== "provider_accepted_pending_readback" &&
    statusRaw !== "accepted" &&
    statusRaw !== "failed" &&
    statusRaw !== "ambiguous"
  ) return null;
  const version = parseVersionJson(versionRaw);
  if (!version) return null;
  if (!isCanonicalIsoTimestamp(authorizedAt)) return null;
  const signers = parseSignersJson(signersRaw);
  if (!signers) return null;
  if (!isCanonicalIsoTimestamp(expirationAt)) return null;
  if (!isCanonicalIsoTimestamp(requestAt)) return null;
  const iaosObservedAcceptanceAt = acceptedAtRaw === "UNAVAILABLE" ? null : acceptedAtRaw;
  if (iaosObservedAcceptanceAt !== null && !isCanonicalIsoTimestamp(iaosObservedAcceptanceAt)) return null;
  const providerResponse = providerResponseRaw === "UNAVAILABLE" ? null : parseProviderResponseJson(providerResponseRaw);
  if (providerResponseRaw !== "UNAVAILABLE" && !providerResponse) return null;
  return {
    opportunityId,
    at,
    operator: operatorRaw === "UNAVAILABLE" ? null : operatorRaw,
    attemptId,
    status: statusRaw,
    version,
    templateName,
    templateSource,
    requestedTemplateId,
    authorizedAt,
    signers,
    confirmedRecipientId: confirmedRecipientIdRaw === "UNAVAILABLE" ? null : confirmedRecipientIdRaw,
    expirationAt,
    requestAt,
    iaosObservedAcceptanceAt,
    providerResponse,
    failureReason: failureReasonRaw === "UNAVAILABLE" ? null : failureReasonRaw,
  };
}

/** The single most recent send ATTEMPT for this opportunity, resolved to its own latest note (by `at`) -- i.e. an "in_progress" note is superseded by its own later "accepted"/"failed"/"ambiguous" note for the SAME `attemptId`, but a different, older `attemptId`'s notes never resolve into a newer attempt's status. */
export function latestContractSendForOpportunity(
  notes: { body: string }[],
  opportunityId: string,
): ParsedContractSend | null {
  const parsedForOpp: ParsedContractSend[] = [];
  for (const note of notes) {
    const parsed = parseContractSendNote(note.body);
    if (!parsed || parsed.opportunityId !== opportunityId) continue;
    parsedForOpp.push(parsed);
  }
  if (parsedForOpp.length === 0) return null;

  // Group by attemptId, resolved by RANK, never by `at` alone -- a later
  // lifecycle stage ALWAYS supersedes an earlier one for the SAME
  // attemptId regardless of exact timestamp ordering (note-timestamp
  // precision must never be trusted to prove ordering when two writes
  // happen to carry the same instant -- observed: two writes issued in
  // the same test/process tick, or any GHL note-timestamp granularity
  // limit). Rank: in_progress (0) < provider_accepted_pending_readback
  // (1) < any terminal status (2). Only when both notes for one
  // attemptId carry the SAME rank (should occur only among terminal
  // statuses, and only if this module's own callers ever mis-wrote two
  // terminal notes for one attempt -- never expected in practice) does
  // this fall back to comparing `at`.
  const rankOf = (status: ContractSendStatus): number =>
    TERMINAL_STATUSES.has(status) ? 2 : (PENDING_RANK[status] ?? 0);
  const byAttempt = new Map<string, ParsedContractSend>();
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
    // pRank < existingRank: an earlier-lifecycle note can never override
    // a later one already on record.
  }

  // The most recent ATTEMPT overall is the one whose own `requestAt` is
  // latest -- requestAt is the attempt's own identity, stable across its
  // in_progress -> resolved lifecycle, so this picks the newest attempt
  // rather than whichever attempt happened to be written to last.
  let latest: ParsedContractSend | null = null;
  for (const p of byAttempt.values()) {
    if (!latest || new Date(p.requestAt).getTime() > new Date(latest.requestAt).getTime()) latest = p;
  }
  return latest;
}
