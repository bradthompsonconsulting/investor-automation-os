/**
 * Seller contract facts -- durable carriers. B9-05 / INV-60.
 *
 * Pure. No I/O, no React. Fifteen format/parse pairs, one per TREC 20-19
 * fact group named in the locked INV-60 Product Owner ruling. Every
 * function here builds or reads a note string; NONE performs a write --
 * the caller is responsible for `ghl.notes.create()`, one of AGENTS.md's
 * "three sanctioned writes, and no fourth." No new write class.
 *
 * JESS GATE CORRECTION ROUND (2026-09-10): three changes to the original
 * thirteen. (1) ¶5's earnest money, option fee, and option-period-days no
 * longer force a positive number -- each is now `AmountOrNone`/`DaysOrNone`,
 * an explicit "entered value" vs. "intentionally zero/none" alternative,
 * never a silently-assumed default (Section 5 below). (2) A new Section 14,
 * `SellerNoticeConfirmationFacts`, captures the seller's own ¶21 notice
 * info as an EXPLICIT confirmation -- the property address and the
 * contact's GHL phone/email are never read as this fact's value; they are
 * candidate/inherited data the UI may pre-fill from, but only an explicit
 * confirm-or-correct action here creates a record. (3) A new Section 15,
 * `BuyerBusinessConfigFacts`, gives BTC LLC's own notice address/phone/
 * email and authorized signer a real, durable capture path -- it no longer
 * lives only as a `null` the caller must someday replace.
 *
 * SAME PROVEN PATTERN AS `seller-call-readiness-carriers.ts`, REUSED, NOT
 * REINVENTED: a versioned header line, one fact per line, POSITIONAL
 * parsing (never `.find()`), a canonical ISO timestamp that must
 * round-trip through `toISOString()`, and a "latest entry wins, scoped to
 * ONE Opportunity" reader. Every entry is a NEW append-only note; nothing
 * here ever overwrites or deletes a prior one.
 *
 * GOVERNING RULING (this session, INV-60, locked): the supported V1 path
 * is named **Cash Acquisition / Assignment Exit**. Third-Party Financing,
 * Seller Financing, Loan Assumption, Subject-To, and other financed or
 * creative structures are UNSUPPORTED in Dollar #1 V1 -- not offered as a
 * per-deal choice anywhere below. Buyer is fixed:
 * "Brad Thompson Consulting LLC," principal for its own account, holding
 * no Texas real-estate license, no representation by default. None of
 * those four facts is a carrier here -- they are fixed constants in
 * `contract-facts-model.ts`, cited there. What IS a carrier here is the
 * rare, explicit PER-DEAL OVERRIDE of the buyer entity (Section 1) --
 * ruling: "never silently substitute."
 *
 * NOT CAPTURED HERE, per the same ruling: assignee-side equitable-interest
 * disclosure (Board #11), FIRPTA/foreign-person status (removed from
 * INV-60), and any legal or disclosure LANGUAGE. Section 13 (attorney/
 * manual-controlled fields) stores AT MOST an opaque, verbatim,
 * operator/attorney-supplied string plus who-and-when provenance -- this
 * module never drafts, interprets, recommends, or validates that text's
 * content.
 */

/* ------------------------------------------------------------------ */
/* Shared helpers -- same idiom every existing carrier file repeats     */
/* ------------------------------------------------------------------ */

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

/** The one generic "a real value, or explicitly marked none" pattern, reused across most fact groups below -- never a blank standing in for "nothing to report." */
export type ValueOrNone = { kind: "value"; value: string } | { kind: "none" };
const NONE_MARKER = "(none -- explicitly marked)";
function formatValueOrNone(f: ValueOrNone): string {
  return f.kind === "none" ? NONE_MARKER : f.value;
}
function parseValueOrNone(raw: string): ValueOrNone | null {
  if (raw === NONE_MARKER) return { kind: "none" };
  if (raw.trim() === "") return null;
  return { kind: "value", value: raw };
}
function formatValueOrNoneJson(f: ValueOrNone): string {
  return JSON.stringify(f);
}
function parseValueOrNoneJson(raw: string): ValueOrNone | null {
  const parsed = safeJsonParse(raw);
  if (!parsed.ok) return null;
  const v = parsed.value;
  if (!isPlainObject(v)) return null;
  if (v.kind === "none") return hasExactKeys(v, ["kind"]) ? { kind: "none" } : null;
  if (v.kind === "value") {
    if (!hasExactKeys(v, ["kind", "value"])) return null;
    if (typeof v.value !== "string" || v.value.trim() === "") return null;
    return { kind: "value", value: v.value };
  }
  return null;
}

/**
 * The "an entered positive amount, OR an explicit zero/none" pattern --
 * Jess Gate correction: a missing carrier record means `unresolved`
 * (nothing decided yet); `{kind:"none"}` means the operator explicitly
 * decided the form permits zero/none here. Never conflate the two.
 */
export type AmountOrNone = { kind: "amount"; amount: number } | { kind: "none" };
function formatAmountOrNone(f: AmountOrNone): string {
  return JSON.stringify(f);
}
function parseAmountOrNone(raw: string): AmountOrNone | null {
  const parsed = safeJsonParse(raw);
  if (!parsed.ok || !isPlainObject(parsed.value)) return null;
  const v = parsed.value;
  if (v.kind === "none") return hasExactKeys(v, ["kind"]) ? { kind: "none" } : null;
  if (v.kind === "amount") {
    if (!hasExactKeys(v, ["kind", "amount"])) return null;
    if (typeof v.amount !== "number" || !Number.isFinite(v.amount) || v.amount <= 0) return null;
    return { kind: "amount", amount: v.amount };
  }
  return null;
}

/** Same pattern as `AmountOrNone`, for an integer day count. */
export type DaysOrNone = { kind: "days"; days: number } | { kind: "none" };
function formatDaysOrNone(f: DaysOrNone): string {
  return JSON.stringify(f);
}
function parseDaysOrNone(raw: string): DaysOrNone | null {
  const parsed = safeJsonParse(raw);
  if (!parsed.ok || !isPlainObject(parsed.value)) return null;
  const v = parsed.value;
  if (v.kind === "none") return hasExactKeys(v, ["kind"]) ? { kind: "none" } : null;
  if (v.kind === "days") {
    if (!hasExactKeys(v, ["kind", "days"])) return null;
    if (typeof v.days !== "number" || !Number.isInteger(v.days) || v.days <= 0) return null;
    return { kind: "days", days: v.days };
  }
  return null;
}

/* ==================================================================== */
/* 1. Buyer entity -- PER-DEAL OVERRIDE ONLY                             */
/* ==================================================================== */

/**
 * The fixed default ("Brad Thompson Consulting LLC," principal) lives in
 * `contract-facts-model.ts`, never here. This carrier exists ONLY for the
 * rare explicit override -- "never silently substitute" is enforced by
 * the model always naming which source (default vs. this override)
 * supplied the value, never by this carrier being the only source.
 */
export const BUYER_ENTITY_OVERRIDE_LEDGER_VERSION = "iaos-buyer-entity-override-v1" as const;
const BUYER_ENTITY_OVERRIDE_HEADER = `IAOS BUYER ENTITY OVERRIDE — ${BUYER_ENTITY_OVERRIDE_LEDGER_VERSION}`;
const BUYER_ENTITY_OVERRIDE_LABELS = ["Recorded at", "Operator", "Opportunity", "Buyer name", "Reason"] as const;

export type ParsedBuyerEntityOverride = {
  opportunityId: string;
  at: string;
  operator: string | null;
  buyerName: string;
  reason: string;
};

export function formatBuyerEntityOverrideNote(args: {
  opportunityId: string; at: string; operator: string | null; buyerName: string; reason: string;
}): string {
  return [
    BUYER_ENTITY_OVERRIDE_HEADER,
    `${BUYER_ENTITY_OVERRIDE_LABELS[0]}: ${args.at}`,
    `${BUYER_ENTITY_OVERRIDE_LABELS[1]}: ${ledgerValue(args.operator)}`,
    `${BUYER_ENTITY_OVERRIDE_LABELS[2]}: ${args.opportunityId}`,
    `${BUYER_ENTITY_OVERRIDE_LABELS[3]}: ${args.buyerName}`,
    `${BUYER_ENTITY_OVERRIDE_LABELS[4]}: ${args.reason}`,
  ].join("\n");
}

export function parseBuyerEntityOverrideNote(body: string): ParsedBuyerEntityOverride | null {
  const values = matchPositionalSchema(body, BUYER_ENTITY_OVERRIDE_HEADER, BUYER_ENTITY_OVERRIDE_LABELS);
  if (!values) return null;
  const [at, operatorRaw, opportunityId, buyerName, reason] = values;
  if (opportunityId === "" || buyerName === "" || reason === "") return null;
  if (!isCanonicalIsoTimestamp(at)) return null;
  return { opportunityId, at, operator: operatorRaw === "UNAVAILABLE" ? null : operatorRaw, buyerName, reason };
}

export function latestBuyerEntityOverrideForOpportunity(
  notes: { body: string }[], opportunityId: string,
): ParsedBuyerEntityOverride | null {
  let latest: ParsedBuyerEntityOverride | null = null;
  for (const note of notes) {
    const parsed = parseBuyerEntityOverrideNote(note.body);
    if (!parsed || parsed.opportunityId !== opportunityId) continue;
    if (!latest || new Date(parsed.at).getTime() > new Date(latest.at).getTime()) latest = parsed;
  }
  return latest;
}

