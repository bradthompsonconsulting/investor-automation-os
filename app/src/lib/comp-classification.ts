import type { PropStreamComparable } from "./propstream-comp-csv";

export const BOARD_7_COMP_POLICY = {
  standardRecencyMonths: 6,
  standardSquareFootTolerancePercent: 15,
  expandedRecencyMonths: 12,
  expandedSquareFootTolerancePercent: 20,
  targetAcceptedCompCount: 3,
} as const;

export type CompDisposition = "ACCEPTED" | "SUPPORTING" | "REJECTED";
export type SearchLevel = "STANDARD" | "EXPANDED";
export type MarketRelationship =
  | "LOCAL_COMPETITIVE_MARKET"
  | "IMMEDIATE_COMPETITIVE_AREA"
  | "OUTSIDE_COMPETITIVE_AREA"
  | "UNKNOWN";
export type TransactionReliability = "CREDIBLE" | "UNRELIABLE" | "UNKNOWN";

export type SubjectForCompClassification = {
  asOfDate: string;
  propertyType: string;
  squareFeet: number;
  subdivision?: string;
  beds?: number | null;
  baths?: number | null;
  yearBuilt?: number | null;
  poolPresent?: boolean | null;
};

/** Human-established facts IAOS cannot derive from a CSV without inventing policy. */
export type CompAssessment = {
  evidenceId: string;
  marketRelationship: MarketRelationship;
  marketReason: string;
  transactionReliability: TransactionReliability;
  transactionReason: string;
  obviousAnomaly?: string;
  physicalDifferenceWarnings?: readonly string[];
};

export type ClassifiedComp = {
  evidenceId: string;
  disposition: CompDisposition;
  reasons: readonly string[];
  warnings: readonly string[];
};

export const LEVEL_2_PROPSTREAM_INSTRUCTION =
  "PropStream Level 2 EXPANDED search: closed sales within 12 months; same fundamental property type; within +/-20% of subject square footage; immediate competitive area. Import the expanded results and rerun classification. Stop automatic expansion after Level 2.";

export type CompSearchResult = {
  level: SearchLevel;
  classifications: readonly ClassifiedComp[];
  acceptedCount: number;
  outcome: "STANDARD" | "EXPANDED" | "LEVEL_2_REQUIRED" | "LIMITED COMP EVIDENCE";
  nextInstruction: typeof LEVEL_2_PROPSTREAM_INSTRUCTION | null;
  manualReviewRequired: boolean;
  message: string;
};

function normalizeText(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date
    : null;
}

function monthCutoff(asOf: Date, months: number): Date {
  const year = asOf.getUTCFullYear();
  const monthIndex = asOf.getUTCMonth() - months;
  const targetYear = year + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonth, Math.min(asOf.getUTCDate(), lastDay)));
}

function differenceWarnings(
  subject: SubjectForCompClassification,
  comp: PropStreamComparable,
  assessment: CompAssessment,
): string[] {
  const warnings: string[] = [];
  if (subject.beds != null && comp.beds != null && subject.beds !== comp.beds) {
    warnings.push(`Bedroom difference: subject ${subject.beds}; comp ${comp.beds}. No dollar adjustment applied.`);
  }
  if (subject.baths != null && comp.baths != null && subject.baths !== comp.baths) {
    warnings.push(`Bathroom difference: subject ${subject.baths}; comp ${comp.baths}. No dollar adjustment applied.`);
  }
  if (subject.yearBuilt != null && comp.yearBuilt != null && subject.yearBuilt !== comp.yearBuilt) {
    warnings.push(`Age difference: subject built ${subject.yearBuilt}; comp built ${comp.yearBuilt}. No dollar adjustment applied.`);
  }
  if (subject.poolPresent != null && comp.poolPresent != null && subject.poolPresent !== comp.poolPresent) {
    warnings.push(`Pool difference: subject ${subject.poolPresent ? "has" : "does not have"} a pool; comp ${comp.poolPresent ? "has" : "does not have"} a pool. No dollar adjustment applied.`);
  }
  for (const warning of assessment.physicalDifferenceWarnings ?? []) {
    const text = warning.trim();
    if (text) warnings.push(`${text} No dollar adjustment applied.`);
  }
  return warnings;
}

