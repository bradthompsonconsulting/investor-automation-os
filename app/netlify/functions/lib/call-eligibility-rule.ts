/**
 * AirDroid call eligibility — the one decision both Seller Call AirDroid
 * buttons use before a handoff (Jess ruling 2026-10-16; Brad-approved scope
 * IAOS_AIRDROID_CALL_ELIGIBILITY_AMENDED_SCOPE_2026-10-16.md §1–§2).
 *
 * Pure: no I/O. Input is the body of ONE fresh GHL `GET /contacts/{id}`.
 *
 * This is an application eligibility check against GHL records. It is not a
 * declaration of legal consent, and it does not know every external
 * restriction. A result is true only at the moment of the read: status can
 * change in GHL before AirDroid dials (the read-to-dial race is not closed).
 *
 * Rules, first match wins:
 *   1 body not an object, no contact object, wrong contact id or location -> unknown / mismatch
 *   2 contact-wide `dnd === true`                                        -> suppressed
 *   3 `dndSettings` present but not a plain object (null, array, ...)    -> unknown
 *   4 any Call/Voice entry with status `active` or `permanent`          -> suppressed
 *   5 any Call/Voice entry malformed or with another status              -> unknown
 *   6 `dnd` present and not a boolean                                    -> unknown
 *   7/8 Phone Status, for the configured field id only (Brad/Bones 2026-10-16):
 *     - any VALID matching value (trimmed, case-insensitive) is
 *       Incorrect Number                                                 -> incorrect_number
 *     - otherwise unreadable: config id unusable; customFields not an
 *       array; an entry that cannot be identified (not an object, or no
 *       string id -- it might be the configured field); more than one
 *       matching entry (identical or not: never pick the first or last);
 *       a matching entry with no value, a non-string value/fieldValue,
 *       or value and fieldValue that differ                              -> unknown
 *     - otherwise (no matching entry, or one valid value)                -> not Incorrect Number
 *   9 the fresh phone fails airdroidCallDigits (the unchanged helper)    -> invalid_phone
 *  10 otherwise -> eligible. `dndSettings` ABSENT, `{}`, or with no
 *     Call/Voice entry means no call restriction recorded: the recorded
 *     sparse representation (CONTACTS_DETAIL_SPEC D4, PB-D50). Absent is
 *     not the same as present-and-malformed (rule 3).
 *
 * Explicit suppression (2, 4) always wins over anything permissive. SMS, RCS
 * and Email entries do not affect calling.
 */
import { airdroidCallDigits } from "../../../src/lib/airdroid-prepare-call";

export type CallEligibilityDecision = "eligible" | "suppressed" | "incorrect_number" | "unknown" | "invalid_phone" | "mismatch";

export interface CallEligibility {
  decision: CallEligibilityDecision;
  contactId: string;
  /** The fresh number's 10 AirDroid digits; set only when the decision is eligible. */
  phoneDigits: string | null;
}

export interface CallEligibilityExpectations {
  locationId: string;
  /** The environment's configured Phone Status field id (shared/ghl-config.ts fields.phoneStatus). */
  phoneStatusFieldId: string;
}

const CALL_CHANNEL = /^(call|voice)$/i;
const SUPPRESSING = new Set(["active", "permanent"]);
const RECOGNISED = new Set(["active", "permanent", "inactive"]);
const GHL_ID = /^[A-Za-z0-9]{10,64}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
const has = (o: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(o, key);

type PhoneStatus = "unreadable" | "incorrect_number" | "other";

const isIncorrectNumber = (value: string) => value.trim().toLowerCase() === "incorrect number";

function phoneStatus(contact: Record<string, unknown>, fieldId: string): PhoneStatus {
  if (typeof fieldId !== "string" || !GHL_ID.test(fieldId)) return "unreadable";
  const fields = contact.customFields;
  if (!Array.isArray(fields)) return "unreadable";
  let ambiguous = false;
  let matches = 0;
  const validValues: string[] = [];
  for (const entry of fields) {
    if (!isPlainObject(entry) || typeof entry.id !== "string") { ambiguous = true; continue; }   // unidentifiable: it might be this field
    if (entry.id !== fieldId) continue;                                                       // a well-formed unrelated field
    matches += 1;
    const representations = (["value", "fieldValue"] as const).filter((key) => has(entry, key)).map((key) => entry[key]);
    if (representations.length === 0) { ambiguous = true; continue; }
    const strings = representations.filter((v): v is string => typeof v === "string");
    if (strings.length !== representations.length) ambiguous = true;                          // a malformed representation
    if (new Set(strings).size > 1) ambiguous = true;                                          // value and fieldValue differ
    validValues.push(...strings);
  }
  if (matches > 1) ambiguous = true;                                                          // never pick one of several entries
  if (validValues.some(isIncorrectNumber)) return "incorrect_number";
  if (ambiguous) return "unreadable";
  return "other";                                                                             // unpopulated, or one valid value
}

export function evaluateCallEligibility(body: unknown, expectedContactId: string, expected: CallEligibilityExpectations): CallEligibility {
  const result = (decision: CallEligibilityDecision, phoneDigits: string | null = null): CallEligibility =>
    ({ decision, contactId: expectedContactId, phoneDigits });

  // 1
  if (!isPlainObject(body) || !isPlainObject(body.contact)) return result("unknown");
  const contact = body.contact;
  if (contact.id !== expectedContactId || typeof contact.locationId !== "string" || contact.locationId !== expected.locationId) return result("mismatch");

  // 2
  if (contact.dnd === true) return result("suppressed");

  // 3
  const settingsPresent = has(contact, "dndSettings");
  if (settingsPresent && !isPlainObject(contact.dndSettings)) return result("unknown");
  const callEntries = settingsPresent
    ? Object.entries(contact.dndSettings as Record<string, unknown>).filter(([channel]) => CALL_CHANNEL.test(channel)).map(([, entry]) => entry)
    : [];

  // 4 -- before any malformed entry is considered, so explicit suppression always wins
  if (callEntries.some((e) => isPlainObject(e) && typeof e.status === "string" && SUPPRESSING.has(e.status))) return result("suppressed");

  // 5
  if (callEntries.some((e) => !isPlainObject(e) || typeof e.status !== "string" || !RECOGNISED.has(e.status))) return result("unknown");

  // 6
  if (has(contact, "dnd") && typeof contact.dnd !== "boolean") return result("unknown");

  // 7, 8
  const status = phoneStatus(contact, expected.phoneStatusFieldId);
  if (status === "unreadable") return result("unknown");
  if (status === "incorrect_number") return result("incorrect_number");

  // 9
  const digits = airdroidCallDigits(contact.phone);
  if (!digits) return result("invalid_phone");

  // 10
  return result("eligible", digits);
}
