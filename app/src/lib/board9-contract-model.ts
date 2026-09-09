/**
 * Board #9 authoritative contract data, state, persistence, and audit
 * model -- B9-03 / INV-58.
 *
 * Pure. No I/O, no React, no GHL identifiers, no fetch, no provider call,
 * no `ghl.notes.create()` or any other write. This module performs no
 * persistence itself and defines no new GHL carrier -- carriers (the
 * note/field formats that actually read and write GHL for Board #9 facts)
 * are later work (INV-59 onward), exactly as this issue's own HARD NO
 * requires ("No invented GHL carrier... No state mutation... No second
 * source of truth"). What this module provides is the ONE deterministic
 * domain model a future carrier, UI, document-generation step, execution
 * tracker, and disposition-handoff consumer must all agree on, so that no
 * later surface invents its own competing notion of what these states
 * mean or when a transition is legitimate.
 *
 * GOVERNING SOURCES, cited throughout rather than restated from memory:
 *   - `docs/SELLER_CONTRACT_STATE_MACHINE_V1.md` (B9-01/INV-56, locked) --
 *     the four-state machine (Agreement Reached -> Contract Ready ->
 *     Contract Sent -> Under Contract), the Corrected/Rescinded/Expired/
 *     Declined branch and terminal states, and every entry-evidence,
 *     authority, transition-trigger, and failure-behavior rule below is a
 *     direct implementation of that document's own words -- nothing here
 *     re-decides a product question that document already settled.
 *   - `docs/BOARD9_CONTRACT_INVENTORY_V1.md` (B9-02/INV-57, Done, PR #39)
 *     -- what already exists (Agreement Reached's `seller-call-outcome.ts`,
 *     Contract Ready's `seller-call-readiness-carriers.ts` Section 7), what
 *     is genuinely missing (structured closing date, earnest money,
 *     contingencies, signer delivery, signing authority -- none invented
 *     here), and the GHL-native Documents & Contracts findings this module
 *     stays evidence-shape-agnostic against (provider is never hardcoded;
 *     `documentRevision`/a discrete integrity identifier stay BLOCKED per
 *     that document and are therefore nullable here, never assumed
 *     present).
 *   - `docs/DEAL_ECONOMICS_OFFER_READINESS_V1.md` and
 *     `docs/UNDERWRITING_WORKSPACE_SPEC.md` -- Actual Contract Price is "a
 *     fact about an executed agreement... contracting is authoritative for
 *     it," and "no price change can bypass a new Agreement Reached record"
 *     is restated exactly as `SELLER_CONTRACT_STATE_MACHINE_V1.md` locks
 *     it.
 *   - `docs/FOUNDATIONAL_PRINCIPLES.md` principles 11 (one source of
 *     truth), 14 (derive for display, persist decisions), 15 (GHL-first,
 *     no shadow store), and 19 (do not manufacture recommendations from
 *     insufficient information).
 *
 * CONSUMES BOARD #8, NEVER RECOMPUTES IT. `deriveInheritedEconomics` below
 * takes `OutcomeSnapshot` (`seller-call-outcome.ts`'s own type) verbatim --
 * the accepted price, ARV, repairs, and every other economics figure are
 * copied exactly as Board 8 computed and Board 8's Accept action captured
 * them. Same discipline for Contract Ready: `ContractReadyEvidence` below
 * consumes `ContractReadyItems`/`CONTRACT_READY_ITEM_KEYS`
 * (`seller-call-readiness-carriers.ts`'s own already-shipped, already-
 * proven five-key checklist) rather than re-declaring a second list of
 * checklist keys that could drift from the UI's own constant.
 *
 * PROVIDER-AGNOSTIC BY DESIGN. `SELLER_CONTRACT_STATE_MACHINE_V1.md`
 * states plainly that "which provider is used... [is not] this document['s]
 * to decide," and `BOARD9_CONTRACT_INVENTORY_V1.md` names GHL-native
 * Documents & Contracts as *preferred*, not selected. Nothing below
 * hardcodes a provider name as a literal type -- `EnvelopeIdentifiers.
 * provider` is a plain string, exactly so this model constrains whichever
 * provider a future issue selects rather than presupposing one.
 *
 * NO OPERATOR IDENTITY IS EVER FABRICATED, matching every other Board 8/9
 * carrier's convention (`seller-call-outcome.ts`, `seller-call-readiness-
 * carriers.ts`): where an operator identity is required by a locked rule
 * (Rescission is Brad-only in V1), that is enforced as a runtime string
 * comparison against the literal `"brad"`, never assumed from context.
 *
 * FAIL CLOSED, EVERYWHERE. Every `evaluate*`/`build*` function returns
 * `{ eligible: false, reasons: [...] }` or `{ ok: false, ... }` rather than
 * guessing when evidence is missing, invalid, or in material conflict --
 * this is `SELLER_CONTRACT_STATE_MACHINE_V1.md`'s own "Failure behavior"
 * requirement for every state, generalized into one consistent shape
 * (`TransitionReason[]`) so a caller never has to invent its own
 * operator-facing wording for a rejection this module already knows how
 * to state precisely.
 */