/* ==================================================================== */
/* 2. Party / signer facts (¶1 seller side; ¶23 attorney is separate)   */
/* ==================================================================== */

export type SellerSignerFact = { role: string; displayName: string; signingAuthorityNote: string | null };
const SELLER_SIGNER_FACT_KEYS = ["role", "displayName", "signingAuthorityNote"] as const;

function validateSellerSignerFact(v: unknown): SellerSignerFact | null {
  if (!isPlainObject(v)) return null;
  if (!hasExactKeys(v, SELLER_SIGNER_FACT_KEYS)) return null;
  if (typeof v.role !== "string" || v.role.trim() === "") return null;
  if (typeof v.displayName !== "string" || v.displayName.trim() === "") return null;
  if (v.signingAuthorityNote !== null && typeof v.signingAuthorityNote !== "string") return null;
  return { role: v.role, displayName: v.displayName, signingAuthorityNote: v.signingAuthorityNote };
}

export const PARTY_SIGNER_FACTS_LEDGER_VERSION = "iaos-seller-contract-party-signer-facts-v1" as const;
const PARTY_SIGNER_FACTS_HEADER = `IAOS SELLER CONTRACT PARTY/SIGNER FACTS — ${PARTY_SIGNER_FACTS_LEDGER_VERSION}`;
const PARTY_SIGNER_FACTS_LABELS = ["Recorded at", "Operator", "Opportunity", "Signers"] as const;

export type ParsedPartySignerFacts = { opportunityId: string; at: string; operator: string | null; signers: SellerSignerFact[] };

export function formatPartySignerFactsNote(args: {
  opportunityId: string; at: string; operator: string | null; signers: SellerSignerFact[];
}): string {
  return [
    PARTY_SIGNER_FACTS_HEADER,
    `${PARTY_SIGNER_FACTS_LABELS[0]}: ${args.at}`,
    `${PARTY_SIGNER_FACTS_LABELS[1]}: ${ledgerValue(args.operator)}`,
    `${PARTY_SIGNER_FACTS_LABELS[2]}: ${args.opportunityId}`,
    `${PARTY_SIGNER_FACTS_LABELS[3]}: ${JSON.stringify(args.signers)}`,
  ].join("\n");
}

export function parsePartySignerFactsNote(body: string): ParsedPartySignerFacts | null {
  const values = matchPositionalSchema(body, PARTY_SIGNER_FACTS_HEADER, PARTY_SIGNER_FACTS_LABELS);
  if (!values) return null;
  const [at, operatorRaw, opportunityId, signersRaw] = values;
  if (opportunityId === "") return null;
  if (!isCanonicalIsoTimestamp(at)) return null;
  const parsed = safeJsonParse(signersRaw);
  if (!parsed.ok || !Array.isArray(parsed.value) || parsed.value.length === 0) return null;
  const signers: SellerSignerFact[] = [];
  for (const s of parsed.value) {
    const v = validateSellerSignerFact(s);
    if (!v) return null;
    signers.push(v);
  }
  return { opportunityId, at, operator: operatorRaw === "UNAVAILABLE" ? null : operatorRaw, signers };
}

export function latestPartySignerFactsForOpportunity(
  notes: { body: string }[], opportunityId: string,
): ParsedPartySignerFacts | null {
  let latest: ParsedPartySignerFacts | null = null;
  for (const note of notes) {
    const parsed = parsePartySignerFactsNote(note.body);
    if (!parsed || parsed.opportunityId !== opportunityId) continue;
    if (!latest || new Date(parsed.at).getTime() > new Date(latest.at).getTime()) latest = parsed;
  }
  return latest;
}

/* ==================================================================== */
/* 3. Property legal description facts (¶2A, 2D, 2E)                    */
/* ==================================================================== */

export type ReservationsFact = { kind: "none" } | { kind: "applies"; addendumNote: string };

export const PROPERTY_LEGAL_DESCRIPTION_LEDGER_VERSION = "iaos-property-legal-description-facts-v1" as const;
const PROPERTY_LEGAL_DESCRIPTION_HEADER = `IAOS PROPERTY LEGAL DESCRIPTION FACTS — ${PROPERTY_LEGAL_DESCRIPTION_LEDGER_VERSION}`;
const PROPERTY_LEGAL_DESCRIPTION_LABELS = [
  "Recorded at", "Operator", "Opportunity", "Lot", "Block", "Addition", "County", "Exclusions", "Reservations",
] as const;

export type ParsedPropertyLegalDescriptionFacts = {
  opportunityId: string; at: string; operator: string | null;
  lot: ValueOrNone; block: ValueOrNone; addition: ValueOrNone; county: ValueOrNone;
  exclusions: ValueOrNone; reservations: ReservationsFact;
};

function formatReservations(r: ReservationsFact): string { return JSON.stringify(r); }
function parseReservations(raw: string): ReservationsFact | null {
  const parsed = safeJsonParse(raw);
  if (!parsed.ok || !isPlainObject(parsed.value)) return null;
  const v = parsed.value;
  if (v.kind === "none") return hasExactKeys(v, ["kind"]) ? { kind: "none" } : null;
  if (v.kind === "applies") {
    if (!hasExactKeys(v, ["kind", "addendumNote"])) return null;
    if (typeof v.addendumNote !== "string" || v.addendumNote.trim() === "") return null;
    return { kind: "applies", addendumNote: v.addendumNote };
  }
  return null;
}

export function formatPropertyLegalDescriptionFactsNote(args: {
  opportunityId: string; at: string; operator: string | null;
  lot: ValueOrNone; block: ValueOrNone; addition: ValueOrNone; county: ValueOrNone;
  exclusions: ValueOrNone; reservations: ReservationsFact;
}): string {
  return [
    PROPERTY_LEGAL_DESCRIPTION_HEADER,
    `${PROPERTY_LEGAL_DESCRIPTION_LABELS[0]}: ${args.at}`,
    `${PROPERTY_LEGAL_DESCRIPTION_LABELS[1]}: ${ledgerValue(args.operator)}`,
    `${PROPERTY_LEGAL_DESCRIPTION_LABELS[2]}: ${args.opportunityId}`,
    `${PROPERTY_LEGAL_DESCRIPTION_LABELS[3]}: ${formatValueOrNoneJson(args.lot)}`,
    `${PROPERTY_LEGAL_DESCRIPTION_LABELS[4]}: ${formatValueOrNoneJson(args.block)}`,
    `${PROPERTY_LEGAL_DESCRIPTION_LABELS[5]}: ${formatValueOrNoneJson(args.addition)}`,
    `${PROPERTY_LEGAL_DESCRIPTION_LABELS[6]}: ${formatValueOrNoneJson(args.county)}`,
    `${PROPERTY_LEGAL_DESCRIPTION_LABELS[7]}: ${formatValueOrNoneJson(args.exclusions)}`,
    `${PROPERTY_LEGAL_DESCRIPTION_LABELS[8]}: ${formatReservations(args.reservations)}`,
  ].join("\n");
}

export function parsePropertyLegalDescriptionFactsNote(body: string): ParsedPropertyLegalDescriptionFacts | null {
  const values = matchPositionalSchema(body, PROPERTY_LEGAL_DESCRIPTION_HEADER, PROPERTY_LEGAL_DESCRIPTION_LABELS);
  if (!values) return null;
  const [at, operatorRaw, opportunityId, lotRaw, blockRaw, additionRaw, countyRaw, exclusionsRaw, reservationsRaw] = values;
  if (opportunityId === "") return null;
  if (!isCanonicalIsoTimestamp(at)) return null;
  const lot = parseValueOrNoneJson(lotRaw);
  const block = parseValueOrNoneJson(blockRaw);
  const addition = parseValueOrNoneJson(additionRaw);
  const county = parseValueOrNoneJson(countyRaw);
  const exclusions = parseValueOrNoneJson(exclusionsRaw);
  const reservations = parseReservations(reservationsRaw);
  if (!lot || !block || !addition || !county || !exclusions || !reservations) return null;
  return { opportunityId, at, operator: operatorRaw === "UNAVAILABLE" ? null : operatorRaw, lot, block, addition, county, exclusions, reservations };
}

export function latestPropertyLegalDescriptionFactsForOpportunity(
  notes: { body: string }[], opportunityId: string,
): ParsedPropertyLegalDescriptionFacts | null {
  let latest: ParsedPropertyLegalDescriptionFacts | null = null;
  for (const note of notes) {
    const parsed = parsePropertyLegalDescriptionFactsNote(note.body);
    if (!parsed || parsed.opportunityId !== opportunityId) continue;
    if (!latest || new Date(parsed.at).getTime() > new Date(latest.at).getTime()) latest = parsed;
  }
  return latest;
}

/* ==================================================================== */
/* 4. Lease disclosure facts (¶4)                                       */
/* ==================================================================== */

export type NaturalResourceLeaseFact =
  | { kind: "none" }
  | { kind: "delivered" }
  | { kind: "not_yet_delivered"; terminateWithinDays: number };

export const LEASE_DISCLOSURE_LEDGER_VERSION = "iaos-lease-disclosure-facts-v1" as const;
const LEASE_DISCLOSURE_HEADER = `IAOS LEASE DISCLOSURE FACTS — ${LEASE_DISCLOSURE_LEDGER_VERSION}`;
const LEASE_DISCLOSURE_LABELS = ["Recorded at", "Operator", "Opportunity", "Residential leases", "Fixture leases", "Natural resource leases"] as const;

