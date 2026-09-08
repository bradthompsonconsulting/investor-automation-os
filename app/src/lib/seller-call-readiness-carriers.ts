/**
 * Offer Readiness durable carriers -- B8-13 / INV-68, corrected per Jess
 * Gate 2026-09-08 (two rounds).
 *
 * Pure. No I/O, no React, no GHL identifiers. Seven format/parse pairs:
 * Property identity, Transaction assumptions, Seller price position, the
 * Offer Ready human approval/override decision, its durable invalidation
 * record, a display-only legacy v1 decision reader, and the Contract Ready
 * handoff checklist. Colocated in one module because the locked addendum
 * (`docs/DEAL_ECONOMICS_OFFER_READINESS_V1.md`, "Addendum -- B8-13 /
 * INV-68") authorizes the core four together as one ruling and the two
 * Jess Gate corrections below extend that same ruling; each carrier is
 * written out fully and independently below; none shares implementation
 * with another, only the file.
 *
 * SAME PROVEN PATTERN AS `arv-approval-note.ts` / `seller-call-outcome.ts` /
 * `seller-call-negotiation-override-note.ts`, REUSED, NOT REINVENTED.
 * Versioned header, one fact per line, POSITIONAL parsing (never
 * `.find()`), a canonical ISO timestamp that must round-trip through
 * `toISOString()`, and a "latest entry wins, scoped to ONE Opportunity"
 * reader (by the note's OWN embedded timestamp, never by list order or
 * GHL's `dateAdded`). Every entry is a NEW append-only note; nothing here
 * ever overwrites or deletes a prior one -- a "withdrawn", "stale", or
 * "invalidated" state is always a NEW note, never an edit.
 *
 * WRITTEN THROUGH THE EXISTING SANCTIONED WRITE ONLY. Every function below
 * builds and parses note strings; none performs a write. The caller
 * (`SellerCallWorkspace.tsx`) is responsible for `ghl.notes.create()` --
 * one of AGENTS.md's "three sanctioned writes, and no fourth." No new
 * write class, no new carrier beyond GHL Contact Notes.
 *
 * NO OPERATOR IDENTITY IS EVER FABRICATED. `operator` is carried through
 * verbatim (`null` when no authenticated-operator identity is available --
 * this app has none) -- these functions neither require nor supply one.
 *
 * PERMANENT INVALIDATION, SECOND JESS GATE CORRECTION (2026-09-08).
 * `isReadinessDecisionCurrent` now does DIRECT fact comparison across all
 * six categories (not just two) -- the current live snapshot is compared
 * field-by-field against the decision's own snapshot, so an external
 * change (e.g. the contact's raw address edited directly in GHL, with no
 * new confirmation note written) is caught without requiring any ledger
 * note at all. Existence-based note checks remain as a SUPPLEMENT (they
 * catch a later note carrying an unchanged value -- a re-save -- that
 * direct comparison alone would miss), never a replacement.
 *
 * A live comparison alone cannot guarantee PERMANENCE: if a value moves
 * away and back between two reads with no observation in between, nothing
 * remembers it moved. `isReadinessDecisionInvalidated` /
 * `formatReadinessDecisionInvalidationNote` close this: the FIRST time
 * `SellerCallWorkspace.tsx` observes a live mismatch for a decision that
 * has not yet been durably invalidated, it writes an invalidation note
 * naming that decision's own timestamp. That note is never deleted, so
 * once written the decision is stale forever -- reverting the underlying
 * value cannot undo it, including across a reload, because the check
 * consults this note first, before any value comparison. The ONE
 * remaining, accepted limitation: a change-and-revert that occurs
 * ENTIRELY between two reads, with no page load in the mismatched window,
 * is unobservable -- there is nothing to write a durable record from. This
 * applies uniformly to all six categories now, not only the two
 * (repairs/deal economics) that lacked their own note history in the
 * first correction.
 *
 * RUNTIME SHAPE VALIDATION, NOT MERE JSON VALIDITY. Every snapshot field
 * is checked against its exact expected shape (key set, types, enumerated
 * values) after `JSON.parse` succeeds -- valid-but-wrong-shaped JSON fails
 * exactly like a syntax error. See `INVALID` and the `validate*` functions
 * below.
 *
 * NEVER MERGED WITH `seller-call-negotiation-override-note.ts`.
 * `NegotiationOverride` (the above-Max price decision) remains completely
 * separate and untouched by this file or either correction.
 */

/* ------------------------------------------------------------------ */
/* Shared helpers                                                       */
/* ------------------------------------------------------------------ */

function ledgerValue(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "UNAVAILABLE" : String(value);
}

/** Canonical ISO timestamp check shared by every parser -- must round-trip through `toISOString()` exactly, the same form every `at` producer here always emits. */
function isCanonicalIsoTimestamp(at: string): boolean {
  const ms = new Date(at).getTime();
  if (!Number.isFinite(ms)) return false;
  return new Date(ms).toISOString() === at;
}

/** Positional line-by-line match against a declared label schema. Returns the values in order, or `null` on ANY deviation -- wrong count, wrong order, a duplicate, or a missing label at its position. */
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

/* ==================================================================== */
/* 1. Property identity confirmation                                    */
/* ==================================================================== */

export const PROPERTY_IDENTITY_LEDGER_VERSION = "iaos-property-identity-confirmation-v2" as const;
const PROPERTY_IDENTITY_HEADER = `IAOS PROPERTY IDENTITY CONFIRMATION — ${PROPERTY_IDENTITY_LEDGER_VERSION}`;
const PROPERTY_IDENTITY_LABELS = ["Recorded at", "Operator", "Opportunity", "Status", "Address"] as const;

/**
 * v2 (first Jess Gate correction, 2026-09-08): adds `Status`, `confirmed`
 * or `withdrawn` -- the smallest schema change that lets an operator undo
 * an incorrect confirmation WITHOUT the address itself having to change.
 * v1 notes (4 fields, no Status) fail the v2 positional schema outright
 * and parse as `null` -- fail-closed, not migrated.
 */
export type ParsedPropertyIdentityConfirmation = {
  opportunityId: string;
  at: string;
  operator: string | null;
  status: "confirmed" | "withdrawn";
  address: string;
};

