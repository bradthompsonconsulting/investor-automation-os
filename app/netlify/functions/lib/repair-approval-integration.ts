/**
 * Repair-save completion integration -- server-side pieces shared by
 * repair-approval-save.ts and repair-approval-status.ts. Contracts r1 (§1
 * bindings), r2 (§1 owned dispatch), r3 (C1 reader), r4 (D2 fields) and r5.1
 * (by-id evidence), as accepted; the module (blob-authority.ts) is used
 * unchanged.
 *
 * Owns, and nothing else:
 *   - the configuration gate (enabled, environment, provisioned approval
 *     field, authority credentials): any gap -> refused, nothing sent, no
 *     fallback (never the legacy `opportunity.repairs` write);
 *   - strict validation of the submitted ANSWERS (the only estimate input a
 *     client may send: no total, contact, operator or opId is accepted);
 *   - the server recompute of the complete repair total, line count and
 *     basis digest from those answers with the shared calculation core;
 *   - the scope (one authoritative operation per opportunity).
 */
import { createHash } from "node:crypto";
import { REPAIR_APPROVAL_CONFIG, REPAIR_APPROVAL_FIELD_NOT_PROVISIONED, type SaveDeadlineConfig } from "../../../shared/repair-approval-config";
import { computeRepairEstimate } from "../../../src/lib/repair-estimation/compute";
import { OPERATOR_ROWS, buildLines, operatorEstimate, type Answers, type MiscAnswer, type OperatorCondition } from "../../../src/lib/repair-estimation/operator-model";
import { canonicalJson } from "./blob-authority";
import { canonicalCurrency } from "./repair-evidence";

export const BASIS_SCHEMA = "iaos-repair-basis-v1";
const CONDITIONS: readonly OperatorCondition[] = ["not_asked", "good", "repair", "severe"];
const SYSTEMS = new Set<string>(OPERATOR_ROWS.map((r) => r.system));

export type ApprovalSetup =
  | { kind: "ready"; env: "test"; approvalFieldId: string; siteID: string; token: string }
  | { kind: "not_configured"; code: string };

/** The configuration gate. Reads environment variables only; performs no I/O. */
export function approvalSetup(env: NodeJS.ProcessEnv = process.env, config = REPAIR_APPROVAL_CONFIG): ApprovalSetup {
  const name = String(env.IAOS_ENV ?? "");
  if (name !== "test" || !config.environments.includes(name)) return { kind: "not_configured", code: "environment_not_enabled" };
  const approvalFieldId = config.approvalFieldId.test;
  if (!approvalFieldId || approvalFieldId === REPAIR_APPROVAL_FIELD_NOT_PROVISIONED || !/^[A-Za-z0-9_-]{1,64}$/.test(approvalFieldId)) return { kind: "not_configured", code: "approval_field_not_provisioned" };
  const siteID = env.IAOS_REPAIR_AUTHORITY_SITE_ID?.trim();
  const token = env.IAOS_REPAIR_AUTHORITY_TOKEN?.trim();
  if (!siteID || !token) return { kind: "not_configured", code: "authority_credentials_missing" };
  if (!env.GHL_PRIVATE_API_KEY?.trim()) return { kind: "not_configured", code: "ghl_credential_missing" };
  return { kind: "ready", env: "test", approvalFieldId, siteID, token };
}

/**
 * The runtime's remaining budget, read once at handler entry (deadline r3 §2):
 * callable, finite and non-negative, or null. Null refuses the save before any
 * provider I/O; there is no fallback budget.
 */
