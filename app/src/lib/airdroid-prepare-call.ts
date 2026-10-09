import { normalizeVoicePhone } from "../../shared/voice-call-contract";

/**
 * B14-13 — AirDroid is the primary calling path; GHL Phone is the backup.
 *
 * IAOS cannot reach AirDroid from the browser. It opens a local launch link,
 * `iaos-airdroid:prepare?number=NNNNNNNNNN`, which Brad's PC hands to the
 * IAOS AirDroid helper (tools/airdroid-prepare-call). The helper puts the
 * number in AirDroid's already-open Dialpad and verifies it. It never dials:
 * Brad checks the number and presses Make Call himself.
 *
 * NAVIGATION ONLY. Building or opening the link writes nothing to GHL or
 * IAOS, and opening it is never evidence that a number was prepared or a call
 * was placed: the browser cannot see whether the helper is installed or what
 * it did.
 *
 * Only 10-digit US numbers whose area code and exchange start with 2-9 are
 * accepted, matching the helper's own check. Anything else returns null and
 * the caller must not offer the link.
 */
export const AIRDROID_LINK_SCHEME = "iaos-airdroid";

export function airdroidPrepareDigits(rawPhone: unknown): string | null {
  const e164 = normalizeVoicePhone(rawPhone);
  if (!e164) return null;
  const digits = e164.slice(2);
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
  return digits;
}

export function airdroidPrepareLink(rawPhone: unknown): string | null {
  const digits = airdroidPrepareDigits(rawPhone);
  return digits ? `${AIRDROID_LINK_SCHEME}:prepare?number=${digits}` : null;
}
