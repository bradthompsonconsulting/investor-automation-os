/**
 * PropStream CSV → GHL contact importer.
 *
 * Run:    npx tsx scripts/import-propstream-csv.ts <csv-file> --env=<environment>
 *                 --credential-file=<path> --authorize-mutation=<environment>
 * Options:
 *   --env=<environment>             Required ALWAYS. Governs CONFIG RESOLUTION:
 *                 which GHL location this run addresses. production | test.
 *                 No default, no fallback. Supplying it twice refuses.
 *   --credential-file=<path>        Required ALWAYS. Names the file the GHL
 *                 credential is read from. No default, no fallback, and no
 *                 ambient environment is consulted. = syntax, not space.
 *                 Supplying it twice refuses.
 *   --authorize-mutation=<target>   Required to WRITE. Must name the same
 *                 environment as --env. Not required for --dry-run: you add
 *                 authorization to mutate, you never mutate by deleting a word.
 *                 The gate is still always evaluated and always reports, and a
 *                 DISAGREEING target refuses in every mode. Supplying it twice
 *                 refuses.
 *   --limit N     Process only first N data rows (for test runs; default: all)
 *                 SPACE syntax, unlike every other flag here. Because csvPath is
 *                 the first non-flag token, `--limit 1 data.csv` takes "1" as the
 *                 CSV path. Put the CSV path first, or omit the flag.
 *   --dry-run     Parse and print payloads without calling GHL API
 * Credential:  GHL_PRIVATE_API_KEY, read ONLY from the file named by
 *              --credential-file. Never from the ambient environment.
 *
 * Behaviour:
 *   - Fetches existing GHL custom field IDs at startup (avoids hardcoding).
 *     That same request is the PAIRING GUARD: it REFUSES, before the CSV is read
 *     and before any write, unless the named credential can read the resolved
 *     location. See fetchFieldIdMap.
 *   - Checks for existing contact by Phone 1, then Email 1
 *   - Creates new contacts or updates existing ones
 *   - Skips empty/blank field values (never writes empty strings)
 *   - Logs every contact as CREATED, UPDATED, or FAILED
 *   - Exits non-zero if any contacts failed
 */

import { parse } from "dotenv";
import { readFileSync } from "fs";
import { resolve } from "path";
import { getConfig } from "../app/shared/ghl-config";

// ── Mutation authorization (Gate 4C PRE-2) ───────────────────────────────────
//
// This script creates and updates contacts in GHL. Before PRE-2 the only thing
// between an invocation and a production write was the ABSENCE of --dry-run:
// omitting a flag authorized. A separate affirmation now takes that job away
// from it, and --dry-run keeps its original meaning as a preview switch.
//
// EVALUATED BEFORE THE CREDENTIAL, deliberately. Authorization is about INTENT;
// a credential is about CAPABILITY. Checking intent first means a refusal proof
// needs no credential present, and cannot refuse for the credential's reason
// while appearing to refuse for the gate's.
//
// ALWAYS EVALUATED, including under --dry-run. --dry-run governs whether writes
// happen, never whether the run was authorized -- otherwise the pass path could
// only ever be traversed by a run that also mutates, and there would be no way
// to prove the gate can PASS without proving it by writing to production.
//
// THE PRODUCTION-ONLY PROHIBITION WAS LIFTED HERE (2026-08-25, Jess's ruling).
// The debt it carried was DISCHARGED, not the decision overturned -- the
// prohibition named its own successor condition and this is that condition
// arriving. The history matters, so it is recorded rather than deleted:
//
//   WHAT EXISTED.  A second constant, MUTATION_TARGET = "production", and a
//   refusal comparing --authorize-mutation against it. Stair 9A's comment here
//   said it "must not become derived from ENV", because at that time a derived
//   target would have made --env=test --authorize-mutation=test agree with
//   itself and opened a Test write as a SIDE EFFECT of a config conversion.
//
//   WHY IT EXISTED.  Not the ceremony -- two agreeing flags was never the
//   barrier. It existed because nothing in this file checked that the credential
//   and the resolved location belonged to the same GHL sub-account, so a Test
//   write authorized by flags alone could have been issued with whatever
//   credential ambient state happened to supply. That same comment called the
//   prohibition "a standing decision with its own sandbox-readiness debt".
//
//   WHAT DISCHARGED IT.  Two changes in this commit, in this order and in one
//   commit because the order is load-bearing. The credential is now NAMED
//   (--credential-file, below) rather than inherited from the environment, and
//   the /customFields request that already precedes every write path is now a
//   PAIRING GUARD that refuses unless the named credential can read the resolved
//   location. See fetchFieldIdMap. The barrier moved from "Test is forbidden" to
//   "the credential and the location must agree", which is the property the
//   prohibition was standing in for.
//
//   WHAT REMAINS.  ENV, parsed from --env, governs CONFIG RESOLUTION. The
//   agreement check below is now the whole flag rule: the two flags must name
//   the same environment. Test gets exactly the ceremony Production gets --
//   SYMMETRIC, deliberately. An asymmetry here reads to a future maintainer as
//   "Test is the lax path", and a sandbox nobody dares use is not a sandbox.
//
//   ⚠ ONE CONSEQUENCE, NAMED SO IT IS NOT DISCOVERED. With MUTATION_TARGET gone,
//   nothing in THIS file names which environments are mutable. The mutable set is
//   now whatever getConfig accepts -- today exactly production | test. A third
//   environment added to ghl-config.ts becomes mutable here automatically, with
//   no decision recorded in this file. Same shape as the PUT-provenance hazard
//   noted at updateContact.
const KNOWN_FLAGS = ["--env", "--authorize-mutation", "--credential-file", "--dry-run", "--limit"];

