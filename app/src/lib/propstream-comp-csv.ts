/**
 * B7-04 / INV-21 — pure PropStream comparable CSV import boundary.
 *
 * This module parses and normalizes evidence. It deliberately has no network,
 * persistence, GHL, classification, expansion, valuation, ARV, repair, MAO,
 * offer, or UI concern. Source rows are never merged: same-property records
 * are grouped and their conflicts are made explicit while every row survives.
 */

export const PROPSTREAM_COMP_IMPORT_VERSION = "propstream-comparable-csv-v1" as const;

export const PROPSTREAM_COMP_HEADERS = [
  "Street Address",
  "City",
  "State",
  "Zip",
  "Property Type",
  "Status",
  "Date",
  "Amount",
  "(MLS) Days On Market",
  "Beds",
  "Baths",
  "SqFt",
  "Lot SqFt",
  "Year Built",
  "PPSF",
  "Pool Present",
  "Sale Situation",
  "Subdivision",
  "Multi-Parcel",
  "Distance",
] as const;

export type PropStreamCompHeader = (typeof PROPSTREAM_COMP_HEADERS)[number];
export type SaleSource = "MLS" | "PUBLIC_RECORD" | "UNSUPPORTED";
export type SalePriceState = "VALID" | "ZERO" | "MISSING" | "UNUSABLE";
export type ImportSeverity = "error" | "warning";

export type CompImportIssue = {
  code:
    | "EMPTY_CSV"
    | "MISSING_COLUMN"
    | "DUPLICATE_COLUMN"
    | "UNSUPPORTED_COLUMN"
    | "MALFORMED_CSV"
    | "ROW_WIDTH_MISMATCH"
    | "MISSING_ADDRESS_IDENTITY"
    | "UNSUPPORTED_STATUS"
    | "INVALID_DATE"
    | "INVALID_NUMBER"
    | "INVALID_BOOLEAN"
    | "MISSING_SALE_PRICE"
    | "ZERO_SALE_PRICE"
    | "UNUSABLE_SALE_PRICE";
  severity: ImportSeverity;
  message: string;
  rowNumber?: number;
  column?: string;
  rawValue?: string;
};

export type NormalizedNumber = number | null;

export type PropStreamComparable = {
  evidenceId: string;
  rowNumber: number;
  propertyKey: string | null;
  address: {
    street: string;
    city: string;
    state: string;
    postalCode: string;
    formatted: string;
  };
  propertyType: string;
  status: string;
  saleSource: SaleSource;
  saleDate: string | null;
  salePrice: NormalizedNumber;
  salePriceState: SalePriceState;
  mlsDaysOnMarket: NormalizedNumber;
  beds: NormalizedNumber;
  baths: NormalizedNumber;
  squareFeet: NormalizedNumber;
  lotSquareFeet: NormalizedNumber;
  yearBuilt: NormalizedNumber;
  pricePerSquareFoot: NormalizedNumber;
  poolPresent: boolean | null;
  saleSituation: string;
  subdivision: string;
  multiParcel: boolean | null;
  distanceMiles: NormalizedNumber;
  /** Exact strings from the source row, keyed by the source header. */
  raw: Readonly<Record<string, string>>;
  issues: readonly CompImportIssue[];
};

export type EvidenceConflict = {
  field: keyof Pick<
    PropStreamComparable,
    "saleSource" | "saleDate" | "salePrice" | "propertyType" | "squareFeet" | "yearBuilt"
  >;
  values: readonly (string | number | null)[];
  evidenceIds: readonly string[];
};

export type PropertyEvidenceGroup = {
  propertyKey: string;
  evidenceIds: readonly string[];
  repeatedEvidence: readonly (readonly string[])[];
  conflicts: readonly EvidenceConflict[];
};

export type PropStreamCompImport = {
  source: {
    kind: "PROPSTREAM_COMPARABLE_CSV";
    version: typeof PROPSTREAM_COMP_IMPORT_VERSION;
    fileName: string;
    importedAt: string;
    headers: readonly string[];
    rowCount: number;
  };
  evidence: readonly PropStreamComparable[];
  propertyGroups: readonly PropertyEvidenceGroup[];
  issues: readonly CompImportIssue[];
};

export type PropStreamCompImportMetadata = {
  fileName: string;
  /** Caller-supplied ISO instant. Keeping time outside makes import deterministic. */
  importedAt: string;
};

