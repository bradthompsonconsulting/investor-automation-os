/**
 * One-/Two-Seller signer-cardinality model -- INV-67 Phase 1 (this
 * session), per Brad/Jess's final-gated planning rounds.
 *
 * Pure. No I/O, no React, no GHL identifiers, no writes -- with ONE
 * explicit, clearly-marked exception at the bottom of this file
 * (`resolveSeller1FromOpportunity` is still pure/no-I/O itself, but
 * documents the network boundary it sits just inside of; see that
 * function's own doc comment).
 *
 * SCOPE OF THIS FILE, EXACTLY AS AUTHORIZED THIS PHASE:
 *   - The canonical `SellerSigningModel` type, including the explicit,
 *     STRUCTURED `SigningCapacityDisposition` (never inferred from free-
 *     text `role`/`signingAuthorityNote` -- those remain descriptive audit
 *     data only, per the locked Product Owner ruling closing the entity-
 *     capacity bypass).
 *   - Email/name normalization, exactly as ruled: email is
 *     `trim().toLowerCase()`; name comparison is trim + collapse repeated
 *     whitespace + case-insensitive -- NEVER fuzzy.
 *   - Fifteen individually distinct, individually testable pre-draft gate
 *     functions, plus one aggregator (`evaluateSellerSigningReadiness`)
 *     that mirrors `board9-contract-model.ts`'s own accumulator shape
 *     (`{ok:true} | {ok:false; reasons: string[]}`) -- ALL applicable
 *     reasons are reported together, never just the first, so an operator
 *     sees everything wrong in one pass.
 *   - The transport-value derivation (`sellerCountTransportValue`).
 *
 * DELIBERATELY NOT DONE THIS PHASE (see the governing plan, PR description,
 * and Brad's own "OUT OF SCOPE" list): `evaluateSellerSigningReadiness` is
 * NOT wired into `contract-ghl-projection-model.ts`'s
 * `buildContractProjectionPlan` or `contract-draft-request-model.ts`'s
 * transition gate in this phase -- that live integration is later,
 * separately authorized work, matching "implement final template
 * routing/config before the Two-Seller clone exists" and "implement the
 * final draft-bound recipient-confirmation gate" both being explicitly
 * out of scope. This file makes that integration possible and fully
 * testable in isolation; it does not perform it.
 *
 * SELLER 1 NEVER MANUALLY DUPLICATED. Seller 1 carries no captured
 * identity fields in `SellerSigningModel` at all -- it always references
 * the Opportunity's own bound primary Contact, resolved via
 * `resolveSeller1FromOpportunity` below from data THIS APPLICATION ALREADY
 * FETCHES (`OpportunityRow.contactId`/`contactName`/`email`, populated by
 * the existing `ghl-opportunities` function and already present on every
 * row `ContractWorkspace.tsx` already loads via `opportunitiesForContact`)
 * -- no new GHL API surface, no duplicated client, per "reuse existing GHL
 * Opportunity and Contact read surfaces; do not duplicate API clients."
 */

/* ==================================================================== */
/* 1. Canonical types                                                    */
/* ==================================================================== */

export type SigningCapacityDisposition = "individual_own_capacity" | "unsupported_capacity" | "unresolved";

export type SecondSellerIdentity = {
  legalName: string;
  email: string;
};

export type SellerSigningModel =
  | {
      kind: "one_seller";
      seller1Capacity: SigningCapacityDisposition;
    }
  | {
      kind: "two_sellers";
      seller1Capacity: SigningCapacityDisposition;
      seller2: SecondSellerIdentity;
      seller2Capacity: SigningCapacityDisposition;
    };

/** Disposition-level wrapper, matching every other carrier's three-state `FieldDisposition` shape used throughout this codebase -- `not_applicable` and `unresolved` both block identically (the closing-date precedent, PR #59). */
export type SellerSigningModelDisposition =
  | { kind: "populated"; value: SellerSigningModel }
  | { kind: "not_applicable" }
  | { kind: "unresolved" };

/* ==================================================================== */
/* 2. Normalization -- exactly as ruled, no fuzzy matching anywhere       */
/* ==================================================================== */