const rawArgs = process.argv.slice(2);

for (const a of rawArgs) {
  if (!a.startsWith("--")) continue;
  const name = a.split("=")[0];
  if (!KNOWN_FLAGS.includes(name)) {
    console.error(`ERROR: unrecognized argument ${name}. Refusing rather than ignoring it.`);
    process.exit(2);
  }
}

// ── Environment selection (Gate 4C C4a, Stair 9A) ────────────────────────────
//
// EVALUATED BEFORE CONFIG RESOLUTION AND BEFORE ANY NETWORK CALL. Every refusal
// below exits while LOCATION_ID is still unbound and long before the first
// fetch, so no request can be issued under an environment nobody named.
//
// DUPLICATE FIRST, mirroring --authorize-mutation below and for the same
// reason: .find() would honour one value and discard the operator's last word,
// and this flag decides which location the run addresses.
const envArgs = rawArgs.filter((a) => a.split("=")[0] === "--env");
if (envArgs.length > 1) {
  console.error(
    `ERROR: duplicated environment flag — --env was supplied ${envArgs.length} times. ` +
      "Refusing: honouring either one would let an edited command line select an environment " +
      "nobody read.",
  );
  process.exit(2);
}

const envArg = envArgs[0];
const ENV =
  envArg === undefined ? null : envArg.includes("=") ? envArg.slice(envArg.indexOf("=") + 1) : "";

if (ENV === null) {
  console.error(
    "ERROR: --env=<environment> is required. There is no default and no fallback environment. " +
      "Expected --env=production or --env=test.",
  );
  process.exit(2);
}

// CASE SENSITIVITY IS DELIBERATE AND LOAD-BEARING. getConfig rejects
// "Production" as an unknown selector, and that refusal is kept rather than
// normalised away: the target-named affirmation doctrine rests on the
// operator's exact words, and a selector that accepts variants is a selector
// that can be typed two ways.
//
// The throw is CAUGHT rather than allowed to surface. Every other refusal in
// this file prints a named cause; an uncaught throw would print a stack trace
// instead, which is the wrong direction of travel for a file being converted.
// Named ghlConfig, not config, because `config` names nothing in particular in a
// file that resolves a GHL configuration AND reads a credential file. (Until
// this commit there was a second reason -- dotenv's config() was imported into
// this scope and shadowing it would have been a redeclaration error. That import
// is gone; only parse() remains, so the hazard is gone and the name is kept on
// its own merits.)
let ghlConfig;
try {
  ghlConfig = getConfig(ENV);
} catch (e) {
  console.error(
    `ERROR: --env=${JSON.stringify(ENV)} did not resolve to a configuration. ` +
      `Underlying reason: ${(e as Error).message}`,
  );
  process.exit(2);
}

