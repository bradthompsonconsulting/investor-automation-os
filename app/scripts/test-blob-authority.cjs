/**
 * B1 Blob authority -- offline tests (B15-26 B1 r7 acceptance boundary r2/r3).
 *
 * Compiles netlify/functions/lib/blob-authority.ts and drives it against a
 * loopback FAKE Blob service (signing API + signed-URL server) and a decoy
 * edge server that must never be contacted. No network beyond 127.0.0.1, no
 * real credential: every site id and token is a synthetic literal, and only
 * keyed fingerprints of Authorization headers are ever compared or logged.
 *
 * Shows OUR module's behaviour only. It cannot prove provider guarantees:
 * conditional-write atomicity, ETag distinctness (A1), real status codes,
 * signing side effects or strong-read freshness.
 */
'use strict';
process.env.NODE_ENV = 'test'; // SDK retry delay 1 ms if any retry ever happened (it must not)
const { execSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const APP = path.resolve(__dirname, '..');
const TMP = path.join(APP, '.tmp-blob-authority-test');
/** Literal count of check() executions defined in this file (loops expanded by hand), never back-filled from a run. */
const FLOOR = 80; // run 1 used 82: a hand-count arithmetic error (all 80 defined checks ran); corrected, not back-filled
let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}
const fp = (s) => crypto.createHash('sha256').update(`b1-test-fp:${s}`).digest('hex').slice(0, 16);

// ---------------------------------------------------------------- compile ---
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"commonjs"}');
try {
  execSync(`node "${path.join(APP, 'node_modules', 'typescript', 'bin', 'tsc')}" "${path.join(APP, 'netlify', 'functions', 'lib', 'blob-authority.ts')}" --outDir "${TMP}" --module commonjs --target es2022 --moduleResolution node --strict --skipLibCheck --esModuleInterop`, { cwd: APP, stdio: 'inherit' });
} catch (e) {
  console.error('ABORT: TypeScript compilation failed. Nothing tested.');
  process.exit(10);
}
const MOD_PATH = path.join(TMP, 'blob-authority.js');
const loadModule = () => { delete require.cache[require.resolve(MOD_PATH)]; return require(MOD_PATH); };

// ------------------------------------------------------------ fake service ---
function startFake() {
  const store = new Map(); // fullKey -> { text, etag }
  const signed = new Map(); // id -> { site, storeName, key, method, authFp }
  const log = [];
  let rules = [];
  let etagN = 0;
  const deferred = [];
  const violations = [];
  const fullKey = (site, storeName, key) => `${site}|${storeName}|${key}`;
  const nextEtag = () => `"fake-e${++etagN}"`;
  function applyPut(site, storeName, key, body, headers) {
    const k = fullKey(site, storeName, key);
    const cur = store.get(k);
    const inm = headers['if-none-match'];
    const im = headers['if-match'];
    if (!inm && !im) violations.push('unconditional_put');
    if (inm === '*' && cur) return { status: 412 };
    if (im && (!cur || cur.etag !== im)) return { status: 412 };
    const etag = nextEtag();
    store.set(k, { text: body, etag });
    return { status: 200, etag };
  }
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const url = new URL(req.url, 'http://x');
      const auth = req.headers.authorization;
      const isSign = req.headers.accept === 'application/json;type=signed-url' && url.pathname.startsWith('/api/v1/blobs/');
      const stage = isSign ? 'sign' : 'blob';
      const method = req.method;
      const rule = rules.find((r) => r.stage === stage && (!r.method || r.method === method));
      if (rule) rules = rules.filter((r) => r !== rule);
      if (isSign) {
        const rest = decodeURIComponent(url.pathname.slice('/api/v1/blobs/'.length)).split('/');
        const [site, storeName, ...keyParts] = rest;
        const entry = { stage, method, site, storeName, key: keyParts.join('/'), authFp: auth ? fp(auth) : null, hasAuth: !!auth };
        log.push(entry);
        if (rule && rule.reset) return req.socket.destroy();
        if (rule && rule.status) { res.writeHead(rule.status); return res.end(); }
        const id = crypto.randomUUID();
        signed.set(id, { site, storeName, key: entry.key, method, authFp: entry.authFp });
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ url: `${origin}/signed/${id}` }));
      }
      const id = url.pathname.startsWith('/signed/') ? url.pathname.slice('/signed/'.length) : null;
      const s = id && signed.get(id);
      const entry = { stage, method, signedOk: !!s, site: s && s.site, key: s && s.key, issuerAuthFp: s && s.authFp, hasAuth: !!auth, authFp: auth ? fp(auth) : null, ifNoneMatch: req.headers['if-none-match'] || null, ifMatch: req.headers['if-match'] || null, body: method === 'PUT' ? body : null };
      log.push(entry);
      if (!s || s.method.toUpperCase() !== method) { res.writeHead(403); return res.end(); }
      if (method === 'DELETE') { violations.push('delete'); res.writeHead(204); return res.end(); }
      const doApply = () => applyPut(s.site, s.storeName, s.key, body, req.headers);
      if (method === 'GET') {
        if (rule && rule.status) { res.writeHead(rule.status); return res.end(); }
        if (rule && rule.reset) return req.socket.destroy();
        const cur = store.get(fullKey(s.site, s.storeName, s.key));
        if (!cur) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { etag: cur.etag });
        return res.end(cur.text);
      }
      // PUT
      if (rule && rule.defer) { deferred.push(doApply); return req.socket.destroy(); }
      if (rule && rule.delay) { await new Promise((r) => setTimeout(r, rule.delay)); if (rule.apply) doApply(); try { res.writeHead(200); res.end(); } catch {} return; }
      if (rule && rule.reset) { if (rule.apply) doApply(); return req.socket.destroy(); }
      if (rule && rule.status) {
        const out = rule.apply ? doApply() : null;
        res.writeHead(rule.status, out && out.etag ? { etag: out.etag } : {});
        return res.end();
      }
      const out = doApply();
      res.writeHead(out.status, out.etag ? { etag: out.etag } : {});
      return res.end();
    });
  });
  let origin = '';
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    origin = `http://127.0.0.1:${server.address().port}`;
    resolve({
      origin, store, log, violations, deferred,
      script: (r) => { rules.push(...r); },
      reset: () => { store.clear(); signed.clear(); log.length = 0; rules = []; deferred.length = 0; },
      runDeferred: () => { const out = deferred.splice(0).map((f) => f()); return out; },
      blobPuts: () => log.filter((e) => e.stage === 'blob' && e.method === 'PUT').length,
      requests: () => log.length,
      close: () => new Promise((r) => server.close(r)),
    });
  }));
}

