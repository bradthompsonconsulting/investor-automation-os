/**
 * Brad contract review authorization -- durable carrier. B9-07 / INV-62,
 * extended to schema v2 by Board #9 Phase B (live-data PDF generation
 * integration, 2026-09-18) to bind authorization to the exact generated
 * artifact.
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
 *
 * SCHEMA V2 -- ARTIFACT BINDING (Phase B). Before Phase A's live-data PDF
 * generator existed, "authorization" could only bind to the reviewed
 * CONTENT (a document-line snapshot + version + template identity) --
 * there was no PDF for it to bind to yet. Phase B's generator produces a
 * real, hashable artifact, so a v1-shaped record (content/version/template
 * only) is no longer sufficient to say "this exact generated PDF is
 * authorized" -- nothing tied the note to specific bytes. V2 adds four new
 * REQUIRED fields: `artifactSha256` (the generated PDF's own hash),
 * `sourcePdfSha256` (the canonical TREC 20-19 source hash the generator
 * verified against -- `inv67-pdf-render-core.cjs`'s own
 * `PINNED_SOURCE_SHA256`, never a caller-substituted value, per that
 * module's sealed-API guarantee), `generatorVersion` and `manifestVersion`
 * (`inv67-pdf-generator.cjs`'s `GENERATOR_VERSION` /
 * `inv67-pdf-render-core.cjs`'s `MANIFEST_VERSION` -- this file does not
 * import those constants, by design: a pure `src/lib` carrier has no
 * business depending on `app/scripts/` tooling; the CALLER, once a real
 * generation endpoint exists, supplies the exact strings that specific
 * generation run reported).
 *
 * LEGACY V1, PRESERVED BUT NEVER CURRENT. `BRAD_CONTRACT_AUTHORIZATION_
 * LEDGER_VERSION` bumps to `-v2`, and the v2 header line changes
 * accordingly -- a v1 note's header therefore never matches
 * `matchPositionalSchema`'s exact-header check here, so
 * `parseBradContractAuthorizationNote` (the CURRENT-schema parser) simply
 * does not recognize a v1 note at all; `latestBradContractAuthorizationFor
 * Opportunity` (which scans with that same parser) is correspondingly
 * blind to v1 notes -- an opportunity with ONLY a v1 authorization on
 * record reads as `NO_AUTHORIZATION_RECORDED`, never as "authorized."
 * This is deliberate and is exactly what "never treat a v1 record as
 * current authorization for a generated PDF" requires -- structurally,
 * not by a runtime special case. NO EXISTING NOTE IS EVER REWRITTEN OR
 * MIGRATED to reach this: the v1 shape/parser/formatter is preserved
 * verbatim below under explicit LEGACY names (`parseBradContractAuthorization
 * NoteLegacyV1`, `formatBradContractAuthorizationNoteLegacyV1`,
 * `latestLegacyBradContractAuthorizationV1ForOpportunity`) purely so a
 * historical v1 note already written to a real GHL Test location (from
 * pre-Phase-B testing sessions) can still be safely recognized/displayed
 * as "an old-format authorization exists, superseded" rather than reading
 * as unparseable junk -- it is NEVER wired into currency evaluation.
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

// ============================================================
// LEGACY V1 -- preserved verbatim (header/labels/shape/logic unchanged),
// under explicit legacy names. NEVER written by any code going forward,
// NEVER consulted by latestBradContractAuthorizationForOpportunity or
// evaluateBradAuthorizationCurrency. Exists only so a real v1 note already
// on a GHL Test location can still be safely recognized as "an old-format
// authorization exists" rather than unparseable junk. See module header.
// ============================================================

export const BRAD_CONTRACT_AUTHORIZATION_LEDGER_VERSION_V1 = "iaos-brad-contract-authorization-v1" as const;
const HEADER_V1 = `IAOS BRAD CONTRACT AUTHORIZATION — ${BRAD_CONTRACT_AUTHORIZATION_LEDGER_VERSION_V1}`;
const LABELS_V1 = [
  "Recorded at", "Operator", "Opportunity", "Authorized by", "Version",
  "Template name", "Template source", "Document lines", "Additional required facts",
] as const;

export type ParsedBradContractAuthorizationV1 = {
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

export function formatBradContractAuthorizationNoteLegacyV1(args: {
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
    HEADER_V1,
    `${LABELS_V1[0]}: ${args.at}`,
    `${LABELS_V1[1]}: ${ledgerValue(args.operator)}`,
    `${LABELS_V1[2]}: ${args.opportunityId}`,
    `${LABELS_V1[3]}: ${args.authorizedBy}`,
    `${LABELS_V1[4]}: ${formatVersionJson(args.version)}`,
    `${LABELS_V1[5]}: ${args.templateName}`,
    `${LABELS_V1[6]}: ${args.templateSource}`,
    `${LABELS_V1[7]}: ${formatLineSnapshotsJson(args.documentLines)}`,
    `${LABELS_V1[8]}: ${formatLineSnapshotsJson(args.additionalRequiredFacts)}`,
  ].join("\n");
}

export function parseBradContractAuthorizationNoteLegacyV1(body: string): ParsedBradContractAuthorizationV1 | null {
  const values = matchPositionalSchema(body, HEADER_V1, LABELS_V1);
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

/** Recognition only -- NEVER treated as current authorization for a generated PDF. See module header. */
export function latestLegacyBradContractAuthorizationV1ForOpportunity(
  notes: { body: string }[],
  opportunityId: string,
): ParsedBradContractAuthorizationV1 | null {
  let latest: ParsedBradContractAuthorizationV1 | null = null;
  for (const note of notes) {
    const parsed = parseBradContractAuthorizationNoteLegacyV1(note.body);
    if (!parsed || parsed.opportunityId !== opportunityId) continue;
    if (!latest || new Date(parsed.at).getTime() > new Date(latest.at).getTime()) latest = parsed;
  }
  return latest;
}

