/**
 * Fetches all contacts from GHL and re-scores each via the live endpoint.
 *
 * Run: npx tsx scripts/rescore-all.ts --credential-file=.env --dry-run
 *
 * THE LINE ABOVE IS THE ONLY RUNNABLE LINE IN THIS DOCBLOCK, AND IT STOPS
 * BEFORE THE FIRST WRITE. That is deliberate. An invocation printed in a
 * docblock is instruction shaped -- it gets copied, not read -- so the one on
 * offer here is the one
 * that is safe to copy. To actually write, you must add --authorize-mutation
 * with the target named, and remove --dry-run: two edits to a line that
 * announces what it does, rather than one paste that quietly rewrites every
 * contact in the location. No mutating invocation is written out below, for
 * the same reason.
 *
 * Required to WRITE: --authorize-mutation=<target>, naming the environment this
 * script targets. There is no default, and a wrong target refuses in every mode.
 *
 * Required ALWAYS: --credential-file=<path>, naming the file the GHL credential
 * is read from. There is no default and no fallback. Both environments use the
 * same variable name, GHL_PRIVATE_API_KEY, so WHICH FILE IS NAMED IS the
 * environment selection -- an inherited shell value must never be able to make
 * that choice silently.
 *
 * Not required for --dry-run, which enumerates every contact and stops at the
 * scoring loop: you add authorization to mutate, you never mutate by deleting a
 * word.
 *
 * This is a BULK PRODUCTION WRITER. It enumerates every contact in the location
 * and POSTs each to the deployed motivation-score function, which writes four
 * score fields and sets a bucket tag per contact. This script's own token
 * authorizes only the enumeration GET; the writes are performed by that
 * function under its own separate credential.
 */

import { readFileSync } from "node:fs";
import { parse as parseEnvFile } from "dotenv";

// ── Mutation authorization (Gate 4C PRE-2) ───────────────────────────────────
//
// Before PRE-2 this file parsed no arguments at all, so there was no invocation
// that was not a full production run -- appending a flag such as --help was
// ignored and every contact in the location was rewritten. The parser arrives
// here with the gate, and only what the gate needs. --dry-run arrived in PRE-3
// and --credential-file in PRE-4, each kept to its own commit so each is
// independently reviewable.
//
// EVALUATED BEFORE THE CREDENTIAL, deliberately. Authorization is about INTENT;
// a credential is about CAPABILITY. Checking intent first means a refusal proof
// needs no credential present, and cannot refuse for the credential's reason
// while appearing to refuse for the gate's.
//
// MUTATION_TARGET names the environment the hardcoded LOCATION_ID below
// addresses. Gate 4C Phase 2 replaces it with the environment-derived target;
// only where the comparand comes from changes, never the comparison itself.
const MUTATION_TARGET = "production";
// This allowlist has NO `startsWith("--")` escape, unlike the importer's, which
// must admit a positional CSV path. Here every token that is not an allowlisted
// flag refuses. That is correct -- this script takes no positionals -- but it
// means --credential-file must use this file's `=` syntax: the capture tool's
// space-separated `--credential-file <path>` would have its PATH refused at the
// loop below as an unrecognized argument. One flag syntax per file.
const KNOWN_FLAGS = ["--authorize-mutation", "--dry-run", "--credential-file"];

const rawArgs = process.argv.slice(2);

for (const a of rawArgs) {
  const name = a.split("=")[0];
  if (!KNOWN_FLAGS.includes(name)) {
    console.error(`ERROR: unrecognized argument ${name}. Refusing rather than ignoring it.`);
    process.exit(2);
  }
}

// DUPLICATE FIRST, refusing regardless of order or values. .find() returned the
// first match and discarded the rest, so
// --authorize-mutation=production --authorize-mutation=test PASSED while the
// operator's last word was ignored -- failing open in exactly the
// edited-saved-command-line case this affirmation defends against.
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

// A WRONG TARGET REFUSES IN EVERY MODE, --dry-run included.
if (authValue !== null && authValue !== MUTATION_TARGET) {
  console.error(
    `ERROR: authorization mismatch. --authorize-mutation named ${JSON.stringify(authValue)}, ` +
      `but this script targets ${JSON.stringify(MUTATION_TARGET)}. Refusing in every mode, ` +
      "including --dry-run.",
  );
  process.exit(2);
}

// POLARITY: you ADD authorization to mutate; you never mutate by DELETING a
// word. A preview therefore needs no authorization -- but the gate is still
// ALWAYS evaluated and ALWAYS reports.
const IS_PREVIEW = rawArgs.includes("--dry-run");
if (authValue === null) {
  if (IS_PREVIEW) {
    console.log(
      "NOT AUTHORIZED — preview only. No mutation authorization was supplied, so no writes " +
        "will be attempted.",
    );
  } else {
    console.error(
      "ERROR: mutation authorization is required. This script re-scores every contact in the " +
        `location. Supply --authorize-mutation=${MUTATION_TARGET} to write, or --dry-run to ` +
        "enumerate without writing.",
    );
    process.exit(2);
  }
} else {
  console.log(
    `AUTHORIZATION PASSED — mutation authorized for target "${MUTATION_TARGET}" by --authorize-mutation=${authValue}`,
  );
}

