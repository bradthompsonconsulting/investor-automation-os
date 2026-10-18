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
import { connectLambda, getStore } from "@netlify/blobs";
import { getConfig, PROPERTY_ANSWER_EVALUATION_ENABLED } from "../../shared/ghl-config";
import { requireAppWriter } from "./lib/app-write-auth";
import { requireAppWriteOrigin } from "./lib/app-write-origin";
import { exact, identifier, planWrite } from "./lib/write-contracts";
import { configuredBoundary } from "./lib/ghl-write-boundary";
import { lockContact } from "./lib/write-receipts";
import { evaluateProductionGhlWriteScope } from "./lib/production-write-scope";
import type { BarrierStore } from "./lib/current-offer-barrier";
import { ANSWER_OPERATION, answerValueText, historyValueLines, normalizeAddress, normalizeSellerReason, type AnswerField } from "./lib/property-answer-model";
import { DEAL_SET_MESSAGE } from "./lib/seller-deal-set";
import {
  AnswerHeld, NotSent, currentOperation, currentValueText, discover, readDraft, recordHistory, saveAnswer, saveDraft,
  settleUnderLock, targetAddress,
} from "./lib/property-answer-operation";

const json = (statusCode: number, data: unknown) => ({ statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(data) });
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
  const boundary = configuredBoundary();
  const base = { boundary, store: s, scope: scopeKey, config, environment: env, now };

  if (req.action === "draft") {
    try { await saveDraft(s, scopeKey, req.contactId, req.opportunityId, req.field, req.value, now()); return json(200, { outcome: "draft_saved" }); }
    catch { return json(400, { outcome: "not_sent", code: "invalid_draft", error: "Draft not saved" }); }
  }

  if (req.action === "context") {
    try {
      const d = await discover({ ...base, contactId: req.contactId, targetId: req.opportunityId, lockHeld: false });
      const address = d.target ? targetAddress(config, d.target) : null;
      const cur = await currentOperation(s, scopeKey, req.contactId).catch(() => null);
      return json(200, {
        verdict: { allowed: d.verdict.allowed && !d.otherOpen, reason: d.otherOpen ? "discovery_open" : d.verdict.reason, message: d.otherOpen ? "Another deal check is in progress. Try again shortly." : DEAL_SET_MESSAGE[d.verdict.reason], digest: d.verdict.digest, deals: d.verdict.deals.map((x) => ({ id: x.id, cls: x.cls, stageId: x.stageId, status: x.status })) },
        address,
        values: { seller_reason: d.target ? currentValueText(config, "seller_reason", d.target) : null },
        operation: cur ? cur.view : null,
        drafts: { seller_reason: await readDraft(s, scopeKey, req.contactId, req.opportunityId, "seller_reason"), property_address: await readDraft(s, scopeKey, req.contactId, req.opportunityId, "property_address") },
      });
    } catch { return json(409, { outcome: "not_sent", code: "deal_set_unconfirmed", error: DEAL_SET_MESSAGE.search_incomplete }); }
  }

  let release: (() => Promise<void>) | undefined;
  try {
    try { release = await lockContact(req.contactId); }
    catch { return json(409, { outcome: "not_sent", code: "locked", error: "Another write for this contact is in progress or unresolved. Nothing was sent." }); }
    if (req.action === "save") {
      const r = await saveAnswer({ ...base, contactId: req.contactId, opportunityId: req.opportunityId, field: req.field, operationId: req.operationId, fields: plan!.fields, valueText, valueLines, expectedAddressDigest: req.expectedAddressDigest, expectedDealSetDigest: req.expectedDealSetDigest });
      return json(200, { outcome: r.view.state, view: r.view, message: r.message });
    }
    if (req.action === "history") {
      const r = await recordHistory({ ...base, contactId: req.contactId, operationId: req.operationId });
      return json(200, { outcome: r.view.state, view: r.view, message: r.message });
    }
    const cur = await currentOperation(s, scopeKey, req.contactId);
    if (!cur) return json(200, { outcome: "clear", view: null });
    const v = await settleUnderLock(base, cur.op);
    return json(200, { outcome: v.state, view: v });
  } catch (error) {
    if (error instanceof NotSent) return json(409, { outcome: "not_sent", code: error.code, error: error.message, ...(error.view && typeof error.view === "object" && "reason" in (error.view as any) ? { verdict: { reason: (error.view as any).reason, message: DEAL_SET_MESSAGE[(error.view as any).reason as keyof typeof DEAL_SET_MESSAGE] } } : {}) });
    if (error instanceof AnswerHeld) return json(409, { outcome: "held", view: error.view, error: error.message });
    console.error("[property-answer]", JSON.stringify({ action: req.action, name: error instanceof Error ? error.name : "NonError" }));
    return json(409, { outcome: "indeterminate", error: "The save may have reached GHL; it is unresolved. Use Check again." });
  } finally { if (release) await release(); }
};