export type ParsedLeaseDisclosureFacts = {
  opportunityId: string; at: string; operator: string | null;
  residentialLeases: "none" | "applies";
  fixtureLeases: "none" | "applies";
  naturalResourceLeases: NaturalResourceLeaseFact;
};

function parseNaturalResourceLeaseFact(raw: string): NaturalResourceLeaseFact | null {
  const parsed = safeJsonParse(raw);
  if (!parsed.ok || !isPlainObject(parsed.value)) return null;
  const v = parsed.value;
  if (v.kind === "none" || v.kind === "delivered") return hasExactKeys(v, ["kind"]) ? { kind: v.kind } : null;
  if (v.kind === "not_yet_delivered") {
    if (!hasExactKeys(v, ["kind", "terminateWithinDays"])) return null;
    if (typeof v.terminateWithinDays !== "number" || !Number.isInteger(v.terminateWithinDays) || v.terminateWithinDays <= 0) return null;
    return { kind: "not_yet_delivered", terminateWithinDays: v.terminateWithinDays };
  }
  return null;
}

export function formatLeaseDisclosureFactsNote(args: {
  opportunityId: string; at: string; operator: string | null;
  residentialLeases: "none" | "applies"; fixtureLeases: "none" | "applies"; naturalResourceLeases: NaturalResourceLeaseFact;
}): string {
  return [
    LEASE_DISCLOSURE_HEADER,
    `${LEASE_DISCLOSURE_LABELS[0]}: ${args.at}`,
    `${LEASE_DISCLOSURE_LABELS[1]}: ${ledgerValue(args.operator)}`,
    `${LEASE_DISCLOSURE_LABELS[2]}: ${args.opportunityId}`,
    `${LEASE_DISCLOSURE_LABELS[3]}: ${args.residentialLeases}`,
    `${LEASE_DISCLOSURE_LABELS[4]}: ${args.fixtureLeases}`,
    `${LEASE_DISCLOSURE_LABELS[5]}: ${JSON.stringify(args.naturalResourceLeases)}`,
  ].join("\n");
}

export function parseLeaseDisclosureFactsNote(body: string): ParsedLeaseDisclosureFacts | null {
  const values = matchPositionalSchema(body, LEASE_DISCLOSURE_HEADER, LEASE_DISCLOSURE_LABELS);
  if (!values) return null;
  const [at, operatorRaw, opportunityId, residentialRaw, fixtureRaw, naturalRaw] = values;
  if (opportunityId === "") return null;
  if (!isCanonicalIsoTimestamp(at)) return null;
  if (residentialRaw !== "none" && residentialRaw !== "applies") return null;
  if (fixtureRaw !== "none" && fixtureRaw !== "applies") return null;
  const naturalResourceLeases = parseNaturalResourceLeaseFact(naturalRaw);
  if (!naturalResourceLeases) return null;
  return { opportunityId, at, operator: operatorRaw === "UNAVAILABLE" ? null : operatorRaw, residentialLeases: residentialRaw, fixtureLeases: fixtureRaw, naturalResourceLeases };
}

export function latestLeaseDisclosureFactsForOpportunity(
  notes: { body: string }[], opportunityId: string,
): ParsedLeaseDisclosureFacts | null {
  let latest: ParsedLeaseDisclosureFacts | null = null;
  for (const note of notes) {
    const parsed = parseLeaseDisclosureFactsNote(note.body);
    if (!parsed || parsed.opportunityId !== opportunityId) continue;
    if (!latest || new Date(parsed.at).getTime() > new Date(latest.at).getTime()) latest = parsed;
  }
  return latest;
}

/* ==================================================================== */
/* 5. Earnest money and option facts (¶5)                                */
/* ==================================================================== */

export type AdditionalEarnestMoneyFact = { kind: "none" } | { kind: "value"; amount: number; withinDays: number };

/**
 * Jess Gate correction: version bumped v1 -> v2 because the wire shape of
 * three fields changed (raw number string -> `AmountOrNone`/`DaysOrNone`
 * JSON). No note in this format was ever written to a real GHL location --
 * confirmed before making this change -- so there is no v1 data to migrate.
 */
export const EARNEST_MONEY_OPTION_LEDGER_VERSION = "iaos-earnest-money-option-facts-v2" as const;
const EARNEST_MONEY_OPTION_HEADER = `IAOS EARNEST MONEY AND OPTION FACTS — ${EARNEST_MONEY_OPTION_LEDGER_VERSION}`;
const EARNEST_MONEY_OPTION_LABELS = [
  "Recorded at", "Operator", "Opportunity", "Escrow agent name", "Escrow agent address",
  "Earnest money", "Option fee", "Option period days", "Additional earnest money",
] as const;

export type ParsedEarnestMoneyOptionFacts = {
  opportunityId: string; at: string; operator: string | null;
  escrowAgentName: string; escrowAgentAddress: string;
  earnestMoney: AmountOrNone; optionFee: AmountOrNone; optionPeriodDays: DaysOrNone;
  additionalEarnestMoney: AdditionalEarnestMoneyFact;
};

function parseAdditionalEarnestMoney(raw: string): AdditionalEarnestMoneyFact | null {
  const parsed = safeJsonParse(raw);
  if (!parsed.ok || !isPlainObject(parsed.value)) return null;
  const v = parsed.value;
  if (v.kind === "none") return hasExactKeys(v, ["kind"]) ? { kind: "none" } : null;
  if (v.kind === "value") {
    if (!hasExactKeys(v, ["kind", "amount", "withinDays"])) return null;
    if (typeof v.amount !== "number" || !Number.isFinite(v.amount) || v.amount <= 0) return null;
    if (typeof v.withinDays !== "number" || !Number.isInteger(v.withinDays) || v.withinDays <= 0) return null;
    return { kind: "value", amount: v.amount, withinDays: v.withinDays };
  }
  return null;
}

export function formatEarnestMoneyOptionFactsNote(args: {
  opportunityId: string; at: string; operator: string | null;
  escrowAgentName: string; escrowAgentAddress: string;
  earnestMoney: AmountOrNone; optionFee: AmountOrNone; optionPeriodDays: DaysOrNone;
  additionalEarnestMoney: AdditionalEarnestMoneyFact;
}): string {
  return [
    EARNEST_MONEY_OPTION_HEADER,
    `${EARNEST_MONEY_OPTION_LABELS[0]}: ${args.at}`,
    `${EARNEST_MONEY_OPTION_LABELS[1]}: ${ledgerValue(args.operator)}`,
    `${EARNEST_MONEY_OPTION_LABELS[2]}: ${args.opportunityId}`,
    `${EARNEST_MONEY_OPTION_LABELS[3]}: ${args.escrowAgentName}`,
    `${EARNEST_MONEY_OPTION_LABELS[4]}: ${args.escrowAgentAddress}`,
    `${EARNEST_MONEY_OPTION_LABELS[5]}: ${formatAmountOrNone(args.earnestMoney)}`,
    `${EARNEST_MONEY_OPTION_LABELS[6]}: ${formatAmountOrNone(args.optionFee)}`,
    `${EARNEST_MONEY_OPTION_LABELS[7]}: ${formatDaysOrNone(args.optionPeriodDays)}`,
    `${EARNEST_MONEY_OPTION_LABELS[8]}: ${JSON.stringify(args.additionalEarnestMoney)}`,
  ].join("\n");
}

export function parseEarnestMoneyOptionFactsNote(body: string): ParsedEarnestMoneyOptionFacts | null {
  const values = matchPositionalSchema(body, EARNEST_MONEY_OPTION_HEADER, EARNEST_MONEY_OPTION_LABELS);
  if (!values) return null;
  const [at, operatorRaw, opportunityId, escrowAgentName, escrowAgentAddress, earnestRaw, optionFeeRaw, optionDaysRaw, additionalRaw] = values;
  if (opportunityId === "" || escrowAgentName === "" || escrowAgentAddress === "") return null;
  if (!isCanonicalIsoTimestamp(at)) return null;
  const earnestMoney = parseAmountOrNone(earnestRaw);
  if (!earnestMoney) return null;
  const optionFee = parseAmountOrNone(optionFeeRaw);
  if (!optionFee) return null;
  const optionPeriodDays = parseDaysOrNone(optionDaysRaw);
  if (!optionPeriodDays) return null;
  const additionalEarnestMoney = parseAdditionalEarnestMoney(additionalRaw);
  if (!additionalEarnestMoney) return null;
  return { opportunityId, at, operator: operatorRaw === "UNAVAILABLE" ? null : operatorRaw, escrowAgentName, escrowAgentAddress, earnestMoney, optionFee, optionPeriodDays, additionalEarnestMoney };
}

export function latestEarnestMoneyOptionFactsForOpportunity(
  notes: { body: string }[], opportunityId: string,
): ParsedEarnestMoneyOptionFacts | null {
  let latest: ParsedEarnestMoneyOptionFacts | null = null;
  for (const note of notes) {
    const parsed = parseEarnestMoneyOptionFactsNote(note.body);
    if (!parsed || parsed.opportunityId !== opportunityId) continue;
    if (!latest || new Date(parsed.at).getTime() > new Date(latest.at).getTime()) latest = parsed;
  }
  return latest;
}

/* ==================================================================== */
/* 6. Title and survey facts (¶6)                                       */
/* ==================================================================== */

