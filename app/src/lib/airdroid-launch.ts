import { airdroidCallDigits, airdroidCallLink } from "./airdroid-prepare-call";

/**
 * B14-13 — Seller Call's AirDroid launch interface. It replaces the
 * provisional stand-in (airdroid-launch-stand-in.ts, deleted at integration)
 * with the same interface, backed by Jeff's link builder.
 *
 * One call opens `iaos-airdroid:call?number=NNNNNNNNNN` exactly once, by
 * ordinary navigation. Brad's PC hands the link to the IAOS AirDroid helper
 * (tools/airdroid-prepare-call), which dials through AirDroid. No popup, no
 * fetch, no write to GHL or IAOS.
 *
 * `{ ok: true }` means only "handed off": the browser receives nothing back
 * from the helper, AirDroid or the phone, so no result here ever claims a
 * call was placed, dialled or connected.
 */

/** A launch outcome the browser actually knows. Success means only "handed off", never "calling". */
export type AirdroidLaunchResult = { ok: true } | { ok: false; error: string };

/** The seller number AirDroid can be asked to call (10-digit US, area code and exchange 2-9), or null. */
export function airdroidCallTarget(rawPhone: unknown): string | null {
  return airdroidCallDigits(rawPhone);
}

export function launchAirdroidCall(
  target: string,
  open: (link: string) => void = (link) => window.location.assign(link),
): AirdroidLaunchResult {
  const link = airdroidCallLink(target);
  if (!link) return { ok: false, error: "This number can't be called with AirDroid." };
  open(link);
  return { ok: true };
}