// REPORTS THE RESOLVED VALUE, NOT ONLY THE SELECTOR. Printing "--env=production"
// proves which selector was parsed; it does not prove what that selector
// resolved to, and the entire risk of this conversion is contacts landing in
// the wrong location. The locationId below is the value that reaches the
// customFields GET, the duplicate lookup, and the contact-creation POST body.
console.log(`ENVIRONMENT — --env=${ENV} resolved to locationId ${ghlConfig.locationId}`);

// DUPLICATE FIRST, and it refuses regardless of order or values. .find() would
// return the first match and silently discard the rest, so
// --authorize-mutation=production --authorize-mutation=test would PASS while
// the operator's last word was ignored. That is the edited-saved-command-line
// case a target-named affirmation exists to defend against, failing open.
const authArgs = rawArgs.filter((a) => a.split("=")[0] === "--authorize-mutation");
if (authArgs.length > 1) {
  console.error(
    `ERROR: duplicated authorization flag — --authorize-mutation was supplied ${authArgs.length} ` +
      "times. Refusing: honouring either one would let an edited command line authorize a " +
      "target nobody read.",
  );
  process.exit(2);
}

const authArg = authArgs[0];
const authValue =
  authArg === undefined ? null : authArg.includes("=") ? authArg.slice(authArg.indexOf("=") + 1) : "";

// ── THE FLAG RULE: THE TWO FLAGS MUST AGREE ──────────────────────────────────
//
// Until this commit this was "refusal 1 of 2" and a production-only prohibition
// followed it. The prohibition is gone (see above), so this is now the whole
// flag rule:
//
//   --env=production --authorize-mutation=test        -> DISAGREEMENT (here)
//   --env=test       --authorize-mutation=production   -> DISAGREEMENT (here)
//   --env=test       --authorize-mutation=test         -> agrees, AUTHORIZED
//   --env=production --authorize-mutation=production   -> agrees, AUTHORIZED
//
// The third row is the state this commit exists to create. What stops a Test
// authorization from writing with a Production credential is no longer a flag
// comparison -- it is the pairing guard in fetchFieldIdMap, which refuses unless
// the NAMED credential can read the RESOLVED location.
if (authValue !== null && authValue !== ENV) {
  console.error(
    `ERROR: environment disagreement. --env named ${JSON.stringify(ENV)} but ` +
      `--authorize-mutation named ${JSON.stringify(authValue)}. Your two flags name different ` +
      "environments. Refusing in every mode, including --dry-run.",
  );
  process.exit(2);
}

// POLARITY: you ADD authorization to mutate; you never mutate by DELETING a
// word. Requiring authorization for a preview made the step from safe to
// dangerous "delete --dry-run from a line that already says production", which
// reconstructs omission-authorizes one layer up. So a preview needs no
// authorization -- but the gate is still ALWAYS evaluated and ALWAYS reports.
if (authValue === null) {
  if (rawArgs.includes("--dry-run")) {
    console.log(
      "NOT AUTHORIZED — preview only. No mutation authorization was supplied, so no writes " +
        "will be attempted.",
    );
  } else {
    console.error(
      "ERROR: mutation authorization is required. This script writes to GHL. Supply " +
        `--authorize-mutation=${ENV} to write, or --dry-run to preview without writing.`,
    );
    process.exit(2);
  }
} else {
  console.log(
    `AUTHORIZATION PASSED — mutation authorized for target "${ENV}" by --authorize-mutation=${authValue}`,
  );
}

const GHL_BASE    = "https://services.leadconnectorhq.com";
/* THE CONVERSION (Gate 4C C4a, Stair 9A). One identity, one resolution site,
   one executable occurrence. CONFIG-owned: locationId.

   ⚠ THIS VALUE REACHES A MUTATING CALL. Unlike rescore-all.ts — whose
   LOCATION_ID constrains only what is enumerated, its writes being targeted by
   IAOS_ENV on a different deployment — this binding is spread into the contact-
   creation POST body below and decides which GHL location receives created
   contacts. It also scopes the duplicate lookup whose result the update PUT
   then modifies. Resolution scope MODULE, consumption scope MODULE. */