export type ExpenseParty = "seller" | "buyer";
export type SurveyElection =
  | { option: "seller_existing_survey"; sellerFurnishDays: number; ifRejectedExpenseParty: ExpenseParty }
  | { option: "buyer_new_survey"; buyerObtainDays: number }
  | { option: "seller_new_survey"; sellerFurnishDays: number };

export const TITLE_SURVEY_LEDGER_VERSION = "iaos-title-survey-facts-v1" as const;
const TITLE_SURVEY_HEADER = `IAOS TITLE AND SURVEY FACTS — ${TITLE_SURVEY_LEDGER_VERSION}`;
const TITLE_SURVEY_LABELS = [
  "Recorded at", "Operator", "Opportunity", "Title policy expense party", "Title company name",
  "Shortage amendment election", "Survey election", "Objections text", "Objections days", "POA membership",
] as const;

export type ShortageAmendmentElection = { kind: "not_amended" } | { kind: "amended"; expenseParty: ExpenseParty };

export type ParsedTitleSurveyFacts = {
  opportunityId: string; at: string; operator: string | null;
  titlePolicyExpenseParty: ExpenseParty;
  titleCompanyName: string;
  shortageAmendmentElection: ShortageAmendmentElection;
  surveyElection: SurveyElection;
  objectionsText: ValueOrNone;
  objectionsDays: number;
  poaMembership: "is_subject" | "is_not_subject";
};

function parseExpenseParty(raw: unknown): ExpenseParty | null {
  return raw === "seller" || raw === "buyer" ? raw : null;
}
function parseShortageAmendmentElection(raw: string): ShortageAmendmentElection | null {
  const parsed = safeJsonParse(raw);
  if (!parsed.ok || !isPlainObject(parsed.value)) return null;
  const v = parsed.value;
  if (v.kind === "not_amended") return hasExactKeys(v, ["kind"]) ? { kind: "not_amended" } : null;
  if (v.kind === "amended") {
    if (!hasExactKeys(v, ["kind", "expenseParty"])) return null;
    const ep = parseExpenseParty(v.expenseParty);
    if (!ep) return null;
    return { kind: "amended", expenseParty: ep };
  }
  return null;
}
function parseSurveyElection(raw: string): SurveyElection | null {
  const parsed = safeJsonParse(raw);
  if (!parsed.ok || !isPlainObject(parsed.value)) return null;
  const v = parsed.value;
  if (v.option === "seller_existing_survey") {
    if (!hasExactKeys(v, ["option", "sellerFurnishDays", "ifRejectedExpenseParty"])) return null;
    if (typeof v.sellerFurnishDays !== "number" || !Number.isInteger(v.sellerFurnishDays) || v.sellerFurnishDays <= 0) return null;
    const ep = parseExpenseParty(v.ifRejectedExpenseParty);
    if (!ep) return null;
    return { option: "seller_existing_survey", sellerFurnishDays: v.sellerFurnishDays, ifRejectedExpenseParty: ep };
  }
  if (v.option === "buyer_new_survey") {
    if (!hasExactKeys(v, ["option", "buyerObtainDays"])) return null;
    if (typeof v.buyerObtainDays !== "number" || !Number.isInteger(v.buyerObtainDays) || v.buyerObtainDays <= 0) return null;
    return { option: "buyer_new_survey", buyerObtainDays: v.buyerObtainDays };
  }
  if (v.option === "seller_new_survey") {
    if (!hasExactKeys(v, ["option", "sellerFurnishDays"])) return null;
    if (typeof v.sellerFurnishDays !== "number" || !Number.isInteger(v.sellerFurnishDays) || v.sellerFurnishDays <= 0) return null;
    return { option: "seller_new_survey", sellerFurnishDays: v.sellerFurnishDays };
  }
  return null;
}

export function formatTitleSurveyFactsNote(args: {
  opportunityId: string; at: string; operator: string | null;
  titlePolicyExpenseParty: ExpenseParty; titleCompanyName: string;
  shortageAmendmentElection: ShortageAmendmentElection; surveyElection: SurveyElection;
  objectionsText: ValueOrNone; objectionsDays: number; poaMembership: "is_subject" | "is_not_subject";
}): string {
  return [
    TITLE_SURVEY_HEADER,
    `${TITLE_SURVEY_LABELS[0]}: ${args.at}`,
    `${TITLE_SURVEY_LABELS[1]}: ${ledgerValue(args.operator)}`,
    `${TITLE_SURVEY_LABELS[2]}: ${args.opportunityId}`,
    `${TITLE_SURVEY_LABELS[3]}: ${args.titlePolicyExpenseParty}`,
    `${TITLE_SURVEY_LABELS[4]}: ${args.titleCompanyName}`,
    `${TITLE_SURVEY_LABELS[5]}: ${JSON.stringify(args.shortageAmendmentElection)}`,
    `${TITLE_SURVEY_LABELS[6]}: ${JSON.stringify(args.surveyElection)}`,
    `${TITLE_SURVEY_LABELS[7]}: ${formatValueOrNoneJson(args.objectionsText)}`,
    `${TITLE_SURVEY_LABELS[8]}: ${args.objectionsDays}`,
    `${TITLE_SURVEY_LABELS[9]}: ${args.poaMembership}`,
  ].join("\n");
}

export function parseTitleSurveyFactsNote(body: string): ParsedTitleSurveyFacts | null {
  const values = matchPositionalSchema(body, TITLE_SURVEY_HEADER, TITLE_SURVEY_LABELS);
  if (!values) return null;
  const [at, operatorRaw, opportunityId, expensePartyRaw, titleCompanyName, shortageRaw, surveyRaw, objectionsTextRaw, objectionsDaysRaw, poaRaw] = values;
  if (opportunityId === "" || titleCompanyName === "") return null;
  if (!isCanonicalIsoTimestamp(at)) return null;
  const titlePolicyExpenseParty = parseExpenseParty(expensePartyRaw);
  if (!titlePolicyExpenseParty) return null;
  const shortageAmendmentElection = parseShortageAmendmentElection(shortageRaw);
  if (!shortageAmendmentElection) return null;
  const surveyElection = parseSurveyElection(surveyRaw);
  if (!surveyElection) return null;
  const objectionsText = parseValueOrNoneJson(objectionsTextRaw);
  if (!objectionsText) return null;
  const objectionsDays = Number(objectionsDaysRaw);
  if (!Number.isInteger(objectionsDays) || objectionsDays < 0) return null;
  if (poaRaw !== "is_subject" && poaRaw !== "is_not_subject") return null;
  return {
    opportunityId, at, operator: operatorRaw === "UNAVAILABLE" ? null : operatorRaw,
    titlePolicyExpenseParty, titleCompanyName, shortageAmendmentElection, surveyElection,
    objectionsText, objectionsDays, poaMembership: poaRaw,
  };
}

export function latestTitleSurveyFactsForOpportunity(
  notes: { body: string }[], opportunityId: string,
): ParsedTitleSurveyFacts | null {
  let latest: ParsedTitleSurveyFacts | null = null;
  for (const note of notes) {
    const parsed = parseTitleSurveyFactsNote(note.body);
    if (!parsed || parsed.opportunityId !== opportunityId) continue;
    if (!latest || new Date(parsed.at).getTime() > new Date(latest.at).getTime()) latest = parsed;
  }
  return latest;
}

/* ==================================================================== */
/* 7. Property condition facts (¶7)                                     */
/* ==================================================================== */

export type SellerDisclosureNoticeFact =
  | { kind: "received" }
  | { kind: "not_yet_received"; deliverWithinDays: number }
  | { kind: "not_required" };

export type AsIsElectionFact = { kind: "as_is" } | { kind: "as_is_with_repairs"; repairsText: string };

export type WaterDisclosureFact =
  | { kind: "received" }
  | { kind: "not_yet_received"; deliverWithinDays: number }
  | { kind: "exempt"; noWell: boolean; noPondLakeTank: boolean; noSurfaceWaterCertificate: boolean; noSeveredRights: boolean; waterSource: string };

export const PROPERTY_CONDITION_LEDGER_VERSION = "iaos-property-condition-facts-v1" as const;
const PROPERTY_CONDITION_HEADER = `IAOS PROPERTY CONDITION FACTS — ${PROPERTY_CONDITION_LEDGER_VERSION}`;
const PROPERTY_CONDITION_LABELS = [
  "Recorded at", "Operator", "Opportunity", "Seller disclosure notice", "As-is election", "Service contract cap", "Water disclosure",
] as const;

export type ParsedPropertyConditionFacts = {
  opportunityId: string; at: string; operator: string | null;
  sellerDisclosureNotice: SellerDisclosureNoticeFact;
  asIsElection: AsIsElectionFact;
  serviceContractCap: ValueOrNone;
  waterDisclosure: WaterDisclosureFact;
};

