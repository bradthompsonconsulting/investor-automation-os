/**
 * capture-ghl-identifiers.ts — Gate 4C / C2B-2. Read-only identifier capture.
 *
 * Points at a GHL sub-account and captures every identifier in the GhlConfig
 * schema. The TEST map is captured, never typed: hand-transcribing identifiers
 * is the transposition risk we cannot detect, because there is no known-good
 * behaviour in a fresh location to compare against.
 *
 * THE FROZEN ARTIFACT IS THE BINDING AUTHORITY. scripts/ghl-bindings.json says,
 * per config key, which surface to search, the literal handle to match, and how
 * to scope the candidate pool. No key-transform survives in this file and none
 * may return: the key-to-handle normalization hypothesis was tested against
 * production and REFUTED at 31 of 47. Config keys are semantic aliases a human
 * chose -- sellingCostPct is default_selling_cost_percentage, sellerMAO is
 * mao_max_allowable_offer -- and no rule bridges them. Handles are compared as
 * LITERAL STRINGS, ===, no case folding and no punctuation stripping.
 *
 * SURFACE PINNING IS AN INVARIANT. Every lookup is scoped to the binding's
 * declared surface and a handle is NEVER resolved globally. The artifact proves
 * why: fields.askingPrice (S-1) and opportunityFacts.askingPrice (S-2) carry the
 * SAME handle "asking_price" with no scope. Surface is the only thing that tells
 * them apart, so an all-surface fallback would silently pick one of two.
 *
 * A0 IS AN OFFLINE PRECONDITION, NOT AN ASSERTION. The artifact and the schema
 * can drift: add a 48th leaf to GhlConfig without regenerating and, without A0,
 * this tool captures 46 of 47 and reports success on everything it looked at --
 * a silent partial success. A0 runs BEFORE the credential is read and BEFORE any
 * request is issued, so a drifted artifact cannot reach the network.
 *
 * NOTHING ON DISK IS MUTATED, EVER, INCLUDING BY A RED PROOF. R1-R3 mutate an
 * in-memory copy of the EXPECTED map; R4-R5 mutate an in-memory copy of the
 * ARTIFACT. scripts/ghl-bindings.json is opened read-only and never rewritten.
 *
 * THE KEY COUNT IS NEVER HARDCODED. It comes from walking getConfig("production").
 *
 * THE CREDENTIAL FILE IS THE CREDENTIAL SELECTOR. --credential-file is required, has no
 * default and no fallback, and the token is read ONLY from that file's parsed
 * contents -- never from ambient process state. Both credential files use the
 * same variable name, GHL_PRIVATE_API_KEY, so which file is named IS the
 * decision, and it is recorded in every invocation. The alternative -- editing
 * one .env before a run and editing it back after -- depends on a human undoing
 * a change correctly and leaves no record of which credential a run used.
 *
 * MUST BE RUN FROM THE REPOSITORY ROOT. Both the artifact and the credential
 * file are resolved by relative path, exactly as scripts/derive-ghl-bindings.ts
 * resolves the artifact. If CI ever invokes either from another working
 * directory, this is where it breaks.
 *
 * Usage:
 *   npx tsx scripts/capture-ghl-identifiers.ts --location <id> --expect <production|test|none>
 *                                              --credential-file <path>
 *                                              [--out <path>] [--red-proof <R1|R2|R3|R4|R5>]
 * Exit: 0 only when A0 passes and every row resolved and matched. Non-zero otherwise.
 */

import { parse as parseEnvFile } from "dotenv";
import { readFileSync, writeFileSync } from "node:fs";
import { getConfig } from "../app/shared/ghl-config.ts";

const BASE = "https://services.leadconnectorhq.com";
const API_VERSION = "2021-07-28";
const ARTIFACT = "scripts/ghl-bindings.json";

/** R3 adds a key production lacks. Deliberately not a real identifier. */
const SYNTHETIC_VALUE = "AAAAAAAAAAAAAAAAAAAA";

// ── Argument parsing. No defaults, no fallbacks, no env-var substitutes. ─────

interface Args {
  location: string;
  expect: "production" | "test" | "none";
  credentialFile: string;
  out: string | null;
  redProof: "R1" | "R2" | "R3" | "R4" | "R5" | null;
}

