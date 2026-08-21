/**
 * derive-ghl-bindings.ts — Gate 4C / C2B-1. Binding artifact generator.
 *
 * The normalization hypothesis was refuted: 16 of 47 config keys are semantic
 * aliases of their GHL handle, not normalizations of it, and no rule bridges
 * "sellingCostPct" to "default_selling_cost_percentage". So the binding is
 * DERIVED ONCE from production, FROZEN as data, and consumed thereafter.
 *
 * PRODUCTION IDS BOOTSTRAP THE ARTIFACT AND THEN STOP BEING INVOLVED. Each
 * config key's production id is the already-verified statement of what that key
 * means; following it to an object yields that object's handle. After
 * generation the artifact is an independent input, and runtime capture must
 * never re-derive from production ids. That separation is what stops the
 * production oracle from becoming circular.
 *
 * GET-ONLY BY CONSTRUCTION. One network helper, method is the literal "GET".
 *
 * THE GENERATOR CANNOT WRITE THE FROZEN ARTIFACT. --emit refuses the frozen
 * path by name and exits non-zero. A changed artifact means a GHL rename,
 * production drift, or a generator behaviour change -- all three deserve a
 * human, and an in-place overwrite would erase exactly the drift signal the
 * artifact exists to produce. Promotion is a reviewed human copy.
 *
 * THE KEY COUNT IS NEVER HARDCODED. It comes from walking getConfig("production").
 *
 * Usage, with --location and --config-base always required:
 *   npx tsx scripts/derive-ghl-bindings.ts --location <id> --config-base <ref> [--emit <path>]
 *   npx tsx scripts/derive-ghl-bindings.ts --location <id> --config-base <ref> --check
 *   npx tsx scripts/derive-ghl-bindings.ts --location <id> --config-base <ref> --red-proof <PR1|PR2|PR3>
 * Exit: 0 only when P1-P5 all pass and the requested mode succeeded.
 */

import { config as loadEnv } from "dotenv";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { getConfig } from "../app/shared/ghl-config.ts";

loadEnv();

const BASE = "https://services.leadconnectorhq.com";
const API_VERSION = "2021-07-28";
// Tooling data with exactly one consumer -- the capture tool, in scripts/.
// Deliberately NOT under app/shared/: nothing in the app or the Netlify
// functions reads it, it would be invisible to the Gate 4B-4 identifier scan
// (which walks *.ts/*.tsx only), and it would ship with the Netlify build.
const FROZEN = "scripts/ghl-bindings.json";
const SCHEMA_VERSION = 1;

/** PR1 substitutes an id that cannot exist. Deliberately not a real shape. */
const IMPOSSIBLE_ID = "ZZZZZZZZZZZZZZZZZZZZ";

function die(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(2);
}

// ── Arguments. No defaults, no fallbacks, no env-var substitutes. ───────────

interface Args {
  location: string;
  configBase: string;
  emit: string | null;
  check: boolean;
  redProof: "PR1" | "PR2" | "PR3" | null;
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

  // Provenance metadata supplied by the operator. Validated non-empty only --
  // this tool does not resolve the ref, shell out to git, or branch on it. A
  // hardcoded literal here would silently go stale on a later base.
  const configBase = get("--config-base");
  if (!configBase || configBase.trim() === "") {
    die("--config-base is required. There is no default and no fallback.");
  }

  const redProof = get("--red-proof");
  if (redProof && redProof !== "PR1" && redProof !== "PR2" && redProof !== "PR3") {
    die(`--red-proof must be PR1, PR2 or PR3; got ${JSON.stringify(redProof)}.`);
  }

  return {
    location,
    configBase,
    emit: get("--emit"),
    check: argv.includes("--check"),
    redProof: (redProof as Args["redProof"]) ?? null,
  };
}

// ── The single network call site. ───────────────────────────────────────────

async function readJson(url: string, token: string): Promise<any> {
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Version: API_VERSION },
  });
  if (!res.ok) {
    // Status and path only. Never the body.
    die(`GHL returned HTTP ${res.status} for a read of ${url.replace(BASE, "")}`);
  }
  return res.json();
}

// ── Schema walk ─────────────────────────────────────────────────────────────

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

// ── Handle extraction. UNWRAPPING ONLY -- no normalization, no case folding.
// The handle is the literal string a target location will be searched on.

function unwrapHandle(raw: string): string {
  let h = String(raw ?? "");
  const braced = h.match(/^\{\{\s*(.+?)\s*\}\}$/);
  if (braced) h = braced[1];
  return h.replace(/^contact\./, "").replace(/^opportunity\./, "").replace(/^custom_values\./, "");
}