// ── Credential source (Gate 4C PRE-4) ────────────────────────────────────────
//
// SECOND, always after the authorization gate above. Authorization is INTENT and
// a credential is CAPABILITY, so intent is settled first -- which also means
// there is no way to reach this gate without having already satisfied the
// production authorization.
//
// Extracted here; read inside the async main, before the first request.
//
// DUPLICATE FIRST, mirroring the --authorize-mutation check above, because this
// flag is the same class: it decides which environment's credential is used, so
// a first-wins .find() would run against one file while the operator's last word
// named another. Refusing costs nothing; a credential nobody read is the whole
// failure this flag exists to prevent.
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
const credentialFile =
  credentialArg === undefined
    ? null
    : credentialArg.includes("=")
      ? credentialArg.slice(credentialArg.indexOf("=") + 1)
      : "";

const GHL_BASE    = "https://services.leadconnectorhq.com";
const LOCATION_ID = "jmHG4B8RdzwpfqruNf68";
const SCORE_URL   = "https://investor-automation-os.netlify.app/.netlify/functions/motivation-score";
const DELAY_MS    = 250; // ~4 req/sec — stay safe

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

interface ContactMeta { id: string; firstName: string; lastName: string; }

// TOKEN IS A PARAMETER, not module state. The module-level `const TOKEN` this
// replaced was assigned from process.env at import time, which made the
// credential ambient: every function in the file could reach it, and nothing
// recorded where it came from. Threading it explicitly means the only way this
// function gets a token is for a caller to hand it one that the credential gate
// resolved from a named file.
async function fetchAllIds(token: string): Promise<ContactMeta[]> {
  const all: ContactMeta[] = [];
  let startAfterId: string | undefined;
  let startAfter: number | undefined;

  while (true) {
    const params = new URLSearchParams({ locationId: LOCATION_ID, limit: "100" });
    if (startAfterId) params.set("startAfterId", startAfterId);
    if (startAfter)   params.set("startAfter",   String(startAfter));

    const res  = await fetch(`${GHL_BASE}/contacts?${params}`, {
      headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28" },
    });
    const body = await res.json() as any;
    if (!res.ok) throw new Error(`GET /contacts → ${res.status}: ${JSON.stringify(body)}`);

    const batch: any[] = body.contacts ?? [];
    all.push(...batch.map((c: any) => ({ id: c.id, firstName: c.firstName ?? "", lastName: c.lastName ?? "" })));

    const meta = body.meta ?? {};
    if (!meta.startAfterId || batch.length < 100) break;
    startAfterId = meta.startAfterId;
    startAfter   = meta.startAfter;
    await delay(110);
  }

  return all;
}

async function score(contact: ContactMeta): Promise<any> {
  const res = await fetch(SCORE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contactId: contact.id }),
  });
  if (!res.ok) {
    const text = await res.text();
    return { error: `${res.status}: ${text}` };
  }
  return res.json();
}

