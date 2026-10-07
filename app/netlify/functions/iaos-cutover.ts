/**
 * Storage correction -- the separately authorized CUTOVER tools (plan v6 §8.4,
 * §9, §10; amendment r4 §C). Each action is a gated release step run only
 * when Brad authorizes it; this function merely enforces the contracts.
 * It never calls GHL, never writes the legacy store, never releases or
 * clears anything, and holds no Netlify credential.
 *
 *   POST {action:"import_claim_owner", runId, runToken}          the ONE store-wide owner (no takeover)
 *   POST {action:"import_capture", runId, runToken, snapshot}    Phase A, one bounded batch (S1 | S2 | S3)
 *   POST {action:"import_dry_run", runId, runToken, knownSubjects}
 *   POST {action:"import_complete", runId, runToken, knownSubjects, T_r}
 *   POST {action:"g5_init"}                                       the default {location: ALL} table
 *   POST {action:"g5_narrow", record}                             one N1–N4 / AUDIT record (immutable)
 *   POST {action:"g5_widen", entry}                               always allowed
 *   POST {action:"register_semantics", n, record}                 an approved provider-semantics record
 *   GET  (read session)                                           import, cutover and G5 status
 */
import { requireAppWriter } from "./lib/app-write-auth";
import { requireAppWriteOrigin } from "./lib/app-write-origin";
import { readAuthRefusal } from "./lib/app-read-auth";
import { legacyEventFrom, toResponse, json, type LambdaResult, type LegacyEvent } from "./lib/modern-runtime";
import { invocation, type Invocation } from "./lib/endpoint-kit";
import { requireWritableDeployment, WriteRefused } from "./lib/write-gate";
import { LEGACY_STORE, StorageUncertain, VerifiedStore, RecordMismatch } from "./lib/verified-store";
import { acquireLock, LockHeld, LockUnknown } from "./lib/contact-lock-v2";
import { CUTOVER_KEY, IMPORT_LOCK_KEY, IMPORT_OWNER_KEY } from "./lib/cutover";
import { captureBatch, claimImportOwner, completeImport, dryRunReport, ImportHalted, loadWorld, requireOwner, SNAPSHOTS, type Snapshot } from "./lib/legacy-import";
import { DEFAULT_TABLE, G5_NARROW_PREFIX, G5_TABLE_KEY, applyNarrowing, readG5Table, tableDigest, validTable, widen, NarrowingRefused, type NarrowingRecord } from "./lib/g5-gate";
import { registerSemantics, widenEffectiveG5, PublicationRefused } from "./lib/admission";
import { canonical } from "./lib/hash";

export const DRAIN_MINUTES = 30;

export default async (req: Request, context: any): Promise<Response> => {
  const event = await legacyEventFrom(req, { requireJson: true, maxBytes: 1_000_000 });
  const inv = invocation("iaos-cutover", context);
  try { return toResponse(await handle(event, inv)); } finally { inv.scope.close(); }
};

const subjectsOk = (s: unknown): s is string[] => Array.isArray(s) && s.length <= 10_000 && s.every((x) => typeof x === "string" && /^(contact|opportunity):[A-Za-z0-9_-]{1,64}$/.test(x));