type CsvCell = { value: string };

function parseCsvMatrix(csv: string): { rows: CsvCell[][]; issue: CompImportIssue | null } {
  const rows: CsvCell[][] = [];
  let row: CsvCell[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index++) {
    const character = csv[index];
    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') {
        value += '"';
        index++;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
      continue;
    }

    if (character === '"') {
      if (value.length !== 0) {
        return {
          rows: [],
          issue: {
            code: "MALFORMED_CSV",
            severity: "error",
            message: `Unexpected quote in CSV field at character ${index + 1}`,
          },
        };
      }
      quoted = true;
    } else if (character === ",") {
      row.push({ value });
      value = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && csv[index + 1] === "\n") index++;
      row.push({ value });
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  if (quoted) {
    return {
      rows: [],
      issue: { code: "MALFORMED_CSV", severity: "error", message: "Unclosed quoted CSV field" },
    };
  }
  if (value.length > 0 || row.length > 0) {
    row.push({ value });
    rows.push(row);
  }
  return { rows, issue: null };
}

function cleanText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeState(value: string): string {
  return cleanText(value).toUpperCase();
}

function parseStrictNumber(
  rawValue: string,
  rowNumber: number,
  column: string,
  issues: CompImportIssue[],
): number | null {
  const trimmed = rawValue.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[$,%]/g, "").replace(/,/g, "").trim();
  if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(cleaned)) {
    issues.push({
      code: "INVALID_NUMBER",
      severity: "warning",
      message: `${column} is not a supported number`,
      rowNumber,
      column,
      rawValue,
    });
    return null;
  }
  const value = Number(cleaned);
  if (!Number.isFinite(value)) {
    issues.push({
      code: "INVALID_NUMBER",
      severity: "warning",
      message: `${column} is not finite`,
      rowNumber,
      column,
      rawValue,
    });
    return null;
  }
  return value;
}

function isValidDate(year: number, month: number, day: number): boolean {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day;
}

