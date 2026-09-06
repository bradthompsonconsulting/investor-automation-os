/**
 * Negotiation above-Max override -- append-only provenance ledger. B8-11 /
 * INV-54.
 *
 * Pure. No I/O, no React, no GHL identifiers. `seller-call-negotiation.ts`'s
 * own header names this module's job verbatim: "the caller decides how much
 * history, if any, to keep in session state, and this module makes no
 * persistence decision at all -- that is explicitly B8-11's (INV-54)."
 * `NegotiationOverride` (B8-08 / INV-51) already carries every fact this
 * ledger needs -- `reason`, `operator`, `at`, `currentOfferAtOverride`,
 * `maxSupportedOfferAtOverride`, `amountAboveMaxAtOverride` -- this module
 * gives that EXISTING, unmodified shape a durable carrier; it invents no
 * new field and recomputes nothing `attemptOverride` already decided.
 *
 * NOT THE SAME "OVERRIDE" AS OFFER READINESS'S. `docs/DEAL_ECONOMICS_
 * OFFER_READINESS_V1.md`'s APPROVED/OVERRIDDEN `HumanAction` is a
 * DIFFERENT concept -- an evidence-quality decision -- and B8-01/B8-02
 * both leave "whether Offer Ready needs any approval/override persistence
 * mechanism at all" an UNRESOLVED PRODUCT DECISION with NO carrier
 * authorized. This module persists ONLY `seller-call-negotiation.ts`'s
 * `NegotiationOverride` (a PRICE decision -- proceeding above Max Supported
 * Offer), which INV-54's own release comment and `seller-call-
 * negotiation.ts`'s header both already name as this issue's job. Nothing
 * here reads, writes, or infers `ReadinessResult.humanAction` in any way.
 *
 * SAME PROVEN PATTERN AS `arv-approval-note.ts` / `seller-call-outcome.ts`,
 * REUSED, NOT REINVENTED. Versioned header, one fact per line, no per-
 * counter/per-keystroke detail, fails closed on ANY deviation from the
 * exact format, scoped to ONE Opportunity (PB-D55), and the "current
 * standing" reader picks the latest entry by the note's OWN embedded
 * timestamp -- never by list order or GHL's `dateAdded` -- so a later
 * override can never be shadowed by an earlier one still sitting elsewhere
 * in the raw note list. Every grant is a NEW append-only note; nothing here
 * ever overwrites a prior entry, so full history remains recoverable by
 * reading a contact's notes directly even though only the latest is used
 * for resume.
 *
 * WRITTEN THROUGH THE EXISTING SANCTIONED WRITE ONLY. This module builds
 * and parses the note string; it performs no write itself. The caller
 * (`SellerCallWorkspace.tsx`) is responsible for `ghl.notes.create()` --
 * one of AGENTS.md's "three sanctioned writes, and no fourth." No new
 * write class, no new carrier beyond GHL Contact Notes (already the
 * carrier for the ARV ledger and the call-outcome ledger).
 *
 * NO OPERATOR IDENTITY IS EVER FABRICATED. `operator` is carried through
 * verbatim (`null` when no authenticated-operator identity is available,
 * exactly as `attemptOverride` already produces it) -- this module neither
 * requires nor supplies one.
 */

export const NEGOTIATION_OVERRIDE_LEDGER_VERSION = "iaos-negotiation-override-v1" as const;
const EXPECTED_HEADER = `IAOS NEGOTIATION OVERRIDE LEDGER — ${NEGOTIATION_OVERRIDE_LEDGER_VERSION}`;

function ledgerValue(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === "" ? "UNAVAILABLE" : String(value);
}

export type ParsedNegotiationOverrideNote = {
  opportunityId: string;
  at: string;
  /** `null` when no authenticated operator identity is available -- never a fabricated name. Same convention as `seller-call-negotiation.ts`'s own `NegotiationOverride.operator`. */
  operator: string | null;
  reason: string;
  currentOfferAtOverride: number;
  maxSupportedOfferAtOverride: number;
  amountAboveMaxAtOverride: number;
};

/**
 * Structured note body for one above-Max override grant. Mirrors
 * `arv-persist.ts`'s `formatArvApprovalNote` / `seller-call-outcome.ts`'s
 * `formatOutcomeNote` shape verbatim: a versioned header line, one fact
 * per line. Written through the EXISTING `ghl.notes.create()` -- this
 * function only builds the string; it performs no write itself.
 */
