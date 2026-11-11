/**
 * B15-29 P-2 -- POST /.netlify/functions/protected-noop  (Test only; Production 404)
 *
 * The A6 / positive-writer control of the activation plan (section 1). It runs the EXACT writer authorization chain
 * that every business writer runs, then does nothing:
 *   gate (lib/test-probe-gate.ts) -> POST -> requireAppWriter (401) -> requireAppWriteOrigin (403)
 *   -> sessionWriteRefusal (401 session_expired / revoked / one_login_off ...) -> authorize("write") (403)
 *   -> body exactly { "probe": "a6" } (400 malformed: validated AFTER authorization, so an authorization refusal and
 *      a malformed request are distinguishable) -> 200 { ok: true, sent: false }.
 * It imports no GHL module and makes no outbound request: nothing can be sent.
 */
import { requireAppWriter } from "./lib/app-write-auth";
import { requireAppWriteOrigin } from "./lib/app-write-origin";
import { sessionWriteRefusal } from "./lib/session-revocation";
import { authorize } from "./lib/authorization";
import { testProbeGateOpen, exactJsonBody, PROBE_NOT_FOUND } from "./lib/test-probe-gate";

const json = (statusCode: number, body: unknown) => ({ statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(body) });

export const handler = async (event: any) => {
  if (!testProbeGateOpen(event)) return PROBE_NOT_FOUND;
  if (event.httpMethod !== "POST") return PROBE_NOT_FOUND;
  let writer: string;
  try { writer = requireAppWriter(event); } catch { return json(401, { error: "Application write sign-in required" }); }
  try { requireAppWriteOrigin(event); } catch { return json(403, { error: "Application write origin refused" }); }
  const writeRevoked = await sessionWriteRefusal(event);
  if (writeRevoked) return writeRevoked;
  if (!authorize({ sub: writer, email: writer }, "write").ok) return json(403, { error: "This account may not save in IAOS", reason: "not_authorized" });
  const body = exactJsonBody(event, ["probe"]);
  if (!body || body.probe !== "a6") return json(400, { error: "malformed" });
  return json(200, { ok: true, sent: false });
};
