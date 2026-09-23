import { createHash } from "node:crypto";
import { getConfig, UNDER_CONTRACT_STAGE_NOT_PROVISIONED } from "../../../shared/ghl-config";
import type { FieldWrite } from "./write-contracts";
export function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }
export class WriteUncertain extends Error {}
export class GhlBoundary {
  constructor(readonly token: string, readonly locationId: string, readonly fetcher: typeof fetch = fetch) { if (!token) throw new Error("GHL authentication not configured"); }
  async call(path: string, method = "GET", body?: unknown) {
    const response = await this.fetcher(`https://services.leadconnectorhq.com${path}`, { method, headers: { Authorization: `Bearer ${this.token}`, Version: "2021-07-28", "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!response.ok) throw new Error(`GHL request refused (${response.status})`);
    return response.json();
  }
  async contact(id: string) {
    const data = await this.call(`/contacts/${id}`); const contact = data.contact;
    if (!contact || contact.id !== id || contact.locationId !== this.locationId || !Array.isArray(contact.customFields)) throw new Error("Contact identity or field readback is ambiguous");
    return contact;
  }
  async opportunity(id: string) {
    const data = await this.call(`/opportunities/${id}`); const opportunity = data.opportunity ?? data;
    if (opportunity.id !== id || opportunity.locationId !== this.locationId || typeof opportunity.contactId !== "string" || !Array.isArray(opportunity.customFields)) throw new Error("Opportunity identity or field readback is ambiguous");
    await this.contact(opportunity.contactId);
    return opportunity;
  }
  async notes(id: string) {
    const data = await this.call(`/contacts/${id}/notes`);
    if (!Array.isArray(data.notes) || data.notes.some((n: any) => typeof n.body !== "string")) throw new Error("Notes readback is ambiguous");
    return data.notes as { id: string; body: string; dateAdded?: string }[];
  }
  async fields(kind: "contact" | "opportunity", id: string, fields: FieldWrite[]) {
    await (kind === "contact" ? this.contact(id) : this.opportunity(id));
    let response: any;
    try { response = await this.call(`/${kind === "contact" ? "contacts" : "opportunities"}/${id}`, "PUT", { customFields: fields.map(({ id, field_value }) => ({ id, field_value })) }); }
    catch { throw new WriteUncertain("Write was not confirmed; independently read back before retrying"); }
    let readback: any;
    try { readback = await (kind === "contact" ? this.contact(id) : this.opportunity(id)); }
    catch { throw new WriteUncertain("Write submitted; readback unavailable. Do not retry blindly"); }
    let results: { id: string; landed: boolean }[];
    try { results = fields.map(field => ({ id: field.id, landed: matchesField(readback.customFields, field, kind) })); }
    catch { throw new WriteUncertain("Write submitted; field readback is ambiguous"); }
    return { response, readback, confirmed: results.every(r => r.landed), results };
  }
  /**
   * Board #9 Phase B (B9-13) -- the Under Contract stage transition.
   * Never called except from the dedicated, independently-re-verified
   * "opportunity.underContractStage" write operation (`ghl-write.ts` ->
   * `write-derived-note.ts`), which itself refuses unless a genuine
   * Under Contract record and a genuine preserved-artifact record both
   * re-derive from fresh evidence. This method adds its own,
   * non-bypassable checks on top -- it never trusts a caller to have
   * already refused the forbidden stage or the wrong pipeline/location.
   *
   * Idempotent: if the opportunity's live current stage already matches
   * `targetStageId`, this returns success with `alreadyInStage: true` and
   * performs NO write -- never a redundant PUT.
   */
  async transitionOpportunityStage(opportunityId: string, expectedPipelineId: string, targetStageId: string, forbiddenStageIds: readonly string[]) {
    if (forbiddenStageIds.includes(targetStageId)) throw new Error("Refusing to transition to a forbidden stage");
    if (!targetStageId || targetStageId === UNDER_CONTRACT_STAGE_NOT_PROVISIONED) throw new Error("Target stage is not provisioned for this environment");
    const before = await this.opportunity(opportunityId);
    if (before.pipelineId !== expectedPipelineId) throw new Error("Opportunity is not in the expected pipeline");
    if (before.pipelineStageId === targetStageId) {
      return { response: null as unknown, readback: before, alreadyInStage: true as const };
    }
    let response: any;
    try { response = await this.call(`/opportunities/${opportunityId}`, "PUT", { pipelineStageId: targetStageId }); }
    catch { throw new WriteUncertain("Stage transition was not confirmed; independently read back before retrying"); }
    let readback: any;
    try { readback = await this.opportunity(opportunityId); }
    catch { throw new WriteUncertain("Stage transition submitted; readback unavailable. Do not retry blindly"); }
    if (readback.pipelineId !== expectedPipelineId || readback.pipelineStageId !== targetStageId) {
      throw new WriteUncertain("Stage transition readback does not confirm the exact expected pipeline/stage");
    }
    return { response, readback, alreadyInStage: false as const };
  }
  async note(id: string, body: string) {
    await this.contact(id);
    let response: any;
    try { response = await this.call(`/contacts/${id}/notes`, "POST", { body }); }
    catch { throw new WriteUncertain("Note outcome unknown; read back before retrying"); }
    const noteId = response.note?.id ?? response.id;
    try {
      const matches = (await this.notes(id)).filter(n => n.id === noteId && n.body === body);
      if (!noteId || matches.length !== 1) throw new Error("Note readback mismatch");
    } catch { throw new WriteUncertain("Note submitted; exact readback unavailable"); }
    return response;
  }
}
export function fieldValue(fields: any[], id: string, kind: "contact" | "opportunity") {
  const entries = fields.filter(f => f.id === id);
  if (entries.length > 1) throw new Error("Duplicate field readback");
  if (!entries.length) return { present: false, value: null };
  const key = kind === "contact" ? "value" : "fieldValue";
  if (!Object.prototype.hasOwnProperty.call(entries[0], key)) throw new Error("Malformed field readback");
  return { present: true, value: entries[0][key] };
}
export function matchesField(fields: any[], expected: FieldWrite, kind: "contact" | "opportunity") {
  const actual = fieldValue(fields, expected.id, kind);
  if (expected.field_value === "" || expected.field_value === null) return !actual.present;
  if (!actual.present) return false;
  if (expected.date) return typeof actual.value === "string" && actual.value.slice(0, 10) === String(expected.field_value).slice(0, 10);
  return JSON.stringify(actual.value) === JSON.stringify(expected.field_value);
}
export function configuredBoundary(token = process.env.GHL_PRIVATE_API_KEY) { return new GhlBoundary(token ?? "", getConfig(process.env.IAOS_ENV).locationId); }
