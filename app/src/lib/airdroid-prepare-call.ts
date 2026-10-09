import { normalizeVoicePhone } from "../../shared/voice-call-contract";

/**
 * B14-13 — AirDroid is the primary calling path; GHL Phone is the backup.
 *
 * Launch interface (accepted starting interface): Seller Call's Call button
 * opens `iaos-airdroid:call?number=NNNNNNNNNN`. Brad's PC hands that link to
 * the IAOS AirDroid helper (tools/airdroid-prepare-call), which works with
 * AirDroid's already-open Dialpad.
 *
 * NAVIGATION ONLY. Building or opening the link writes nothing to GHL or
 * IAOS. The browser receives no result from the helper, so the page must not
 * show that a number was prepared, a call was dialled, or a call connected.
 * The script and notes stay available, and outcome saves are unchanged and
 * independent of the call.
 *
 * Only 10-digit US numbers whose area code and exchange start with 2-9 are
 * accepted, matching the helper's own check. Anything else returns null and
 * the caller must not offer the link.
 */
export const AIRDROID_LINK_SCHEME = "iaos-airdroid";

export function airdroidCallDigits(rawPhone: unknown): string | null {
  const e164 = normalizeVoicePhone(rawPhone);
  if (!e164) return null;
  const digits = e164.slice(2);
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
  return digits;
}

export function airdroidCallLink(rawPhone: unknown): string | null {
  const digits = airdroidCallDigits(rawPhone);
  return digits ? `${AIRDROID_LINK_SCHEME}:call?number=${digits}` : null;
}
