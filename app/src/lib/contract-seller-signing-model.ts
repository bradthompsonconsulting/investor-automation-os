/**
 * One-/Two-Seller signer-cardinality model -- INV-67 Phase 1 (this
 * session), per Brad/Jess's final-gated planning rounds. EXTENDED by the
 * Phase 1 Jess re-gate correction (this session): the live readiness gate
 * is now WIRED into `contract-ghl-projection-model.ts`'s
 * `buildContractProjectionPlan` -- see `evaluateSellerSigningPreWriteReadiness`
 * and `buildSellerSigningAuditEvidence` below.
 *
 * Pure. No I/O, no React, no GHL identifiers, no writes -- with ONE
 * explicit, clearly-marked exception at the bottom of this file
 * (`resolveSeller1FromOpportunity` is still pure/no-I/O itself, but
 * documents the network boundary it sits just inside of; see that
 * function's own doc comment).
 *
 * SCOPE OF THIS FILE:
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
 *   - (Re-gate correction, this session) `evaluateSellerSigningCanonicalReadiness`
 *     / `evaluateSellerSigningTransportReadiness` / `evaluateSellerSigningPreWriteReadiness`
 *     -- the exact split `buildContractProjectionPlan` and the opportunity-
 *     scoped audit evidence require between "the seller model itself is
 *     ready" (gates 1-13) and "the Seller Count transport field is ready"
 *     (gates 14-15), and `buildSellerSigningAuditEvidence`, the ONE pure
 *     builder for the evidence blob `contract-draft-request-model.ts`'s
 *     two-phase ledger now carries -- so this "no readiness logic in the
 *     interface" doctrine (see `ContractWorkspace.tsx`'s own header) holds
 *     for the seller-signing concern exactly like every other fact group.
 *
 * STILL OUT OF SCOPE THIS PHASE (Brad's own list, unchanged): live GHL
 * field creation, workflow/template mutation, draft creation, sending, the
 * Two-Seller template, and the final draft-bound recipient-confirmation
 * gate. The gate below enforces fail-closed behavior against the CURRENT
 * sentinel-filled `contractSellerCountField` -- it does not, and cannot,
 * make a live write succeed until that field is separately provisioned and
 * wired by a later, explicitly authorized session.
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

/** Named so callers across module boundaries (`contract-ghl-projection-model.ts`, `contract-draft-request-model.ts`) share ONE result shape, never a second, independently-typed copy. */
export type SellerSigningReadinessResult = { ok: true } | { ok: false; reasons: string[] };

/**
 * PHASE 1 RE-GATE CORRECTION (this session, Jess Gate). This IS now the
 * live entry point `contract-ghl-projection-model.ts`'s
 * `buildContractProjectionPlan` folds into its own `blockingReasons` --
 * see `evaluateSellerSigningPreWriteReadiness` below for the exact pre-
 * write variant that call site actually uses (gate 15 cannot be evaluated
 * before a write is attempted; see that function's own doc comment).
 * Accumulates every applicable reason from gates 1-15 -- an operator sees
 * everything blocking Requested in one pass, not one error at a time.
 * Gates that depend on `two_sellers` (7-11, and Seller 2's half of 13) are
 * skipped entirely for `one_seller` -- per the locked rule, One-Seller
 * renders/produces NO Seller 2 warnings of any kind.
 */