export function remainingRuntimeMs(context: unknown): number | null {
  try {
    const read = (context as { getRemainingTimeInMillis?: unknown } | null)?.getRemainingTimeInMillis;
    if (typeof read !== "function") return null;
    const value = read.call(context);
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

/** deadline = start + min(budget, remaining - response reserve), as an integer on Date.now's clock. */
export function saveDeadline(start: number, remainingMs: number, cfg: Pick<SaveDeadlineConfig, "budgetMs" | "responseReserveMs">): number {
  return start + Math.floor(Math.min(cfg.budgetMs, remainingMs - cfg.responseReserveMs));
}

/**
 * A fetch for one bounded step: no request starts with less than minStartMs
 * left; each request is aborted at min(capMs, deadline - now). Its timers stay
 * armed until settle(), which the caller runs after the step has returned, so
 * the response body is covered too.
 */
export function boundedFetch(capMs: number, deadline: number, minStartMs: number, now: () => number = Date.now) {
  const timers: ReturnType<typeof setTimeout>[] = [];
  const f = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const left = deadline - now();
    if (left < minStartMs) throw new Error("request not started (deadline)");
    const ac = new AbortController();
    timers.push(setTimeout(() => ac.abort(), Math.min(capMs, left)));
    return globalThis.fetch(input, { ...init, signal: ac.signal });
  };
  return { fetch: f as typeof fetch, settle: () => { for (const t of timers) clearTimeout(t); } };
}

/** One authoritative operation per opportunity (r1 §1). */
export function approvalScope(env: string, locationId: string, opportunityId: string): string {
  return `repair-approval:${env}:${locationId}:${opportunityId}`;
}

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const exactKeys = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(v, k));
const boundedText = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;

/** Strict shape of the submitted answers. Throws on anything else (refused before any I/O). */
export function parseSubmittedAnswers(answers: unknown, misc: unknown): { answers: Answers; misc: MiscAnswer } {
  if (!isPlain(answers) || Object.keys(answers).length > OPERATOR_ROWS.length) throw new Error("Invalid repair answers");
  const out: Answers = {};
  for (const [system, a] of Object.entries(answers)) {
    if (!SYSTEMS.has(system)) throw new Error("Invalid repair answers");
    if (!isPlain(a) || !exactKeys(a, ["condition", "amount", "quantity", "dirty"])) throw new Error("Invalid repair answers");
    if (!CONDITIONS.includes(a.condition as OperatorCondition) || !boundedText(a.amount, 32) || !boundedText(a.quantity, 16) || typeof a.dirty !== "boolean") throw new Error("Invalid repair answers");
    out[system] = { condition: a.condition as OperatorCondition, amount: a.amount, quantity: a.quantity, dirty: a.dirty };
  }
  if (!isPlain(misc) || !exactKeys(misc, ["description", "amount"]) || !boundedText(misc.description, 2000) || !boundedText(misc.amount, 32)) throw new Error("Invalid repair answers");
  return { answers: out, misc: { description: misc.description, amount: misc.amount } };
}

export type Recompute =
  | { kind: "complete"; total: number; lineCount: number; basisDigest: string }
  | { kind: "incomplete" }
  | { kind: "invalid" };

/**
 * The server recompute (r1 §1 "repair total" / "completeness"): the shared
 * calculation core, exactly as the estimator runs it. Incomplete -> never
 * admitted. The basis digest binds every submitted answer, in the fixed
 * OPERATOR_ROWS order, plus Miscellaneous; per-line answers are not retained.
 */
export function recomputeRepairs(answers: Answers, misc: MiscAnswer): Recompute {
  let result;
  try {
    result = operatorEstimate(answers, (lines) => computeRepairEstimate({ lines, property: { squareFeet: null, bathroomCount: null } }), misc);
  } catch { return { kind: "invalid" }; }
  if (result.incomplete) return { kind: "incomplete" };
  const total = Math.round(result.total * 100) / 100; // as setRepairEstimate rounds (roundCurrency)
  if (canonicalCurrency(total) === null) return { kind: "invalid" };
  const lineCount = buildLines(answers, misc).length;
  const rows = OPERATOR_ROWS.map((r) => {
    const a = answers[r.system];
    return a ? [r.system, a.condition, a.amount, a.quantity, a.dirty] : [r.system, "not_asked", "", "", false];
  });
  const basisDigest = createHash("sha256").update(canonicalJson({ schema: BASIS_SCHEMA, rows, misc: { description: misc.description, amount: misc.amount } }), "utf8").digest("hex");
  return { kind: "complete", total, lineCount, basisDigest };
}

/** r1 §1 precondition digest (advisory): the admission-time Opportunity values of both binding fields. */
export function preconditionDigest(contactId: string, priorRepairEstimate: unknown, priorApprovalId: unknown): string {
  return createHash("sha256").update(canonicalJson({ contactId, priorRepairEstimate: priorRepairEstimate ?? null, priorApprovalId: priorApprovalId ?? null }), "utf8").digest("hex");
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