function die(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
  };

  const location = get("--location");
  if (!location) die("--location is required. There is no default and no fallback.");
  if (!/^[A-Za-z0-9]{20}$/.test(location)) {
    die(`--location must be 20 alphanumeric characters; got ${location.length} character(s).`);
  }

  const expect = get("--expect");
  if (!expect) die("--expect is required. Use production, test, or none.");
  if (expect !== "production" && expect !== "test" && expect !== "none") {
    die(`--expect must be production, test or none; got ${JSON.stringify(expect)}.`);
  }

  // The credential SOURCE is an explicit decision, never inferred. There is one
  // variable name across every credential file, so the file named here is the
  // whole of the choice.
  const credentialFile = get("--credential-file");
  if (!credentialFile) {
    die("--credential-file is required. There is no default and no fallback; name the credential file.");
  }

  const redProof = get("--red-proof");
  const valid = ["R1", "R2", "R3", "R4", "R5"];
  if (redProof && !valid.includes(redProof)) {
    die(`--red-proof must be one of ${valid.join(", ")}; got ${JSON.stringify(redProof)}.`);
  }
  if (redProof && ["R1", "R2", "R3"].includes(redProof) && expect === "none") {
    die(`--red-proof ${redProof} requires --expect production or test; there is no expected map to mutate.`);
  }

  return {
    location,
    expect,
    credentialFile,
    out: get("--out"),
    redProof: (redProof as Args["redProof"]) ?? null,
  };
}

// ── Schema walk. This is where the key count comes from. ────────────────────

interface Leaf {
  key: string;
  group: string;
}

function walkLeaves(obj: Record<string, any>, prefix = ""): Leaf[] {
  const out: Leaf[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const dotted = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") {
      const parts = dotted.split(".");
      out.push({ key: dotted, group: parts.length > 1 ? parts[0] : "" });
    } else if (v && typeof v === "object") {
      out.push(...walkLeaves(v, dotted));
    }
  }
  return out;
}

function readPath(obj: Record<string, any>, dotted: string): string | undefined {
  return dotted.split(".").reduce<any>((acc, p) => (acc == null ? acc : acc[p]), obj);
}

function writePath(obj: Record<string, any>, dotted: string, value: string): void {
  const parts = dotted.split(".");
  let cur: any = obj;
  for (const p of parts.slice(0, -1)) {
    if (cur[p] == null || typeof cur[p] !== "object") cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

function deletePath(obj: Record<string, any>, dotted: string): void {
  const parts = dotted.split(".");
  let cur: any = obj;
  for (const p of parts.slice(0, -1)) {
    if (cur == null) return;
    cur = cur[p];
  }
  if (cur) delete cur[parts[parts.length - 1]];
}

// ── The artifact ────────────────────────────────────────────────────────────

interface Binding {
  key: string;
  surface: string;
  handleField: string;
  handle: string;
  handleRaw: string;
  scope: Record<string, string> | null;
}

interface Artifact {
  schemaVersion: number;
  derivedFrom: { locationId: string; configBase: string; schemaLeafCount: number };
  suppliedKeys: string[];
  bindings: Binding[];
}

// ── The single network call site. Method is a literal. ──────────────────────

async function readJson(url: string, token: string): Promise<any> {
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Version: API_VERSION },
  });
  if (!res.ok) {
    // Status and path only. Never the body -- it can echo request context.
    die(`GHL returned HTTP ${res.status} for a read of ${url.replace(BASE, "")}`);
  }
  return res.json();
}

// ── Candidates ──────────────────────────────────────────────────────────────

interface Candidate {
  id: string;
  handle: string;
  scope: Record<string, string> | null;
}

type Pools = Record<string, Candidate[]>;

/** Narrow a surface's pool by the binding's scope. Never widens it. */
function poolFor(pools: Pools, binding: Binding, pipelineIdFor: Map<string, string>): Candidate[] | null {
  const all = pools[binding.surface] ?? [];
  if (!binding.scope) return all;

  if (binding.scope.parentPipelineKey) {
    const parentId = pipelineIdFor.get(binding.scope.parentPipelineKey);
    if (!parentId) return null; // parent unresolved -- caller reports the cascade
    return all.filter((c) => c.scope?.parentPipelineId === parentId);
  }

  return all.filter((c) => {
    if (!c.scope) return false;
    return Object.entries(binding.scope!).every(([k, v]) => c.scope![k] === v);
  });
}

