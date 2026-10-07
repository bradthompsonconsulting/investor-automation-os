/**
 * Storage correction (plan v6 §12) -- the Test-only STORAGE PROBE.
 * RELEASE-GATED: every run is separately authorized.
 *
 * Refuses unless IAOS_ENV === "test", the runtime deploy context is a
 * published production deploy, Brad's write session and the exact Test origin
 * are present. Uses store `iaos-storage-probe` ONLY, keys under
 * `probe/<runId>/` only; imports no GHL module (static test); outputs counts,
 * classes and latency percentiles only. Not deployed to Production
 * (scripts/production-build-guard.cjs).
 *
 *   {action:"contend", runId, contender}     one conditional create on the shared key (run N in parallel: exactly one "written")
 *   {action:"rw_write", runId}                write a marker in THIS invocation
 *   {action:"rw_read", runId}                 strong-read it in ANOTHER invocation (cross-invocation read-your-write)
 *   {action:"lock_race", runId, role}         lock v2 on a probe key (L1, run as A then B)
 *   {action:"latency", runId, n}              n strong reads + n conditional writes: p50/p95/p99
 */
import { requireAppWriter } from "./lib/app-write-auth";
import { requireAppWriteOrigin } from "./lib/app-write-origin";
import { legacyEventFrom, toResponse, json, type LambdaResult, type LegacyEvent } from "./lib/modern-runtime";
import { InvocationScope } from "./lib/invocation-scope";
import { VerifiedStore, StorageUncertain } from "./lib/verified-store";
import { deployContextOf } from "./lib/write-gate";
import { acquireLock } from "./lib/contact-lock-v2";
import { SDK_VERSION } from "./lib/capability";

export const PROBE_STORE = "iaos-storage-probe";
const RUN = /^[A-Za-z0-9_-]{8,40}$/;

export default async (req: Request, context: any): Promise<Response> => {
  const event = await legacyEventFrom(req, { requireJson: true, maxBytes: 10_000 });
  const scope = new InvocationScope("storage-probe");
  try { return toResponse(await handle(event, context, scope)); } finally { scope.close(); }
};

export function probeAllowed(env: Record<string, string | undefined>, context: any): boolean {
  const d = deployContextOf(context);
  return env.IAOS_ENV === "test" && d.context === "production" && d.published === true && !!d.id;
}

const pct = (xs: number[], p: number) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };

async function handle(event: LegacyEvent, context: any, scope: InvocationScope): Promise<LambdaResult> {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  if (!probeAllowed(process.env, context)) return json(403, { error: "The storage probe runs only on the published Test deployment" });
  try { requireAppWriter(event); } catch { return json(401, { error: "Application write sign-in required" }); }
  try { requireAppWriteOrigin(event); } catch { return json(403, { error: "Application write origin refused" }); }
  let b: any;
  try { if (event.isBase64Encoded) throw new Error(); b = JSON.parse(event.body ?? "null"); if (!b || !RUN.test(b.runId)) throw new Error(); }
  catch { return json(400, { error: "Invalid probe request" }); }
  const store = new VerifiedStore(scope, PROBE_STORE);
  const k = (name: string) => `probe/${b.runId}/${name}`;
  const evidence = { deployId: deployContextOf(context).id, sdk: SDK_VERSION, node: process.version };
  const cls = (e: unknown) => (e instanceof StorageUncertain ? e.cls : "unexpected");
  try {
    switch (b.action) {
      case "contend": {
        try { const w = await store.createOnce(k("contend"), { contender: String(b.contender ?? "").slice(0, 40) }); return json(200, { result: w.result, ...evidence }); }
        catch (e) { return json(200, { result: "uncertain", class: cls(e), ...evidence }); }
      }
      case "rw_write": { const w = await store.createOnce(k("rw"), { at: Date.now() }); return json(200, { result: w.result, ...evidence }); }
      case "rw_read": { const r = await store.read(k("rw")); return json(200, { found: !!r, ...evidence }); }
      case "lock_race": {
        const lock = await acquireLock(store, scope, k("lock"), { opId: String(b.role ?? "x").slice(0, 8), deployId: evidence.deployId ?? "x" });
        const released = await lock.release();
        return json(200, { acquired: true, released, ...evidence });
      }
      case "latency": {
        const n = Math.min(Math.max(1, Number(b.n) || 20), 50);
        const reads: number[] = []; const writes: number[] = [];
        for (let i = 0; i < n; i++) {
          let t = Date.now(); await store.createOnce(k(`lat-${i}`), { i }); writes.push(Date.now() - t);
          t = Date.now(); await store.read(k(`lat-${i}`)); reads.push(Date.now() - t);
        }
        return json(200, { n, strongRead: { p50: pct(reads, 50), p95: pct(reads, 95), p99: pct(reads, 99) }, conditionalWrite: { p50: pct(writes, 50), p95: pct(writes, 95), p99: pct(writes, 99) }, ...evidence });
      }
      default: return json(400, { error: "Unknown probe action" });
    }
  } catch (e) { return json(503, { error: "Probe step failed", class: cls(e), ...evidence }); }
}
