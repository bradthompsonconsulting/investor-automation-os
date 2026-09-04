import { reconcileAcceptedCompArv, type ArvReconciliationResult } from "./arv-reconciliation";
import {
  evaluateCompSearch,
  type CompAssessment,
  type CompSearchResult,
  type SearchLevel,
  type SubjectForCompClassification,
} from "./comp-classification";
import {
  importPropStreamCompCsv,
  type PropStreamCompImport,
  type PropStreamCompImportMetadata,
} from "./propstream-comp-csv";

export type SubjectFactSeed = {
  propertyType: string;
  squareFeet: number | null;
  subdivision: string;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
};

export type SparseContact = { customFields: readonly { id: string; value: unknown }[] };
export type FieldDefinition = { id: string; fieldKey: string };

const SUBJECT_FIELD_KEYS = {
  propertyType: "contact.property_type",
  squareFeet: "contact.building_sqft",
  beds: "contact.bedrooms",
  baths: "contact.total_bathrooms",
  yearBuilt: "contact.effective_year_built",
} as const;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function positiveNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(text(value).replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Reads the existing B7-03 subject carriers by fieldKey; writes nothing. */
export function subjectSeedFromContact(
  contact: SparseContact,
  definitions: readonly FieldDefinition[],
): SubjectFactSeed {
  const idByKey = new Map(definitions.map((definition) => [definition.fieldKey, definition.id]));
  const value = (key: string): unknown => {
    const id = idByKey.get(key);
    return id ? contact.customFields.find((field) => field.id === id)?.value : undefined;
  };
  return {
    propertyType: text(value(SUBJECT_FIELD_KEYS.propertyType)),
    squareFeet: positiveNumber(value(SUBJECT_FIELD_KEYS.squareFeet)),
    // B7-03 identifies no subject-subdivision carrier; this remains a
    // session-only operator fact rather than guessing or repurposing a field.
    subdivision: "",
    beds: positiveNumber(value(SUBJECT_FIELD_KEYS.beds)),
    baths: positiveNumber(value(SUBJECT_FIELD_KEYS.baths)),
    yearBuilt: positiveNumber(value(SUBJECT_FIELD_KEYS.yearBuilt)),
  };
}

export type ArvWorkspaceRun = {
  imported: PropStreamCompImport;
  search: CompSearchResult | null;
  reconciliation: ArvReconciliationResult | null;
};

export function runArvWorkspace(input: {
  csv: string;
  metadata: PropStreamCompImportMetadata;
  subject: SubjectForCompClassification;
  assessments: readonly CompAssessment[];
  level: SearchLevel;
}): ArvWorkspaceRun {
  const imported = importPropStreamCompCsv(input.csv, input.metadata);
  if (imported.issues.some((issue) => issue.severity === "error")) {
    return { imported, search: null, reconciliation: null };
  }
  const search = evaluateCompSearch({
    subject: input.subject,
    candidates: imported.evidence,
    assessments: input.assessments,
    level: input.level,
  });
  const byId = new Map(search.classifications.map((classification) => [classification.evidenceId, classification]));
  const reconciliation = reconcileAcceptedCompArv({
    subjectLivingSquareFeet: input.subject.squareFeet,
    searchLevel: input.level,
    evidence: imported.evidence.map((comp) => ({
      comp,
      classification: byId.get(comp.evidenceId) ?? {
        evidenceId: comp.evidenceId,
        disposition: "REJECTED",
        reasons: ["Classification result is missing."],
        warnings: [],
      },
      materialOutlierReason: input.assessments.find((assessment) => assessment.evidenceId === comp.evidenceId)?.obviousAnomaly,
    })),
  });
  return { imported, search, reconciliation };
}
