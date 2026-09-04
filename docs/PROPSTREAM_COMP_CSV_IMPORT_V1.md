# PropStream comparable CSV import V1 — B7-04 / INV-21

## Boundary

`app/src/lib/propstream-comp-csv.ts` is a pure import and normalization seam
for the proven PropStream comparable export. It accepts CSV text plus explicit
source metadata and returns an IAOS evidence model. It performs no network
request and writes nowhere.

This is deliberately separate from `scripts/import-propstream-csv.ts`. That
existing tool imports seller/property Contact data into GHL. Comparable-sale
evidence is detailed IAOS evidence and is not expanded into GHL fields.

## Known source shape

The V1 schema requires the 20 headers observed in the 2026-09-02 sample export:

    Street Address, City, State, Zip, Property Type, Status, Date, Amount,
    (MLS) Days On Market, Beds, Baths, SqFt, Lot SqFt, Year Built, PPSF,
    Pool Present, Sale Situation, Subdivision, Multi-Parcel, Distance

PropStream includes a trailing unnamed CSV column in the known sample. The
importer treats that header as framing; row-width validation rejects any row
that puts evidence into the unnamed column. Any other unknown named header is
preserved in raw evidence and reported as unsupported.

## Normalization contract

- CSV quoting, escaped quotes, commas inside quoted values, CRLF/LF, and a UTF-8
  BOM are supported.
- Every raw source value is retained verbatim in `evidence[].raw`.
- Text normalization trims and collapses whitespace. It does not title-case,
  expand abbreviations, geocode, or infer missing values.
- State is uppercased. ZIP remains text so leading zeroes survive.
- Numbers accept a complete finite numeric token with optional currency,
  percent, or grouping punctuation. Partial parses are rejected.
- Dates accept valid `M/D/YYYY` or `YYYY-MM-DD` calendar dates and normalize to
  ISO date form. Invalid dates do not roll over.
- `Yes` / `No` normalize to booleans. Blank stays unknown; any other token is
  reported and stays unknown.
- `MLS Sold` and `Public Record Sold` remain distinct provenance values. Other
  status text is retained and reported as unsupported; it is not guessed.
- Sale prices explicitly resolve to `VALID`, `ZERO`, `MISSING`, or `UNUSABLE`.
  Raw evidence remains available in every state.
- Source filename, caller-supplied import instant, schema version, exact header
  list, and row count are retained. Supplying the import instant keeps time out
  of the pure function, so identical inputs produce identical output.

## Same-property and contradictory evidence

Property identity reuses B7-03's native address shape: street, city, state and
ZIP, with street/city/state required and ZIP optional. Normalized identity is
used only to group evidence.

Rows are never merged or discarded. Every source row receives an evidence id.
Exact repeats are listed as `repeatedEvidence`; differing source, sale date,
sale price, property type, square footage, or year built within one property
group are listed as `conflicts`, with every contributing evidence id. B7-04
does not decide which record wins.

## Explicit failures

Empty input, malformed quoting, duplicate headers, missing required headers,
and row-width mismatches are structural errors. Missing/invalid field values,
unsupported statuses, and unsupported boolean tokens are row warnings. A
structurally invalid schema produces no partially normalized evidence.

## Excluded downstream behavior

There is no comp state, score, search expansion, median, price-per-square-foot
cross-check, ARV reconciliation or recommendation, persistence, GHL carrier,
workspace, repair-estimation, MAO, or offer behavior in this seam. Those remain
the separately gated B7-05+ concerns named by INV-21 and PB-D61.

## Deterministic evidence

`app/scripts/test-propstream-comp-csv.cjs` compiles the TypeScript module in a
temporary directory and exercises the checked-in copy of the known sample plus
synthetic malformed, missing, zero, unusable, repeated, and contradictory
cases. It also scans executable source for forbidden downstream mechanisms.

Run:

    pnpm --dir app test:propstream-comp-csv
