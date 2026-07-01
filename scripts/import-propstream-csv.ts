/**
 * PropStream CSV → GHL contact importer.
 *
 * Run:    npx tsx scripts/import-propstream-csv.ts <csv-file> [options]
 * Options:
 *   --limit N     Process only first N data rows (for test runs; default: all)
 *   --dry-run     Parse and print payloads without calling GHL API
 * Env:    GHL_PRIVATE_API_KEY
 *
 * Behaviour:
 *   - Fetches existing GHL custom field IDs at startup (avoids hardcoding)
 *   - Checks for existing contact by Phone 1, then Email 1
 *   - Creates new contacts or updates existing ones
 *   - Skips empty/blank field values (never writes empty strings)
 *   - Logs every contact as CREATED, UPDATED, or FAILED
 *   - Exits non-zero if any contacts failed
 */

import { config } from "dotenv";
import { readFileSync } from "fs";
import { resolve } from "path";
config();

const GHL_BASE    = "https://services.leadconnectorhq.com";
const LOCATION_ID = "jmHG4B8RdzwpfqruNf68";
const API_KEY     = process.env.GHL_PRIVATE_API_KEY;

if (!API_KEY) {
  console.error("ERROR: GHL_PRIVATE_API_KEY is not set.");
  process.exit(1);
}

// ── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const csvPath  = args.find((a) => !a.startsWith("--"));
const isDryRun = args.includes("--dry-run");
const limitArg = args.indexOf("--limit");
const limit    = limitArg !== -1 ? parseInt(args[limitArg + 1], 10) : Infinity;

if (!csvPath) {
  console.error("Usage: npx tsx scripts/import-propstream-csv.ts <csv-file> [--limit N] [--dry-run]");
  process.exit(1);
}

// ── Types ─────────────────────────────────────────────────────────────────────

type DataType = "TEXT" | "NUMERICAL" | "DATE";

interface CustomFieldSpec {
  propstreamCol: string;       // exact PropStream CSV column header
  ghlKey: string;              // short GHL custom field key
  dataType: DataType;
}

// ── PropStream column → GHL custom field mapping ──────────────────────────────
// Ordered to match spec sections. phone_type is an existing field (Part 3).
// Skipped: "Method of Add", "Phone 2-5 Type"

