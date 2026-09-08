/**
 * Offer Readiness durable carriers -- B8-13 / INV-68.
 *
 * Pure. No I/O, no React, no GHL identifiers. Four format/parse pairs, one
 * per gap the locked addendum (`docs/DEAL_ECONOMICS_OFFER_READINESS_V1.md`,
 * "Addendum -- B8-13 / INV-68") resolves: Property identity, Transaction
 * assumptions, Seller price position, and the Offer Ready human
 * approval/override action. Colocated in one module because the addendum
 * authorizes all four together as one ruling -- each carrier is written
 * out fully and independently below; none shares implementation with
 * another, only the file.
 *
 * SAME PROVEN PATTERN AS `arv-approval-note.ts` / `seller-call-outcome.ts` /
 * `seller-call-negotiation-override-note.ts`, REUSED, NOT REINVENTED.
 * Versioned header, one fact per line, POSITIONAL parsing (never
 * `.find()` -- an earlier version of a sibling carrier was Jess-Gate
 * corrected for exactly this), a canonical ISO timestamp that must
 * round-trip through `toISOString()`, and a "latest entry wins, scoped to
 * ONE Opportunity" reader (by the note's OWN embedded timestamp, never by
 * list order or GHL's `dateAdded`). Every entry is a NEW append-only note;
 * nothing here ever overwrites a prior one.
 *
 * WRITTEN THROUGH THE EXISTING SANCTIONED WRITE ONLY. Every function below
 * builds and parses note strings; none performs a write. The caller
 * (`SellerCallWorkspace.tsx`) is responsible for `ghl.notes.create()` --
 * one of AGENTS.md's "three sanctioned writes, and no fourth." No new
 * write class, no new carrier beyond GHL Contact Notes.
 *
 * NO OPERATOR IDENTITY IS EVER FABRICATED. `operator` is carried through
 * verbatim (`null` when no authenticated-operator identity is available --
 * this app has none, confirmed absent by every sibling carrier's own
 * header) -- these functions neither require nor supply one.
 *
 * STALENESS: DECIDED FOR PROPERTY IDENTITY ONLY. The addendum is explicit
 * that a property-identity confirmation is tied to the address it was
 * given for -- `latestPropertyIdentityConfirmationForOpportunity` takes
 * the CURRENT address string and refuses a stale match, mirroring
 * `matchedArvApproval`'s "a stale entry must never lend evidence to a fact
 * it was not actually approved for" rule. The other three carriers use the
 * plain "latest entry, scoped to the Opportunity" rule every sibling
 * carrier in this codebase already applies -- the addendum explicitly
 * declines to invent anything more elaborate for them.
 */

/* ------------------------------------------------------------------ */
/* Shared helpers                                                       */
/* ------------------------------------------------------------------ */

function ledgerValue(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "UNAVAILABLE" : String(value);
}

/** Canonical ISO timestamp check shared by all four parsers -- must round-trip through `toISOString()` exactly, the same form every `at` producer here always emits. */
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

export const PROPERTY_IDENTITY_LEDGER_VERSION = "iaos-property-identity-confirmation-v1" as const;
const PROPERTY_IDENTITY_HEADER = `IAOS PROPERTY IDENTITY CONFIRMATION — ${PROPERTY_IDENTITY_LEDGER_VERSION}`;
const PROPERTY_IDENTITY_LABELS = ["Confirmed at", "Operator", "Opportunity", "Confirmed address"] as const;

export type ParsedPropertyIdentityConfirmation = {
  opportunityId: string;
  at: string;
  operator: string | null;
  confirmedAddress: string;
};

export function formatPropertyIdentityConfirmationNote(args: {
  opportunityId: string;
  at: string;
  operator: string | null;
  confirmedAddress: string;
}): string {
  return [
    PROPERTY_IDENTITY_HEADER,
    `${PROPERTY_IDENTITY_LABELS[0]}: ${args.at}`,
    `${PROPERTY_IDENTITY_LABELS[1]}: ${ledgerValue(args.operator)}`,
    `${PROPERTY_IDENTITY_LABELS[2]}: ${args.opportunityId}`,
    `${PROPERTY_IDENTITY_LABELS[3]}: ${args.confirmedAddress}`,
  ].join("\n");
}