export function evaluateSellerSigningReadiness(input: SellerSigningReadinessInput): SellerSigningReadinessResult {
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

/* ==================================================================== */
/* 7. Live-gate wiring -- canonical vs. transport, and the pre-write gate */
/*    (Jess re-gate correction, this session)                            */
/* ==================================================================== */

/**
 * Gates 1-13 only -- whether the seller MODEL ITSELF (cardinality, Seller 1,
 * capacity, printed-party consistency) is ready, independent of the Seller
 * Count GHL field's own provisioning/write state. Implemented by
 * re-invoking the SAME, UNMODIFIED `evaluateSellerSigningReadiness` with the
 * transport half of its input forced to a passing state -- never a second,
 * independently-maintained copy of gates 1-13's own logic. Used ONLY for
 * audit-evidence transparency (Brad's ruling: "distinguish canonical
 * readiness from transport readiness"); the live blocking decision is
 * `evaluateSellerSigningPreWriteReadiness` below, not this function.
 */
export function evaluateSellerSigningCanonicalReadiness(
  input: SellerSigningReadinessInput,
): SellerSigningReadinessResult {
  return evaluateSellerSigningReadiness({
    ...input,
    sellerCountFieldId: `${input.sellerCountFieldSentinel}-canonical-probe`,
    sellerCountWriteReadbackVerified: true,
  });
}

/**
 * Gates 14-15 only -- whether the Seller Count GHL field itself is ready:
 * provisioned (14), and, once a write has actually been attempted this
 * cycle, confirmed by readback (15). Independent of the seller model's own
 * canonical state.
 */
export function evaluateSellerSigningTransportReadiness(
  input: Pick<SellerSigningReadinessInput, "sellerCountFieldId" | "sellerCountFieldSentinel" | "sellerCountWriteReadbackVerified">,
): SellerSigningReadinessResult {
  const reasons: string[] = [];
  const fieldReason = checkSellerCountFieldProvisioned(input.sellerCountFieldId, input.sellerCountFieldSentinel);
  if (fieldReason) reasons.push(fieldReason);
  const readbackReason = checkSellerCountWriteReadbackVerified(input.sellerCountWriteReadbackVerified);
  if (readbackReason) reasons.push(readbackReason);
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

/**
 * THE live pre-write gate. `contract-ghl-projection-model.ts`'s
 * `buildContractProjectionPlan` folds this result's reasons into its own
 * `blockingReasons`, BEFORE any GHL write of any kind (the 112 TREC
 * projection fields, the Seller Count field, or the Contract Draft Request
 * transition) is ever attempted -- see that module's own doc comment.
 *
 * Covers gates 1-14 (the full model plus "is the Seller Count field
 * provisioned"). Gate 15 ("was THIS write's own readback confirmed")
 * cannot be evaluated before a write has been attempted at all -- it is
 * probed here as satisfied (never actually checked at this call site) and
 * is instead enforced SEPARATELY, POST-write, via the exact same
 * `allEntriesLanded` mechanism every other projection field already uses
 * (`ghl.ts`'s `syncContractProjectionFields` now folds the Seller Count
 * entry's own landed/not-landed result into that SAME boolean --
 * `contract-draft-request-model.ts`'s `evaluateContractDraftRequestTransition`
 * therefore already refuses "Requested" on a failed Seller-Count write
 * without any change to that module at all). This is not a weaker
 * guarantee than gate 15 -- it is the SAME guarantee, enforced at the
 * pipeline stage where it is actually knowable, never a second competing
 * gate for the same concern.
 */
export function evaluateSellerSigningPreWriteReadiness(
  input: SellerSigningReadinessInput,
): SellerSigningReadinessResult {
  return evaluateSellerSigningReadiness({ ...input, sellerCountWriteReadbackVerified: true });
}

/* ==================================================================== */
/* 8. Opportunity-scoped audit evidence (Jess re-gate correction)        */
/* ==================================================================== */

/**
 * Extends the EXISTING opportunity-scoped, two-phase Contract Draft
 * Request evidence (`contract-draft-request-model.ts`'s
 * `ContractDraftRequestSyncRecord`) -- never a second, global, or
 * independently-scoped audit system. One blob, JSON-encoded into that
 * ledger's own "Seller signing evidence" positional field (see
 * `contract-projection-sync-carriers.ts`).
 *
 * `canonicalReadinessOk` and `sellerCountFieldProvisioned` are recorded as
 * SEPARATE booleans specifically so a reader can never mistake "the seller
 * model itself is fully ready" for "therefore nothing is blocking" when the
 * transport sentinel is the only thing still refusing -- Brad's own ruling:
 * "Do not log a successful readiness result when the transport sentinel
 * blocks it; distinguish canonical readiness from transport readiness."
 *
 * `effectiveDateStatus` and `recipientAssignmentStatus` are FIXED literals,
 * never derived -- this phase performs no Effective Date or recipient-
 * routing work of any kind (see this module's own header); they are
 * recorded here only so the evidence record is honest about what those two
 * concerns' status is AT THE TIME of this attempt, matching Brad's exact
 * audit-evidence list. `sendOccurred` is always `false` -- no send path
 * exists anywhere in this codebase for a contract draft.
 */
export type SellerSigningAuditEvidence = {
  sellerCountDiscriminator: "one_seller" | "two_sellers" | "unresolved";
  seller1Ok: boolean;
  seller1ContactId: string | null;
  seller1Capacity: SigningCapacityDisposition | null;
  seller2LegalName: string | null;
  seller2NormalizedEmail: string | null;
  seller2Capacity: SigningCapacityDisposition | null;
  printedPartyConsistencyOk: boolean;
  expectedSellerCountTransportValue: typeof SELLER_COUNT_ONE_SELLER_VALUE | typeof SELLER_COUNT_TWO_SELLERS_VALUE | null;
  canonicalReadinessOk: boolean;
  sellerCountFieldProvisioned: boolean;
  /** `null` = no write was attempted this cycle yet (e.g. the pre-write gate itself already refused). Populated once `syncContractProjectionFields` has actually run with a Seller Count entry included. */
  sellerCountWriteReadbackOk: boolean | null;
  effectiveDateStatus: "pending_final_acceptance";
  recipientAssignmentStatus: "pending_manual_review";
  blockingReasons: string[];
  sendOccurred: false;
};

const SELLER_SIGNING_AUDIT_EVIDENCE_KEYS = [
  "sellerCountDiscriminator", "seller1Ok", "seller1ContactId", "seller1Capacity",
  "seller2LegalName", "seller2NormalizedEmail", "seller2Capacity",
  "printedPartyConsistencyOk", "expectedSellerCountTransportValue",
  "canonicalReadinessOk", "sellerCountFieldProvisioned", "sellerCountWriteReadbackOk",
  "effectiveDateStatus", "recipientAssignmentStatus", "blockingReasons", "sendOccurred",
] as const;

function isOptionalSigningCapacityDisposition(v: unknown): v is SigningCapacityDisposition | null {
  return v === null || v === "individual_own_capacity" || v === "unsupported_capacity" || v === "unresolved";
}

/**
 * Exact-keys, exact-shape validator for the JSON-encoded evidence blob --
 * mirrors `seller-contract-facts-carriers.ts`'s own `validateSellerSigningModelValue`
 * pattern exactly. Consumed by `contract-projection-sync-carriers.ts`'s
 * note parser -- kept HERE, beside the type it validates, rather than
 * duplicated in the carrier file.
 */
export function validateSellerSigningAuditEvidenceValue(v: unknown): SellerSigningAuditEvidence | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== SELLER_SIGNING_AUDIT_EVIDENCE_KEYS.length || !SELLER_SIGNING_AUDIT_EVIDENCE_KEYS.every((k) => keys.includes(k))) return null;

  if (o.sellerCountDiscriminator !== "one_seller" && o.sellerCountDiscriminator !== "two_sellers" && o.sellerCountDiscriminator !== "unresolved") return null;
  if (typeof o.seller1Ok !== "boolean") return null;
  if (o.seller1ContactId !== null && typeof o.seller1ContactId !== "string") return null;
  if (!isOptionalSigningCapacityDisposition(o.seller1Capacity)) return null;
  if (o.seller2LegalName !== null && typeof o.seller2LegalName !== "string") return null;
  if (o.seller2NormalizedEmail !== null && typeof o.seller2NormalizedEmail !== "string") return null;
  if (!isOptionalSigningCapacityDisposition(o.seller2Capacity)) return null;
  if (typeof o.printedPartyConsistencyOk !== "boolean") return null;
  if (
    o.expectedSellerCountTransportValue !== null &&
    o.expectedSellerCountTransportValue !== SELLER_COUNT_ONE_SELLER_VALUE &&
    o.expectedSellerCountTransportValue !== SELLER_COUNT_TWO_SELLERS_VALUE
  ) return null;
  if (typeof o.canonicalReadinessOk !== "boolean") return null;
  if (typeof o.sellerCountFieldProvisioned !== "boolean") return null;
  if (o.sellerCountWriteReadbackOk !== null && typeof o.sellerCountWriteReadbackOk !== "boolean") return null;
  if (o.effectiveDateStatus !== "pending_final_acceptance") return null;
  if (o.recipientAssignmentStatus !== "pending_manual_review") return null;
  if (!Array.isArray(o.blockingReasons) || !o.blockingReasons.every((r) => typeof r === "string")) return null;
  if (o.sendOccurred !== false) return null;

  return {
    sellerCountDiscriminator: o.sellerCountDiscriminator,
    seller1Ok: o.seller1Ok,
    seller1ContactId: o.seller1ContactId as string | null,
    seller1Capacity: o.seller1Capacity as SigningCapacityDisposition | null,
    seller2LegalName: o.seller2LegalName as string | null,
    seller2NormalizedEmail: o.seller2NormalizedEmail as string | null,
    seller2Capacity: o.seller2Capacity as SigningCapacityDisposition | null,
    printedPartyConsistencyOk: o.printedPartyConsistencyOk,
    expectedSellerCountTransportValue: o.expectedSellerCountTransportValue as SellerSigningAuditEvidence["expectedSellerCountTransportValue"],
    canonicalReadinessOk: o.canonicalReadinessOk,
    sellerCountFieldProvisioned: o.sellerCountFieldProvisioned,
    sellerCountWriteReadbackOk: o.sellerCountWriteReadbackOk as boolean | null,
    effectiveDateStatus: "pending_final_acceptance",
    recipientAssignmentStatus: "pending_manual_review",
    blockingReasons: o.blockingReasons as string[],
    sendOccurred: false,
  };
}

