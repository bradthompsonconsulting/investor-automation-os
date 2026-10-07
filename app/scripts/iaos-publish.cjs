#!/usr/bin/env node
/**
 * iaos-publish -- the CONTROLLED PUBLISHER (PR #131 amendments r1–r4,
 * Bones-approved r4 #issuecomment-6043033100). Operator side only; it runs on
 * Brad's machine and is the ONLY sanctioned route for routine publication and
 * rollback of iaos-app-test and iaos-app.
 *
 * RELEASE-GATED: running any command is a separately authorized release step.
 *
 * Bones review finding 3: a cycle must not depend on a private token surviving
 * across separate commands. Each command below is ONE process that holds a fresh
 * private publisher token p in memory for its whole run (never written to disk,
 * never logged) and carries the lifecycle as far as it safely can:
 *
 *   status
 *   init                                   T0 (record absent -> closed)
 *   cycle  --pub <pubId> --target <deployId> --activation <id> --approval <ref>
 *          --revocation <ref> --g5-digest <approved digest>
 *          T1 Close -> T2 Claim -> T3 Dispatching -> ONE restore -> T4/T5, and if
 *          APPLIED, the five attestations and T9 Activate -- all in this process.
 *   resume --activation <id> --approval <ref> --revocation <ref> --g5-digest <digest>
 *          after process loss: T7 Handover to THIS process (abandons a never-sent
 *          `claimed` attempt; keeps a `responded` one), then T8 Reclassify of the
 *          STORED response (needs approved semantics), then T9 Activate.
 *          It never dispatches: an attempt that is `dispatching` or `unresolved`
 *          stays blocking, and resume exits non-zero.
 *   next-attempt --pub <pubId> --target <deployId> --activation <id> --approval <ref>
 *          --revocation <ref> --g5-digest <digest>
 *          after the SAME publication's last attempt ended ABANDONED or REJECTED (nothing
 *          outstanding): T7 Handover bound to that publication, then ONE new attempt
 *          (T2 Claim ... T4/T5) with history retained, then T9 Activate if APPLIED.
 *
 * The single Netlify request is never retried, automatically or otherwise; no
 * response, a timeout (120 s) or an abort is recorded UNRESOLVED and blocks
 * every later cycle and activation (the stated fail-closed limitation).
 *
 * Environment: IAOS_SITE_URL (origin of the site), IAOS_WRITE_SESSION (Brad's app
 * write session bearer), IAOS_WRITE_ORIGIN (the configured write origin),
 * IAOS_READ_COOKIE (read session cookie, for status and attestations), and for
 * `cycle` only: NETLIFY_SITE_ID and NETLIFY_PUBLISHER_TOKEN (the dedicated
 * publisher identity -- never placed in Netlify env or any function).
 * IAOS_NETLIFY_API_BASE overrides https://api.netlify.com for offline tests only
 * (an http origin is accepted only on 127.0.0.1).
 *
 * Exit codes: 0 activated (or status/init ok); 2 stopped safely, needs a later
 * step (e.g. RESPONDED awaiting approved semantics; run `resume`); 3 blocked
 * (an unresolved or still-dispatching attempt); 1 refused or error.
 *
 * Accepted exception (Brad, #issuecomment-6042966089): a Netlify Owner can
 * publish outside this tool; after an out-of-tool A -> B -> A, A may resume
 * writes under its earlier activation. Any such out-of-tool publication is an
 * exceptional event: record it, assume saving may have resumed, and run this
 * tool's cycle (docs/STORAGE_V2_CUTOVER_RUNBOOK.md).
 */
'use strict';
const crypto = require('node:crypto');

const RESTORE_TIMEOUT_MS = 120_000;
const FUNCTIONS = ['call-log-barrier', 'current-offer-barrier', 'ghl-write', 'ghl-disposition', 'ghl-executed-artifact-upload'];

function apiBase(env) {
  const b = (env.IAOS_NETLIFY_API_BASE || 'https://api.netlify.com').replace(/\/$/, '');
  const u = new URL(b);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && u.hostname === '127.0.0.1')) throw new Error('IAOS_NETLIFY_API_BASE must be https (or http on 127.0.0.1 for tests)');
  return b;
}

