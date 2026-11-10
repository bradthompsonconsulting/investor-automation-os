/**
 * SECURITY -- B15-29 r6 (INV-137): the AUTHORIZATION seam, deliberately separate from session validity.
 *
 * A valid session (signature, 30-day lifetime, store check in lib/session-revocation.ts) says WHO is signed in and
 * that the sign-in has not been revoked. It never says what that person may do. `authorize` answers that, and it is
 * evaluated on EVERY protected request while one IAOS sign-in is on -- by every reader (sessionReadRefusal), every
 * writer (sessionWriteRefusal) and the saving-token mint (app-write-token) -- in ADDITION to, never instead of, the
 * session check. A future account state (disabled, cancelled, unpaid) belongs here, so such an account can be refused
 * on its next request even while its 30-day session is still valid. Session expiry is never used as subscription or
 * account validation.
 *
 * Today it delegates EXACTLY to the existing allowlists, with no new store, no billing and no network:
 *   read   -> IAOS_APP_READ_BRAD_EMAILS   (appReadConfig)
 *   write  -> IAOS_APP_WRITE_BRAD_EMAILS  (appAuthConfig)
 * Missing configuration is "unconfigured" (callers answer as they already do for missing configuration).
 */
import { appReadConfig } from "./app-read-auth";
import { appAuthConfig } from "./app-write-auth";

export type Permission = "read" | "write";
export type Identity = { sub: string; email: string };
export type Authorization = { ok: true } | { ok: false; reason: "not_authorized" | "unconfigured" | "invalid_identity" };

export function authorize(identity: Identity, permission: Permission, env: NodeJS.ProcessEnv = process.env): Authorization {
  if (!identity || typeof identity.email !== "string" || !identity.email || identity.sub !== identity.email) return { ok: false, reason: "invalid_identity" };
  if (permission !== "read" && permission !== "write") return { ok: false, reason: "not_authorized" };
  let emails: string[];
  try { emails = permission === "read" ? appReadConfig(env).emails : appAuthConfig(env).emails; }
  catch { return { ok: false, reason: "unconfigured" }; }
  return emails.includes(identity.email) ? { ok: true } : { ok: false, reason: "not_authorized" };
}
