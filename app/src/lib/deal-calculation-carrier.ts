/**
 * B15-25 Phase 2 -- "Save Calculation to Deal" ledger carrier (INV-133).
 *
 * Jess RULING 2026-10-30 (Captain approved P2-1..P2-5): the operator's working
 * Deal Calculator figures are kept in GHL as STRUCTURED, APPEND-ONLY contact
 * notes, never in a custom field. One explicitly authorized write surface,
 * Test only. A saved calculation is NEVER an approval: it does not approve
 * ARV or repairs, does not set or change Current Offer, and no approval
 * reader consumes it.
 *
 * SAME PROVEN PATTERN AS `seller-call-readiness-carriers.ts`, REUSED, NOT
 * REINVENTED. Versioned header, one fact per line, POSITIONAL parsing, a
 * canonical ISO timestamp that must round-trip through `toISOString()`, and a
 * "latest entry wins, scoped to ONE Opportunity" reader by the note's OWN
 * embedded timestamp (never list order or GHL's `dateAdded`). Every save is a
 * NEW note; nothing here overwrites, edits or deletes a prior one.
 *
 * Pure. No I/O, no React, no GHL identifiers. The page builds the body here
 * and writes it with the existing sanctioned `ghl.notes.create()`; the server
 * (`write-note-guard.ts`) parses it with `parseDealCalculationNote` and
 * applies `validateDealCalculationAgainst` before anything is sent.
 *
 * NO SILENT OVERWRITE (P2-5). Each note names the calculation it was based on
 * (`Supersedes`). A save is valid only while that is still the latest saved
 * calculation for the deal; otherwise the operator chooses Load Newer or
 * Save as New -- a new note either way.
 */

export const DEAL_CALCULATION_VERSION = "iaos-deal-calculation-v1" as const;
export const DEAL_CALCULATION_HEADER = `IAOS DEAL CALCULATION — ${DEAL_CALCULATION_VERSION}`;
/** The one fixed status. Any other value fails the parse. */
export const DEAL_CALCULATION_STATUS = "working calculation (not approved)" as const;
const LABELS = [
  "Opportunity", "Saved", "Operator", "Supersedes", "Property identity",
  "ARV input", "Repairs (quick)", "Test purchase price", "Assignment mode", "Manual assignment amount",
  "Basis approved ARV", "Basis approved repairs", "Basis Current Offer", "Status",
] as const;
/** The Deal Calculator's own assignment-mode values (`AssignmentModeName`). */
export const DEAL_CALCULATION_ASSIGNMENT_MODES = ["standard", "profit_share", "manual"] as const;
export type DealCalculationAssignmentMode = (typeof DEAL_CALCULATION_ASSIGNMENT_MODES)[number];
/** How long a `Saved` timestamp may differ from the server clock (replay / back-dating guard). */
export const DEAL_CALCULATION_SAVED_SKEW_MS = 10 * 60 * 1000;

/** The approved opportunity facts at save time, kept for staleness only. `null` = nothing recorded. */
export type DealCalculationBasis = { arv: number | null; repairs: number | null; currentOffer: number | null };

export type DealCalculation = {
  opportunityId: string;
  saved: string;
  /** The server's ledger guard accepts only "brad". */
  operator: "brad";
  /** `Saved` of the calculation this one was based on, or null for none. */
  supersedes: string | null;
  /** `at` of the latest Property Identity Confirmation note for the deal, or null for none. */
  propertyIdentity: string | null;
  /** Whole dollars, or null when the input was blank. */
  arvInput: number | null;
  repairsQuick: number | null;
  testPrice: number | null;
  assignmentMode: DealCalculationAssignmentMode;
  manualAmount: number | null;
  basis: DealCalculationBasis;
};

const OPPORTUNITY_ID = /^[A-Za-z0-9_-]{1,64}$/;
const WHOLE_DOLLARS = /^(0|[1-9][0-9]{0,11})$/;
const BASIS_AMOUNT = /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$/;

function isCanonicalIso(at: string): boolean {
  const ms = new Date(at).getTime();
  return Number.isFinite(ms) && new Date(ms).toISOString() === at;
}