const CUSTOM_FIELD_MAP: CustomFieldSpec[] = [
  // Property / Location
  { propstreamCol: "County",                                ghlKey: "county",                     dataType: "TEXT"      },
  { propstreamCol: "APN",                                   ghlKey: "apn",                        dataType: "TEXT"      },

  // Phone 1 Type (existing field — Part 3)
  { propstreamCol: "Phone 1 Type",                          ghlKey: "phone_type",                 dataType: "TEXT"      },

  // Phone DNC + extra phones
  { propstreamCol: "Phone 1 DNC",                           ghlKey: "phone_1_dnc",                dataType: "TEXT"      },
  { propstreamCol: "Phone 2",                               ghlKey: "phone_2",                    dataType: "TEXT"      },
  { propstreamCol: "Phone 2 DNC",                           ghlKey: "phone_2_dnc",                dataType: "TEXT"      },
  { propstreamCol: "Phone 3",                               ghlKey: "phone_3",                    dataType: "TEXT"      },
  { propstreamCol: "Phone 3 DNC",                           ghlKey: "phone_3_dnc",                dataType: "TEXT"      },
  { propstreamCol: "Phone 4",                               ghlKey: "phone_4",                    dataType: "TEXT"      },
  { propstreamCol: "Phone 4 DNC",                           ghlKey: "phone_4_dnc",                dataType: "TEXT"      },
  { propstreamCol: "Phone 5",                               ghlKey: "phone_5",                    dataType: "TEXT"      },
  { propstreamCol: "Phone 5 DNC",                           ghlKey: "phone_5_dnc",                dataType: "TEXT"      },

  // Email
  { propstreamCol: "Email 2",                               ghlKey: "email_2",                    dataType: "TEXT"      },
  { propstreamCol: "Email 3",                               ghlKey: "email_3",                    dataType: "TEXT"      },
  { propstreamCol: "Email 4",                               ghlKey: "email_4",                    dataType: "TEXT"      },

  // Ownership
  { propstreamCol: "Owner Occupied",                        ghlKey: "owner_occupied",             dataType: "TEXT"      },
  { propstreamCol: "Owner 2 First Name",                    ghlKey: "owner_2_first_name",         dataType: "TEXT"      },
  { propstreamCol: "Owner 2 Last Name",                     ghlKey: "owner_2_last_name",          dataType: "TEXT"      },
  { propstreamCol: "Litigator",                             ghlKey: "litigator",                  dataType: "TEXT"      },
  { propstreamCol: "Mailing Care of Name",                  ghlKey: "mailing_care_of_name",       dataType: "TEXT"      },

  // Mailing Address components (mailing_address handled separately via concatenation)
  { propstreamCol: "Mailing City",                          ghlKey: "mailing_city",               dataType: "TEXT"      },
  { propstreamCol: "Mailing State",                         ghlKey: "mailing_state",              dataType: "TEXT"      },
  { propstreamCol: "Mailing Zip",                           ghlKey: "mailing_zip",                dataType: "TEXT"      },
  { propstreamCol: "Mailing County",                        ghlKey: "mailing_county",             dataType: "TEXT"      },
  { propstreamCol: "Do Not Mail",                           ghlKey: "do_not_mail",                dataType: "TEXT"      },

  // Property Detail
  { propstreamCol: "Property Status",                       ghlKey: "property_status",            dataType: "TEXT"      },
  { propstreamCol: "Notes",                                 ghlKey: "property_notes",             dataType: "TEXT"      },
  { propstreamCol: "Property Type",                         ghlKey: "property_type",              dataType: "TEXT"      },
  { propstreamCol: "Bedrooms",                              ghlKey: "bedrooms",                   dataType: "NUMERICAL" },
  { propstreamCol: "Total Bathrooms",                       ghlKey: "total_bathrooms",            dataType: "NUMERICAL" },
  { propstreamCol: "Building Sqft",                         ghlKey: "building_sqft",              dataType: "NUMERICAL" },
  { propstreamCol: "Lot Size Sqft",                         ghlKey: "lot_size_sqft",              dataType: "NUMERICAL" },
  { propstreamCol: "Effective Year Built",                  ghlKey: "effective_year_built",       dataType: "NUMERICAL" },

  // Financial
  { propstreamCol: "Total Assessed Value",                  ghlKey: "total_assessed_value",       dataType: "NUMERICAL" },
  { propstreamCol: "Last Sale Recording Date",              ghlKey: "last_sale_date",             dataType: "DATE"      },
  { propstreamCol: "Last Sale Amount",                      ghlKey: "last_sale_amount",           dataType: "NUMERICAL" },
  { propstreamCol: "Total Open Loans",                      ghlKey: "total_open_loans",           dataType: "NUMERICAL" },
  { propstreamCol: "Est. Remaining balance of Open Loans",  ghlKey: "est_remaining_loan_balance", dataType: "NUMERICAL" },
  { propstreamCol: "Est. Value",                            ghlKey: "est_value",                  dataType: "NUMERICAL" },
  { propstreamCol: "Est. Loan-to-Value",                    ghlKey: "est_ltv",                    dataType: "NUMERICAL" },
  { propstreamCol: "Est. Equity",                           ghlKey: "est_equity",                 dataType: "NUMERICAL" },

  // Condition
  { propstreamCol: "Total Condition",                       ghlKey: "total_condition",            dataType: "TEXT"      },
  { propstreamCol: "Interior Condition",                    ghlKey: "interior_condition",         dataType: "TEXT"      },
  { propstreamCol: "Exterior Condition",                    ghlKey: "exterior_condition",         dataType: "TEXT"      },
  { propstreamCol: "Bathroom Condition",                    ghlKey: "bathroom_condition",         dataType: "TEXT"      },
  { propstreamCol: "Kitchen Condition",                     ghlKey: "kitchen_condition",          dataType: "TEXT"      },

  // Distress / MLS
  { propstreamCol: "Foreclosure Factor",                    ghlKey: "foreclosure_factor",         dataType: "TEXT"      },
  { propstreamCol: "MLS Status",                            ghlKey: "mls_status",                 dataType: "TEXT"      },
  { propstreamCol: "MLS Date",                              ghlKey: "mls_date",                   dataType: "DATE"      },
  { propstreamCol: "MLS Amount",                            ghlKey: "mls_amount",                 dataType: "NUMERICAL" },
  { propstreamCol: "Lien Amount",                           ghlKey: "lien_amount",                dataType: "NUMERICAL" },

  // List Management
  { propstreamCol: "Marketing Lists",                       ghlKey: "marketing_lists",            dataType: "TEXT"      },
  { propstreamCol: "Date Added to List",                    ghlKey: "date_added_to_list",         dataType: "DATE"      },
];