const LOCATION_ID = ghlConfig.locationId;

// ── Credential source (Gate 4C sandbox, items 1 and 2) ───────────────────────
//
// EVALUATED AFTER THE AUTHORIZATION GATE, deliberately -- and this file already
// argued for the ordering at the top: authorization is about INTENT, a credential
// is about CAPABILITY, and checking intent first means a refusal proof needs no
// credential present and cannot refuse for the credential's reason while
// appearing to refuse for the gate's. Every refusal above still exits before a
// single byte of credential is read, exactly as it did before this commit.
//
// THE CREDENTIAL FILE IS THE CREDENTIAL SELECTOR. Required always, no default
// and no fallback, and the token is read ONLY from that file's parsed contents.
// Both environments use the same variable name, GHL_PRIVATE_API_KEY, so WHICH
// FILE IS NAMED is the whole of the decision -- which is why it is reported.
//
// ⚠ = SYNTAX, NOT SPACE. csvPath below is the first non-flag token, so
// `--credential-file .env.test data.csv` would take ".env.test" as the CSV path
// and never see the file. --limit is the standing exception in this file and its
// space syntax is a trap for the same reason; one flag syntax per file, and this
// flag is on the sane side of it.
//
// WHAT THIS REPLACED, AND WHY IT WAS NOT SAFE. Until this commit the credential
// arrived from process.env after a bare dotenv config(), which resolves .env
// against process.cwd() and does NOT overwrite a value already present. Three
// consequences, all measured: an ambient GHL_PRIVATE_API_KEY silently won and
// nothing reported it; `-r dotenv/config` with DOTENV_CONFIG_PATH selected any
// file it liked; and running from another directory read a different .env, or
// none at all. Whether this tool had a credential AT ALL depended on which
// directory you were standing in, and the only signal was a third-party banner
// that is easy to miss.
//
// parse(), NOT config(). config() writes into process.env and does not overwrite
// what is already there, so a tool that called config({ path }) and then read
// process.env could use an ambient value while the named file was silently
// discarded -- satisfying "loads only the named file" while violating "reads only
// that file's contents". parse() returns the file's contents as a plain object
// and never touches process.env, so ambient state cannot participate at all.
// There are no process.env reads left in this file and the static exit-contract
// test asserts it; process.argv reads remain and are correct.
//
// DUPLICATE FIRST, mirroring --env and --authorize-mutation above and for the
// same reason: honouring one value and discarding the operator's last word is
// the edited-saved-command-line failure, and this flag decides which credential
// the run uses.
const credentialArgs = rawArgs.filter((a) => a.split("=")[0] === "--credential-file");
if (credentialArgs.length > 1) {
  console.error(
    `ERROR: duplicated credential flag — --credential-file was supplied ${credentialArgs.length} ` +
      "times. Refusing: honouring either one would let an edited command line select a " +
      "credential nobody read.",
  );
  process.exit(2);
}

const credentialArg = credentialArgs[0];
const CREDENTIAL_FILE =
  credentialArg === undefined
    ? null
    : credentialArg.includes("=")
      ? credentialArg.slice(credentialArg.indexOf("=") + 1)
      : "";

if (CREDENTIAL_FILE === null) {
  console.error(
    "ERROR: --credential-file=<path> is required. There is no default and no fallback; name " +
      "the file the GHL credential is read from. Both environments use the same variable name, " +
      "so which file is named IS the credential selection.",
  );
  process.exit(2);
}

let credentialText: string;
try {
  credentialText = readFileSync(CREDENTIAL_FILE, "utf8");
} catch {
  console.error(
    `ERROR: the credential file ${JSON.stringify(CREDENTIAL_FILE)} could not be read. No ` +
      "credential was loaded and no request was issued.",
  );
  process.exit(2);
}

const API_KEY = parse(credentialText).GHL_PRIVATE_API_KEY;