(async () => {
  // The `if (!TOKEN)` guard that stood here is gone, deliberately. It tested a
  // falsy string, which `?? ""` guaranteed it would never see as anything but
  // "" -- so it could report "not set" but never report WHICH source was
  // consulted or that the wrong one was. The four refusals below replace it and
  // test the conditions that actually matter.
  if (credentialFile === null) {
    console.error(
      "ERROR: --credential-file is required. There is no default and no fallback; name the " +
        "file the GHL credential is read from. Both environments use the same variable name, " +
        "so which file is named IS the environment selection.",
    );
    process.exit(2);
  }

  // dotenv.parse(), NOT dotenv.config(). config() writes into process.env and,
  // critically, does NOT overwrite a value already present there -- so a tool
  // that called config({ path }) and then read process.env.GHL_PRIVATE_API_KEY
  // could silently use an ambient shell value while the named file was ignored:
  // the file loads, its variable is discarded, and nothing reports it. That
  // would satisfy "loads only the named file" while violating "reads only that
  // file's contents". parse() returns the file's contents as a plain object and
  // never touches process.env, so ambient state cannot participate at all.
  let envText: string;
  try {
    envText = readFileSync(credentialFile, "utf8");
  } catch {
    console.error(
      `ERROR: --credential-file ${credentialFile} could not be read. No credential was loaded ` +
        "and no request was issued.",
    );
    process.exit(2);
  }

  const fileVars = parseEnvFile(envText);
  const token = fileVars.GHL_PRIVATE_API_KEY;
  if (token === undefined) {
    console.error(
      `ERROR: GHL_PRIVATE_API_KEY is not present in ${credentialFile}. There is no fallback to ` +
        "the ambient environment, and no other file is consulted.",
    );
    process.exit(2);
  }
  if (token.trim() === "") {
    console.error(`ERROR: GHL_PRIVATE_API_KEY is present but empty in ${credentialFile}.`);
    process.exit(2);
  }

  console.log(`CREDENTIAL SOURCE — ${credentialFile}`);

  console.log("Fetching contacts from GHL...");
  const contacts = await fetchAllIds(token);

  // ── Positive control (Gate 4C PRE-3) ───────────────────────────────────────
  //
  // THE LOOP BELOW IS THE ONLY WRITER IN THIS FILE. Everything above this line
  // is enumeration: fetchAllIds() issues GET /contacts and nothing else, and no
  // other call site in this module uses a method other than GET. Stopping HERE
  // therefore makes --dry-run a proof and not a claim -- the run reaches the
  // last instruction before the first write, reports what it would have
  // written to, and exits.
  //
  // A refusal proves a gate CAN refuse. It cannot prove the gate would have
  // ALLOWED anything, because a script that exits 2 on every input passes every
  // refusal test. This path is the control: it runs the whole enumeration
  // against the real location, returns a count only a real run could produce,
  // and exits 0 -- which is the evidence that the four refusals are refusing
  // something real.
  if (IS_PREVIEW) {
    console.log(
      `PREVIEW COMPLETE — enumerated ${contacts.length} contacts. Stopping before the scoring ` +
        "loop, which is the only writer in this file. No POST was issued and no contact was " +
        "modified.",
    );
    process.exit(0);
  }

  console.log(`Found ${contacts.length} contacts. Re-scoring via live endpoint...\n`);

  const rows: Array<{
    name: string;
    motivation: number; deal: number; combined: number; completeness: number;
    bucketTag: string;
    suppressed: boolean; error?: string;
  }> = [];

  for (const c of contacts) {
    const res = await score(c);
    const name = `${c.firstName} ${c.lastName}`.trim() || c.id;
    if (res.error) {
      rows.push({ name, motivation: 0, deal: 0, combined: 0, completeness: 0, bucketTag: "?", suppressed: false, error: res.error });
      console.log(`  ✗ ${name}: ${res.error}`);
    } else {
      const row = {
        name,
        motivation:   res.motivationScore   ?? 0,
        deal:         res.dealScore         ?? 0,
        combined:     res.combinedScore     ?? 0,
        completeness: res.completenessScore ?? 0,
        bucketTag:    res.bucketTag         ?? "?",
        suppressed:   res.suppressed        ?? false,
      };
      rows.push(row);
      const sup = row.suppressed ? " [SUPP]" : "";
      console.log(
        `  ${name.padEnd(28)} M=${String(row.motivation).padStart(3)}  D=${String(row.deal).padStart(3)}  C=${String(row.combined).padStart(3)}  Comp=${String(row.completeness).padStart(3)}%  [${row.bucketTag.toUpperCase()}]${sup}`
      );
    }
    await delay(DELAY_MS);
  }

  console.log("\n── Summary ──────────────────────────────────────────────────────");
  const ok = rows.filter(r => !r.error);
  const suppressed = ok.filter(r => r.suppressed);
  const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
  const hot  = ok.filter(r => r.bucketTag === "hot").length;
  const warm = ok.filter(r => r.bucketTag === "warm").length;
  const low  = ok.filter(r => r.bucketTag === "low").length;
  console.log(`Contacts:    ${contacts.length} total, ${suppressed.length} suppressed`);
  console.log(`Bucket tags: hot=${hot}  warm=${warm}  low=${low}  (total tagged=${hot+warm+low})`);
  console.log(`Avg scores:  Motivation=${avg(ok.map(r => r.motivation))}  Deal=${avg(ok.map(r => r.deal))}  Combined=${avg(ok.map(r => r.combined))}  Completeness=${avg(ok.map(r => r.completeness))}%`);
  console.log(`Completeness range: min=${Math.min(...ok.map(r => r.completeness))}%  max=${Math.max(...ok.map(r => r.completeness))}%`);

  // Sort by completeness desc for final report
  const sorted = [...ok].sort((a, b) => b.completeness - a.completeness);
  console.log("\n── Top 10 by completeness ───────────────────────────────────────");
  sorted.slice(0, 10).forEach(r =>
    console.log(`  ${r.name.padEnd(28)} Comp=${r.completeness}%  C=${r.combined}`)
  );
  console.log("\n── Bottom 10 by completeness ────────────────────────────────────");
  sorted.slice(-10).reverse().forEach(r =>
    console.log(`  ${r.name.padEnd(28)} Comp=${r.completeness}%  C=${r.combined}`)
  );
})();
