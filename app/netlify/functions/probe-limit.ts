/**
 * Storage correction (plan v6 §7, §12) -- the Test-only EXECUTION-LIMIT PROBE.
 * RELEASE-GATED: every run is separately authorized.
 *
 * Heartbeats every 500 ms to `probe/<runId>/heartbeat` in `iaos-storage-probe`
 * (compare-and-swap through the verified adapter) until it is terminated or its
 * own 55 s ceiling. `L_obs` = the last PERSISTED heartbeat's elapsed time:
 * evidence only that the function "ran at least L_obs". How it ended (status,
 * elapsed, error body, Netlify log line) is recorded separately by Brad and is
 * never used to compute budgets. Same refusals as storage-probe; no GHL module.
 */
import { requireAppWriter } from "./lib/app-write-auth";
import { requireAppWriteOrigin } from "./lib/app-write-origin";
import { legacyEventFrom, toResponse, json, type LambdaResult, type LegacyEvent } from "./lib/modern-runtime";
import { InvocationScope, clock } from "./lib/invocation-scope";
import { VerifiedStore } from "./lib/verified-store";
import { deployContextOf } from "./lib/write-gate";
import { probeAllowed, PROBE_STORE } from "./storage-probe";
import { SDK_VERSION } from "./lib/capability";

export default async (req: Request, context: any): Promise<Response> => {
  const event = await legacyEventFrom(req, { requireJson: true, maxBytes: 10_000 });
  const scope = new InvocationScope("probe-limit");
  try { return toResponse(await handle(event, context, scope)); } finally { scope.close(); }
};

async function handle(event: LegacyEvent, context: any, scope: InvocationScope): Promise<LambdaResult> {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  if (!probeAllowed(process.env, context)) return json(403, { error: "The limit probe runs only on the published Test deployment" });
  try { requireAppWriter(event); } catch { return json(401, { error: "Application write sign-in required" }); }
  try { requireAppWriteOrigin(event); } catch { return json(403, { error: "Application write origin refused" }); }
  let runId: string;
  try { if (event.isBase64Encoded) throw new Error(); runId = JSON.parse(event.body ?? "null")?.runId; if (!/^[A-Za-z0-9_-]{8,40}$/.test(runId)) throw new Error(); }
  catch { return json(400, { error: "Invalid probe request" }); }
  const store = new VerifiedStore(scope, PROBE_STORE);
  const key = `probe/${runId}/heartbeat`;
  let etag: string | null = null;
  let beats = 0;
  const started = scope.startedAt;
  while (scope.isOpen && clock.now() - started < 55_000) {
    const w: { result: string; etag?: string } | null = await store.cas(key, { elapsedMs: clock.now() - started, beats, deployId: deployContextOf(context).id, sdk: SDK_VERSION, node: process.version }, etag, "storage_write").catch(() => null);
    if (!w || w.result !== "written") break;
    etag = w.etag ?? null; beats++;
    await new Promise((r) => setTimeout(r, 500));
  }
  return json(200, { beats, ranAtLeastMs: clock.now() - started });
}
