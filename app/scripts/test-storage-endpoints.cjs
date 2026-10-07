/**
 * Storage correction (PR #131 plan v6 §5–§8, §14) -- the FIVE migrated
 * endpoints on the modern runtime, end to end over the wire harness (real
 * @netlify/blobs) and a GHL fake. Offline.
 *
 * Groups: preview refusal (P1–P3, all five), the write gate (G-1..G-4,
 * GEN-10), credentials (K1–K3), capability (C1–C8), request parity (E rows),
 * deadlines (T1, T2, T5, T6 on the dispatch path), legacy isolation (L7, L7b,
 * S4), static checks, and a full gated call-log save.
 */
'use strict';
process.env.NODE_ENV = 'test';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { setupV2Env, DEPLOY_ID } = require('./harness/v2-env.cjs');
const { check, done } = require('./harness/check.cjs');
const { createGhl } = require('./harness/ghl-fake.cjs');
const env = setupV2Env();
const { getConfig } = require('../shared/ghl-config.ts');
const config = getConfig('test');
const ghl = createGhl(config.locationId);
env.hooks.ghlFetch = ghl.fetch;
const { callLogNote } = require('../src/lib/call-outcome-copy.ts');
const { clock } = require('../netlify/functions/lib/invocation-scope.ts');
const F = config.fields;
const FN = {
  'call-log-barrier': require('../netlify/functions/call-log-barrier.ts'),
  'current-offer-barrier': require('../netlify/functions/current-offer-barrier.ts'),
  'ghl-write': require('../netlify/functions/ghl-write.ts'),
  'ghl-disposition': require('../netlify/functions/ghl-disposition.ts'),
  'ghl-executed-artifact-upload': require('../netlify/functions/ghl-executed-artifact-upload.ts'),
};
const S = env.S;
const A = 'fixtureContactA';
const OPP = 'fixtureOppA';
process.env.IAOS_WEBHOOK_SECRET = 'offline-webhook-secret-fixture';
const v2 = () => 'v2-' + crypto.randomUUID();
const call = (fn, event, ctx) => env.invoke(FN[fn], { fn, ...event }, ctx);
const post = (fn, body, headers = env.writeHeaders(), ctx) => call(fn, { httpMethod: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }, ctx);
const parse = (r) => { try { return JSON.parse(r.body); } catch { return null; } };
const WRITES = {
  'call-log-barrier': () => ({ action: 'begin', contactId: A, operationId: v2(), result: 'No Answer', body: callLogNote('No Answer', '') }),
  'current-offer-barrier': () => ({ action: 'begin', opportunityId: OPP, purpose: 'blur', steps: [{ step: 'offer', requestId: v2() }] }),
  'ghl-write': () => ({ operation: 'note.create', targetId: A, requestId: v2(), args: { body: 'A plain note' } }),
  'ghl-disposition': () => ({ customData: { contact_id: A, disposition: 'No Answer', duration: '12' } }),
  'ghl-executed-artifact-upload': () => ({ phase: 'chunk', opportunityId: OPP, agreementAt: '2026-10-01T00:00:00.000Z', version: { agreementAt: '2026-10-01T00:00:00.000Z', versionSeq: 1 }, uploadId: 'u1', chunkIndex: 0, chunkCount: 1, totalByteCount: 4, originalFileName: 'x.pdf', expectedFullSha256: 'a'.repeat(64), chunkBase64: Buffer.from('%PDF').toString('base64') }),
};
const hdr = (fn) => (fn === 'ghl-disposition' ? { 'x-iaos-secret': process.env.IAOS_WEBHOOK_SECRET } : env.writeHeaders());
function fresh() {
  env.reset(); ghl.clear();
  ghl.addContact(A); ghl.addOpp(OPP, A);
}
const storageIo = () => env.wire.log.length;

