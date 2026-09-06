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
 * counter/per-keystroke detail, scoped to ONE Opportunity (PB-D55), and
 * the "current standing" reader picks the latest entry by the note's OWN
 * embedded timestamp -- never by list order or GHL's `dateAdded` -- so a
 * later override can never be shadowed by an earlier one still sitting
 * elsewhere in the raw note list. Every grant is a NEW append-only note;
 * nothing here ever overwrites a prior entry, so full history remains
 * recoverable by reading a contact's notes directly even though only the
 * latest is used for resume.
 *
 * Jess Gate correction, 2026-09-07: FAILS CLOSED ON ANY DEVIATION MEANS
 * POSITIONAL, NOT `find()`. This is an authoritative provenance/readback
 * carrier -- an earlier version of this parser located each field with
 * `lines.find((l) => l.startsWith(label + ": "))`, which is order-blind
 * and duplicate-blind: it silently accepted extra/unknown lines, a
 * duplicate field line (the first match wins), and fields in any order,
 * as long as every required label appeared SOMEWHERE. A malformed or
 * tampered record could therefore be accepted and restored as a
 * legitimate prior override. `parseNegotiationOverrideNote` now requires
 * the EXACT eight-line canonical schema `formatNegotiationOverrideNote`
 * emits -- the header plus `FIELD_LABELS`' seven fields, in that exact
 * order, each appearing exactly once, with no extra line before or after
 * -- checked positionally (`lines.length !== 8` and `lines[i + 1]` must
 * start with `FIELD_LABELS[i] + ": "`, never a search). `FIELD_LABELS` is
 * the ONE place the schema's order is declared; both the formatter and
 * the parser read from it, so the two can never drift out of agreement
 * the way two independently hardcoded lists could.
 *
 * A CANONICAL TIMESTAMP, NOT MERELY A PARSEABLE ONE. `new Date(at)`
 * accepts many non-canonical strings `Date#toISOString()` (what
 * `attemptOverride` actually produces) never would -- this parser
 * additionally requires `new Date(at).toISOString() === at`, so only the
 * exact canonical form round-trips.
 *
 * THE ECONOMICS INVARIANT IS VALIDATED, NOT TRUSTED. An above-Max
 * override is, by `attemptOverride`'s own precondition, ONLY ever granted
 * when `currentOfferAtOverride > maxSupportedOfferAtOverride` (strictly
 * -- `computeNegotiationPosition`'s own `above_max` branch), and
 * `amountAboveMaxAtOverride` is ALWAYS exactly their difference (also
 * `computeNegotiationPosition`'s own arithmetic, never independently
 * chosen). A record failing either check did not come from
 * `attemptOverride` as this codebase actually calls it -- tampered or
 * corrupt -- and is refused, not resurrected.
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

/**
 * The canonical eight-line schema (this header plus these seven fields,
 * in this exact order) -- the ONE declaration both `formatNegotiationOverrideNote`
 * and `parseNegotiationOverrideNote` read from, so format and parse can
 * never drift into disagreement about order, count, or labels.
 */
const FIELD_LABELS = [
  "Override timestamp",
  "Operator",
  "Opportunity",
  "Current Offer at override",
  "Max Supported Offer at override",
  "Amount above Max at override",
  "Reason",
] as const;

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
    `${FIELD_LABELS[0]}: ${args.at}`,
    `${FIELD_LABELS[1]}: ${ledgerValue(args.operator)}`,
    `${FIELD_LABELS[2]}: ${args.opportunityId}`,
    `${FIELD_LABELS[3]}: ${args.currentOfferAtOverride}`,
    `${FIELD_LABELS[4]}: ${args.maxSupportedOfferAtOverride}`,
    `${FIELD_LABELS[5]}: ${args.amountAboveMaxAtOverride}`,
    `${FIELD_LABELS[6]}: ${args.reason}`,
  ].join("\n");
}

/**
 * Parses one note body. Returns `null` on ANY deviation from the exact
 * canonical eight-line schema `formatNegotiationOverrideNote` produces --
 * fails closed, never guesses. See the module header (Jess Gate
 * correction, 2026-09-07) for exactly what "any deviation" now covers:
 * wrong line count, wrong order, a duplicate or missing field, a
 * non-canonical timestamp, or an economics invariant that does not hold.
 */
export function parseNegotiationOverrideNote(body: string): ParsedNegotiationOverrideNote | null {
  if (typeof body !== "string") return null;
  const lines = body.split("\n");

  // Positional, not `find()`: exactly the header plus FIELD_LABELS.length
  // fields, no more, no fewer -- an extra/unknown line (before, between,
  // or after) fails this length check outright.
  if (lines.length !== 1 + FIELD_LABELS.length) return null;
  if (lines[0] !== EXPECTED_HEADER) return null;

  const values: string[] = [];
  for (let i = 0; i < FIELD_LABELS.length; i++) {
    const line = lines[i + 1];
    const prefix = FIELD_LABELS[i] + ": ";
    // The field at THIS position must be THIS label -- a reordered field,
    // or a duplicate of another field occupying this slot instead, fails
    // here rather than being silently found elsewhere in the note.
    if (!line.startsWith(prefix)) return null;
    values.push(line.slice(prefix.length));
  }
  const [at, operatorRaw, opportunityId, currentOfferRaw, maxSupportedOfferRaw, amountAboveMaxRaw, reasonRaw] = values;

  if (opportunityId === "") return null;
  if (reasonRaw.trim() === "") return null;

  // Canonical ISO timestamp: must round-trip through Date#toISOString()
  // exactly, the same form `attemptOverride`'s own `at` is always
  // produced with -- a JavaScript-parseable but non-canonical string
  // (a different precision, offset notation, or format entirely) fails
  // here even though `new Date(...)` itself would accept it.
  const atMs = new Date(at).getTime();
  if (!Number.isFinite(atMs)) return null;
  if (new Date(atMs).toISOString() !== at) return null;

  const currentOfferAtOverride = Number(currentOfferRaw);
  const maxSupportedOfferAtOverride = Number(maxSupportedOfferRaw);
  const amountAboveMaxAtOverride = Number(amountAboveMaxRaw);
  if (!Number.isFinite(currentOfferAtOverride) || currentOfferAtOverride <= 0) return null;
  if (!Number.isFinite(maxSupportedOfferAtOverride) || maxSupportedOfferAtOverride <= 0) return null;
  if (!Number.isFinite(amountAboveMaxAtOverride) || amountAboveMaxAtOverride <= 0) return null;

  // The economics invariant: an above-Max override is only ever granted
  // when Current Offer STRICTLY exceeds Max (computeNegotiationPosition's
  // own "above_max" branch), and Amount above Max is always exactly their
  // difference (that same function's own arithmetic) -- never
  // independently chosen. Either failing means this record did not come
  // from `attemptOverride` as this codebase actually calls it.
  if (currentOfferAtOverride <= maxSupportedOfferAtOverride) return null;
  if (amountAboveMaxAtOverride !== currentOfferAtOverride - maxSupportedOfferAtOverride) return null;

  const operator = operatorRaw === "UNAVAILABLE" || operatorRaw === "" ? null : operatorRaw;

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
