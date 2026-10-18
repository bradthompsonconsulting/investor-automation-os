/**
 * B15-04 Rev 6 property answers -- the pure model (design r3 sections 3-5,
 * proposal r4). No I/O, no GHL calls, no Blob access.
 *
 * - The address: five normalized parts, its digest, and when a deal "has" a
 *   property (street non-empty) versus has a CONFIRMED address (every
 *   required part valid). A deal id alone is never property identity (r3 §6).
 * - The Seller Reason value rule.
 * - The answer-history note: one deterministic body per committed answer,
 *   and the r3 §5 complete-entry match. An operation id alone never matches.
 */
import { createHash } from "node:crypto";
import { fieldValue } from "./ghl-write-boundary";

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export const ADDRESS_KEYS = ["street", "unit", "city", "state", "zip"] as const;
export type AddressKey = typeof ADDRESS_KEYS[number];
export type Address = Record<AddressKey, string>;
export const ADDRESS_PART_MAX = 200;
export const SELLER_REASON_MAX_CHARS = 2000;

const collapse = (v: string) => v.replace(/\s+/g, " ").trim();

/** Validates and normalizes an operator-entered address. Throws on anything invalid. */
export function normalizeAddress(input: unknown): Address {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid address");
  const keys = Object.keys(input);
  if (keys.length !== ADDRESS_KEYS.length || ADDRESS_KEYS.some((k) => !keys.includes(k))) throw new Error("Undeclared or missing address parts");
  const out = {} as Address;
  for (const k of ADDRESS_KEYS) {
    const v = (input as Record<string, unknown>)[k];
    if (typeof v !== "string") throw new Error("Address parts must be text");
    out[k] = collapse(v);
    if (out[k].length > ADDRESS_PART_MAX) throw new Error("Address part too long");
  }
  out.state = out.state.toUpperCase();
  if (!out.street || !out.city) throw new Error("Street and city are required");
  if (!/^[A-Z]{2}$/.test(out.state)) throw new Error("State must be two letters");
  if (!/^\d{5}$/.test(out.zip)) throw new Error("ZIP must be five digits");
  return out;
}

/** The digest of the five parts exactly as stored and displayed. */
export function addressDigest(a: Address): string {
  return sha256(JSON.stringify(ADDRESS_KEYS.map((k) => a[k])));
}
export const EMPTY_ADDRESS: Address = { street: "", unit: "", city: "", state: "", zip: "" };
export const EMPTY_ADDRESS_DIGEST = addressDigest(EMPTY_ADDRESS);

export type AddressFieldIds = Record<AddressKey, string>;
export type AddressState =
  | { kind: "empty"; address: Address; digest: string }           // all five parts empty: only the initial set may save
  | { kind: "confirmed"; address: Address; digest: string }       // street, city, state, zip all valid
  | { kind: "incomplete"; address: Address; digest: string };     // something set, but not a valid address: resolve in GHL

/** Reads the deal's address from a fresh opportunity readback. A non-text stored value is ambiguous and throws. */
export function readAddress(customFields: any[], ids: AddressFieldIds): AddressState {
  const address = {} as Address;
  for (const k of ADDRESS_KEYS) {
    const f = fieldValue(customFields, ids[k], "opportunity");
    if (f.present && typeof f.value !== "string") throw new Error("Address field readback is ambiguous");
    address[k] = f.present ? (f.value as string) : "";
  }
  const digest = addressDigest(address);
  if (ADDRESS_KEYS.every((k) => address[k] === "")) return { kind: "empty", address, digest };
  try {
    const n = normalizeAddress(address);
    if (ADDRESS_KEYS.every((k) => n[k] === address[k])) return { kind: "confirmed", address, digest };
  } catch { /* incomplete */ }
  return { kind: "incomplete", address, digest };
}

/** Seller Reason: text, CRLF/CR normalized to LF, non-empty, capped. */
export function normalizeSellerReason(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected text");
  const v = value.replace(/\r\n?/g, "\n");
  if (!v.trim()) throw new Error("Seller Reason is empty");
  if (v.length > SELLER_REASON_MAX_CHARS) throw new Error("Seller Reason too long");
  return v;
}