// ── Statuses ────────────────────────────────────────────────────────────────

type Status = "MATCH" | "MISMATCH" | "CAPTURED" | "UNREACHABLE" | "AMBIGUOUS";

interface Row {
  key: string;
  surface: string;
  provenance: "SUPPLIED" | "DISCOVERED";
  handle: string | null;
  captured: string | null;
  expected: string | null;
  status: Status;
  detail?: string;
  candidates?: Array<{ id: string; handle: string }>;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  // ── Schema and artifact, both offline. ────────────────────────────────────
  const schema = structuredClone(getConfig("production")) as Record<string, any>;
  const schemaLeaves = walkLeaves(schema);
  const schemaKeys = schemaLeaves.map((l) => l.key).sort();

  let artifact: Artifact;
  try {
    artifact = JSON.parse(readFileSync(ARTIFACT, "utf8")) as Artifact;
  } catch {
    die(`could not read ${ARTIFACT}. This tool must be run from the repository root.`);
  }
  // In-memory copy: R4/R5 mutate this, never the file.
  artifact = structuredClone(artifact);

  // ── R4 / R5 mutate the ARTIFACT copy, before A0, so A0 is what catches them.
  if (args.redProof === "R4") {
    const discovered = artifact.bindings.map((b) => b.key).sort();
    if (discovered.length === 0) die("--red-proof R4 cannot run: the artifact has no binding to remove.");
    const target = discovered[0];
    artifact.bindings = artifact.bindings.filter((b) => b.key !== target);
    console.error(`RED PROOF R4: removed the artifact binding for "${target}"`);
  } else if (args.redProof === "R5") {
    const orphan = "__redproof5.orphan";
    artifact.bindings.push({
      key: orphan,
      surface: "S-1",
      handleField: "fieldKey",
      handle: "not_a_real_handle",
      handleRaw: "not_a_real_handle",
      scope: null,
    });
    console.error(`RED PROOF R5: added an artifact binding for "${orphan}", a key the schema lacks`);
  }

  // ── A0 — artifact integrity. Offline. Before the credential. Before HTTP. ──
  const a0Failures: string[] = [];

  // 5: version first, because every other check assumes this shape.
  if (artifact.schemaVersion !== 1) {
    a0Failures.push(`A0.5  artifact schemaVersion is ${artifact.schemaVersion}, expected 1`);
  }

  const artifactKeys = [...artifact.suppliedKeys, ...artifact.bindings.map((b) => b.key)];

  // 3: duplicates BEFORE set comparison. A duplicate can make a set look
  // complete while a key is really covered twice -- set equality would then
  // report a MISSING key, which is the correct verdict with the wrong
  // diagnosis. Checked explicitly so the message names the real fault.
  const dupes = artifactKeys.filter((k, i) => artifactKeys.indexOf(k) !== i);
  if (dupes.length) {
    a0Failures.push(`A0.3  artifact names these keys more than once: ${[...new Set(dupes)].join(", ")}`);
  }

  // 1: every schema leaf covered exactly once.
  const artifactKeySet = new Set(artifactKeys);
  const uncovered = schemaKeys.filter((k) => !artifactKeySet.has(k));
  if (uncovered.length) {
    a0Failures.push(
      `A0.1  schema keys with no artifact entry: ${uncovered.join(", ")}\n` +
        `      the artifact has drifted from GhlConfig — regenerate it`,
    );
  }

  // 2: no artifact key absent from the schema.
  const schemaKeySet = new Set(schemaKeys);
  const orphans = artifactKeys.filter((k) => !schemaKeySet.has(k));
  if (orphans.length) {
    a0Failures.push(
      `A0.2  artifact keys with no schema leaf: ${orphans.join(", ")}\n` +
        `      the artifact names something GhlConfig does not have`,
    );
  }

  // 4: recorded leaf count matches an independent walk.
  if (artifact.derivedFrom?.schemaLeafCount !== schemaLeaves.length) {
    a0Failures.push(
      `A0.4  artifact records schemaLeafCount ${artifact.derivedFrom?.schemaLeafCount}, ` +
        `independent walk found ${schemaLeaves.length}`,
    );
  }

  console.error(`A0 artifact integrity        : ${a0Failures.length === 0 ? "PASS" : "FAIL"}`);
  if (a0Failures.length) {
    for (const f of a0Failures) console.error(f);
    console.error("");
    console.error("A0 is a precondition: no credential was read and no request was issued.");
    return 1;
  }