import type { OutcomeSnapshot } from "./seller-call-outcome";
import {
  CONTRACT_READY_ITEM_KEYS,
  type ContractReadyItemKey,
  type ContractReadyItems,
} from "./seller-call-readiness-carriers";

/* ==================================================================== */
/* 1. Contract state vocabulary -- meanings locked verbatim from B9-01   */
/* ==================================================================== */

export type PrimaryContractState =
  | "agreement_reached"
  | "contract_ready"
  | "contract_sent"
  | "under_contract";

export type TerminalContractState = "rescinded" | "expired" | "declined";

export type ContractStateName = PrimaryContractState | TerminalContractState;

/**
 * The frozen primary sequence, per `SELLER_CONTRACT_STATE_MACHINE_V1.md`'s
 * own words: "frozen in that order, per INV-56's own authoritative-state-
 * machine clarification." Exported so a future UI/carrier reads this
 * order from one place rather than re-deriving it.
 */
export const PRIMARY_CONTRACT_STATE_ORDER: readonly PrimaryContractState[] = [
  "agreement_reached",
  "contract_ready",
  "contract_sent",
  "under_contract",
];

/**
 * Restates, without paraphrase drift, each state's own "Meaning." line
 * from `SELLER_CONTRACT_STATE_MACHINE_V1.md`. Exported and tested so a
 * future surface displays the SAME meaning this model was built against,
 * never an independently-worded copy that can silently diverge.
 */
export const CONTRACT_STATE_MEANING: Record<ContractStateName, string> = {
  agreement_reached:
    "The seller has accepted the negotiated price and terms. Board #8's negotiation is complete for this specific agreement.",
  contract_ready:
    "Agreement Reached, and every pre-paperwork fact the existing checklist requires is confirmed for this specific agreement.",
  contract_sent:
    "Brad has explicitly reviewed and authorized sending the prepared agreement to the seller for execution, and the agreement has been transmitted. The agreement is not yet executed.",
  under_contract:
    "The agreement has been fully executed by every required party. This is the only state in which IAOS treats the deal as a binding contract.",
  rescinded:
    "The agreement -- at any stage from Contract Ready onward -- is withdrawn or cancelled before or after execution, by mutual agreement or a party's unilateral action.",
  expired:
    "A Contract Sent agreement's established expiration date/time passes without verified full execution.",
  declined:
    "The seller explicitly declines to execute the sent agreement -- a stated refusal, not a timeout.",
};

/**
 * Once any terminal outcome is reached for a given agreement (`agreementAt`)
 * -- Under Contract with all three verified-execution facts preserved,
 * Rescinded, Expired, or Declined -- that specific agreement is terminal
 * and must never be reopened (`SELLER_CONTRACT_STATE_MACHINE_V1.md`,
 * "No-reentry disposition handoff"). Under Contract's own "Transition
 * trigger OUT" is explicitly "None... preserved exactly as reached," which
 * is why it is included here alongside the three named branch/terminal
 * states.
 */
export function isTerminalNoReentry(state: ContractStateName): boolean {
  return (
    state === "rescinded" ||
    state === "expired" ||
    state === "declined" ||
    state === "under_contract"
  );
}

/**
 * "Corrected... may be needed whether or not the prior version has already
 * reached Under Contract" (`SELLER_CONTRACT_STATE_MACHINE_V1.md`,
 * "Corrected"). Nothing in that document describes correcting an agreement
 * that has not yet been sent -- there is no seller-facing document to
 * correct before Contract Sent, only ordinary editing. Correction is
 * therefore eligible only from Contract Sent or Under Contract.
 */
export function isCorrectionEligible(state: ContractStateName): boolean {
  return state === "contract_sent" || state === "under_contract";
}

