/**
 * Repair-save completion evidence -- pure formatting and parsing (B15-26 B1
 * completion contract r1 + r2 + r3 + r4). No I/O, no network, no clock.
 *
 * Owns the exact rules shared by the same-process verifier and the
 * cross-session reader in blob-authority.ts:
 *   - the canonical repair payload and its opId-free digest P (r1 §1);
 *   - the evidence note E: deterministic rendering, and a STRICT parse that
 *     re-renders and requires byte equality (r3 C1);
 *   - "exactly one entry" for each binding custom field before any value is
 *     compared; duplicates (even identical) and ambiguous values are never
 *     resolved by picking an entry (r4 D2);
 *   - the usable created-note id (Bones finding 3 on c1b9de6) and the
 *     well-formed-identifier rule used to classify a by-ID note readback
 *     (contract r5.1 K1: missing/malformed = unreadable; present, well-formed
 *     but unequal = mismatch).
 *
 * r5.1 (N0): evidence is reached ONLY through the note id recorded for the
 * op. There is deliberately no helper here that lists notes or finds E by
 * its text (the c1b9de6/566001c notes-list contract and Operation-line
 * search are removed).
 *
 * The durable copy of the payload is E itself (r3 C1). The per-line repair
 * answers are not retained anywhere; the binding is to basisDigest only.
 * Under integrity option I2 E is recorded evidence, not tamper-proof.
 */
import { createHash } from "node:crypto";

export const EVIDENCE_HEADER = "IAOS REPAIR APPROVAL EVIDENCE — iaos-repair-approval-evidence-v1";
export const PAYLOAD_SCHEMA = "repair-approval-payload-v1";
const LABELS = ["Opportunity", "Contact", "Operation", "Operator", "Total", "Complete", "Line count", "Basis", "Payload digest", "Recorded at"] as const;
const HEX64 = /^[0-9a-f]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** The canonical repair payload (server-recomputed; incomplete estimates never reach admission). */
export type RepairPayload = {
  opportunityId: string;
  contactId: string;
  operator: string;
  total: number;
  complete: true;
  lineCount: number;
  basisDigest: string;
};

function canon(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(",")}}`;
}
const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const exactKeys = (v: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(v).length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(v, k));
/** One line of printable text: no control characters, no leading/trailing space, bounded. */
const lineSafe = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 512 && v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v);

/** Canonical currency text: cents at most, no trailing zeros, no exponent ("12500", "12500.5", "0.05"). */
export function canonicalCurrency(n: unknown): string | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1e12) return null;
  if (Math.round(n * 100) / 100 !== n) return null;
  const s = String(n);
  return /^(0|[1-9]\d*)(\.\d{1,2})?$/.test(s) ? s : null;
}
function parseCurrency(s: string): number | null {
  if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return canonicalCurrency(n) === s ? n : null;
}

/** Exact-shape validation; returns a fresh frozen copy or null. */
export function validatePayload(p: unknown): RepairPayload | null {
  if (!isPlain(p) || !exactKeys(p, ["opportunityId", "contactId", "operator", "total", "complete", "lineCount", "basisDigest"])) return null;
  if (!lineSafe(p.opportunityId) || !lineSafe(p.contactId) || !lineSafe(p.operator)) return null;
  if (canonicalCurrency(p.total) === null || p.complete !== true) return null;
  if (typeof p.lineCount !== "number" || !Number.isSafeInteger(p.lineCount) || p.lineCount < 1) return null;
  if (typeof p.basisDigest !== "string" || !HEX64.test(p.basisDigest)) return null;
  return Object.freeze({ opportunityId: p.opportunityId, contactId: p.contactId, operator: p.operator, total: p.total as number, complete: true, lineCount: p.lineCount, basisDigest: p.basisDigest });
}

/** P = sha256(canonical({schema, ...payload})). opId-free: opId does not exist until admission. */
export function payloadDigest(p: RepairPayload): string {
  return createHash("sha256").update(canon({ schema: PAYLOAD_SCHEMA, ...p }), "utf8").digest("hex");
}

export type EvidenceOp = { opId: string; admittedAt: string };

/** The exact evidence note body E(op, payload). */
export function renderEvidence(op: EvidenceOp, p: RepairPayload): string {
  const values = [p.opportunityId, p.contactId, op.opId, p.operator, canonicalCurrency(p.total), "true", String(p.lineCount), p.basisDigest, payloadDigest(p), op.admittedAt];
  return [EVIDENCE_HEADER, ...LABELS.map((l, i) => `${l}: ${values[i]}`)].join("\n");
}

export type ParsedEvidence = { opId: string; admittedAt: string; payload: RepairPayload; digestLine: string };

/**
 * Strict parse: exact header, exactly the fixed labels in order, each value
 * well-formed; then re-render E(op, payload') and require byte equality with
 * the input (rejects extra lines, reordering, non-canonical formatting).
 * Does NOT compare against any record -- callers do that (P' vs A).
 */
export function parseEvidence(body: unknown): ParsedEvidence | null {
  if (typeof body !== "string") return null;
  const lines = body.split("\n");
  if (lines.length !== LABELS.length + 1 || lines[0] !== EVIDENCE_HEADER) return null;
  const v: string[] = [];
  for (let i = 0; i < LABELS.length; i++) {
    const prefix = `${LABELS[i]}: `;
    const line = lines[i + 1];
    if (!line.startsWith(prefix)) return null;
    v.push(line.slice(prefix.length));
  }
  const [opportunityId, contactId, opId, operator, totalText, complete, lineCountText, basisDigest, digestLine, admittedAt] = v;
  const total = parseCurrency(totalText);
  if (total === null || complete !== "true" || !/^[1-9]\d{0,8}$/.test(lineCountText)) return null;
  if (!HEX64.test(digestLine) || !ISO.test(admittedAt) || !lineSafe(opId)) return null;
  const payload = validatePayload({ opportunityId, contactId, operator, total, complete: true, lineCount: Number(lineCountText), basisDigest });
  if (!payload) return null;
  if (renderEvidence({ opId, admittedAt }, payload) !== body) return null;
  return { opId, admittedAt, payload, digestLine };
}

export type FieldRead =
  | { kind: "one"; value: number | string }
  | { kind: "none" }
  | { kind: "duplicate" }
  | { kind: "ambiguous" };

/**
 * r4 D2: count entries for `fieldId` FIRST. Zero -> none; two or more (even
 * identical) -> duplicate; exactly one -> its singular `fieldValue` must be
 * one scalar of the expected type, else ambiguous. Never picks an entry.
 */
export function readExactlyOneField(customFields: unknown, fieldId: string, type: "number" | "string"): FieldRead {
  if (!Array.isArray(customFields)) return { kind: "ambiguous" };
  const entries = customFields.filter((e) => isPlain(e) && e.id === fieldId);
  if (entries.length === 0) return { kind: "none" };
  if (entries.length > 1) return { kind: "duplicate" };
  const raw = (entries[0] as Record<string, unknown>).fieldValue;
  if (type === "number") return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? { kind: "one", value: raw } : { kind: "ambiguous" };
  return typeof raw === "string" && raw.length > 0 && raw.length <= 512 && raw === raw.trim() ? { kind: "one", value: raw } : { kind: "ambiguous" };
}

/** A well-formed identifier value in a readback (e.g. a note's contactId): one line of printable text, bounded. */
export function wellFormedId(v: unknown): v is string {
  return lineSafe(v);
}

/** A usable GHL note id from a create-note response: one bounded token of [A-Za-z0-9_-]. */
export function usableNoteId(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
}
