/**
 * Create PropStream custom fields in GHL (Parts 2 + 5 of field mapping spec).
 *
 * Run:  npx tsx scripts/create-ghl-custom-fields.ts
 * Env:  GHL_PRIVATE_API_KEY — set in shell or .env file
 *
 * Note: project uses tsx, not ts-node. Use the command above, not npx ts-node.
 */

import { config } from "dotenv";
config();

const GHL_BASE = "https://services.leadconnectorhq.com";
const LOCATION_ID = "jmHG4B8RdzwpfqruNf68";
const API_KEY = process.env.GHL_PRIVATE_API_KEY;

if (!API_KEY) {
  console.error("ERROR: GHL_PRIVATE_API_KEY is not set.");
  console.error("  Set it in your shell: export GHL_PRIVATE_API_KEY=pit-...");
  console.error("  Or add it to a .env file in the repo root.");
  process.exit(1);
}

type DataType = "TEXT" | "NUMERICAL" | "DATE";

interface FieldDef {
  key: string;      // short key without "contact." prefix
  name: string;     // display name shown in GHL UI
  dataType: DataType;
}

// 54 fields: Parts 2 + 5 of spec. phone_type (Part 3) already exists — excluded.
const FIELDS: FieldDef[] = [
  // ── Property / Location ──────────────────────────────────────────────────
  { key: "county",                     name: "County",                       dataType: "TEXT"      },
  { key: "apn",                        name: "APN",                          dataType: "TEXT"      },

  // ── Phone Fields (2–5) ───────────────────────────────────────────────────
  { key: "phone_1_dnc",                name: "Phone 1 DNC",                  dataType: "TEXT"      },
  { key: "phone_2",                    name: "Phone 2",                      dataType: "TEXT"      },
  { key: "phone_2_dnc",               name: "Phone 2 DNC",                  dataType: "TEXT"      },
  { key: "phone_3",                    name: "Phone 3",                      dataType: "TEXT"      },
  { key: "phone_3_dnc",               name: "Phone 3 DNC",                  dataType: "TEXT"      },
  { key: "phone_4",                    name: "Phone 4",                      dataType: "TEXT"      },
  { key: "phone_4_dnc",               name: "Phone 4 DNC",                  dataType: "TEXT"      },
  { key: "phone_5",                    name: "Phone 5",                      dataType: "TEXT"      },
  { key: "phone_5_dnc",               name: "Phone 5 DNC",                  dataType: "TEXT"      },

  // ── Email Fields ─────────────────────────────────────────────────────────
  { key: "email_2",                    name: "Email 2",                      dataType: "TEXT"      },
  { key: "email_3",                    name: "Email 3",                      dataType: "TEXT"      },
  { key: "email_4",                    name: "Email 4",                      dataType: "TEXT"      },

  // ── Ownership ────────────────────────────────────────────────────────────
  { key: "owner_occupied",             name: "Owner Occupied",               dataType: "TEXT"      },
  { key: "owner_2_first_name",         name: "Owner 2 First Name",           dataType: "TEXT"      },
  { key: "owner_2_last_name",          name: "Owner 2 Last Name",            dataType: "TEXT"      },
  { key: "litigator",                  name: "Litigator",                    dataType: "TEXT"      },
  { key: "mailing_care_of_name",       name: "Mailing Care of Name",         dataType: "TEXT"      },

  // ── Mailing Address ──────────────────────────────────────────────────────
  { key: "mailing_address",            name: "Mailing Address",              dataType: "TEXT"      },
  { key: "mailing_city",               name: "Mailing City",                 dataType: "TEXT"      },
  { key: "mailing_state",              name: "Mailing State",                dataType: "TEXT"      },
  { key: "mailing_zip",                name: "Mailing Zip",                  dataType: "TEXT"      },
  { key: "mailing_county",             name: "Mailing County",               dataType: "TEXT"      },
  { key: "do_not_mail",                name: "Do Not Mail",                  dataType: "TEXT"      },

  // ── Property Detail ──────────────────────────────────────────────────────
  { key: "property_status",            name: "Property Status",              dataType: "TEXT"      },
  { key: "property_notes",             name: "Property Notes",               dataType: "TEXT"      },
  { key: "property_type",              name: "Property Type",                dataType: "TEXT"      },
  { key: "bedrooms",                   name: "Bedrooms",                     dataType: "NUMERICAL" },
  { key: "total_bathrooms",            name: "Total Bathrooms",              dataType: "NUMERICAL" },
  { key: "building_sqft",              name: "Building Sqft",                dataType: "NUMERICAL" },
  { key: "lot_size_sqft",              name: "Lot Size Sqft",                dataType: "NUMERICAL" },
  { key: "effective_year_built",       name: "Effective Year Built",         dataType: "NUMERICAL" },

  // ── Financial ────────────────────────────────────────────────────────────
  { key: "total_assessed_value",       name: "Total Assessed Value",         dataType: "NUMERICAL" },
  { key: "last_sale_date",             name: "Last Sale Date",               dataType: "DATE"      },
  { key: "last_sale_amount",           name: "Last Sale Amount",             dataType: "NUMERICAL" },
  { key: "total_open_loans",           name: "Total Open Loans",             dataType: "NUMERICAL" },
  { key: "est_remaining_loan_balance", name: "Est. Remaining Loan Balance",  dataType: "NUMERICAL" },
  { key: "est_value",                  name: "Est. Value",                   dataType: "NUMERICAL" },
  { key: "est_ltv",                    name: "Est. Loan-to-Value",           dataType: "NUMERICAL" },
  { key: "est_equity",                 name: "Est. Equity",                  dataType: "NUMERICAL" },

  // ── Condition ────────────────────────────────────────────────────────────
  { key: "total_condition",            name: "Total Condition",              dataType: "TEXT"      },
  { key: "interior_condition",         name: "Interior Condition",           dataType: "TEXT"      },
  { key: "exterior_condition",         name: "Exterior Condition",           dataType: "TEXT"      },
  { key: "bathroom_condition",         name: "Bathroom Condition",           dataType: "TEXT"      },
  { key: "kitchen_condition",          name: "Kitchen Condition",            dataType: "TEXT"      },

  // ── Distress / MLS ───────────────────────────────────────────────────────
  { key: "foreclosure_factor",         name: "Foreclosure Factor",           dataType: "TEXT"      },
  { key: "mls_status",                 name: "MLS Status",                   dataType: "TEXT"      },
  { key: "mls_date",                   name: "MLS Date",                     dataType: "DATE"      },
  { key: "mls_amount",                 name: "MLS Amount",                   dataType: "NUMERICAL" },
  { key: "lien_amount",                name: "Lien Amount",                  dataType: "NUMERICAL" },

  // ── List Management ──────────────────────────────────────────────────────
  { key: "marketing_lists",            name: "Marketing Lists",              dataType: "TEXT"      },
  { key: "date_added_to_list",         name: "Date Added to List",           dataType: "DATE"      },

  // ── Part 5 — Computed output (never imported from CSV) ───────────────────
  { key: "motivation_score",           name: "Motivation Score",             dataType: "NUMERICAL" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function ghlHeaders() {
  return {
    Authorization: `Bearer ${API_KEY}`,
    Version: "2021-07-28",
    "Content-Type": "application/json",
  };
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Normalize a raw GHL fieldKey to a short key for comparison. */
function normalize(raw: string): string {
  return raw.replace(/^contact\./, "").toLowerCase().trim();
}

// ── API calls ────────────────────────────────────────────────────────────────

async function fetchExistingKeys(): Promise<Set<string>> {
  const url = `${GHL_BASE}/locations/${LOCATION_ID}/customFields`;
  const res = await fetch(url, { headers: ghlHeaders() });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET /customFields → ${res.status}: ${text}`);
  }
  const body: any = await res.json();
  // GHL returns the array under either "customFields" or "fields"
  const list: any[] = body.customFields ?? body.fields ?? [];
  const keys = new Set<string>();
  for (const f of list) {
    if (f.fieldKey) keys.add(normalize(f.fieldKey));
    if (f.key)      keys.add(normalize(f.key));
  }
  return keys;
}

async function createField(field: FieldDef): Promise<void> {
  const url = `${GHL_BASE}/locations/${LOCATION_ID}/customFields`;
  const res = await fetch(url, {
    method: "POST",
    headers: ghlHeaders(),
    body: JSON.stringify({
      name: field.name,
      dataType: field.dataType,
      fieldKey: field.key,  // explicit key; GHL may prepend "contact."
      model: "contact",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`GHL Custom Field Creator — ${FIELDS.length} fields to process\n`);
  console.log("Fetching existing custom fields...");
  const existing = await fetchExistingKeys();
  console.log(`Found ${existing.size} existing keys.\n`);
  await delay(100);

  let created = 0;
  let alreadyExists = 0;
  let failed = 0;

  for (const field of FIELDS) {
    if (existing.has(field.key)) {
      console.log(`ALREADY EXISTS  ${field.key}`);
      alreadyExists++;
    } else {
      try {
        await createField(field);
        console.log(`CREATED         ${field.key}  (${field.name} / ${field.dataType})`);
        created++;
      } catch (err) {
        console.error(`FAILED          ${field.key}  — ${err}`);
        failed++;
      }
    }
    await delay(100); // stay under 10 req/sec
  }

  const line = "─".repeat(52);
  console.log(`\n${line}`);
  console.log(`SUMMARY`);
  console.log(`  Created:        ${created}`);
  console.log(`  Already exist:  ${alreadyExists}`);
  console.log(`  Failed:         ${failed}`);
  console.log(`  Total:          ${FIELDS.length}`);
  console.log(line);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\nFatal error:", err);
  process.exit(1);
});