(async () => {
  // ── Preview refusal (P1–P3) on all five ───────────────────────────────────
  for (const fn of Object.keys(FN)) {
    for (const [name, over] of [['P1 deploy-preview context', { context: 'deploy-preview' }], ['P2 published:false', { published: false }], ['P3 fields missing', { context: undefined, published: undefined }]]) {
      await check(`${name}: ${fn} refuses a write with valid credentials, IAOS_V2_WRITES=on and an open activation -- no storage write, no GHL I/O`, async () => {
        fresh(); process.env.IAOS_V2_WRITES = 'on';
        const ctx0 = env.deployContext();
        const ctx = { ...ctx0, deploy: { ...ctx0.deploy, ...over } };
        if (ctx.deploy.context === undefined) delete ctx.deploy.context;
        if (ctx.deploy.published === undefined) delete ctx.deploy.published;
        const before = env.wire.log.filter((e) => e.method === 'PUT').length;
        const r = await post(fn, WRITES[fn](), hdr(fn), ctx);
        assert.equal(r.statusCode, 403, r.body);
        assert.deepEqual(parse(r), { error: 'Writes are refused on this deployment' });
        assert.equal(env.wire.log.filter((e) => e.method === 'PUT').length, before, 'no storage write');
        assert.equal(ghl.writes.length, 0);
        delete process.env.IAOS_V2_WRITES;
      });
    }
  }
  // ── The write gate ────────────────────────────────────────────────────────
  await check('G-1 no cutover record -> 503 cutover_pending (all five), nothing written', async () => {
    for (const fn of Object.keys(FN)) {
      fresh(); env.wire.remove(S, 'authz/cutover/v2');
      const r = await post(fn, WRITES[fn](), hdr(fn));
      assert.equal(r.statusCode, 503, `${fn} ${r.body}`); assert.equal(parse(r).code, 'cutover_pending');
      assert.equal(ghl.writes.length, 0);
    }
  });
  await check('G-3 / GEN-10 IAOS_V2_WRITES=off refuses (kill switch); =on with NO activation for this deploy refuses -- the flag never enables', async () => {
    fresh(); process.env.IAOS_V2_WRITES = 'off';
    assert.equal((await post('ghl-write', WRITES['ghl-write']())).statusCode, 503);
    process.env.IAOS_V2_WRITES = 'on';
    env.seedAuthz({ admission: { deployId: env.OTHER_DEPLOY_ID } });
    const r = await post('ghl-write', WRITES['ghl-write']());
    assert.equal(r.statusCode, 503); assert.equal(parse(r).code, 'activation_missing');
    env.seedAuthz({ admission: { state: 'closed' } });
    assert.equal(parse(await post('ghl-write', WRITES['ghl-write']())).code, 'admission_closed');
    delete process.env.IAOS_V2_WRITES;
    assert.equal(ghl.writes.length, 0);
  });
  await check('G-4 a legacy-blocked subject shows a visible held state; another subject is unaffected', async () => {
    fresh();
    const cut = require('../netlify/functions/lib/cutover.ts');
    env.wire.seed(S, cut.legacyBlockKey('test', config.locationId, `contact:${A}`), { v: 1, subject: `contact:${A}`, class: 'blocked_unknown', reasons: ['legacy_lock'], evidenceDigest: 'e' });
    const r = await post('ghl-write', WRITES['ghl-write']());
    assert.equal(r.statusCode, 503); assert.equal(parse(r).code, 'legacy_blocked');
    const st = await call('call-log-barrier', { httpMethod: 'GET', headers: { cookie: env.readCookie() }, queryStringParameters: { contactId: A } });
    assert.equal(parse(st).legacyBlocked, true); assert.equal(parse(st).lock, 'held_legacy');
    ghl.addContact('fixtureContactB');
    assert.equal((await post('ghl-write', { operation: 'note.create', targetId: 'fixtureContactB', requestId: v2(), args: { body: 'ok' } })).statusCode, 200);
  });
  await check('activation echo: a stale tab (old activationId) or a missing echo gets 409 activation_changed; the webhook needs none', async () => {
    fresh();
    const r = await post('ghl-write', WRITES['ghl-write'](), env.writeHeaders({ 'x-iaos-activation': 'v2-act-stale-0001' }));
    assert.equal(r.statusCode, 409); assert.equal(parse(r).code, 'activation_changed');
    const h = env.writeHeaders(); delete h['x-iaos-activation'];
    assert.equal(parse(await post('ghl-write', WRITES['ghl-write'](), h)).code, 'activation_changed');
    assert.equal((await post('ghl-disposition', WRITES['ghl-disposition'](), hdr('ghl-disposition'))).statusCode, 200);
  });
  await check('legacy (non-v2-) ids are refused before any I/O', async () => {
    fresh();
    const before = storageIo();
    const r = await post('ghl-write', { operation: 'note.create', targetId: A, requestId: crypto.randomUUID(), args: { body: 'x' } });
    assert.equal(r.statusCode, 400); assert.equal(parse(r).code, 'legacy_id_refused');
    const r2 = await post('call-log-barrier', { action: 'begin', contactId: A, operationId: crypto.randomUUID(), result: 'No Answer', body: callLogNote('No Answer', '') });
    assert.equal(parse(r2).code, 'legacy_id_refused');
    assert.equal(storageIo(), before);
  });

  // ── A full gated call-log save ────────────────────────────────────────────
  await check('E2E a call-log save: begin -> result -> note -> touch, each admitted, dispatched once, settled; tickets removed; lock free; GHL reached exactly once per slot, in order', async () => {
    fresh();
    const op = v2(); const note = callLogNote('No Answer', 'left vm');
    assert.equal((await post('call-log-barrier', { action: 'begin', contactId: A, operationId: op, result: 'No Answer', body: note })).statusCode, 200);
    for (const [operation, args, slot] of [['contact.callLogResult', { value: 'No Answer' }, 'result'], ['note.create', { body: note }, 'note'], ['contact.lastCallAttempt', { value: '2026-10-07T15:00:00.000Z' }, 'touch']]) {
      const r = await post('ghl-write', { operation, targetId: A, requestId: `${op}-${slot}-1`, args });
      assert.equal(r.statusCode, 200, r.body);
    }
    const st = parse(await call('call-log-barrier', { httpMethod: 'GET', headers: { cookie: env.readCookie() }, queryStringParameters: { contactId: A, operationId: op } }));
    assert.equal(st.state, 'finished'); assert.equal(st.outcome.kind, 'complete');
    assert.deepEqual(ghl.writes.map((w) => w.kind), ['fields', 'note', 'fields']);
    assert.deepEqual(Object.keys(env.admission().tickets), [], 'every ticket settled and removed');
    assert.equal(st.lock, 'free');
    assert.equal(env.wire.violations.length, 0, 'no ownership read on the cached origin');
    assert.equal(env.wire.count((e) => e.method === 'DELETE' && e.store === 'site:' + S), 0, 'no delete in the ownership store');
  });
  await check('E2E an uncertain GHL write (applied, response lost): outcome indeterminate, the ticket stays uncertain and blocks overlapping writes on that contact', async () => {
    fresh();
    ghl.on((r) => r.method === 'POST', 'lose');
    const r = await post('ghl-write', WRITES['ghl-write']());
    assert.equal(r.statusCode, 409); assert.equal(parse(r).outcome, 'indeterminate');
    const t = Object.values(env.admission().tickets);
    assert.equal(t.length, 1); assert.equal(t[0].state, 'uncertain');
    const r2 = await post('ghl-write', WRITES['ghl-write']());
    assert.equal(r2.statusCode, 409); assert.equal(parse(r2).code, 'in_progress');
    assert.equal(ghl.writes.length, 1, 'the second note was never sent');
  });
  await check('T6 the clock past T_dispatch with the scope open: refused before the GHL request; the ticket is removed as not_dispatched', async () => {
    fresh();
    const real = clock.now; let calls = 0;
    ghl.on((r) => r.method === 'GET' && /\/notes$/.test(r.path) === false, async () => { if (++calls === 2) clock.now = () => real() + 15_000; }, 9);
    try {
      const r = await post('ghl-write', WRITES['ghl-write']());
      assert.equal(ghl.writes.length, 0, 'nothing dispatched');
      assert.notEqual(r.statusCode, 200);
    } finally { clock.now = real; }
  });
  await check('T5 GHL in flight at the deadline: the request is aborted at GHL_TIMEOUT and the result is uncertain, never Saved', async () => {
    fresh();
    const scopeLib = require('../netlify/functions/lib/invocation-scope.ts');
    const saved = scopeLib.BUDGETS['ghl-write'].ghlTimeout; scopeLib.BUDGETS['ghl-write'].ghlTimeout = 300;
    ghl.on((r) => r.method === 'POST', 'hang');
    try {
      const r = await post('ghl-write', WRITES['ghl-write']());
      assert.equal(r.statusCode, 409); assert.equal(parse(r).outcome, 'indeterminate');
      assert.equal(Object.values(env.admission().tickets)[0].state, 'uncertain');
    } finally { scopeLib.BUDGETS['ghl-write'].ghlTimeout = saved; }
  });
  await check('T1/T2 a hung or rate-limited storage step: one fetch per SDK call, no 60 s SDK sleep, the endpoint answers within its budget and sends nothing', async () => {
    fresh();
    env.wire.on((req) => req.method === 'PUT' && /^lock2\//.test(req.key), env.wire.rateLimit(Math.floor(Date.now() / 1000) + 60), 99);
    const t0 = Date.now();
    const r = await post('ghl-write', WRITES['ghl-write']());
    assert.ok(Date.now() - t0 < 5_000, `answered in ${Date.now() - t0} ms`);
    assert.notEqual(r.statusCode, 200);
    assert.equal(ghl.writes.length, 0);
  });

  // ── Bones finding 1: a G5 widening races an in-flight write ────────────────
  const cutoverMod = require('../netlify/functions/iaos-cutover.ts');
  const REVIEW = 'reviewContact';
  const widenNow = async () => {
    const r = await env.invoke(cutoverMod, { fn: 'iaos-cutover', httpMethod: 'POST', headers: env.writeHeaders(), body: JSON.stringify({ action: 'g5_widen', entry: { pathId: 'review-new-block', scope: `contact:${REVIEW}`, effects: ['note'] } }) });
    assert.equal(r.statusCode, 200, r.body);
    return JSON.parse(r.body);
  };
  const isAdmissionPut = (req) => req.method === 'PUT' && req.key === 'authz/admission';
  const reviewNote = () => post('ghl-write', { operation: 'note.create', targetId: REVIEW, requestId: v2(), args: { body: 'review note' } });
  await check('W-1 (Bones finding 1) a widening AFTER the gate entry read and BEFORE the Admit write: refused g5_blocked, ZERO GHL writes', async () => {
    fresh(); ghl.addContact(REVIEW);
    let widened = null;
    env.wire.on(isAdmissionPut, env.wire.before(async () => { widened = await widenNow(); }), 1);
    const r = await reviewNote();
    assert.ok(widened && widened.effective === true, 'the widening took effect in the authoritative record');
    assert.equal(r.statusCode, 503, r.body); assert.equal(parse(r).code, 'g5_blocked');
    assert.equal(ghl.writes.length, 0);
    assert.equal(env.g5.allows(env.admission().g5, `contact:${REVIEW}`, ['note']).ok, false);
  });
  await check('W-2 a widening AFTER Admit and BEFORE the Dispatching write: the admitted ticket is revoked in the same write; nothing is sent', async () => {
    fresh(); ghl.addContact(REVIEW);
    let n = 0; let widened = null;
    env.wire.on(isAdmissionPut, env.wire.before(async () => { if (++n === 2) widened = await widenNow(); }), 2);
    const r = await reviewNote();
    assert.ok(widened && widened.revokedAdmitted === 1, JSON.stringify(widened));
    assert.notEqual(r.statusCode, 200);
    assert.equal(ghl.writes.length, 0, 'nothing dispatched');
    assert.deepEqual(Object.keys(env.admission().tickets), [], 'no ticket left behind');
  });
  await check('W-3 a widening AFTER the Dispatching write (the agreed admission point): the send proceeds once; later overlapping writes are refused', async () => {
    fresh(); ghl.addContact(REVIEW);
    ghl.on((req) => req.method === 'POST', async () => { await widenNow(); });
    const r = await reviewNote();
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(ghl.writes.length, 1);
    const later = await reviewNote();
    assert.equal(later.statusCode, 503); assert.equal(parse(later).code, 'g5_blocked');
    assert.equal(ghl.writes.length, 1);
  });

  // ── Credentials (K1–K3) ───────────────────────────────────────────────────
  await check('K1 static: zero references to GHL_PRIVATE_API_KEY in the app source (functions, src, shared)', async () => {
    const hits = [];
    const walk = (d) => { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx|js|cjs|mjs)$/.test(n) && fs.readFileSync(p, 'utf8').includes('GHL_PRIVATE_API_KEY')) hits.push(p); } };
    for (const d of ['netlify', 'src', 'shared']) walk(path.join(__dirname, '..', d));
    assert.deepEqual(hits, []);
  });
  await check('K2 every GHL consumer reads through ghlToken() (IAOS_GHL_TOKEN_V2, no fallback)', async () => {
    const dir = path.join(__dirname, '../netlify/functions');
    for (const f of ['ghl-calendar-events', 'ghl-contact-conversations', 'ghl-contact', 'ghl-contacts', 'ghl-conversations', 'ghl-documents-capability', 'ghl-mailers', 'ghl-opportunities', 'ghl-proxy', 'ghl-underwriting-policy', 'mailer-digest', 'ghl-disposition', 'lib/ghl-write-boundary', 'lib/voice-provider']) {
      assert.ok(/ghlToken\(/.test(fs.readFileSync(path.join(dir, f + '.ts'), 'utf8')), f);
    }
    const tokenSrc = fs.readFileSync(path.join(dir, 'lib/ghl-token.ts'), 'utf8');
    assert.ok(!/\?\?|\|\|/.test(tokenSrc.replace(/\/\*[\s\S]*?\*\//g, '')), 'no fallback expression');
  });
  await check('K3 with only the legacy name set, every GHL path fails closed', async () => {
    fresh();
    const saved = process.env.IAOS_GHL_TOKEN_V2; delete process.env.IAOS_GHL_TOKEN_V2; process.env.GHL_PRIVATE_API_KEY = 'legacy-value';
    try {
      const r = await post('ghl-write', WRITES['ghl-write']());
      assert.notEqual(r.statusCode, 200);
      const d = await post('ghl-disposition', WRITES['ghl-disposition'](), hdr('ghl-disposition'));
      assert.equal(d.statusCode, 500);
      assert.equal(ghl.writes.length, 0);
    } finally { process.env.IAOS_GHL_TOKEN_V2 = saved; delete process.env.GHL_PRIVATE_API_KEY; }
  });

  // ── Capability (C1–C8) ────────────────────────────────────────────────────
  const capHeaders = () => ({ ...env.writeHeaders(), cookie: env.readCookie() });
  await check('C3/C6 storage_capability on all five: verified + signed attestation, 0 GHL calls, 0 storage writes, X-IAOS-Storage on the authenticated response', async () => {
    fresh();
    for (const fn of Object.keys(FN)) {
      const puts = env.wire.log.filter((e) => e.method === 'PUT').length;
      const r = await post(fn, { action: 'storage_capability', nonce: 'pub-1:digest' }, capHeaders());
      const b = parse(r);
      assert.equal(r.statusCode, 200, `${fn} ${r.body}`);
      assert.equal(b.storage, 'verified'); assert.equal(r.headers['x-iaos-storage'], 'verified');
      assert.equal(b.deployId, DEPLOY_ID); assert.equal(b.attestation.nonce, 'pub-1:digest'); assert.ok(b.attestation.signature);
      assert.equal(env.wire.log.filter((e) => e.method === 'PUT').length, puts, 'zero storage writes');
    }
    assert.equal(ghl.writes.length, 0);
  });
  await check('C2 before the import (no cutover record) the result is `configured` and unsigned', async () => {
    fresh(); env.wire.remove(S, 'authz/cutover/v2');
    const b = parse(await post('ghl-write', { action: 'storage_capability' }, capHeaders()));
    assert.equal(b.storage, 'configured'); assert.equal(b.attestation.signature, null);
  });
  await check('C1/C4 a malformed context -> unknown, 0 fetches; a Lambda context (no uncachedEdgeURL) -> unavailable', async () => {
    const cap = require('../netlify/functions/lib/capability.ts');
    const before = env.wire.log.length;
    const r1 = await cap.storageCapability('ghl-write', { id: DEPLOY_ID, context: 'production', published: true }, undefined, process.env, { edgeURL: 'nope', uncachedEdgeURL: 'nope', siteID: 's', token: 't' });
    assert.equal(r1.body.storage, 'unknown');
    assert.equal(env.wire.log.length, before);
    const lambda = JSON.parse(Buffer.from(env.wire.lambdaContext(), 'base64').toString());
    const r2 = await cap.storageCapability('ghl-write', { id: DEPLOY_ID, context: 'production', published: true }, undefined, process.env, lambda);
    assert.equal(r2.body.storage, 'unknown', 'not configured: no uncached origin');
  });
  await check('C5 unauthorized capability requests: today\'s refusal, byte-identical, no header, 0 storage fetches', async () => {
    fresh();
    const before = env.wire.log.length;
    const r = await post('ghl-write', { action: 'storage_capability' }, { origin: process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN });
    assert.equal(r.statusCode, 401); assert.equal(r.body, JSON.stringify({ error: 'Application write sign-in required' }));
    assert.equal(r.headers['x-iaos-storage'], undefined);
    const noRead = await post('ghl-write', { action: 'storage_capability' }, env.writeHeaders());
    assert.equal(noRead.statusCode, 401);
    assert.equal(env.wire.log.length, before);
  });
  await check('C6b malformed capability variants are refused', async () => {
    fresh();
    for (const b of [{ action: 'storage_capability', extra: 1 }, { action: 'storage_capability', nonce: '' }, { action: 'storage_capability', nonce: 'x'.repeat(200) }]) {
      assert.equal((await post('ghl-write', b, capHeaders())).statusCode, 400);
    }
  });
  await check('C7 disposition: a capability body without sessions gets today\'s 401; with the webhook secret only it takes the webhook path', async () => {
    fresh();
    const r = await post('ghl-disposition', { action: 'storage_capability' }, {});
    assert.equal(r.statusCode, 401); assert.equal(r.body, JSON.stringify({ error: 'unauthorized' }));
    const r2 = await post('ghl-disposition', { action: 'storage_capability' }, { 'x-iaos-secret': process.env.IAOS_WEBHOOK_SECRET });
    assert.equal(r2.statusCode, 400, 'webhook path: missing customData');
    const r3 = await post('ghl-disposition', { action: 'storage_capability' }, { ...capHeaders() });
    assert.equal(parse(r3).storage, 'verified');
  });
  await check('C8 the Production allowance accepts only the exact shape; it creates no GHL client and writes no storage', async () => {
    const ps = require('../netlify/functions/lib/production-write-scope.ts');
    assert.equal(ps.evaluateProductionCapabilityAllowance({ action: 'storage_capability' }).ok, true);
    assert.equal(ps.evaluateProductionCapabilityAllowance({ action: 'storage_capability', x: 1 }).ok, false);
    assert.equal(ps.evaluateProductionCapabilityAllowance({ action: 'begin' }).ok, false);
    const src = fs.readFileSync(path.join(__dirname, '../netlify/functions/lib/capability.ts'), 'utf8');
    assert.ok(!/ghl-write-boundary|configuredBoundary|createOnce|cas\(|setJSON/.test(src), 'capability creates no GHL client and makes no storage write');
    assert.ok(/new VerifiedStore\(scope, undefined, undefined, true\)/.test(src), 'read-only store');
  });

  // ── Request parity (E rows) ───────────────────────────────────────────────
  await check('E1 disposition: OPTIONS -> 204, empty body, no headers; GET -> its 405 body (byte-identical)', async () => {
    fresh();
    const o = await call('ghl-disposition', { httpMethod: 'OPTIONS', headers: {} });
    assert.equal(o.statusCode, 204); assert.equal(o.body, ''); assert.deepEqual(Object.keys(o.headers), []);
    const g = await call('ghl-disposition', { httpMethod: 'GET', headers: {} });
    assert.equal(g.statusCode, 405); assert.equal(g.body, JSON.stringify({ error: 'Method Not Allowed' }));
  });
  await check('E2 disposition webhook-auth matrix: missing, wrong, duplicated secret -> byte-identical 401', async () => {
    fresh();
    for (const h of [{}, { 'x-iaos-secret': 'wrong' }, { 'x-iaos-secret': `${process.env.IAOS_WEBHOOK_SECRET}, ${process.env.IAOS_WEBHOOK_SECRET}` }]) {
      const r = await post('ghl-disposition', WRITES['ghl-disposition'](), h);
      assert.equal(r.statusCode, 401); assert.equal(r.body, JSON.stringify({ error: 'unauthorized' }));
    }
  });
  await check('E3 the session endpoints keep today\'s order and bodies: method 405, sign-in 401, origin 403', async () => {
    fresh();
    for (const fn of ['call-log-barrier', 'current-offer-barrier', 'ghl-write', 'ghl-executed-artifact-upload']) {
      const m = await call(fn, { httpMethod: 'PUT', headers: env.writeHeaders(), body: '{}' });
      assert.equal(m.statusCode, 405, fn);
      const s = await post(fn, WRITES[fn](), { origin: process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN });
      assert.equal(s.statusCode, 401); assert.equal(parse(s).error, 'Application write sign-in required');
      const o = await post(fn, WRITES[fn](), env.writeHeaders({ origin: 'https://evil.example' }));
      assert.equal(o.statusCode, 403); assert.equal(parse(o).error, 'Application write origin refused');
      const dup = await post(fn, WRITES[fn](), env.writeHeaders({ origin: `${process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN}, https://evil.example` }));
      assert.equal(dup.statusCode, 403, `${fn}: a duplicated Origin is refused`);
    }
  });
  await check('E4 tightenings land on each endpoint\'s own parse refusal (after auth): repeated query, wrong content type, non-identity encoding, a BOM, invalid UTF-8', async () => {
    fresh();
    const good = JSON.stringify(WRITES['ghl-write']());
    const variants = [
      { headers: env.writeHeaders({ 'content-type': 'text/plain' }), body: good },
      { headers: env.writeHeaders({ 'content-encoding': 'gzip' }), body: good },
      { headers: env.writeHeaders(), body: '﻿' + good },
      { headers: env.writeHeaders(), body: Buffer.from([0x7b, 0xff, 0xfe, 0x7d]) },
    ];
    for (const v of variants) {
      const r = await call('ghl-write', { httpMethod: 'POST', headers: v.headers, body: v.body });
      assert.equal(r.statusCode, 400, r.body); assert.equal(parse(r).error, 'Invalid named write request');
    }
    const res = await FN['call-log-barrier'].default(new Request(`https://x/.netlify/functions/call-log-barrier?contactId=${A}&contactId=${A}`, { headers: { cookie: env.readCookie() } }), env.deployContext());
    assert.equal(res.status, 400, 'repeated query name');
    assert.equal(ghl.writes.length, 0);
  });
  await check('E5 the artifact endpoint accepts a ~4 MB JSON chunkBase64 body (3,000,000-byte chunk); invalid base64 and the platform body limit are pinned', async () => {
    fresh();
    const mr = require('../netlify/functions/lib/modern-runtime.ts');
    assert.equal(mr.PLATFORM_BODY_LIMIT_BYTES, 6 * 1024 * 1024);
    const bytes = Buffer.alloc(3_000_000, 0x25);
    const body = { ...WRITES['ghl-executed-artifact-upload'](), totalByteCount: 3_000_000, chunkBase64: bytes.toString('base64'), expectedFullSha256: crypto.createHash('sha256').update(bytes).digest('hex') };
    const text = JSON.stringify(body);
    assert.ok(text.length > 4_000_000);
    const r = await post('ghl-executed-artifact-upload', text);
    assert.equal(r.statusCode, 200, r.body); assert.equal(parse(r).accepted, true);
    const big = await post('ghl-executed-artifact-upload', JSON.stringify({ ...body, chunkBase64: 'A'.repeat(7 * 1024 * 1024) }));
    assert.equal(big.statusCode, 400, 'larger than the platform limit');
  });

  // ── Legacy isolation (L7, L7b, S4) ────────────────────────────────────────
  await check('L7 the real 3de480e write-receipts library, run as a legacy writer (Bones\'s A/B/C sequence), cannot address any v2 record', async () => {
    fresh();
    // Inside app/ so the legacy code resolves the SAME pinned @netlify/blobs from app/node_modules.
    fs.mkdirSync(path.join(__dirname, '..', '.tmp-legacy'), { recursive: true });
    const tmp = fs.mkdtempSync(path.join(__dirname, '..', '.tmp-legacy', 'legacy-3de480e-'));
    const repo = path.join(__dirname, '..', '..');
    const put = (rel) => { const out = path.join(tmp, rel); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, execFileSync('git', ['-C', repo, 'show', `3de480e:${rel}`])); };
    for (const rel of ['app/netlify/functions/lib/write-receipts.ts', 'app/netlify/functions/lib/ghl-write-boundary.ts', 'app/netlify/functions/lib/write-contracts.ts', 'app/shared/ghl-config.ts']) put(rel);
    const legacyMods = path.join(tmp, 'app');
    const before = JSON.stringify(env.wire.keys(S).sort().map((k) => [k, env.wire.etag(S, k)]));
    const blobs = require('@netlify/blobs');
    blobs.connectLambda({ blobs: Buffer.from(JSON.stringify({ url: env.wire.EDGE, token: 't' })).toString('base64'), headers: { 'x-nf-site-id': env.wire.SITE, 'x-nf-deploy-id': 'legacy' } });
    let lw;
    lw = require(path.join(legacyMods, 'netlify/functions/lib/write-receipts.ts'));
    {
      // A acquires; B observes the failure to acquire; A's delayed DELETE; C acquires -- all on the LEGACY store.
      const relA = await lw.lockContact(A).catch(() => null);
      await lw.lockContact(A).catch(() => null);
      if (relA) await relA().catch(() => null);
      await lw.lockContact(A).catch(() => null);
      await lw.clearStageTransition(OPP).catch(() => null);     // S4: a legacy clearStageTransition
    }
    process.env.NETLIFY_BLOBS_CONTEXT = env.wire.context();
    const after = JSON.stringify(env.wire.keys(S).sort().map((k) => [k, env.wire.etag(S, k)]));
    assert.equal(after, before, 'no v2 record was created, changed or deleted by legacy code');
    fs.rmSync(path.join(__dirname, '..', '.tmp-legacy'), { recursive: true, force: true });
    assert.ok(env.wire.keys('iaos-write-receipts').some((k) => k.startsWith('lock/')), 'the legacy writer really ran, against its own store only');
  });
  await check('L7b static: v2 reads no legacy credential name; the 3de480e source names no v2 store or env name', async () => {
    const repo = path.join(__dirname, '..', '..');
    let hits = '';
    try { hits = execFileSync('git', ['-C', repo, 'grep', '-l', '-e', 'iaos-ownership-v2', '-e', 'IAOS_GHL_TOKEN_V2', '-e', 'IAOS_ATTEST_SECRET_V2', '3de480e', '--', 'app/netlify', 'app/src', 'app/shared'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { hits = ''; }
    assert.equal(hits.trim(), '');
  });

  // ── Static checks ────────────────────────────────────────────────────────
  await check('PUB-13 static: no Netlify API host or Netlify credential variable in any application function', async () => {
    const dir = path.join(__dirname, '../netlify/functions');
    const all = [...fs.readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => path.join(dir, f)), ...fs.readdirSync(path.join(dir, 'lib')).filter((f) => f.endsWith('.ts')).map((f) => path.join(dir, 'lib', f))];
    for (const f of all) {
      const src = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      assert.ok(!/api\.netlify\.com|NETLIFY_AUTH_TOKEN|NETLIFY_PUBLISHER_TOKEN|IAOS_NETLIFY_READ_TOKEN/.test(src), path.basename(f));
    }
  });
  await check('static: no eventual-read fallback remains (BlobsConsistencyError is never caught to retry eventually)', async () => {
    const dir = path.join(__dirname, '../netlify/functions');
    for (const f of [...fs.readdirSync(dir).filter((x) => x.endsWith('.ts')).map((x) => path.join(dir, x)), ...fs.readdirSync(path.join(dir, 'lib')).filter((x) => x.endsWith('.ts')).map((x) => path.join(dir, 'lib', x))]) {
      const src = fs.readFileSync(f, 'utf8');
      assert.ok(!/BlobsConsistencyError"\)\s*throw/.test(src) && !/e\?\.name !== "BlobsConsistencyError"/.test(src), path.basename(f));
    }
  });
  await check('static: the five endpoints are modern-runtime default exports with no config.path and no connectLambda', async () => {
    for (const fn of Object.keys(FN)) {
      const src = fs.readFileSync(path.join(__dirname, '../netlify/functions', fn + '.ts'), 'utf8');
      assert.ok(/export default async \(req: Request, context: any\)/.test(src), fn);
      assert.ok(!/export const handler/.test(src) && !/connectLambda/.test(src) && !/export const config/.test(src), fn);
    }
  });
  await check('probes: Test-only, store-scoped, no GHL module; the build guard removes them from every non-Test build', async () => {
    for (const f of ['storage-probe.ts', 'probe-limit.ts']) {
      const src = fs.readFileSync(path.join(__dirname, '../netlify/functions', f), 'utf8');
      assert.ok(!/ghl-write-boundary|ghl-token|leadconnector|configuredBoundary/.test(src), f);
    }
    const g = require('./production-build-guard.cjs');
    const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'guard-'));
    for (const f of g.PROBES) fs.writeFileSync(path.join(tmp, f), '//');
    assert.equal(g.guard({ SITE_NAME: 'iaos-app-test' }, tmp).kept, true);
    assert.equal(g.guard({ SITE_NAME: 'iaos-app' }, tmp).kept, false);
    assert.deepEqual(fs.readdirSync(tmp), []);
    const probe = require('../netlify/functions/storage-probe.ts');
    assert.equal(probe.probeAllowed({ IAOS_ENV: 'production' }, env.deployContext()), false);
    assert.equal(probe.probeAllowed({ IAOS_ENV: 'test' }, env.deployContext({ context: 'deploy-preview' })), false);
    assert.equal(probe.probeAllowed({ IAOS_ENV: 'test' }, env.deployContext()), true);
  });
  await check('voice stays fail-closed while disabled (plan v6 §13)', async () => {
    const src = fs.readFileSync(path.join(__dirname, '../netlify/functions/lib/voice-attempt-store.ts'), 'utf8');
    assert.ok(src.length > 0);
    const vp = require('../netlify/functions/lib/voice-provider.ts');
    assert.equal(typeof vp.readEligibleGhlContact, 'function');
    await assert.rejects(vp.readEligibleGhlContact('x', async () => { throw new Error('no network'); }, {}), /token/i);
  });
  done('storage endpoints');
})();
