/**
 * B15-29 P-2 reader twin -- GET /.netlify/functions/protected-noop-read  (Test only; Production 404)
 *
 * The exact reader authorization chain, then nothing: gate (lib/test-probe-gate.ts) -> GET -> readAuthRefusal
 * (503 unconfigured / 401) -> sessionReadRefusal (401 expired / revoked, 503 unavailable) -> 204 with no body.
 * It imports no GHL module and makes no outbound request.
 */
import { readAuthRefusal } from "./lib/app-read-auth";
import { sessionReadRefusal } from "./lib/session-revocation";
import { testProbeGateOpen, PROBE_NOT_FOUND } from "./lib/test-probe-gate";

export const handler = async (event: any) => {
  if (!testProbeGateOpen(event)) return PROBE_NOT_FOUND;
  if (event.httpMethod !== "GET") return PROBE_NOT_FOUND;
  const refused = readAuthRefusal(event);
  if (refused) return refused;
  const revoked = await sessionReadRefusal(event);
  if (revoked) return revoked;
  return { statusCode: 204, headers: { "Cache-Control": "no-store" }, body: "" };
};
