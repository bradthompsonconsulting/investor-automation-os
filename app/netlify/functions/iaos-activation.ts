/**
 * Storage correction -- publication control and activation (PR #131
 * amendments r1–r4, Bones-approved r4 #issuecomment-6043033100).
 *
 * Every transition is ONE compare-and-swap on `authz/admission` (lib/admission.ts).
 * The operator-side `iaos-publish` tool drives them with its private publisher
 * token p (never stored; only H(p) and per-transition marks are recorded) and
 * performs the single Netlify restore request ITSELF with the publisher
 * identity's credential. This function holds no Netlify credential and makes no
 * Netlify or GHL call (static test).
 *
 *   GET  (read session)                               admission summary
 *   POST {action:"init", publisherToken}              T0 (record absent -> closed)
 *   POST {action:"close", publisherToken, pubId, targetDeployId}             T1
 *   POST {action:"claim", publisherToken, attemptId}                          T2
 *   POST {action:"dispatching", publisherToken, attemptId, siteId}            T3
 *   POST {action:"record_response", publisherToken, attemptId, response}      T4
 *   POST {action:"mark_unresolved", publisherToken, attemptId, reason}        T5
 *   POST {action:"abandon", publisherToken, attemptId}                        T6
 *   POST {action:"handover", publisherToken}                                  T7 (the NEW token)
 *   POST {action:"reclassify", publisherToken, attemptId}                     T8
 *   POST {action:"activate", publisherToken, activationId, attemptSetDigest, attestations, approvalRef, revocationRef}
 *                                                                             T9, on the TARGET deployment
 *
 * Accepted exception (Brad, #issuecomment-6042966089): only publications
 * through `iaos-publish` reliably invalidate activation. An out-of-tool
 * publication by a Netlify Owner is NOT detected; after an out-of-tool
 * A -> B -> A, A may resume writes under its earlier activation without fresh
 * verification. Routine publishing and rollback must use the controlled tool.
 */
import { requireAppWriter } from "./lib/app-write-auth";
import { requireAppWriteOrigin } from "./lib/app-write-origin";
import { readAuthRefusal } from "./lib/app-read-auth";
import { legacyEventFrom, toResponse, json, type LambdaResult, type LegacyEvent } from "./lib/modern-runtime";
import { invocation, type Invocation } from "./lib/endpoint-kit";
import { requireWritableDeployment, WriteRefused } from "./lib/write-gate";
import {
  readAdmission, admissionSummary, initAdmission, closeAdmission, claimAttempt, markAttemptDispatching, recordResponse, markAttemptUnresolved,
  abandonAttempt, handoverPublisher, reclassifyAttempt, activate, archive, PublicationRefused, TransitionUnresolved, ACTIVATION_ARCHIVE_PREFIX, PUBLICATION_ARCHIVE_PREFIX,
} from "./lib/admission";
import { verifyAttestation, ATTEST_SECRET_ENV, type Attestation } from "./lib/capability";
import { cutoverValid } from "./lib/cutover";
import { readG5Table, tableDigest } from "./lib/g5-gate";
import { clock } from "./lib/invocation-scope";

/** The five endpoints whose attestations activation requires. */
export const ATTESTED_FUNCTIONS = ["call-log-barrier", "current-offer-barrier", "ghl-write", "ghl-disposition", "ghl-executed-artifact-upload"] as const;

export default async (req: Request, context: any): Promise<Response> => {
  const event = await legacyEventFrom(req, { requireJson: true, maxBytes: 200_000 });
  const inv = invocation("iaos-activation", context);
  try { return toResponse(await handle(event, inv)); } finally { inv.scope.close(); }
};

const refusal = (e: unknown): LambdaResult | null => {
  if (e instanceof PublicationRefused) return json(409, { refused: e.code, error: e.message });
  if (e instanceof TransitionUnresolved) return json(503, { unresolved: e.transition, error: "The transition could not be confirmed; it is treated as NOT done. Read status before anything else." });
  if (e instanceof WriteRefused) return json(e.refusal.status, e.refusal.body);
  return null;
};

