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
  server.close();
  done('iaos-publish (process boundaries)');
})();