if (API_KEY === undefined) {
  console.error(
    `ERROR: GHL_PRIVATE_API_KEY is absent from the credential file ` +
      `${JSON.stringify(CREDENTIAL_FILE)}. There is no fallback to the ambient environment, ` +
      "and no other file is consulted.",
  );
  process.exit(2);
}

if (API_KEY.trim() === "") {
  console.error(
    `ERROR: GHL_PRIVATE_API_KEY is present but blank in the credential file ` +
      `${JSON.stringify(CREDENTIAL_FILE)}.`,
  );
  process.exit(2);
}

// THE PATH, NEVER THE VALUE. Which file was named is the decision this run made
// and it belongs in the evidence; the credential itself belongs nowhere. This is
// also the first time this tool has ever said what it is using.
console.log(`CREDENTIAL SOURCE — ${CREDENTIAL_FILE}`);

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

/**
 * Returns a map of shortKey → GHL field ID for all contact custom fields.
 *
 * ── THIS IS ALSO THE PAIRING GUARD (Gate 4C sandbox, item 4) ────────────────
 *
 * It is not an added request. This call already existed and already ran before
 * every write path -- it is the FIRST statement of main(), ahead of the CSV read
 * and the row loop, and its failure cannot be caught between here and the
 * process-level handler. Making its error branch a refusal turns a request the
 * tool already had to make into the barrier that replaces the production-only
 * prohibition removed above. Fewer permissions and no extra round trip; 9B's
 * equivalent check uses GET /locations/{id}, and the Test PIT was measured on
 * 2026-08-25 returning 401 on that endpoint while returning 200 here. Porting
 * 9B unchanged would have failed under Test -- the environment it exists to
 * protect.
 *
 * WHAT IT PROVES.  That the named credential and the resolved location belong to
 * the same GHL sub-account -- ENVIRONMENT AGREEMENT. A PIT is issued against one
 * sub-account; the Production credential was measured getting 403 on the Test
 * location. So a credential that can read location X belongs to X, and a write
 * carrying X in its body goes to X. This is the safety property.
 *
 * WHAT IT DOES NOT PROVE.  That the credential may WRITE there. Scopes on a PIT
 * are not uniform -- that is measured, not feared. A capability failure surfaces
 * at the POST as a refusal and nothing lands anywhere: a failed run, not a
 * misdirected write.
 *
 * ⚠ WHY THIS IS WORTH MORE THAN FAILING FAST. When a POST body's locationId
 * disagrees with the credential's sub-account, we do not know whether GHL refuses
 * or ignores the body and writes to the credential's own location. That cannot be
 * measured without attempting exactly the cross-environment write this guard
 * exists to prevent. The guard's value is that it makes an unmeasured -- and
 * un-measurable-without-risk -- GHL behaviour IRRELEVANT. Do not delete it on the
 * reasoning that GHL would reject a mismatch anyway; that is the thing nobody has
 * established.
 */
async function fetchFieldIdMap(): Promise<Record<string, string>> {
  const res = await fetch(`${GHL_BASE}/locations/${LOCATION_ID}/customFields`, {
    headers: ghlHeaders(),
  });
  // STATUS ONLY, NEVER THE BODY -- a GHL error body can echo request context.
  // The body is not read at all rather than merely left out of the message:
  // not-interpolating is a convention anyone can undo without noticing.
  if (!res.ok) {
    console.error(
      `ERROR: the credential in ${CREDENTIAL_FILE} could not read the location resolved by ` +
        `--env=${ENV} (${LOCATION_ID}). GHL answered ${res.status}. This does not identify which ` +
        "environment the credential belongs to — only that the pairing is unconfirmed. Refusing " +
        "rather than writing against an unverified pairing.",
    );
    process.exit(2);
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

/**
 * ⚠ THIS PUT CARRIES NO locationId. Unlike the POST above -- where LOCATION_ID is
 * spread last into the body and cannot be shadowed -- this request is bound to a
 * location only by the PROVENANCE of its contactId. It is safe today because
 * both sources are location-scoped: findContact queries with locationId in the
 * URL, and the duplicate-conflict id comes from GHL's own response to a POST that
 * carried locationId. A contactId arriving from any source that is NOT
 * location-scoped would be written regardless of --env, and nothing in this file
 * would object.
 */
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