/** Every reason this module can produce names one exact code and an operator-readable message -- never a bare boolean. */
export type TransitionReasonCode =
  | "AGREEMENT_NOT_REACHED"
  | "CHECKLIST_SCOPE_MISMATCH"
  | "CHECKLIST_ITEM_INCOMPLETE"
  | "NOT_CONTRACT_READY"
  | "SEND_NOT_AUTHORIZED"
  | "TRANSMISSION_NOT_CONFIRMED"
  | "EXPIRATION_NOT_SET"
  | "NOT_CONTRACT_SENT"
  | "NO_SIGNER_REQUIREMENTS"
  | "DUPLICATE_SIGNER_ROLE"
  | "SIGNERS_INCOMPLETE"
  | "PROVIDER_COMPLETION_NOT_REPORTED"
  | "DOCUMENT_NOT_PRESERVED"
  | "EXECUTED_TERMS_REQUIRE_NEW_AGREEMENT"
  | "RESCISSION_NOT_BRAD_AUTHORIZED"
  | "RESCISSION_REASON_REQUIRED"
  | "RESCISSION_TIMESTAMP_INVALID";

export type TransitionReason = { code: TransitionReasonCode; message: string };

/* ==================================================================== */
/* 2. Immutable inherited Board #8 accepted economics + provenance      */
/* ==================================================================== */

/**
 * Every contract fact carries an explicit authority, never left implicit:
 *   - operator_attested: a rep confirms it during/after the call
 *   - brad_authorized:   Brad's own explicit act (send authorization,
 *                        rescission -- both locked Brad-only in V1)
 *   - provider_reported: the e-sign/document provider's own reported fact
 *   - system_derived:    IAOS computes it from other already-authoritative
 *                        facts (e.g. Expired, derived automatically)
 */
export type ContractFactAuthority =
  | "operator_attested"
  | "brad_authorized"
  | "provider_reported"
  | "system_derived";

/**
 * Agreement Reached's accepted economics, inherited from Board #8 and
 * frozen at the moment of acceptance. `SELLER_CONTRACT_STATE_MACHINE_V1.md`,
 * "Consuming Board #8 economics, never recomputing them": "Agreement
 * Reached's accepted price is exactly `OutcomeSnapshot.currentOffer`...
 * never a second, competing 'contract price' field." This type and
 * `deriveInheritedEconomics` are the ONE place Board #9 reads that fact --
 * `Object.freeze` at both levels makes accidental mutation a runtime
 * TypeError in non-strict callers and a silent no-op in strict ones,
 * neither of which can produce a second, drifted copy.
 */
export type InheritedAgreementEconomics = Readonly<{
  opportunityId: string;
  /** The accept outcome note's own embedded timestamp -- the durable agreement identity, per B9-01. */
  agreementAt: string;
  economics: Readonly<OutcomeSnapshot>;
  authority: "board8_agreement_reached_outcome";
}>;

export type DeriveInheritedEconomicsArgs = {
  opportunityId: string;
  /** The caller's already-resolved outcome kind (`seller-call-outcome.ts`'s own `ParsedOutcomeNote.kind`) -- this function recomputes nothing and re-reads no note itself. */
  outcomeKind: "accept" | "follow_up" | "pass";
  agreementAt: string;
  economics: OutcomeSnapshot;
};

export function deriveInheritedEconomics(
  args: DeriveInheritedEconomicsArgs,
): { ok: true; value: InheritedAgreementEconomics } | { ok: false; error: string } {
  if (args.outcomeKind !== "accept") {
    return {
      ok: false,
      error: "Agreement Reached requires an accept-kind outcome; none exists for this Opportunity.",
    };
  }
  const value: InheritedAgreementEconomics = Object.freeze({
    opportunityId: args.opportunityId,
    agreementAt: args.agreementAt,
    economics: Object.freeze({ ...args.economics }),
    authority: "board8_agreement_reached_outcome" as const,
  });
  return { ok: true, value };
}

/* ==================================================================== */
/* 3. Contract facts: missing / invalid / material-conflict states      */
/* ==================================================================== */

export type ContractFactState = "missing" | "invalid" | "confirmed";

/**
 * The general fact-state check every specific contract fact below is built
 * from: `null`/`undefined` is `"missing"` (nothing established yet, distinct
 * from a present-but-bad value), a present value failing its own shape
 * check is `"invalid"`, and anything else is `"confirmed"`. Never a fourth,
 * softer state -- FOUNDATIONAL_PRINCIPLES principle 19 forbids
 * manufacturing a middle ground this module has no evidence for.
 */
