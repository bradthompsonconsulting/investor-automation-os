/** INV-95 exact operation contracts. No caller-supplied GHL path, method or field ID. */
import { getConfig, CURRENT_OFFER_NOT_PROVISIONED, CONTRACT_PROJECTION_FIELD_NOT_PROVISIONED } from "../../../shared/ghl-config";
import { ASSIGNMENT_MODE_OPTIONS } from "../../../src/lib/underwriting/resolver-types";
export const dispositions = ["No Answer", "Voicemail", "Follow Up", "Requested Appointment", "Not Interested", "Incorrect Number"];
export const routings = ["Stay in Cold Outreach", "Long-Term Nurture"];
export function exact(value: any, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(k => !Object.prototype.hasOwnProperty.call(value, k))) throw new Error("Undeclared or missing fields");
}
export function identifier(value: unknown): asserts value is string { if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new Error("Invalid target identity"); }
function text(value: unknown): asserts value is string { if (typeof value !== "string") throw new Error("Expected text"); }
function number(value: unknown): asserts value is number { if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Expected finite number"); }
function iso(value: unknown) { if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("Expected ISO instant"); }
export type FieldWrite = { id: string; field_value: string | number | string[] | null; date?: boolean };
export type WritePlan = { kind: "contact" | "opportunity" | "note" | "task"; fields: FieldWrite[]; body?: string; taskId?: string };
export function planWrite(operation: string, args: any, config: ReturnType<typeof getConfig>): WritePlan {
  const c = config.fields, f = config.opportunityFacts, u = config.opportunityFields;
  const fields: FieldWrite[] = [];
  let kind: WritePlan["kind"] = "contact";
  const add = (id: string, value: FieldWrite["field_value"], date = false) => {
    identifier(id);
    if (id === CURRENT_OFFER_NOT_PROVISIONED || id === CONTRACT_PROJECTION_FIELD_NOT_PROVISIONED) throw new Error("Field not provisioned");
    fields.push({ id, field_value: value, date });
  };
  const single = () => { exact(args, ["value"]); return args.value; };
  switch (operation) {
    case "contact.lastCallAttempt": { const v = single(); iso(v); add(c.lastCallAttempt, v, true); add(c.lastCallAttemptPrecise, v); break; }
    case "contact.callback": { const v = single(); if (v !== null) iso(v); add(c.callbackDatetime, v, true); add(c.callbackDatetimePrecise, v); break; }
    case "contact.propertyNotes": { const v = single(); text(v); add(c.propertyNotes, v); break; }
    case "contact.arv": { const v = single(); if (v !== "") number(v); add(c.arv, v); break; }
    case "contact.disposition": { const v = single(); if (!dispositions.includes(v)) throw new Error("Invalid disposition"); add(c.callDisposition, v); break; }
    case "contact.routing": { const v = single(); if (!routings.includes(v)) throw new Error("Invalid routing"); add(c.callRouting, v); break; }
    case "contact.dispositionAt": { const v = single(); iso(v); add(c.dispositionAt, v); break; }
    case "contact.occupancy": { const v = single(); if (!["", "Owner Occupied", "Tenant Occupied", "Vacant"].includes(v)) throw new Error("Invalid occupancy"); add(c.occupancyStatus, v === "" ? "" : [v]); break; }
    case "note.create": exact(args, ["body"]); text(args.body); if (!args.body.trim()) throw new Error("Empty note"); return { kind: "note", fields, body: args.body };
    case "task.complete": exact(args, ["taskId"]); identifier(args.taskId); return { kind: "task", fields, taskId: args.taskId };
    case "opportunity.askingPrice": { kind = "opportunity"; const v = single(); if (v !== "") number(v); add(f.askingPrice, v); break; }
    case "opportunity.arv": case "opportunity.repairs": case "opportunity.currentOffer": {
      kind = "opportunity"; const v = single(); number(v);
      if (operation === "opportunity.repairs" ? v < 0 : v <= 0) throw new Error("Invalid monetary value");
      add(operation === "opportunity.arv" ? f.arv : operation === "opportunity.repairs" ? f.repairs : f.currentOffer, v); break;
    }
    case "opportunity.assignmentMode": { kind = "opportunity"; const v = single(); if (!ASSIGNMENT_MODE_OPTIONS.some(([label]) => label === v)) throw new Error("Invalid assignment mode"); add(u.assignmentMode, v); break; }
    case "opportunity.underwriting": {
      kind = "opportunity"; exact(args, ["endBuyerMaxPrice", "sellerMAO", "assignmentMode"]); number(args.endBuyerMaxPrice); number(args.sellerMAO);
      if (!ASSIGNMENT_MODE_OPTIONS.some(([label]) => label === args.assignmentMode)) throw new Error("Invalid assignment mode");
      add(u.endBuyerMaxPrice, args.endBuyerMaxPrice); add(u.sellerMAO, args.sellerMAO); add(u.assignmentMode, args.assignmentMode); break;
    }
    default: throw new Error("Unknown write operation");
  }
  if (new Set(fields.map(f => f.id)).size !== fields.length) throw new Error("Duplicate configured fields");
  return { kind, fields };
}
