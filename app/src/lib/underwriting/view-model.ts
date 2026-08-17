/**
 * Underwriting Workspace -- page-state view model.
 *
 * Pure. No fetching, no React. This module is the single place that
 * translates resolver and core output into what the screen is doing, so
 * no component decides for itself what "unresolved" means.
 *
 * The page owns fetching, opportunity selection, and the try/catch around
 * the compute path. This module owns interpretation.
 *
 * It derives acquisition position itself rather than receiving it. That is
 * deliberate: a page that computed underwriting but forgot the position
 * would otherwise produce a resolved state with a missing fact, and
 * defaulting that to "asking price unknown" would mask an orchestration
 * defect as legitimate business data. Deriving it here makes the mistake
 * unrepresentable rather than caught.
 */

import { computeAcquisitionPosition } from "./compute";
import type {
  AcquisitionPosition,
  Assignment,
  AssignmentResolution,
  Figures,
  Line,
  Provenance,
  UnderwritingResult,
  Warning,
} from "./types";
import type { DealFacts, PolicyParseIssue } from "./resolver-types";

/** The opportunity under underwriting, named on screen per PB-D55. */
export type SelectedOpportunity = {
  id: string;
  name: string;
};

/**
 * Malformed investor-policy values.
 *
 * CURRENT BEHAVIOUR, recorded rather than decided: a malformed value is
 * unresolved at the Investor Policy level, and `pick()` then falls through
 * to IAOS Starter. An issue therefore never prevents a calculation -- it
 * is always a banner, never a state. Whether malformed configuration
 * SHOULD fall through or halt underwriting is undecided and deserves its
 * own decision. Do not change resolver behaviour by editing this comment.
 */
export type PolicyBanner = {
  issues: PolicyParseIssue[];
};

/**
 * Deal facts the rail shows whenever an opportunity is selected, resolved
 * or not. Withholding known values until the calculation completes hides
 * facts in exactly the state where the operator most needs them: being
 * told what is missing while what is known is blank.
 */
export type KnownFacts = {
  arv: number | null;
  repairs: number | null;
  askingPrice: number | null;
};

/**
 * Operator-facing labels for the keys computeUnderwriting pushes into
 * `missing`. Internal identifiers must never reach the screen -- an
 * operator cannot act on `assignmentMode` or `financing.ltv`.
 *
 * Every key compute.ts can push is mapped. An unmapped key falls back to
 * its raw name rather than disappearing, but the fallback is a safety net
 * and not the design: a new missing key should gain a label here.
 */
const MISSING_LABELS: Record<string, string> = {
  arv: "ARV",
  repairs: "Estimated Repairs",
  assignmentMode: "Assignment Mode",
  sellingCostPct: "Selling Cost Percentage",
  closingCost: "Closing Cost Estimate",
  monthlyCarry: "Monthly Holding Cost",
  holdMonths: "Hold Period",
  buyerProfitPct: "Buyer Profit Percentage",
  standardMinimum: "Standard Minimum Assignment Spread",
  profitSharePct: "Buyer Profit Share Percentage",
  financing: "Purchase Financing",
  "financing.ltv": "Financing LTV",
  "financing.rate": "Interest Rate",
  "financing.points": "Financing Points",
};

function labelFor(key: string): string {
  return MISSING_LABELS[key] ?? key;
}

function knownFacts(facts: DealFacts): KnownFacts {
  return {
    arv: facts.arv.kind === "value" ? facts.arv.value : null,
    repairs: facts.repairs.kind === "value" ? facts.repairs.value : null,
    askingPrice: facts.askingPrice,
  };
}

/**
 * The Approve attempt, PB-D59. A SECOND AXIS on the resolved state, not
 * an alternative to it: underwriting resolution and approval attempt are
 * independent. A failed write does not make the deal unresolved, and a
 * successful one does not create a second copy of the resolved figures.
 *
 * `partial` is its own status and must never be collapsed into `failed`.
 * PB-D59 section IV spends a section on the distinction: a failed write
 * means the record did not change, while a partial one means it DID and
 * the operator needs to know which carriers landed. The product behaviour
 * and the operator message are materially different.
 *
 * There is no automatic compensating write. PB-D59 section IV: GHL
 * documents no transaction, reverting a partially applied field would
 * itself be a mutation, and a partial state is REPORTED rather than
 * silently repaired.
 */
export type ApproveOutcomeCarrier = {
  key: string;
  landed: boolean;
  sent: number | string;
  observed: number | string | null;
};