// ── Surfaces ────────────────────────────────────────────────────────────────

interface GhlObject {
  id: string;
  handleField: "fieldKey" | "name";
  handleRaw: string;
  handle: string;
  scope: Record<string, string> | null;
}

interface Surfaces {
  "S-1": GhlObject[];
  "S-2": GhlObject[];
  "S-3": GhlObject[];
  "S-4": GhlObject[];
  "S-5": GhlObject[];
  "S-6": GhlObject[];
}

const SURFACE_CODES = ["S-1", "S-2", "S-3", "S-4", "S-5", "S-6"] as const;
type SurfaceCode = (typeof SURFACE_CODES)[number];

const GROUP_SURFACE: Record<string, SurfaceCode> = {
  fields: "S-1",
  opportunityFields: "S-2",
  opportunityFacts: "S-2",
  customValues: "S-4",
  folders: "S-3",
  pipelines: "S-5",
  stages: "S-6",
};

/** Candidates in a surface, narrowed by a binding's scope. */
function candidatesIn(surfaces: Surfaces, code: SurfaceCode, scope: Record<string, string> | null): GhlObject[] {
  const all = surfaces[code];
  if (!scope) return all;
  return all.filter((o) => {
    if (!o.scope) return false;
    return Object.entries(scope).every(([k, v]) => o.scope![k] === v);
  });
}

// ── Binding descriptor ──────────────────────────────────────────────────────

interface Binding {
  key: string;
  surface: SurfaceCode;
  handleField: "fieldKey" | "name";
  handle: string;
  handleRaw: string;
  scope: Record<string, string> | null;
}

interface Unresolved {
  key: string;
  expectedSurface: SurfaceCode;
  id: string;
  hits: number;
  foundIn: SurfaceCode | null;
}

interface Derivation {
  bindings: Binding[];
  unresolved: Unresolved[];
  supplied: string[];
  misplaced: Array<{ key: string; expected: SurfaceCode; actual: SurfaceCode }>;
}

