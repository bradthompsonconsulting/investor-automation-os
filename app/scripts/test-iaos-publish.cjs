/**
 * Storage correction -- the controlled publisher end to end (amendments r1–r4):
 * scripts/iaos-publish.cjs driving the REAL iaos-activation function and the five
 * endpoints' storage_capability over the wire harness, with a FAKE operator-side
 * Netlify API. Offline. Nothing here touches Netlify or GHL.
 */
'use strict';
process.env.NODE_ENV = 'test';
const assert = require('node:assert/strict');
const { setupV2Env, DEPLOY_ID } = require('./harness/v2-env.cjs');
const { check, done } = require('./harness/check.cjs');
const env = setupV2Env();
const ad = require('../netlify/functions/lib/admission.ts');
const { createPublisher } = require('./iaos-publish.cjs');
const S = env.S;
const SITE_ID = '00000000-0000-0000-0000-0000000000aa';
const TARGET = DEPLOY_ID;
const FNS = ['iaos-activation', 'call-log-barrier', 'current-offer-barrier', 'ghl-write', 'ghl-disposition', 'ghl-executed-artifact-upload'];
const MODS = Object.fromEntries(FNS.map((f) => [f, require(`../netlify/functions/${f}.ts`)]));
const SEMANTICS = {
  v: 1, ref: 'fixture-semantics-1', endpoint: 'restoreSiteDeploy', createdAt: 'x', approvals: { bones: 'fixture-approval-bones', jess: 'fixture-approval-jess' },
  predicates: [{ id: 'applied-201', classifies: 'APPLIED', status: 201, body: [{ field: 'id', op: 'equals_target' }, { field: 'published_at', op: 'present' }], citation: 'fixture citation only' }],
};
let netlify; // the fake API's behaviour for the ONE restore request
const restoreCalls = [];
/** The site: routes /.netlify/functions/<fn> to the real modules (serving TARGET); api.netlify.com to the fake. */
async function siteFetch(url, init = {}) {
  const u = new URL(url);
  if (u.origin === 'https://api.netlify.com') {
    restoreCalls.push({ method: init.method, path: u.pathname });
    return netlify(u, init);
  }
  const fn = u.pathname.replace('/.netlify/functions/', '');
  const res = await MODS[fn].default(new Request(url, init), env.deployContext({ id: TARGET }));
  return res;
}
const toolEnv = () => ({
  IAOS_SITE_URL: 'https://iaos-app-test.netlify.app', IAOS_WRITE_SESSION: env.writeHeaders().authorization.slice(7),
  IAOS_WRITE_ORIGIN: process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN, IAOS_READ_COOKIE: env.readCookie(), NETLIFY_SITE_ID: SITE_ID, NETLIFY_PUBLISHER_TOKEN: 'fake-publisher-token',
});
const rec = () => env.admission();
function fresh(open = true) {
  env.reset(); restoreCalls.length = 0;
  if (!open) { env.wire.remove(S, 'authz/admission'); }
}