export type ApproveState =
  /** No attempt has been made. Approve is available if the deal permits. */
  | { status: "idle" }
  /** A PUT is outstanding. The control must not be re-invokable. */
  | { status: "in_flight" }
  /** All three carriers confirmed on readback. The underwriting is durable. */
  | { status: "succeeded" }
  /**
   * The write did not land. The record is unchanged, so a retry is
   * meaningful and safe.
   */
  | { status: "failed"; message: string }
  /**
   * Some carriers landed and some did not. The record IS changed. Not a
   * retry candidate without a human deciding what to do, and never
   * represented to the operator as approved.
   */
  | {
      status: "partial";
      message: string;
      landed: number;
      carriers: ApproveOutcomeCarrier[];
    };

export type ScreenState =
  /** Any of the three reads still outstanding. */
  | { state: "loading" }
  /**
   * A read failed. The data could not be obtained, so a retry is
   * meaningful.
   */
  | { state: "fetch_error"; message: string }
  /**
   * The contact holds no opportunity. PB-D55: no underwriting becomes
   * authoritative and nothing is written to the Contact as a substitute.
   */
  | { state: "no_opportunity" }
  /**
   * Candidates exist and none is selected. PB-D55 forbids assuming the
   * first is the deal, so NOTHING is computed until the operator selects.
   * Selection authority belongs to the page; this module reports the
   * absence of a selection and never makes one.
   */
  | { state: "awaiting_selection"; candidates: SelectedOpportunity[] }
  /**
   * A configured value arrived and could not be interpreted safely --
   * `UnitsError` from the core, typically a percentage in human units
   * where a decimal fraction was required. A configuration or adapter
   * bug, not a missing input, so retrying the same value accomplishes
   * nothing. Named for the operator's problem rather than the exception
   * class, so a second interpretation failure needs no second state.
   */
  | {
      state: "configuration_error";
      field: string | null;
      message: string;
      opportunity: SelectedOpportunity;
    }
  /**
   * Gate 1 or a required assumption did not resolve. `missing` names what
   * to go get -- the workspace's most useful output when it cannot
   * compute.
   */
  | {
      state: "unresolved";
      /** Raw keys, for tests and debugging. Never rendered. */
      missing: string[];
      /** The same keys in operator language. Render these. */
      missingLabels: string[];
      known: KnownFacts;
      opportunity: SelectedOpportunity;
      banner: PolicyBanner;
    }
  /** Underwriting resolved. */
  | {
      state: "resolved";
      figures: Figures;
      breakdown: Line[];
      provenance: Provenance;
      warnings: Warning[];
      position: AcquisitionPosition;
      known: KnownFacts;
      opportunity: SelectedOpportunity;
      banner: PolicyBanner;
      /**
       * Which of PB-D56 section II's three modes governed this
       * calculation. The DOMAIN DISCRIMINANT, not the GHL option label:
       * `{kind: "standard"}`, never the GHL option label. The guard in
       * this edit's own script rejects any wire label appearing in this
       * file, and rejected an earlier draft of this very comment for
       * quoting one -- which is the guard working.
       *
       * `Assignment`, not `AssignmentResolution` -- narrowed on the way
       * in. A resolved calculation cannot have come from an unresolved
       * assignment: computeUnderwriting returns unresolved when it sees
       * one. So the resolved state carries a strategy, never the
       * possibility of one.
       *
       * Approve needs it: the write carries assignment_mode alongside the
       * two monetary carriers, and the mapping to a wire label happens at
       * the write boundary through OPTION_BY_MODE in resolver-types.ts.
       * Putting the label here would push wire format into the screen
       * contract, where nothing else lives.
       */
      assignment: Assignment;
      /**
       * The Approve attempt for this deal. Nested rather than a sibling
       * state: a deal is resolved AND its approval is idle, in flight,
       * succeeded, failed or partial. Only the resolved state carries it
       * -- there is nothing to approve on an unresolved deal.
       */
      approve: ApproveState;
    }
  /**
   * The page supplied a combination of inputs this contract says cannot
   * occur -- a selected opportunity with no result and no error, for
   * instance. It may render the same retry affordance as fetch_error, but
   * the state machine says what actually happened. A fetch may have
   * succeeded perfectly; reporting this as a fetch failure would be a
   * plausible lie, and those are what this whole layer exists to prevent.
   */
  | { state: "orchestration_error"; detail: string };