function derive(cfg: Record<string, any>, surfaces: Surfaces): Derivation {
  const leaves = walkLeaves(cfg);
  const bindings: Binding[] = [];
  const unresolved: Unresolved[] = [];
  const supplied: string[] = [];
  const misplaced: Derivation["misplaced"] = [];

  for (const leaf of leaves) {
    if (leaf.group === "") {
      // locationId: the sub-account identifier itself. No handle exists and we
      // do not invent one; it is named in suppliedKeys instead.
      supplied.push(leaf.key);
      continue;
    }

    const id = String(readPath(cfg, leaf.key));
    const expectedSurface = GROUP_SURFACE[leaf.group];

    // Expected surface first. On a miss, search all six and say where it was.
    let hitsHere = surfaces[expectedSurface].filter((o) => o.id === id);
    let actualSurface: SurfaceCode | null = hitsHere.length ? expectedSurface : null;
    if (!hitsHere.length) {
      for (const code of SURFACE_CODES) {
        const h = surfaces[code].filter((o) => o.id === id);
        if (h.length) {
          hitsHere = h;
          actualSurface = code;
          misplaced.push({ key: leaf.key, expected: expectedSurface, actual: code });
          break;
        }
      }
    }

    if (hitsHere.length !== 1 || actualSurface === null) {
      unresolved.push({
        key: leaf.key,
        expectedSurface,
        id,
        hits: hitsHere.length,
        foundIn: actualSurface,
      });
      continue;
    }

    const o = hitsHere[0];
    bindings.push({
      key: leaf.key,
      surface: actualSurface,
      handleField: o.handleField,
      handle: o.handle,
      handleRaw: o.handleRaw,
      scope: o.scope,
    });
  }

  bindings.sort((a, b) => a.key.localeCompare(b.key));
  return { bindings, unresolved, supplied, misplaced };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  const token = process.env.GHL_PRIVATE_API_KEY;
  if (!token) die("GHL_PRIVATE_API_KEY is not set. Expected it in the repo-root .env.");

  // The frozen artifact is protected mechanically, before any network work.
  if (args.emit && resolvePath(args.emit) === resolvePath(FROZEN)) {
    die(
      `--emit refuses to write ${FROZEN}. The generator emits a CANDIDATE only; ` +
        `promotion to the frozen artifact is a reviewed human copy, so that a GHL ` +
        `rename, production drift or a generator change cannot land silently.`,
    );
  }

  const loc = args.location;

  const s1: any[] = (await readJson(`${BASE}/locations/${loc}/customFields`, token)).customFields ?? [];
  const s2: any[] =
    (await readJson(`${BASE}/locations/${loc}/customFields?model=opportunity`, token)).customFields ?? [];
  const s4: any[] = (await readJson(`${BASE}/locations/${loc}/customValues`, token)).customValues ?? [];
  const s5: any[] = (await readJson(`${BASE}/opportunities/pipelines?locationId=${loc}`, token)).pipelines ?? [];

  // S-3: no list endpoint. Distinct contact-model parentId values, each
  // confirmed by a singular read. Scoping to the contact model removes the
  // cross-model "Offer" collision by construction rather than by tie-breaking.
  const s1ParentIds = [...new Set(s1.map((o) => o.parentId).filter(Boolean))];
  const s2ParentIds = [...new Set(s2.map((o) => o.parentId).filter(Boolean))];
  const s3raw: any[] = [];
  for (const id of s1ParentIds) {
    const body = await readJson(`${BASE}/locations/${loc}/customFields/${id}`, token);
    const o = body.customField ?? body;
    if (o && o.documentType === "folder") s3raw.push({ ...o, id });
  }

  const asField = (o: any): GhlObject => ({
    id: String(o.id),
    handleField: "fieldKey",
    handleRaw: String(o.fieldKey ?? ""),
    handle: unwrapHandle(o.fieldKey),
    scope: null,
  });

  // Stage scope names the PARENT PIPELINE'S CONFIG KEY, so pipeline scoping is
  // data in the artifact rather than logic in the consumer. Derived, never
  // hardcoded: the pipeline's own id is looked up in the config's pipelines.
  // Cloned for consistency with baseCfg below. Read-only here, so there is no
  // bug either way -- but an uncloned handle to the shared module object
  // sitting beside a cloned one is an invitation, and this file's headline
  // discipline is that copies are independent.
  const prodForScope = structuredClone(getConfig("production")) as Record<string, any>;
  const pipelineKeyById = new Map<string, string>();
  for (const [k, v] of Object.entries(prodForScope.pipelines ?? {})) {
    pipelineKeyById.set(String(v), `pipelines.${k}`);
  }

  const s6: GhlObject[] = [];
  for (const p of s5) {
    const parentKey = pipelineKeyById.get(String(p.id)) ?? null;
    for (const st of p.stages ?? []) {
      s6.push({
        id: String(st.id),
        handleField: "name",
        handleRaw: String(st.name ?? ""),
        handle: String(st.name ?? ""),
        scope: parentKey ? { parentPipelineKey: parentKey } : { parentPipelineId: String(p.id) },
      });
    }
  }

  const surfaces: Surfaces = {
    "S-1": s1.map(asField),
    "S-2": s2.map(asField),
    "S-3": s3raw.map((o) => ({
      id: String(o.id),
      handleField: "name" as const,
      handleRaw: String(o.name ?? ""),
      handle: String(o.name ?? ""),
      scope: { model: String(o.model ?? "") },
    })),
    "S-4": s4.map((o) => ({
      id: String(o.id),
      handleField: "fieldKey" as const,
      handleRaw: String(o.fieldKey ?? ""),
      handle: unwrapHandle(o.fieldKey),
      scope: null,
    })),
    "S-5": s5.map((p) => ({
      id: String(p.id),
      handleField: "name" as const,
      handleRaw: String(p.name ?? ""),
      handle: String(p.name ?? ""),
      scope: null,
    })),
    "S-6": s6,
  };

  const counts = {
    S1: s1.length,
    S2: s2.length,
    S3: [...new Set([...s1ParentIds, ...s2ParentIds])].length,
    S4: s4.length,
    S5: s5.length,
    S6: s6.length,
  };
  console.error(`surface counts: ${JSON.stringify(counts)}`);
  console.error(
    `parentId split: contact-model ${s1ParentIds.length}, opportunity-model ${s2ParentIds.length}, union ${counts.S3}`,
  );

  // ── Derive twice: once clean to choose red-proof targets, once for real. ──
  const baseCfg = structuredClone(getConfig("production")) as Record<string, any>;
  const schemaLeafCount = walkLeaves(baseCfg).length;
  console.error(`schema leaves discovered: ${schemaLeafCount}`);

  const clean = derive(baseCfg, surfaces);

  // PR1 and PR2 mutate the config BEFORE derivation -- they are about
  // resolution. PR3 mutates the artifact structure AFTER derivation, leaving
  // resolution untouched, which is the only way P5 can fail while P1-P4 pass.
  let workCfg = baseCfg;
  if (args.redProof === "PR1" || args.redProof === "PR2") {
    const resolvedKeys = clean.bindings.map((b) => b.key).sort();
    const need = args.redProof === "PR2" ? 2 : 1;
    if (resolvedKeys.length < need) {
      die(
        `--red-proof ${args.redProof} cannot run: only ${resolvedKeys.length} key(s) resolved and ` +
          `${need} are needed. Not falling back to an unresolvable key.`,
      );
    }
    workCfg = structuredClone(baseCfg) as Record<string, any>;
    if (args.redProof === "PR1") {
      const t = resolvedKeys[0];
      writePath(workCfg, t, IMPOSSIBLE_ID);
      console.error(`RED PROOF PR1: replaced production id for "${t}" with an id that cannot exist`);
    } else {
      const [a, b] = [resolvedKeys[0], resolvedKeys[1]];
      writePath(workCfg, b, String(readPath(workCfg, a)));
      console.error(`RED PROOF PR2: copied the id of "${a}" over "${b}" so two keys share one id`);
    }
  }

  const d = derive(workCfg, surfaces);

  // PR3: drop one RESOLVED binding from the artifact structure only. Resolution
  // results are untouched, so P1 and P2 (which read d.unresolved) and P3 and P4
  // (which iterate the remaining bindings) all stay green, and P5 fails alone --
  // which is the only way to show P5 measures artifact completeness rather than
  // riding along on a resolution failure. Promotion is the act P5 guards.
  if (args.redProof === "PR3") {
    if (d.bindings.length === 0) {
      die("--red-proof PR3 cannot run: no binding resolved, so there is none to omit.");
    }
    const omitted = d.bindings[0].key;
    d.bindings.splice(0, 1);
    console.error(`RED PROOF PR3: omitted the resolved binding for "${omitted}" from the artifact`);
  }

  // ── P1 - P5 ───────────────────────────────────────────────────────────────
  const failures: string[] = [];

  // P1: every production id resolves to exactly one object.
  const p1bad = d.unresolved.filter((u) => u.hits !== 1);
  const p1 = p1bad.length === 0;
  if (!p1) {
    for (const u of p1bad) {
      failures.push(
        `P1  ${u.key}\n    its production id resolved to ${u.hits} object(s)` +
          (u.hits === 0 ? " — zero objects carry this id in any surface" : ""),
      );
    }
  }

  // P2: all resolve, zero unreachable.
  // Every unresolved key prints a reason. p2 is false whenever d.unresolved is
  // non-empty, so the hits > 1 case must print too -- an assertion that fails
  // without naming why is exactly what this gate exists to eliminate.
  const p2 = d.unresolved.length === 0;
  if (!p2) {
    for (const u of d.unresolved) {
      failures.push(
        u.hits === 0
          ? `P2  ${u.key}\n    unreachable: no object in ${u.expectedSurface} or any other surface carries its id`
          : `P2  ${u.key}\n    unresolved: its id matched ${u.hits} objects in ${u.foundIn ?? u.expectedSurface}, so no single binding could be written`,
      );
    }
  }

  // P3: no two bindings share (surface, handle, scope).
  const seen = new Map<string, string[]>();
  for (const b of d.bindings) {
    const sig = `${b.surface}|${b.handle}|${JSON.stringify(b.scope)}`;
    seen.set(sig, [...(seen.get(sig) ?? []), b.key]);
  }
  const collisions = [...seen.entries()].filter(([, keys]) => keys.length > 1);
  const p3 = collisions.length === 0;
  if (!p3) {
    for (const [sig, keys] of collisions) {
      const [surface, handle] = sig.split("|");
      failures.push(
        `P3  ${keys.join(" AND ")}\n    share ${surface} handle "${handle}" — indistinguishable in a target location`,
      );
    }
  }

  // P4: reverse lookup. handle -> object -> id, searching the surface by handle.
  let p4 = true;
  for (const b of d.bindings) {
    const pool = candidatesIn(surfaces, b.surface, b.scope);
    const hits = pool.filter((o) => o.handle === b.handle);
    const startedFrom = String(readPath(workCfg, b.key));
    if (hits.length !== 1) {
      p4 = false;
      failures.push(`P4  ${b.key}\n    handle "${b.handle}" matched ${hits.length} objects in ${b.surface}`);
    } else if (hits[0].id !== startedFrom) {
      p4 = false;
      failures.push(
        `P4  ${b.key}\n    handle "${b.handle}" round-tripped to a different id than the one it came from`,
      );
    }
  }

  // P5: supplied + bindings === schema leaves.
  const p5 = d.supplied.length + d.bindings.length === schemaLeafCount;
  if (!p5) {
    // Name the keys the artifact fails to account for at all -- neither bound,
    // nor reported unresolved, nor supplied. That is the omission P5 guards
    // against, and counts alone would not identify it.
    const accountedFor = new Set([
      ...d.bindings.map((b) => b.key),
      ...d.unresolved.map((u) => u.key),
      ...d.supplied,
    ]);
    const unaccounted = walkLeaves(workCfg)
      .map((l) => l.key)
      .filter((k) => !accountedFor.has(k));
    failures.push(
      `P5  supplied ${d.supplied.length} + bindings ${d.bindings.length} = ` +
        `${d.supplied.length + d.bindings.length}, expected ${schemaLeafCount}` +
        (unaccounted.length
          ? `\n    omitted from the artifact: ${unaccounted.join(", ")}`
          : `\n    (every schema key is accounted for; the shortfall is a key reported unresolved above)`),
    );
  }

  console.error("");
  console.error(`P1 id resolves to exactly one : ${p1 ? "PASS" : "FAIL"}`);
  console.error(`P2 all resolve, none missing  : ${p2 ? "PASS" : "FAIL"}`);
  console.error(`P3 handles distinguishable    : ${p3 ? "PASS" : "FAIL"}`);
  console.error(`P4 reverse lookup round-trips : ${p4 ? "PASS" : "FAIL"}`);
  console.error(`P5 supplied + bindings = leaves: ${p5 ? "PASS" : "FAIL"}  (${d.supplied.length} + ${d.bindings.length} = ${schemaLeafCount})`);
  if (failures.length) {
    console.error("");
    for (const f of failures) console.error(f);
  }
  if (d.misplaced.length) {
    console.error("");
    for (const m of d.misplaced) {
      console.error(`SURFACE NOTE  ${m.key} expected in ${m.expected} but found in ${m.actual}`);
    }
  }

  const allPass = p1 && p2 && p3 && p4 && p5;

  const artifact = {
    schemaVersion: SCHEMA_VERSION,
    derivedFrom: {
      locationId: args.location,
      configBase: args.configBase,
      schemaLeafCount,
    },
    suppliedKeys: d.supplied,
    bindings: d.bindings,
  };

  // ── Modes ─────────────────────────────────────────────────────────────────
  if (args.check) {
    if (!existsSync(FROZEN)) {
      console.error("");
      console.error(`--check: no frozen artifact at ${FROZEN}. This is a first generation;`);
      console.error(`there is nothing to compare against yet. Emit a candidate and promote it.`);
      return 1;
    }
    const frozen = JSON.parse(readFileSync(FROZEN, "utf8"));
    const a = JSON.stringify(frozen.bindings ?? []);
    const b = JSON.stringify(artifact.bindings);
    if (a === b && JSON.stringify(frozen.suppliedKeys ?? []) === JSON.stringify(artifact.suppliedKeys)) {
      console.error("--check: derived bindings are identical to the frozen artifact.");
      return allPass ? 0 : 1;
    }
    console.error("--check: derived bindings DIFFER from the frozen artifact.");
    const frozenByKey = new Map((frozen.bindings ?? []).map((x: any) => [x.key, x]));
    for (const nb of artifact.bindings) {
      const ob: any = frozenByKey.get(nb.key);
      if (!ob) console.error(`  ADDED    ${nb.key}`);
      else if (JSON.stringify(ob) !== JSON.stringify(nb)) {
        console.error(`  CHANGED  ${nb.key}`);
        console.error(`    frozen  handle "${ob.handle}" scope ${JSON.stringify(ob.scope)}`);
        console.error(`    derived handle "${nb.handle}" scope ${JSON.stringify(nb.scope)}`);
      }
    }
    const newKeys = new Set(artifact.bindings.map((x) => x.key));
    for (const ob of frozen.bindings ?? []) {
      if (!newKeys.has(ob.key)) console.error(`  REMOVED  ${ob.key}`);
    }
    return 1;
  }

  if (args.emit) {
    if (!allPass) {
      console.error("");
      console.error("refusing to emit a candidate: provenance proofs did not all pass.");
      return 1;
    }
    writeFileSync(args.emit, JSON.stringify(artifact, null, 2) + "\n");
    console.error("");
    console.error(`wrote candidate ${args.emit} — ${artifact.bindings.length} bindings, ${artifact.suppliedKeys.length} supplied key(s)`);
    console.error(`promotion to ${FROZEN} is a reviewed human copy, not something this tool does.`);
    return 0;
  }

  console.error("");
  console.error(`derived ${d.bindings.length} bindings, ${d.supplied.length} supplied key(s). Nothing written.`);
  return allPass ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(3);
  });