export function formatPropertyIdentityConfirmationNote(args: {
  opportunityId: string;
  at: string;
  operator: string | null;
  status: "confirmed" | "withdrawn";
  address: string;
}): string {
  return [
    PROPERTY_IDENTITY_HEADER,
    `${PROPERTY_IDENTITY_LABELS[0]}: ${args.at}`,
    `${PROPERTY_IDENTITY_LABELS[1]}: ${ledgerValue(args.operator)}`,
    `${PROPERTY_IDENTITY_LABELS[2]}: ${args.opportunityId}`,
    `${PROPERTY_IDENTITY_LABELS[3]}: ${args.status}`,
    `${PROPERTY_IDENTITY_LABELS[4]}: ${args.address}`,
  ].join("\n");
}

export function parsePropertyIdentityConfirmationNote(body: string): ParsedPropertyIdentityConfirmation | null {
  const values = matchPositionalSchema(body, PROPERTY_IDENTITY_HEADER, PROPERTY_IDENTITY_LABELS);
  if (!values) return null;
  const [at, operatorRaw, opportunityId, statusRaw, address] = values;
  if (opportunityId === "") return null;
  if (address === "") return null;
  if (!isCanonicalIsoTimestamp(at)) return null;
  if (statusRaw !== "confirmed" && statusRaw !== "withdrawn") return null;
  const operator = operatorRaw === "UNAVAILABLE" ? null : operatorRaw;
  return { opportunityId, at, operator, status: statusRaw, address };
}

/**
 * The latest property-identity note of ANY status, for one Opportunity --
 * used both to resolve the current confirmation AND, in
 * `SellerCallWorkspace.tsx`'s live snapshot, as the direct-comparison
 * source of truth for "is a readiness decision's property snapshot still
 * current."
 */
export function latestPropertyIdentityNoteForOpportunity(
  notes: { body: string }[],
  opportunityId: string,
): ParsedPropertyIdentityConfirmation | null {
  let latest: ParsedPropertyIdentityConfirmation | null = null;
  for (const note of notes) {
    const parsed = parsePropertyIdentityConfirmationNote(note.body);
    if (!parsed || parsed.opportunityId !== opportunityId) continue;
    if (!latest || new Date(parsed.at).getTime() > new Date(latest.at).getTime()) latest = parsed;
  }
  return latest;
}

/**
 * The CURRENT standing confirmation for one Opportunity: the latest note
 * must be `Status: confirmed` (a `withdrawn` note -- the LATEST WITHDRAWAL
 * -- permanently blocks every OLDER confirmation from applying again) AND
 * its `address` must match `currentAddress` exactly -- a stale
 * confirmation (the address changed since, EVEN WITHOUT any new note)
 * is treated as absent. Mirrors `matchingArvApprovalForOpportunity`'s
 * "a stale entry must never lend evidence to a fact it was not actually
 * approved for" rule.
 */
export function currentPropertyIdentityConfirmationForOpportunity(
  notes: { body: string }[],
  opportunityId: string,
  currentAddress: string,
): ParsedPropertyIdentityConfirmation | null {
  const latest = latestPropertyIdentityNoteForOpportunity(notes, opportunityId);
  if (!latest) return null;
  if (latest.status !== "confirmed") return null;
  return latest.address === currentAddress ? latest : null;
}

/* ==================================================================== */
/* 2. Transaction / deal-structure assumptions                          */
/* ==================================================================== */

export const TRANSACTION_ASSUMPTIONS_LEDGER_VERSION = "iaos-transaction-assumptions-v1" as const;
const TRANSACTION_ASSUMPTIONS_HEADER = `IAOS TRANSACTION ASSUMPTIONS — ${TRANSACTION_ASSUMPTIONS_LEDGER_VERSION}`;
const TRANSACTION_ASSUMPTIONS_LABELS = [
  "Recorded at", "Operator", "Opportunity",
  "Transaction structure", "Closing/possession expectations", "Title complications",
] as const;

/** One sub-fact: either a real recorded value, or explicitly marked none -- never simply blank. */
export type TransactionAssumptionField = { kind: "value"; value: string } | { kind: "none" };

export type ParsedTransactionAssumptions = {
  opportunityId: string;
  at: string;
  operator: string | null;
  transactionStructure: TransactionAssumptionField;
  closingPossession: TransactionAssumptionField;
  titleComplications: TransactionAssumptionField;
};

const NONE_MARKER = "(none — explicitly marked)";

function formatField(f: TransactionAssumptionField): string {
  return f.kind === "none" ? NONE_MARKER : f.value;
}

function parseField(raw: string): TransactionAssumptionField | null {
  if (raw === NONE_MARKER) return { kind: "none" };
  if (raw.trim() === "") return null; // blank is never valid -- must be a real value or the explicit none marker
  return { kind: "value", value: raw };
}

export function formatTransactionAssumptionsNote(args: {
  opportunityId: string;
  at: string;
  operator: string | null;
  transactionStructure: TransactionAssumptionField;
  closingPossession: TransactionAssumptionField;
  titleComplications: TransactionAssumptionField;
}): string {
  return [
    TRANSACTION_ASSUMPTIONS_HEADER,
    `${TRANSACTION_ASSUMPTIONS_LABELS[0]}: ${args.at}`,
    `${TRANSACTION_ASSUMPTIONS_LABELS[1]}: ${ledgerValue(args.operator)}`,
    `${TRANSACTION_ASSUMPTIONS_LABELS[2]}: ${args.opportunityId}`,
    `${TRANSACTION_ASSUMPTIONS_LABELS[3]}: ${formatField(args.transactionStructure)}`,
    `${TRANSACTION_ASSUMPTIONS_LABELS[4]}: ${formatField(args.closingPossession)}`,
    `${TRANSACTION_ASSUMPTIONS_LABELS[5]}: ${formatField(args.titleComplications)}`,
  ].join("\n");
}

export function parseTransactionAssumptionsNote(body: string): ParsedTransactionAssumptions | null {
  const values = matchPositionalSchema(body, TRANSACTION_ASSUMPTIONS_HEADER, TRANSACTION_ASSUMPTIONS_LABELS);
  if (!values) return null;
  const [at, operatorRaw, opportunityId, structureRaw, closingRaw, titleRaw] = values;
  if (opportunityId === "") return null;
  if (!isCanonicalIsoTimestamp(at)) return null;
  const transactionStructure = parseField(structureRaw);
  const closingPossession = parseField(closingRaw);
  const titleComplications = parseField(titleRaw);
  if (!transactionStructure || !closingPossession || !titleComplications) return null;
  const operator = operatorRaw === "UNAVAILABLE" ? null : operatorRaw;
  return { opportunityId, at, operator, transactionStructure, closingPossession, titleComplications };
}