function parseSellerDisclosureNoticeFact(raw: string): SellerDisclosureNoticeFact | null {
  const parsed = safeJsonParse(raw);
  if (!parsed.ok || !isPlainObject(parsed.value)) return null;
  const v = parsed.value;
  if (v.kind === "received" || v.kind === "not_required") return hasExactKeys(v, ["kind"]) ? { kind: v.kind } : null;
  if (v.kind === "not_yet_received") {
    if (!hasExactKeys(v, ["kind", "deliverWithinDays"])) return null;
    if (typeof v.deliverWithinDays !== "number" || !Number.isInteger(v.deliverWithinDays) || v.deliverWithinDays <= 0) return null;
    return { kind: "not_yet_received", deliverWithinDays: v.deliverWithinDays };
  }
  return null;
}
function parseAsIsElectionFact(raw: string): AsIsElectionFact | null {
  const parsed = safeJsonParse(raw);
  if (!parsed.ok || !isPlainObject(parsed.value)) return null;
  const v = parsed.value;
  if (v.kind === "as_is") return hasExactKeys(v, ["kind"]) ? { kind: "as_is" } : null;
  if (v.kind === "as_is_with_repairs") {
    if (!hasExactKeys(v, ["kind", "repairsText"])) return null;
    if (typeof v.repairsText !== "string" || v.repairsText.trim() === "") return null;
    return { kind: "as_is_with_repairs", repairsText: v.repairsText };
  }
  return null;
}
function parseWaterDisclosureFact(raw: string): WaterDisclosureFact | null {
  const parsed = safeJsonParse(raw);
  if (!parsed.ok || !isPlainObject(parsed.value)) return null;
  const v = parsed.value;
  if (v.kind === "received") return hasExactKeys(v, ["kind"]) ? { kind: "received" } : null;
  if (v.kind === "not_yet_received") {
    if (!hasExactKeys(v, ["kind", "deliverWithinDays"])) return null;
    if (typeof v.deliverWithinDays !== "number" || !Number.isInteger(v.deliverWithinDays) || v.deliverWithinDays <= 0) return null;
    return { kind: "not_yet_received", deliverWithinDays: v.deliverWithinDays };
  }
  if (v.kind === "exempt") {
    if (!hasExactKeys(v, ["kind", "noWell", "noPondLakeTank", "noSurfaceWaterCertificate", "noSeveredRights", "waterSource"])) return null;
    if (typeof v.noWell !== "boolean" || typeof v.noPondLakeTank !== "boolean" || typeof v.noSurfaceWaterCertificate !== "boolean" || typeof v.noSeveredRights !== "boolean") return null;
    if (typeof v.waterSource !== "string" || v.waterSource.trim() === "") return null;
    if (!v.noWell || !v.noPondLakeTank || !v.noSurfaceWaterCertificate || !v.noSeveredRights) return null;
    return { kind: "exempt", noWell: true, noPondLakeTank: true, noSurfaceWaterCertificate: true, noSeveredRights: true, waterSource: v.waterSource };
  }
  return null;
}

export function formatPropertyConditionFactsNote(args: {
  opportunityId: string; at: string; operator: string | null;
  sellerDisclosureNotice: SellerDisclosureNoticeFact; asIsElection: AsIsElectionFact;
  serviceContractCap: ValueOrNone; waterDisclosure: WaterDisclosureFact;
}): string {
  return [
    PROPERTY_CONDITION_HEADER,
    `${PROPERTY_CONDITION_LABELS[0]}: ${args.at}`,
    `${PROPERTY_CONDITION_LABELS[1]}: ${ledgerValue(args.operator)}`,
    `${PROPERTY_CONDITION_LABELS[2]}: ${args.opportunityId}`,
    `${PROPERTY_CONDITION_LABELS[3]}: ${JSON.stringify(args.sellerDisclosureNotice)}`,
    `${PROPERTY_CONDITION_LABELS[4]}: ${JSON.stringify(args.asIsElection)}`,
    `${PROPERTY_CONDITION_LABELS[5]}: ${formatValueOrNoneJson(args.serviceContractCap)}`,
    `${PROPERTY_CONDITION_LABELS[6]}: ${JSON.stringify(args.waterDisclosure)}`,
  ].join("\n");
}

export function parsePropertyConditionFactsNote(body: string): ParsedPropertyConditionFacts | null {
  const values = matchPositionalSchema(body, PROPERTY_CONDITION_HEADER, PROPERTY_CONDITION_LABELS);
  if (!values) return null;
  const [at, operatorRaw, opportunityId, disclosureRaw, asIsRaw, capRaw, waterRaw] = values;
  if (opportunityId === "") return null;
  if (!isCanonicalIsoTimestamp(at)) return null;
  const sellerDisclosureNotice = parseSellerDisclosureNoticeFact(disclosureRaw);
  if (!sellerDisclosureNotice) return null;
  const asIsElection = parseAsIsElectionFact(asIsRaw);
  if (!asIsElection) return null;
  const serviceContractCap = parseValueOrNoneJson(capRaw);
  if (!serviceContractCap) return null;
  const waterDisclosure = parseWaterDisclosureFact(waterRaw);
  if (!waterDisclosure) return null;
  return { opportunityId, at, operator: operatorRaw === "UNAVAILABLE" ? null : operatorRaw, sellerDisclosureNotice, asIsElection, serviceContractCap, waterDisclosure };
}

export function latestPropertyConditionFactsForOpportunity(
  notes: { body: string }[], opportunityId: string,
): ParsedPropertyConditionFacts | null {
  let latest: ParsedPropertyConditionFacts | null = null;
  for (const note of notes) {
    const parsed = parsePropertyConditionFactsNote(note.body);
    if (!parsed || parsed.opportunityId !== opportunityId) continue;
    if (!latest || new Date(parsed.at).getTime() > new Date(latest.at).getTime()) latest = parsed;
  }
  return latest;
}

/* ==================================================================== */
/* 8. Closing and possession facts (¶9, ¶10)                             */
/* ==================================================================== */

export const CLOSING_POSSESSION_LEDGER_VERSION = "iaos-closing-possession-facts-v1" as const;
const CLOSING_POSSESSION_HEADER = `IAOS CLOSING AND POSSESSION FACTS — ${CLOSING_POSSESSION_LEDGER_VERSION}`;
const CLOSING_POSSESSION_LABELS = ["Recorded at", "Operator", "Opportunity", "Closing date", "Possession election", "Possession details"] as const;

export type ParsedClosingPossessionFacts = {
  opportunityId: string; at: string; operator: string | null;
  closingDate: string;
  possessionElection: "upon_closing_and_funding" | "leaseback";
  possessionDetails: ValueOrNone;
};

export function formatClosingPossessionFactsNote(args: {
  opportunityId: string; at: string; operator: string | null;
  closingDate: string; possessionElection: "upon_closing_and_funding" | "leaseback"; possessionDetails: ValueOrNone;
}): string {
  return [
    CLOSING_POSSESSION_HEADER,
    `${CLOSING_POSSESSION_LABELS[0]}: ${args.at}`,
    `${CLOSING_POSSESSION_LABELS[1]}: ${ledgerValue(args.operator)}`,
    `${CLOSING_POSSESSION_LABELS[2]}: ${args.opportunityId}`,
    `${CLOSING_POSSESSION_LABELS[3]}: ${args.closingDate}`,
    `${CLOSING_POSSESSION_LABELS[4]}: ${args.possessionElection}`,
    `${CLOSING_POSSESSION_LABELS[5]}: ${formatValueOrNoneJson(args.possessionDetails)}`,
  ].join("\n");
}

export function parseClosingPossessionFactsNote(body: string): ParsedClosingPossessionFacts | null {
  const values = matchPositionalSchema(body, CLOSING_POSSESSION_HEADER, CLOSING_POSSESSION_LABELS);
  if (!values) return null;
  const [at, operatorRaw, opportunityId, closingDate, possessionElectionRaw, possessionDetailsRaw] = values;
  if (opportunityId === "") return null;
  if (!isCanonicalIsoTimestamp(at)) return null;
  if (!isCanonicalIsoTimestamp(closingDate)) return null;
  if (possessionElectionRaw !== "upon_closing_and_funding" && possessionElectionRaw !== "leaseback") return null;
  const possessionDetails = parseValueOrNoneJson(possessionDetailsRaw);
  if (!possessionDetails) return null;
  return { opportunityId, at, operator: operatorRaw === "UNAVAILABLE" ? null : operatorRaw, closingDate, possessionElection: possessionElectionRaw, possessionDetails };
}

export function latestClosingPossessionFactsForOpportunity(
  notes: { body: string }[], opportunityId: string,
): ParsedClosingPossessionFacts | null {
  let latest: ParsedClosingPossessionFacts | null = null;
  for (const note of notes) {
    const parsed = parseClosingPossessionFactsNote(note.body);
    if (!parsed || parsed.opportunityId !== opportunityId) continue;
    if (!latest || new Date(parsed.at).getTime() > new Date(latest.at).getTime()) latest = parsed;
  }
  return latest;
}

/* ==================================================================== */
/* 9. Settlement expense facts (¶12)                                    */
/* ==================================================================== */

export type BrokerageContribution = { kind: "none" } | { kind: "dollar"; amount: number } | { kind: "percent"; percent: number };

export const SETTLEMENT_EXPENSE_LEDGER_VERSION = "iaos-settlement-expense-facts-v1" as const;
const SETTLEMENT_EXPENSE_HEADER = `IAOS SETTLEMENT EXPENSE FACTS — ${SETTLEMENT_EXPENSE_LEDGER_VERSION}`;
const SETTLEMENT_EXPENSE_LABELS = [
  "Recorded at", "Operator", "Opportunity", "Seller credit cap", "Seller pays buyer broker", "Buyer pays seller broker",
] as const;

export type ParsedSettlementExpenseFacts = {
  opportunityId: string; at: string; operator: string | null;
  sellerCreditCap: ValueOrNone;
  sellerPaysBuyerBroker: BrokerageContribution;
  buyerPaysSellerBroker: BrokerageContribution;
};