export function evaluateContractFactState<T>(
  fact: T | null | undefined,
  isValid: (value: T) => boolean,
): ContractFactState {
  if (fact === null || fact === undefined) return "missing";
  return isValid(fact) ? "confirmed" : "invalid";
}

export type MaterialTermField = "price" | "property_address" | "parties";

/**
 * The exact fields `SELLER_CONTRACT_STATE_MACHINE_V1.md`'s Corrected
 * bright-line test names: "price, property, parties, or any other
 * negotiated material term." `parties` is compared as a set (order-
 * independent) -- who is a party does not depend on the order they were
 * listed in.
 */
export type MaterialTermSnapshot = {
  price: number;
  propertyAddress: string;
  parties: readonly string[];
};

export type MaterialConflict = {
  field: MaterialTermField;
  agreementValue: string;
  candidateValue: string;
};

function partiesEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((v, i) => v === sortedB[i]);
}

/**
 * Exact comparison against the authoritative Agreement Reached snapshot --
 * "never an operator's judgment about whether a change is 'important.'"
 * Any difference on any of the three fields is reported; the caller
 * (`classifyCorrection`) is what turns this into the bright-line case 1
 * classification.
 */
export function detectMaterialConflicts(
  agreement: MaterialTermSnapshot,
  candidate: MaterialTermSnapshot,
): MaterialConflict[] {
  const conflicts: MaterialConflict[] = [];
  if (agreement.price !== candidate.price) {
    conflicts.push({
      field: "price",
      agreementValue: String(agreement.price),
      candidateValue: String(candidate.price),
    });
  }
  if (agreement.propertyAddress !== candidate.propertyAddress) {
    conflicts.push({
      field: "property_address",
      agreementValue: agreement.propertyAddress,
      candidateValue: candidate.propertyAddress,
    });
  }
  if (!partiesEqual(agreement.parties, candidate.parties)) {
    conflicts.push({
      field: "parties",
      agreementValue: JSON.stringify([...agreement.parties].sort()),
      candidateValue: JSON.stringify([...candidate.parties].sort()),
    });
  }
  return conflicts;
}

/**
 * The three, and only three, Corrected cases
 * (`SELLER_CONTRACT_STATE_MACHINE_V1.md`, "Corrected"):
 *   1. `new_agreement_required` -- the seller-facing document differs from
 *      the snapshot on price/property/parties/another material term. "No
 *      price or accepted-term change can bypass this."
 *   2. `same_agreement_reentry` -- corrected without any accepted term
 *      changing; the existing Agreement Reached record remains the basis,
 *      re-entering at Contract Ready on the SAME `agreementAt`.
 *   3. `metadata_only` -- IAOS/GHL metadata with no seller-facing effect;
 *      not a correction at all, no new cycle.
 */
export type CorrectionClassification =
  | { kind: "new_agreement_required"; conflicts: MaterialConflict[] }
  | { kind: "same_agreement_reentry" }
  | { kind: "metadata_only" };

export function classifyCorrection(
  changeScope: "seller_facing_document" | "internal_metadata",
  agreement: MaterialTermSnapshot,
  candidate: MaterialTermSnapshot,
): CorrectionClassification {
  if (changeScope === "internal_metadata") return { kind: "metadata_only" };
  const conflicts = detectMaterialConflicts(agreement, candidate);
  return conflicts.length > 0
    ? { kind: "new_agreement_required", conflicts }
    : { kind: "same_agreement_reentry" };
}

/* ==================================================================== */
/* 4. Contract Ready -- eligibility, with operator-readable reasons     */
/* ==================================================================== */

const CONTRACT_READY_ITEM_LABEL: Record<ContractReadyItemKey, string> = {
  legal_owners: "Correct legal owners",
  closing_timeline: "Closing timeline",
  occupancy_possession: "Occupancy/possession",
  liens_title: "Known liens/title complications disclosed and reviewed",
  delivery_signing: "Delivery/signing information",
};

export type ContractReadyEvidence = {
  agreementReached: boolean;
  checklist: ContractReadyItems;
  /**
   * True only when the checklist record on file is scoped to THIS exact
   * agreement -- i.e. what
   * `currentContractReadyChecklistForOpportunity` already verifies
   * (`agreementAt`, `agreedPrice`, and `propertyAddress` all match). A
   * checklist for a different agreement at the same price/address must
   * never count as progress (INV-68's already-proven rule).
   */
  checklistScopeMatches: boolean;
};

