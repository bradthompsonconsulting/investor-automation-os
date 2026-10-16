/**
 * AirDroid call eligibility — the browser side (Jess ruling 2026-10-16;
 * Brad-approved scope IAOS_AIRDROID_CALL_ELIGIBILITY_AMENDED_SCOPE_2026-10-16.md).
 *
 * Both AirDroid buttons on Seller Call ask the read-only call-eligibility
 * function at click time and hand off to AirDroid only when:
 *   - the response has exactly the expected shape and decision "eligible";
 *   - it is for the contact the click was made for; and
 *   - its fresh number's digits equal the number the click was made for.
 * Anything else blocks: an unexpected shape or status is "unknown", never
 * eligible. The decision itself is the server's (call-eligibility-rule.ts).
 *
 * This is an eligibility check against GHL records, not consent. Status can
 * still change in GHL between this read and AirDroid's dial.
 */
import { readFetch } from "./read-session";

export const CALL_ELIGIBILITY_ENDPOINT = "/.netlify/functions/call-eligibility";
export const CLIENT_TIMEOUT_MS = 8000;

export type EligibilityDecision = "eligible" | "suppressed" | "incorrect_number" | "unknown" | "invalid_phone" | "mismatch";
const DECISIONS: readonly EligibilityDecision[] = ["eligible", "suppressed", "incorrect_number", "unknown", "invalid_phone", "mismatch"];

export interface EligibilityResponse { decision: EligibilityDecision; contactId: string; phoneDigits: string | null; readAt: string }

/** Why the handoff was blocked; each has one fixed line of copy. */
export type BlockReason = "suppressed" | "incorrect_number" | "unknown" | "changed";

/** Operator copy, exactly as approved by Brad (2026-10-16). */
export const ELIGIBILITY_COPY = {
  checking: "Checking call status…",
  suppressed: "Calls are suppressed in GHL. Review the contact before calling.",
  incorrect_number: "This number is marked Incorrect Number.",
  unknown: "Could not verify call status. Refresh and try again.",
  changed: "The contact or number changed. Review it before calling.",
  refresh: "Refresh status",
  review: "Review contact",
} as const;

/**
 * An ISO-8601 instant: full date and time with seconds, optional fraction, and a timezone (`Z` or `±hh:mm`), naming a
 * real calendar date and time (Bones F2: no timezone, or 2026-02-30, is not an instant). Shape only; no age check.
 */
export function isIsoInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!m) return false;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  if (m[8] !== undefined && (Number(m[8]) > 23 || Number(m[9]) > 59)) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** The response, if and only if it has exactly the expected shape; otherwise null (treated as unknown). */
export function parseEligibilityResponse(status: number, body: unknown): EligibilityResponse | null {
  if (status !== 200 || !body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const keys = Object.keys(b).sort();
  if (keys.join(",") !== "contactId,decision,phoneDigits,readAt") return null;
  if (typeof b.decision !== "string" || !DECISIONS.includes(b.decision as EligibilityDecision)) return null;
  if (typeof b.contactId !== "string") return null;
  // readAt: shape only (an ISO-8601 instant). No age policy is applied.
  if (!isIsoInstant(b.readAt)) return null;
  if (b.phoneDigits !== null && (typeof b.phoneDigits !== "string" || !/^\d{10}$/.test(b.phoneDigits))) return null;
  if (b.decision === "eligible" && b.phoneDigits === null) return null;
  return { decision: b.decision as EligibilityDecision, contactId: b.contactId, phoneDigits: b.phoneDigits as string | null, readAt: b.readAt };
}

/** The verdict for one click: dial, or the reason it is blocked. */
export function handoffVerdict(response: EligibilityResponse | null, bound: { contactId: string; target: string }): { dial: true } | { dial: false; reason: BlockReason } {
  if (!response) return { dial: false, reason: "unknown" };
  if (response.contactId !== bound.contactId) return { dial: false, reason: "unknown" };
  switch (response.decision) {
    case "suppressed": return { dial: false, reason: "suppressed" };
    case "incorrect_number": return { dial: false, reason: "incorrect_number" };
    case "invalid_phone": return { dial: false, reason: "changed" };
    case "eligible": return response.phoneDigits === bound.target ? { dial: true } : { dial: false, reason: "changed" };
    default: return { dial: false, reason: "unknown" };
  }
}

/**
 * One fresh eligibility read. Never throws: any failure, abort or timeout is null (unknown).
 *
 * Once the caller aborts or the client timeout fires, the result is null even if the transport still delivers a
 * response afterwards (a transport that ignores the abort cannot make a late answer count).
 */
export async function readCallEligibility(contactId: string, signal: AbortSignal, timeoutMs = CLIENT_TIMEOUT_MS): Promise<EligibilityResponse | null> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  const onAbort = () => timeout.abort();
  if (signal.aborted) timeout.abort();
  signal.addEventListener("abort", onAbort);
  const stopped = new Promise<null>((resolve) => {
    if (timeout.signal.aborted) resolve(null);
    timeout.signal.addEventListener("abort", () => resolve(null));
  });
  const read = (async (): Promise<EligibilityResponse | null> => {
    const res = await readFetch(`${CALL_ELIGIBILITY_ENDPOINT}?contactId=${encodeURIComponent(contactId)}`, { signal: timeout.signal });
    let body: unknown = null;
    try { body = await res.json(); } catch { body = null; }
    return parseEligibilityResponse(res.status, body);
  })().catch(() => null);
  try {
    const result = await Promise.race([read, stopped]);
    return timeout.signal.aborted ? null : result;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

/**
 * The one in-flight state shared by both buttons. A request is current only while its sequence number is the
 * latest and its binding still matches; anything else is stale and is discarded without effect.
 */
export class EligibilityGate {
  private seq = 0;
  private inFlight: { seq: number; abort: AbortController; mode: "call" | "refresh" } | null = null;

  /** Start a check. A call while any check is in flight is ignored (null). A refresh supersedes an in-flight check. */
  begin(mode: "call" | "refresh"): { seq: number; signal: AbortSignal } | null {
    if (this.inFlight && mode === "call") return null;
    this.invalidate();
    const abort = new AbortController();
    this.seq += 1;
    this.inFlight = { seq: this.seq, abort, mode };
    return { seq: this.seq, signal: abort.signal };
  }

  /** True if `seq` is still the current request; it then stops being in flight. */
  finish(seq: number): boolean {
    if (!this.inFlight || this.inFlight.seq !== seq || this.seq !== seq) return false;
    this.inFlight = null;
    return true;
  }

  /** Make every earlier request stale (navigation, a contact or number change, unmount, or a refresh). */
  invalidate(): void {
    this.inFlight?.abort.abort();
    this.inFlight = null;
    this.seq += 1;
  }

  get checking(): boolean { return this.inFlight !== null; }
}