function parseBrokerageContribution(raw: string): BrokerageContribution | null {
  const parsed = safeJsonParse(raw);
  if (!parsed.ok || !isPlainObject(parsed.value)) return null;
  const v = parsed.value;
  if (v.kind === "none") return hasExactKeys(v, ["kind"]) ? { kind: "none" } : null;
  if (v.kind === "dollar") {
    if (!hasExactKeys(v, ["kind", "amount"])) return null;
    if (typeof v.amount !== "number" || !Number.isFinite(v.amount) || v.amount <= 0) return null;
    return { kind: "dollar", amount: v.amount };
  }
  if (v.kind === "percent") {
    if (!hasExactKeys(v, ["kind", "percent"])) return null;
    if (typeof v.percent !== "number" || !Number.isFinite(v.percent) || v.percent <= 0 || v.percent > 100) return null;
    return { kind: "percent", percent: v.percent };
  }
  return null;
}

export function formatSettlementExpenseFactsNote(args: {
  opportunityId: string; at: string; operator: string | null;
  sellerCreditCap: ValueOrNone; sellerPaysBuyerBroker: BrokerageContribution; buyerPaysSellerBroker: BrokerageContribution;
}): string {
  return [
    SETTLEMENT_EXPENSE_HEADER,
    `${SETTLEMENT_EXPENSE_LABELS[0]}: ${args.at}`,
    `${SETTLEMENT_EXPENSE_LABELS[1]}: ${ledgerValue(args.operator)}`,
    `${SETTLEMENT_EXPENSE_LABELS[2]}: ${args.opportunityId}`,
    `${SETTLEMENT_EXPENSE_LABELS[3]}: ${formatValueOrNoneJson(args.sellerCreditCap)}`,
    `${SETTLEMENT_EXPENSE_LABELS[4]}: ${JSON.stringify(args.sellerPaysBuyerBroker)}`,
    `${SETTLEMENT_EXPENSE_LABELS[5]}: ${JSON.stringify(args.buyerPaysSellerBroker)}`,
  ].join("\n");
}

export function parseSettlementExpenseFactsNote(body: string): ParsedSettlementExpenseFacts | null {
  const values = matchPositionalSchema(body, SETTLEMENT_EXPENSE_HEADER, SETTLEMENT_EXPENSE_LABELS);
  if (!values) return null;
  const [at, operatorRaw, opportunityId, capRaw, sellerPaysRaw, buyerPaysRaw] = values;
  if (opportunityId === "") return null;
  if (!isCanonicalIsoTimestamp(at)) return null;
  const sellerCreditCap = parseValueOrNoneJson(capRaw);
  if (!sellerCreditCap) return null;
  const sellerPaysBuyerBroker = parseBrokerageContribution(sellerPaysRaw);
  if (!sellerPaysBuyerBroker) return null;
  const buyerPaysSellerBroker = parseBrokerageContribution(buyerPaysRaw);
  if (!buyerPaysSellerBroker) return null;
  return { opportunityId, at, operator: operatorRaw === "UNAVAILABLE" ? null : operatorRaw, sellerCreditCap, sellerPaysBuyerBroker, buyerPaysSellerBroker };
}

export function latestSettlementExpenseFactsForOpportunity(
  notes: { body: string }[], opportunityId: string,
): ParsedSettlementExpenseFacts | null {
  let latest: ParsedSettlementExpenseFacts | null = null;
  for (const note of notes) {
    const parsed = parseSettlementExpenseFactsNote(note.body);
    if (!parsed || parsed.opportunityId !== opportunityId) continue;
    if (!latest || new Date(parsed.at).getTime() > new Date(latest.at).getTime()) latest = parsed;
  }
  return latest;
}

/* ==================================================================== */
/* 10. Representation facts -- ONE shared fact for ¶8, ¶12B, p.11, ¶21  */
/* ==================================================================== */

export type BrokerInfo = { firmName: string; licenseNo: string; associateName: string; associateLicenseNo: string; email: string; phone: string };
const BROKER_INFO_KEYS = ["firmName", "licenseNo", "associateName", "associateLicenseNo", "email", "phone"] as const;

export type RepresentationFact = { kind: "none" } | { kind: "represented"; sellerAgent: BrokerInfo | null; buyerAgent: BrokerInfo | null };

function validateBrokerInfo(v: unknown): BrokerInfo | null {
  if (!isPlainObject(v)) return null;
  if (!hasExactKeys(v, BROKER_INFO_KEYS)) return null;
  for (const k of BROKER_INFO_KEYS) {
    if (typeof v[k] !== "string" || (v[k] as string).trim() === "") return null;
  }
  return v as unknown as BrokerInfo;
}

export const REPRESENTATION_LEDGER_VERSION = "iaos-representation-facts-v1" as const;
const REPRESENTATION_HEADER = `IAOS REPRESENTATION FACTS — ${REPRESENTATION_LEDGER_VERSION}`;
const REPRESENTATION_LABELS = ["Recorded at", "Operator", "Opportunity", "Representation"] as const;

export type ParsedRepresentationFacts = { opportunityId: string; at: string; operator: string | null; representation: RepresentationFact };

export function formatRepresentationFactsNote(args: {
  opportunityId: string; at: string; operator: string | null; representation: RepresentationFact;
}): string {
  return [
    REPRESENTATION_HEADER,
    `${REPRESENTATION_LABELS[0]}: ${args.at}`,
    `${REPRESENTATION_LABELS[1]}: ${ledgerValue(args.operator)}`,
    `${REPRESENTATION_LABELS[2]}: ${args.opportunityId}`,
    `${REPRESENTATION_LABELS[3]}: ${JSON.stringify(args.representation)}`,
  ].join("\n");
}

export function parseRepresentationFactsNote(body: string): ParsedRepresentationFacts | null {
  const values = matchPositionalSchema(body, REPRESENTATION_HEADER, REPRESENTATION_LABELS);
  if (!values) return null;
  const [at, operatorRaw, opportunityId, repRaw] = values;
  if (opportunityId === "") return null;
  if (!isCanonicalIsoTimestamp(at)) return null;
  const parsed = safeJsonParse(repRaw);
  if (!parsed.ok || !isPlainObject(parsed.value)) return null;
  const v = parsed.value;
  let representation: RepresentationFact;
  if (v.kind === "none") {
    if (!hasExactKeys(v, ["kind"])) return null;
    representation = { kind: "none" };
  } else if (v.kind === "represented") {
    if (!hasExactKeys(v, ["kind", "sellerAgent", "buyerAgent"])) return null;
    const sellerAgent = v.sellerAgent === null ? null : validateBrokerInfo(v.sellerAgent);
    const buyerAgent = v.buyerAgent === null ? null : validateBrokerInfo(v.buyerAgent);
    if (sellerAgent === undefined || buyerAgent === undefined) return null;
    if (v.sellerAgent !== null && sellerAgent === null) return null;
    if (v.buyerAgent !== null && buyerAgent === null) return null;
    representation = { kind: "represented", sellerAgent, buyerAgent };
  } else {
    return null;
  }
  return { opportunityId, at, operator: operatorRaw === "UNAVAILABLE" ? null : operatorRaw, representation };
}

export function latestRepresentationFactsForOpportunity(
  notes: { body: string }[], opportunityId: string,
): ParsedRepresentationFacts | null {
  let latest: ParsedRepresentationFacts | null = null;
  for (const note of notes) {
    const parsed = parseRepresentationFactsNote(note.body);
    if (!parsed || parsed.opportunityId !== opportunityId) continue;
    if (!latest || new Date(parsed.at).getTime() > new Date(latest.at).getTime()) latest = parsed;
  }
  return latest;
}

/* ==================================================================== */
/* 11. Addenda applicability facts (¶22, minus financing/lease/other)   */
/* ==================================================================== */

/**
 * Financing addenda (Third Party Financing, Seller Financing, Loan
 * Assumption, and the VA-restoration addendum tied to an assumed loan)
 * are NOT keys here -- per this session's locked ruling, they are fixed
 * UNSUPPORTED for V1, not a per-deal choice. Lease addenda are already
 * covered by `LeaseDisclosureFacts` above. "Other:" free text is
 * attorney/manual-only (Section 13).
 */
export const ADDENDA_APPLICABILITY_ITEM_KEYS = [
  "sale_of_other_property",
  "lender_appraisal_termination",
  "section_1031_exchange",
  "short_sale",
  "hydrostatic_testing",
  "environmental_assessment",
  "lead_based_paint",
  "propane_gas_service_area",
  "seaward_of_gulf_intracoastal",
  "coastal_area_property",
  "poa_membership",
  "non_realty_items",
  "back_up_contract",
  "mineral_reservation",
] as const;
export type AddendaApplicabilityItemKey = (typeof ADDENDA_APPLICABILITY_ITEM_KEYS)[number];
export type AddendaApplicabilityItems = Record<AddendaApplicabilityItemKey, boolean>;

export const DISTRICT_NOTICES_LEDGER_VERSION = "iaos-addenda-applicability-facts-v1" as const;
const ADDENDA_APPLICABILITY_HEADER = `IAOS ADDENDA APPLICABILITY FACTS — ${DISTRICT_NOTICES_LEDGER_VERSION}`;
const ADDENDA_APPLICABILITY_LABELS = ["Recorded at", "Operator", "Opportunity", "Items", "District notices"] as const;

export type ParsedAddendaApplicabilityFacts = {
  opportunityId: string; at: string; operator: string | null;
  items: AddendaApplicabilityItems;
  districtNotices: ValueOrNone;
};