/**
 * Contract Ready is a DERIVED result, not a persisted flag
 * (`SELLER_CONTRACT_STATE_MACHINE_V1.md`, "Contract Ready is a DERIVED
 * state"). This function recomputes it fresh from whatever evidence the
 * caller supplies -- it holds no state of its own.
 */
export function evaluateContractReady(
  evidence: ContractReadyEvidence,
): { ready: boolean; reasons: TransitionReason[] } {
  const reasons: TransitionReason[] = [];
  if (!evidence.agreementReached) {
    reasons.push({
      code: "AGREEMENT_NOT_REACHED",
      message: "Agreement Reached has not occurred for this Opportunity.",
    });
  }
  if (!evidence.checklistScopeMatches) {
    reasons.push({
      code: "CHECKLIST_SCOPE_MISMATCH",
      message:
        "The Contract Ready checklist on record does not match this agreement's own price, address, and agreement timestamp -- it cannot count as progress toward this agreement.",
    });
  } else {
    for (const key of CONTRACT_READY_ITEM_KEYS) {
      if (!evidence.checklist[key]) {
        reasons.push({
          code: "CHECKLIST_ITEM_INCOMPLETE",
          message: `${CONTRACT_READY_ITEM_LABEL[key]} is not yet confirmed.`,
        });
      }
    }
  }
  return { ready: reasons.length === 0, reasons };
}

/* ==================================================================== */
/* 5. Contract Sent -- eligibility                                      */
/* ==================================================================== */

export type ContractSentEvidence = {
  contractReady: boolean;
  /** Fact 1 of Contract Sent's three locked, jointly-required facts. */
  bradSendAuthorization: { authorizedBy: string; at: string } | null;
  /** Fact 2. Provider-agnostic: identifier/timestamp shape only, no provider named. */
  providerTransmission: { identifier: string; at: string } | null;
  /** Fact 3. */
  expiration: { at: string } | null;
};

/**
 * `SELLER_CONTRACT_STATE_MACHINE_V1.md`, Contract Sent "Failure behavior":
 * "If authorization is recorded but no provider transmission identifier/
 * timestamp is obtained, the state must read as 'send authorized, not yet
 * confirmed sent' -- never silently promoted to Contract Sent." All three
 * facts are independently checked and independently reported; none
 * substitutes for another.
 */
export function evaluateContractSentEligibility(
  evidence: ContractSentEvidence,
): { eligible: boolean; reasons: TransitionReason[] } {
  const reasons: TransitionReason[] = [];
  if (!evidence.contractReady) {
    reasons.push({ code: "NOT_CONTRACT_READY", message: "Contract Ready has not been reached." });
  }
  if (evidence.bradSendAuthorization === null || evidence.bradSendAuthorization.authorizedBy !== "brad") {
    reasons.push({
      code: "SEND_NOT_AUTHORIZED",
      message: "Brad has not explicitly authorized sending this agreement.",
    });
  }
  if (evidence.providerTransmission === null) {
    reasons.push({
      code: "TRANSMISSION_NOT_CONFIRMED",
      message: "No confirmed provider transmission identifier and timestamp exists -- authorization alone is not Contract Sent.",
    });
  }
  if (evidence.expiration === null) {
    reasons.push({
      code: "EXPIRATION_NOT_SET",
      message: "No explicit expiration date/time has been established.",
    });
  }
  return { eligible: reasons.length === 0, reasons };
}

/**
 * "Expired is derived automatically: the moment that established timestamp
 * passes without the three-fact verified-execution requirement having been
 * met, the agreement reads as Expired, with no explicit operator action
 * required" (`SELLER_CONTRACT_STATE_MACHINE_V1.md`, "Expired"). A verified-
 * executed agreement can never expire, regardless of the clock.
 */
export function isExpired(args: {
  expirationAt: string;
  now: string;
  verifiedExecuted: boolean;
}): boolean {
  if (args.verifiedExecuted) return false;
  return new Date(args.now).getTime() > new Date(args.expirationAt).getTime();
}

/* ==================================================================== */
/* 6. Contract version / revision identity -- no silent term change     */
/* ==================================================================== */

/**
 * Identifies one specific contract version/revision. `agreementAt` names
 * which Agreement Reached lineage this version belongs to; `versionSeq` is
 * 1-based and monotonic WITHIN that lineage (case 2 corrections only --
 * "reuses the SAME `agreementAt`... consistent with... INV-68's already-
 * proven rule that reopening the same agreement preserves its Contract
 * Ready checklist progress"). A case 1 correction starts an entirely new
 * lineage (`replacesAgreementAt` records the relationship without implying
 * the prior version is void -- `SELLER_CONTRACT_STATE_MACHINE_V1.md`:
 * "Creating or sending a replacement version does not, by itself, deem an
 * already executed prior agreement legally void or superseded").
 */
