/**
 * Shared transport for Opportunity-field inert proofs run in the IAOS TEST
 * location. PB-D62 / INV-25 Tranche 1.
 *
 * ⚠ WHY THIS EXISTS AT ALL, AND WHY IT IS NOT IN app/scripts/.
 * The existing opportunity proof suites (PB-D58, PB-D59, PB-D60) reach GHL
 * through `https://app.investorautomationos.com/.netlify/functions/ghl-proxy`.
 * That proxy resolves its location ONCE at module scope from
 * `getConfig(process.env.IAOS_ENV)` and refuses any request naming another
 * location, so THE DEPLOYED PROXY CAN ONLY EVER REACH PRODUCTION. Those suites
 * hold no credential because the proxy holds it.
 *
 * Reaching the Test location therefore requires talking to GHL DIRECTLY with a
 * Test-location credential, and that is a different transport with a different
 * credential doctrine. That doctrine already exists in this repository, in
 * `scripts/capture-ghl-identifiers.ts`, and this module follows it exactly
 * rather than inventing a second one:
 *
 *   - `--credential-file` is REQUIRED, with no default and no fallback.
 *   - The token is read ONLY from that file's parsed contents. Never from
 *     `process.env`. Which file is named IS the decision, and it is recorded
 *     in every invocation and in every evidence artifact.
 *   - `dotenv.parse()`, never `dotenv.config()`, so nothing is written into
 *     ambient process state where a later reader could pick it up by accident.
 *
 * ⚠ THIS MODULE STRUCTURALLY CANNOT BE POINTED AT PRODUCTION. `assertTestOnly`
 * refuses when the resolved location is the Production location id, when `--env`
 * is anything but `test`, and when the two disagree. Three independent gates,
 * checked BEFORE the credential is read and BEFORE any request is issued. A
 * guard that runs after the token is loaded is a guard that has already lost.
 *
 * ⚠ IT WRITES NOTHING TO DISK IN THE REPOSITORY. Evidence goes to the OS temp
 * directory, or to `--out`. This is a DELIBERATE DEVIATION from the existing
 * suites, which hardcode `C:/Users/brad/AppData/Local/Temp/...`; a repository
 * deliverable must not carry one machine's user path.
 */

import { parse as parseEnvFile } from "dotenv";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getConfig } from "../../app/shared/ghl-config.ts";

export const GHL_BASE = "https://services.leadconnectorhq.com";
export const API_VERSION = "2021-07-28";

export interface CommonArgs {
  env: "test";
  location: string;
  credentialFile: string;
  out: string | null;
}

export function die(message: string): never {
  console.error(`REFUSED: ${message}`);
  process.exit(4);
}