export function formatNegotiationOverrideNote(args: {
  opportunityId: string;
  at: string;
  operator: string | null;
  reason: string;
  currentOfferAtOverride: number;
  maxSupportedOfferAtOverride: number;
  amountAboveMaxAtOverride: number;
}): string {
  return [
    EXPECTED_HEADER,
    `Override timestamp: ${args.at}`,
    `Operator: ${ledgerValue(args.operator)}`,
    `Opportunity: ${args.opportunityId}`,
    `Current Offer at override: ${args.currentOfferAtOverride}`,
    `Max Supported Offer at override: ${args.maxSupportedOfferAtOverride}`,
    `Amount above Max at override: ${args.amountAboveMaxAtOverride}`,
    `Reason: ${args.reason}`,
  ].join("\n");
}

/**
 * Parses one note body. Returns `null` on ANY deviation from the exact
 * format `formatNegotiationOverrideNote` produces -- fails closed, never
 * guesses, exactly like `arv-approval-note.ts`'s `parseArvApprovalNote`
 * and `seller-call-outcome.ts`'s `parseOutcomeNote`.
 */
export function parseNegotiationOverrideNote(body: string): ParsedNegotiationOverrideNote | null {
  if (typeof body !== "string") return null;
  const lines = body.split("\n");
  if (lines[0] !== EXPECTED_HEADER) return null;

  function field(label: string): string | null {
    const line = lines.find((l) => l.startsWith(label + ": "));
    return line ? line.slice(label.length + 2) : null;
  }

  const at = field("Override timestamp");
  const operatorRaw = field("Operator");
  const opportunityId = field("Opportunity");
  const currentOfferRaw = field("Current Offer at override");
  const maxSupportedOfferRaw = field("Max Supported Offer at override");
  const amountAboveMaxRaw = field("Amount above Max at override");
  const reasonRaw = field("Reason");

  if (!at || !opportunityId || !currentOfferRaw || !maxSupportedOfferRaw || !amountAboveMaxRaw || !reasonRaw) {
    return null;
  }

  const atMs = new Date(at).getTime();
  if (!Number.isFinite(atMs)) return null;

  const currentOfferAtOverride = Number(currentOfferRaw);
  const maxSupportedOfferAtOverride = Number(maxSupportedOfferRaw);
  const amountAboveMaxAtOverride = Number(amountAboveMaxRaw);
  if (!Number.isFinite(currentOfferAtOverride) || currentOfferAtOverride <= 0) return null;
  if (!Number.isFinite(maxSupportedOfferAtOverride) || maxSupportedOfferAtOverride <= 0) return null;
  if (!Number.isFinite(amountAboveMaxAtOverride) || amountAboveMaxAtOverride <= 0) return null;

  const operator = operatorRaw === null || operatorRaw === "UNAVAILABLE" || operatorRaw === "" ? null : operatorRaw;
  if (reasonRaw.trim() === "") return null;

  return {
    opportunityId,
    at,
    operator,
    reason: reasonRaw,
    currentOfferAtOverride,
    maxSupportedOfferAtOverride,
    amountAboveMaxAtOverride,
  };
}

/**
 * Finds the CURRENT standing override for one Opportunity from a
 * contact's full note list -- the latest ledger entry BY THE NOTE'S OWN
 * embedded timestamp, never by list order or GHL's `dateAdded`. Mirrors
 * `latestOutcomeNoteForOpportunity` / `latestArvApprovalForOpportunity`
 * exactly, for the same reason: a later override grant must never be
 * shadowed by an earlier one still sitting elsewhere in the raw note list.
 *
 * Matches ONLY notes for the given `opportunityId` (PB-D55): a contact
 * holding more than one deal's history must never have one deal's
 * override attributed to another.
 *
 * Whether this returned entry still APPLIES to the live negotiation
 * position is NOT this function's job -- `seller-call-negotiation.ts`'s
 * own `isOverrideCurrent` already answers that, unchanged, by comparing
 * `currentOfferAtOverride`/`maxSupportedOfferAtOverride` against the live
 * position. This function only answers "what is the most recent override
 * grant on record," exactly mirroring the existing ARV/outcome readers'
 * division of labor.
 */
export function latestNegotiationOverrideNoteForOpportunity(
  notes: { body: string }[],
  opportunityId: string,
): ParsedNegotiationOverrideNote | null {
  let latest: ParsedNegotiationOverrideNote | null = null;
  for (const note of notes) {
    const parsed = parseNegotiationOverrideNote(note.body);
    if (!parsed || parsed.opportunityId !== opportunityId) continue;
    if (!latest || new Date(parsed.at).getTime() > new Date(latest.at).getTime()) {
      latest = parsed;
    }
  }
  return latest;
}