/** Positional match: exact header, exact label order, no missing, extra or duplicate line, LF only. */
function matchPositional(body: string): string[] | null {
  if (typeof body !== "string" || body.includes("\r")) return null;
  const lines = body.split("\n");
  if (lines.length !== 1 + LABELS.length || lines[0] !== DEAL_CALCULATION_HEADER) return null;
  const values: string[] = [];
  for (let i = 0; i < LABELS.length; i++) {
    const prefix = `${LABELS[i]}: `;
    const line = lines[i + 1];
    if (line === `${LABELS[i]}:`) { values.push(""); continue; }   // a blank amount
    if (!line.startsWith(prefix)) return null;
    const value = line.slice(prefix.length);
    if (value === "" || value !== value.trim()) return null;
    values.push(value);
  }
  return values;
}

const amountOut = (v: number | null): string => (v === null ? "" : String(v));
function amountIn(raw: string): number | null | undefined {
  if (raw === "") return null;
  return WHOLE_DOLLARS.test(raw) ? Number(raw) : undefined;
}
const basisOut = (v: number | null): string => (v === null ? "none" : String(v));
function basisIn(raw: string): number | null | undefined {
  if (raw === "none") return null;
  return BASIS_AMOUNT.test(raw) ? Number(raw) : undefined;
}
const stampOut = (v: string | null): string => (v === null ? "none" : v);
function stampIn(raw: string): string | null | undefined {
  if (raw === "none") return null;
  return isCanonicalIso(raw) ? raw : undefined;
}
function validAmount(v: unknown): boolean { return v === null || (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && WHOLE_DOLLARS.test(String(v))); }
function validBasis(v: unknown): boolean { return v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0 && BASIS_AMOUNT.test(String(v))); }

/** Builds the note body. Throws on any invalid field -- never emits a partial or malformed note. */
export function formatDealCalculationNote(c: DealCalculation): string {
  if (!OPPORTUNITY_ID.test(c.opportunityId)) throw new Error("deal calculation: invalid opportunity");
  if (!isCanonicalIso(c.saved)) throw new Error("deal calculation: Saved must be a canonical ISO timestamp");
  if (c.operator !== "brad") throw new Error("deal calculation: operator must be brad");
  if (c.supersedes !== null && !isCanonicalIso(c.supersedes)) throw new Error("deal calculation: invalid Supersedes");
  if (c.propertyIdentity !== null && !isCanonicalIso(c.propertyIdentity)) throw new Error("deal calculation: invalid Property identity");
  for (const v of [c.arvInput, c.repairsQuick, c.testPrice, c.manualAmount]) if (!validAmount(v)) throw new Error("deal calculation: amounts are whole dollars or blank");
  if (!DEAL_CALCULATION_ASSIGNMENT_MODES.includes(c.assignmentMode)) throw new Error("deal calculation: invalid assignment mode");
  for (const v of [c.basis.arv, c.basis.repairs, c.basis.currentOffer]) if (!validBasis(v)) throw new Error("deal calculation: invalid basis");
  const values = [
    c.opportunityId, c.saved, c.operator, stampOut(c.supersedes), stampOut(c.propertyIdentity),
    amountOut(c.arvInput), amountOut(c.repairsQuick), amountOut(c.testPrice), c.assignmentMode, amountOut(c.manualAmount),
    basisOut(c.basis.arv), basisOut(c.basis.repairs), basisOut(c.basis.currentOffer), DEAL_CALCULATION_STATUS,
  ];
  return [DEAL_CALCULATION_HEADER, ...LABELS.map((l, i) => (values[i] === "" ? `${l}:` : `${l}: ${values[i]}`))].join("\n");
}

/** The parsed note, or null on ANY deviation. Fail-closed: a near-miss is never partly read. */
export function parseDealCalculationNote(body: string): DealCalculation | null {
  const v = matchPositional(body);
  if (!v) return null;
  const [opportunityId, saved, operator, supersedesRaw, propertyRaw, arvRaw, repairsRaw, testRaw, mode, manualRaw, bArv, bRep, bOffer, status] = v;
  if (!OPPORTUNITY_ID.test(opportunityId) || !isCanonicalIso(saved) || operator !== "brad" || status !== DEAL_CALCULATION_STATUS) return null;
  if (!(DEAL_CALCULATION_ASSIGNMENT_MODES as readonly string[]).includes(mode)) return null;
  const supersedes = stampIn(supersedesRaw), propertyIdentity = stampIn(propertyRaw);
  const arvInput = amountIn(arvRaw), repairsQuick = amountIn(repairsRaw), testPrice = amountIn(testRaw), manualAmount = amountIn(manualRaw);
  const basis = { arv: basisIn(bArv), repairs: basisIn(bRep), currentOffer: basisIn(bOffer) };
  if ([supersedes, propertyIdentity, arvInput, repairsQuick, testPrice, manualAmount, basis.arv, basis.repairs, basis.currentOffer].some((x) => x === undefined)) return null;
  if (typeof supersedes === "string" && new Date(supersedes).getTime() >= new Date(saved).getTime()) return null;
  return {
    opportunityId, saved, operator: "brad", supersedes: supersedes as string | null, propertyIdentity: propertyIdentity as string | null,
    arvInput: arvInput as number | null, repairsQuick: repairsQuick as number | null, testPrice: testPrice as number | null,
    assignmentMode: mode as DealCalculationAssignmentMode, manualAmount: manualAmount as number | null,
    basis: basis as DealCalculationBasis,
  };
}