export type ViewModelInput = {
  loading: boolean;
  fetchError: string | null;
  /** Caught UnitsError, or any error thrown out of the compute path. */
  computeError: { field: string | null; message: string } | null;
  candidates: SelectedOpportunity[];
  selected: SelectedOpportunity | null;
  result: UnderwritingResult | null;
  /**
   * Deal facts after seed-then-supersede. Passed whole rather than as
   * selected scalars: the rail needs ARV, repairs and asking price, and
   * pulling out three fields would make the next rail figure a fourth
   * special case. Null before an opportunity is selected.
   */
  facts: DealFacts | null;
  /**
   * The assignment strategy the resolver determined, or its statement
   * that none could be. Supplied by the page from the same pipeline memo
   * that produced `result`, so the resolver is not run twice and the two
   * cannot disagree.
   *
   * An AssignmentResolution rather than an Assignment because that is
   * what resolveInputs produces. The narrowing happens here, on the
   * resolved path, where the calculation has already established that a
   * strategy exists.
   *
   * Null before an opportunity is selected, like `facts`.
   */
  assignment: AssignmentResolution | null;
  issues: PolicyParseIssue[];
  /**
   * The Approve attempt's current state, supplied by the page.
   *
   * This module owns the RESULT, never the call. The page performs the
   * write and hands the outcome in, exactly as it does for computeError.
   * That matters more here than anywhere else in this file: Approve is
   * the first browser-reachable write in this feature, and a pure view
   * model cannot accidentally issue one.
   *
   * Defaults to idle when the page has not attempted anything.
   */
  approve: ApproveState;
};

export function toViewModel(input: ViewModelInput): ScreenState {
  // Order matters. Each branch assumes every branch above it failed.

  if (input.loading) return { state: "loading" };

  if (input.fetchError !== null) {
    return { state: "fetch_error", message: input.fetchError };
  }

  if (input.candidates.length === 0) return { state: "no_opportunity" };

  if (input.selected === null) {
    return { state: "awaiting_selection", candidates: input.candidates };
  }

  if (input.computeError !== null) {
    return {
      state: "configuration_error",
      field: input.computeError.field,
      message: input.computeError.message,
      opportunity: input.selected,
    };
  }

  if (input.result === null || input.facts === null) {
    return {
      state: "orchestration_error",
      detail:
        "An opportunity is selected and no error was reported, but no " +
        "underwriting result was produced.",
    };
  }

  const known = knownFacts(input.facts);

  const banner: PolicyBanner = { issues: input.issues };

  if (input.result.status === "unresolved") {
    return {
      state: "unresolved",
      missing: input.result.missing,
      missingLabels: input.result.missing.map(labelFor),
      known,
      opportunity: input.selected,
      banner,
    };
  }

  // computeAcquisitionPosition guards both arguments and throws on a
  // non-finite value. Every other path in this function returns a state,
  // and an interpretation function that can throw would push that
  // knowledge back onto the page -- exactly the coupling this module
  // exists to remove. A non-finite asking price is a configuration
  // problem, so it becomes the state for one.
  let position: AcquisitionPosition;
  try {
    position = computeAcquisitionPosition({
      sellerMAO: input.result.figures.sellerMAO,
      askingPrice: known.askingPrice,
    });
  } catch (err: any) {
    return {
      state: "configuration_error",
      field: "askingPrice",
      message: err?.message ?? "Acquisition position could not be determined.",
      opportunity: input.selected,
    };
  }

  /* The calculation resolved, so the assignment it consumed must be one
     of the three valid strategies -- computeUnderwriting returns
     unresolved when the assignment is unresolved. If it is not, the page
     supplied a result and an assignment that did not come from the same
     resolution, which is a plumbing defect rather than a business state.

     Do NOT fabricate a strategy and do NOT default to standard. An
     operator who chose Manual and silently received Standard Minimum
     economics is precisely the substitution PB-D56 section II.6 forbids.
     This routes to orchestration_error, which exists for combinations the
     contract says cannot occur. */
  if (input.assignment === null || input.assignment.kind === "unresolved") {
    return {
      state: "orchestration_error",
      detail:
        "The calculation resolved but the assignment supplied alongside it " +
        "is " + (input.assignment === null ? "absent" : "unresolved") +
        ". These must come from the same resolution.",
    };
  }

  return {
    state: "resolved",
    figures: input.result.figures,
    breakdown: input.result.breakdown,
    provenance: input.result.provenance,
    warnings: input.result.warnings,
    position,
    known,
    opportunity: input.selected,
    banner,
    approve: input.approve,
    assignment: input.assignment,
  };
}
