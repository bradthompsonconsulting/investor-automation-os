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
 *   { action: "drafts",  contactId, opportunityId }   (C1–C4 r4: recover THIS operator's bound v2 drafts; zero GHL, no budget)
 *   { action: "close",   contactId, opportunityId }   (B15-04 close, design r3: durably stop the FIXED configured
 *       evaluation budget; Test only; one exact recovery pair; zero GHL, no grant, no lock, no cookie)
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
import { configuredBoundary, digest } from "./lib/ghl-write-boundary";
import { BudgetRefused, EvaluationBudget, TransportRefused, type Grant } from "./lib/evaluation-budget";
import { lockContact } from "./lib/write-receipts";
import { evaluateProductionGhlWriteScope } from "./lib/production-write-scope";
import type { BarrierStore } from "./lib/current-offer-barrier";
import { ANSWER_OPERATION, answerValueText, historyValueLines, normalizeAddress, normalizeSellerReason, type AnswerField } from "./lib/property-answer-model";
import { DEAL_SET_MESSAGE } from "./lib/seller-deal-set";
import {
  AnswerHeld, NotSent, UnexpectedWork, SAVED_RECORDING, currentOperation, currentValueText, discover, recordHistory, saveAnswer,
  settleUnderLock, targetAddress, operationAccess, priorAssociation, readDraftV2, saveDraftV2, validDraftValue,
  type AccessResult, type DraftBinding, type DraftState,
} from "./lib/property-answer-operation";

const jsonBase = (statusCode: number, data: unknown, extra: Record<string, string> = {}) => ({ statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra }, body: JSON.stringify(data) });
/** C1–C4 r4 A2: request-scoped wording. "Sent nothing" only where THIS request provably dispatched nothing. */
const SENT_NOTHING = "This request sent nothing to GHL. Any earlier save keeps its own recorded outcome.";
const READ_INCOMPLETE = "Verification is incomplete; earlier GHL reads in this request may have completed. This request did not submit an answer save.";
const WRITE_UNCERTAIN = "The save may have reached GHL; the earlier write remains unresolved. Do not save again.";
/** Context verdicts a failed or incomplete GHL READ can produce: worded as incomplete verification, never as a save result. */
const READ_FAILURE_REASONS = new Set<string>(["search_incomplete", "list_updating"]);
/** B15-04 close replies (design r3 B3): never a cancellation claim. */
export const CLOSED_TEXT = "The evaluation's request budget is durably stopped. New property-answer GHL actions are refused. Work already admitted may still finish; this is not a cancellation. Drafts stay recoverable.";
export const CLOSE_UNKNOWN_TEXT = "The close was not confirmed; it may or may not be stored. The evaluation stays on hold. You may try Close again deliberately.";
const RECOVERY_NOTICE = "Saved draft for a previously observed contact/deal association. Current ownership and eligibility have not been checked. Saving is off.";
/**
 * Bones F4b: the evaluation's continuation secret (evaluation-budget.ts, CONTINUATION). Set only
 * after this action's clean settlement was ACKNOWLEDGED; the next granted action must present it.
 * Exactly ONE occurrence is accepted (Bones, review of 7369842): two or more occurrences --
 * identical or conflicting -- are ambiguous and count as none.
 */
export const CONTINUATION_COOKIE = "__Host-iaos_pa_continuation";
const continuationCookie = (value: string) => `${CONTINUATION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict`;
function presentedContinuation(event: any): string | null {
  // ONE canonical representation of the received Cookie fields: the Lambda-style event can carry the
  // same physical header in both `headers` and `multiValueHeaders`. multiValueHeaders (every field)
  // is used when it has a cookie entry; otherwise `headers`. Never both, so one header counts once.
  const pick = (source: any, ok: (v: any) => string[]) => Object.entries(source ?? {}).filter(([name]) => name.toLowerCase() === "cookie").flatMap(([, v]) => ok(v));
  const multi = pick(event?.multiValueHeaders, (v) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []));
  const raw = multi.length ? multi : pick(event?.headers, (v) => (typeof v === "string" ? [v] : []));
  const found: string[] = [];
  for (const header of raw) for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === CONTINUATION_COOKIE) found.push(part.slice(eq + 1).trim());
  }
  return found.length === 1 ? found[0] : null;
}
const store = () => getStore("iaos-write-receipts") as unknown as BarrierStore;
const FIELDS: readonly AnswerField[] = ["seller_reason", "property_address"];
const KEYS: Record<string, string[]> = {
  context: ["action", "contactId", "opportunityId"],
  save: ["action", "contactId", "opportunityId", "field", "operationId", "value", "expectedAddressDigest", "expectedDealSetDigest"],
  history: ["action", "contactId", "opportunityId", "operationId"],
  check: ["action", "contactId", "opportunityId"],
  draft: ["action", "contactId", "opportunityId", "field", "value"],
  drafts: ["action", "contactId", "opportunityId"],
  close: ["action", "contactId", "opportunityId"],
};
const DIGEST = /^[0-9a-f]{64}$/;
const now = () => new Date().toISOString();