/** The stored value of an answer, as one string, for its digest. */
export function answerValueText(answer: AnswerField, value: string | Address): string {
  return answer === "seller_reason" ? value as string : JSON.stringify(ADDRESS_KEYS.map((k) => (value as Address)[k]));
}

export type AnswerField = "seller_reason" | "property_address";
export const ANSWER_OPERATION: Record<AnswerField, "opportunity.sellerReason" | "opportunity.propertyAddress"> = {
  seller_reason: "opportunity.sellerReason",
  property_address: "opportunity.propertyAddress",
};

// ── Answer-history note (S2) ─────────────────────────────────────────────────

export const HISTORY_NOTE_MARK = "IAOS property answer v1";
export const isHistoryNoteText = (body: unknown) => typeof body === "string" && body.startsWith(HISTORY_NOTE_MARK);

export type HistoryEntry = {
  operationId: string;
  opportunityId: string;
  contactId: string;
  field: AnswerField;
  valueDigest: string;
  /** The chain link: the digest of the field's value on the boundary pre-read before S1, or "none" when it was empty. */
  previousDigest: string;
  callSegment: string;
  environment: string;
  locationId: string;
  /** Display lines (property-answer values only; no person data). */
  valueLines: string[];
};

export function historyValueLines(field: AnswerField, value: string | Address): string[] {
  if (field === "seller_reason") return (value as string).split("\n");
  const a = value as Address;
  return ADDRESS_KEYS.map((k) => `${k}: ${a[k]}`);
}

export function historyNoteBody(e: HistoryEntry): string {
  return [
    HISTORY_NOTE_MARK,
    `operation: ${e.operationId}`,
    `opportunity: ${e.opportunityId}`,
    `contact: ${e.contactId}`,
    `field: ${e.field}`,
    `value-digest: ${e.valueDigest}`,
    `previous-revision: ${e.previousDigest}`,
    `call-segment: ${e.callSegment}`,
    `environment: ${e.environment}`,
    `location: ${e.locationId}`,
    "value:",
    ...e.valueLines,
  ].join("\n");
}

const HEADER = ["operation", "opportunity", "contact", "field", "value-digest", "previous-revision", "call-segment", "environment", "location"] as const;

export function parseHistoryNote(body: string): HistoryEntry | null {
  const lines = body.split("\n");
  if (lines[0] !== HISTORY_NOTE_MARK || lines[HEADER.length + 1] !== "value:") return null;
  const v: Record<string, string> = {};
  for (let i = 0; i < HEADER.length; i++) {
    const prefix = `${HEADER[i]}: `;
    if (!lines[i + 1]?.startsWith(prefix)) return null;
    v[HEADER[i]] = lines[i + 1].slice(prefix.length);
  }
  if (v.field !== "seller_reason" && v.field !== "property_address") return null;
  return {
    operationId: v.operation, opportunityId: v.opportunity, contactId: v.contact, field: v.field,
    valueDigest: v["value-digest"], previousDigest: v["previous-revision"], callSegment: v["call-segment"],
    environment: v.environment, locationId: v.location, valueLines: lines.slice(HEADER.length + 2),
  };
}

/**
 * r3 §5 complete-entry match: committed only if EXACTLY ONE note carries every
 * element IAOS sent (the exact deterministic body), AND the field's current
 * value still has the entry's digest. A partial match is a discrepancy.
 */
export function reconcileHistory(notes: { body: string }[], expected: HistoryEntry, currentValueDigest: string | null):
  { kind: "committed" } | { kind: "unresolved"; reason: "no_match" | "several_matches" | "partial_match" | "value_changed" } {
  const body = historyNoteBody(expected);
  const exact = notes.filter((n) => n.body === body);
  const partial = notes.filter((n) => n.body !== body && parseHistoryNote(n.body)?.operationId === expected.operationId);
  if (exact.length > 1) return { kind: "unresolved", reason: "several_matches" };
  if (exact.length === 0) return { kind: "unresolved", reason: partial.length ? "partial_match" : "no_match" };
  if (partial.length) return { kind: "unresolved", reason: "partial_match" };
  if (currentValueDigest !== expected.valueDigest) return { kind: "unresolved", reason: "value_changed" };
  return { kind: "committed" };
}
