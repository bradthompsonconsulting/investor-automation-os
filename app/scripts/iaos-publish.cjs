#!/usr/bin/env node
/**
 * iaos-publish -- the CONTROLLED PUBLISHER (PR #131 amendments r1–r4,
 * Bones-approved r4 #issuecomment-6043033100). Operator side only; it runs on
 * Brad's machine and is the ONLY sanctioned route for routine publication and
 * rollback of iaos-app-test and iaos-app.
 *
 * RELEASE-GATED: running any command is a separately authorized release step.
 *
 * It holds a fresh private publisher token p for THIS process only (never
 * written to disk, never logged). A restarted process has a new token and must
 * `handover` (which can abandon only a never-dispatched `claimed` attempt).
 *
 *   status
 *   init
 *   publish  --pub <pubId> --target <deployId>      T1 Close -> T2 Claim -> T3 Dispatching -> ONE restore -> T4/T5
 *   reclassify --attempt <attemptId>                 T8 (needs an approved provider-semantics record)
 *   abandon --attempt <attemptId>                    T6 (claimed only)
 *   handover                                         T7
 *   activate --activation <id> --approval <ref> --revocation <ref> --g5-digest <digest>
 *                                                    attestations from all five endpoints, then T9 on the target
 *
 * The single Netlify request is never retried, automatically or otherwise; no
 * response, a timeout (120 s) or an abort is recorded UNRESOLVED and blocks
 * every later cycle and activation (the stated fail-closed limitation).
 *
 * Environment: IAOS_SITE_URL (https origin of the site), IAOS_WRITE_SESSION
 * (Brad's app write session bearer), IAOS_WRITE_ORIGIN (the configured write
 * origin), IAOS_READ_COOKIE (read session cookie, for attestations), and for
 * `publish` only: NETLIFY_SITE_ID and NETLIFY_PUBLISHER_TOKEN (the dedicated
 * publisher identity -- never placed in Netlify env or any function).
 *
 * Accepted exception (Brad, #issuecomment-6042966089): a Netlify Owner can
 * publish outside this tool; after an out-of-tool A -> B -> A, A may resume
 * writes under its earlier activation. Any such out-of-tool publication is an
 * exceptional event: record it, assume saving may have resumed, and run this
 * tool's close -> publish -> activate cycle (docs/STORAGE_V2_CUTOVER_RUNBOOK.md).
 */
'use strict';
const crypto = require('node:crypto');

const RESTORE_TIMEOUT_MS = 120_000;
const FUNCTIONS = ['call-log-barrier', 'current-offer-barrier', 'ghl-write', 'ghl-disposition', 'ghl-executed-artifact-upload'];