export function parsePropertyIdentityConfirmationNote(body: string): ParsedPropertyIdentityConfirmation | null {
  const values = matchPositionalSchema(body, PROPERTY_IDENTITY_HEADER, PROPERTY_IDENTITY_LABELS);
  if (!values) return null;
  const [at, operatorRaw, opportunityId, confirmedAddress] = values;
  if (opportunityId === "") return null;
  if (confirmedAddress === "") return null;
  if (!isCanonicalIsoTimestamp(at)) return null;
  const operator = operatorRaw === "UNAVAILABLE" ? null : operatorRaw;
  return { opportunityId, at, operator, confirmedAddress };
}

/**
 * The CURRENT standing confirmation for one Opportunity, valid ONLY when
 * its `confirmedAddress` matches `currentAddress` exactly -- a stale
 * confirmation (the address changed since) is treated as absent, never as
 * still applying. Mirrors `matchingArvApprovalForOpportunity`.
 */
export function currentPropertyIdentityConfirmationForOpportunity(
  notes: { body: string }[],
  opportunityId: string,
  currentAddress: string,
): ParsedPropertyIdentityConfirmation | null {
  let latest: ParsedPropertyIdentityConfirmation | null = null;
  for (const note of notes) {
    const parsed = parsePropertyIdentityConfirmationNote(note.body);
    if (!parsed || parsed.opportunityId !== opportunityId) continue;
    if (!latest || new Date(parsed.at).getTime() > new Date(latest.at).getTime()) latest = parsed;
  }
  if (!latest) return null;
  return latest.confirmedAddress === currentAddress ? latest : null;
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
/* 4. Offer Ready human approval/override action                        */
/* ==================================================================== */

export const READINESS_HUMAN_ACTION_LEDGER_VERSION = "iaos-offer-readiness-human-action-v1" as const;
const READINESS_HUMAN_ACTION_HEADER = `IAOS OFFER READINESS HUMAN ACTION — ${READINESS_HUMAN_ACTION_LEDGER_VERSION}`;
const READINESS_HUMAN_ACTION_LABELS = ["Recorded at", "Operator", "Opportunity", "Kind", "Reason"] as const;

export type ParsedReadinessHumanAction =
  | { opportunityId: string; at: string; operator: string | null; kind: "approved"; reason: string | null }
  | { opportunityId: string; at: string; operator: string | null; kind: "overridden"; reason: string };

export function formatReadinessHumanActionNote(
  args:
    | { opportunityId: string; at: string; operator: string | null; kind: "approved"; reason: string | null }
    | { opportunityId: string; at: string; operator: string | null; kind: "overridden"; reason: string },
): string {
  return [
    READINESS_HUMAN_ACTION_HEADER,
    `${READINESS_HUMAN_ACTION_LABELS[0]}: ${args.at}`,
    `${READINESS_HUMAN_ACTION_LABELS[1]}: ${ledgerValue(args.operator)}`,
    `${READINESS_HUMAN_ACTION_LABELS[2]}: ${args.opportunityId}`,
    `${READINESS_HUMAN_ACTION_LABELS[3]}: ${args.kind}`,
    `${READINESS_HUMAN_ACTION_LABELS[4]}: ${ledgerValue(args.reason)}`,
  ].join("\n");
}

export function parseReadinessHumanActionNote(body: string): ParsedReadinessHumanAction | null {
  const values = matchPositionalSchema(body, READINESS_HUMAN_ACTION_HEADER, READINESS_HUMAN_ACTION_LABELS);
  if (!values) return null;
  const [at, operatorRaw, opportunityId, kindRaw, reasonRaw] = values;
  if (opportunityId === "") return null;
  if (!isCanonicalIsoTimestamp(at)) return null;
  const operator = operatorRaw === "UNAVAILABLE" ? null : operatorRaw;
  if (kindRaw === "overridden") {
    // OVERRIDDEN requires a non-empty reason -- HumanAction's own type,
    // unchanged, requires it; a record failing this did not come from a
    // real override grant.
    if (reasonRaw === "UNAVAILABLE" || reasonRaw.trim() === "") return null;
    return { opportunityId, at, operator, kind: "overridden", reason: reasonRaw };
  }
  if (kindRaw === "approved") {
    const reason = reasonRaw === "UNAVAILABLE" ? null : reasonRaw;
    return { opportunityId, at, operator, kind: "approved", reason };
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
