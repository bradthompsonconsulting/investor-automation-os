/**
 * Offer Readiness durable carriers -- B8-13 / INV-68, corrected per Jess
 * Gate 2026-09-08.
 *
 * Pure. No I/O, no React, no GHL identifiers. Five format/parse pairs:
 * Property identity, Transaction assumptions, Seller price position, the
 * Offer Ready human approval/override decision, and the Contract Ready
 * handoff checklist. Colocated in one module because the locked addendum
 * (`docs/DEAL_ECONOMICS_OFFER_READINESS_V1.md`, "Addendum -- B8-13 /
 * INV-68") authorizes the first four together as one ruling and the Jess
 * Gate correction below extends that same ruling; each carrier is written
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
 * nothing here ever overwrites or deletes a prior one -- a "withdrawn" or
 * "stale" state is always a NEW note, never an edit.
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
 * STALENESS, AS OF THE JESS GATE CORRECTION. Property identity: a
 * confirmation is tied to the address it was given for AND is blocked by
 * any later "withdrawn" entry (see carrier 1's own header). The Offer
 * Ready human-action decision: bound to durable evidence across all six
 * material categories, not category levels (see carrier 4,
 * `isReadinessDecisionCurrent`, for the exact durable-vs-value-comparison
 * split and its documented limitation). Transaction assumptions and
 * seller price position remain the plain "latest entry, scoped to the
 * Opportunity" rule -- nothing depends on their currency the way the
 * human-action decision does; they are simply overwritten going forward by
 * a fresh correction (carrier 2/3's own "latest wins" reader already
 * handles this with no further change).
 *
 * NEVER MERGED WITH `seller-call-negotiation-override-note.ts`.
 * `NegotiationOverride` (the above-Max price decision) remains completely
 * separate and untouched by this file or this correction.
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

export const PROPERTY_IDENTITY_LEDGER_VERSION = "iaos-property-identity-confirmation-v2" as const;
const PROPERTY_IDENTITY_HEADER = `IAOS PROPERTY IDENTITY CONFIRMATION — ${PROPERTY_IDENTITY_LEDGER_VERSION}`;
const PROPERTY_IDENTITY_LABELS = ["Recorded at", "Operator", "Opportunity", "Status", "Address"] as const;

/**
 * v2 (Jess Gate correction, 2026-09-08): adds `Status`, `confirmed` or
 * `withdrawn` -- the smallest schema change that lets an operator undo an
 * incorrect confirmation WITHOUT the address itself having to change. v1
 * notes (4 fields, no Status) fail the v2 positional schema outright and
 * parse as `null` -- the established fail-closed convention, not a
 * migration. Any v1 confirmation stops being recognized the moment this
 * ships; a fresh v2 confirmation is required. There is exactly one v1
 * note in this codebase's history (this session's own Test data), so nothing
 * of record is lost by this.
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
 * used both to resolve the current confirmation AND (by
 * `isReadinessDecisionCurrent` below) as durable invalidation evidence for
 * a prior Offer Readiness decision, independent of what the note's own
 * address/status says.
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
 * -- permanently blocks every OLDER confirmation from applying again,
 * exactly as required: withdrawing is itself the latest entry, so no older
 * "confirmed" entry can ever be seen as more recent) AND its `address`
 * must match `currentAddress` exactly -- a stale confirmation (the address
 * changed since) is treated as absent, never as still applying. Mirrors
 * `matchingArvApprovalForOpportunity`'s "a stale entry must never lend
 * evidence to a fact it was not actually approved for" rule.
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
/* 4. Offer Ready human approval/override action                        */
/* ==================================================================== */

export const READINESS_HUMAN_ACTION_LEDGER_VERSION = "iaos-offer-readiness-human-action-v2" as const;
const READINESS_HUMAN_ACTION_HEADER = `IAOS OFFER READINESS HUMAN ACTION — ${READINESS_HUMAN_ACTION_LEDGER_VERSION}`;
const READINESS_HUMAN_ACTION_LABELS = [
  "Recorded at", "Operator", "Opportunity", "Kind", "Reason",
  "Property snapshot", "Repairs snapshot", "ARV snapshot",
  "Deal economics snapshot", "Transaction assumptions snapshot", "Seller price position snapshot",
] as const;

