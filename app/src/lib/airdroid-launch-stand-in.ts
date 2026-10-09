import { normalizeVoicePhone } from "../../shared/voice-call-contract";

/**
 * B14-13 — TEMPORARY, PROVISIONAL stand-in for Jeff's AirDroid connection.
 *
 * The number-only launch interface is provisional after Bones's v2 review, so
 * Seller Call is built against this until Jeff's revised connection is agreed
 * through Brad. Then SellerCallVoiceControls uses Jeff's module instead and
 * this file is deleted. It is never a second source of truth.
 *
 * LAUNCHES ARE MOCKED. `launchAirdroidCall` never opens a link, window or
 * request and never reaches a helper, AirDroid or a phone: it reports the one
 * thing that is known, that AirDroid calling is not connected in this build.
 * The browser cannot see a call, so no result here ever claims one.
 */

/** A launch outcome the browser actually knows. Success means only "handed off", never "calling". */
export type AirdroidLaunchResult = { ok: true } | { ok: false; error: string };

/** The seller number AirDroid can be asked to call (10-digit US, area code and exchange 2-9), or null. */
export function airdroidCallTarget(rawPhone: unknown): string | null {
  const e164 = normalizeVoicePhone(rawPhone);
  if (!e164) return null;
  const digits = e164.slice(2);
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(digits) ? digits : null;
}

export function launchAirdroidCall(_target: string): AirdroidLaunchResult {
  return { ok: false, error: "AirDroid calling isn't connected yet." };
}