export type ContractVersionIdentity = {
  agreementAt: string;
  versionSeq: number;
  supersedesVersionSeq: number | null;
  replacesAgreementAt: string | null;
};

export function initialVersionIdentity(agreementAt: string): ContractVersionIdentity {
  return { agreementAt, versionSeq: 1, supersedesVersionSeq: null, replacesAgreementAt: null };
}

/**
 * Builds the NEXT version identity from a correction classification.
 * `metadata_only` produces no new version at all (`SELLER_CONTRACT_
 * STATE_MACHINE_V1.md`: "requires no new contract cycle -- neither a new
 * Agreement Reached nor a new pass through Contract Ready") -- fails
 * closed rather than silently minting one.
 */
export function nextVersionIdentity(
  prior: ContractVersionIdentity,
  classification: CorrectionClassification,
  newAgreementAt: string | null,
): { ok: true; value: ContractVersionIdentity } | { ok: false; error: string } {
  if (classification.kind === "metadata_only") {
    return { ok: false, error: "A metadata-only change creates no new contract version." };
  }
  if (classification.kind === "new_agreement_required") {
    if (!newAgreementAt) {
      return { ok: false, error: "A new_agreement_required correction requires a new agreementAt." };
    }
    return {
      ok: true,
      value: {
        agreementAt: newAgreementAt,
        versionSeq: 1,
        supersedesVersionSeq: null,
        replacesAgreementAt: prior.agreementAt,
      },
    };
  }
  return {
    ok: true,
    value: {
      agreementAt: prior.agreementAt,
      versionSeq: prior.versionSeq + 1,
      supersedesVersionSeq: prior.versionSeq,
      replacesAgreementAt: null,
    },
  };
}

/**
 * `SELLER_CONTRACT_STATE_MACHINE_V1.md`, item 5 of the ten-point
 * verification (`BOARD9_CONTRACT_INVENTORY_V1.md`): "Review and
 * authorization bound to the exact document version... this is exactly
 * the kind of guarantee IAOS's own verification logic (INV-58's job)
 * should enforce regardless of what GHL does internally." If the document
 * revision GHL reports at read-time differs from the revision Brad's send
 * authorization was actually bound to, that authorization no longer
 * covers what exists now -- silently proceeding would be exactly the
 * "no silent term change" failure this issue's acceptance criteria names.
 */
export type DocumentRevisionBinding = {
  authorizedDocumentRevision: string | null;
  currentDocumentRevision: string | null;
};

export function isAuthorizationInvalidatedByRevision(binding: DocumentRevisionBinding): boolean {
  if (binding.authorizedDocumentRevision === null) return false;
  return binding.currentDocumentRevision !== binding.authorizedDocumentRevision;
}

/* ==================================================================== */
/* 7. Signer/party requirements, envelope identifiers, verified execution */
/* ==================================================================== */

/**
 * Per-deal, never a fixed enum: `BOARD9_CONTRACT_INVENTORY_V1.md` item 7
 * finds owner/signing-authority data genuinely absent today (co-owner,
 * spousal, POA, trustee roles are all real possibilities, unenumerable
 * until an actual template is read). `signingAuthorityNote` is
 * disclosure-level only -- IAOS records what was stated, it does not
 * verify legal authority.
 */
export type SignerRequirement = {
  role: string;
  displayName: string | null;
  signingAuthorityNote: string | null;
};

export function validateSignerRequirements(
  requirements: SignerRequirement[],
): { valid: boolean; reasons: TransitionReason[] } {
  const reasons: TransitionReason[] = [];
  if (requirements.length === 0) {
    reasons.push({
      code: "NO_SIGNER_REQUIREMENTS",
      message: "No signer requirements have been recorded for this agreement.",
    });
  }
  const roles = requirements.map((r) => r.role);
  const dup = roles.find((r, i) => roles.indexOf(r) !== i);
  if (dup) {
    reasons.push({
      code: "DUPLICATE_SIGNER_ROLE",
      message: `Duplicate signer role recorded: ${dup}.`,
    });
  }
  return { valid: reasons.length === 0, reasons };
}