export type BuildSellerSigningAuditEvidenceArgs = Omit<SellerSigningReadinessInput, "sellerCountWriteReadbackVerified"> & {
  /** `null` before any write has been attempted this cycle -- see `SellerSigningAuditEvidence.sellerCountWriteReadbackOk`. */
  sellerCountWriteReadbackOk: boolean | null;
};

/**
 * THE one pure builder for the evidence blob -- called ONCE per sync
 * attempt (immediately after the projection write, whether or not a
 * Seller Count entry was included in it), its result carried forward
 * UNCHANGED from the attempt note to the resolution note, exactly like
 * this ledger's existing `currentOfferCrossCheckOk` field already is.
 */
export function buildSellerSigningAuditEvidence(args: BuildSellerSigningAuditEvidenceArgs): SellerSigningAuditEvidence {
  const model = args.disposition.kind === "populated" ? args.disposition.value : null;

  const canonical = evaluateSellerSigningCanonicalReadiness({ ...args, sellerCountWriteReadbackVerified: true });
  const fullReadiness = evaluateSellerSigningReadiness({
    ...args,
    sellerCountWriteReadbackVerified: args.sellerCountWriteReadbackOk ?? false,
  });

  let printedPartyConsistencyOk = false;
  if (model) {
    const cardinalityReason = checkPrintedSellerCardinality(model, args.printedSellerSigners.length);
    if (!cardinalityReason) {
      const seller1NameReason = checkPrintedSellerNameMatch(
        "Seller 1",
        args.seller1.ok ? args.seller1.name : "",
        args.printedSellerSigners[0]?.displayName ?? null,
      );
      const seller2NameReason =
        model.kind === "two_sellers"
          ? checkPrintedSellerNameMatch("Seller 2", model.seller2.legalName, args.printedSellerSigners[1]?.displayName ?? null)
          : null;
      printedPartyConsistencyOk = !seller1NameReason && !seller2NameReason;
    }
  }

  return {
    sellerCountDiscriminator: model ? model.kind : "unresolved",
    seller1Ok: args.seller1.ok,
    seller1ContactId: args.seller1.ok ? args.seller1.contactId : null,
    seller1Capacity: model ? model.seller1Capacity : null,
    seller2LegalName: model && model.kind === "two_sellers" ? model.seller2.legalName : null,
    seller2NormalizedEmail: model && model.kind === "two_sellers" ? normalizeEmail(model.seller2.email) : null,
    seller2Capacity: model && model.kind === "two_sellers" ? model.seller2Capacity : null,
    printedPartyConsistencyOk,
    expectedSellerCountTransportValue: model ? sellerCountTransportValue(model) : null,
    canonicalReadinessOk: canonical.ok,
    sellerCountFieldProvisioned: checkSellerCountFieldProvisioned(args.sellerCountFieldId, args.sellerCountFieldSentinel) === null,
    sellerCountWriteReadbackOk: args.sellerCountWriteReadbackOk,
    effectiveDateStatus: "pending_final_acceptance",
    recipientAssignmentStatus: "pending_manual_review",
    blockingReasons: fullReadiness.ok ? [] : fullReadiness.reasons,
    sendOccurred: false,
  };
}