export function latestTransactionAssumptionsForOpportunity(
  notes: { body: string }[],
  opportunityId: string,
): ParsedTransactionAssumptions | null {
  let latest: ParsedTransactionAssumptions | null = null;
  for (const note of notes) {
    const parsed = parseTransactionAssumptionsNote(note.body);
    if (!parsed || parsed.opportunityId !== opportunityId) continue;
    if (!latest || new Date(parsed.at).getTime() > new Date(latest.at).getTime()) latest = parsed;
  }
  return latest;
}

/* ==================================================================== */
/* 3. Seller price position                                             */
/* ==================================================================== */

export const SELLER_PRICE_POSITION_LEDGER_VERSION = "iaos-seller-price-position-v1" as const;
const SELLER_PRICE_POSITION_HEADER = `IAOS SELLER PRICE POSITION — ${SELLER_PRICE_POSITION_LEDGER_VERSION}`;
const SELLER_PRICE_POSITION_LABELS = ["Recorded at", "Operator", "Opportunity", "Kind", "Price"] as const;

export type ParsedSellerPricePosition =
  | { opportunityId: string; at: string; operator: string | null; kind: "price"; price: number }
  | { opportunityId: string; at: string; operator: string | null; kind: "refused" };

export function formatSellerPricePositionNote(
  args:
    | { opportunityId: string; at: string; operator: string | null; kind: "price"; price: number }
    | { opportunityId: string; at: string; operator: string | null; kind: "refused" },
): string {
  return [
    SELLER_PRICE_POSITION_HEADER,
    `${SELLER_PRICE_POSITION_LABELS[0]}: ${args.at}`,
    `${SELLER_PRICE_POSITION_LABELS[1]}: ${ledgerValue(args.operator)}`,
    `${SELLER_PRICE_POSITION_LABELS[2]}: ${args.opportunityId}`,
    `${SELLER_PRICE_POSITION_LABELS[3]}: ${args.kind}`,
    `${SELLER_PRICE_POSITION_LABELS[4]}: ${args.kind === "price" ? args.price : "UNAVAILABLE"}`,
  ].join("\n");
}

export function parseSellerPricePositionNote(body: string): ParsedSellerPricePosition | null {
  const values = matchPositionalSchema(body, SELLER_PRICE_POSITION_HEADER, SELLER_PRICE_POSITION_LABELS);
  if (!values) return null;
  const [at, operatorRaw, opportunityId, kindRaw, priceRaw] = values;
  if (opportunityId === "") return null;
  if (!isCanonicalIsoTimestamp(at)) return null;
  const operator = operatorRaw === "UNAVAILABLE" ? null : operatorRaw;
  if (kindRaw === "refused") {
    if (priceRaw !== "UNAVAILABLE") return null; // a refusal must carry no stray number
    return { opportunityId, at, operator, kind: "refused" };
  }
  if (kindRaw === "price") {
    const price = Number(priceRaw);
    if (!Number.isFinite(price) || price <= 0) return null;
    return { opportunityId, at, operator, kind: "price", price };
  }
  return null;
}

export function latestSellerPricePositionForOpportunity(
  notes: { body: string }[],
  opportunityId: string,
): ParsedSellerPricePosition | null {
  let latest: ParsedSellerPricePosition | null = null;
  for (const note of notes) {
    const parsed = parseSellerPricePositionNote(note.body);
    if (!parsed || parsed.opportunityId !== opportunityId) continue;
    if (!latest || new Date(parsed.at).getTime() > new Date(latest.at).getTime()) latest = parsed;
  }
  return latest;
}

/* ==================================================================== */
/* 4. Offer Ready human approval/override decision                      */
/* ==================================================================== */

/** A private sentinel distinguishing "JSON parsed but the shape is wrong" from a legitimate `null` value (several snapshot fields are validly `null`). Never exported -- callers see only the validator's return type. */
const INVALID = Symbol("invalid-snapshot-shape");
type Invalid = typeof INVALID;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function hasExactKeys(v: Record<string, unknown>, keys: readonly string[]): boolean {
  const vKeys = Object.keys(v);
  if (vKeys.length !== keys.length) return false;
  return keys.every((k) => vKeys.includes(k));
}

/** One resolved policy assumption, as carried in a snapshot: its value and which level supplied it, or `null` when unresolved. */
export type ResolvedInputSnapshot = { value: number; level: string } | null;

function validateResolvedInputSnapshot(v: unknown): ResolvedInputSnapshot | Invalid {
  if (v === null) return null;
  if (!isPlainObject(v)) return INVALID;
  if (!hasExactKeys(v, ["value", "level"])) return INVALID;
  if (typeof v.value !== "number" || !Number.isFinite(v.value)) return INVALID;
  if (typeof v.level !== "string") return INVALID;
  return { value: v.value, level: v.level };
}

/**
 * The raw resolved deal-economics INPUTS (Jess Gate, second correction,
 * 2026-09-08: "Include the material economics inputs AND outputs. The
 * current snapshot contains calculated outputs only.") -- every PB-D56
 * section IV assumption `resolveInputs` produces, mirrored verbatim in
 * shape from `UnderwritingInputs` (`underwriting/types.ts`), never
 * reimplemented or recomputed here.
 */
export type DealEconomicsInputsSnapshot = {
  sellingCostPct: ResolvedInputSnapshot;
  closingCost: ResolvedInputSnapshot;
  monthlyCarry: ResolvedInputSnapshot;
  holdMonths: ResolvedInputSnapshot;
  buyerProfitPct: ResolvedInputSnapshot;
  standardMinimum: ResolvedInputSnapshot;
  profitSharePct: ResolvedInputSnapshot;
  assignmentMode: string;
  assignmentAmount: number | null;
  financingKind: string;
  financingLtv: ResolvedInputSnapshot;
  financingRate: ResolvedInputSnapshot;
  financingPoints: ResolvedInputSnapshot;
};

const DEAL_ECONOMICS_INPUTS_KEYS = [
  "sellingCostPct", "closingCost", "monthlyCarry", "holdMonths", "buyerProfitPct",
  "standardMinimum", "profitSharePct", "assignmentMode", "assignmentAmount",
  "financingKind", "financingLtv", "financingRate", "financingPoints",
] as const;

/**
 * BUG FOUND LIVE IN TEST, third Jess Gate correction round (2026-09-08):
 * this function used to build its returned object's keys in a DIFFERENT
 * insertion order than `SellerCallWorkspace.tsx`'s `buildDealEconomicsInputsSnapshot`
 * object literal (the WRITE side) -- both emit the identical field set with
 * identical values, but `JSON.stringify` is insertion-order-sensitive, and
 * `isReadinessDecisionCurrent` compares snapshots via `JSON.stringify`
 * equality. The mismatch made EVERY Offer Readiness decision's dealEconomics
 * field compare unequal to itself on the very next read -- decisions never
 * stayed current, not even for one render, regardless of whether anything
 * actually changed. Fixed by constructing the returned object literal with
 * keys in the EXACT SAME order as the write side's literal (also
 * `DealEconomicsInputsSnapshot`'s own declared field order): the seven
 * resolved fields, then assignmentMode/assignmentAmount/financingKind, then
 * the three financing-resolved fields last.
 */