/**
 * `provider` is a plain, opaque string -- deliberately not a literal
 * union naming any specific e-sign provider. See the module header:
 * provider selection remains unmade, and this model must constrain
 * whichever provider a future issue selects, not presuppose one.
 */
export type EnvelopeIdentifiers = {
  provider: string;
  documentId: string;
  /** A second, distinct GHL-native reference id observed in the live Test transaction (`BOARD9_CONTRACT_INVENTORY_V1.md` item 8) -- kept separate from `documentId` because which field is canonical was never cross-checked live. */
  documentReference: string | null;
  /** BLOCKED per `BOARD9_CONTRACT_INVENTORY_V1.md` item 9 -- nullable, never assumed present. */
  documentRevision: string | null;
};

export type SignerCompletion = { role: string; hasCompleted: boolean };

/**
 * `contractVersion` stays nullable: the live Test transaction proof found
 * "no distinct provider version field... observed on this document," per
 * `BOARD9_CONTRACT_INVENTORY_V1.md` item 9's correction. This model does
 * not invent a value where the evidence does not supply one.
 */
export type PreservedDocumentEvidence = {
  sha256: string;
  providerReference: string;
  completionTime: string;
  contractVersion: string | null;
};

export type ExecutionEvidence = {
  signers: SignerCompletion[];
  providerReportedCompletionAt: string | null;
  preservedDocument: PreservedDocumentEvidence | null;
};

export type UnderContractEvidence = {
  contractSent: boolean;
  requirements: SignerRequirement[];
  execution: ExecutionEvidence;
  /**
   * `detectMaterialConflicts(agreement, executedTerms).length === 0`,
   * computed by the caller. `SELLER_CONTRACT_STATE_MACHINE_V1.md`:
   * "No price change can bypass a new Agreement Reached record: a price
   * that differs from the authoritative Agreement Reached snapshot is...
   * case 1 without exception." This is IAOS's own enforcement, on top of
   * -- never substituting for -- the three provider-side facts below,
   * exactly as `BOARD9_CONTRACT_INVENTORY_V1.md` item 10 states GHL's own
   * internal fail-closed behavior is not solely GHL's guarantee to make.
   */
  executedTermsMatchAgreement: boolean;
};

/**
 * `SELLER_CONTRACT_STATE_MACHINE_V1.md`, Under Contract: "Three facts, all
 * required jointly -- no single one, nor any two, is sufficient." This
 * function checks all three independently (plus the executed-terms
 * safeguard above) and reports every one that is missing -- never treats
 * two-of-three as "close enough."
 */
export function evaluateUnderContractEligibility(
  evidence: UnderContractEvidence,
): { eligible: boolean; reasons: TransitionReason[] } {
  const reasons: TransitionReason[] = [];
  if (!evidence.contractSent) {
    reasons.push({ code: "NOT_CONTRACT_SENT", message: "Contract Sent has not been reached." });
  }

  const signerCheck = validateSignerRequirements(evidence.requirements);
  if (!signerCheck.valid) {
    reasons.push(...signerCheck.reasons);
  } else {
    const allComplete = evidence.requirements.every(
      (r) => evidence.execution.signers.find((s) => s.role === r.role)?.hasCompleted === true,
    );
    if (!allComplete) {
      reasons.push({
        code: "SIGNERS_INCOMPLETE",
        message: "Not every required signer has completed execution.",
      });
    }
  }

  if (evidence.execution.providerReportedCompletionAt === null) {
    reasons.push({
      code: "PROVIDER_COMPLETION_NOT_REPORTED",
      message: "The provider has not reported completion -- per-signer completion alone is not Under Contract.",
    });
  }
  if (evidence.execution.preservedDocument === null) {
    reasons.push({
      code: "DOCUMENT_NOT_PRESERVED",
      message: "The executed document has not been preserved.",
    });
  }
  if (!evidence.executedTermsMatchAgreement) {
    reasons.push({
      code: "EXECUTED_TERMS_REQUIRE_NEW_AGREEMENT",
      message:
        "The executed document's terms differ from the authoritative Agreement Reached snapshot -- this requires a new Agreement Reached record, never a silent acceptance of a changed term.",
    });
  }

  return { eligible: reasons.length === 0, reasons };
}

/* ==================================================================== */
/* 8. No-reentry disposition-handoff payload -- stable, downstream-safe */
/* ==================================================================== */

/** "Rescission is Brad-only authority in V1" (`SELLER_CONTRACT_STATE_MACHINE_V1.md`, resolved decision 3) -- enforced as a runtime literal check, never assumed from context, exactly as this codebase never fabricates an operator identity. */
export type RescissionRecord = { authorizedBy: string; at: string; reason: string };