function reject(evidenceId: string, reasons: string[], warnings: string[]): ClassifiedComp {
  return { evidenceId, disposition: "REJECTED", reasons, warnings };
}

export function classifyComp(
  subject: SubjectForCompClassification,
  comp: PropStreamComparable,
  assessment: CompAssessment,
  level: SearchLevel,
): ClassifiedComp {
  const reasons: string[] = [];
  const warnings = differenceWarnings(subject, comp, assessment);
  if (assessment.evidenceId !== comp.evidenceId) {
    return reject(comp.evidenceId, ["Assessment evidence id does not match this comparable."], warnings);
  }

  const asOf = parseIsoDate(subject.asOfDate);
  if (!asOf) return reject(comp.evidenceId, ["Subject as-of date is missing or invalid; recency cannot be established."], warnings);

  const closedSale = comp.saleSource === "MLS" || comp.saleSource === "PUBLIC_RECORD";
  if (!closedSale) reasons.push(`Closed sale is not established from status '${comp.status || "blank"}'.`);
  if (normalizeText(comp.propertyType) !== normalizeText(subject.propertyType)) {
    reasons.push(`Fundamental property type differs: subject '${subject.propertyType}', comp '${comp.propertyType || "blank"}'.`);
  }
  if (assessment.marketRelationship === "OUTSIDE_COMPETITIVE_AREA") {
    reasons.push(`Competitive/local buyer market requirement failed: ${assessment.marketReason || "outside the competitive area"}.`);
  } else if (assessment.marketRelationship === "UNKNOWN") {
    reasons.push(`Competitive/local buyer market is not established: ${assessment.marketReason || "manual market review required"}.`);
  } else if (!assessment.marketReason.trim()) {
    reasons.push("Competitive/local buyer market assessment has no human-readable provenance.");
  }
  if (assessment.transactionReliability !== "CREDIBLE") {
    reasons.push(`Credible transaction price is not established: ${assessment.transactionReason || assessment.transactionReliability.toLowerCase()}.`);
  } else if (!assessment.transactionReason.trim()) {
    reasons.push("Credible transaction assessment has no human-readable provenance.");
  }
  if (comp.salePriceState !== "VALID") {
    reasons.push(`Transaction price is ${comp.salePriceState.toLowerCase()} and cannot be accepted.`);
  }
  if (assessment.obviousAnomaly?.trim()) {
    reasons.push(`Obvious anomaly: ${assessment.obviousAnomaly.trim()}.`);
  }

  const saleDate = comp.saleDate ? parseIsoDate(comp.saleDate) : null;
  if (saleDate && saleDate.getTime() > asOf.getTime()) {
    reasons.push(`Sale date ${comp.saleDate} is after the as-of date ${subject.asOfDate}.`);
  }
  if (reasons.length > 0) return reject(comp.evidenceId, reasons, warnings);

  const maxMonths = level === "STANDARD"
    ? BOARD_7_COMP_POLICY.standardRecencyMonths
    : BOARD_7_COMP_POLICY.expandedRecencyMonths;
  const tolerance = level === "STANDARD"
    ? BOARD_7_COMP_POLICY.standardSquareFootTolerancePercent
    : BOARD_7_COMP_POLICY.expandedSquareFootTolerancePercent;
  const supportingReasons: string[] = [];
  if (!saleDate) {
    supportingReasons.push("Sale date is missing or invalid, so recency cannot be established.");
  } else if (saleDate.getTime() < monthCutoff(asOf, maxMonths).getTime()) {
    supportingReasons.push(`Sale is outside the Level ${level === "STANDARD" ? "1" : "2"} ${maxMonths}-month recency window.`);
  }

  if (!(subject.squareFeet > 0) || comp.squareFeet == null || !(comp.squareFeet > 0)) {
    supportingReasons.push("Subject or comp square footage is missing or unusable, so the size window cannot be established.");
  } else {
    const lower = subject.squareFeet * (1 - tolerance / 100);
    const upper = subject.squareFeet * (1 + tolerance / 100);
    if (comp.squareFeet < lower || comp.squareFeet > upper) {
      supportingReasons.push(`Comp square footage ${comp.squareFeet} is outside the Level ${level === "STANDARD" ? "1" : "2"} +/-${tolerance}% window (${lower}-${upper}).`);
    } else if (comp.squareFeet !== subject.squareFeet) {
      warnings.push(`Square-footage difference: subject ${subject.squareFeet}; comp ${comp.squareFeet}. No dollar adjustment applied.`);
    }
  }

  const sameSubdivision = normalizeText(subject.subdivision) !== "" &&
    normalizeText(subject.subdivision) === normalizeText(comp.subdivision);
  const marketPasses = level === "STANDARD"
    ? sameSubdivision || assessment.marketRelationship === "LOCAL_COMPETITIVE_MARKET"
    : sameSubdivision || assessment.marketRelationship === "LOCAL_COMPETITIVE_MARKET" ||
      assessment.marketRelationship === "IMMEDIATE_COMPETITIVE_AREA";
  if (!marketPasses) {
    supportingReasons.push(level === "STANDARD"
      ? "Comp is not in the same subdivision and a local competitive market has not been established for Level 1."
      : "Immediate competitive-area eligibility has not been established for Level 2.");
  } else if (!sameSubdivision) {
    warnings.push(`${assessment.marketReason || "Comp is outside the subject subdivision but within the established competitive market"}. No dollar adjustment applied.`);
  }

  if (supportingReasons.length > 0) {
    return { evidenceId: comp.evidenceId, disposition: "SUPPORTING", reasons: supportingReasons, warnings };
  }
  return {
    evidenceId: comp.evidenceId,
    disposition: "ACCEPTED",
    reasons: [`Meets all primary requirements and Level ${level === "STANDARD" ? "1 STANDARD" : "2 EXPANDED"} recency, size, property-type, and market criteria.`],
    warnings,
  };
}

