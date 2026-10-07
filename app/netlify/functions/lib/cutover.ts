/**
 * Storage correction (plan v6 §8–§9) -- the cutover records live code reads.
 *
 *   authz/import/owner      {v:1, runId, ownerHash, startedAt, state:"running"|"complete", manifestDigest?}
 *                           created onlyIfNew ONCE per store; any other runId is refused forever.
 *   authz/cutover/v2        {v:1, importComplete:true, ownerRunId, manifestDigest, T_r, drainUntil, createdAt}
 *                           created only after the owner's verified completion.
 *   authz/legacy-block/<s>  {v:1, subject, class:"blocked_unknown"|"quarantined", reasons[], evidenceDigest}
 *
 * Live paths read ONLY `authz/`. Nothing here ever reads `evidence/` (static test O4).
 * Revocation, session expiry, elapsed time, a missing record or a missing log
 * never clear a block.
 */
import { digest } from "./hash";
import { VerifiedStore } from "./verified-store";

export const CUTOVER_KEY = "authz/cutover/v2";
export const IMPORT_OWNER_KEY = "authz/import/owner";
export const IMPORT_LOCK_KEY = "authz/import/lock";
export const LEGACY_BLOCK_PREFIX = "authz/legacy-block/";
export const legacyBlockKey = (env: string, locationId: string, subject: string) => LEGACY_BLOCK_PREFIX + digest(`${env}:${locationId}:${subject}`);

export type ImportOwner = { v: 1; runId: string; ownerHash: string; startedAt: string; state: "running" | "complete"; manifestDigest?: string };
export type CutoverRecord = { v: 1; importComplete: true; ownerRunId: string; manifestDigest: string; T_r: string; drainUntil: string; createdAt: string };
export type LegacyBlock = { v: 1; subject: string; class: "blocked_unknown" | "quarantined"; reasons: string[]; evidenceDigest: string };

/**
 * The cutover is valid only when the record exists, the owner is complete, and
 * both bind the same runId and manifest digest. Anything else: writes refused.
 */
export async function cutoverValid(store: VerifiedStore): Promise<CutoverRecord | null> {
  const [c, o] = await Promise.all([store.readData<CutoverRecord>(CUTOVER_KEY, "cutover_gate"), store.readData<ImportOwner>(IMPORT_OWNER_KEY, "cutover_gate")]);
  if (!c || !o || c.v !== 1 || c.importComplete !== true || o.state !== "complete") return null;
  if (c.ownerRunId !== o.runId || !c.manifestDigest || c.manifestDigest !== o.manifestDigest) return null;
  return c;
}

/**
 * v2 request ids (plan v6 §9.3). The v2 client and server mint ONLY `v2-`
 * prefixed request, operation and attempt ids; every other id is refused before
 * any I/O, so every legacy receipt keeps its meaning whether or not its copy was
 * found.
 */
export const V2_ID = /^v2-[A-Za-z0-9_-]{5,61}$/;
export const isV2Id = (v: unknown): v is string => typeof v === "string" && V2_ID.test(v);