function flag(argv: string[], name: string): string | null {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

/**
 * Parses the arguments every step shares, and refuses anything that could
 * reach Production. No defaults anywhere: an omitted argument is a refusal,
 * never a guess.
 */
export function parseCommonArgs(argv: string[]): CommonArgs {
  const env = flag(argv, "--env");
  if (env === null) die("--env is required. Expected --env=test form as `--env test`. There is no default.");
  if (env !== "test") {
    die(
      `--env ${JSON.stringify(env)} is not permitted by this tool. This proof runs in the IAOS TEST ` +
        "location only; the Production suites live in app/scripts/ and reach Production through the proxy.",
    );
  }

  const location = flag(argv, "--location");
  if (location === null) die("--location is required. There is no default; name the location explicitly.");

  const credentialFile = flag(argv, "--credential-file");
  if (credentialFile === null) {
    die("--credential-file is required. There is no default and no fallback; name the credential file.");
  }

  assertTestOnly(location);
  return { env: "test", location, credentialFile, out: flag(argv, "--out") };
}

/**
 * The Production guard. Runs before the credential is read and before any
 * request is issued, so a misdirected invocation dies with no token in memory
 * and nothing on the wire.
 */
export function assertTestOnly(location: string): void {
  const production = getConfig("production").locationId;
  const test = getConfig("test").locationId;

  if (location === production) {
    die(
      `--location ${location} is the PRODUCTION location. This tool refuses Production unconditionally. ` +
        "Route A (INV-25) authorizes bounded mutation in the Test location and explicitly does not extend to Production.",
    );
  }
  if (location !== test) {
    die(
      `--location ${location} is neither the configured Test location (${test}) nor Production. ` +
        "Refusing rather than writing to a location the shared configuration does not name.",
    );
  }
}

/** Reads the token from the named file only. Never from process.env. */
export function loadToken(credentialFile: string): string {
  let text: string;
  try {
    text = readFileSync(credentialFile, "utf8");
  } catch {
    die(`--credential-file ${credentialFile} could not be read. No credential was loaded and no request was issued.`);
  }
  const token = parseEnvFile(text).GHL_PRIVATE_API_KEY;
  if (token === undefined) {
    die(`GHL_PRIVATE_API_KEY is not present in ${credentialFile}. There is no fallback.`);
  }
  if (token.trim() === "") die(`GHL_PRIVATE_API_KEY is present but empty in ${credentialFile}.`);
  return token;
}

export interface Response<T = any> {
  status: number;
  body: T;
}

async function call<T>(token: string, path: string, method: string, body?: unknown): Promise<Response<T>> {
  const res = await fetch(`${GHL_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: API_VERSION,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

export const ghlGet = <T = any>(token: string, path: string) => call<T>(token, path, "GET");
export const ghlPost = <T = any>(token: string, path: string, body: unknown) => call<T>(token, path, "POST", body);
export const ghlPut = <T = any>(token: string, path: string, body: unknown) => call<T>(token, path, "PUT", body);

/**
 * Reads a custom-field value from a SINGULAR opportunity GET.
 *
 * ⚠ TRANSCRIBED DELIBERATELY FROM `readSingularFieldValue` in
 * `app/src/lib/ghl.ts`, and it must stay identical in behaviour. PB-D60
 * reproduced the hazard live: the singular GET returns every value under
 * `fieldValue`, while the LIST endpoint varies by dataType, and the resolver's
 * list-shaped readers report a PRESENT singular entry as absent. A proof that
 * parsed differently from the writer it clears would be measuring something
 * else. It is copied rather than imported because a harness that imports the
 * code it verifies cannot detect drift in that code — the same reasoning
 * `verify-contacts.cjs` records for its duplicated ids.
 */
export function readSingularFieldValue(entry: any): number | string | null {
  if (entry === null || entry === undefined) return null;
  const raw = entry.fieldValue;
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") return raw;
  return null;
}

/** The opportunity as the singular GET returns it, unwrapped. */
export async function readOpportunity(token: string, opportunityId: string): Promise<any> {
  const res = await ghlGet(token, `/opportunities/${opportunityId}`);
  if (res.status !== 200) {
    die(`GET /opportunities/${opportunityId} → ${res.status}: ${JSON.stringify(res.body).slice(0, 400)}`);
  }
  return res.body.opportunity ?? res.body;
}

/** A capture of everything the confirmation battery compares against. */
export interface Capture {
  opportunityId: string;
  pipelineStageId: string | null;
  status: string | null;
  customFields: { id: string; fieldValue: unknown }[];
}

export function capture(opportunity: any): Capture {
  return {
    opportunityId: opportunity.id,
    pipelineStageId: opportunity.pipelineStageId ?? null,
    status: opportunity.status ?? null,
    customFields: (opportunity.customFields ?? []).map((f: any) => ({ id: f.id, fieldValue: f.fieldValue })),
  };
}

export interface BatteryResult {
  othersUnchanged: boolean;
  offersUnchanged: boolean;
  stageUnchanged: boolean;
  statusUnchanged: boolean;
  passed: boolean;
  details: string[];
}

/**
 * PB-D58 section II's four-item confirmation battery, adapted to the object.
 *
 * `othersUnchanged` runs over the UNION of captured and live custom-field ids
 * excluding the target, so a field that APPEARED during the window is caught
 * as well as one that changed — a comparison over the captured set alone
 * cannot see an addition. `tagsUnchanged` is dropped because tags are a
 * contact-model concept and the opportunity payload carries none;
 * `statusUnchanged` replaces it as the opportunity-side field a stray write
 * could move.
 */
export function runBattery(
  before: Capture,
  after: Capture,
  targetId: string,
  offerIds: readonly string[],
): BatteryResult {
  const details: string[] = [];

  const beforeById = new Map(before.customFields.map((f) => [f.id, f.fieldValue]));
  const afterById = new Map(after.customFields.map((f) => [f.id, f.fieldValue]));

  const union = new Set<string>([...beforeById.keys(), ...afterById.keys()]);
  union.delete(targetId);

  let othersUnchanged = true;
  for (const id of union) {
    const b = JSON.stringify(beforeById.get(id) ?? null);
    const a = JSON.stringify(afterById.get(id) ?? null);
    if (b !== a) {
      othersUnchanged = false;
      details.push(`custom field ${id} moved: ${b} -> ${a}`);
    }
  }

  let offersUnchanged = true;
  for (const id of offerIds) {
    const b = JSON.stringify(beforeById.get(id) ?? null);
    const a = JSON.stringify(afterById.get(id) ?? null);
    if (b !== a) {
      offersUnchanged = false;
      details.push(`offer_ field ${id} moved: ${b} -> ${a}`);
    }
  }

  const stageUnchanged = before.pipelineStageId === after.pipelineStageId;
  if (!stageUnchanged) details.push(`pipelineStageId moved: ${before.pipelineStageId} -> ${after.pipelineStageId}`);

  const statusUnchanged = before.status === after.status;
  if (!statusUnchanged) details.push(`status moved: ${before.status} -> ${after.status}`);

  return {
    othersUnchanged,
    offersUnchanged,
    stageUnchanged,
    statusUnchanged,
    passed: othersUnchanged && offersUnchanged && stageUnchanged && statusUnchanged,
    details,
  };
}

/** Where a step's evidence lands. Temp by default; never inside the repository. */
export function evidencePath(args: CommonArgs, name: string): string {
  return args.out ?? join(tmpdir(), `${name}.json`);
}

/**
 * Writes evidence BEFORE the caller terminates, on every path including
 * failure. PB-D31: "A failed PUT is an observation, not an aborted run."
 */
export function writeEvidence(path: string, payload: unknown): void {
  writeFileSync(path, JSON.stringify(payload, null, 2), "utf8");
  console.log(`evidence → ${path}`);
}

export function readEvidence(path: string): any {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    die(`the prior step's evidence at ${path} could not be read. Steps run in order; nothing was done.`);
  }
}

/** ISO stamp recorded in every artifact, so a run can be placed in time. */
export const stamp = (): string => new Date().toISOString();