// ============================================================
// SCHEMA V2 -- current. Adds artifactSha256 / sourcePdfSha256 /
// generatorVersion / manifestVersion, all REQUIRED. See module header.
// ============================================================

export const BRAD_CONTRACT_AUTHORIZATION_LEDGER_VERSION = "iaos-brad-contract-authorization-v2" as const;
const HEADER = `IAOS BRAD CONTRACT AUTHORIZATION — ${BRAD_CONTRACT_AUTHORIZATION_LEDGER_VERSION}`;
const LABELS = [
  "Recorded at", "Operator", "Opportunity", "Authorized by", "Version",
  "Template name", "Template source", "Document lines", "Additional required facts",
  "Artifact SHA-256", "Source PDF SHA-256", "Generator version", "Manifest version",
] as const;

/** Exactly 64 lowercase hex characters -- the shape `sha256Hex` (inv67-pdf-render-core.cjs) always produces. Shape-only; this carrier never computes or verifies a hash itself. */
function isSha256Hex(v: string): boolean {
  return /^[0-9a-f]{64}$/.test(v);
}

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
  artifactSha256: string;
  sourcePdfSha256: string;
  generatorVersion: string;
  manifestVersion: string;
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
  artifactSha256: string;
  sourcePdfSha256: string;
  generatorVersion: string;
  manifestVersion: string;
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
    `${LABELS[9]}: ${args.artifactSha256}`,
    `${LABELS[10]}: ${args.sourcePdfSha256}`,
    `${LABELS[11]}: ${args.generatorVersion}`,
    `${LABELS[12]}: ${args.manifestVersion}`,
  ].join("\n");
}

export function parseBradContractAuthorizationNote(body: string): ParsedBradContractAuthorization | null {
  const values = matchPositionalSchema(body, HEADER, LABELS);
  if (!values) return null;
  const [
    at, operatorRaw, opportunityId, authorizedBy, versionRaw, templateName, templateSource,
    docLinesRaw, additionalRaw, artifactSha256, sourcePdfSha256, generatorVersion, manifestVersion,
  ] = values;
  if (opportunityId === "" || authorizedBy === "" || templateName === "" || templateSource === "") return null;
  if (!isCanonicalIsoTimestamp(at)) return null;
  if (!isSha256Hex(artifactSha256) || !isSha256Hex(sourcePdfSha256)) return null;
  if (generatorVersion === "" || manifestVersion === "") return null;
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
    artifactSha256,
    sourcePdfSha256,
    generatorVersion,
    manifestVersion,
  };
}

/** Scans with the CURRENT (v2) parser only -- a v1-only note is invisible here, never "latest." See module header. */
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