function validateDealEconomicsInputsSnapshot(v: unknown): DealEconomicsInputsSnapshot | Invalid {
  if (!isPlainObject(v)) return INVALID;
  if (!hasExactKeys(v, DEAL_ECONOMICS_INPUTS_KEYS)) return INVALID;
  const sellingCostPct = validateResolvedInputSnapshot(v.sellingCostPct);
  const closingCost = validateResolvedInputSnapshot(v.closingCost);
  const monthlyCarry = validateResolvedInputSnapshot(v.monthlyCarry);
  const holdMonths = validateResolvedInputSnapshot(v.holdMonths);
  const buyerProfitPct = validateResolvedInputSnapshot(v.buyerProfitPct);
  const standardMinimum = validateResolvedInputSnapshot(v.standardMinimum);
  const profitSharePct = validateResolvedInputSnapshot(v.profitSharePct);
  const financingLtv = validateResolvedInputSnapshot(v.financingLtv);
  const financingRate = validateResolvedInputSnapshot(v.financingRate);
  const financingPoints = validateResolvedInputSnapshot(v.financingPoints);
  if (
    sellingCostPct === INVALID || closingCost === INVALID || monthlyCarry === INVALID || holdMonths === INVALID ||
    buyerProfitPct === INVALID || standardMinimum === INVALID || profitSharePct === INVALID ||
    financingLtv === INVALID || financingRate === INVALID || financingPoints === INVALID
  ) return INVALID;
  if (typeof v.assignmentMode !== "string") return INVALID;
  if (v.assignmentAmount !== null && (typeof v.assignmentAmount !== "number" || !Number.isFinite(v.assignmentAmount))) return INVALID;
  if (typeof v.financingKind !== "string") return INVALID;
  return {
    sellingCostPct, closingCost, monthlyCarry, holdMonths, buyerProfitPct,
    standardMinimum, profitSharePct,
    assignmentMode: v.assignmentMode, assignmentAmount: v.assignmentAmount, financingKind: v.financingKind,
    financingLtv, financingRate, financingPoints,
  };
}

/**
 * What the operator was actually looking at when this decision was made --
 * raw facts and evidence states across all six B8-04 categories, never
 * category levels (Jess Gate: "UNKNOWN can remain UNKNOWN while the
 * address changes" -- comparing levels alone would miss exactly that
 * case), and for deal economics, inputs as well as outputs.
 */
export type ReadinessEvidenceSnapshot = {
  propertyIdentity: { confirmed: boolean; address: string | null };
  repairsCondition: { amount: number | null; approved: boolean };
  arv: { amount: number | null; evidenceState: "HIGH" | "MODERATE" | "LOW" | "INSUFFICIENT" | null };
  dealEconomics: {
    status: "calculated" | "unavailable";
    maxSupportedOffer: number | null;
    targetStatus: "calculated" | "unavailable" | null;
    targetValue: number | null;
    inputs: DealEconomicsInputsSnapshot;
  };
  transactionAssumptions: {
    structure: TransactionAssumptionField;
    closing: TransactionAssumptionField;
    title: TransactionAssumptionField;
  } | null;
  sellerPricePosition: { kind: "price"; price: number } | { kind: "refused" } | null;
};

function validatePropertyIdentitySnapshot(v: unknown): ReadinessEvidenceSnapshot["propertyIdentity"] | Invalid {
  if (!isPlainObject(v)) return INVALID;
  if (!hasExactKeys(v, ["confirmed", "address"])) return INVALID;
  if (typeof v.confirmed !== "boolean") return INVALID;
  if (v.address !== null && typeof v.address !== "string") return INVALID;
  return { confirmed: v.confirmed, address: v.address as string | null };
}

function validateRepairsConditionSnapshot(v: unknown): ReadinessEvidenceSnapshot["repairsCondition"] | Invalid {
  if (!isPlainObject(v)) return INVALID;
  if (!hasExactKeys(v, ["amount", "approved"])) return INVALID;
  if (v.amount !== null && (typeof v.amount !== "number" || !Number.isFinite(v.amount))) return INVALID;
  if (typeof v.approved !== "boolean") return INVALID;
  return { amount: v.amount as number | null, approved: v.approved };
}

const ARV_EVIDENCE_STATES = ["HIGH", "MODERATE", "LOW", "INSUFFICIENT"] as const;

function validateArvSnapshot(v: unknown): ReadinessEvidenceSnapshot["arv"] | Invalid {
  if (!isPlainObject(v)) return INVALID;
  if (!hasExactKeys(v, ["amount", "evidenceState"])) return INVALID;
  if (v.amount !== null && (typeof v.amount !== "number" || !Number.isFinite(v.amount))) return INVALID;
  if (v.evidenceState !== null && !(ARV_EVIDENCE_STATES as readonly unknown[]).includes(v.evidenceState)) return INVALID;
  return { amount: v.amount as number | null, evidenceState: v.evidenceState as ReadinessEvidenceSnapshot["arv"]["evidenceState"] };
}

function validateDealEconomicsSnapshot(v: unknown): ReadinessEvidenceSnapshot["dealEconomics"] | Invalid {
  if (!isPlainObject(v)) return INVALID;
  if (!hasExactKeys(v, ["status", "maxSupportedOffer", "targetStatus", "targetValue", "inputs"])) return INVALID;
  if (v.status !== "calculated" && v.status !== "unavailable") return INVALID;
  if (v.maxSupportedOffer !== null && (typeof v.maxSupportedOffer !== "number" || !Number.isFinite(v.maxSupportedOffer))) return INVALID;
  if (v.targetStatus !== null && v.targetStatus !== "calculated" && v.targetStatus !== "unavailable") return INVALID;
  if (v.targetValue !== null && (typeof v.targetValue !== "number" || !Number.isFinite(v.targetValue))) return INVALID;
  const inputs = validateDealEconomicsInputsSnapshot(v.inputs);
  if (inputs === INVALID) return INVALID;
  return {
    status: v.status, maxSupportedOffer: v.maxSupportedOffer as number | null,
    targetStatus: v.targetStatus as "calculated" | "unavailable" | null, targetValue: v.targetValue as number | null,
    inputs,
  };
}

