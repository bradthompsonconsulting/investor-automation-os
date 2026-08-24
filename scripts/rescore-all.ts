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
import { getConfig } from "../app/shared/ghl-config";

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
const KNOWN_FLAGS = ["--env", "--authorize-mutation", "--dry-run", "--credential-file"];

const rawArgs = process.argv.slice(2);

for (const a of rawArgs) {
  const name = a.split("=")[0];
  if (!KNOWN_FLAGS.includes(name)) {
    console.error(`ERROR: unrecognized argument ${name}. Refusing rather than ignoring it.`);
    process.exit(2);
  }
}

// ── Environment selection (Gate 4C C4a, Stair 9B) ────────────────────────────
//
// EVALUATED BEFORE CONFIG RESOLUTION AND BEFORE ANY NETWORK CALL. Every refusal
// below exits while LOCATION_ID is still unbound.
//
// TWO SELECTORS, DELIBERATELY SEPARATE, exactly as in the importer. ENV governs
// CONFIG RESOLUTION; MUTATION_TARGET independently restricts MUTATION to
// production and stays a literal. Deriving one from the other would let
// --env=test --authorize-mutation=test agree with itself and authorize a Test
// mutation, which is not available in this tool.
//
// DUPLICATE FIRST, mirroring both other flags: this one decides which location
// the run enumerates.
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

// CASE SENSITIVITY IS DELIBERATE. getConfig rejects "Production" as an unknown
// selector and that refusal is kept rather than normalised away.
//
// The throw is CAUGHT rather than allowed to surface. Every refusal in this file
// names its own cause; an uncaught throw would print a stack trace instead, and
// this file is the reference model for that property.
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

console.log(`ENVIRONMENT — --env=${ENV} resolved to locationId ${ghlConfig.locationId}`);

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

// ── Refusal 1 of 2: THE TWO FLAGS MUST AGREE ─────────────────────────────────
//
// Checked BEFORE the production-only restriction below, so each state reports
// the cause that actually describes it: disagreement when the flags name
// different environments, prohibition when they agree on a non-production one.
if (authValue !== null && authValue !== ENV) {
  console.error(
    `ERROR: environment disagreement. --env named ${JSON.stringify(ENV)} but ` +
      `--authorize-mutation named ${JSON.stringify(authValue)}. Your two flags name different ` +
      "environments. Refusing in every mode, including --dry-run.",
  );
  process.exit(2);
}

// ── Refusal 2 of 2: MUTATION IS PRODUCTION-ONLY ──────────────────────────────
//
// A WRONG TARGET REFUSES IN EVERY MODE, --dry-run included. Reached only when
// the two flags already agree, so a non-production target here means the
// operator coherently asked to mutate Test. That is the prohibition.
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
/* THE CONVERSION (Gate 4C C4a, Stair 9B). One identity, one resolution site,
   one executable occurrence. CONFIG-owned: locationId. LOADER ONLY — this file
   has zero carrier-owned identifiers, so a carrier import would be dead.

   ⚠ WHAT THIS VALUE GOVERNS, AND WHAT IT DOES NOT.

   Parsed ENV governs ENUMERATION ONLY. This binding is consumed at exactly one
   place — the locationId query parameter of the contacts GET below — and it
   reaches no mutating call anywhere in this file.

   The POST to the scoring function carries NEITHER this value NOR any
   credential. Its body is {contactId} alone. The callee, netlify/functions/
   motivation-score.ts, independently selects its environment by reading
   IAOS_ENV at module scope ON THE MARKETING DEPLOYMENT, and authorizes its own
   GHL writes with its own GHL_API_TOKEN. Nothing in the request can influence
   either.

   THEREFORE THIS CONVERSION DOES NOT PROVE THE RESCORE WRITE PATH IS
   ENVIRONMENT-COHERENT. It makes the read environment-aware and verifiable.
   The write target remains decided by a variable on a different deployment
   that this harness cannot reach, observe, or constrain. */