function parseDate(
  rawValue: string,
  rowNumber: number,
  issues: CompImportIssue[],
): string | null {
  const value = rawValue.trim();
  if (!value) return null;
  const match = /^(?:(\d{1,2})\/(\d{1,2})\/(\d{4})|(\d{4})-(\d{2})-(\d{2}))$/.exec(value);
  if (match) {
    const year = Number(match[3] ?? match[4]);
    const month = Number(match[1] ?? match[5]);
    const day = Number(match[2] ?? match[6]);
    if (isValidDate(year, month, day)) {
      return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  issues.push({
    code: "INVALID_DATE",
    severity: "warning",
    message: "Date is not a valid M/D/YYYY or YYYY-MM-DD date",
    rowNumber,
    column: "Date",
    rawValue,
  });
  return null;
}

function parseBoolean(
  rawValue: string,
  rowNumber: number,
  column: string,
  issues: CompImportIssue[],
): boolean | null {
  const value = rawValue.trim().toLowerCase();
  if (!value) return null;
  if (value === "yes") return true;
  if (value === "no") return false;
  issues.push({
    code: "INVALID_BOOLEAN",
    severity: "warning",
    message: `${column} must be Yes, No, or blank`,
    rowNumber,
    column,
    rawValue,
  });
  return null;
}

function saleSource(status: string): SaleSource {
  const normalized = status.trim().toLowerCase();
  if (normalized === "mls sold") return "MLS";
  if (normalized === "public record sold") return "PUBLIC_RECORD";
  return "UNSUPPORTED";
}

function buildPropertyKey(street: string, city: string, state: string, postalCode: string): string | null {
  if (!street || !city || !state) return null;
  return [street, city, state, postalCode]
    .map((part) => cleanText(part).toLowerCase())
    .join("|");
}

function uniqueValues<T extends string | number | null>(values: readonly T[]): T[] {
  const result: T[] = [];
  for (const value of values) {
    if (!result.some((candidate) => Object.is(candidate, value))) result.push(value);
  }
  return result;
}

function comparableSignature(evidence: PropStreamComparable): string {
  const { evidenceId: _evidenceId, rowNumber: _rowNumber, raw: _raw, issues: _issues, ...normalized } = evidence;
  return JSON.stringify(normalized);
}

function groupEvidence(evidence: readonly PropStreamComparable[]): PropertyEvidenceGroup[] {
  const grouped = new Map<string, PropStreamComparable[]>();
  for (const item of evidence) {
    if (!item.propertyKey) continue;
    const existing = grouped.get(item.propertyKey) ?? [];
    existing.push(item);
    grouped.set(item.propertyKey, existing);
  }

  return [...grouped.entries()].map(([propertyKey, items]) => {
    const signatures = new Map<string, string[]>();
    for (const item of items) {
      const signature = comparableSignature(item);
      signatures.set(signature, [...(signatures.get(signature) ?? []), item.evidenceId]);
    }

    const conflicts: EvidenceConflict[] = [];
    const fields: EvidenceConflict["field"][] = [
      "saleSource",
      "saleDate",
      "salePrice",
      "propertyType",
      "squareFeet",
      "yearBuilt",
    ];
    for (const field of fields) {
      const values = uniqueValues(items.map((item) => item[field]));
      if (values.length > 1) {
        conflicts.push({ field, values, evidenceIds: items.map((item) => item.evidenceId) });
      }
    }

    return {
      propertyKey,
      evidenceIds: items.map((item) => item.evidenceId),
      repeatedEvidence: [...signatures.values()].filter((ids) => ids.length > 1),
      conflicts,
    };
  });
}

export function importPropStreamCompCsv(
  csv: string,
  metadata: PropStreamCompImportMetadata,
): PropStreamCompImport {
  const structuralIssues: CompImportIssue[] = [];
  const parsed = parseCsvMatrix(csv.replace(/^\uFEFF/, ""));
  if (parsed.issue) structuralIssues.push(parsed.issue);

  const nonBlankRows = parsed.rows.filter((row) => row.some((cell) => cell.value.trim() !== ""));
  if (nonBlankRows.length === 0) {
    structuralIssues.push({ code: "EMPTY_CSV", severity: "error", message: "CSV has no header row" });
  }

  const rawHeaders = (nonBlankRows[0] ?? []).map((cell) => cell.value.trim());
  // PropStream's known export carries one trailing unnamed framing column. The
  // header is removed here; row-width validation below still rejects any row
  // that puts evidence into that unnamed column.
  let headers = [...rawHeaders];
  if (headers[headers.length - 1] === "") {
    headers = headers.slice(0, -1);
  }

  const duplicates = headers.filter((header, index) => header && headers.indexOf(header) !== index);
  for (const header of [...new Set(duplicates)]) {
    structuralIssues.push({
      code: "DUPLICATE_COLUMN",
      severity: "error",
      message: `CSV contains duplicate column ${header}`,
      column: header,
    });
  }
  for (const header of PROPSTREAM_COMP_HEADERS) {
    if (!headers.includes(header)) {
      structuralIssues.push({
        code: "MISSING_COLUMN",
        severity: "error",
        message: `CSV is missing required column ${header}`,
        column: header,
      });
    }
  }
  for (const header of headers) {
    if (header && !(PROPSTREAM_COMP_HEADERS as readonly string[]).includes(header)) {
      structuralIssues.push({
        code: "UNSUPPORTED_COLUMN",
        severity: "warning",
        message: `Unsupported column ${header} is preserved in raw evidence but not normalized`,
        column: header,
      });
    }
  }

  const dataRows = nonBlankRows.slice(1);
  if (!structuralIssues.some((issue) => issue.severity === "error")) {
    for (let index = 0; index < dataRows.length; index++) {
      const cells = dataRows[index];
      const finalCell = cells[cells.length - 1];
      const meaningfulWidth = cells.length === headers.length + 1 && finalCell?.value.trim() === ""
        ? cells.length - 1
        : cells.length;
      if (meaningfulWidth !== headers.length) {
        structuralIssues.push({
          code: "ROW_WIDTH_MISMATCH",
          severity: "error",
          message: `Row has ${meaningfulWidth} fields; expected ${headers.length}`,
          rowNumber: index + 2,
        });
      }
    }
  }

  const hasStructuralError = structuralIssues.some((issue) => issue.severity === "error");
  const evidence: PropStreamComparable[] = [];
  if (!hasStructuralError) {
    for (let index = 0; index < dataRows.length; index++) {
      const rowNumber = index + 2;
      const cells = dataRows[index];

      const raw: Record<string, string> = {};
      headers.forEach((header, headerIndex) => {
        raw[header] = cells[headerIndex]?.value ?? "";
      });
      const issues: CompImportIssue[] = [];
      const street = cleanText(raw["Street Address"]);
      const city = cleanText(raw.City);
      const state = normalizeState(raw.State);
      const postalCode = cleanText(raw.Zip);
      const propertyKey = buildPropertyKey(street, city, state, postalCode);
      if (!propertyKey) {
        issues.push({
          code: "MISSING_ADDRESS_IDENTITY",
          severity: "warning",
          message: "Street Address, City, and State are required for subject-property identity",
          rowNumber,
        });
      }

      const status = cleanText(raw.Status);
      const source = saleSource(status);
      if (source === "UNSUPPORTED") {
        issues.push({
          code: "UNSUPPORTED_STATUS",
          severity: "warning",
          message: "Status is not MLS Sold or Public Record Sold",
          rowNumber,
          column: "Status",
          rawValue: raw.Status,
        });
      }

      const amountRaw = raw.Amount.trim();
      const amount = parseStrictNumber(raw.Amount, rowNumber, "Amount", issues);
      let salePriceState: SalePriceState;
      if (!amountRaw) {
        salePriceState = "MISSING";
        issues.push({
          code: "MISSING_SALE_PRICE",
          severity: "warning",
          message: "Sale price is missing",
          rowNumber,
          column: "Amount",
          rawValue: raw.Amount,
        });
      } else if (amount === null) {
        salePriceState = "UNUSABLE";
        issues.push({
          code: "UNUSABLE_SALE_PRICE",
          severity: "warning",
          message: "Sale price cannot be normalized",
          rowNumber,
          column: "Amount",
          rawValue: raw.Amount,
        });
      } else if (amount === 0) {
        salePriceState = "ZERO";
        issues.push({
          code: "ZERO_SALE_PRICE",
          severity: "warning",
          message: "Sale price is $0 and unusable as sale-price evidence",
          rowNumber,
          column: "Amount",
          rawValue: raw.Amount,
        });
      } else if (amount < 0) {
        salePriceState = "UNUSABLE";
        issues.push({
          code: "UNUSABLE_SALE_PRICE",
          severity: "warning",
          message: "Sale price is negative and unusable as sale-price evidence",
          rowNumber,
          column: "Amount",
          rawValue: raw.Amount,
        });
      } else {
        salePriceState = "VALID";
      }

      evidence.push({
        evidenceId: `row-${rowNumber}`,
        rowNumber,
        propertyKey,
        address: {
          street,
          city,
          state,
          postalCode,
          formatted: [street, [city, state].filter(Boolean).join(", "), postalCode].filter(Boolean).join(" "),
        },
        propertyType: cleanText(raw["Property Type"]),
        status,
        saleSource: source,
        saleDate: parseDate(raw.Date, rowNumber, issues),
        salePrice: amount,
        salePriceState,
        mlsDaysOnMarket: parseStrictNumber(raw["(MLS) Days On Market"], rowNumber, "(MLS) Days On Market", issues),
        beds: parseStrictNumber(raw.Beds, rowNumber, "Beds", issues),
        baths: parseStrictNumber(raw.Baths, rowNumber, "Baths", issues),
        squareFeet: parseStrictNumber(raw.SqFt, rowNumber, "SqFt", issues),
        lotSquareFeet: parseStrictNumber(raw["Lot SqFt"], rowNumber, "Lot SqFt", issues),
        yearBuilt: parseStrictNumber(raw["Year Built"], rowNumber, "Year Built", issues),
        pricePerSquareFoot: parseStrictNumber(raw.PPSF, rowNumber, "PPSF", issues),
        poolPresent: parseBoolean(raw["Pool Present"], rowNumber, "Pool Present", issues),
        saleSituation: cleanText(raw["Sale Situation"]),
        subdivision: cleanText(raw.Subdivision),
        multiParcel: parseBoolean(raw["Multi-Parcel"], rowNumber, "Multi-Parcel", issues),
        distanceMiles: parseStrictNumber(raw.Distance, rowNumber, "Distance", issues),
        raw,
        issues,
      });
    }
  }

  return {
    source: {
      kind: "PROPSTREAM_COMPARABLE_CSV",
      version: PROPSTREAM_COMP_IMPORT_VERSION,
      fileName: metadata.fileName,
      importedAt: metadata.importedAt,
      headers,
      rowCount: dataRows.length,
    },
    evidence,
    propertyGroups: groupEvidence(evidence),
    issues: [...structuralIssues, ...evidence.flatMap((item) => item.issues)],
  };
}