function validateTransactionAssumptionField(v: unknown): TransactionAssumptionField | Invalid {
  if (!isPlainObject(v)) return INVALID;
  if (v.kind === "none") return hasExactKeys(v, ["kind"]) ? { kind: "none" } : INVALID;
  if (v.kind === "value") {
    if (!hasExactKeys(v, ["kind", "value"])) return INVALID;
    if (typeof v.value !== "string") return INVALID;
    return { kind: "value", value: v.value };
  }
  return INVALID;
}

/** `null` is a legitimate value here (unrecorded at decision time) -- distinguished from `INVALID` by the caller checking `raw === "null"` first, same convention the pre-existing parser already used. */
function validateTransactionAssumptionsSnapshot(v: unknown): ReadinessEvidenceSnapshot["transactionAssumptions"] | Invalid {
  if (!isPlainObject(v)) return INVALID;
  if (!hasExactKeys(v, ["structure", "closing", "title"])) return INVALID;
  const structure = validateTransactionAssumptionField(v.structure);
  const closing = validateTransactionAssumptionField(v.closing);
  const title = validateTransactionAssumptionField(v.title);
  if (structure === INVALID || closing === INVALID || title === INVALID) return INVALID;
  return { structure, closing, title };
}

function validateSellerPricePositionSnapshot(v: unknown): ReadinessEvidenceSnapshot["sellerPricePosition"] | Invalid {
  if (!isPlainObject(v)) return INVALID;
  if (v.kind === "refused") return hasExactKeys(v, ["kind"]) ? { kind: "refused" } : INVALID;
  if (v.kind === "price") {
    if (!hasExactKeys(v, ["kind", "price"])) return INVALID;
    if (typeof v.price !== "number" || !Number.isFinite(v.price) || v.price <= 0) return INVALID;
    return { kind: "price", price: v.price };
  }
  return INVALID;
}

export type ParsedReadinessHumanAction = {
  opportunityId: string;
  at: string;
  operator: string | null;
  snapshot: ReadinessEvidenceSnapshot;
} & (
  | { kind: "approved"; reason: string | null }
  | { kind: "overridden"; reason: string }
);

const READINESS_HUMAN_ACTION_LEDGER_VERSION_CURRENT = "iaos-offer-readiness-human-action-v3" as const;
export const READINESS_HUMAN_ACTION_LEDGER_VERSION = READINESS_HUMAN_ACTION_LEDGER_VERSION_CURRENT;
const READINESS_HUMAN_ACTION_HEADER = `IAOS OFFER READINESS HUMAN ACTION — ${READINESS_HUMAN_ACTION_LEDGER_VERSION_CURRENT}`;
const READINESS_HUMAN_ACTION_LABELS = [
  "Recorded at", "Operator", "Opportunity", "Kind", "Reason",
  "Property snapshot", "Repairs snapshot", "ARV snapshot",
  "Deal economics snapshot", "Transaction assumptions snapshot", "Seller price position snapshot",
] as const;

function formatSnapshotField(value: unknown): string {
  return JSON.stringify(value);
}

export function formatReadinessHumanActionNote(
  args: {
    opportunityId: string;
    at: string;
    operator: string | null;
    snapshot: ReadinessEvidenceSnapshot;
  } & (
    | { kind: "approved"; reason: string | null }
    | { kind: "overridden"; reason: string }
  ),
): string {
  return [
    READINESS_HUMAN_ACTION_HEADER,
    `${READINESS_HUMAN_ACTION_LABELS[0]}: ${args.at}`,
    `${READINESS_HUMAN_ACTION_LABELS[1]}: ${ledgerValue(args.operator)}`,
    `${READINESS_HUMAN_ACTION_LABELS[2]}: ${args.opportunityId}`,
    `${READINESS_HUMAN_ACTION_LABELS[3]}: ${args.kind}`,
    `${READINESS_HUMAN_ACTION_LABELS[4]}: ${ledgerValue(args.reason)}`,
    `${READINESS_HUMAN_ACTION_LABELS[5]}: ${formatSnapshotField(args.snapshot.propertyIdentity)}`,
    `${READINESS_HUMAN_ACTION_LABELS[6]}: ${formatSnapshotField(args.snapshot.repairsCondition)}`,
    `${READINESS_HUMAN_ACTION_LABELS[7]}: ${formatSnapshotField(args.snapshot.arv)}`,
    `${READINESS_HUMAN_ACTION_LABELS[8]}: ${formatSnapshotField(args.snapshot.dealEconomics)}`,
    `${READINESS_HUMAN_ACTION_LABELS[9]}: ${formatSnapshotField(args.snapshot.transactionAssumptions)}`,
    `${READINESS_HUMAN_ACTION_LABELS[10]}: ${formatSnapshotField(args.snapshot.sellerPricePosition)}`,
  ].join("\n");
}

/**
 * v3 (second Jess Gate correction, 2026-09-08): `dealEconomics.inputs`
 * added, and every snapshot field is now validated against its EXACT
 * runtime shape (key set, types, enumerated values), not merely
 * `JSON.parse`-able -- "valid JSON alone is not sufficient." v1 (5 fields,
 * no snapshot) and v2 (11 fields, unvalidated shape, no `inputs`) both
 * fail the v3 positional schema or shape checks outright -- fail-closed,
 * never migrated. See `parseLegacyReadinessHumanActionV1Note` below for
 * the SEPARATE, display-only v1 reader.
 */
