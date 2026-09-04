import type { ClassifiedComp, SearchLevel } from "./comp-classification";
import type { PropStreamComparable } from "./propstream-comp-csv";

export const BOARD_7_ARV_POLICY = {
  minimumAcceptedCompCount: 3,
  reconciliationThresholdPercent: 5,
  conservativeRoundingIncrementDollars: 1,
} as const;

export type ArvEvidenceState = "HIGH" | "MODERATE" | "LOW" | "INSUFFICIENT";
export type ArvOutcome = "RECOMMENDED" | "ARV EVIDENCE CONFLICT" | "OUTLIER REVIEW REQUIRED" | "INSUFFICIENT EVIDENCE";

export type AcceptedCompEvidence = {
  comp: PropStreamComparable;
  classification: ClassifiedComp;
  /** Explicit source/investor flag. B7-06 does not invent an outlier threshold. */
  materialOutlierReason?: string;
};

export type ArvReconciliationResult = {
  outcome: ArvOutcome;
  evidenceState: ArvEvidenceState;
  manualReviewRequired: boolean;
  acceptedEvidenceIds: readonly string[];
  flaggedOutliers: readonly { evidenceId: string; reason: string }[];
  primaryMedianSoldPrice: number | null;
  medianAcceptedPricePerSquareFoot: number | null;
  pricePerSquareFootCrossCheck: number | null;
  divergencePercent: number | null;
  supportedSaleRange: { minimum: number; maximum: number } | null;
  recommendedArv: number | null;
  reasons: readonly string[];
};

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

function finitePositive(value: number | null): value is number {
  return value != null && Number.isFinite(value) && value > 0;
}

function baseEvidenceState(level: SearchLevel): ArvEvidenceState {
  return level === "STANDARD" ? "HIGH" : "MODERATE";
}

function conservativeFloor(value: number): number {
  const increment = BOARD_7_ARV_POLICY.conservativeRoundingIncrementDollars;
  return Math.floor(value / increment) * increment;
}

export function reconcileAcceptedCompArv(input: {
  subjectLivingSquareFeet: number;
  searchLevel: SearchLevel;
  evidence: readonly AcceptedCompEvidence[];
}): ArvReconciliationResult {
  const reasons: string[] = [];
  const accepted = input.evidence.filter((item) => item.classification.disposition === "ACCEPTED");
  const acceptedEvidenceIds = accepted.map((item) => item.comp.evidenceId);
  const flaggedOutliers = accepted.flatMap((item) => {
    const reason = item.materialOutlierReason?.trim();
    return reason ? [{ evidenceId: item.comp.evidenceId, reason }] : [];
  });
  const soldPrices = accepted.map((item) => item.comp.salePrice).filter(finitePositive);
  const ppsfValues = accepted.map((item) => item.comp.pricePerSquareFoot).filter(finitePositive);
  const primaryMedianSoldPrice = median(soldPrices);
  const medianAcceptedPricePerSquareFoot = median(ppsfValues);
  const supportedSaleRange = soldPrices.length === 0
    ? null
    : { minimum: Math.min(...soldPrices), maximum: Math.max(...soldPrices) };
  const subjectSquareFeetUsable = Number.isFinite(input.subjectLivingSquareFeet) && input.subjectLivingSquareFeet > 0;
  const pricePerSquareFootCrossCheck = medianAcceptedPricePerSquareFoot != null && subjectSquareFeetUsable
    ? medianAcceptedPricePerSquareFoot * input.subjectLivingSquareFeet
    : null;

  if (accepted.length < BOARD_7_ARV_POLICY.minimumAcceptedCompCount) {
    reasons.push(`${accepted.length} accepted comps are fewer than the required ${BOARD_7_ARV_POLICY.minimumAcceptedCompCount}.`);
  }
  if (soldPrices.length !== accepted.length) {
    reasons.push("One or more accepted comps lacks a usable positive sold price.");
  }
  if (ppsfValues.length < BOARD_7_ARV_POLICY.minimumAcceptedCompCount) {
    reasons.push(`Only ${ppsfValues.length} accepted comps have usable positive PPSF; ${BOARD_7_ARV_POLICY.minimumAcceptedCompCount} are required for the cross-check.`);
  }
  if (!subjectSquareFeetUsable) reasons.push("Subject living square footage is missing or unusable.");
  if (reasons.length > 0) {
    return {
      outcome: "INSUFFICIENT EVIDENCE",
      evidenceState: "INSUFFICIENT",
      manualReviewRequired: true,
      acceptedEvidenceIds,
      flaggedOutliers,
      primaryMedianSoldPrice,
      medianAcceptedPricePerSquareFoot,
      pricePerSquareFootCrossCheck,
      divergencePercent: null,
      supportedSaleRange,
      recommendedArv: null,
      reasons,
    };
  }

  if (flaggedOutliers.length > 0) {
    return {
      outcome: "OUTLIER REVIEW REQUIRED",
      evidenceState: "LOW",
      manualReviewRequired: true,
      acceptedEvidenceIds,
      flaggedOutliers,
      primaryMedianSoldPrice,
      medianAcceptedPricePerSquareFoot,
      pricePerSquareFootCrossCheck,
      divergencePercent: null,
      supportedSaleRange,
      recommendedArv: null,
      reasons: ["Material outlier evidence is explicitly flagged. No ARV is recommended until manual review."],
    };
  }

  // All null cases returned as insufficient above.
  const primary = primaryMedianSoldPrice as number;
  const crossCheck = pricePerSquareFootCrossCheck as number;
  const lower = Math.min(primary, crossCheck);
  const divergencePercent = (Math.abs(primary - crossCheck) / lower) * 100;
  if (divergencePercent > BOARD_7_ARV_POLICY.reconciliationThresholdPercent) {
    return {
      outcome: "ARV EVIDENCE CONFLICT",
      evidenceState: "LOW",
      manualReviewRequired: true,
      acceptedEvidenceIds,
      flaggedOutliers,
      primaryMedianSoldPrice: primary,
      medianAcceptedPricePerSquareFoot,
      pricePerSquareFootCrossCheck: crossCheck,
      divergencePercent,
      supportedSaleRange,
      recommendedArv: null,
      reasons: [`The sold-price and PPSF indications diverge by ${divergencePercent}% using the lower indication as the conservative denominator, above the ${BOARD_7_ARV_POLICY.reconciliationThresholdPercent}% threshold. The methods are not averaged.`],
    };
  }

  const range = supportedSaleRange as { minimum: number; maximum: number };
  const roundedLower = conservativeFloor(lower);
  const recommendedArv = Math.min(range.maximum, Math.max(range.minimum, roundedLower));
  return {
    outcome: "RECOMMENDED",
    evidenceState: baseEvidenceState(input.searchLevel),
    manualReviewRequired: false,
    acceptedEvidenceIds,
    flaggedOutliers,
    primaryMedianSoldPrice: primary,
    medianAcceptedPricePerSquareFoot,
    pricePerSquareFootCrossCheck: crossCheck,
    divergencePercent,
    supportedSaleRange: range,
    recommendedArv,
    reasons: [
      `The two indications are within ${BOARD_7_ARV_POLICY.reconciliationThresholdPercent}%; the lower indication was floored to whole dollars and constrained to the accepted-sale range.`,
    ],
  };
}