async function handle(event: LegacyEvent, inv: Invocation): Promise<LambdaResult> {
  const s = inv.store;
  if (event.httpMethod === "GET") {
    const refused = readAuthRefusal(event);
    if (refused) return refused as LambdaResult;
    try {
      const [owner, cutover, g5] = await Promise.all([s.readData(IMPORT_OWNER_KEY), s.readData(CUTOVER_KEY), readG5Table(s)]);
      return json(200, { owner: owner ? { runId: owner.runId, state: owner.state, manifestDigest: owner.manifestDigest ?? null } : null, cutover, g5: g5 ? { digest: tableDigest(g5.table), entries: g5.table.entries.length, narrowings: g5.table.narrowings } : null });
    } catch { return json(503, { error: "Status could not be read" }); }
  }
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  try { requireAppWriter(event); } catch { return json(401, { error: "Application write sign-in required" }); }
  try { requireAppWriteOrigin(event); } catch { return json(403, { error: "Application write origin refused" }); }
  /* Bones review finding 2: every control mutation requires a PUBLISHED PRODUCTION deploy context,
     checked before any storage access. Deploy previews, unpublished permalinks and branch deploys
     are refused whatever their credentials. Authenticated GET status reads stay available. */
  try { requireWritableDeployment(inv.deploy); }
  catch (e) { if (e instanceof WriteRefused) return json(e.refusal.status, e.refusal.body); throw e; }
  let b: any;
  try {
    if (event.isBase64Encoded || Object.keys(event.queryStringParameters ?? {}).length) throw new Error("encoding");
    b = JSON.parse(event.body ?? "null");
    if (!b || typeof b !== "object" || Array.isArray(b) || typeof b.action !== "string") throw new Error("shape");
  } catch { return json(400, { error: "Invalid cutover request" }); }
  const input = { env: inv.env, locationId: inv.config.locationId };
  try {
    switch (b.action) {
      case "import_claim_owner": { const o = await claimImportOwner(s, b.runId, b.runToken); return json(200, { owner: o.runId, state: o.state }); }
      case "import_capture": {
        if (!SNAPSHOTS.includes(b.snapshot)) return json(400, { error: "Unknown snapshot" });
        await requireOwner(s, b.runId, b.runToken);
        // Batches of the owning run are serialized on the FIXED import lock (independent of the run).
        let lock;
        try { lock = await acquireLock(s, inv.scope, IMPORT_LOCK_KEY, { opId: b.runId, deployId: inv.deploy.id ?? "unknown" }); }
        catch (e) { if (e instanceof LockHeld || e instanceof LockUnknown) return json(409, { refused: "import_batch_in_progress" }); throw e; }
        try {
          const legacy = new VerifiedStore(inv.scope, LEGACY_STORE, undefined, true);
          const r = await captureBatch(s, legacy, inv.scope, { runId: b.runId, snapshot: b.snapshot as Snapshot, ...input }, b.dry === true);
          return json(200, r);
        } finally { await lock.release(); }
      }
      case "import_dry_run": {
        await requireOwner(s, b.runId, b.runToken);
        if (!subjectsOk(b.knownSubjects ?? [])) return json(400, { error: "Invalid knownSubjects" });
        return json(200, dryRunReport(await loadWorld(s, b.runId), { ...input, knownSubjects: b.knownSubjects ?? [], unstablePrefixes: [] }));
      }
      case "import_complete": {
        if (!subjectsOk(b.knownSubjects ?? []) || typeof b.T_r !== "string") return json(400, { error: "Invalid completion request" });
        const world = await loadWorld(s, b.runId);
        const r = await completeImport(s, { ...input, runId: b.runId, runToken: b.runToken, knownSubjects: b.knownSubjects ?? [], unstablePrefixes: [], T_r: b.T_r, drainMinutes: DRAIN_MINUTES }, world);
        return json(200, { complete: true, manifestDigest: r.digest, counts: r.manifest.counts, blocks: r.manifest.blocks.length });
      }
      case "g5_init": {
        const w = await s.createOnce(G5_TABLE_KEY, DEFAULT_TABLE(), "g5_gate");
        return json(200, { created: w.result === "written" });
      }
      case "g5_narrow": {
        const rec = b.record as NarrowingRecord;
        const cur = await readG5Table(s);
        if (!cur) return json(409, { refused: "no_table" });
        const next = applyNarrowing(cur.table, rec);   // validates (N1–N4 / AUDIT); never widens
        await s.writeOnceVerified(G5_NARROW_PREFIX + rec.id, rec, (g) => canonical(g) === canonical(rec), "g5_gate");
        const w = await s.cas(G5_TABLE_KEY, next, cur.etag, "g5_gate");
        if (w.result !== "written") return json(409, { refused: "table_changed" });
        return json(200, { narrowed: true, digest: tableDigest(next), note: "A changed table digest refuses every write until a fresh activation records it." });
      }
      case "g5_widen": {
        const cur = await readG5Table(s);
        const base = cur?.table ?? DEFAULT_TABLE();
        const next = widen(base, b.entry ?? {});
        if (!validTable(next)) return json(400, { error: "Invalid entry" });
        const w = await s.cas(G5_TABLE_KEY, next, cur ? cur.etag : null, "g5_gate");
        if (w.result !== "written") return json(409, { refused: "table_changed" });
        /* Bones finding 1: the widening takes effect in the authoritative admission record in ONE
           compare-and-swap that also revokes admitted overlapping tickets. The staged table above
           carries it into every later activation. A failure here is retried safely (idempotent). */
        const eff = await widenEffectiveG5(s, b.entry);
        return json(200, { widened: true, digest: tableDigest(next), effective: eff.widened, revokedAdmitted: eff.revoked });
      }
      case "register_semantics": { await registerSemantics(s, b.n, b.record); return json(200, { registered: true }); }
      default: return json(400, { error: "Unknown action" });
    }
  } catch (e) {
    if (e instanceof ImportHalted) return json(409, { halted: e.message });
    if (e instanceof NarrowingRefused) return json(409, { refused: "narrowing", error: e.message });
    if (e instanceof PublicationRefused) return json(409, { refused: e.code, error: e.message });
    if (e instanceof RecordMismatch) return json(409, { refused: "record_exists_with_different_content" });
    if (e instanceof StorageUncertain) return json(503, { error: "Storage outcome uncertain; read status before anything else" });
    return json(503, { error: "The cutover request could not be completed" });
  }
}
