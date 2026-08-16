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
  Figures,
  Line,
  Provenance,
  UnderwritingResult,
  Warning,
} from "./types";
import type { PolicyParseIssue } from "./resolver-types";

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
      missing: string[];
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
      opportunity: SelectedOpportunity;
      banner: PolicyBanner;
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
   * The deal's asking price after seed-then-supersede, or null when
   * neither the opportunity nor the contact carries one. Absence is a
   * normal state, not a defect.
   */
  askingPrice: number | null;
  issues: PolicyParseIssue[];
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

  if (input.result === null) {
    return {
      state: "orchestration_error",
      detail:
        "An opportunity is selected and no error was reported, but no " +
        "underwriting result was produced.",
    };
  }

  const banner: PolicyBanner = { issues: input.issues };

  if (input.result.status === "unresolved") {
    return {
      state: "unresolved",
      missing: input.result.missing,
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
      askingPrice: input.askingPrice,
    });
  } catch (err: any) {
    return {
      state: "configuration_error",
      field: "askingPrice",
      message: err?.message ?? "Acquisition position could not be determined.",
      opportunity: input.selected,
    };
  }

  return {
    state: "resolved",
    figures: input.result.figures,
    breakdown: input.result.breakdown,
    provenance: input.result.provenance,
    warnings: input.result.warnings,
    position,
    opportunity: input.selected,
    banner,
  };
}