/**
 * What the operator was actually looking at when this decision was made --
 * raw facts and evidence states, never category levels (Jess Gate,
 * 2026-09-08: "UNKNOWN can remain UNKNOWN while the address changes" --
 * comparing levels would miss exactly that case). One field per B8-04
 * category. Recorded for every decision (audit/history), but only
 * `repairsCondition` and `dealEconomics` are actually USED for currency
 * comparison below -- the other four are checked via durable note-existence
 * instead (see `isReadinessDecisionCurrent`), and are kept here purely as
 * the historical record of what was true at decision time.
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
  };
  transactionAssumptions: {
    structure: TransactionAssumptionField;
    closing: TransactionAssumptionField;
    title: TransactionAssumptionField;
  } | null;
  sellerPricePosition: { kind: "price"; price: number } | { kind: "refused" } | null;
};

export type ParsedReadinessHumanAction = {
  opportunityId: string;
  at: string;
  operator: string | null;
  snapshot: ReadinessEvidenceSnapshot;
} & (
  | { kind: "approved"; reason: string | null }
  | { kind: "overridden"; reason: string }
);

function formatSnapshotField(value: unknown): string {
  return JSON.stringify(value);
}

/** `null` on malformed JSON -- fails closed exactly like every other field here. */
function parseSnapshotField<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
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
 * v2 (Jess Gate correction, 2026-09-08): adds the six snapshot fields. v1
 * notes (5 fields) fail the v2 positional schema outright -- fail-closed,
 * not migrated. A v1 override note stops applying the moment this ships;
 * a fresh v2 decision is required. Exactly one v1 note exists anywhere
 * (this session's own Test data).
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

  const propertyIdentity = parseSnapshotField<ReadinessEvidenceSnapshot["propertyIdentity"]>(propertyRaw);
  const repairsCondition = parseSnapshotField<ReadinessEvidenceSnapshot["repairsCondition"]>(repairsRaw);
  const arv = parseSnapshotField<ReadinessEvidenceSnapshot["arv"]>(arvRaw);
  const dealEconomics = parseSnapshotField<ReadinessEvidenceSnapshot["dealEconomics"]>(dealEconomicsRaw);
  const transactionAssumptions = parseSnapshotField<ReadinessEvidenceSnapshot["transactionAssumptions"]>(transactionRaw);
  const sellerPricePosition = parseSnapshotField<ReadinessEvidenceSnapshot["sellerPricePosition"]>(sellerPriceRaw);
  // Every snapshot field must at least be valid JSON -- transactionAssumptions
  // and sellerPricePosition may themselves be `null` (legitimately
  // unrecorded at decision time), so only a JSON *parse failure* (undefined
  // sentinel from the catch above) fails the whole note; a genuine `null`
  // value is accepted for those two fields specifically.
  if (propertyIdentity === null) return null;
  if (repairsCondition === null) return null;
  if (arv === null) return null;
  if (dealEconomics === null) return null;
  if (transactionRaw !== "null" && transactionAssumptions === null) return null;
  if (sellerPriceRaw !== "null" && sellerPricePosition === null) return null;

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
 * Whether a recorded Offer Readiness decision still applies -- DURABLE
 * invalidation, not snapshot-equality (Jess Gate, 2026-09-08: "Snapshot
 * equality alone is insufficient for permanent invalidation... stays stale
 * even if previous values return").
 *
 * FOUR categories (property identity, transaction assumptions, seller
 * price position, ARV) each have their OWN append-only note history.
 * Invalidation for these is EXISTENCE-based: if any note of that carrier,
 * for this Opportunity, carries a timestamp AFTER this decision's `at`,
 * the decision is stale -- permanently, regardless of what that note's
 * VALUE says. Because notes are never deleted, once such a later note
 * exists it always will; a value that happens to revert to the original
 * snapshot cannot un-invalidate this decision. Only a brand-new decision
 * (a new note, a new `at`) can supersede it.
 *
 * TWO categories (repairs/condition, deal economics) are plain GHL FIELDS
 * with no note history to anchor to -- `contact.estimated_repairs` and the
 * opportunity's assignment-mode/Max/Target fields are overwritten in
 * place, never appended. For these, currency can only be checked by
 * comparing the CURRENT value to the snapshot AT READ TIME. This is a
 * REAL, ACKNOWLEDGED LIMITATION, not an oversight: if one of these two
 * changes and then reverts to exactly the snapshotted value between two
 * page loads, IAOS has no record that it ever moved, and this function
 * will report the decision as still current. Closing that gap would
 * require giving repairs approval and deal-economics resolution their own
 * append-only history -- a materially larger change than this correction
 * authorizes; not attempted here.
 */
export function isReadinessDecisionCurrent(
  record: ParsedReadinessHumanAction,
  live: {
    newestPropertyIdentityNoteAt: string | null;
    newestTransactionAssumptionsNoteAt: string | null;
    newestSellerPricePositionNoteAt: string | null;
    newestArvApprovalNoteAt: string | null;
    repairsCondition: ReadinessEvidenceSnapshot["repairsCondition"];
    dealEconomics: ReadinessEvidenceSnapshot["dealEconomics"];
  },
): ReadinessDecisionCurrency {
  const decisionMs = new Date(record.at).getTime();
  const staleBecause: string[] = [];

  const isNewer = (at: string | null) => at !== null && new Date(at).getTime() > decisionMs;

  if (isNewer(live.newestPropertyIdentityNoteAt)) staleBecause.push("property identity record changed since this decision");
  if (isNewer(live.newestTransactionAssumptionsNoteAt)) staleBecause.push("transaction assumptions record changed since this decision");
  if (isNewer(live.newestSellerPricePositionNoteAt)) staleBecause.push("seller price position record changed since this decision");
  if (isNewer(live.newestArvApprovalNoteAt)) staleBecause.push("ARV approval record changed since this decision");

  if (JSON.stringify(live.repairsCondition) !== JSON.stringify(record.snapshot.repairsCondition)) {
    staleBecause.push("repairs figure changed since this decision (value comparison only -- see module header limitation)");
  }
  if (JSON.stringify(live.dealEconomics) !== JSON.stringify(record.snapshot.dealEconomics)) {
    staleBecause.push("deal economics changed since this decision (value comparison only -- see module header limitation)");
  }

  return { current: staleBecause.length === 0, staleBecause };
}

/* ==================================================================== */
/* 5. Contract Ready handoff checklist progress                         */
/* ==================================================================== */

export const CONTRACT_READY_CHECKLIST_LEDGER_VERSION = "iaos-contract-ready-checklist-v1" as const;
const CONTRACT_READY_CHECKLIST_HEADER = `IAOS CONTRACT READY CHECKLIST — ${CONTRACT_READY_CHECKLIST_LEDGER_VERSION}`;
const CONTRACT_READY_CHECKLIST_LABELS = ["Recorded at", "Operator", "Opportunity", "Agreed price", "Property address", "Items"] as const;

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
  agreedPrice: number;
  propertyAddress: string;
  items: ContractReadyItems;
};

export function formatContractReadyChecklistNote(args: {
  opportunityId: string;
  at: string;
  operator: string | null;
  agreedPrice: number;
  propertyAddress: string;
  items: ContractReadyItems;
}): string {
  return [
    CONTRACT_READY_CHECKLIST_HEADER,
    `${CONTRACT_READY_CHECKLIST_LABELS[0]}: ${args.at}`,
    `${CONTRACT_READY_CHECKLIST_LABELS[1]}: ${ledgerValue(args.operator)}`,
    `${CONTRACT_READY_CHECKLIST_LABELS[2]}: ${args.opportunityId}`,
    `${CONTRACT_READY_CHECKLIST_LABELS[3]}: ${args.agreedPrice}`,
    `${CONTRACT_READY_CHECKLIST_LABELS[4]}: ${args.propertyAddress}`,
    `${CONTRACT_READY_CHECKLIST_LABELS[5]}: ${JSON.stringify(args.items)}`,
  ].join("\n");
}

export function parseContractReadyChecklistNote(body: string): ParsedContractReadyChecklist | null {
  const values = matchPositionalSchema(body, CONTRACT_READY_CHECKLIST_HEADER, CONTRACT_READY_CHECKLIST_LABELS);
  if (!values) return null;
  const [at, operatorRaw, opportunityId, agreedPriceRaw, propertyAddress, itemsRaw] = values;
  if (opportunityId === "") return null;
  if (propertyAddress === "") return null;
  if (!isCanonicalIsoTimestamp(at)) return null;
  const agreedPrice = Number(agreedPriceRaw);
  if (!Number.isFinite(agreedPrice) || agreedPrice <= 0) return null;
  let itemsParsed: unknown;
  try {
    itemsParsed = JSON.parse(itemsRaw);
  } catch {
    return null;
  }
  if (itemsParsed === null || typeof itemsParsed !== "object") return null;
  const items = {} as ContractReadyItems;
  for (const key of CONTRACT_READY_ITEM_KEYS) {
    const v = (itemsParsed as Record<string, unknown>)[key];
    if (typeof v !== "boolean") return null;
    items[key] = v;
  }
  // No extra keys -- a tampered or drifted record fails closed rather than
  // silently carrying an unknown item through.
  if (Object.keys(itemsParsed as Record<string, unknown>).length !== CONTRACT_READY_ITEM_KEYS.length) return null;
  const operator = operatorRaw === "UNAVAILABLE" ? null : operatorRaw;
  return { opportunityId, at, operator, agreedPrice, propertyAddress, items };
}

/**
 * The current checklist progress for one Opportunity -- valid ONLY when
 * the latest note's `agreedPrice` AND `propertyAddress` both match the
 * CURRENT agreement and property exactly. A different accepted price (a
 * renegotiated or later Accept) or a different address (the same
 * Opportunity somehow pointed at a different property) means this
 * checklist does not carry over -- it reads back as no progress at all,
 * never as a false start on the wrong deal. Mirrors
 * `currentPropertyIdentityConfirmationForOpportunity`'s exact-match rule.
 */
export function currentContractReadyChecklistForOpportunity(
  notes: { body: string }[],
  opportunityId: string,
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
  if (latest.agreedPrice !== currentAgreedPrice) return null;
  if (latest.propertyAddress !== currentPropertyAddress) return null;
  return latest;
}