function createPublisher({ env = process.env, fetchImpl = globalThis.fetch, log = console.log } = {}) {
  const p = crypto.randomBytes(32).toString('hex');   // this process only
  const site = (env.IAOS_SITE_URL || '').replace(/\/$/, '');
  const fn = (name) => `${site}/.netlify/functions/${name}`;
  const writeHeaders = () => ({ 'content-type': 'application/json', authorization: `Bearer ${env.IAOS_WRITE_SESSION}`, origin: env.IAOS_WRITE_ORIGIN });
  async function call(action, extra = {}, token = p) {
    const res = await fetchImpl(fn('iaos-activation'), { method: 'POST', headers: writeHeaders(), body: JSON.stringify({ action, publisherToken: token, ...extra }) });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  }
  async function status() {
    const res = await fetchImpl(fn('iaos-activation'), { method: 'GET', headers: { cookie: env.IAOS_READ_COOKIE || '' } });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }
  /** The ONE restore request of an attempt. Never retried. */
  async function sendRestore(path) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), RESTORE_TIMEOUT_MS);
    try {
      const res = await fetchImpl(`https://api.netlify.com${path}`, { method: 'POST', headers: { authorization: `Bearer ${env.NETLIFY_PUBLISHER_TOKEN}` }, signal: ac.signal });
      const body = await res.text();
      return { kind: 'response', response: { status: res.status, contentType: res.headers.get('content-type'), body } };
    } catch (e) {
      return { kind: 'none', reason: ac.signal.aborted ? 'timeout' : (e && e.name === 'AbortError' ? 'abort' : 'transport') };
    } finally { clearTimeout(t); }
  }
  async function publish({ pubId, target }) {
    const steps = [];
    const close = await call('close', { pubId, targetDeployId: target });
    steps.push(['close', close.status]);
    if (close.status !== 200) return { ok: false, steps, stop: 'close', body: close.body };
    const attemptId = `att-${crypto.randomBytes(8).toString('hex')}`;
    const claim = await call('claim', { attemptId });
    steps.push(['claim', claim.status]);
    if (claim.status !== 200) return { ok: false, steps, stop: 'claim', body: claim.body };
    const disp = await call('dispatching', { attemptId, siteId: env.NETLIFY_SITE_ID });
    steps.push(['dispatching', disp.status]);
    // Only an explicit 200 for OUR dispatching transition permits the one request. Anything else: send nothing.
    if (disp.status !== 200 || !disp.body.request || disp.body.request.method !== 'POST') return { ok: false, steps, stop: 'dispatching', attemptId, body: disp.body };
    const sent = await sendRestore(disp.body.request.path);
    steps.push(['restore', sent.kind === 'response' ? sent.response.status : sent.reason]);
    const rec = sent.kind === 'response' ? await call('record_response', { attemptId, response: sent.response }) : await call('mark_unresolved', { attemptId, reason: sent.reason });
    steps.push([sent.kind === 'response' ? 'record_response' : 'mark_unresolved', rec.status]);
    return { ok: rec.status === 200, steps, attemptId, classification: rec.body.classification || (sent.kind === 'none' ? 'UNRESOLVED' : null), body: rec.body };
  }
  async function attestations(nonce) {
    const out = [];
    for (const name of FUNCTIONS) {
      const res = await fetchImpl(fn(name), { method: 'POST', headers: { ...writeHeaders(), cookie: env.IAOS_READ_COOKIE || '' }, body: JSON.stringify({ action: 'storage_capability', nonce }) });
      const body = await res.json().catch(() => ({}));
      out.push({ fn: name, status: res.status, attestation: body.attestation || null });
    }
    return out;
  }
  async function activateTarget({ activationId, approvalRef, revocationRef, g5Digest }) {
    const st = await status();
    const pub = st.body && st.body.publication;
    if (!pub) return { ok: false, stop: 'no_publication', status: st.body };
    const nonce = `${pub.pubId}:${pub.attemptSetDigest}`;
    const atts = await attestations(nonce);
    const missing = atts.filter((a) => !a.attestation || !a.attestation.signature);
    if (missing.length) return { ok: false, stop: 'attestations', missing: missing.map((m) => m.fn) };
    const r = await call('activate', { activationId, attemptSetDigest: pub.attemptSetDigest, attestations: atts.map((a) => ({ attestation: a.attestation })), approvalRef, revocationRef, g5Digest });
    return { ok: r.status === 200, status: r.status, body: r.body };
  }
  return {
    publisherHashForTests: () => crypto.createHash('sha256').update(Buffer.from(p, 'hex')).digest('hex'),
    status, publish, activate: activateTarget,
    init: () => call('init'),
    reclassify: (attemptId) => call('reclassify', { attemptId }),
    abandon: (attemptId) => call('abandon', { attemptId }),
    handover: () => call('handover'),
  };
}

function arg(name) { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; }
async function main() {
  const cmd = process.argv[2];
  const pub = createPublisher();
  let out;
  if (cmd === 'status') out = await pub.status();
  else if (cmd === 'init') out = await pub.init();
  else if (cmd === 'publish') out = await pub.publish({ pubId: arg('pub'), target: arg('target') });
  else if (cmd === 'reclassify') out = await pub.reclassify(arg('attempt'));
  else if (cmd === 'abandon') out = await pub.abandon(arg('attempt'));
  else if (cmd === 'handover') out = await pub.handover();
  else if (cmd === 'activate') out = await pub.activate({ activationId: arg('activation'), approvalRef: arg('approval'), revocationRef: arg('revocation'), g5Digest: arg('g5-digest') });
  else { console.error('usage: iaos-publish status|init|publish|reclassify|abandon|handover|activate'); process.exit(2); }
  console.log(JSON.stringify(out, null, 2));
}
if (require.main === module) main().catch((e) => { console.error('iaos-publish failed:', e && e.message); process.exit(1); });
module.exports = { createPublisher, RESTORE_TIMEOUT_MS };