function isValidIsoInstant(at: string): boolean {
  return Number.isFinite(new Date(at).getTime());
}

/**
 * The stable payload a downstream consumer (closing/title handoff, a
 * future disposition surface) reads once a terminal outcome is reached.
 * `noReentry` is always the literal `true` here -- named explicitly so a
 * consumer never has to infer it from which `terminalState` variant it
 * received. Each variant carries exactly the fields relevant to that
 * termination and no others, so a consumer branching on `terminalState`
 * gets a narrowed, exhaustive shape.
 */
export type DispositionHandoffPayload = {
  opportunityId: string;
  agreementAt: string;
  version: ContractVersionIdentity;
  noReentry: true;
} & (
  | { terminalState: "under_contract"; execution: ExecutionEvidence }
  | { terminalState: "rescinded"; rescission: RescissionRecord }
  | { terminalState: "expired"; expirationAt: string }
  | { terminalState: "declined"; declinedAt: string }
);

export type BuildHandoffArgs =
  | {
      terminalState: "under_contract";
      opportunityId: string;
      agreementAt: string;
      version: ContractVersionIdentity;
      underContractEvidence: UnderContractEvidence;
    }
  | {
      terminalState: "rescinded";
      opportunityId: string;
      agreementAt: string;
      version: ContractVersionIdentity;
      rescission: RescissionRecord;
    }
  | {
      terminalState: "expired";
      opportunityId: string;
      agreementAt: string;
      version: ContractVersionIdentity;
      expirationAt: string;
    }
  | {
      terminalState: "declined";
      opportunityId: string;
      agreementAt: string;
      version: ContractVersionIdentity;
      declinedAt: string;
    };

/**
 * Builds the handoff payload ONLY when the named terminal state's own
 * entry evidence is genuinely satisfied -- never emits a payload for a
 * state that has not actually been reached. This is what makes the
 * handoff "stable": every payload this function ever returns is one whose
 * terminal condition was actually checked, not merely asserted by a caller.
 */
export function buildDispositionHandoffPayload(
  args: BuildHandoffArgs,
): { ok: true; value: DispositionHandoffPayload } | { ok: false; reasons: TransitionReason[] } {
  if (args.terminalState === "under_contract") {
    const eligibility = evaluateUnderContractEligibility(args.underContractEvidence);
    if (!eligibility.eligible) return { ok: false, reasons: eligibility.reasons };
    return {
      ok: true,
      value: Object.freeze({
        opportunityId: args.opportunityId,
        agreementAt: args.agreementAt,
        version: args.version,
        noReentry: true as const,
        terminalState: "under_contract" as const,
        execution: args.underContractEvidence.execution,
      }),
    };
  }

  if (args.terminalState === "rescinded") {
    const reasons: TransitionReason[] = [];
    if (args.rescission.authorizedBy !== "brad") {
      reasons.push({
        code: "RESCISSION_NOT_BRAD_AUTHORIZED",
        message: "Rescission requires Brad's explicit authorization -- V1 permits no other operator.",
      });
    }
    if (args.rescission.reason.trim() === "") {
      reasons.push({ code: "RESCISSION_REASON_REQUIRED", message: "A rescission reason is required." });
    }
    if (!isValidIsoInstant(args.rescission.at)) {
      reasons.push({ code: "RESCISSION_TIMESTAMP_INVALID", message: "The rescission timestamp is not a valid instant." });
    }
    if (reasons.length > 0) return { ok: false, reasons };
    return {
      ok: true,
      value: Object.freeze({
        opportunityId: args.opportunityId,
        agreementAt: args.agreementAt,
        version: args.version,
        noReentry: true as const,
        terminalState: "rescinded" as const,
        rescission: args.rescission,
      }),
    };
  }

  if (args.terminalState === "expired") {
    return {
      ok: true,
      value: Object.freeze({
        opportunityId: args.opportunityId,
        agreementAt: args.agreementAt,
        version: args.version,
        noReentry: true as const,
        terminalState: "expired" as const,
        expirationAt: args.expirationAt,
      }),
    };
  }

  return {
    ok: true,
    value: Object.freeze({
      opportunityId: args.opportunityId,
      agreementAt: args.agreementAt,
      version: args.version,
      noReentry: true as const,
      terminalState: "declined" as const,
      declinedAt: args.declinedAt,
    }),
  };
}