export function formatAddendaApplicabilityFactsNote(args: {
  opportunityId: string; at: string; operator: string | null; items: AddendaApplicabilityItems; districtNotices: ValueOrNone;
}): string {
  return [
    ADDENDA_APPLICABILITY_HEADER,
    `${ADDENDA_APPLICABILITY_LABELS[0]}: ${args.at}`,
    `${ADDENDA_APPLICABILITY_LABELS[1]}: ${ledgerValue(args.operator)}`,
    `${ADDENDA_APPLICABILITY_LABELS[2]}: ${args.opportunityId}`,
    `${ADDENDA_APPLICABILITY_LABELS[3]}: ${JSON.stringify(args.items)}`,
    `${ADDENDA_APPLICABILITY_LABELS[4]}: ${formatValueOrNoneJson(args.districtNotices)}`,
  ].join("\n");
}

export function parseAddendaApplicabilityFactsNote(body: string): ParsedAddendaApplicabilityFacts | null {
  const values = matchPositionalSchema(body, ADDENDA_APPLICABILITY_HEADER, ADDENDA_APPLICABILITY_LABELS);
  if (!values) return null;
  const [at, operatorRaw, opportunityId, itemsRaw, districtRaw] = values;
  if (opportunityId === "") return null;
  if (!isCanonicalIsoTimestamp(at)) return null;
  const parsed = safeJsonParse(itemsRaw);
  if (!parsed.ok || !isPlainObject(parsed.value)) return null;
  if (!hasExactKeys(parsed.value, ADDENDA_APPLICABILITY_ITEM_KEYS)) return null;
  const items = {} as AddendaApplicabilityItems;
  for (const key of ADDENDA_APPLICABILITY_ITEM_KEYS) {
    const v = parsed.value[key];
    if (typeof v !== "boolean") return null;
    items[key] = v;
  }
  const districtNotices = parseValueOrNoneJson(districtRaw);
  if (!districtNotices) return null;
  return { opportunityId, at, operator: operatorRaw === "UNAVAILABLE" ? null : operatorRaw, items, districtNotices };
}

export function latestAddendaApplicabilityFactsForOpportunity(
  notes: { body: string }[], opportunityId: string,
): ParsedAddendaApplicabilityFacts | null {
  let latest: ParsedAddendaApplicabilityFacts | null = null;
  for (const note of notes) {
    const parsed = parseAddendaApplicabilityFactsNote(note.body);
    if (!parsed || parsed.opportunityId !== opportunityId) continue;
    if (!latest || new Date(parsed.at).getTime() > new Date(latest.at).getTime()) latest = parsed;
  }
  return latest;
}

/* ==================================================================== */
/* 12. Seller-side equitable-interest disclosure (assignee-side and the */
/*     Assignment Agreement itself are Board #11 -- NOT here)           */
/* ==================================================================== */

export const SELLER_EQUITABLE_INTEREST_LEDGER_VERSION = "iaos-seller-equitable-interest-disclosure-v1" as const;
const SELLER_EQUITABLE_INTEREST_HEADER = `IAOS SELLER EQUITABLE INTEREST DISCLOSURE — ${SELLER_EQUITABLE_INTEREST_LEDGER_VERSION}`;
const SELLER_EQUITABLE_INTEREST_LABELS = ["Recorded at", "Operator", "Opportunity", "Disposition"] as const;

export type EquitableInterestDisposition = { kind: "not_yet_made" } | { kind: "made"; at: string };

export type ParsedSellerEquitableInterestDisclosure = { opportunityId: string; at: string; operator: string | null; disposition: EquitableInterestDisposition };

export function formatSellerEquitableInterestDisclosureNote(args: {
  opportunityId: string; at: string; operator: string | null; disposition: EquitableInterestDisposition;
}): string {
  return [
    SELLER_EQUITABLE_INTEREST_HEADER,
    `${SELLER_EQUITABLE_INTEREST_LABELS[0]}: ${args.at}`,
    `${SELLER_EQUITABLE_INTEREST_LABELS[1]}: ${ledgerValue(args.operator)}`,
    `${SELLER_EQUITABLE_INTEREST_LABELS[2]}: ${args.opportunityId}`,
    `${SELLER_EQUITABLE_INTEREST_LABELS[3]}: ${JSON.stringify(args.disposition)}`,
  ].join("\n");
}

export function parseSellerEquitableInterestDisclosureNote(body: string): ParsedSellerEquitableInterestDisclosure | null {
  const values = matchPositionalSchema(body, SELLER_EQUITABLE_INTEREST_HEADER, SELLER_EQUITABLE_INTEREST_LABELS);
  if (!values) return null;
  const [at, operatorRaw, opportunityId, dispositionRaw] = values;
  if (opportunityId === "") return null;
  if (!isCanonicalIsoTimestamp(at)) return null;
  const parsed = safeJsonParse(dispositionRaw);
  if (!parsed.ok || !isPlainObject(parsed.value)) return null;
  const v = parsed.value;
  let disposition: EquitableInterestDisposition;
  if (v.kind === "not_yet_made") {
    if (!hasExactKeys(v, ["kind"])) return null;
    disposition = { kind: "not_yet_made" };
  } else if (v.kind === "made") {
    if (!hasExactKeys(v, ["kind", "at"])) return null;
    if (typeof v.at !== "string" || !isCanonicalIsoTimestamp(v.at)) return null;
    disposition = { kind: "made", at: v.at };
  } else {
    return null;
  }
  return { opportunityId, at, operator: operatorRaw === "UNAVAILABLE" ? null : operatorRaw, disposition };
}

export function latestSellerEquitableInterestDisclosureForOpportunity(
  notes: { body: string }[], opportunityId: string,
): ParsedSellerEquitableInterestDisclosure | null {
  let latest: ParsedSellerEquitableInterestDisclosure | null = null;
  for (const note of notes) {
    const parsed = parseSellerEquitableInterestDisclosureNote(note.body);
    if (!parsed || parsed.opportunityId !== opportunityId) continue;
    if (!latest || new Date(parsed.at).getTime() > new Date(latest.at).getTime()) latest = parsed;
  }
  return latest;
}

/* ==================================================================== */
/* 13. Attorney/manual-controlled field disposition (¶11, ¶22 "Other:") */
/* ==================================================================== */

/**
 * IAOS NEVER drafts, interprets, recommends, or approves the text this
 * carrier may hold. `provided_verbatim.text` is stored EXACTLY as the
 * operator/attorney supplied it -- an opaque string this module does not
 * parse, validate for legal content, or otherwise interpret. What IS
 * tracked is DISPOSITION (has this slot been addressed at all) and
 * PROVENANCE (who supplied it, when) -- both plain facts, not legal
 * judgments.
 */
export type AttorneyManualFieldSlot = "special_provisions" | "other_addenda_text";
export type AttorneyManualFieldDisposition =
  | { kind: "not_applicable" }
  | { kind: "attorney_will_draft" }
  | { kind: "provided_verbatim"; text: string };

export const ATTORNEY_MANUAL_FIELD_LEDGER_VERSION = "iaos-attorney-manual-field-disposition-v1" as const;
const ATTORNEY_MANUAL_FIELD_HEADER = `IAOS ATTORNEY/MANUAL FIELD DISPOSITION — ${ATTORNEY_MANUAL_FIELD_LEDGER_VERSION}`;
const ATTORNEY_MANUAL_FIELD_LABELS = ["Recorded at", "Operator", "Opportunity", "Slot", "Disposition"] as const;

export type ParsedAttorneyManualFieldDisposition = {
  opportunityId: string; at: string; operator: string | null; slot: AttorneyManualFieldSlot; disposition: AttorneyManualFieldDisposition;
};

export function formatAttorneyManualFieldDispositionNote(args: {
  opportunityId: string; at: string; operator: string | null; slot: AttorneyManualFieldSlot; disposition: AttorneyManualFieldDisposition;
}): string {
  return [
    ATTORNEY_MANUAL_FIELD_HEADER,
    `${ATTORNEY_MANUAL_FIELD_LABELS[0]}: ${args.at}`,
    `${ATTORNEY_MANUAL_FIELD_LABELS[1]}: ${ledgerValue(args.operator)}`,
    `${ATTORNEY_MANUAL_FIELD_LABELS[2]}: ${args.opportunityId}`,
    `${ATTORNEY_MANUAL_FIELD_LABELS[3]}: ${args.slot}`,
    `${ATTORNEY_MANUAL_FIELD_LABELS[4]}: ${JSON.stringify(args.disposition)}`,
  ].join("\n");
}

export function parseAttorneyManualFieldDispositionNote(body: string): ParsedAttorneyManualFieldDisposition | null {
  const values = matchPositionalSchema(body, ATTORNEY_MANUAL_FIELD_HEADER, ATTORNEY_MANUAL_FIELD_LABELS);
  if (!values) return null;
  const [at, operatorRaw, opportunityId, slotRaw, dispositionRaw] = values;
  if (opportunityId === "") return null;
  if (!isCanonicalIsoTimestamp(at)) return null;
  if (slotRaw !== "special_provisions" && slotRaw !== "other_addenda_text") return null;
  const parsed = safeJsonParse(dispositionRaw);
  if (!parsed.ok || !isPlainObject(parsed.value)) return null;
  const v = parsed.value;
  let disposition: AttorneyManualFieldDisposition;
  if (v.kind === "not_applicable" || v.kind === "attorney_will_draft") {
    if (!hasExactKeys(v, ["kind"])) return null;
    disposition = { kind: v.kind };
  } else if (v.kind === "provided_verbatim") {
    if (!hasExactKeys(v, ["kind", "text"])) return null;
    if (typeof v.text !== "string" || v.text.trim() === "") return null;
    disposition = { kind: "provided_verbatim", text: v.text };
  } else {
    return null;
  }
  return { opportunityId, at, operator: operatorRaw === "UNAVAILABLE" ? null : operatorRaw, slot: slotRaw, disposition };
}