/** One publisher process. `p` exists only in this object, for this process's lifetime. */
function createPublisher({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const p = crypto.randomBytes(32).toString('hex');
  const site = (env.IAOS_SITE_URL || '').replace(/\/$/, '');
  const fn = (name) => `${site}/.netlify/functions/${name}`;
  const writeHeaders = () => ({ 'content-type': 'application/json', authorization: `Bearer ${env.IAOS_WRITE_SESSION}`, origin: env.IAOS_WRITE_ORIGIN });
  async function call(action, extra = {}) {
    const res = await fetchImpl(fn('iaos-activation'), { method: 'POST', headers: writeHeaders(), body: JSON.stringify({ action, publisherToken: p, ...extra }) });
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
      const res = await fetchImpl(`${apiBase(env)}${path}`, { method: 'POST', headers: { authorization: `Bearer ${env.NETLIFY_PUBLISHER_TOKEN}` }, signal: ac.signal });
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
    return attemptOnce(steps);
  }
  /** ONE new attempt in the publication this process holds: T2 Claim -> T3 Dispatching -> ONE restore -> T4/T5. */
  async function attemptOnce(steps) {
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
  /** After an attempt: activate if APPLIED; otherwise say exactly what may happen next. */
  async function finish(args, pub) {
    if (!pub.ok) return { code: 1, publish: pub };
    if (pub.classification === 'UNRESOLVED') return { code: 3, publish: pub, next: 'blocked: the publication result is unknown (fail-closed limitation)' };
    if (pub.classification === 'REJECTED') return { code: 2, publish: pub, next: `the attempt was REJECTED; run \`next-attempt --pub ${args.pubId} --target ${args.target}\` for a new attempt in this publication` };
    if (pub.classification !== 'APPLIED') return { code: 2, publish: pub, next: 'run `resume` once an approved provider-semantics record classifies the stored response' };
    const act = await activateTarget(args);
    return { code: act.ok ? 0 : 2, publish: pub, activate: act, ...(act.ok ? {} : { next: 'run `resume` to retry activation' }) };
  }
  /** cycle: one process from Close to Activate. */
  async function cycle(args) {
    return finish(args, await publish({ pubId: args.pubId, target: args.target }));
  }
  /**
   * next-attempt (Bones re-review of 20d7a62, item 2): continues the SAME publication after its last
   * attempt ended terminally unsent (ABANDONED) or REJECTED. This process takes the named publication
   * over (T7, bound to that pubId and target inside the compare-and-swap) and claims ONE new attempt
   * (T2), with the publication's history retained; then exactly as `cycle`. It refuses while any attempt
   * is outstanding (a dispatching, unresolved or responded attempt is never reset or resent), after an
   * APPLIED attempt (run `resume`), and for any other publication.
   */
  async function nextAttempt(args) {
    const st = (await status()).body;
    const pub = st && st.publication;
    if (!pub) return { code: 1, stop: 'no_publication', status: st };
    if (pub.pubId !== args.pubId || pub.targetDeployId !== args.target) return { code: 1, stop: 'publication_mismatch', publication: { pubId: pub.pubId, targetDeployId: pub.targetDeployId } };
    const o = pub.outstanding;
    if (o) return { code: o.state === 'dispatching' || o.state === 'unresolved' ? 3 : 2, stop: 'attempt_outstanding', outstanding: o, next: 'an attempt is not terminal; run `resume`' };
    if (pub.phase !== 'closed') return { code: 2, stop: 'already_applied', next: 'run `resume` to activate' };
    const last = pub.history[pub.history.length - 1];
    if (!last || (last.terminal !== 'ABANDONED' && last.terminal !== 'REJECTED')) return { code: 1, stop: 'not_continuable', history: pub.history };
    const steps = [];
    const h = await call('handover', { pubId: args.pubId, targetDeployId: args.target });
    steps.push(['handover', h.status]);
    if (h.status !== 200) return { code: 1, stop: 'handover', steps, body: h.body };
    return finish(args, await attemptOnce(steps));
  }
  /** resume: a NEW process takes over safely and finishes what the stored records allow. Never dispatches. */
  async function resume(args) {
    const st = (await status()).body;
    const pub = st && st.publication;
    if (!pub) return { code: 1, stop: 'no_publication', status: st };
    const o = pub.outstanding;
    if (o && (o.state === 'dispatching' || o.state === 'unresolved')) return { code: 3, stop: 'blocked', outstanding: o, next: 'an attempt may have been sent and has no recorded response; nothing can take it over' };
    const h = await call('handover', { pubId: pub.pubId, targetDeployId: pub.targetDeployId });
    if (h.status !== 200) return { code: 1, stop: 'handover', body: h.body };
    const cont = `run \`next-attempt --pub ${pub.pubId} --target ${pub.targetDeployId}\` for a new attempt in this publication`;
    if (o && o.state === 'responded') {
      const r = await call('reclassify', { attemptId: o.attemptId });
      if (r.status !== 200) return { code: 2, stop: 'reclassify', body: r.body, next: 'the stored response is not classified by any approved semantics record' };
      if (r.body.classification !== 'APPLIED') return { code: 2, stop: 'rejected', classification: r.body.classification, next: `the attempt was REJECTED; ${cont}` };
    }
    if (o && o.state === 'claimed') return { code: 2, stop: 'abandoned', next: `the never-sent attempt was abandoned; ${cont}` };
    if (!o && pub.phase !== 'applied') return { code: 2, stop: 'no_applied_attempt', next: cont };
    const act = await activateTarget(args);
    return { code: act.ok ? 0 : 2, activate: act };
  }
  return {
    publisherHashForTests: () => crypto.createHash('sha256').update(Buffer.from(p, 'hex')).digest('hex'),
    status, cycle, resume, nextAttempt, init: () => call('init'),
  };
}

function arg(name) { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; }
async function main() {
  const cmd = process.argv[2];
  const pub = createPublisher();
  const common = { activationId: arg('activation'), approvalRef: arg('approval'), revocationRef: arg('revocation'), g5Digest: arg('g5-digest') };
  let out; let code = 0;
  if (cmd === 'status') { out = await pub.status(); code = out.status === 200 ? 0 : 1; }
  else if (cmd === 'init') { out = await pub.init(); code = out.status === 200 ? 0 : 1; }
  else if (cmd === 'cycle') { out = await pub.cycle({ pubId: arg('pub'), target: arg('target'), ...common }); code = out.code; }
  else if (cmd === 'resume') { out = await pub.resume(common); code = out.code; }
  else if (cmd === 'next-attempt') { out = await pub.nextAttempt({ pubId: arg('pub'), target: arg('target'), ...common }); code = out.code; }
  else { console.error('usage: iaos-publish status|init|cycle|resume|next-attempt'); process.exit(1); }
  console.log(JSON.stringify(out, null, 2));
  process.exitCode = code;
}
if (require.main === module) main().catch((e) => { console.error('iaos-publish failed:', e && e.message); process.exit(1); });
module.exports = { createPublisher, RESTORE_TIMEOUT_MS };
