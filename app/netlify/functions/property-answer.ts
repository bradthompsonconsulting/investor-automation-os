/**
 * B15-04 Rev 6 property answers -- the ONE endpoint that saves the deal-scoped
 * answers of the first slice (first-time property address + Seller Reason).
 * Controlled Test evaluation only (Option B for Test, Brad 2026-10-17; Jess
 * concurring under proposal r4). See lib/property-answer-operation.ts.
 *
 * POST /.netlify/functions/property-answer   (application write session + allowed origin)
 *   { action: "context", contactId, opportunityId }
 *   { action: "save",    contactId, opportunityId, field, operationId, value, expectedAddressDigest, expectedDealSetDigest }
 *   { action: "history", contactId, opportunityId, operationId }
 *   { action: "check",   contactId, opportunityId }
 *   { action: "draft",   contactId, opportunityId, field, value }
 *
 * Refused BEFORE any Blob or GHL access unless: this deployment's config has
 * `propertyAnswerEvaluation.enabled` = PROPERTY_ANSWER_EVALUATION_ENABLED
 * (Production carries DISABLED) AND both ids are pinned evaluation fixtures.
 * A save is also refused by the Production write scope, and its value must
 * pass the named operation contract (write-contracts.ts).
 */
import { randomBytes } from "node:crypto";
import { connectLambda, getStore } from "@netlify/blobs";
import { getConfig, PROPERTY_ANSWER_EVALUATION_ENABLED } from "../../shared/ghl-config";
import { requireAppWriter } from "./lib/app-write-auth";
import { requireAppWriteOrigin } from "./lib/app-write-origin";
import { exact, identifier, planWrite } from "./lib/write-contracts";
import { configuredBoundary } from "./lib/ghl-write-boundary";
import { BudgetRefused, EvaluationBudget, TransportRefused, type Grant } from "./lib/evaluation-budget";
import { lockContact } from "./lib/write-receipts";
import { evaluateProductionGhlWriteScope } from "./lib/production-write-scope";
import type { BarrierStore } from "./lib/current-offer-barrier";
import { ANSWER_OPERATION, answerValueText, historyValueLines, normalizeAddress, normalizeSellerReason, type AnswerField } from "./lib/property-answer-model";
import { DEAL_SET_MESSAGE } from "./lib/seller-deal-set";
import {
  AnswerHeld, NotSent, UnexpectedWork, SAVED_RECORDING, currentOperation, currentValueText, discover, readDraft, recordHistory, saveAnswer, saveDraft,
  settleUnderLock, targetAddress,
} from "./lib/property-answer-operation";

const json = (statusCode: number, data: unknown, extra: Record<string, string> = {}) => ({ statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra }, body: JSON.stringify(data) });
/**
 * Bones F4b: the evaluation's continuation secret (evaluation-budget.ts, CONTINUATION). Set only
 * after this action's clean settlement was ACKNOWLEDGED; the next granted action must present it.
 * Exactly one copy is accepted; two or more are ambiguous and count as none.
 */
export const CONTINUATION_COOKIE = "__Host-iaos_pa_continuation";
const continuationCookie = (value: string) => `${CONTINUATION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict`;
function presentedContinuation(event: any): string | null {
  const raw: string[] = [];
  for (const [name, value] of Object.entries(event?.headers ?? {})) if (name.toLowerCase() === "cookie" && typeof value === "string") raw.push(value);
  for (const [name, values] of Object.entries(event?.multiValueHeaders ?? {})) if (name.toLowerCase() === "cookie" && Array.isArray(values)) raw.push(...values.filter((v): v is string => typeof v === "string"));
  const found = new Set<string>();
  for (const header of raw) for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === CONTINUATION_COOKIE) found.add(part.slice(eq + 1).trim());
  }
  return found.size === 1 ? [...found][0] : null;
}
const store = () => getStore("iaos-write-receipts") as unknown as BarrierStore;
const FIELDS: readonly AnswerField[] = ["seller_reason", "property_address"];
const KEYS: Record<string, string[]> = {
  context: ["action", "contactId", "opportunityId"],
  save: ["action", "contactId", "opportunityId", "field", "operationId", "value", "expectedAddressDigest", "expectedDealSetDigest"],
  history: ["action", "contactId", "opportunityId", "operationId"],
  check: ["action", "contactId", "opportunityId"],
  draft: ["action", "contactId", "opportunityId", "field", "value"],
};
const DIGEST = /^[0-9a-f]{64}$/;
const now = () => new Date().toISOString();