export function parseReadinessHumanActionNote(body: string): ParsedReadinessHumanAction | null {
  const values = matchPositionalSchema(body, READINESS_HUMAN_ACTION_HEADER, READINESS_HUMAN_ACTION_LABELS);
  if (!values) return null;
  const [
    at, operatorRaw, opportunityId, kindRaw, reasonRaw,
    propertyRaw, repairsRaw, arvRaw, dealEconomicsRaw, transactionRaw, sellerPriceRaw,
  ] = values;
  if (opportunityId === "") return null;
  if (!isCanonicalIsoTimestamp(at)) return null;
  const operator = operatorRaw === "UNAVAILABLE" ? null : operatorRaw;

  let propertyJson: unknown, repairsJson: unknown, arvJson: unknown, dealEconomicsJson: unknown, transactionJson: unknown, sellerPriceJson: unknown;
  try {
    propertyJson = JSON.parse(propertyRaw);
    repairsJson = JSON.parse(repairsRaw);
    arvJson = JSON.parse(arvRaw);
    dealEconomicsJson = JSON.parse(dealEconomicsRaw);
    transactionJson = JSON.parse(transactionRaw);
    sellerPriceJson = JSON.parse(sellerPriceRaw);
  } catch {
    return null;
  }

  const propertyIdentity = validatePropertyIdentitySnapshot(propertyJson);
  const repairsCondition = validateRepairsConditionSnapshot(repairsJson);
  const arv = validateArvSnapshot(arvJson);
  const dealEconomics = validateDealEconomicsSnapshot(dealEconomicsJson);
  // transactionAssumptions / sellerPricePosition may legitimately be
  // `null` (unrecorded at decision time) -- checked before shape
  // validation so a genuine null is never mistaken for INVALID.
  const transactionAssumptions = transactionJson === null ? null : validateTransactionAssumptionsSnapshot(transactionJson);
  const sellerPricePosition = sellerPriceJson === null ? null : validateSellerPricePositionSnapshot(sellerPriceJson);

  if (propertyIdentity === INVALID) return null;
  if (repairsCondition === INVALID) return null;
  if (arv === INVALID) return null;
  if (dealEconomics === INVALID) return null;
  if (transactionAssumptions === INVALID) return null;
  if (sellerPricePosition === INVALID) return null;

  const snapshot: ReadinessEvidenceSnapshot = {
    propertyIdentity, repairsCondition, arv, dealEconomics, transactionAssumptions, sellerPricePosition,
  };

  if (kindRaw === "overridden") {
    // OVERRIDDEN requires a non-empty reason -- HumanAction's own type,
    // unchanged, requires it; a record failing this did not come from a
    // real override grant.
    if (reasonRaw === "UNAVAILABLE" || reasonRaw.trim() === "") return null;
    return { opportunityId, at, operator, kind: "overridden", reason: reasonRaw, snapshot };
  }
  if (kindRaw === "approved") {
    const reason = reasonRaw === "UNAVAILABLE" ? null : reasonRaw;
    return { opportunityId, at, operator, kind: "approved", reason, snapshot };
  }
  return null;
}

export function latestReadinessHumanActionForOpportunity(
  notes: { body: string }[],
  opportunityId: string,
): ParsedReadinessHumanAction | null {
  let latest: ParsedReadinessHumanAction | null = null;
  for (const note of notes) {
    const parsed = parseReadinessHumanActionNote(note.body);
    if (!parsed || parsed.opportunityId !== opportunityId) continue;
    if (!latest || new Date(parsed.at).getTime() > new Date(latest.at).getTime()) latest = parsed;
  }
  return latest;
}

export type ReadinessDecisionCurrency = {
  current: boolean;
  /** Human-readable, one entry per reason the decision is stale -- empty when `current`. */
  staleBecause: string[];
};

/**
 * Whether a recorded Offer Readiness decision still applies.
 *
 * `live.durablyInvalidated` (from `isReadinessDecisionInvalidated`, a
 * SEPARATE durable-note read the caller performs) is checked FIRST and
 * unconditionally: once true, it stays true forever, regardless of what
 * follows -- this is what makes invalidation PERMANENT rather than a
 * live recomputation that could flip back.
 *
 * Otherwise, DIRECT fact comparison runs across all six categories --
 * `live.snapshot` (the CURRENT resolved facts, built the same way
 * `record.snapshot` was at decision time) against `record.snapshot`,
 * field by field. This is what catches an external change with NO new
 * ledger note at all (e.g. the contact's address edited directly in GHL).
 *
 * Existence-based checks (`newest...NoteAt` after `record.at`) SUPPLEMENT
 * the direct comparison for the four note-backed categories -- they catch
 * a later note that happens to carry an IDENTICAL value (a re-save),
 * which direct comparison alone would not flag as a change. They never
 * replace the direct comparison.
 */
export function isReadinessDecisionCurrent(
  record: ParsedReadinessHumanAction,
  live: {
    snapshot: ReadinessEvidenceSnapshot;
    newestPropertyIdentityNoteAt: string | null;
    newestTransactionAssumptionsNoteAt: string | null;
    newestSellerPricePositionNoteAt: string | null;
    newestArvApprovalNoteAt: string | null;
    durablyInvalidated: boolean;
  },
): ReadinessDecisionCurrency {
  if (live.durablyInvalidated) {
    return {
      current: false,
      staleBecause: ["durably invalidated by a previously observed mismatch (permanent -- reverting the value cannot undo this)"],
    };
  }

  const decisionMs = new Date(record.at).getTime();
  const staleBecause: string[] = [];
  const isNewer = (at: string | null) => at !== null && new Date(at).getTime() > decisionMs;

  if (JSON.stringify(live.snapshot.propertyIdentity) !== JSON.stringify(record.snapshot.propertyIdentity)) {
    staleBecause.push("property identity (address or confirmation/withdrawal state) differs from this decision's snapshot");
  }
  if (JSON.stringify(live.snapshot.repairsCondition) !== JSON.stringify(record.snapshot.repairsCondition)) {
    staleBecause.push("repairs figure or approval state differs from this decision's snapshot");
  }
  if (JSON.stringify(live.snapshot.arv) !== JSON.stringify(record.snapshot.arv)) {
    staleBecause.push("ARV amount or evidence state differs from this decision's snapshot");
  }
  if (JSON.stringify(live.snapshot.dealEconomics) !== JSON.stringify(record.snapshot.dealEconomics)) {
    staleBecause.push("deal economics (inputs or outputs) differ from this decision's snapshot");
  }
  if (JSON.stringify(live.snapshot.transactionAssumptions) !== JSON.stringify(record.snapshot.transactionAssumptions)) {
    staleBecause.push("transaction assumptions differ from this decision's snapshot");
  }
  if (JSON.stringify(live.snapshot.sellerPricePosition) !== JSON.stringify(record.snapshot.sellerPricePosition)) {
    staleBecause.push("seller price position differs from this decision's snapshot");
  }

  if (isNewer(live.newestPropertyIdentityNoteAt) && !staleBecause.some((s) => s.startsWith("property identity"))) {
    staleBecause.push("a newer property identity record exists (value unchanged, but a fresh entry was made)");
  }
  if (isNewer(live.newestTransactionAssumptionsNoteAt) && !staleBecause.some((s) => s.startsWith("transaction assumptions"))) {
    staleBecause.push("a newer transaction assumptions record exists (value unchanged, but a fresh entry was made)");
  }
  if (isNewer(live.newestSellerPricePositionNoteAt) && !staleBecause.some((s) => s.startsWith("seller price position"))) {
    staleBecause.push("a newer seller price position record exists (value unchanged, but a fresh entry was made)");
  }
  if (isNewer(live.newestArvApprovalNoteAt) && !staleBecause.some((s) => s.startsWith("ARV"))) {
    staleBecause.push("a newer ARV approval record exists (value unchanged, but a fresh entry was made)");
  }

  return { current: staleBecause.length === 0, staleBecause };
}

