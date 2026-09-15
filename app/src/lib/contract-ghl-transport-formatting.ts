/**
 * GHL transport-only value formatting -- INV-67 compound text-destination
 * repair (this session), Product Owner rulings 1-4.
 *
 * Pure. No I/O, no React, no GHL identifiers, no writes. This module is
 * DELIBERATELY SEPARATE from `contract-document-model.ts`'s renderers
 * (`money`, `daysText`, `renderValueOrNone`, `renderSignerRequirements`,
 * `isoCalendarDate`) -- those render the human-facing Contract Workspace
 * preview and are UNCHANGED by this repair, per Brad's explicit ruling
 * ("human-facing Contract Workspace preview remains unchanged"). Every
 * function here derives its output from the SAME canonical
 * `SellerContractFactsReport` facts the preview already reads -- never a
 * second, independently-read carrier, never a re-parse of the preview's own
 * rendered text.
 *
 * WHY THIS MODULE EXISTS. The original architecture had
 * `contract-ghl-projection-model.ts`'s `buildContractProjectionPlan` copy
 * `ContractDocumentPreview.documentLines[key].text` VERBATIM into the GHL
 * projection for every retained document-line key. That is exactly correct
 * for a destination that is a single, unlabeled printed blank -- but TREC
 * 20-19 prints several of these blanks with adjacent literal characters
 * (`"$ ___"`, `"___ days"`) or an already-supplied "none" disposition that
 * the preview renders as a full invented sentence
 * (`"None (explicitly confirmed)."`) never intended to be printed onto the
 * executed contract. Reusing the preview's prose verbatim for those
 * destinations would duplicate printed TREC language or inject invented
 * prose the form was never designed to hold. This module supplies the
 * narrower, destination-aware renderer for exactly those cases; every other
 * retained key (unaffected by this repair) still uses the preview's own
 * verbatim text, untouched.
 *
 * TWO NEW COMPOUND-DESTINATION FIELD PAIRS (Product Owner ruling 1/2/3):
 * TREC paragraph 5(1) ("additional earnest money of $ ___ to Escrow Agent
 * within ___ days") and paragraph 9A ("on or before ___, 20 ___") each print
 * TWO physically separate blanks with live printed language between them --
 * no single merge-tag overlay can populate both without omitting a
 * sub-value or overlapping printed language. `additionalEarnestMoneyAmountTransport`
 * / `additionalEarnestMoneyDaysTransport` and `closingDateMonthDayTransport`
 * / `closingDateYearSuffixTransport` each derive from ONE canonical fact
 * (`AdditionalEarnestMoneyFact`, the `closingDate` ISO instant respectively)
 * so their sibling values can never disagree with each other or with the
 * combined value the (unchanged) preview still shows.
 *
 * `earnestMoneyOption.additionalEarnestMoney` and
 * `closingPossession.closingDate` themselves are RETIRED from template
 * projection by this repair (Product Owner ruling 1, Option A) -- their
 * existing GHL Test fields remain physically present but unwritten and
 * unplaced, exactly like the original 19 retired keys. No audit-only writer
 * is introduced.
 */

import type { ValueOrNone, AdditionalEarnestMoneyFact } from "./seller-contract-facts-carriers";
import type { SignerRequirement } from "./board9-contract-model";

/* ==================================================================== */
/* 1. Primitive transport renderers -- deterministic, no prose added     */
/* ==================================================================== */

/**
 * Bare US-formatted number, two decimals, NO `"$"` prefix -- the printed
 * form already carries the `"$"` glyph immediately before every destination
 * this feeds. Contrast with `contract-document-model.ts`'s `money()`, which
 * intentionally DOES prepend `"$"` for the human-facing preview (correct
 * there; wrong once placed directly after TREC's own printed `"$"`).
 */