export const handler = async (event: any) => {
  // C1–C4 r4 A3: every reply after authentication echoes digest(writer); the browser drops replies that are not
  // for its current operator. UI filtering only -- authority stays with the checks below.
  let echo: string | null = null;
  const json = (statusCode: number, data: unknown, extra: Record<string, string> = {}) =>
    jsonBase(statusCode, echo && data && typeof data === "object" ? { ...(data as object), operatorDigest: echo } : data, extra);
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  // The writer and the exact write session, both server-validated: the evaluation's continuation
  // is bound to them (Bones, review of 7369842). Nothing client-supplied names the holder.
  let identity: string;
  let writer: string;
  try {
    writer = requireAppWriter(event);
    const session = String(event.headers?.authorization ?? event.headers?.Authorization).slice("Bearer ".length);
    identity = `${writer}\n${digest(session)}`;
  } catch { return json(401, { error: "Application write sign-in required" }); }
  echo = digest(writer);
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
  // B15-04 close (D1/B1): the explicit Test-only check comes FIRST, before the evaluation gate and before any Blob
  // access, so a Production deployment refuses close even if its evaluation config were ever enabled.
  if (req.action === "close" && env !== "test") return json(403, { outcome: "not_closed", code: "close_test_only", error: "Closing the evaluation is available only in Test." });
  const config = getConfig(process.env.IAOS_ENV);
  // The controlled evaluation gate and the fixture pins: before any Blob or GHL access.
  const ev = config.propertyAnswerEvaluation;
  if (ev.enabled !== PROPERTY_ANSWER_EVALUATION_ENABLED) return json(403, { outcome: "not_sent", code: "evaluation_disabled", error: "Property answers are not enabled in this environment" });
  if (!ev.fixtureContactIds.includes(req.contactId) || !ev.fixtureOpportunityIds.includes(req.opportunityId)) return json(403, { outcome: "not_sent", code: "not_a_fixture", error: "Property answers are limited to the evaluation fixtures" });
  if (req.action === "close" && !ev.recoveryPairs.some((p) => p.contactId === req.contactId && p.opportunityId === req.opportunityId))
    return json(403, { outcome: "not_closed", code: "not_a_recovery_pair", error: "Closing needs one of the reviewed evaluation contact/deal pairs." });

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
  // ── B15-04 close (design r3, D0–D4; Bones clearance 2026-10-20). Any authenticated allowed Test writer, holder or not.
  // The existing durable stop on THIS configured budget, without `g`: no grant, no boundary or GHL, no lock, no
  // continuation read, no cookie. `closed` only when the stop is acknowledged or the record is verifiably already
  // stopped; anything else is UNKNOWN. Admission fencing, not cancellation: work already admitted may still finish.
  if (req.action === "close") {
    let closed = false;
    try { closed = (await budget.stop("operator_close", now())) === true; } catch { closed = false; }
    if (closed) return json(200, { outcome: "closed", message: CLOSED_TEXT });
    return json(503, { outcome: "close_unknown", code: "close_unknown", error: CLOSE_UNKNOWN_TEXT });
  }
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
      return json(409, { outcome: "not_settled", code, ...("view" in body ? { view: body.view } : {}), error: "The result was not settled for the evaluation; the evaluation is stopped." });
    };
    if (grant.refused) return unacknowledged("budget_request_refused", "request_refused");
    const secret = randomBytes(32).toString("base64url");
    let acknowledged = false;
    try { acknowledged = await budget.settle(grant.g, secret, now()); } catch { acknowledged = false; }
    if (!acknowledged) return unacknowledged("budget_settlement_unacknowledged", "settlement_unacknowledged");
    return json(200, body, { "Set-Cookie": continuationCookie(`${grant.g}.${secret}`) });
  };

  // ── C1–C4 r4 C3: operator-bound drafts. Blob reads/writes only: zero GHL, no grant, no stop, no cookie. ──
  const draftBinding = (field: AnswerField): DraftBinding => ({ operator: writer, env, locationId: config.locationId, contactId: req.contactId, opportunityId: req.opportunityId, field });
  const association = () => priorAssociation(s, scopeKey, req.contactId, req.opportunityId, ev.fixtureContactIds);
  const recover = async (): Promise<Record<AnswerField, DraftState>> => {
    const a = await association();
    if (!a.ok) return { seller_reason: { state: a.reason }, property_address: { state: a.reason } };
    return { seller_reason: await readDraftV2(s, scopeKey, draftBinding("seller_reason")), property_address: await readDraftV2(s, scopeKey, draftBinding("property_address")) };
  };
  const present = (d: DraftState) => (d.state === "present" ? d.value : null);
  if (req.action === "draft") {
    try { validDraftValue(req.field, req.value); } catch { return json(400, { outcome: "not_saved", code: "invalid_draft", error: "Draft not saved." }); }
    const a = await association();
    if (!a.ok) return json(a.reason === "association_absent" ? 403 : 409, { outcome: "not_saved", code: a.reason, error: "Draft not saved: no confirmed prior association of this contact and deal." });
    try { await saveDraftV2(s, draftBinding(req.field), req.value, now()); return json(200, { outcome: "draft_saved" }); }
    catch { return json(503, { outcome: "draft_unconfirmed", code: "draft_unconfirmed", error: "Draft save not confirmed (it may or may not be stored)." }); }
  }
  if (req.action === "drafts") return json(200, { outcome: "drafts", drafts: await recover(), notice: RECOVERY_NOTICE });

  // ── C1–C4 r4 A1: stored operation access. Never inferred from a refusal code or a lost reply. ──
  const accessOf = (): Promise<AccessResult> => operationAccess(s, scopeKey, { contactId: req.contactId, opportunityId: req.opportunityId, writer, holder: budget.holderDigest(identity), latestHolder: () => budget.latestHolder() });
  const accessLevel = async () => { const a = await accessOf().catch(() => ({ kind: "none" as const })); return a.kind === "settle" || a.kind === "read" || a.kind === "no_operation" ? a.kind : "none"; };
  if (req.action === "check") {
    // Holder validation precedes ANY grant attempt, so a `stopped` refusal is never taken as holder proof.
    const a = await accessOf();
    if (a.kind === "none") return json(403, { outcome: "status_unavailable", code: a.reason, access: "none", error: "The recorded status can't be read in this session." });
    if (a.kind === "read") return json(200, { outcome: a.cur.view.state, view: a.cur.view, access: "read", readOnly: true });
    // settle (this exact holder) or no current operation: the existing path below.
  }

  // Check again (holder-validated above) settles stored evidence even when the budget is closed: it then makes no GHL request.
  try { grant = await budget.grant(req.action, PLANNED[req.action], now(), presentedContinuation(event), identity); }
  catch (e) {
    if (req.action !== "check") {
      if (e instanceof BudgetRefused && e.code === "exhausted") await stopEvaluation("budget exhausted");
      // A grant refusal precedes every dispatch of THIS request: "sent nothing" is proved for it alone.
      return json(409, { outcome: "not_sent", code: e instanceof BudgetRefused ? `budget_${e.code}` : "budget_unsettled", error: `${e instanceof Error ? e.message : "The request budget refused this action."} ${SENT_NOTHING}`,
        ...(req.action === "context" ? { access: await accessLevel() } : {}) });
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
        verdict: { allowed, reason: d.otherOpen ? "discovery_open" : d.verdict.reason, message: d.otherOpen ? "Another deal check is in progress." : READ_FAILURE_REASONS.has(d.verdict.reason) ? `${DEAL_SET_MESSAGE[d.verdict.reason].replace(" Nothing was saved.", "")} ${READ_INCOMPLETE}` : DEAL_SET_MESSAGE[d.verdict.reason], digest: d.verdict.digest, deals: d.verdict.deals.map((x) => ({ id: x.id, cls: x.cls, stageId: x.stageId, status: x.status })) },
        address,
        values: { seller_reason: d.target ? currentValueText(config, "seller_reason", d.target) : null },
        operation: cur ? cur.view : null,
        ...(await (async () => { const d = await recover(); return { drafts: { seller_reason: present(d.seller_reason) as string | null, property_address: present(d.property_address) }, draftStates: d }; })()),
      };
      if (!allowed) { await stopEvaluation(d.otherOpen ? "discovery_open" : d.verdict.reason); return json(200, body); }
      return await finishClean(body);
    } catch (e) {
      const code = e instanceof UnexpectedWork ? "unexpected_candidates" : e instanceof BudgetRefused ? `budget_${e.code}` : e instanceof TransportRefused ? "transport_refused" : "deal_set_unconfirmed";
      await stopEvaluation(code);
      // Reads of this request may have completed; it never submits an answer save.
      return json(409, { outcome: "verification_incomplete", code, access: await accessLevel(),
        error: `${e instanceof UnexpectedWork || e instanceof BudgetRefused ? e.message : DEAL_SET_MESSAGE.search_incomplete} ${READ_INCOMPLETE}` });
    }
  }

  let release: (() => Promise<void>) | undefined;
  try {
    try { release = await lockContact(req.contactId); }
    catch { await stopEvaluation("locked"); return json(409, { outcome: "not_sent", code: "locked", error: "Another write for this contact is in progress or unresolved. This request sent nothing to GHL. Do not save again." }); }
    if (req.action === "save") {
      const r = await saveAnswer({ ...base, contactId: req.contactId, opportunityId: req.opportunityId, field: req.field, operationId: req.operationId, fields: plan!.fields, valueText, valueLines, expectedAddressDigest: req.expectedAddressDigest, expectedDealSetDigest: req.expectedDealSetDigest, maxCandidates: m,
        access: { v: 1, writer, holder: budget.holderDigest(identity) }, draft: draftBinding(req.field) });
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
    return json(409, { outcome: "indeterminate", error: req.action === "check" ? READ_INCOMPLETE : WRITE_UNCERTAIN });
  } finally { if (release) await release(); }
};