/* ==================================================================== */
/* 5. Offer Ready decision -- durable invalidation record                */
/* ==================================================================== */

export const READINESS_DECISION_INVALIDATION_LEDGER_VERSION = "iaos-readiness-decision-invalidation-v1" as const;
const READINESS_DECISION_INVALIDATION_HEADER = `IAOS OFFER READINESS DECISION INVALIDATION — ${READINESS_DECISION_INVALIDATION_LEDGER_VERSION}`;
const READINESS_DECISION_INVALIDATION_LABELS = ["Recorded at", "Operator", "Opportunity", "Decision at", "Reasons"] as const;

export type ParsedReadinessDecisionInvalidation = {
  opportunityId: string;
  at: string;
  operator: string | null;
  /** The exact `at` of the `ParsedReadinessHumanAction` this note permanently invalidates. */
  decisionAt: string;
  reasons: string[];
};

export function formatReadinessDecisionInvalidationNote(args: {
  opportunityId: string;
  at: string;
  operator: string | null;
  decisionAt: string;
  reasons: string[];
}): string {
  return [
    READINESS_DECISION_INVALIDATION_HEADER,
    `${READINESS_DECISION_INVALIDATION_LABELS[0]}: ${args.at}`,
    `${READINESS_DECISION_INVALIDATION_LABELS[1]}: ${ledgerValue(args.operator)}`,
    `${READINESS_DECISION_INVALIDATION_LABELS[2]}: ${args.opportunityId}`,
    `${READINESS_DECISION_INVALIDATION_LABELS[3]}: ${args.decisionAt}`,
    `${READINESS_DECISION_INVALIDATION_LABELS[4]}: ${JSON.stringify(args.reasons)}`,
  ].join("\n");
}

export function parseReadinessDecisionInvalidationNote(body: string): ParsedReadinessDecisionInvalidation | null {
  const values = matchPositionalSchema(body, READINESS_DECISION_INVALIDATION_HEADER, READINESS_DECISION_INVALIDATION_LABELS);
  if (!values) return null;
  const [at, operatorRaw, opportunityId, decisionAt, reasonsRaw] = values;
  if (opportunityId === "") return null;
  if (decisionAt === "") return null;
  if (!isCanonicalIsoTimestamp(at)) return null;
  if (!isCanonicalIsoTimestamp(decisionAt)) return null;
  let reasonsParsed: unknown;
  try {
    reasonsParsed = JSON.parse(reasonsRaw);
  } catch {
    return null;
  }
  if (!Array.isArray(reasonsParsed) || reasonsParsed.length === 0) return null;
  if (!reasonsParsed.every((r) => typeof r === "string" && r.trim() !== "")) return null;
  const operator = operatorRaw === "UNAVAILABLE" ? null : operatorRaw;
  return { opportunityId, at, operator, decisionAt, reasons: reasonsParsed as string[] };
}

/**
 * Whether decision `decisionAt` (for this Opportunity) has EVER been
 * durably invalidated. Permanent by construction: notes are never
 * deleted, so once ANY matching invalidation note exists, this returns
 * `true` forever -- including after a reload, and including if the
 * underlying value that triggered it later reverts.
 */
export function isReadinessDecisionInvalidated(
  notes: { body: string }[],
  opportunityId: string,
  decisionAt: string,
): boolean {
  return notes.some((note) => {
    const parsed = parseReadinessDecisionInvalidationNote(note.body);
    return parsed !== null && parsed.opportunityId === opportunityId && parsed.decisionAt === decisionAt;
  });
}

/* ==================================================================== */
/* 6. Legacy v1 Offer Ready decision -- DISPLAY ONLY, never authorizes   */
/* ==================================================================== */

const READINESS_HUMAN_ACTION_V1_LEDGER_VERSION = "iaos-offer-readiness-human-action-v1" as const;
const READINESS_HUMAN_ACTION_V1_HEADER = `IAOS OFFER READINESS HUMAN ACTION — ${READINESS_HUMAN_ACTION_V1_LEDGER_VERSION}`;
const READINESS_HUMAN_ACTION_V1_LABELS = ["Recorded at", "Operator", "Opportunity", "Kind", "Reason"] as const;

export type ParsedLegacyReadinessHumanActionV1 = {
  opportunityId: string;
  at: string;
  operator: string | null;
  kind: "approved" | "overridden";
  reason: string | null;
};

/**
 * Recognizes the ORIGINAL v1 schema (5 fields, no evidence snapshot at
 * all) -- DISPLAY ONLY, per the second Jess Gate correction, 2026-09-08:
 * "Keep valid v1 readiness decisions visible as historical/inactive...
 * They must never authorize readiness." `buildOfferReadinessInputs` is
 * fed exclusively from `latestReadinessHumanActionForOpportunity` (the v3
 * reader above) -- nothing in this module or the page ever routes a
 * legacy v1 record into readiness gating. This function exists solely so
 * a genuine legacy decision remains visible as history in the UI rather
 * than becoming silently invisible the moment v2/v3 shipped (a v1 note
 * fails BOTH the v2 and v3 positional schemas outright, so without this
 * separate reader it would simply vanish from the page).
 */
export function parseLegacyReadinessHumanActionV1Note(body: string): ParsedLegacyReadinessHumanActionV1 | null {
  const values = matchPositionalSchema(body, READINESS_HUMAN_ACTION_V1_HEADER, READINESS_HUMAN_ACTION_V1_LABELS);
  if (!values) return null;
  const [at, operatorRaw, opportunityId, kindRaw, reasonRaw] = values;
  if (opportunityId === "") return null;
  if (!isCanonicalIsoTimestamp(at)) return null;
  if (kindRaw !== "approved" && kindRaw !== "overridden") return null;
  if (kindRaw === "overridden" && (reasonRaw === "UNAVAILABLE" || reasonRaw.trim() === "")) return null;
  const operator = operatorRaw === "UNAVAILABLE" ? null : operatorRaw;
  const reason = reasonRaw === "UNAVAILABLE" ? null : reasonRaw;
  return { opportunityId, at, operator, kind: kindRaw, reason };
}