export function evaluateCompSearch(input: {
  subject: SubjectForCompClassification;
  candidates: readonly PropStreamComparable[];
  assessments: readonly CompAssessment[];
  level: SearchLevel;
}): CompSearchResult {
  const assessmentById = new Map(input.assessments.map((item) => [item.evidenceId, item]));
  const classifications = input.candidates.map((candidate) => {
    const assessment = assessmentById.get(candidate.evidenceId);
    if (!assessment) {
      return reject(candidate.evidenceId, ["Required market and transaction assessment is missing."], []);
    }
    return classifyComp(input.subject, candidate, assessment, input.level);
  });
  const acceptedCount = classifications.filter((item) => item.disposition === "ACCEPTED").length;
  const target = BOARD_7_COMP_POLICY.targetAcceptedCompCount;
  if (acceptedCount >= target) {
    return {
      level: input.level,
      classifications,
      acceptedCount,
      outcome: input.level,
      nextInstruction: null,
      manualReviewRequired: false,
      message: `${acceptedCount} accepted comps meet the ${input.level === "STANDARD" ? "Level 1 STANDARD" : "Level 2 EXPANDED"} target of ${target}.`,
    };
  }
  if (input.level === "STANDARD") {
    return {
      level: input.level,
      classifications,
      acceptedCount,
      outcome: "LEVEL_2_REQUIRED",
      nextInstruction: LEVEL_2_PROPSTREAM_INSTRUCTION,
      manualReviewRequired: false,
      message: `${acceptedCount} accepted comps are fewer than the target of ${target}; run the controlled Level 2 search.`,
    };
  }
  return {
    level: input.level,
    classifications,
    acceptedCount,
    outcome: "LIMITED COMP EVIDENCE",
    nextInstruction: null,
    manualReviewRequired: true,
    message: `LIMITED COMP EVIDENCE: ${acceptedCount} accepted comps remain after Level 2. Stop automatic expansion and route to manual review.`,
  };
}
