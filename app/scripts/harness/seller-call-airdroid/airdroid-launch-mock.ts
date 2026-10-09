/**
 * B14-13 — test-only replacement for src/lib/airdroid-launch-stand-in.ts.
 *
 * test-seller-call-airdroid.cjs aliases the component's import of the stand-in
 * to this file, so every launch is MOCKED: nothing opens a link, window or
 * request, and no helper, AirDroid or phone is involved. The test sets
 * `window.__airdroidMock.mode` and reads back the targets it was given:
 *   "handed-off" -- the launch interface accepted it (a launch the operator
 *                   then cancels outside the page looks exactly like this);
 *   "error"      -- a known launch error;
 *   "throw"      -- the launch interface threw.
 * Number validation is the stand-in's own (re-exported, unchanged).
 */
export { airdroidCallTarget, type AirdroidLaunchResult } from "../../../src/lib/airdroid-launch-stand-in";
import type { AirdroidLaunchResult } from "../../../src/lib/airdroid-launch-stand-in";

export const MOCK_LAUNCH_ERROR = "The AirDroid helper isn't installed on this PC.";

type Mock = { mode: "handed-off" | "error" | "throw"; calls: string[] };
declare global { interface Window { __airdroidMock: Mock } }
window.__airdroidMock ??= { mode: "handed-off", calls: [] };

export function launchAirdroidCall(target: string): AirdroidLaunchResult {
  const mock = window.__airdroidMock;
  mock.calls.push(target);
  if (mock.mode === "throw") throw new Error("mock launch interface threw");
  if (mock.mode === "error") return { ok: false, error: MOCK_LAUNCH_ERROR };
  return { ok: true };
}
