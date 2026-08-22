/**
 * Fetches all contacts from GHL and re-scores each via the live endpoint.
 *
 * Run: GHL_PRIVATE_API_KEY=pit-... npx tsx scripts/rescore-all.ts --authorize-mutation=production
 *
 * Required to WRITE: --authorize-mutation=<target>, naming the environment this
 * script targets. There is no default, and a wrong target refuses in every mode.
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

import { config } from "dotenv";
config();

// ── Mutation authorization (Gate 4C PRE-2) ───────────────────────────────────
//
// Before PRE-2 this file parsed no arguments at all, so there was no invocation
// that was not a full production run -- appending a flag such as --help was
// ignored and every contact in the location was rewritten. The parser arrives
// here with the gate, and only what the gate needs: no --dry-run, no --env, no
// --credential-file. Those are PRE-3 and PRE-4, kept separate so each is
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
// --dry-run is accepted here from PRE-3 commit 2 but does nothing until commit
// 3, which gives it the positive-control stop at the loop entry.
const KNOWN_FLAGS = ["--authorize-mutation", "--dry-run"];

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

const GHL_BASE    = "https://services.leadconnectorhq.com";
const LOCATION_ID = "jmHG4B8RdzwpfqruNf68";
const SCORE_URL   = "https://investor-automation-os.netlify.app/.netlify/functions/motivation-score";
const TOKEN       = process.env.GHL_PRIVATE_API_KEY ?? "";
const DELAY_MS    = 250; // ~4 req/sec — stay safe

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

interface ContactMeta { id: string; firstName: string; lastName: string; }

async function fetchAllIds(): Promise<ContactMeta[]> {
  const all: ContactMeta[] = [];
  let startAfterId: string | undefined;
  let startAfter: number | undefined;

  while (true) {
    const params = new URLSearchParams({ locationId: LOCATION_ID, limit: "100" });
    if (startAfterId) params.set("startAfterId", startAfterId);
    if (startAfter)   params.set("startAfter",   String(startAfter));

    const res  = await fetch(`${GHL_BASE}/contacts?${params}`, {
      headers: { Authorization: `Bearer ${TOKEN}`, Version: "2021-07-28" },
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
  if (!TOKEN) { console.error("GHL_PRIVATE_API_KEY not set"); process.exit(1); }

  console.log("Fetching contacts from GHL...");
  const contacts = await fetchAllIds();

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