/** Email: trim().toLowerCase() before storage and before every comparison. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Approved minimal email-format check -- no existing validator exists anywhere in this codebase; this is intentionally light-touch, consistent with the rest of this codebase's validation style. */
export function isValidEmailFormat(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Name comparison normalization -- Product Owner ruling, settled: trim,
 * collapse repeated internal whitespace to a single space, compare case-
 * insensitively. NOTHING ELSE. Punctuation, middle names, suffixes, and
 * abbreviations are NOT normalized away -- two names differing only in
 * those respects are, correctly, still different after this function.
 */
export function normalizeNameForComparison(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** True only when both names are identical under `normalizeNameForComparison` -- never a fuzzy/partial match. */
export function namesMatchStrictly(a: string, b: string): boolean {
  return normalizeNameForComparison(a) === normalizeNameForComparison(b);
}

/* ==================================================================== */
/* 3. Transport-value derivation                                         */
/* ==================================================================== */

export const SELLER_COUNT_ONE_SELLER_VALUE = "One Seller" as const;
export const SELLER_COUNT_TWO_SELLERS_VALUE = "Two Sellers" as const;

export function sellerCountTransportValue(model: SellerSigningModel): typeof SELLER_COUNT_ONE_SELLER_VALUE | typeof SELLER_COUNT_TWO_SELLERS_VALUE {
  return model.kind === "one_seller" ? SELLER_COUNT_ONE_SELLER_VALUE : SELLER_COUNT_TWO_SELLERS_VALUE;
}

/* ==================================================================== */
/* 4. Individually distinct pre-draft gates (fifteen)                    */
/* ==================================================================== */

/** Gate 1: seller-count discriminator unresolved/not-applicable. */
export function checkSellerCountResolved(disposition: SellerSigningModelDisposition): string | null {
  if (disposition.kind === "populated") return null;
  return "The number of Sellers has not been recorded -- refusing to sync until 1 or 2 Sellers is selected.";
}

export type OpportunityContactRef = { contactId: string; contactName: string; email: string };

/**
 * Result of resolving Seller 1's identity from the Opportunity's bound
 * primary Contact. `null` input (opportunity row not found/not selected)
 * and a blank `contactId` are DISTINCT failure reasons (gates 2 and 3
 * below), never conflated.
 */
export type Seller1Resolution =
  | { ok: true; contactId: string; name: string; email: string }
  | { ok: false; reason: string };

/** Gate 3 (opportunity/row itself unavailable) and Gate 2 (no bound Contact) and Gate 4 (name/email missing or invalid) -- see `resolveSeller1FromOpportunity` below, which is the single source of this result. */
export function checkSeller1Resolved(resolution: Seller1Resolution): string | null {
  return resolution.ok ? null : resolution.reason;
}

/** Gates 5/10 (capacity unresolved) and 6/11 (unsupported capacity) -- shared by Seller 1 and Seller 2, parameterized by a human-readable label so the two never produce identical, ambiguous messages. */
export function checkSigningCapacity(capacity: SigningCapacityDisposition, sellerLabel: string): string | null {
  if (capacity === "individual_own_capacity") return null;
  if (capacity === "unresolved") return `Confirm ${sellerLabel}'s signing capacity before requesting a draft.`;
  return `${sellerLabel}'s capacity is not supported by the natural-person-only V1 model (entity, trust, trustee, POA, estate, or representative capacity) -- refusing draft readiness.`;
}

/** Gate 7: Two-Seller selection with a missing Seller 2 legal name. */
export function checkSeller2LegalName(legalName: string): string | null {
  return legalName.trim() === "" ? "Seller 2's legal name is required." : null;
}

/** Gate 8: Seller 2 email missing or not a valid format. */
export function checkSeller2EmailFormat(email: string): string | null {
  const trimmed = email.trim();
  if (trimmed === "") return "Seller 2's email is required.";
  if (!isValidEmailFormat(trimmed)) return "Seller 2's email is not a valid email address.";
  return null;
}

/** Gate 9: Seller 2's normalized email must differ from Seller 1's normalized email. Both sides normalized identically before comparison. */
export function checkSellerEmailsDistinct(seller1Email: string, seller2Email: string): string | null {
  if (normalizeEmail(seller1Email) === normalizeEmail(seller2Email)) {
    return "Seller 2's email must be different from Seller 1's -- they cannot share an email address.";
  }
  return null;
}

/** Gate 12: printed Seller count must agree with the discriminator. */
export function checkPrintedSellerCardinality(model: SellerSigningModel, printedCount: number): string | null {
  const expected = model.kind === "one_seller" ? 1 : 2;
  if (printedCount !== expected) {
    return `The printed contract names ${printedCount} Seller${printedCount === 1 ? "" : "s"}, but ${expected} ${expected === 1 ? "was" : "were"} selected -- refusing until these agree.`;
  }
  return null;
}

/** Gate 13 (one comparison per side): strict name agreement, no fuzzy matching. Reports both values verbatim on disagreement. */
export function checkPrintedSellerNameMatch(sellerLabel: string, resolvedOrTypedName: string, printedName: string | null): string | null {
  const printed = printedName ?? "";
  if (!namesMatchStrictly(resolvedOrTypedName, printed)) {
    return `${sellerLabel}'s name ("${resolvedOrTypedName}") does not match the printed contract's Seller name ("${printed}") -- punctuation, middle names, suffixes, and abbreviations are not treated as matches. Correct one or the other.`;
  }
  return null;
}

/** Gate 14: the Seller Count GHL field is not yet provisioned (still sentinel). Sentinel value is passed in, never hardcoded here, so this module stays free of a `shared/` dependency. */
export function checkSellerCountFieldProvisioned(fieldId: string, sentinelValue: string): string | null {
  if (!fieldId || fieldId.trim() === "" || fieldId === sentinelValue) {
    return "The Contract Seller Count GHL field is not yet provisioned -- refusing to sync until it is created and wired.";
  }
  return null;
}

/** Gate 15: even once provisioned, a write+readback must be verified before this phase's own transport claim can be trusted. In Phase 1, no write ever occurs, so this is always `false` and this gate always fires alongside (or instead of) gate 14. */
export function checkSellerCountWriteReadbackVerified(verified: boolean): string | null {
  return verified ? null : "The Contract Seller Count field's write has not been confirmed by a fresh readback -- refusing to sync.";
}

/* ==================================================================== */
/* 5. Aggregator -- ALL applicable reasons, never just the first          */
/* ==================================================================== */

export type SellerSigningReadinessInput = {
  disposition: SellerSigningModelDisposition;
  seller1: Seller1Resolution;
  /** `{displayName}[]` -- the existing `parties.sellerSigners` printed-identity array, narrowed to the one field this module compares against. */
  printedSellerSigners: { displayName: string | null }[];
  sellerCountFieldId: string;
  sellerCountFieldSentinel: string;
  sellerCountWriteReadbackVerified: boolean;
};

/**
 * The one entry point a future integration (Phase 4+, NOT this phase) would
 * call from `buildContractProjectionPlan`/`contract-draft-request-model.ts`.
 * Accumulates every applicable reason from gates 1-15 -- an operator sees
 * everything blocking Requested in one pass, not one error at a time.
 * Gates that depend on `two_sellers` (7-11, and Seller 2's half of 13) are
 * skipped entirely for `one_seller` -- per the locked rule, One-Seller
 * renders/produces NO Seller 2 warnings of any kind.
 */
export function evaluateSellerSigningReadiness(input: SellerSigningReadinessInput): { ok: true } | { ok: false; reasons: string[] } {
  const reasons: string[] = [];

  const countReason = checkSellerCountResolved(input.disposition);
  if (countReason) reasons.push(countReason);

  const seller1Reason = checkSeller1Resolved(input.seller1);
  if (seller1Reason) reasons.push(seller1Reason);

  // Everything below requires a resolved cardinality AND a resolved Seller 1
  // to evaluate meaningfully -- if either is missing, stop accumulating
  // further gates that would need data that does not exist (their absence
  // is already fully explained by the two reasons above).
  if (input.disposition.kind !== "populated" || !input.seller1.ok) {
    return { ok: false, reasons };
  }

  const model = input.disposition.value;
  const seller1 = input.seller1;

  const seller1CapacityReason = checkSigningCapacity(model.seller1Capacity, "Seller 1");
  if (seller1CapacityReason) reasons.push(seller1CapacityReason);

  if (model.kind === "two_sellers") {
    const nameReason = checkSeller2LegalName(model.seller2.legalName);
    if (nameReason) reasons.push(nameReason);

    const emailFormatReason = checkSeller2EmailFormat(model.seller2.email);
    if (emailFormatReason) reasons.push(emailFormatReason);

    if (!emailFormatReason) {
      const dupReason = checkSellerEmailsDistinct(seller1.email, model.seller2.email);
      if (dupReason) reasons.push(dupReason);
    }

    const seller2CapacityReason = checkSigningCapacity(model.seller2Capacity, "Seller 2");
    if (seller2CapacityReason) reasons.push(seller2CapacityReason);
  }

  const cardinalityReason = checkPrintedSellerCardinality(model, input.printedSellerSigners.length);
  if (cardinalityReason) {
    reasons.push(cardinalityReason);
  } else {
    // Only meaningful to compare individual names once the count itself agrees.
    const seller1NameReason = checkPrintedSellerNameMatch("Seller 1", seller1.name, input.printedSellerSigners[0]?.displayName ?? null);
    if (seller1NameReason) reasons.push(seller1NameReason);

    if (model.kind === "two_sellers") {
      const seller2NameReason = checkPrintedSellerNameMatch("Seller 2", model.seller2.legalName, input.printedSellerSigners[1]?.displayName ?? null);
      if (seller2NameReason) reasons.push(seller2NameReason);
    }
  }

  const fieldReason = checkSellerCountFieldProvisioned(input.sellerCountFieldId, input.sellerCountFieldSentinel);
  if (fieldReason) reasons.push(fieldReason);

  const readbackReason = checkSellerCountWriteReadbackVerified(input.sellerCountWriteReadbackVerified);
  if (readbackReason) reasons.push(readbackReason);

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

/* ==================================================================== */
/* 6. Seller 1 resolution -- pure, operates on ALREADY-FETCHED data       */
/* ==================================================================== */

/**
 * PURE -- makes no network call itself. `ContractWorkspace.tsx` already
 * fetches every Opportunity for the current Contact via the existing
 * `ghl.opportunities.listPipeline()` / `opportunitiesForContact()` path
 * (see `app/src/lib/underwriting/selectOpportunity.ts`), and `OpportunityRow`
 * (`ghl.ts`) already carries `contactId`/`contactName`/`email` on every row
 * -- populated server-side by the existing `ghl-opportunities` function.
 * This function's ENTIRE job is validating that ALREADY-FETCHED data, never
 * fetching anything new -- "the smallest reusable resolver necessary,"
 * genuinely smallest, since no new GHL API surface is introduced at all.
 *
 * `opportunity: null` means the caller could not find/select a matching
 * Opportunity row at all (distinct failure from "found the row, but it has
 * no bound Contact").
 */
export function resolveSeller1FromOpportunity(opportunity: OpportunityContactRef | null): Seller1Resolution {
  if (!opportunity) {
    return { ok: false, reason: "The selected Opportunity could not be found -- Seller 1 cannot be identified." };
  }
  const contactId = (opportunity.contactId ?? "").trim();
  if (contactId === "") {
    return { ok: false, reason: "No primary Contact is bound to this Opportunity -- Seller 1 cannot be identified." };
  }
  const name = (opportunity.contactName ?? "").trim();
  if (name === "") {
    return { ok: false, reason: "The primary Contact's name is missing -- required for Seller 1." };
  }
  const email = (opportunity.email ?? "").trim();
  if (email === "" || !isValidEmailFormat(email)) {
    return { ok: false, reason: "The primary Contact's email is missing or invalid -- required for Seller 1's signing request." };
  }
  return { ok: true, contactId, name, email };
}
