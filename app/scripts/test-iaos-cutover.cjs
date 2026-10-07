/**
 * Storage correction -- the separately authorized cutover tool endpoint
 * (iaos-cutover) end to end over the wire harness. Offline. It never calls GHL,
 * never writes the legacy store, never clears anything.
 */
'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { setupV2Env } = require('./harness/v2-env.cjs');
const { check, done } = require('./harness/check.cjs');
const env = setupV2Env();
const { canonical, digest } = require('../netlify/functions/lib/hash.ts');
const mod = require('../netlify/functions/iaos-cutover.ts');
const S = env.S;
const L = 'iaos-write-receipts';
const post = (body, headers = env.writeHeaders()) => env.invoke(mod, { fn: 'iaos-cutover', httpMethod: 'POST', headers, body: JSON.stringify(body) });
const parse = (r) => JSON.parse(r.body);
let ghlCalls = 0;
env.hooks.ghlFetch = async () => { ghlCalls++; throw new Error('no GHL from the cutover tool'); };
const fresh = () => { env.wire.clear(); };

(async () => {
  await check('CT-1 transitions need Brad\'s write session and the exact origin; status needs a read session', async () => {
    fresh();
    assert.equal((await post({ action: 'g5_init' }, { origin: process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN })).statusCode, 401);
    assert.equal((await post({ action: 'g5_init' }, env.writeHeaders({ origin: 'https://evil.example' }))).statusCode, 403);
    assert.equal((await env.invoke(mod, { fn: 'iaos-cutover', httpMethod: 'GET', headers: {} })).statusCode, 401);
  });
  await check('CT-2 g5_init creates the default {location: ALL} table once; status reports its digest', async () => {
    fresh();
    assert.equal(parse(await post({ action: 'g5_init' })).created, true);
    assert.equal(parse(await post({ action: 'g5_init' })).created, false);
    const st = parse(await env.invoke(mod, { fn: 'iaos-cutover', httpMethod: 'GET', headers: { cookie: env.readCookie() } }));
    assert.equal(st.g5.entries, 1);
  });
  await check('CT-3 g5_narrow refuses an empty-search / absence-of-errors basis and an incomplete audit; the table is unchanged', async () => {
    fresh();
    await post({ action: 'g5_init' });
    const before = env.wire.json(S, 'authz/g5/table');
    const evidence = { basis: 'empty_search' };
    const r = await post({ action: 'g5_narrow', record: { v: 1, id: 'n-bad-0001', pathId: 'default', rule: 'N3', scopes: [], evidence, evidenceDigest: digest(canonical(evidence)), approvalRef: 'approval-ref-0001', createdAt: 'x' } });
    assert.equal(r.statusCode, 409); assert.equal(parse(r).refused, 'narrowing');
    assert.deepEqual(env.wire.json(S, 'authz/g5/table'), before);
    assert.equal(env.wire.json(S, 'authz/g5/narrow/n-bad-0001'), null, 'no narrowing record written');
  });
  await check('CT-4 a complete AUDIT narrowing is recorded immutably and changes the table digest (writes refuse until re-activation)', async () => {
    fresh();
    await post({ action: 'g5_init' });
    const entries = [{ pathId: 'ghl-disposition', scope: 'location', effects: ['note', 'last_touch'] }];
    const evidence = { complete: true, unresolvedDeploys: 0, unauditedFunctions: 0, documentDigest: 'd'.repeat(64), pathCount: 1 };
    const record = { v: 1, id: 'audit-0001', pathId: 'default', rule: 'AUDIT', scopes: [], auditEntries: entries, evidence, evidenceDigest: digest(canonical(evidence)), approvalRef: 'approval-ref-0001', createdAt: 'x' };
    const r = await post({ action: 'g5_narrow', record });
    assert.equal(r.statusCode, 200, r.body);
    assert.ok(env.wire.json(S, 'authz/g5/narrow/audit-0001'));
    assert.equal((await post({ action: 'g5_narrow', record })).statusCode, 409, 'never applied twice');
  });
  await check('CT-5 the import owner is claimed once per store: a second runId is refused (no takeover)', async () => {
    fresh();
    const t1 = crypto.randomBytes(32).toString('hex'); const t2 = crypto.randomBytes(32).toString('hex');
    assert.equal((await post({ action: 'import_claim_owner', runId: 'run-ct000001', runToken: t1 })).statusCode, 200);
    const r = await post({ action: 'import_claim_owner', runId: 'run-ct000002', runToken: t2 });
    assert.equal(r.statusCode, 409); assert.ok(parse(r).halted);
  });
  await check('CT-6 a capture batch reads the legacy store and never writes it; capture is refused to a non-owner', async () => {
    fresh();
    env.wire.seed(L, 'lock/' + 'a'.repeat(64), { claimedAt: 't' });
    const t = crypto.randomBytes(32).toString('hex');
    await post({ action: 'import_claim_owner', runId: 'run-ct000006', runToken: t });
    const bad = await post({ action: 'import_capture', runId: 'run-ct000006', runToken: crypto.randomBytes(32).toString('hex'), snapshot: 'S1' });
    assert.equal(bad.statusCode, 409);
    const r = await post({ action: 'import_capture', runId: 'run-ct000006', runToken: t, snapshot: 'S1' });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(env.wire.log.filter((e) => e.store === 'site:' + L && e.method !== 'GET').length, 0, 'the legacy store is never written');
    assert.ok(env.wire.keys(S).some((k) => k.startsWith('evidence/run-ct000006/S1/obs/')));
  });
  await check('CT-7 register_semantics refuses an unapproved record (missing reviewer references)', async () => {
    fresh();
    const r = await post({ action: 'register_semantics', n: 1, record: { v: 1, ref: 'x', endpoint: 'restoreSiteDeploy', predicates: [{ id: 'p', classifies: 'APPLIED', status: 201, body: [{ field: 'id', op: 'equals_target' }], citation: 'citation-0001' }], approvals: { bones: '', jess: '' }, createdAt: 'x' } });
    assert.equal(r.statusCode, 409);
    assert.equal(env.wire.json(S, 'authz/provider-semantics/1'), null);
  });
  await check('CT-8 the cutover tool makes zero GHL calls', async () => { assert.equal(ghlCalls, 0); });
  done('iaos-cutover');
})();
