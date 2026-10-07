/**
 * Storage correction -- the controlled publisher at its REAL command boundaries
 * (Bones review finding 3). Each `iaos-publish` command runs as a SEPARATE child
 * process (`node scripts/iaos-publish.cjs …`) against a local HTTP server that
 * serves the REAL iaos-activation function and the five endpoints (as the target
 * deployment), over the wire harness with the real @netlify/blobs client, plus a
 * FAKE operator-side Netlify API. Offline: nothing touches Netlify or GHL.
 */
'use strict';
process.env.NODE_ENV = 'test';
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { setupV2Env, DEPLOY_ID } = require('./harness/v2-env.cjs');
const { check, done } = require('./harness/check.cjs');
const realFetch = globalThis.fetch;
const env = setupV2Env();
/* Only the local test server is reachable; GHL or any other host is a test failure (offline). */
env.hooks.ghlFetch = (url, init) => { if (new URL(String(url)).hostname !== '127.0.0.1') throw new Error('offline: unexpected host ' + url); return realFetch(url, init); };
const S = env.S;
const SITE_ID = '00000000-0000-0000-0000-0000000000aa';
const TARGET = DEPLOY_ID;
const FNS = ['iaos-activation', 'call-log-barrier', 'current-offer-barrier', 'ghl-write', 'ghl-disposition', 'ghl-executed-artifact-upload'];
const MODS = Object.fromEntries(FNS.map((f) => [f, require(`../netlify/functions/${f}.ts`)]));
const SEMANTICS = {
  v: 1, ref: 'fixture-semantics-1', endpoint: 'restoreSiteDeploy', createdAt: 'x', approvals: { bones: 'fixture-approval-bones', jess: 'fixture-approval-jess' },
  predicates: [{ id: 'applied-201', classifies: 'APPLIED', status: 201, body: [{ field: 'id', op: 'equals_target' }, { field: 'published_at', op: 'present' }], citation: 'fixture citation only' }],
};
let netlifyMode = 'applied';      // 'applied' | 'hang' | 'down'
const restoreCalls = [];
let onRestore = null;
const server = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (url.pathname.startsWith('/api/v1/')) {
      restoreCalls.push({ method: req.method, path: url.pathname });
      if (onRestore) onRestore();
      if (netlifyMode === 'hang') return;                         // never answers
      if (netlifyMode === 'down') { res.destroy(); return; }
      if (netlifyMode === 'reject') { res.writeHead(422, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ code: 422, message: 'fixture refusal' })); }
      res.writeHead(201, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ id: TARGET, site_id: SITE_ID, published_at: '2026-10-07T03:00:00Z' }));
    }
    const fn = url.pathname.replace('/.netlify/functions/', '');
    const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    const r = await MODS[fn].default(new Request(`https://iaos-app-test.netlify.app${req.url}`, { method: req.method, headers, ...(body.length ? { body } : {}) }), env.deployContext({ id: TARGET }));
    const out = {}; r.headers.forEach((v, k) => { out[k] = v; });
    res.writeHead(r.status, out); res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) { res.writeHead(500); res.end(String(e && e.message)); }
});
let port;
const toolEnv = () => ({
  ...process.env,
  IAOS_SITE_URL: `http://127.0.0.1:${port}`, IAOS_NETLIFY_API_BASE: `http://127.0.0.1:${port}`,
  IAOS_WRITE_SESSION: env.writeHeaders().authorization.slice(7), IAOS_WRITE_ORIGIN: process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN,
  IAOS_READ_COOKIE: env.readCookie(), NETLIFY_SITE_ID: SITE_ID, NETLIFY_PUBLISHER_TOKEN: 'fake-publisher-token',
});
const TOOL = path.join(__dirname, 'iaos-publish.cjs');
/** Runs ONE command as its own process. */
function runTool(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [TOOL, ...args], { env: toolEnv(), timeout: 60_000 }, (err, stdout, stderr) => {
      let out = null; try { out = JSON.parse(stdout); } catch { out = null; }
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out, stderr });
    });
  });
}
const g5Digest = () => env.g5.tableDigest(env.wire.json(S, 'authz/g5/table'));
const common = (act) => ['--activation', act, '--approval', 'approval-ref-0001', '--revocation', 'revocation-ref-0001', '--g5-digest', g5Digest()];
const rec = () => env.admission();
const fresh = () => { env.reset(); restoreCalls.length = 0; netlifyMode = 'applied'; onRestore = null; };

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;

  await check('PC-1 one `cycle` process: close -> claim -> dispatching -> ONE restore -> APPLIED -> five attestations -> activate, ownership held throughout', async () => {
    fresh(); env.wire.seed(S, 'authz/provider-semantics/1', SEMANTICS);
    const r = await runTool(['cycle', '--pub', 'pub-pc000001', '--target', TARGET, ...common('v2-act-pc0001')]);
    assert.equal(r.code, 0, r.stderr + JSON.stringify(r.out));
    assert.equal(r.out.publish.classification, 'APPLIED');
    assert.equal(restoreCalls.length, 1);
    assert.equal(rec().state, 'open'); assert.equal(rec().activationId, 'v2-act-pc0001');
  });
  await check('PC-2 (Bones finding 3) RESPONDED, then the publishing process exits; semantics approved LATER; a NEW `resume` process takes over, reclassifies the STORED response and activates -- with no second restore', async () => {
    fresh();
    const r1 = await runTool(['cycle', '--pub', 'pub-pc000002', '--target', TARGET, ...common('v2-act-pc0002')]);
    assert.equal(r1.code, 2, JSON.stringify(r1.out)); assert.equal(r1.out.publish.classification, 'RESPONDED');
    assert.equal(rec().publication.outstanding.state, 'responded');
    env.wire.seed(S, 'authz/provider-semantics/1', SEMANTICS);       // approved after the process is gone
    const r2 = await runTool(['resume', ...common('v2-act-pc0002')]);
    assert.equal(r2.code, 0, JSON.stringify(r2.out));
    assert.equal(rec().state, 'open'); assert.equal(rec().activationId, 'v2-act-pc0002');
    assert.equal(restoreCalls.length, 1, 'the stored response was classified; nothing was re-sent');
    assert.equal(rec().epoch, 2);
  });
  await check('PC-3 (Bones finding 3) a completed publish whose activation failed: a NEW process `resume` activates (no not_publisher), no second restore', async () => {
    fresh(); env.wire.seed(S, 'authz/provider-semantics/1', SEMANTICS);
    const bad = ['--activation', 'v2-act-pc0003', '--approval', 'approval-ref-0001', '--revocation', 'revocation-ref-0001', '--g5-digest', 'not-the-approved-digest'];
    const r1 = await runTool(['cycle', '--pub', 'pub-pc000003', '--target', TARGET, ...bad]);
    assert.equal(r1.code, 2, JSON.stringify(r1.out)); assert.equal(r1.out.publish.classification, 'APPLIED');
    assert.equal(rec().state, 'closed');
    const r2 = await runTool(['resume', ...common('v2-act-pc0003')]);
    assert.equal(r2.code, 0, JSON.stringify(r2.out));
    assert.equal(rec().state, 'open'); assert.equal(restoreCalls.length, 1);
  });
  await check('PC-4 the `cycle` process is KILLED after its restore request left (no response): the attempt stays dispatching; a NEW `resume` is blocked (exit 3), never re-dispatches, and no new cycle can start', async () => {
    fresh(); env.wire.seed(S, 'authz/provider-semantics/1', SEMANTICS); netlifyMode = 'hang';
    const child = spawn(process.execPath, [TOOL, 'cycle', '--pub', 'pub-pc000004', '--target', TARGET, ...common('v2-act-pc0004')], { env: toolEnv(), stdio: 'ignore' });
    await new Promise((resolve) => { onRestore = resolve; });
    child.kill('SIGKILL');
    await new Promise((r) => child.on('exit', r));
    assert.equal(rec().publication.outstanding.state, 'dispatching');
    const r2 = await runTool(['resume', ...common('v2-act-pc0004')]);
    assert.equal(r2.code, 3, JSON.stringify(r2.out));
    const r3 = await runTool(['cycle', '--pub', 'pub-pc000005', '--target', TARGET, ...common('v2-act-pc0005')]);
    assert.equal(r3.code, 1);
    assert.equal(restoreCalls.length, 1, 'exactly one restore request ever');
    assert.equal(rec().state, 'closed');
  });
  await check('PC-5 a transport failure is UNRESOLVED: `cycle` exits 3, `resume` exits 3, nothing re-sent', async () => {
    fresh(); netlifyMode = 'down';
    const r1 = await runTool(['cycle', '--pub', 'pub-pc000006', '--target', TARGET, ...common('v2-act-pc0006')]);
    assert.equal(r1.code, 3, JSON.stringify(r1.out));
    assert.equal(rec().publication.outstanding.state, 'unresolved');
    assert.equal((await runTool(['resume', ...common('v2-act-pc0006')])).code, 3);
    assert.equal(restoreCalls.length, 1);
  });
  await check('PC-6 a new process can never claim or dispatch in another process\'s cycle; resume hands over a never-sent `claimed` attempt by abandoning it', async () => {
    fresh();
    const ad = require('../netlify/functions/lib/admission.ts');
    const vs = require('../netlify/functions/lib/verified-store.ts');
    const { InvocationScope } = require('../netlify/functions/lib/invocation-scope.ts');
    const st = new vs.VerifiedStore(new InvocationScope('iaos-activation'), S);
    const lost = require('node:crypto').randomBytes(32).toString('hex');      // a process that died after Claim
    await ad.closeAdmission(st, lost, 'pub-pc000007', TARGET); await ad.claimAttempt(st, lost, 'att-pc000007');
    const r = await runTool(['resume', ...common('v2-act-pc0007')]);
    assert.equal(r.code, 2, JSON.stringify(r.out)); assert.equal(r.out.stop, 'abandoned');
    assert.equal(rec().publication.history[0].terminal, 'ABANDONED');
    assert.equal(restoreCalls.length, 0);
  });
  await check('PC-7 the tool never persists its private token: no file is written by any command', async () => {
    const fs = require('node:fs');
    const src = fs.readFileSync(TOOL, 'utf8');
    assert.ok(!/writeFile|appendFile|createWriteStream/.test(src));
  });
  await check('PC-8 iaos-activation status is read-only and needs a read session; transitions need Brad\'s write session and origin', async () => {
    fresh();
    const un = await fetch(`http://127.0.0.1:${port}/.netlify/functions/iaos-activation`);
    assert.equal(un.status, 401);
    const noAuth = await fetch(`http://127.0.0.1:${port}/.netlify/functions/iaos-activation`, { method: 'POST', headers: { 'content-type': 'application/json', origin: process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN }, body: JSON.stringify({ action: 'close' }) });
    assert.equal(noAuth.status, 401);
  });
  /* Bones re-review of 20d7a62, item 2: the documented continuation after a terminal-unsent (ABANDONED)
     or REJECTED attempt runs, at the real command/process boundary, through to activation. */
  const ad = require('../netlify/functions/lib/admission.ts');
  const vs = require('../netlify/functions/lib/verified-store.ts');
  const { InvocationScope } = require('../netlify/functions/lib/invocation-scope.ts');
  const directStore = () => new vs.VerifiedStore(new InvocationScope('iaos-activation'), S);
  const REJECTING = { ...SEMANTICS, ref: 'fixture-semantics-2', predicates: [{ id: 'rejected-422', classifies: 'REJECTED', status: 422, body: [{ field: 'message', op: 'present' }, { field: 'id', op: 'absent' }], citation: 'fixture citation only' }] };
  await check('PC-9 (Bones re-review item 2, the review case) old publisher closes and claims, never dispatches; a NEW `resume` abandons it (exit 2); a fresh `cycle` with a new publication is still refused; `resume` again sends nothing; `next-attempt` on the SAME publication restores ONCE and activates, history retained', async () => {
    fresh(); env.wire.seed(S, 'authz/provider-semantics/1', SEMANTICS);
    const lost = require('node:crypto').randomBytes(32).toString('hex');
    await ad.closeAdmission(directStore(), lost, 'pub-pc000009', TARGET); await ad.claimAttempt(directStore(), lost, 'att-pc000009');
    const r1 = await runTool(['resume', ...common('v2-act-pc0009')]);
    assert.equal(r1.code, 2, JSON.stringify(r1.out)); assert.equal(r1.out.stop, 'abandoned');
    assert.match(r1.out.next, /next-attempt --pub pub-pc000009 --target /);
    const r2 = await runTool(['cycle', '--pub', 'pub-pc000010', '--target', TARGET, ...common('v2-act-pc0010')]);
    assert.equal(r2.code, 1); assert.equal(r2.out.publish.body.refused, 'publication_in_progress');
    assert.equal(rec().publication.pubId, 'pub-pc000009', 'a different publication never takes over');
    const r3 = await runTool(['resume', ...common('v2-act-pc0009')]);
    assert.equal(r3.code, 2, JSON.stringify(r3.out)); assert.equal(r3.out.stop, 'no_applied_attempt');
    assert.equal(restoreCalls.length, 0, 'nothing sent before next-attempt');
    const r4 = await runTool(['next-attempt', '--pub', 'pub-pc000009', '--target', TARGET, ...common('v2-act-pc0009')]);
    assert.equal(r4.code, 0, r4.stderr + JSON.stringify(r4.out));
    assert.equal(r4.out.publish.classification, 'APPLIED');
    assert.equal(restoreCalls.length, 1, 'exactly one restore');
    assert.equal(rec().state, 'open'); assert.equal(rec().activationId, 'v2-act-pc0009');
    const arch = [...env.wire.keys(S)].filter((k) => k.startsWith('evidence/activation/'));
    const last = env.wire.json(S, arch[arch.length - 1]);
    assert.deepEqual(last.history.map((h) => [h.attemptId, h.terminal]), [['att-pc000009', 'ABANDONED'], [r4.out.publish.attemptId, 'APPLIED']], 'history retained in the same publication');
  });
  await check('PC-10 (Bones re-review item 2) REJECTED by `cycle` (recorded response) and REJECTED by `resume` (reclassified stored response): each continues with `next-attempt` in the same publication to activation; never the rejected request again', async () => {
    for (const via of ['cycle', 'resume']) {
      fresh(); env.wire.seed(S, 'authz/provider-semantics/1', SEMANTICS); netlifyMode = 'reject';
      if (via === 'cycle') env.wire.seed(S, 'authz/provider-semantics/2', REJECTING);
      const pubId = via === 'cycle' ? 'pub-pc000011' : 'pub-pc000012';
      const r1 = await runTool(['cycle', '--pub', pubId, '--target', TARGET, ...common('v2-act-pc0011')]);
      assert.equal(r1.code, 2, JSON.stringify(r1.out));
      if (via === 'cycle') { assert.equal(r1.out.publish.classification, 'REJECTED'); assert.match(r1.out.next, /next-attempt --pub /); }
      else {
        assert.equal(r1.out.publish.classification, 'RESPONDED');
        env.wire.seed(S, 'authz/provider-semantics/2', REJECTING);     // approved later, for the stored 422
        const r2 = await runTool(['resume', ...common('v2-act-pc0011')]);
        assert.equal(r2.code, 2, JSON.stringify(r2.out)); assert.equal(r2.out.stop, 'rejected'); assert.match(r2.out.next, /next-attempt --pub /);
      }
      assert.equal(rec().publication.outstanding, null);
      netlifyMode = 'applied';
      const r3 = await runTool(['next-attempt', '--pub', pubId, '--target', TARGET, ...common('v2-act-pc0011')]);
      assert.equal(r3.code, 0, `${via}: ` + r3.stderr + JSON.stringify(r3.out));
      assert.equal(restoreCalls.length, 2, `${via}: one restore per attempt`);
      assert.equal(rec().state, 'open');
    }
  });
  await check('PC-11 (Bones re-review item 2) `next-attempt` never resets or resends: refused while dispatching (killed sender) or unresolved (exit 3), for another publication or target (exit 1), and after APPLIED (exit 2); a handover naming another publication is refused inside the CAS', async () => {
    // dispatching: the sender was killed after its request left
    fresh(); env.wire.seed(S, 'authz/provider-semantics/1', SEMANTICS); netlifyMode = 'hang';
    const child = spawn(process.execPath, [TOOL, 'cycle', '--pub', 'pub-pc000013', '--target', TARGET, ...common('v2-act-pc0013')], { env: toolEnv(), stdio: 'ignore' });
    await new Promise((resolve) => { onRestore = resolve; });
    child.kill('SIGKILL'); await new Promise((r) => child.on('exit', r));
    const before = rec().publication.publisherHash;
    assert.equal((await runTool(['next-attempt', '--pub', 'pub-pc000013', '--target', TARGET, ...common('v2-act-pc0013')])).code, 3);
    assert.equal(rec().publication.outstanding.state, 'dispatching'); assert.equal(rec().publication.publisherHash, before);
    assert.equal(restoreCalls.length, 1);
    // unresolved
    fresh(); netlifyMode = 'down';
    await runTool(['cycle', '--pub', 'pub-pc000014', '--target', TARGET, ...common('v2-act-pc0014')]);
    assert.equal((await runTool(['next-attempt', '--pub', 'pub-pc000014', '--target', TARGET, ...common('v2-act-pc0014')])).code, 3);
    assert.equal(restoreCalls.length, 1);
    // another publication / another target, after a real abandonment
    fresh();
    const lost = require('node:crypto').randomBytes(32).toString('hex');
    await ad.closeAdmission(directStore(), lost, 'pub-pc000015', TARGET); await ad.claimAttempt(directStore(), lost, 'att-pc000015');
    await runTool(['resume', ...common('v2-act-pc0015')]);
    assert.equal((await runTool(['next-attempt', '--pub', 'pub-pc000099', '--target', TARGET, ...common('v2-act-pc0015')])).code, 1);
    assert.equal((await runTool(['next-attempt', '--pub', 'pub-pc000015', '--target', 'f'.repeat(24), ...common('v2-act-pc0015')])).code, 1);
    // the server binds the handover itself: a handover naming another publication changes nothing
    const p3 = require('node:crypto').randomBytes(32).toString('hex');
    const owner = rec().publication.publisherHash;
    const h = await fetch(`http://127.0.0.1:${port}/.netlify/functions/iaos-activation`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: env.writeHeaders().authorization, origin: process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN }, body: JSON.stringify({ action: 'handover', publisherToken: p3, pubId: 'pub-pc000099', targetDeployId: TARGET }) });
    assert.equal(h.status, 409); assert.equal((await h.json()).refused, 'publication_mismatch'); assert.equal(rec().publication.publisherHash, owner);
    const h2 = await fetch(`http://127.0.0.1:${port}/.netlify/functions/iaos-activation`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: env.writeHeaders().authorization, origin: process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN }, body: JSON.stringify({ action: 'handover', publisherToken: p3 }) });
    assert.equal(h2.status, 409, 'a handover must name its publication'); assert.equal((await h2.json()).refused, 'invalid_request'); assert.equal(rec().publication.publisherHash, owner);
    assert.equal(restoreCalls.length, 0);
    // after APPLIED (activation failed): next-attempt refuses; resume is the path
    fresh(); env.wire.seed(S, 'authz/provider-semantics/1', SEMANTICS);
    await runTool(['cycle', '--pub', 'pub-pc000016', '--target', TARGET, '--activation', 'v2-act-pc0016', '--approval', 'approval-ref-0001', '--revocation', 'revocation-ref-0001', '--g5-digest', 'not-the-approved-digest']);
    const r = await runTool(['next-attempt', '--pub', 'pub-pc000016', '--target', TARGET, ...common('v2-act-pc0016')]);
    assert.equal(r.code, 2); assert.equal(r.out.stop, 'already_applied');
    assert.equal(restoreCalls.length, 1);
  });
  server.close();
  done('iaos-publish (process boundaries)');
})();