export const handler = async (event: any) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  try { requireAppWriter(event); } catch { return json(401, { error: "Application write sign-in required" }); }
  try { requireAppWriteOrigin(event); } catch { return json(403, { error: "Application write origin refused" }); }
  let req: any;
  try {
    if (event.isBase64Encoded || Object.keys(event.queryStringParameters ?? {}).length) throw new Error("encoding");
    req = JSON.parse(event.body ?? "null");
    if (!req || typeof req !== "object" || !KEYS[req.action]) throw new Error("action");
    exact(req, KEYS[req.action]);
    identifier(req.contactId); identifier(req.opportunityId);
    if ("field" in req && !FIELDS.includes(req.field)) throw new Error("field");
    if ("operationId" in req) identifier(req.operationId);
    if (req.action === "save" && (!DIGEST.test(req.expectedAddressDigest) || !DIGEST.test(req.expectedDealSetDigest))) throw new Error("digest");
  } catch { return json(400, { outcome: "not_sent", error: "Invalid property-answer request" }); }

  const env = String(process.env.IAOS_ENV);
  const config = getConfig(process.env.IAOS_ENV);
  // The controlled evaluation gate and the fixture pins: before any Blob or GHL access.
  const ev = config.propertyAnswerEvaluation;
  if (ev.enabled !== PROPERTY_ANSWER_EVALUATION_ENABLED) return json(403, { outcome: "not_sent", code: "evaluation_disabled", error: "Property answers are not enabled in this environment" });
  if (!ev.fixtureContactIds.includes(req.contactId) || !ev.fixtureOpportunityIds.includes(req.opportunityId)) return json(403, { outcome: "not_sent", code: "not_a_fixture", error: "Property answers are limited to the evaluation fixtures" });

  let plan: ReturnType<typeof planWrite> | null = null;
  let valueText = "", valueLines: string[] = [];
  if (req.action === "save") {
    const operation = ANSWER_OPERATION[req.field as AnswerField];
    const scope = evaluateProductionGhlWriteScope(config, { operation, targetId: req.opportunityId, args: req.field === "seller_reason" ? { value: req.value } : req.value });
    if (!scope.ok) return json(403, { outcome: "not_sent", code: scope.code, error: "Production write refused by the proof write scope" });
    try {
      plan = planWrite(operation, req.field === "seller_reason" ? { value: req.value } : req.value, config);
      const value = req.field === "seller_reason" ? normalizeSellerReason(req.value) : normalizeAddress(req.value);
      valueText = answerValueText(req.field, value);
      valueLines = historyValueLines(req.field, value);
    } catch (e) { return json(400, { outcome: "not_sent", code: "invalid_value", error: e instanceof Error ? e.message : "Invalid value" }); }
  }

  connectLambda(event);
  const s = store();
  const scopeKey = `${env}:${config.locationId}`;
  const m = ev.maxCandidates;
  // Bones F4: every GHL request this endpoint makes is reserved per action, receipted before it is
  // sent and bounded. Planned counts per action (one discovery = 1 search + 2 reads per candidate).
  const PLANNED: Record<string, number> = { context: 1 + 2 * m, save: 2 * (1 + 2 * m) + 5, history: 3, check: 3, draft: 0 };
  const budget = new EvaluationBudget(s, scopeKey, ev.requestBudget.budgetId, ev.requestBudget.ceiling);
  let grant: Grant | null = null;
  // Bones b729e33 re-review F4: a granted action ends by settling its grant clean (expected result,
  // no refused or failed request) or by a stop. Neither write is trusted to succeed: an unsettled
  // grant keeps the budget closed for every later invocation (evaluation-budget.ts).
  const stopEvaluation = async (reason: string) => {
    if (grant && !grant.refused) grant.refused = new BudgetRefused("The evaluation is stopped", "stopped");
    await budget.stop(`${req.action}: ${reason}`, now(), grant?.g).catch(() => false);
  };
  // Bones F4b: an expected result is answered as ordinary success ONLY after its clean settlement
  // was acknowledged, and only then does the client receive the continuation for the next action.
  // An unacknowledged settlement (false, a throw, or applied with its acknowledgement lost) is not
  // success: the evaluation stops (best effort) and no continuation is issued, so even a persisted
  // clean record grants nothing later.
  const finishClean = async (body: Record<string, unknown>) => {
    if (!grant) return json(200, body);
    const unacknowledged = async (code: string, reason: string) => {
      await stopEvaluation(reason);
      return json(409, { outcome: "not_settled", code, ...("view" in body ? { view: body.view } : {}), error: "The result was not settled for the evaluation; the evaluation is stopped. Use Check again to read the stored state." });
    };
    if (grant.refused) return unacknowledged("budget_request_refused", "request_refused");
    const secret = randomBytes(32).toString("base64url");
    let acknowledged = false;
    try { acknowledged = await budget.settle(grant.g, secret, now()); } catch { acknowledged = false; }
    if (!acknowledged) return unacknowledged("budget_settlement_unacknowledged", "settlement_unacknowledged");
    return json(200, body, { "Set-Cookie": continuationCookie(`${grant.g}.${secret}`) });
  };

  if (req.action === "draft") {
    try { await saveDraft(s, scopeKey, req.contactId, req.opportunityId, req.field, req.value, now()); return json(200, { outcome: "draft_saved" }); }
    catch { return json(400, { outcome: "not_sent", code: "invalid_draft", error: "Draft not saved" }); }
  }

  // Check again settles stored evidence even when the budget is closed: it then makes no GHL request.
  try { grant = await budget.grant(req.action, PLANNED[req.action], now(), presentedContinuation(event)); }
  catch (e) {
    if (req.action !== "check") {
      if (e instanceof BudgetRefused && e.code === "exhausted") await stopEvaluation("budget exhausted");
      return json(409, { outcome: "not_sent", code: e instanceof BudgetRefused ? `budget_${e.code}` : "budget_unsettled", error: e instanceof Error ? e.message : "Nothing was sent." });
    }
  }
  const refuseAll = (async () => { throw new BudgetRefused("No GHL request is available to this action", "stopped"); }) as unknown as typeof fetch;
  const boundary = configuredBoundary(undefined, grant ? grant.fetcher(now) : refuseAll);
  const base = { boundary, store: s, scope: scopeKey, config, environment: env, now };

  if (req.action === "context") {
    try {
      const d = await discover({ ...base, contactId: req.contactId, targetId: req.opportunityId, lockHeld: false, maxCandidates: m });
      const address = d.target ? targetAddress(config, d.target) : null;
      const cur = await currentOperation(s, scopeKey, req.contactId).catch(() => null);
      const allowed = d.verdict.allowed && !d.otherOpen;
      const body = {
        verdict: { allowed, reason: d.otherOpen ? "discovery_open" : d.verdict.reason, message: d.otherOpen ? "Another deal check is in progress." : DEAL_SET_MESSAGE[d.verdict.reason], digest: d.verdict.digest, deals: d.verdict.deals.map((x) => ({ id: x.id, cls: x.cls, stageId: x.stageId, status: x.status })) },
        address,
        values: { seller_reason: d.target ? currentValueText(config, "seller_reason", d.target) : null },
        operation: cur ? cur.view : null,
        drafts: { seller_reason: await readDraft(s, scopeKey, req.contactId, req.opportunityId, "seller_reason"), property_address: await readDraft(s, scopeKey, req.contactId, req.opportunityId, "property_address") },
      };
      if (!allowed) { await stopEvaluation(d.otherOpen ? "discovery_open" : d.verdict.reason); return json(200, body); }
      return await finishClean(body);
    } catch (e) {
      const code = e instanceof UnexpectedWork ? "unexpected_candidates" : e instanceof BudgetRefused ? `budget_${e.code}` : e instanceof TransportRefused ? "transport_refused" : "deal_set_unconfirmed";
      await stopEvaluation(code);
      return json(409, { outcome: "not_sent", code, error: e instanceof UnexpectedWork || e instanceof BudgetRefused ? e.message : DEAL_SET_MESSAGE.search_incomplete });
    }
  }

  let release: (() => Promise<void>) | undefined;
  try {
    try { release = await lockContact(req.contactId); }
    catch { await stopEvaluation("locked"); return json(409, { outcome: "not_sent", code: "locked", error: "Another write for this contact is in progress or unresolved. Nothing was sent." }); }
    if (req.action === "save") {
      const r = await saveAnswer({ ...base, contactId: req.contactId, opportunityId: req.opportunityId, field: req.field, operationId: req.operationId, fields: plan!.fields, valueText, valueLines, expectedAddressDigest: req.expectedAddressDigest, expectedDealSetDigest: req.expectedDealSetDigest, maxCandidates: m });
      if (r.view.state !== "saved_history_pending" || r.message !== SAVED_RECORDING) { await stopEvaluation(r.view.state); return json(200, { outcome: r.view.state, view: r.view, message: r.message }); }
      return await finishClean({ outcome: r.view.state, view: r.view, message: r.message });
    }
    if (req.action === "history") {
      const r = await recordHistory({ ...base, contactId: req.contactId, operationId: req.operationId });
      if (r.view.state !== "committed") { await stopEvaluation(r.view.state); return json(200, { outcome: r.view.state, view: r.view, message: r.message }); }
      return await finishClean({ outcome: r.view.state, view: r.view, message: r.message });
    }
    const cur = await currentOperation(s, scopeKey, req.contactId);
    if (!cur) return await finishClean({ outcome: "clear", view: null });
    const v = await settleUnderLock(base, cur.op);
    if (!["committed", "not_saved"].includes(v.state)) { await stopEvaluation(v.state); return json(200, { outcome: v.state, view: v }); }
    return await finishClean({ outcome: v.state, view: v });
  } catch (error) {
    await stopEvaluation(error instanceof NotSent ? error.code : error instanceof AnswerHeld ? "held" : "indeterminate");
    if (error instanceof NotSent) return json(409, { outcome: "not_sent", code: error.code, error: error.message, ...(error.view && typeof error.view === "object" && "reason" in (error.view as any) ? { verdict: { reason: (error.view as any).reason, message: DEAL_SET_MESSAGE[(error.view as any).reason as keyof typeof DEAL_SET_MESSAGE] } } : {}) });
    if (error instanceof AnswerHeld) return json(409, { outcome: "held", view: error.view, error: error.message });
    console.error("[property-answer]", JSON.stringify({ action: req.action, name: error instanceof Error ? error.name : "NonError" }));
    return json(409, { outcome: "indeterminate", error: "The save may have reached GHL; it is unresolved. Use Check again." });
  } finally { if (release) await release(); }
};
