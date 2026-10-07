/**
 * Storage correction (plan v6 §8.1 M2) -- the ONE GHL credential accessor.
 * Every new-build GHL path, reads included, reads `IAOS_GHL_TOKEN_V2` through
 * this function. There is NO fallback to any legacy name: pre-v2 code built
 * later finds no credential, and v2 never reads a legacy one.
 */
export const GHL_TOKEN_ENV = "IAOS_GHL_TOKEN_V2";
export function ghlToken(env: Record<string, string | undefined> = process.env): string {
  const v = env[GHL_TOKEN_ENV];
  return typeof v === "string" ? v.trim() : "";
}
