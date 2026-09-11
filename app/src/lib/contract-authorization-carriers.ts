/**
 * Brad contract review authorization -- durable carrier. B9-07 / INV-62.
 *
 * Pure. No I/O, no React. One format/parse/latest triple, following the
 * SAME proven pattern every other B8/B9 carrier file in this codebase
 * uses (a versioned header line, one fact per line, POSITIONAL parsing,
 * a canonical ISO timestamp that must round-trip through `toISOString()`,
 * "latest entry wins, scoped to ONE Opportunity"). Local helpers are
 * duplicated rather than imported, exactly as `seller-contract-facts-
 * carriers.ts`'s own header states of its relationship to `seller-call-
 * readiness-carriers.ts` -- the PATTERN is reused, not the code, so this
 * file has no import-time coupling to any other carrier file. Every
 * entry is a NEW append-only note; nothing here ever overwrites or
 * deletes a prior one. The caller is responsible for `ghl.notes.create()`,
 * one of AGENTS.md's three sanctioned writes -- this module performs no
 * write itself.
 *
 * NO REVOKE WRITE, BY DESIGN. Revocation is DERIVED, never a separate
 * note -- the same "Contract Ready is a derived result, not a persisted
 * flag" discipline `board9-contract-model.ts` already applies.
 * `contract-authorization-model.ts`'s `evaluateBradAuthorizationCurrency`
 * recomputes currency fresh every time by comparing the latest
 * authorization record's own snapshot/version against the live current
 * preview -- a material change simply means the latest record no longer
 * matches, with no explicit "revoked" flag anywhere that could fall out
 * of sync with reality.
 *
 * `authorizedBy` IS STORED AS A PLAIN STRING HERE, VALIDATED ELSEWHERE.
 * This carrier validates only that a non-empty string is present -- the
 * semantic rule ("must be exactly the literal `brad`") is enforced by
 * `contract-authorization-model.ts`, mirroring exactly how
 * `board9-contract-model.ts` itself splits this concern for Rescission
 * (`RescissionRecord.authorizedBy` is a plain string at the type level;
 * `args.rescission.authorizedBy !== "brad"` is a MODEL-layer check, never
 * a carrier-layer one).
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

/** Structurally identical to `board9-contract-model.ts`'s own `ContractVersionIdentity` -- imported there as a type only (zero runtime coupling) so this carrier never drifts from that shape. */
import type { ContractVersionIdentity } from "./board9-contract-model";

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

/** Mirrors `contract-document-model.ts`'s own `ContractDocumentLine`, reduced to exactly the fields authorization needs to compare/diff -- never the full line (label/authority/recordedAt are display metadata, not the material fact itself). */
export type AuthorizedLineSnapshot = { group: string; field: string; status: string; text: string | null };

const LINE_SNAPSHOT_KEYS = ["group", "field", "status", "text"] as const;

function isAuthorizedLineSnapshot(v: unknown): v is AuthorizedLineSnapshot {
  if (!isPlainObject(v)) return false;
  if (!hasExactKeys(v, LINE_SNAPSHOT_KEYS)) return false;
  if (typeof v.group !== "string" || v.group === "") return false;
  if (typeof v.field !== "string" || v.field === "") return false;
  if (typeof v.status !== "string" || v.status === "") return false;
  if (v.text !== null && typeof v.text !== "string") return false;
  return true;
}

function formatLineSnapshotsJson(lines: AuthorizedLineSnapshot[]): string {
  return JSON.stringify(lines);
}
function parseLineSnapshotsJson(raw: string): AuthorizedLineSnapshot[] | null {
  const parsed = safeJsonParse(raw);
  if (!parsed.ok || !Array.isArray(parsed.value)) return null;
  const lines: AuthorizedLineSnapshot[] = [];
  for (const item of parsed.value) {
    if (!isAuthorizedLineSnapshot(item)) return null;
    lines.push(item);
  }
  return lines;
}

export const BRAD_CONTRACT_AUTHORIZATION_LEDGER_VERSION = "iaos-brad-contract-authorization-v1" as const;
const HEADER = `IAOS BRAD CONTRACT AUTHORIZATION — ${BRAD_CONTRACT_AUTHORIZATION_LEDGER_VERSION}`;
const LABELS = [
  "Recorded at", "Operator", "Opportunity", "Authorized by", "Version",
  "Template name", "Template source", "Document lines", "Additional required facts",
] as const;

export type ParsedBradContractAuthorization = {
  opportunityId: string;
  at: string;
  operator: string | null;
  authorizedBy: string;
  version: ContractVersionIdentity;
  templateName: string;
  templateSource: string;
  documentLines: AuthorizedLineSnapshot[];
  additionalRequiredFacts: AuthorizedLineSnapshot[];
};

export function formatBradContractAuthorizationNote(args: {
  opportunityId: string;
  at: string;
  operator: string | null;
  authorizedBy: string;
  version: ContractVersionIdentity;
  templateName: string;
  templateSource: string;
  documentLines: AuthorizedLineSnapshot[];
  additionalRequiredFacts: AuthorizedLineSnapshot[];
}): string {
  return [
    HEADER,
    `${LABELS[0]}: ${args.at}`,
    `${LABELS[1]}: ${ledgerValue(args.operator)}`,
    `${LABELS[2]}: ${args.opportunityId}`,
    `${LABELS[3]}: ${args.authorizedBy}`,
    `${LABELS[4]}: ${formatVersionJson(args.version)}`,
    `${LABELS[5]}: ${args.templateName}`,
    `${LABELS[6]}: ${args.templateSource}`,
    `${LABELS[7]}: ${formatLineSnapshotsJson(args.documentLines)}`,
    `${LABELS[8]}: ${formatLineSnapshotsJson(args.additionalRequiredFacts)}`,
  ].join("\n");
}

export function parseBradContractAuthorizationNote(body: string): ParsedBradContractAuthorization | null {
  const values = matchPositionalSchema(body, HEADER, LABELS);
  if (!values) return null;
  const [at, operatorRaw, opportunityId, authorizedBy, versionRaw, templateName, templateSource, docLinesRaw, additionalRaw] = values;
  if (opportunityId === "" || authorizedBy === "" || templateName === "" || templateSource === "") return null;
  if (!isCanonicalIsoTimestamp(at)) return null;
  const version = parseVersionJson(versionRaw);
  if (!version) return null;
  const documentLines = parseLineSnapshotsJson(docLinesRaw);
  if (!documentLines) return null;
  const additionalRequiredFacts = parseLineSnapshotsJson(additionalRaw);
  if (!additionalRequiredFacts) return null;
  return {
    opportunityId,
    at,
    operator: operatorRaw === "UNAVAILABLE" ? null : operatorRaw,
    authorizedBy,
    version,
    templateName,
    templateSource,
    documentLines,
    additionalRequiredFacts,
  };
}

export function latestBradContractAuthorizationForOpportunity(
  notes: { body: string }[],
  opportunityId: string,
): ParsedBradContractAuthorization | null {
  let latest: ParsedBradContractAuthorization | null = null;
  for (const note of notes) {
    const parsed = parseBradContractAuthorizationNote(note.body);
    if (!parsed || parsed.opportunityId !== opportunityId) continue;
    if (!latest || new Date(parsed.at).getTime() > new Date(latest.at).getTime()) latest = parsed;
  }
  return latest;
}