// ── CSV Parser ────────────────────────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

function parseCSV(content: string): Record<string, string>[] {
  const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const values = parseCSVLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = (values[idx] ?? "").trim();
    });
    rows.push(row);
  }

  return rows;
}

// ── Value Normalizers ─────────────────────────────────────────────────────────

/** Strip $, commas, %. Returns null for empty or unparseable values. */
function toNumber(raw: string): number | null {
  const cleaned = raw.replace(/[$,%]/g, "").replace(/,/g, "").trim();
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

/**
 * Normalize date to ISO YYYY-MM-DD.
 * Handles M/D/YYYY, MM/DD/YYYY, and already-ISO strings.
 */
function toDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  // MM/DD/YYYY or M/D/YYYY
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  }
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Unrecognized format — skip rather than send garbage to GHL DATE field
  console.warn(`    [warn] Unrecognized date, skipping: "${s}"`);
  return null;
}

function col(row: Record<string, string>, header: string): string {
  return (row[header] ?? "").trim();
}

// ── GHL helpers ───────────────────────────────────────────────────────────────

function ghlHeaders() {
  return {
    Authorization: `Bearer ${API_KEY}`,
    Version: "2021-07-28",
    "Content-Type": "application/json",
  };
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Returns a map of shortKey → GHL field ID for all contact custom fields. */
async function fetchFieldIdMap(): Promise<Record<string, string>> {
  const res = await fetch(`${GHL_BASE}/locations/${LOCATION_ID}/customFields`, {
    headers: ghlHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET /customFields → ${res.status}: ${text}`);
  }
  const body: any = await res.json();
  const list: any[] = body.customFields ?? body.fields ?? [];
  const map: Record<string, string> = {};
  for (const f of list) {
    const rawKey: string = f.fieldKey ?? f.key ?? "";
    const shortKey = rawKey.replace(/^contact\./, "");
    if (shortKey && f.id) map[shortKey] = f.id;
  }
  return map;
}

/** Searches GHL by query string; returns first matching contact ID or null. */
async function findContact(query: string): Promise<string | null> {
  if (!query) return null;
  const url = `${GHL_BASE}/contacts/?locationId=${LOCATION_ID}&query=${encodeURIComponent(query)}&limit=1`;
  const res = await fetch(url, { headers: ghlHeaders() });
  if (!res.ok) return null;
  const body: any = await res.json();
  return body.contacts?.[0]?.id ?? null;
}

/**
 * Creates a contact. If GHL blocks it as a duplicate, falls back to updating
 * the existing contact using the conflicting ID returned in the error body.
 * Returns [contactId, "created" | "updated"].
 */
async function createContact(
  payload: Record<string, any>
): Promise<[string, "created" | "updated"]> {
  const res = await fetch(`${GHL_BASE}/contacts/`, {
    method: "POST",
    headers: ghlHeaders(),
    body: JSON.stringify({ ...payload, locationId: LOCATION_ID }),
  });

  if (!res.ok) {
    const text = await res.text();
    // GHL duplicate guard: parse conflicting contact ID and update instead
    try {
      const err = JSON.parse(text);
      const existingId: string | undefined = err?.meta?.contactId;
      if (res.status === 400 && existingId) {
        await updateContact(existingId, payload);
        return [existingId, "updated"];
      }
    } catch {
      // not JSON — fall through to throw
    }
    throw new Error(`POST /contacts/ → ${res.status}: ${text}`);
  }

  const body: any = await res.json();
  return [body.contact?.id ?? body.id, "created"];
}

async function updateContact(contactId: string, payload: Record<string, any>): Promise<void> {
  const res = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
    method: "PUT",
    headers: ghlHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PUT /contacts/${contactId} → ${res.status}: ${text}`);
  }
}

// ── Payload Builder ───────────────────────────────────────────────────────────

function buildPayload(
  row: Record<string, string>,
  fieldIdMap: Record<string, string>
): { native: Record<string, string>; customFields: any[] } {
  // ── Native fields ──────────────────────────────────────────────────────────
  const native: Record<string, string> = {};

  const addr  = col(row, "Address");
  const unit  = col(row, "Unit #");
  const street = addr ? (unit ? `${addr} Unit ${unit}` : addr) : "";
  if (street)                       native.address1   = street;
  if (col(row, "City"))             native.city       = col(row, "City");
  if (col(row, "State"))            native.state      = col(row, "State");
  if (col(row, "Zip"))              native.postalCode = col(row, "Zip");
  if (col(row, "Owner 1 First Name")) native.firstName = col(row, "Owner 1 First Name");
  if (col(row, "Owner 1 Last Name"))  native.lastName  = col(row, "Owner 1 Last Name");
  if (col(row, "Phone 1"))          native.phone      = col(row, "Phone 1");
  if (col(row, "Email 1"))          native.email      = col(row, "Email 1");

  // ── Custom fields ──────────────────────────────────────────────────────────
  const customFields: any[] = [];

  function add(ghlKey: string, value: string | number | null | undefined) {
    if (value === null || value === undefined || value === "") return;
    const id = fieldIdMap[ghlKey];
    // GHL contacts API: use { id, field_value } when ID is known; fall back to { key }
    if (id) {
      customFields.push({ id, field_value: value });
    } else {
      customFields.push({ key: ghlKey, field_value: value });
    }
  }

  // Mailing Address (concatenated)
  const mailingAddr = col(row, "Mailing Address");
  const mailingUnit = col(row, "Mailing Unit #");
  const mailingFull = mailingAddr
    ? (mailingUnit ? `${mailingAddr} Unit ${mailingUnit}` : mailingAddr)
    : "";
  add("mailing_address", mailingFull);

  // All other custom fields from the mapping table
  for (const spec of CUSTOM_FIELD_MAP) {
    const raw = col(row, spec.propstreamCol);
    if (!raw) continue;

    switch (spec.dataType) {
      case "NUMERICAL":
        add(spec.ghlKey, toNumber(raw));
        break;
      case "DATE":
        add(spec.ghlKey, toDate(raw));
        break;
      default:
        add(spec.ghlKey, raw);
    }
  }

  return { native, customFields };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Load field ID map
  console.log("Fetching GHL custom field IDs...");
  const fieldIdMap = await fetchFieldIdMap();
  console.log(`Loaded ${Object.keys(fieldIdMap).length} custom field IDs.\n`);
  await delay(100);

  // 2. Parse CSV
  const csvContent = readFileSync(resolve(csvPath!), "utf-8");
  const allRows = parseCSV(csvContent);
  const rows = isFinite(limit) ? allRows.slice(0, limit) : allRows;
  const total = rows.length;
  console.log(`CSV: ${allRows.length} data rows${isFinite(limit) ? ` — processing first ${total}` : ""}.`);
  if (isDryRun) console.log("DRY RUN — no API calls will be made.\n");
  console.log("");

  let created = 0;
  let updated = 0;
  let failed  = 0;
  const pad   = String(total).length;

  for (let i = 0; i < rows.length; i++) {
    const row    = rows[i];
    const num    = String(i + 1).padStart(pad, " ");
    const phone  = col(row, "Phone 1");
    const email  = col(row, "Email 1");
    const label  = [col(row, "Owner 1 First Name"), col(row, "Owner 1 Last Name")].filter(Boolean).join(" ")
                || phone || email || `row ${i + 1}`;

    const { native, customFields } = buildPayload(row, fieldIdMap);
    const contactPayload = { ...native, customFields };

    if (isDryRun) {
      console.log(`[${num}/${total}] DRY RUN  ${label}`);
      console.log(JSON.stringify(contactPayload, null, 2));
      continue;
    }

    try {
      // Search by phone first, then email
      let contactId = await findContact(phone);
      await delay(100);
      if (!contactId && email) {
        contactId = await findContact(email);
        await delay(100);
      }

      if (contactId) {
        await updateContact(contactId, contactPayload);
        console.log(`[${num}/${total}] UPDATED   ${label} | id=${contactId}`);
        updated++;
      } else {
        const [newId, action] = await createContact(contactPayload);
        console.log(`[${num}/${total}] ${action === "created" ? "CREATED" : "UPDATED"}   ${label} | id=${newId}`);
        if (action === "created") created++; else updated++;
      }
    } catch (err) {
      console.error(`[${num}/${total}] FAILED    ${label} | ${err}`);
      failed++;
    }

    await delay(100); // stay under 10 req/sec
  }

  // Summary
  const line = "─".repeat(52);
  console.log(`\n${line}`);
  console.log(`SUMMARY${isDryRun ? " (dry run — no changes made)" : ""}`);
  console.log(`  Created:  ${created}`);
  console.log(`  Updated:  ${updated}`);
  console.log(`  Failed:   ${failed}`);
  console.log(`  Total:    ${total}`);
  console.log(line);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\nFatal error:", err);
  process.exit(1);
});