export function latestLegacyReadinessHumanActionV1ForOpportunity(
  notes: { body: string }[],
  opportunityId: string,
): ParsedLegacyReadinessHumanActionV1 | null {
  let latest: ParsedLegacyReadinessHumanActionV1 | null = null;
  for (const note of notes) {
    const parsed = parseLegacyReadinessHumanActionV1Note(note.body);
    if (!parsed || parsed.opportunityId !== opportunityId) continue;
    if (!latest || new Date(parsed.at).getTime() > new Date(latest.at).getTime()) latest = parsed;
  }
  return latest;
}

/* ==================================================================== */
/* 7. Contract Ready handoff checklist progress                         */
/* ==================================================================== */

export const CONTRACT_READY_CHECKLIST_LEDGER_VERSION = "iaos-contract-ready-checklist-v2" as const;
const CONTRACT_READY_CHECKLIST_HEADER = `IAOS CONTRACT READY CHECKLIST — ${CONTRACT_READY_CHECKLIST_LEDGER_VERSION}`;
const CONTRACT_READY_CHECKLIST_LABELS = [
  "Recorded at", "Operator", "Opportunity", "Agreement at", "Agreed price", "Property address", "Items",
] as const;

/**
 * Exactly the five keys `SellerCallWorkspace.tsx`'s own pre-existing
 * `CONTRACT_CHECKLIST_ITEMS` (B8-10 / INV-53) already uses -- copied
 * verbatim rather than renamed, so the carrier and the already-proven UI
 * constant can never drift on which keys exist.
 */
export const CONTRACT_READY_ITEM_KEYS = [
  "legal_owners", "closing_timeline", "occupancy_possession", "liens_title", "delivery_signing",
] as const;
export type ContractReadyItemKey = (typeof CONTRACT_READY_ITEM_KEYS)[number];
export type ContractReadyItems = Record<ContractReadyItemKey, boolean>;

export type ParsedContractReadyChecklist = {
  opportunityId: string;
  at: string;
  operator: string | null;
  /** The accepted outcome's OWN durable timestamp (`seller-call-outcome.ts`'s `at`) -- the existing durable agreement identity, per the second Jess Gate correction. */
  agreementAt: string;
  agreedPrice: number;
  propertyAddress: string;
  items: ContractReadyItems;
};

export function formatContractReadyChecklistNote(args: {
  opportunityId: string;
  at: string;
  operator: string | null;
  agreementAt: string;
  agreedPrice: number;
  propertyAddress: string;
  items: ContractReadyItems;
}): string {
  return [
    CONTRACT_READY_CHECKLIST_HEADER,
    `${CONTRACT_READY_CHECKLIST_LABELS[0]}: ${args.at}`,
    `${CONTRACT_READY_CHECKLIST_LABELS[1]}: ${ledgerValue(args.operator)}`,
    `${CONTRACT_READY_CHECKLIST_LABELS[2]}: ${args.opportunityId}`,
    `${CONTRACT_READY_CHECKLIST_LABELS[3]}: ${args.agreementAt}`,
    `${CONTRACT_READY_CHECKLIST_LABELS[4]}: ${args.agreedPrice}`,
    `${CONTRACT_READY_CHECKLIST_LABELS[5]}: ${args.propertyAddress}`,
    `${CONTRACT_READY_CHECKLIST_LABELS[6]}: ${JSON.stringify(args.items)}`,
  ].join("\n");
}

/**
 * v2 (second Jess Gate correction, 2026-09-08): adds `Agreement at`, the
 * accepted outcome's own durable timestamp -- scoping by price+address
 * alone let a NEW agreement at the identical price and address wrongly
 * inherit a PRIOR agreement's checklist. v1 notes (6 fields, no Agreement
 * at) fail the v2 positional schema outright -- fail-closed, not migrated.
 */
export function parseContractReadyChecklistNote(body: string): ParsedContractReadyChecklist | null {
  const values = matchPositionalSchema(body, CONTRACT_READY_CHECKLIST_HEADER, CONTRACT_READY_CHECKLIST_LABELS);
  if (!values) return null;
  const [at, operatorRaw, opportunityId, agreementAt, agreedPriceRaw, propertyAddress, itemsRaw] = values;
  if (opportunityId === "") return null;
  if (propertyAddress === "") return null;
  if (!isCanonicalIsoTimestamp(at)) return null;
  if (!isCanonicalIsoTimestamp(agreementAt)) return null;
  const agreedPrice = Number(agreedPriceRaw);
  if (!Number.isFinite(agreedPrice) || agreedPrice <= 0) return null;
  let itemsParsed: unknown;
  try {
    itemsParsed = JSON.parse(itemsRaw);
  } catch {
    return null;
  }
  if (!isPlainObject(itemsParsed)) return null;
  if (!hasExactKeys(itemsParsed, CONTRACT_READY_ITEM_KEYS)) return null;
  const items = {} as ContractReadyItems;
  for (const key of CONTRACT_READY_ITEM_KEYS) {
    const v = itemsParsed[key];
    if (typeof v !== "boolean") return null;
    items[key] = v;
  }
  const operator = operatorRaw === "UNAVAILABLE" ? null : operatorRaw;
  return { opportunityId, at, operator, agreementAt, agreedPrice, propertyAddress, items };
}

/**
 * The current checklist progress for one Opportunity -- valid ONLY when
 * the latest note's `agreementAt` matches the CURRENT accepted outcome's
 * own durable timestamp exactly (the primary identity), AND its
 * `agreedPrice`/`propertyAddress` also match (defense in depth: "not
 * price/address alone" -- the ticket's own wording -- so a corrupted or
 * foreign `agreementAt` collision still cannot silently apply). A
 * DIFFERENT agreement -- even at the identical price and address -- has a
 * different `agreementAt` and reads back as no progress at all, never a
 * false start carried over from a prior deal. Mirrors
 * `currentPropertyIdentityConfirmationForOpportunity`'s exact-match rule.
 */
export function currentContractReadyChecklistForOpportunity(
  notes: { body: string }[],
  opportunityId: string,
  currentAgreementAt: string,
  currentAgreedPrice: number,
  currentPropertyAddress: string,
): ParsedContractReadyChecklist | null {
  let latest: ParsedContractReadyChecklist | null = null;
  for (const note of notes) {
    const parsed = parseContractReadyChecklistNote(note.body);
    if (!parsed || parsed.opportunityId !== opportunityId) continue;
    if (!latest || new Date(parsed.at).getTime() > new Date(latest.at).getTime()) latest = parsed;
  }
  if (!latest) return null;
  if (latest.agreementAt !== currentAgreementAt) return null;
  if (latest.agreedPrice !== currentAgreedPrice) return null;
  if (latest.propertyAddress !== currentPropertyAddress) return null;
  return latest;
}