  // ── Only past A0 do we touch the credential or the network. ───────────────
  //
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
    envText = readFileSync(args.credentialFile, "utf8");
  } catch {
    die(
      `--credential-file ${args.credentialFile} could not be read. No credential was loaded and ` +
        `no request was issued.`,
    );
  }

  const fileVars = parseEnvFile(envText);
  const token = fileVars.GHL_PRIVATE_API_KEY;
  if (token === undefined) {
    die(
      `GHL_PRIVATE_API_KEY is not present in ${args.credentialFile}. There is no fallback ` +
        `to ambient environment, and no other file is consulted.`,
    );
  }
  if (token.trim() === "") {
    die(`GHL_PRIVATE_API_KEY is present but empty in ${args.credentialFile}.`);
  }

  // TWO INDEPENDENT DEEP COPIES. getConfig returns the same module-level object
  // on every call, so without these a red proof would mutate the shared map and
  // the schema walk would silently agree with it -- a red branch that can never
  // fire, which is exactly what R2 and R3 exist to disprove.
  const expected: Record<string, any> | null =
    args.expect === "none" ? null : (structuredClone(getConfig(args.expect)) as Record<string, any>);

  const loc = args.location;

  const s1: any[] = (await readJson(`${BASE}/locations/${loc}/customFields`, token)).customFields ?? [];
  const s2: any[] =
    (await readJson(`${BASE}/locations/${loc}/customFields?model=opportunity`, token)).customFields ?? [];
  const s4: any[] = (await readJson(`${BASE}/locations/${loc}/customValues`, token)).customValues ?? [];
  const s5: any[] = (await readJson(`${BASE}/opportunities/pipelines?locationId=${loc}`, token)).pipelines ?? [];

  // S-3: no list endpoint exists. Folders are reachable only as the distinct
  // parentId values of S-1, each confirmed by a singular read.
  const s1ParentIds = [...new Set(s1.map((o) => o.parentId).filter(Boolean))];
  const s2ParentIds = [...new Set(s2.map((o) => o.parentId).filter(Boolean))];
  const s3: Candidate[] = [];
  for (const id of s1ParentIds) {
    const body = await readJson(`${BASE}/locations/${loc}/customFields/${id}`, token);
    const o = body.customField ?? body;
    if (o && o.documentType === "folder") {
      s3.push({ id, handle: String(o.name ?? ""), scope: { model: String(o.model ?? "") } });
    }
  }

  // Handles are compared literally, so the candidate handle must be the same
  // shape the artifact froze: the fieldKey unwrapped of its merge-tag braces
  // and model prefix, or the raw name.
  const unwrap = (raw: any): string => {
    let h = String(raw ?? "");
    const braced = h.match(/^\{\{\s*(.+?)\s*\}\}$/);
    if (braced) h = braced[1];
    return h.replace(/^contact\./, "").replace(/^opportunity\./, "").replace(/^custom_values\./, "");
  };

  const s6: Candidate[] = [];
  for (const p of s5) {
    for (const st of p.stages ?? []) {
      s6.push({
        id: String(st.id),
        handle: String(st.name ?? ""),
        scope: { parentPipelineId: String(p.id) },
      });
    }
  }

  const pools: Pools = {
    "S-1": s1.map((o) => ({ id: String(o.id), handle: unwrap(o.fieldKey), scope: null })),
    "S-2": s2.map((o) => ({ id: String(o.id), handle: unwrap(o.fieldKey), scope: null })),
    "S-3": s3,
    "S-4": s4.map((o) => ({ id: String(o.id), handle: unwrap(o.fieldKey), scope: null })),
    "S-5": s5.map((p) => ({ id: String(p.id), handle: String(p.name ?? ""), scope: null })),
    "S-6": s6,
  };

  const surfaceCounts = {
    S1: s1.length,
    S2: s2.length,
    S3: [...new Set([...s1ParentIds, ...s2ParentIds])].length,
    S4: s4.length,
    S5: s5.length,
    S6: s6.length,
  };
  console.error(`schema leaves discovered: ${schemaLeaves.length}`);
  console.error(`surface counts: ${JSON.stringify(surfaceCounts)}`);

  // ── Resolution, dependency-ordered ────────────────────────────────────────
  // A stage cannot be scoped until its parent pipeline has resolved IN THE
  // TARGET LOCATION -- the scoping id is the target's, not production's. That
  // is the whole point: in another location the pipeline id differs.
  const rows: Row[] = [];
  const pipelineIdFor = new Map<string, string>();

  for (const key of artifact.suppliedKeys) {
    rows.push({
      key,
      surface: "none",
      provenance: "SUPPLIED",
      handle: null,
      captured: args.location,
      expected: null,
      status: "CAPTURED",
    });
  }

  const pending = [...artifact.bindings];
  const done = new Set<string>();
  let guard = pending.length + 1;

  while (pending.length) {
    const ready = pending.filter((b) => {
      const dep = b.scope?.parentPipelineKey;
      return !dep || done.has(dep);
    });

    if (ready.length === 0) {
      // No binding can proceed and some still have unmet dependencies. Either a
      // cycle, or a scope pointing at a key the artifact never binds. Fail
      // loudly rather than spinning.
      const stuck = pending.map((b) => `${b.key} -> ${b.scope?.parentPipelineKey}`).join(", ");
      die(`unresolvable scope dependency, possible cycle: ${stuck}`);
    }
    if (guard-- <= 0) die("scope dependency resolution exceeded its iteration bound");

    for (const b of ready) {
      const pool = poolFor(pools, b, pipelineIdFor);

      if (pool === null) {
        rows.push({
          key: b.key,
          surface: b.surface,
          provenance: "DISCOVERED",
          handle: b.handle,
          captured: null,
          expected: null,
          status: "UNREACHABLE",
          detail: "parent pipeline unresolved",
        });
        done.add(b.key);
        continue;
      }

      const hits = pool.filter((c) => c.handle === b.handle);

      if (hits.length === 0) {
        rows.push({
          key: b.key,
          surface: b.surface,
          provenance: "DISCOVERED",
          handle: b.handle,
          captured: null,
          expected: null,
          status: "UNREACHABLE",
          detail: `no candidate among ${pool.length} in ${b.surface} has handle "${b.handle}"`,
        });
      } else if (hits.length > 1) {
        rows.push({
          key: b.key,
          surface: b.surface,
          provenance: "DISCOVERED",
          handle: b.handle,
          captured: null,
          expected: null,
          status: "AMBIGUOUS",
          detail: `${hits.length} candidates in ${b.surface} have handle "${b.handle}"`,
          candidates: hits.map((h) => ({ id: h.id, handle: h.handle })),
        });
      } else {
        rows.push({
          key: b.key,
          surface: b.surface,
          provenance: "DISCOVERED",
          handle: b.handle,
          captured: hits[0].id,
          expected: null,
          status: "CAPTURED",
        });
        if (b.surface === "S-5") pipelineIdFor.set(b.key, hits[0].id);
      }
      done.add(b.key);
    }

    for (const b of ready) {
      const i = pending.indexOf(b);
      if (i >= 0) pending.splice(i, 1);
    }
  }

  rows.sort((a, b) => a.key.localeCompare(b.key));

  // ── R1 / R2 / R3 mutate the EXPECTED map, after resolution. ───────────────
  //
  // ADOPTED FROM THE REVIEWED CANDIDATE, deliberately. The target must be a key
  // that ACTUALLY RESOLVED, and whether a key resolved is only known once
  // resolution has run. Selecting by an ordering unrelated to what the proof
  // demonstrates lets a red proof silently stop testing anything: an
  // unresolvable target reports UNREACHABLE, the run still exits non-zero, and
  // it looks like it worked. SUPPLIED keys never qualify -- locationId cannot
  // demonstrate a discovery mismatch.
  if (args.redProof && expected && ["R1", "R2", "R3"].includes(args.redProof)) {
    const eligible = rows
      .filter((r) => r.provenance === "DISCOVERED" && r.status === "CAPTURED")
      .map((r) => r.key)
      .sort();

    if (args.redProof === "R3") {
      writePath(expected, "__redproof3.synthetic", SYNTHETIC_VALUE);
      console.error(`RED PROOF R3: added expected["__redproof3.synthetic"]`);
    } else if (eligible.length === 0) {
      die(
        `--red-proof ${args.redProof} cannot run: no DISCOVERED key resolved, so there is no ` +
          `target that could demonstrate a value comparison. Not falling back to an ` +
          `unresolvable key, and not falling back to a SUPPLIED one.`,
      );
    } else {
      const target = eligible[0];
      if (args.redProof === "R1") {
        const original = String(readPath(expected, target));
        const last = original.slice(-1);
        writePath(expected, target, original.slice(0, -1) + (last === "a" ? "b" : "a"));
        console.error(`RED PROOF R1: altered expected["${target}"] by one character`);
      } else {
        deletePath(expected, target);
        console.error(`RED PROOF R2: deleted expected["${target}"]`);
      }
    }
  }

  // ── Finalize statuses AFTER any red-proof mutation. ───────────────────────
  for (const r of rows) {
    r.expected = expected ? (readPath(expected, r.key) ?? null) : null;
    if (r.status !== "CAPTURED") continue;
    if (expected === null) continue; // --expect none: CAPTURED is terminal
    r.status = r.captured === r.expected ? "MATCH" : "MISMATCH";
  }

  const tally = { MATCH: 0, MISMATCH: 0, CAPTURED: 0, UNREACHABLE: 0, AMBIGUOUS: 0 };
  for (const r of rows) tally[r.status] += 1;

  const capturedKeys = rows.map((r) => r.key).sort();

  // ── Assertions ────────────────────────────────────────────────────────────
  const assertions: Array<{ id: string; label: string; pass: boolean }> = [];
  const notes: string[] = [];

  let ok: boolean;

  if (expected === null) {
    // N1-N3. The defect this replaces: the old code set expectedKeys =
    // capturedKeys here, making key-set and cardinality compare a list to
    // itself -- tautologies, in the exact mode C3 depends on. The oracle is now
    // the INDEPENDENTLY WALKED schema key set.
    const onlyCaptured = capturedKeys.filter((k) => !schemaKeys.includes(k));
    const onlySchema = schemaKeys.filter((k) => !capturedKeys.includes(k));
    const oneRowEach = capturedKeys.length === new Set(capturedKeys).size;
    const n1 = onlyCaptured.length === 0 && onlySchema.length === 0 && oneRowEach;
    if (!n1) {
      if (onlySchema.length) notes.push(`N1  schema keys with no row: ${onlySchema.join(", ")}`);
      if (onlyCaptured.length) notes.push(`N1  rows with no schema key: ${onlyCaptured.join(", ")}`);
      if (!oneRowEach) notes.push(`N1  a key produced more than one row`);
    }

    const n2 = tally.UNREACHABLE === 0 && tally.AMBIGUOUS === 0;

    // N3: shape, and uniqueness across DISCOVERED keys only. locationId is a
    // different identifier class and is excluded from the uniqueness pool.
    const shapeOk = (v: string) =>
      /^[A-Za-z0-9]{20}$/.test(v) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
    const badShape = rows.filter((r) => r.captured && !shapeOk(r.captured));
    const discovered = rows.filter((r) => r.provenance === "DISCOVERED" && r.captured);
    const byId = new Map<string, string[]>();
    for (const r of discovered) byId.set(r.captured!, [...(byId.get(r.captured!) ?? []), r.key]);
    const aliased = [...byId.entries()].filter(([, keys]) => keys.length > 1);
    const n3 = badShape.length === 0 && aliased.length === 0;
    for (const r of badShape) notes.push(`N3  ${r.key} captured a value that is not a GHL identifier shape`);
    for (const [, keys] of aliased) {
      notes.push(`N3  these keys bound the SAME object: ${keys.join(" AND ")}`);
    }

    assertions.push({ id: "N1", label: "row per schema leaf, vs independent walk", pass: n1 });
    assertions.push({ id: "N2", label: "zero unreachable, zero ambiguous     ", pass: n2 });
    assertions.push({ id: "N3", label: "identifier shape and no aliasing     ", pass: n3 });
    ok = n1 && n2 && n3;
  } else {
    const expectedKeys = walkLeaves(expected).map((l) => l.key).sort();
    const keysOnlyInCaptured = capturedKeys.filter((k) => !expectedKeys.includes(k));
    const keysOnlyInExpected = expectedKeys.filter((k) => !capturedKeys.includes(k));

    const g1 = keysOnlyInCaptured.length === 0 && keysOnlyInExpected.length === 0;
    const g2 = tally.MISMATCH === 0 && tally.UNREACHABLE === 0 && tally.AMBIGUOUS === 0;
    const g3 = capturedKeys.length === expectedKeys.length;

    if (keysOnlyInCaptured.length) notes.push(`G1  keysOnlyInCaptured: ${keysOnlyInCaptured.join(", ")}`);
    if (keysOnlyInExpected.length) notes.push(`G1  keysOnlyInExpected: ${keysOnlyInExpected.join(", ")}`);
    if (!g3) notes.push(`G3  captured ${capturedKeys.length}, expected ${expectedKeys.length}`);

    assertions.push({ id: "G1", label: "key-set equality                     ", pass: g1 });
    assertions.push({ id: "G2", label: "value equality                       ", pass: g2 });
    assertions.push({ id: "G3", label: "cardinality                          ", pass: g3 });

    // ── N4 — SHIPS UNTESTED. Its first execution is C3's evidence. ──────────
    // A TEST capture must differ from PRODUCTION at every key; equality means
    // the Snapshot carried production identifiers across, or the wrong location
    // was read. Never explain an equality away -- name the key and investigate.
    // Unreachable in this commit: C2B-2 is authorized against production only,
    // and --expect test throws out of getConfig until C3 populates TEST.
    let n4 = true;
    if (args.expect === "test") {
      const prod = structuredClone(getConfig("production")) as Record<string, any>;
      for (const r of rows) {
        if (r.provenance !== "DISCOVERED" || !r.captured) continue;
        if (r.captured === readPath(prod, r.key)) {
          n4 = false;
          notes.push(`N4  ${r.key} captured the PRODUCTION identifier from the test location`);
        }
      }
      assertions.push({ id: "N4", label: "test identifiers differ from prod    ", pass: n4 });
    }

    ok = g1 && g2 && g3 && n4;
  }

  const result = {
    location: args.location,
    expect: args.expect,
    // The credential FILE, never the credential. Which file was named is the
    // decision this run made, and it belongs in the evidence.
    credentialFile: args.credentialFile,
    redProof: args.redProof,
    artifact: {
      path: ARTIFACT,
      schemaVersion: artifact.schemaVersion,
      derivedFromLocation: artifact.derivedFrom?.locationId ?? null,
      configBase: artifact.derivedFrom?.configBase ?? null,
      a0: "PASS",
    },
    surfaceCounts,
    rows,
    summary: {
      schemaKeyCount: schemaKeys.length,
      capturedKeyCount: capturedKeys.length,
      MATCH: tally.MATCH,
      MISMATCH: tally.MISMATCH,
      CAPTURED: tally.CAPTURED,
      UNREACHABLE: tally.UNREACHABLE,
      AMBIGUOUS: tally.AMBIGUOUS,
      assertions: assertions.map((a) => ({ id: a.id, pass: a.pass })),
    },
  };

  const json = JSON.stringify(result, null, 2);
  if (args.out) {
    writeFileSync(args.out, json + "\n");
    console.error(`wrote ${args.out}`);
  } else {
    console.log(json);
  }

  // ── Human summary, stderr only ────────────────────────────────────────────
  console.error("");
  for (const a of assertions) console.error(`${a.id} ${a.label}: ${a.pass ? "PASS" : "FAIL"}`);
  if (notes.length) {
    console.error("");
    for (const n of notes) console.error(n);
  }
  console.error("");
  for (const r of rows) {
    if (r.status === "MISMATCH") {
      console.error(`MISMATCH  ${r.key}`);
      console.error(`          expected  ${r.expected}`);
      console.error(`          captured  ${r.captured}`);
    } else if (r.status === "UNREACHABLE") {
      console.error(`UNREACHABLE  ${r.key}`);
      console.error(`             surface ${r.surface}, ${r.detail}`);
    } else if (r.status === "AMBIGUOUS") {
      console.error(`AMBIGUOUS    ${r.key}`);
      console.error(`             ${r.detail}`);
      for (const c of r.candidates ?? []) console.error(`               ${c.id}  "${c.handle}"`);
    }
  }
  console.error(
    `tally: MATCH ${tally.MATCH} · MISMATCH ${tally.MISMATCH} · CAPTURED ${tally.CAPTURED} · UNREACHABLE ${tally.UNREACHABLE} · AMBIGUOUS ${tally.AMBIGUOUS}`,
  );
  console.error(ok ? "CAPTURE GREEN" : "CAPTURE RED");
  return ok ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(3);
  });
