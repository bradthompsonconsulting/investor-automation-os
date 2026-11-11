/**
 * B15-29 P-1 -- POST /.netlify/functions/session-authority-probe  (Test only; Production 404)
 *
 * The U1 / U2 / U4 live gate of the activation plan (section 1), run through the real Lambda-context store transport
 * (lib/session-revocation.ts runAuthorityProbe). Order, each step before the next:
 *   1. the Test-only gate (lib/test-probe-gate.ts): anything but the pinned Test site, or any query string -> 404;
 *   2. POST only (anything else -> 404);
 *   3. Brad's allowlisted READ session: readAuthRefusal, then sessionReadRefusal (a no-op while one IAOS sign-in is off,
 *      as U1-U4 run before activation);
 *   4. a fixed body, exactly { "probe": "authority" | "check", "runId": "<16-32 [A-Za-z0-9_-]>" } (anything else -> 404);
 *   5. the probe: ONLY keys probe/<runId>/ in iaos-write-receipts; never the authority store, never a real session
 *      record, never a delete. "authority" runs U1/U2 (runAuthorityProbe); "check" times the session-check shape (two
 *      identical-byte onlyIfMatch writes in parallel, per sample; runCheckShapeProbe) for U3.
 * Answers 200 with the probe transcript (statuses, `modified`, ETag-equality booleans, server-measured duration_ms /
 * total_ms, the U4 header report) and a top-level `ok`: a run that stopped or failed is 200 with ok:false, never a
 * transcript the caller could read as a pass. 503 if the store context could not be established. No cookie, token, ETag value or platform context is ever returned.
 * No GHL module is imported.
 */
import { readAuthRefusal } from "./lib/app-read-auth";
import { sessionReadRefusal, runAuthorityProbe, runCheckShapeProbe, PROBE_RUN_ID } from "./lib/session-revocation";
import { testProbeGateOpen, exactJsonBody, PROBE_NOT_FOUND } from "./lib/test-probe-gate";

const json = (statusCode: number, body: unknown) => ({ statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(body) });

export const handler = async (event: any) => {
  if (!testProbeGateOpen(event)) return PROBE_NOT_FOUND;
  if (event.httpMethod !== "POST") return PROBE_NOT_FOUND;
  const refused = readAuthRefusal(event);
  if (refused) return refused;
  const revoked = await sessionReadRefusal(event);
  if (revoked) return revoked;
  const body = exactJsonBody(event, ["probe", "runId"]);
  if (!body || (body.probe !== "authority" && body.probe !== "check") || typeof body.runId !== "string" || !PROBE_RUN_ID.test(body.runId)) return PROBE_NOT_FOUND;
  const result = body.probe === "check" ? await runCheckShapeProbe(body.runId, "test", { event }) : await runAuthorityProbe(body.runId, "test", { event });
  if ("refused" in result) return json(503, { error: "The probe could not reach the session store", reason: result.refused });
  return json(200, result);
};