function startEdgeDecoy() {
  const hits = [];
  const server = http.createServer((req, res) => { hits.push(req.url); res.writeHead(500); res.end(); });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ origin: `http://127.0.0.1:${server.address().port}`, hits, close: () => new Promise((r) => server.close(r)) })));
}

const HEX = (c) => c.repeat(64);
const INTENT = { operator: 'op@example.test', opportunityId: 'opp-synthetic-1', contactId: 'contact-synthetic-1', preconditionDigest: HEX('a'), expectedResultHash: HEX('b') };
const SITE_A = 'site-A-synthetic';
const TOKEN_A = 'tok-A-synthetic-not-a-credential';

async function main() {
  const M = loadModule();
  const fake = await startFake();
  const edge = await startEdgeDecoy();
  const STORE = 'site:' + M.AUTHORITY_STORE;
  const client = M.createAuthorityClient({ siteID: SITE_A, token: TOKEN_A, apiURL: fake.origin, timeoutMs: 400 });
  const keyOf = (scope) => `${SITE_A}|${STORE}|${M.authorityKey(scope)}`;
  const stored = (scope) => fake.store.get(keyOf(scope)) || null;
  const stateOf = (scope) => { const s = stored(scope); return s ? JSON.parse(s.text).state : 'absent'; };
  const seed = (scope, value) => { const etag = `"seed-${crypto.randomUUID()}"`; fake.store.set(keyOf(scope), { text: M.canonicalJson(value), etag }); return etag; };
  const opFix = (opId = crypto.randomUUID()) => ({ opId, nonce: HEX('c').slice(0, 32), operator: 'op@example.test', target: { opportunityId: 'opp-synthetic-1', contactId: 'contact-synthetic-1' }, preconditionDigest: HEX('a'), expectedResultHash: HEX('b'), admittedAt: '2026-10-21T00:00:00.000Z' });
  const IDLE = () => ({ schema: 1, state: 'IDLE', v: 3, epoch: 3, last: { opId: 'prev-op', outcome: 'completed' }, fencedOp: null, fencedAt: null });
  const COMPLETED = () => ({ schema: 1, state: 'COMPLETED', v: 4, epoch: 4, op: opFix('completed-op'), completion: { noteId: 'note-1', observedId: 'completed-op', observedTotal: 18500, completedAt: '2026-10-21T00:00:01.000Z' }, fencedOp: null, fencedAt: null });
  const ADMITTED = (opId) => ({ schema: 1, state: 'ADMITTED', v: 5, epoch: 5, op: opFix(opId) });
  const HELD = (opId) => ({ schema: 1, state: 'HELD_RECOVERY', v: 6, epoch: 6, op: opFix(opId), reason: 'target_uncertain', heldAt: '2026-10-21T00:00:02.000Z' });
  let n = 0;
  const scope = () => `scope-${++n}`;
  try {
    // ======================== G1: single-attempt classification (open) ===
    { fake.reset(); const s = scope(); const r = await M.openAdmission(client, s, INTENT);
      check('G1.1 committed: open from absent -> committed with ETag', r.kind === 'committed' && typeof r.etag === 'string' && r.etag.length > 0, r);
      check('G1.2 committed: stored ADMITTED, exactly one blob PUT with If-None-Match *', stateOf(s) === 'ADMITTED' && fake.blobPuts() === 1 && fake.log.find((e) => e.stage === 'blob' && e.method === 'PUT').ifNoneMatch === '*'); }
    { fake.reset(); const s = scope(); fake.script([{ stage: 'blob', method: 'PUT', status: 412 }]); const r = await M.openAdmission(client, s, INTENT);
      check('G1.3 412 -> refused(precondition_changed), one blob PUT', r.kind === 'refused' && r.reason === 'precondition_changed' && fake.blobPuts() === 1, r); }
    for (const [label, rule] of [['404', { status: 404 }], ['429', { status: 429 }], ['500', { status: 500 }], ['403', { status: 403 }], ['400', { status: 400 }]]) {
      fake.reset(); const s = scope(); fake.script([{ stage: 'blob', method: 'PUT', ...rule }]); const r = await M.openAdmission(client, s, INTENT);
      check(`G1.4 ${label} on the blob write -> ambiguous with an opaque handle, never committed`, r.kind === 'ambiguous' && typeof r.handle === 'object', r.kind);
      check(`G1.5 ${label}: exactly one blob PUT and one PUT-signing request (no SDK retry, no re-sign)`, fake.blobPuts() === 1 && fake.log.filter((e) => e.stage === 'sign' && e.method === 'PUT').length === 1, fake.log.map((e) => `${e.stage}:${e.method}`));
    }
    { fake.reset(); const s = scope(); fake.script([{ stage: 'blob', method: 'PUT', status: 503, apply: true }]); const r = await M.openAdmission(client, s, INTENT);
      check('G1.6 503 after the write applied -> ambiguous (SDK would report modified:true)', r.kind === 'ambiguous', r.kind);
      const c = await M.classifyUncertainOpen(client, r.handle);
      check('G1.7 ... classify -> landed (exact attempted bytes stored)', c.kind === 'landed', c); }
    { fake.reset(); const s = scope(); fake.script([{ stage: 'blob', method: 'PUT', reset: true }]); const r = await M.openAdmission(client, s, INTENT);
      check('G1.8 connection reset, not applied -> ambiguous; one blob PUT', r.kind === 'ambiguous' && fake.blobPuts() === 1, r.kind);
      const c = await M.classifyUncertainOpen(client, r.handle);
      check('G1.9 ... classify -> still_possible (absence does not clear)', c.kind === 'still_possible', c); }
    { fake.reset(); const s = scope(); fake.script([{ stage: 'blob', method: 'PUT', delay: 900, apply: false }]); const t0 = Date.now(); const r = await M.openAdmission(client, s, INTENT);
      check('G1.10 timeout (400 ms) -> ambiguous; one blob PUT; returned within the deadline window', r.kind === 'ambiguous' && fake.blobPuts() === 1 && Date.now() - t0 < 2500, { kind: r.kind, ms: Date.now() - t0 }); }
    { fake.reset(); const s = scope(); fake.script([{ stage: 'sign', method: 'PUT', status: 500 }]); const r = await M.openAdmission(client, s, INTENT);
      check('G1.11 sign 500 -> not_sent; no blob PUT', r.kind === 'not_sent' && fake.blobPuts() === 0, r); }
    { fake.reset(); const s = scope(); fake.script([{ stage: 'sign', method: 'PUT', reset: true }]); const r = await M.openAdmission(client, s, INTENT);
      check('G1.12 sign connection reset -> not_sent; no blob PUT', r.kind === 'not_sent' && fake.blobPuts() === 0, r); }

    // ======================== G1: reads ===
    { fake.reset(); const s = scope(); const r = await M.readAuthority(client, s); check('G1.13 read absent -> absent', r.kind === 'absent', r); }
    { fake.reset(); const s = scope(); seed(s, IDLE()); const r = await M.readAuthority(client, s); check('G1.14 read present -> state, v, epoch, etag', r.kind === 'present' && r.state === 'IDLE' && r.v === 3 && r.etag === stored(s).etag, r); }
    { fake.reset(); const s = scope(); seed(s, IDLE()); fake.script([{ stage: 'blob', method: 'GET', status: 503 }]); const r = await M.readAuthority(client, s);
      check('G1.15 read 503 -> unreadable, one blob GET', r.kind === 'unreadable' && fake.log.filter((e) => e.stage === 'blob' && e.method === 'GET').length === 1, r); }
    { fake.reset(); const s = scope(); fake.store.set(keyOf(s), { text: 'not json', etag: '"x"' }); const r = await M.readAuthority(client, s); check('G1.16 invalid stored value -> unreadable', r.kind === 'unreadable', r); }
    { fake.reset(); const s = scope(); fake.store.set(keyOf(s), { text: JSON.stringify(IDLE(), null, 1), etag: '"x"' }); const r = await M.readAuthority(client, s); check('G1.17 non-canonical stored text -> unreadable', r.kind === 'unreadable', r); }

    // ======================== Uncertain open: classify / fence / late write ===
    { fake.reset(); const s = scope(); fake.script([{ stage: 'blob', method: 'PUT', defer: true }]); const r = await M.openAdmission(client, s, INTENT);
      check('T1.1 deferred (late) write -> ambiguous', r.kind === 'ambiguous', r.kind);
      const c = await M.classifyUncertainOpen(client, r.handle); check('T1.2 classify before the late write -> still_possible', c.kind === 'still_possible', c);
      const f = await M.fenceUncertainOpen(client, r.handle); check('T1.3 fence -> fenced; state IDLE with fencedOp = attempted opId', f.kind === 'fenced' && stateOf(s) === 'IDLE' && JSON.parse(stored(s).text).fencedOp !== null, f);
      const before = stored(s).text; const late = fake.runDeferred();
      check('T1.4 the late write arrives after the fence -> 412 at the provider; state unchanged (fenced)', late[0].status === 412 && stored(s).text === before, late);
      const c2 = await M.classifyUncertainOpen(client, r.handle); check('T1.5 classify after fence -> already_fenced', c2.kind === 'already_fenced', c2);
      const o = await M.openAdmission(client, s, INTENT); check('T1.6 a new admission proceeds from the fenced IDLE', o.kind === 'committed', o); }
    { fake.reset(); const s = scope(); fake.script([{ stage: 'blob', method: 'PUT', status: 500, apply: true }]); const r = await M.openAdmission(client, s, INTENT);
      const f = await M.fenceUncertainOpen(client, r.handle);
      check('T1.7 landed uncertain open: fence refused; state stays ADMITTED', f.kind === 'refused' && stateOf(s) === 'ADMITTED', f);
      const o = await M.openAdmission(client, s, INTENT); check('T1.8 landed ADMITTED blocks new admissions (scope_blocked)', o.kind === 'refused' && o.reason === 'scope_blocked', o); }
    { fake.reset(); const s = scope(); seed(s, IDLE()); fake.script([{ stage: 'blob', method: 'PUT', reset: true }]); const r = await M.openAdmission(client, s, INTENT);
      const other = await M.openAdmission(client, s, INTENT);
      const c = await M.classifyUncertainOpen(client, r.handle);
      check('T1.9 intervening admission commits -> classify already_fenced', other.kind === 'committed' && c.kind === 'already_fenced', { other, c });
      const f = await M.fenceUncertainOpen(client, r.handle); check('T1.10 ... fence refused, intervening ADMITTED untouched', f.kind === 'refused' && stateOf(s) === 'ADMITTED' && JSON.parse(stored(s).text).op.opId === other.opId, f); }
    { fake.reset(); const s = scope(); fake.script([{ stage: 'blob', method: 'PUT', reset: true }]); const r = await M.openAdmission(client, s, INTENT);
      fake.script([{ stage: 'blob', method: 'PUT', status: 503 }]);
      const f1 = await M.fenceUncertainOpen(client, r.handle); check('T1.11 fence itself ambiguous -> ambiguous', f1.kind === 'ambiguous', f1);
      const f2 = await M.fenceUncertainOpen(client, r.handle); check('T1.12 a later fence (still absent) -> fenced', f2.kind === 'fenced' && stateOf(s) === 'IDLE', f2); }

    // ======================== C1: COMPLETED-preserving fence (F8 / F8b) ===
    { fake.reset(); const s = scope(); const comp = COMPLETED(); seed(s, comp); fake.script([{ stage: 'blob', method: 'PUT', reset: true }]); const r = await M.openAdmission(client, s, INTENT);
      const before = JSON.parse(stored(s).text);
      const f = await M.fenceUncertainOpen(client, r.handle); const after = JSON.parse(stored(s).text);
      check('C1.1 fence on COMPLETED -> fenced, still COMPLETED', f.kind === 'fenced' && after.state === 'COMPLETED', f);
      check('C1.2 op and completion byte-identical to the stored COMPLETED', M.canonicalJson(after.op) === M.canonicalJson(before.op) && M.canonicalJson(after.completion) === M.canonicalJson(before.completion));
      check('C1.3 only v/epoch/fence metadata changed', after.v === before.v + 1 && after.epoch === before.epoch + 1 && after.fencedOp !== null && Object.keys(after).sort().join() === Object.keys(before).sort().join());
      const put = fake.log.filter((e) => e.stage === 'blob' && e.method === 'PUT').pop();
      check('C1.4 the fence PUT is conditional on the read ETag (If-Match)', put.ifMatch !== null && put.ifNoneMatch === null); }
    { fake.reset(); const s = scope(); seed(s, COMPLETED()); fake.script([{ stage: 'blob', method: 'PUT', reset: true }]); const r = await M.openAdmission(client, s, INTENT);
      const changed = COMPLETED(); changed.completion.observedTotal = 1; seed(s, changed); const snapshot = stored(s).text; const puts = fake.blobPuts();
      const f = await M.fenceUncertainOpen(client, r.handle);
      check('F8b COMPLETED changed between attempt and fence -> refused; no write; stored unchanged', f.kind === 'refused' && fake.blobPuts() === puts && stored(s).text === snapshot, f); }

    // ======================== F1/F2/F3/F5/F8 forbidden-transition enumeration ===
    const fixtures = { absent: null, IDLE: IDLE(), ADMITTED: ADMITTED('fix-op'), COMPLETED: COMPLETED(), HELD_RECOVERY: HELD('fix-op') };
    const allowed = new Set(['absent>ADMITTED', 'IDLE>ADMITTED', 'COMPLETED>ADMITTED', 'ADMITTED>HELD_RECOVERY']);
    let illegal = []; let completedWrites = [];
    for (const [name, value] of Object.entries(fixtures)) {
      const calls = [
        ['openAdmission', (s) => M.openAdmission(client, s, INTENT)],
        ['labelHeldRecovery(right op)', (s) => M.labelHeldRecovery(client, s, 'fix-op')],
        ['labelHeldRecovery(wrong op)', (s) => M.labelHeldRecovery(client, s, 'other-op')],
        ['classifyUncertainOpen(forged)', (s) => M.classifyUncertainOpen(client, {})],
        ['fenceUncertainOpen(forged)', (s) => M.fenceUncertainOpen(client, Object.freeze(Object.create(null)))],
        ['readAuthority', (s) => M.readAuthority(client, s)],
      ];
      for (const [cname, call] of calls) {
        fake.reset(); const s = scope(); if (value) seed(s, value);
        await call(s);
        const to = stateOf(s);
        if (to !== name && !allowed.has(`${name}>${to}`)) illegal.push(`${name}-${cname}->${to}`);
        for (const e of fake.log) if (e.stage === 'blob' && e.method === 'PUT' && e.body && JSON.parse(e.body).state === 'COMPLETED') completedWrites.push(`${name}-${cname}`);
      }
    }
    check('F1/F2/F3/F5 export x state enumeration: only absent/IDLE/COMPLETED->ADMITTED and ADMITTED->HELD_RECOVERY ever occur', illegal.length === 0, illegal);
    check('F8 no export writes COMPLETED from any state in the enumeration', completedWrites.length === 0, completedWrites);
    check('F8 exported surface has no close/complete/write/set/fence-any function', Object.keys(M).filter((k) => typeof M[k] === 'function').sort().join(',') === ['authorityKey', 'canonicalJson', 'classifyUncertainOpen', 'createAuthorityClient', 'fenceUncertainOpen', 'labelHeldRecovery', 'openAdmission', 'parseAuthorityText', 'readAuthority'].sort().join(','), Object.keys(M));
    { fake.reset(); const s = scope(); seed(s, ADMITTED('x')); const r = await M.openAdmission(client, s, INTENT); check('F3 openAdmission from ADMITTED refused before any write', r.kind === 'refused' && r.reason === 'scope_blocked' && fake.blobPuts() === 0, r); }
    { fake.reset(); const s = scope(); seed(s, HELD('x')); const r = await M.openAdmission(client, s, INTENT); check('F3 openAdmission from HELD_RECOVERY refused before any write', r.kind === 'refused' && fake.blobPuts() === 0, r); }
    { fake.reset(); const s = scope(); seed(s, ADMITTED('x')); const r = await M.labelHeldRecovery(client, s, 'x'); check('F5 labelHeldRecovery ADMITTED(x) -> HELD_RECOVERY(x) with If-Match', r.kind === 'labelled' && stateOf(s) === 'HELD_RECOVERY' && JSON.parse(stored(s).text).op.opId === 'x' && fake.log.filter((e) => e.stage === 'blob' && e.method === 'PUT')[0].ifMatch !== null, r); }
    { fake.reset(); const s = scope(); seed(s, HELD('x')); const r = await M.labelHeldRecovery(client, s, 'x'); check('F2 labelHeldRecovery on HELD_RECOVERY refused; no write', r.kind === 'refused' && fake.blobPuts() === 0, r); }
    { fake.reset(); const s = scope(); seed(s, IDLE()); const r = await M.labelHeldRecovery(client, s, 'x'); check('F5 labelHeldRecovery on IDLE refused; no write', r.kind === 'refused' && fake.blobPuts() === 0, r); }

    // ======================== F4: fence never acts on ADMITTED / HELD ===
    { fake.reset(); const s = scope(); seed(s, IDLE()); fake.script([{ stage: 'blob', method: 'PUT', reset: true }]); const r = await M.openAdmission(client, s, INTENT);
      seed(s, ADMITTED('someone')); const puts = fake.blobPuts(); const f = await M.fenceUncertainOpen(client, r.handle);
      check('F4 fence when state became ADMITTED -> refused, no write', f.kind === 'refused' && fake.blobPuts() === puts && stateOf(s) === 'ADMITTED', f);
      seed(s, HELD('someone')); const f2 = await M.fenceUncertainOpen(client, r.handle);
      check('F4 fence when state is HELD_RECOVERY -> refused, no write', f2.kind === 'refused' && fake.blobPuts() === puts && stateOf(s) === 'HELD_RECOVERY', f2); }

    // ======================== F7: refused caller inputs (before any request) ===
    for (const [label, call] of [
      ['extra intent key', () => M.openAdmission(client, scope(), { ...INTENT, completion: { x: 1 } })],
      ['missing intent key', () => { const { contactId, ...rest } = INTENT; return M.openAdmission(client, scope(), rest); }],
      ['non-hex digest', () => M.openAdmission(client, scope(), { ...INTENT, expectedResultHash: 'zz' })],
      ['empty scope', () => M.openAdmission(client, '', INTENT)],
      ['forged client', () => M.openAdmission({ __authorityClient: true }, scope(), INTENT)],
      ['label without opId', () => M.labelHeldRecovery(client, scope(), '')],
    ]) { fake.reset(); const r = await call(); check(`F7 ${label} -> refused before any request`, r.kind === 'refused' && fake.requests() === 0, { r, n: fake.requests() }); }
    let threw = 0;
    for (const opts of [{ siteID: SITE_A, token: TOKEN_A, edgeURL: edge.origin }, { token: TOKEN_A }, { siteID: SITE_A }, { siteID: SITE_A, token: TOKEN_A, uncachedEdgeURL: edge.origin }]) { try { M.createAuthorityClient(opts); } catch { threw += 1; } }
    check('F7 createAuthorityClient refuses edge options and requires both siteID and token', threw === 4, threw);

    // ======================== F10: ADMITTED stays blocking ===
    for (const [label, rules] of [['label never called', null], ['label 500 not applied', [{ stage: 'blob', method: 'PUT', status: 500 }]], ['label 503 applied', [{ stage: 'blob', method: 'PUT', status: 503, apply: true }]]]) {
      fake.reset(); const s = scope(); const o = await M.openAdmission(client, s, INTENT);
      if (rules) { fake.script(rules); await M.labelHeldRecovery(client, s, o.opId); }
      const again = await M.openAdmission(client, s, INTENT);
      check(`F10 ${label}: scope still blocking (${stateOf(s)})`, again.kind === 'refused' && again.reason === 'scope_blocked' && (stateOf(s) === 'ADMITTED' || stateOf(s) === 'HELD_RECOVERY'), again);
    }

    // ======================== F11: scope substitution / transfer ===
    { fake.reset(); let s = scope(); const sB = scope(); seed(sB, IDLE()); const bBefore = stored(sB).text;
      fake.script([{ stage: 'blob', method: 'PUT', reset: true }]); const r = await M.openAdmission(client, s, INTENT); const sA = s; s = sB; // caller's variable now names B
      const f = await M.fenceUncertainOpen(client, r.handle);
      const keysUsed = new Set(fake.log.filter((e) => e.stage === 'blob').map((e) => e.key));
      check('F11 handle for A acts only on A (no request names B); B byte-identical', f.kind === 'fenced' && !keysUsed.has(M.authorityKey(sB)) && keysUsed.has(M.authorityKey(sA)) && stored(sB).text === bBefore, { f, keysUsed: [...keysUsed].length });
      const clientB = M.createAuthorityClient({ siteID: 'site-B-synthetic', token: 'tok-B-synthetic-not-a-credential', apiURL: fake.origin });
      fake.log.length = 0; const t = await M.fenceUncertainOpen(clientB, r.handle);
      check('F11 handle transferred to another client -> refused before any request', t.kind === 'refused' && fake.requests() === 0, t); }

    // ======================== F12 / F13: forged and copied handles ===
    { fake.reset(); const s = scope(); fake.script([{ stage: 'blob', method: 'PUT', reset: true }]); const r = await M.openAdmission(client, s, INTENT); fake.log.length = 0;
      const forged = [{}, Object.freeze(Object.create(null)), 'handle', { __uncertainOpen: true }, null];
      let ok = true; for (const h of forged) { const a = await M.classifyUncertainOpen(client, h); const b = await M.fenceUncertainOpen(client, h); ok = ok && a.kind === 'refused' && b.kind === 'refused'; }
      check('F12 forged handles -> refused before any request', ok && fake.requests() === 0, fake.requests());
      const copies = [structuredClone(r.handle), JSON.parse(JSON.stringify(r.handle)), { ...r.handle }, Object.assign(Object.create(null), r.handle)];
      ok = true; for (const h of copies) { const a = await M.fenceUncertainOpen(client, h); ok = ok && a.kind === 'refused'; }
      check('F13 copied/serialized handles -> refused before any request', ok && fake.requests() === 0, fake.requests());
      const still = await M.classifyUncertainOpen(client, r.handle); check('F13 ... the original handle still works (not consumed by refused copies)', still.kind === 'still_possible', still); }

    // ======================== F14: modified attempt data ===
    { fake.reset(); const s = scope(); seed(s, IDLE()); const pre = stored(s).etag; fake.script([{ stage: 'blob', method: 'PUT', reset: true }]); const r = await M.openAdmission(client, s, INTENT);
      let mutated = 0;
      try { r.handle.scope = 'other'; } catch { mutated += 1; }
      try { Object.defineProperty(r.handle, 'precondition', { value: { etag: 'forged' } }); } catch { mutated += 1; }
      const protoChanged = Reflect.setPrototypeOf(r.handle, { key: 'x' });
      check('F14 the handle is frozen and opaque (mutation attempts rejected)', mutated === 2 && protoChanged === false && Object.isFrozen(r.handle) && Object.keys(r.handle).length === 0, { mutated, protoChanged });
      fake.log.length = 0; const f = await M.fenceUncertainOpen(client, r.handle);
      const put = fake.log.find((e) => e.stage === 'blob' && e.method === 'PUT');
      check('F14 the op proceeds with the ORIGINAL recorded scope and precondition ETag (If-Match = original)', f.kind === 'fenced' && put && put.key === M.authorityKey(s) && put.ifMatch === pre, { f, put: put && { k: put.key === M.authorityKey(s), m: put.ifMatch === pre } }); }

    // ======================== F15: stale handle after restart ===
    { fake.reset(); const s = scope(); fake.script([{ stage: 'blob', method: 'PUT', status: 500, apply: true }]); const r = await M.openAdmission(client, s, INTENT);
      const snapshot = { ...stored(s) };
      const M2 = loadModule(); const client2 = M2.createAuthorityClient({ siteID: SITE_A, token: TOKEN_A, apiURL: fake.origin, timeoutMs: 400 });
      fake.log.length = 0;
      const a = await M2.classifyUncertainOpen(client2, r.handle); const b = await M2.fenceUncertainOpen(client2, r.handle);
      check('F15 stale handle in a fresh module instance -> refused before any request', a.kind === 'refused' && b.kind === 'refused' && fake.requests() === 0, { a, b });
      check('F15 persisted state unchanged (text and ETag)', stored(s).text === snapshot.text && stored(s).etag === snapshot.etag);
      const rd = await M2.readAuthority(client2, s);
      check('F15 fresh instance reads the persisted state as-is (ADMITTED, still blocking); no reconstruction claimed', rd.kind === 'present' && rd.state === 'ADMITTED', rd);
      const o = await M2.openAdmission(client2, s, INTENT); check('F15 ... and refuses admission (scope_blocked)', o.kind === 'refused' && o.reason === 'scope_blocked', o); }

    // ======================== G2: credential isolation ===
    { fake.reset(); const s1 = scope(); const s2 = scope();
      const ctxC = Buffer.from(JSON.stringify({ siteID: 'site-C-synthetic', token: 'tok-C-synthetic-not-a-credential', edgeURL: edge.origin, uncachedEdgeURL: edge.origin })).toString('base64');
      process.env.NETLIFY_BLOBS_CONTEXT = ctxC; globalThis.netlifyBlobsContext = ctxC;
      const TOKEN_B = 'tok-B-synthetic-not-a-credential'; const SITE_B = 'site-B-synthetic';
      const cA = M.createAuthorityClient({ siteID: SITE_A, token: TOKEN_A, apiURL: fake.origin });
      const cB = M.createAuthorityClient({ siteID: SITE_B, token: TOKEN_B, apiURL: fake.origin });
      await Promise.all([M.openAdmission(cA, s1, INTENT), M.openAdmission(cB, s2, INTENT), M.readAuthority(cA, s1), M.readAuthority(cB, s2)]);
      delete process.env.NETLIFY_BLOBS_CONTEXT; delete globalThis.netlifyBlobsContext;
      const fpA = fp(`Bearer ${TOKEN_A}`), fpB = fp(`Bearer ${TOKEN_B}`), fpC = fp('Bearer tok-C-synthetic-not-a-credential');
      const signs = fake.log.filter((e) => e.stage === 'sign');
      check('G2.1 no request reached the environment-context (edge) endpoint', edge.hits.length === 0, edge.hits.length);
      check('G2.2 every sign request carries exactly its own client credential for its own site', signs.length > 0 && signs.every((e) => (e.site === SITE_A && e.authFp === fpA) || (e.site === SITE_B && e.authFp === fpB)), signs.map((e) => [e.site, e.authFp === fpA, e.authFp === fpB]));
      check('G2.3 the environment-context credential and site never appear', fake.log.every((e) => e.authFp !== fpC && e.site !== 'site-C-synthetic'));
      const blobs = fake.log.filter((e) => e.stage === 'blob');
      check('G2.4 no blob (signed-URL) request carries any Authorization header', blobs.length > 0 && blobs.every((e) => !e.hasAuth), blobs.map((e) => e.hasAuth));
      check('G2.5 each blob request used a URL issued by a sign request of the same client and site', blobs.every((e) => e.signedOk && ((e.site === SITE_A && e.issuerAuthFp === fpA) || (e.site === SITE_B && e.issuerAuthFp === fpB))));
      check('G2.6 both clients wrote their own scope only', stateOf(s1) === 'ADMITTED' && fake.store.has(`${SITE_B}|${STORE}|${M.authorityKey(s2)}`)); }

    // ======================== F6 / F9: global transport invariants ===
    check('F6 no DELETE and no unconditional PUT was ever sent', fake.violations.length === 0, fake.violations);
  } catch (e) {
    console.error(e);
    failures += 1;
  } finally {
    await fake.close(); await edge.close();
    fs.rmSync(TMP, { recursive: true, force: true });
  }
  if (checks < FLOOR) { failures += 1; console.error(`FLOOR  only ${checks} checks ran (floor ${FLOOR})`); }
  console.log(`\nB1 blob authority: ${checks - failures}/${checks} checks passed${failures ? ` (failures=${failures})` : ''}`);
  process.exit(failures ? 1 : 0);
}
main();