/** Every saved calculation for one Opportunity, newest first by embedded `Saved`. Malformed notes are ignored. */
export function calculationsForOpportunity(notes: { body: string }[], opportunityId: string): DealCalculation[] {
  const out: DealCalculation[] = [];
  for (const n of notes) {
    const c = parseDealCalculationNote(n.body);
    if (c && c.opportunityId === opportunityId) out.push(c);
  }
  return out.sort((a, b) => new Date(b.saved).getTime() - new Date(a.saved).getTime());
}

/** The latest saved calculation for one Opportunity, or null. */
export function latestDealCalculationForOpportunity(notes: { body: string }[], opportunityId: string): DealCalculation | null {
  return calculationsForOpportunity(notes, opportunityId)[0] ?? null;
}

/**
 * The approved facts as BOTH sides read them: the opportunity's own custom
 * field `fieldValue` (the `/opportunities/{id}` shape `ghl-write-boundary.ts`
 * reads). Absent or empty = null; a non-numeric value is unreadable (throws)
 * -- a basis is never guessed.
 */
export function basisFromOpportunityFields(
  customFields: { id: string; [key: string]: unknown }[],
  ids: { arv: string; repairs: string; currentOffer: string },
): DealCalculationBasis {
  const read = (id: string): number | null => {
    const entries = customFields.filter((f) => f && f.id === id);
    if (entries.length > 1) throw new Error("deal calculation: duplicate field readback");
    if (entries.length === 0) return null;
    const raw = entries[0].fieldValue;
    if (raw === null || raw === undefined || raw === "") return null;
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : NaN;
    if (!Number.isFinite(n) || n < 0) throw new Error("deal calculation: unreadable approved fact");
    return Math.round(n * 100) / 100;
  };
  return { arv: read(ids.arv), repairs: read(ids.repairs), currentOffer: read(ids.currentOffer) };
}

export type DealCalculationRefusal =
  | "newer_calculation_exists"
  | "saved_not_fresh"
  | "basis_mismatch"
  | "property_identity_mismatch";

/**
 * The carrier's own rules against fresh evidence. Shared by the server guard
 * (authoritative) and the page (to explain a refusal and offer Load Newer /
 * Save as New). Returns null when the calculation may be saved.
 */
export function validateDealCalculationAgainst(
  c: DealCalculation,
  fresh: { latest: DealCalculation | null; basis: DealCalculationBasis; propertyIdentity: string | null; nowMs: number },
): DealCalculationRefusal | null {
  const latestSaved = fresh.latest ? fresh.latest.saved : null;
  if (c.supersedes !== latestSaved) return "newer_calculation_exists";
  const savedMs = new Date(c.saved).getTime();
  if (Math.abs(savedMs - fresh.nowMs) > DEAL_CALCULATION_SAVED_SKEW_MS) return "saved_not_fresh";
  if (latestSaved !== null && savedMs <= new Date(latestSaved).getTime()) return "saved_not_fresh";
  if (c.basis.arv !== fresh.basis.arv || c.basis.repairs !== fresh.basis.repairs || c.basis.currentOffer !== fresh.basis.currentOffer) return "basis_mismatch";
  if (c.propertyIdentity !== fresh.propertyIdentity) return "property_identity_mismatch";
  return null;
}

/** What changed since a calculation was saved -- shown on Load; never alters either side. */
export function calculationStaleness(
  c: DealCalculation,
  fresh: { basis: DealCalculationBasis; propertyIdentity: string | null },
): { arv: boolean; repairs: boolean; currentOffer: boolean; property: boolean } {
  return {
    arv: c.basis.arv !== fresh.basis.arv,
    repairs: c.basis.repairs !== fresh.basis.repairs,
    currentOffer: c.basis.currentOffer !== fresh.basis.currentOffer,
    property: c.propertyIdentity !== fresh.propertyIdentity,
  };
}