export function moneyTransport(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Bare integer, NO `"day"`/`"days"` word -- the printed form already
 * carries the word `"days"` immediately after every destination this feeds.
 * Contrast with `contract-document-model.ts`'s `daysText()`, which
 * intentionally DOES append the word for the human-facing preview.
 */
export function daysTransport(n: number): string {
  return String(n);
}

/**
 * `""` for an explicitly-confirmed "none", never the preview's invented
 * `"None (explicitly confirmed)."` sentence -- TREC's printed blank stays
 * visually blank rather than receiving prose that is not itself TREC
 * language and was never sized for. Contrast with `contract-document-
 * model.ts`'s `renderValueOrNone()`, which intentionally DOES render that
 * sentence for the human-facing preview (a legitimate, readable audit
 * statement there; wrong once placed onto the executed contract page).
 */
export function valueOrNoneTransport(v: ValueOrNone): string {
  return v.kind === "none" ? "" : v.value;
}

/**
 * Same as `valueOrNoneTransport`, plus a defensive strip of one leading
 * `"$"` (and any whitespace between it and the value) -- for the two
 * retained keys (`propertyCondition.serviceContractCap`,
 * `settlementExpense.sellerCreditCap`) whose printed destination ALSO
 * follows a printed `"$"`, and whose underlying `ValueOrNone.value` is
 * free text from a generic, currency-unaware capture control
 * (`ValueOrNoneField` in `ContractWorkspace.tsx`) -- nothing upstream
 * guarantees an operator never types `"$500"`. This strip makes the
 * transport output safe BY CONSTRUCTION regardless of what was typed,
 * going forward; it is not a claim that historical data is clean.
 */
export function dollarValueOrNoneTransport(v: ValueOrNone): string {
  if (v.kind === "none") return "";
  return v.value.trim().replace(/^\$\s*/, "");
}

/**
 * Legal seller signer names ONLY, separated by `"; "` -- no role, no
 * signing-authority note, no other prose. Product Owner ruling 4: the
 * printed ¶1 Seller blank must receive names alone. Contrast with
 * `contract-document-model.ts`'s `renderSignerRequirements()`, which
 * intentionally DOES include `"(role)"` and an em-dash signing-authority
 * note for the human-facing preview. A signer with no recorded
 * `displayName` (the carrier's own `SignerRequirement.displayName` is
 * `string | null`) contributes nothing -- it is silently omitted rather
 * than rendering the literal string `"null"`.
 */
export function sellerSignersTransport(signers: SignerRequirement[]): string {
  return signers
    .filter((s): s is SignerRequirement & { displayName: string } => s.displayName !== null)
    .map((s) => s.displayName)
    .join("; ");
}

/* ==================================================================== */
/* 2. Additional earnest money -- one canonical fact, two transport keys */
/* ==================================================================== */

export function additionalEarnestMoneyAmountTransport(fact: AdditionalEarnestMoneyFact): string {
  return fact.kind === "none" ? "" : moneyTransport(fact.amount);
}

export function additionalEarnestMoneyDaysTransport(fact: AdditionalEarnestMoneyFact): string {
  return fact.kind === "none" ? "" : daysTransport(fact.withinDays);
}

/* ==================================================================== */
/* 3. Closing date -- one canonical instant, two transport keys          */
/* ==================================================================== */

/**
 * Fail-closed gate for the closing-date instant, called from
 * `buildContractProjectionPlan` BEFORE either closing-date transport value
 * is derived -- a malformed/unparseable instant, or a year outside
 * 2000-2099 (the century TREC's own printed `"20 ___"` prefix requires),
 * blocks the WHOLE plan via `blockingReasons`, exactly like every other
 * blocking reason already does (mineral-reservation disagreement, marker-
 * exclusivity violation, blocking broker arrangement) -- never a thrown
 * exception, since an out-of-range or malformed date is a real data
 * condition an operator can produce, not a code-integrity violation.
 */
export function checkClosingDateCenturyBound(closingDateIso: string): { ok: true } | { ok: false; reason: string } {
  const parsed = new Date(closingDateIso);
  if (Number.isNaN(parsed.getTime())) {
    return {
      ok: false,
      reason: `Closing date "${closingDateIso}" does not parse to a valid instant -- refusing to derive the closing-date template transport fields from it.`,
    };
  }
  const year = parsed.getUTCFullYear();
  if (year < 2000 || year > 2099) {
    return {
      ok: false,
      reason: `Closing date year ${year} is outside the supported 2000-2099 range -- TREC 20-19's printed "20 ___" century prefix cannot represent any other century. Refusing to sync until the closing date falls within 2000-2099.`,
    };
  }
  return { ok: true };
}

/**
 * `"Month Day"` (e.g. `"September 15"`), UTC-derived so the calendar day
 * never depends on server/browser local offset -- matches the blank
 * preceding TREC's own printed `", 20 ___"`. Callers MUST have already
 * confirmed `checkClosingDateCenturyBound(closingDateIso).ok === true`;
 * this function does not re-validate.
 */
export function closingDateMonthDayTransport(closingDateIso: string): string {
  return new Date(closingDateIso).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
}

/**
 * Exactly the two numeric characters following the printed `"20"` --
 * derived from the SAME ISO instant `closingDateMonthDayTransport` reads,
 * via the same UTC ISO-string slice this codebase's own
 * `isoCalendarDate()` already uses, so the two sibling values can never
 * disagree. Callers MUST have already confirmed
 * `checkClosingDateCenturyBound(closingDateIso).ok === true`.
 */
export function closingDateYearSuffixTransport(closingDateIso: string): string {
  return new Date(closingDateIso).toISOString().slice(2, 4);
}
