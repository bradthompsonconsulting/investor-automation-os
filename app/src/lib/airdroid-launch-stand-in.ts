import { normalizeVoicePhone } from "../../shared/voice-call-contract";

/**
 * B14-13 — TEMPORARY STAND-IN for Jeff's launch builder
 * (app/src/lib/airdroid-prepare-call.ts, owned by Jeff, not on this branch).
 *
 * Scotty's Seller Call UI is built against this until the final interface is
 * agreed through Brad. It implements PROPOSED launch contract v1 exactly:
 * `iaos-airdroid:call?number=NNNNNNNNNN`, 10-digit US numbers whose area code
 * and exchange start with 2-9, and null for anything else. Pure: no I/O, no
 * writes. At integration, SellerCallVoiceControls imports Jeff's builder
 * instead and this file is deleted. It is never a second source of truth.
 */
export function airdroidCallLink(rawPhone: unknown): string | null {
  const e164 = normalizeVoicePhone(rawPhone);
  if (!e164) return null;
  const digits = e164.slice(2);
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(digits) ? `iaos-airdroid:call?number=${digits}` : null;
}