async function handle(event: LegacyEvent, inv: Invocation): Promise<LambdaResult> {
  if (event.httpMethod === "GET") {
    const refused = readAuthRefusal(event);
    if (refused) return refused as LambdaResult;
    if (Object.keys(event.queryStringParameters ?? {}).length) return json(400, { error: "Unexpected query" });
    try { const r = await readAdmission(inv.store); return json(200, { ...admissionSummary(r ? r.data : null), runtimeDeployId: inv.deploy.id }); }
    catch { return json(503, { error: "The admission record could not be read" }); }
  }
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  try { requireAppWriter(event); } catch { return json(401, { error: "Application write sign-in required" }); }
  try { requireAppWriteOrigin(event); } catch { return json(403, { error: "Application write origin refused" }); }
  let b: any;
  try {
    if (event.isBase64Encoded || Object.keys(event.queryStringParameters ?? {}).length) throw new Error("encoding");
    b = JSON.parse(event.body ?? "null");
    if (!b || typeof b !== "object" || Array.isArray(b) || typeof b.action !== "string") throw new Error("shape");
  } catch { return json(400, { error: "Invalid activation request" }); }
  const s = inv.store;
  const p = b.publisherToken;
  try {
    switch (b.action) {
      case "init": return json(200, { init: await initAdmission(s, p) });
      case "close": {
        const pub = await closeAdmission(s, p, b.pubId, b.targetDeployId);
        return json(200, { closed: true, pubId: pub.pubId, targetDeployId: pub.targetDeployId, attemptSetDigest: pub.attemptSetDigest });
      }
      case "claim": { const o = await claimAttempt(s, p, b.attemptId); return json(200, { claimed: true, attemptId: o.attemptId }); }
      case "dispatching": {
        const o = await markAttemptDispatching(s, p, b.attemptId, b.siteId);
        // The ONE request the tool may now send, exactly once, never retried.
        return json(200, { dispatching: true, request: { method: o.request!.method, path: o.request!.path } });
      }
      case "record_response": {
        const c = await recordResponse(s, p, b.attemptId, b.response);
        await archiveCycle(inv);
        return json(200, { classification: c.cls });
      }
      case "mark_unresolved": await markAttemptUnresolved(s, p, b.attemptId, b.reason); await archiveCycle(inv); return json(200, { unresolved: true });
      case "abandon": await abandonAttempt(s, p, b.attemptId); await archiveCycle(inv); return json(200, { abandoned: true });
      case "handover": await handoverPublisher(s, p); return json(200, { handover: true });
      case "reclassify": { const c = await reclassifyAttempt(s, p, b.attemptId); await archiveCycle(inv); return json(200, { classification: c.cls }); }
      case "activate": return await activateHere(inv, b);
      default: return json(400, { error: "Unknown action" });
    }
  } catch (e) {
    const r = refusal(e);
    if (r) return r;
    return json(503, { error: "The admission record could not be changed; nothing was changed" });
  }
}

/** I4: a copy of the cycle AFTER the authoritative write. Never read for authorization; failure is harmless. */
async function archiveCycle(inv: Invocation): Promise<void> {
  try {
    const r = await readAdmission(inv.store);
    const pub = r?.data.publication;
    if (pub) await archive(inv.store, `${PUBLICATION_ARCHIVE_PREFIX}${pub.pubId}/${pub.attemptSetDigest}`, pub);
  } catch { /* harmless */ }
}

/**
 * T9 on the TARGET deployment. The caller's prerequisites are verified HERE:
 * runtime deploy context (production, published, id === target), the five
 * signed `verified` attestations from THIS deployment issued after the cycle
 * closed and bound to (pubId, attemptSetDigest), the cutover record bound to
 * the import owner, the drain precaution, the G5 table digest, and the
 * approval and revocation references. Then ONE compare-and-swap.
 */
async function activateHere(inv: Invocation, b: any): Promise<LambdaResult> {
  requireWritableDeployment(inv.deploy);
  const r = await readAdmission(inv.store);
  const pub = r?.data.publication;
  if (!pub) return json(409, { refused: "no_publication" });
  if (typeof b.approvalRef !== "string" || b.approvalRef.length < 8 || typeof b.revocationRef !== "string" || b.revocationRef.length < 8) return json(400, { error: "Approval and revocation references are required" });
  const secret = (process.env[ATTEST_SECRET_ENV] ?? "").trim();
  if (secret.length < 32) return json(409, { refused: "attestation_secret_missing" });
  const atts: { attestation: Attestation & { signature: string } }[] = Array.isArray(b.attestations) ? b.attestations : [];
  const nonce = `${pub.pubId}:${pub.attemptSetDigest}`;
  for (const fn of ATTESTED_FUNCTIONS) {
    const a = atts.find((x) => x?.attestation?.fn === fn)?.attestation;
    if (!a) return json(409, { refused: "attestation_missing", fn });
    const { signature, ...body } = a as any;
    if (!verifyAttestation(body, signature, secret)) return json(409, { refused: "attestation_invalid", fn });
    if (body.storage !== "verified" || body.deployId !== inv.deploy.id || body.deployContext !== "production" || body.published !== true) return json(409, { refused: "attestation_not_this_deployment", fn });
    if (Date.parse(body.issuedAt) <= Date.parse(pub.closedAt) || body.nonce !== nonce) return json(409, { refused: "attestation_stale", fn });
  }
  const [cutover, g5] = await Promise.all([cutoverValid(inv.store), readG5Table(inv.store)]);
  if (!cutover) return json(409, { refused: "cutover_pending" });
  if (clock.now() < Date.parse(cutover.drainUntil)) return json(409, { refused: "drain_pending" });
  if (!g5) return json(409, { refused: "g5_table_missing" });
  const g5Digest = tableDigest(g5.table);
  if (b.g5Digest !== g5Digest) return json(409, { refused: "g5_digest_not_approved", g5Digest });
  const next = await activate(inv.store, inv.scope, { p: b.publisherToken, runtimeDeployId: inv.deploy.id!, attemptSetDigest: b.attemptSetDigest, g5Digest, activationId: b.activationId });
  // I4: the activation record is an archive written AFTER the authoritative write.
  await archive(inv.store, `${ACTIVATION_ARCHIVE_PREFIX}${inv.deploy.id}/${next.activationId}`, { deployId: inv.deploy.id, activationId: next.activationId, epoch: next.epoch, pubId: pub.pubId, attemptSetDigest: pub.attemptSetDigest, history: pub.history, g5Digest, cutoverManifest: cutover.manifestDigest, ownerRunId: cutover.ownerRunId, approvalRef: b.approvalRef, revocationRef: b.revocationRef, attestations: atts.map((x) => x.attestation), at: new Date().toISOString() });
  return json(200, { activated: true, activationId: next.activationId, epoch: next.epoch, deployId: next.deployId });
}