const LOCATION_ID = ghlConfig.locationId;
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

  // ── Environment pairing verification (Gate 4C C4a, Stair 9B) ───────────────
  //
  // THE PROBLEM THIS SOLVES. Both environments use the same credential variable
  // name, and a credential file is a bare KEY=value with nothing in it naming
  // which world it belongs to. So --env and --credential-file are two
  // environment selectors and the second one CANNOT DECLARE ITSELF. There is
  // nothing to compare them against locally.
  //
  // So we do not compare them locally. We ask GHL. A read-only
  // GET /locations/:id authenticated with the credential either confirms the
  // resolved location or it does not, and that answer is the pairing check.
  //
  // MEASURED 2026-08-24 before this was written:
  //   production credential + production locationId -> 200, id matches exactly
  //   production credential + TEST locationId       -> 403 Forbidden
  // The 200-for-a-mismatch case, which would have made this check useless, does
  // not occur.
  //
  // ⚠ WHAT THE REFUSAL MAY CLAIM. Also measured: a MALFORMED id returns the
  // SAME 403 with the SAME body as a valid location the credential does not
  // own. The endpoint does not tell us WHY it refused, so this message says
  // only what we know — the credential could not confirm the resolved location
  // — and never asserts that the credential belongs elsewhere or that the
  // location does not exist. This file is the reference model for messages that
  // name their cause exactly; it does not get to start asserting causes it
  // cannot observe.
  //
  // FAIL-CLOSED ON UNREACHABLE, DELIBERATELY. If GHL cannot be reached the run
  // refuses rather than proceeding unverified. The operational cost is real: a
  // connectivity blip now blocks a legitimate run. That is the accepted trade,
  // not an oversight.
  //
  // RUNS ON EVERY PATH THAT REACHES THE NETWORK, PREVIEW INCLUDED. Preview is
  // this file's discriminating proof and it cannot prove the pairing if it
  // skips the check.
  //
  // ⚠ SCOPE OF THE GUARANTEE. This confirms the credential and the resolved
  // location agree FOR THE ENUMERATION. It says nothing about the write path,
  // because the write path uses neither of them — see the LOCATION_ID note.
  let pairing: Response;
  try {
    pairing = await fetch(`${GHL_BASE}/locations/${LOCATION_ID}`, {
      headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28" },
    });
  } catch (e) {
    console.error(
      `ERROR: could not reach GHL to verify the environment pairing for --env=${ENV}. ` +
        `No contact was enumerated and no write was attempted. Underlying reason: ` +
        `${(e as Error).message}`,
    );
    process.exit(2);
  }

  if (!pairing.ok) {
    console.error(
      `ERROR: the credential in ${credentialFile} could not confirm the location resolved by ` +
        `--env=${ENV} (${LOCATION_ID}). GHL answered ${pairing.status}. This does not identify ` +
        "which environment the credential belongs to — GHL returns the same refusal for a " +
        "location you do not own and for one that cannot exist — only that the pairing is " +
        "unconfirmed. Refusing rather than enumerating against an unverified pairing.",
    );
    process.exit(2);
  }

  // DEFENSIVE, and expected to be structurally unreachable: we asked for this
  // exact id, so a 200 should carry it back. Implemented anyway; recorded as
  // unreachable rather than as covered.
  const pairingBody = (await pairing.json()) as any;
  const confirmedId = (pairingBody?.location ?? pairingBody)?.id;
  if (confirmedId !== LOCATION_ID) {
    console.error(
      `ERROR: GHL confirmed a different location than --env=${ENV} resolved. Expected ` +
        `${LOCATION_ID}, GHL returned ${JSON.stringify(confirmedId)}. Refusing.`,
    );
    process.exit(2);
  }

  console.log(`PAIRING VERIFIED — the credential confirms location ${LOCATION_ID}`);

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