(async () => {
  await check('PUB-T1 a full controlled cycle: close -> claim -> dispatching -> ONE restore (201) -> APPLIED (approved semantics) -> five verified attestations -> activate on the target', async () => {
    fresh();
    env.wire.seed(S, 'authz/provider-semantics/1', SEMANTICS);
    netlify = async () => new Response(JSON.stringify({ id: TARGET, site_id: SITE_ID, published_at: '2026-10-07T03:00:00Z' }), { status: 201, headers: { 'content-type': 'application/json' } });
    const tool = createPublisher({ env: toolEnv(), fetchImpl: siteFetch, log: () => {} });
    const pub = await tool.publish({ pubId: 'pub-tool-0001', target: TARGET });
    assert.equal(pub.ok, true, JSON.stringify(pub));
    assert.equal(pub.classification, 'APPLIED');
    assert.equal(restoreCalls.length, 1, 'exactly one restore request');
    assert.equal(restoreCalls[0].path, `/api/v1/sites/${SITE_ID}/deploys/${TARGET}/restore`);
    const g5Digest = env.g5.tableDigest(env.wire.json(S, 'authz/g5/table'));
    const act = await tool.activate({ activationId: 'v2-act-tool-0001', approvalRef: 'approval-ref-0001', revocationRef: 'revocation-ref-0001', g5Digest });
    assert.equal(act.ok, true, JSON.stringify(act));
    assert.equal(rec().state, 'open'); assert.equal(rec().activationId, 'v2-act-tool-0001'); assert.equal(rec().deployId, TARGET);
    assert.ok(env.wire.keys(S).some((k) => k.startsWith(`evidence/activation/${TARGET}/`)), 'activation archived after the authoritative write');
  });
  await check('PUB-T2 without an approved semantics record the 201 is RESPONDED: activation refused, saving stays paused (P5 is a release prerequisite)', async () => {
    fresh();
    netlify = async () => new Response(JSON.stringify({ id: TARGET, published_at: 'x' }), { status: 201 });
    const tool = createPublisher({ env: toolEnv(), fetchImpl: siteFetch });
    const pub = await tool.publish({ pubId: 'pub-tool-0002', target: TARGET });
    assert.equal(pub.classification, 'RESPONDED');
    const act = await tool.activate({ activationId: 'v2-act-tool-0002', approvalRef: 'approval-ref-0001', revocationRef: 'revocation-ref-0001', g5Digest: env.g5.tableDigest(env.wire.json(S, 'authz/g5/table')) });
    assert.equal(act.ok, false);
    assert.equal(rec().state, 'closed');
  });
  await check('PUB-T3 PA-8 / PUB-8: a publish timeout or transport error is UNRESOLVED; never retried; the next cycle, claim and activation are refused', async () => {
    fresh();
    netlify = async () => { throw new TypeError('network down'); };
    const tool = createPublisher({ env: toolEnv(), fetchImpl: siteFetch });
    const pub = await tool.publish({ pubId: 'pub-tool-0003', target: TARGET });
    assert.equal(pub.classification, 'UNRESOLVED');
    assert.equal(restoreCalls.length, 1, 'no retry');
    assert.equal(rec().publication.outstanding.state, 'unresolved');
    const again = await tool.publish({ pubId: 'pub-tool-0004', target: TARGET });
    assert.equal(again.ok, false); assert.equal(restoreCalls.length, 1, 'still exactly one request ever');
  });
  await check('PUB-T4 PA-6: a restarted tool (new token) cannot claim; handover abandons only a claimed attempt; a dispatched one keeps blocking', async () => {
    fresh();
    netlify = async () => { throw new TypeError('down'); };
    const first = createPublisher({ env: toolEnv(), fetchImpl: siteFetch });
    await first.publish({ pubId: 'pub-tool-0005', target: TARGET });
    const second = createPublisher({ env: toolEnv(), fetchImpl: siteFetch });
    const h = await second.handover();
    assert.equal(h.status, 409); assert.equal(h.body.refused, 'attempt_outstanding');
  });
  await check('PUB-T5 a stale attestation (issued before the cycle closed, or for another deploy) is refused', async () => {
    fresh();
    env.wire.seed(S, 'authz/provider-semantics/1', SEMANTICS);
    netlify = async () => new Response(JSON.stringify({ id: TARGET, published_at: 'x' }), { status: 201 });
    const tool = createPublisher({ env: toolEnv(), fetchImpl: siteFetch });
    await tool.publish({ pubId: 'pub-tool-0006', target: TARGET });
    const st = (await tool.status()).body;
    const capRes = await siteFetch('https://iaos-app-test.netlify.app/.netlify/functions/ghl-write', { method: 'POST', headers: { 'content-type': 'application/json', authorization: env.writeHeaders().authorization, origin: process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN, cookie: env.readCookie() }, body: JSON.stringify({ action: 'storage_capability', nonce: 'wrong:nonce' }) });
    const att = (await capRes.json()).attestation;
    const r = await siteFetch('https://iaos-app-test.netlify.app/.netlify/functions/iaos-activation', { method: 'POST', headers: { 'content-type': 'application/json', authorization: env.writeHeaders().authorization, origin: process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN }, body: JSON.stringify({ action: 'activate', publisherToken: 'f'.repeat(64), activationId: 'v2-act-x', attemptSetDigest: st.publication.attemptSetDigest, attestations: ['call-log-barrier', 'current-offer-barrier', 'ghl-write', 'ghl-disposition', 'ghl-executed-artifact-upload'].map((fn) => ({ attestation: { ...att, fn } })), approvalRef: 'approval-ref-0001', revocationRef: 'revocation-ref-0001', g5Digest: env.g5.tableDigest(env.wire.json(S, 'authz/g5/table')) }) });
    assert.equal(r.status, 409);
    assert.equal(rec().state, 'closed');
  });
  await check('PUB-T6 iaos-activation status is read-only and needs a read session; transitions need Brad\'s write session and origin', async () => {
    fresh();
    const un = await siteFetch('https://iaos-app-test.netlify.app/.netlify/functions/iaos-activation', { method: 'GET' });
    assert.equal(un.status, 401);
    const noAuth = await siteFetch('https://iaos-app-test.netlify.app/.netlify/functions/iaos-activation', { method: 'POST', headers: { 'content-type': 'application/json', origin: process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN }, body: JSON.stringify({ action: 'close' }) });
    assert.equal(noAuth.status, 401);
  });
  done('iaos-publish');
})();