export function latestAttorneyManualFieldDispositionForOpportunity(
  notes: { body: string }[], opportunityId: string, slot: AttorneyManualFieldSlot,
): ParsedAttorneyManualFieldDisposition | null {
  let latest: ParsedAttorneyManualFieldDisposition | null = null;
  for (const note of notes) {
    const parsed = parseAttorneyManualFieldDispositionNote(note.body);
    if (!parsed || parsed.opportunityId !== opportunityId || parsed.slot !== slot) continue;
    if (!latest || new Date(parsed.at).getTime() > new Date(latest.at).getTime()) latest = parsed;
  }
  return latest;
}

/* ==================================================================== */
/* 14. Seller notice confirmation facts (¶21, seller side) -- Jess Gate  */
/*     correction: an EXPLICIT confirmation, never the property address  */
/* ==================================================================== */

/**
 * The property address and the contact's GHL phone/email are NEVER read
 * as this fact's value. A caller (the UI) may show them as candidate,
 * pre-fill data, but only an explicit confirm-or-correct action creates
 * one of these records -- `source` names which happened, so the
 * provenance is never ambiguous. Phone/email may be explicitly marked
 * none (the TREC ¶21 block permits a blank phone/fax/email line); the
 * mailing address may not, since ¶21 requires a working notice address.
 */
export type SellerNoticeSource = "confirmed_from_contact_record" | "operator_corrected";

export const SELLER_NOTICE_CONFIRMATION_LEDGER_VERSION = "iaos-seller-notice-confirmation-facts-v1" as const;
const SELLER_NOTICE_CONFIRMATION_HEADER = `IAOS SELLER NOTICE CONFIRMATION FACTS — ${SELLER_NOTICE_CONFIRMATION_LEDGER_VERSION}`;
const SELLER_NOTICE_CONFIRMATION_LABELS = [
  "Recorded at", "Operator", "Opportunity", "Notice address", "Notice phone", "Notice email", "Source",
] as const;

export type ParsedSellerNoticeConfirmationFacts = {
  opportunityId: string; at: string; operator: string | null;
  noticeAddress: string; noticePhone: ValueOrNone; noticeEmail: ValueOrNone; source: SellerNoticeSource;
};

export function formatSellerNoticeConfirmationFactsNote(args: {
  opportunityId: string; at: string; operator: string | null;
  noticeAddress: string; noticePhone: ValueOrNone; noticeEmail: ValueOrNone; source: SellerNoticeSource;
}): string {
  return [
    SELLER_NOTICE_CONFIRMATION_HEADER,
    `${SELLER_NOTICE_CONFIRMATION_LABELS[0]}: ${args.at}`,
    `${SELLER_NOTICE_CONFIRMATION_LABELS[1]}: ${ledgerValue(args.operator)}`,
    `${SELLER_NOTICE_CONFIRMATION_LABELS[2]}: ${args.opportunityId}`,
    `${SELLER_NOTICE_CONFIRMATION_LABELS[3]}: ${args.noticeAddress}`,
    `${SELLER_NOTICE_CONFIRMATION_LABELS[4]}: ${formatValueOrNoneJson(args.noticePhone)}`,
    `${SELLER_NOTICE_CONFIRMATION_LABELS[5]}: ${formatValueOrNoneJson(args.noticeEmail)}`,
    `${SELLER_NOTICE_CONFIRMATION_LABELS[6]}: ${args.source}`,
  ].join("\n");
}

export function parseSellerNoticeConfirmationFactsNote(body: string): ParsedSellerNoticeConfirmationFacts | null {
  const values = matchPositionalSchema(body, SELLER_NOTICE_CONFIRMATION_HEADER, SELLER_NOTICE_CONFIRMATION_LABELS);
  if (!values) return null;
  const [at, operatorRaw, opportunityId, noticeAddress, noticePhoneRaw, noticeEmailRaw, sourceRaw] = values;
  if (opportunityId === "" || noticeAddress === "") return null;
  if (!isCanonicalIsoTimestamp(at)) return null;
  const noticePhone = parseValueOrNoneJson(noticePhoneRaw);
  if (!noticePhone) return null;
  const noticeEmail = parseValueOrNoneJson(noticeEmailRaw);
  if (!noticeEmail) return null;
  if (sourceRaw !== "confirmed_from_contact_record" && sourceRaw !== "operator_corrected") return null;
  return { opportunityId, at, operator: operatorRaw === "UNAVAILABLE" ? null : operatorRaw, noticeAddress, noticePhone, noticeEmail, source: sourceRaw };
}

export function latestSellerNoticeConfirmationFactsForOpportunity(
  notes: { body: string }[], opportunityId: string,
): ParsedSellerNoticeConfirmationFacts | null {
  let latest: ParsedSellerNoticeConfirmationFacts | null = null;
  for (const note of notes) {
    const parsed = parseSellerNoticeConfirmationFactsNote(note.body);
    if (!parsed || parsed.opportunityId !== opportunityId) continue;
    if (!latest || new Date(parsed.at).getTime() > new Date(latest.at).getTime()) latest = parsed;
  }
  return latest;
}

/* ==================================================================== */
/* 15. Buyer business config facts (BTC LLC's own notice + signer info) */
/* ==================================================================== */

/**
 * BTC LLC's confirmed notice address/phone/email and authorized-signer
 * name/role, given a real durable capture path -- no longer a `null` a
 * caller must someday replace. Scoped per-Opportunity, the SAME scope
 * every other carrier in this file uses -- a deliberate, disclosed V1
 * simplification: BTC LLC's info does not actually change per deal, but
 * reusing the established "latest wins, scoped to one Opportunity" idiom
 * avoids inventing a new, un-reviewed cross-deal storage/scope rule.
 * Brad re-confirms it per opportunity in V1; a cross-deal default is
 * future work, not invented here.
 */
export const BUYER_BUSINESS_CONFIG_LEDGER_VERSION = "iaos-buyer-business-config-facts-v1" as const;
const BUYER_BUSINESS_CONFIG_HEADER = `IAOS BUYER BUSINESS CONFIG FACTS — ${BUYER_BUSINESS_CONFIG_LEDGER_VERSION}`;
const BUYER_BUSINESS_CONFIG_LABELS = [
  "Recorded at", "Operator", "Opportunity", "Notice address", "Notice phone", "Notice email", "Signer name", "Signer role",
] as const;

export type ParsedBuyerBusinessConfigFacts = {
  opportunityId: string; at: string; operator: string | null;
  noticeAddress: string; noticePhone: string; noticeEmail: string; signerName: string; signerRole: string;
};

export function formatBuyerBusinessConfigFactsNote(args: {
  opportunityId: string; at: string; operator: string | null;
  noticeAddress: string; noticePhone: string; noticeEmail: string; signerName: string; signerRole: string;
}): string {
  return [
    BUYER_BUSINESS_CONFIG_HEADER,
    `${BUYER_BUSINESS_CONFIG_LABELS[0]}: ${args.at}`,
    `${BUYER_BUSINESS_CONFIG_LABELS[1]}: ${ledgerValue(args.operator)}`,
    `${BUYER_BUSINESS_CONFIG_LABELS[2]}: ${args.opportunityId}`,
    `${BUYER_BUSINESS_CONFIG_LABELS[3]}: ${args.noticeAddress}`,
    `${BUYER_BUSINESS_CONFIG_LABELS[4]}: ${args.noticePhone}`,
    `${BUYER_BUSINESS_CONFIG_LABELS[5]}: ${args.noticeEmail}`,
    `${BUYER_BUSINESS_CONFIG_LABELS[6]}: ${args.signerName}`,
    `${BUYER_BUSINESS_CONFIG_LABELS[7]}: ${args.signerRole}`,
  ].join("\n");
}

export function parseBuyerBusinessConfigFactsNote(body: string): ParsedBuyerBusinessConfigFacts | null {
  const values = matchPositionalSchema(body, BUYER_BUSINESS_CONFIG_HEADER, BUYER_BUSINESS_CONFIG_LABELS);
  if (!values) return null;
  const [at, operatorRaw, opportunityId, noticeAddress, noticePhone, noticeEmail, signerName, signerRole] = values;
  if (opportunityId === "" || noticeAddress === "" || noticePhone === "" || noticeEmail === "" || signerName === "" || signerRole === "") return null;
  if (!isCanonicalIsoTimestamp(at)) return null;
  return { opportunityId, at, operator: operatorRaw === "UNAVAILABLE" ? null : operatorRaw, noticeAddress, noticePhone, noticeEmail, signerName, signerRole };
}

export function latestBuyerBusinessConfigFactsForOpportunity(
  notes: { body: string }[], opportunityId: string,
): ParsedBuyerBusinessConfigFacts | null {
  let latest: ParsedBuyerBusinessConfigFacts | null = null;
  for (const note of notes) {
    const parsed = parseBuyerBusinessConfigFactsNote(note.body);
    if (!parsed || parsed.opportunityId !== opportunityId) continue;
    if (!latest || new Date(parsed.at).getTime() > new Date(latest.at).getTime()) latest = parsed;
  }
  return latest;
}
