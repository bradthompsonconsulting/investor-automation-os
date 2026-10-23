/**
 * B15-26 B1 whole-save deadline (proposal r3 + r4 + erratum 1) -- offline checks CL1-CL10, DL1-DL15.
 *
 * REAL pieces: the pinned @netlify/blobs 11.1.0 (hash asserted; edge mode via the real connectLambda for the
 * recorded claim, API mode for the authority client), write-receipts.ts (claimWriteRecorded AND claimWrite),
 * blob-authority.ts, repair-approval-save.ts. NODE_ENV is NOT "test", so the SDK's retry delay is its
 * production 5 s: a retry the recorder failed to suppress would show as a >= 1 s timer.
 * FAKE pieces: one loopback HTTP server standing in for the Blobs edge, the Netlify Blobs API + signed URLs,
 * and GHL; every https origin is routed to it and anything else is refused. Credentials are synthetic.
 *
 * Two clocks. VIRTUAL (V): the real provisional numbers, with Date.now advanced by the fake server's scripted
 * latency -- floors, reserves and send gates without waiting. REAL (R): every number scaled down 100x and real
 * latencies, so aborts, hung headers and hung bodies are genuine (undici fetch, real AbortController).
 * Shows OUR behaviour against fakes only; nothing here proves Netlify, GHL or deployed-runtime behaviour.
 */
'use strict';
delete process.env.NODE_ENV; // production SDK retry delay (5 s) -- set before the SDK loads
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const APP = path.resolve(__dirname, '..');
/** Literal count of check() executions below (loops expanded by hand); never back-filled from a run. */
const FLOOR = 55;
let checks = 0; let failures = 0;
function check(name, ok, detail) {
  checks += 1; if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}
const within = (ms, p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`check timed out after ${ms} ms`)), ms))]);

// ------------------------------------------------------------ timer spy ---
// Records every timer created from OUR sources (handler, integration lib, receipts, module) and the SDK.
const OURS = /(blob-authority|write-receipts|repair-approval-integration|repair-approval-save)\.ts/;
const SDK = /@netlify[\\/+]blobs/;
const realSetTimeout = global.setTimeout; const realClearTimeout = global.clearTimeout;
const timers = new Map(); let timerSeq = 0;
global.setTimeout = function (fn, ms, ...a) {
  // Classified by the frame that called setTimeout (async stacks also list awaiting callers, so the whole stack is not used).
  const top = (new Error().stack || '').split(String.fromCharCode(10))[2] || '';
  const rec = { id: ++timerSeq, ms: Number(ms) || 0, ours: OURS.test(top), sdk: SDK.test(top), top, cleared: false, fired: false };
  const h = realSetTimeout(function (...x) { rec.fired = true; return fn.apply(this, x); }, ms, ...a);
  timers.set(h, rec); return h;
};
global.clearTimeout = function (h) { const r = timers.get(h); if (r) r.cleared = true; return realClearTimeout(h); };
const timerMark = () => timerSeq;
const timersSince = (m) => [...timers.values()].filter((r) => r.id > m);
const liveOurs = (m) => timersSince(m).filter((r) => r.ours && !r.cleared && !r.fired);
const sdkSleeps = (m) => timersSince(m).filter((r) => r.sdk && r.ms >= 1000);

// --------------------------------------------------------------- loader ---
const appRequire = Module.createRequire(path.join(APP, 'package.json'));
const SDK_MAIN = appRequire.resolve('@netlify/blobs').replace(/main\.js$/, 'main.cjs');
const SDK_SHA = crypto.createHash('sha256').update(fs.readFileSync(fs.existsSync(SDK_MAIN) ? SDK_MAIN : appRequire.resolve('@netlify/blobs'))).digest('hex');
const realBlobs = appRequire('@netlify/blobs');
const realCfg = (() => { const m = { exports: {} }; const src = ts.transpileModule(fs.readFileSync(path.join(APP, 'shared', 'repair-approval-config.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText; new Function('module', 'exports', 'require', src)(m, m.exports, require); return m.exports; })();
const APPROVAL_FIELD = 'fldApprovalSynthetic01';
const REAL_D = realCfg.REPAIR_APPROVAL_CONFIG.saveDeadline;
const scale = (o, f) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? Math.max(1, Math.round(v * f)) : scale(v, f)]));
const SCALED_D = Object.freeze({ ...scale(REAL_D, 0.01), minStartMs: 3 });
const base = { ...realCfg.REPAIR_APPROVAL_CONFIG, enabled: true, approvalFieldId: Object.freeze({ test: APPROVAL_FIELD, production: realCfg.REPAIR_APPROVAL_FIELD_NOT_PROVISIONED }) };
let currentCfg = { ...base, verifyPassDelayMs: 30, saveDeadline: REAL_D };
const cfgShim = {
  get REPAIR_APPROVAL_CONFIG() { return currentCfg; },
  REPAIR_APPROVAL_FIELD_NOT_PROVISIONED: realCfg.REPAIR_APPROVAL_FIELD_NOT_PROVISIONED,
  REPAIR_APPROVAL_DISABLED: realCfg.REPAIR_APPROVAL_DISABLED,
  repairApprovalActiveFor: (env, config) => realCfg.repairApprovalActiveFor(env, config === undefined ? currentCfg : config),
};
const useV = (over = {}, verifyPassDelayMs = 30) => { currentCfg = { ...base, verifyPassDelayMs, saveDeadline: { ...REAL_D, ...over, floorsMs: { ...REAL_D.floorsMs, ...(over.floorsMs || {}) } } }; };
const useR = () => { currentCfg = { ...base, verifyPassDelayMs: 15, saveDeadline: SCALED_D }; };
const originalResolve = Module._resolveFilename; const originalLoad = Module._load;
Module._resolveFilename = function (name, parent, ...rest) {
  if (name.startsWith('.') && parent) for (const ext of ['.ts', '.tsx']) { const c = path.resolve(path.dirname(parent.filename), name + ext); if (fs.existsSync(c)) return c; }
  return originalResolve.call(this, name, parent, ...rest);
};
for (const ext of ['.ts', '.tsx']) Module._extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, resolveJsonModule: true, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
Module._load = function (name, parent, ...rest) { if (/repair-approval-config$/.test(name)) return cfgShim; return originalLoad.call(this, name, parent, ...rest); };

// ---------------------------------------------------------- environment ---
const ORIGIN = 'https://iaos-app-test.example';
Object.assign(process.env, {
  IAOS_ENV: 'test',
  IAOS_APP_WRITE_GOOGLE_CLIENT_ID: 'offline-client', IAOS_APP_WRITE_BRAD_EMAILS: 'operator@example.invalid',
  IAOS_APP_WRITE_SESSION_SECRET: 'offline-write-secret-not-real-0123456789', IAOS_APP_WRITE_ALLOWED_ORIGIN: ORIGIN,
  GHL_PRIVATE_API_KEY: 'ghl-synthetic-offline-key', IAOS_REPAIR_AUTHORITY_SITE_ID: 'site-synthetic-repair-approval', IAOS_REPAIR_AUTHORITY_TOKEN: 'netlify-synthetic-offline-token',
});
const OPERATOR = 'operator@example.invalid';
const EDGE = 'https://edge.example.invalid'; const EDGE_SITE = 'edge-site'; const SIGNED = 'https://signed.example.invalid';
let vOffset = 0; const realNow = Date.now; Date.now = () => realNow() + vOffset;

// ----------------------------------------------------------------- fake ---
/** Rule: { cls, method?, kind?, nth?, body?(regex), status?, etag?:false, v?(virtual ms), delay?(real ms), hang?:'headers'|'body', hide? } */
function fakeServer() {
  const edge = new Map(); const signed = new Map(); const blobs = new Map(); const opps = new Map(); const notes = new Map();
  const log = []; let rules = []; const nth = {}; let etagN = 0; let noteN = 0; const hung = [];
  const api = { edge, blobs, opps, notes, log, hung, rule(...r) { rules.push(...r); }, reset() { rules = []; for (const k of Object.keys(nth)) delete nth[k]; log.length = 0; } };
  const server = http.createServer((req, res) => {
    const c = []; req.on('data', (x) => c.push(x));
    req.on('end', async () => {
      const raw = Buffer.concat(c).toString('utf8'); const url = new URL(req.url, 'http://x'); const m = req.method; const p = url.pathname.split('/').filter(Boolean);
      const cls = req.headers['x-fake-origin'];
      const kind = cls === 'ghl' ? (p[0] === 'opportunities' ? (m === 'GET' ? 'oppGet' : 'oppPut') : p.length === 2 ? 'contactGet' : p[2] === 'notes' && p.length === 3 ? 'notePost' : 'noteGet') : cls;
      const k = `${cls}:${kind}:${m}`; nth[k] = (nth[k] || 0) + 1;
      const rule = rules.find((r) => r.cls === cls && (r.method === undefined || r.method === m) && (r.kind === undefined || r.kind === kind) && (r.nth === undefined || r.nth === nth[k]) && (r.body === undefined || r.body.test(raw)));
      if (rule && !rule.always) rules = rules.filter((x) => x !== rule);
      log.push({ cls, kind, method: m, body: raw, rule: rule || null });
      if (rule && rule.v) vOffset += rule.v;
      if (rule && rule.delay) await new Promise((r) => realSetTimeout(r, rule.delay));
      if (rule && rule.hang === 'headers') { hung.push(res); return; }
      const send = (status, headers, body) => {
        if (rule && rule.hang === 'body') { res.writeHead(status, { ...headers, 'content-length': String(Buffer.byteLength(body || '') + 64) }); res.write((body || '').slice(0, 1)); hung.push(res); return; }
        res.writeHead(status, headers); res.end(body || '');
      };
      const st = (dflt) => (rule && rule.status ? rule.status : dflt);
      const tag = () => (rule && rule.etag === false ? {} : { etag: `"e${++etagN}"` });
      if (cls === 'edge') {
        if (rule && rule.status) return send(rule.status, {}, '');
        if (m === 'PUT') { if (req.headers['if-none-match'] === '*' && edge.has(url.pathname)) return send(412, {}, ''); edge.set(url.pathname, raw); return send(200, tag(), ''); }
        return send(405, {}, '');
      }
      if (cls === 'api') {
        if (rule && rule.status) return send(rule.status, {}, '{}');
        const key = decodeURIComponent(url.pathname.slice('/api/v1/blobs/'.length)).split('/').slice(2).join('/');
        const id = crypto.randomUUID(); signed.set(id, { key, method: m });
        return send(200, { 'content-type': 'application/json' }, JSON.stringify({ url: `${SIGNED}/signed/${id}` }));
      }
      if (cls === 'signed') {
        const sg = signed.get(url.pathname.replace('/signed/', '')); if (!sg || sg.method !== m) return send(403, {}, '');
        if (rule && rule.status) return send(rule.status, {}, '');
        const cur = blobs.get(sg.key);
        if (m === 'GET') return cur ? send(200, { etag: cur.etag }, cur.text) : send(404, {}, '');
        const inm = req.headers['if-none-match']; const im = req.headers['if-match'];
        if ((inm === '*' && cur) || (im && (!cur || cur.etag !== im)) || (!inm && !im)) return send(412, {}, '');
        const t = tag(); blobs.set(sg.key, { text: raw, etag: t.etag || `"e${++etagN}"` }); return send(200, t, '');
      }
      // ghl
      let body = null; try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
      const j = (s, o) => send(st(s), { 'content-type': 'application/json' }, JSON.stringify(o));
      if (kind === 'contactGet') { const o = [...opps.values()].find((x) => x.contactId === p[1]); return o ? j(200, { contact: { id: p[1], locationId: o.locationId, customFields: [] } }) : j(404, {}); }
      if (kind === 'oppGet') { const o = opps.get(p[1]); return o ? j(200, { opportunity: JSON.parse(JSON.stringify(o)) }) : j(404, {}); }
      if (kind === 'oppPut') { const o = opps.get(p[1]); if (o && body && Array.isArray(body.customFields) && !(rule && rule.status)) for (const f of body.customFields) o.customFields = o.customFields.filter((e) => e.id !== f.id).concat([{ id: f.id, fieldValue: f.field_value }]); return j(200, { opportunity: o }); }
      if (kind === 'notePost') { const note = { id: `note${++noteN}x`, body: body && body.body, contactId: p[1] }; if (!(rule && rule.status)) { if (!notes.has(p[1])) notes.set(p[1], []); notes.get(p[1]).push(note); } return j(201, { note }); }
      if (kind === 'noteGet') { if (rule && rule.hide) return j(404, {}); for (const [, list] of notes) { const x = list.find((e) => e.id === p[3]); if (x) return j(200, { note: x }); } return j(404, {}); }
      return j(404, {});
    });
  });
  api.ready = new Promise((r) => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`)));
  api.close = () => { for (const h of hung) { try { h.destroy(); } catch { /* gone */ } } server.closeAllConnections(); return new Promise((q) => server.close(q)); };
  return api;
}

async function main() {
  const fake = fakeServer(); const LOOP = await fake.ready;
  const realFetch = globalThis.fetch; const starts = []; const blocked = [];
  const CLASS = { [EDGE]: 'edge', 'https://api.netlify.com': 'api', [SIGNED]: 'signed', 'https://services.leadconnectorhq.com': 'ghl' };
  globalThis.fetch = (url, init = {}) => {
    const u = new URL(String(url)); const cls = CLASS[u.origin];
    if (!cls) { blocked.push(u.origin); return Promise.reject(new Error('offline guard: blocked ' + u.origin)); }
    starts.push({ cls, method: String(init.method || 'GET').toUpperCase(), t: Date.now(), accept: new Headers(init.headers).get('accept') });
    return realFetch(LOOP + u.pathname + u.search, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), 'x-fake-origin': cls } });
  };

  const R = require('../netlify/functions/lib/write-receipts.ts');
  const BA = require('../netlify/functions/lib/blob-authority.ts');
  const INT = require('../netlify/functions/lib/repair-approval-integration.ts');
  const { configuredBoundary } = require('../netlify/functions/lib/ghl-write-boundary.ts');
  const saveHandler = require('../netlify/functions/repair-approval-save.ts').handler;
  const { issueAppSession } = require('../netlify/functions/lib/app-write-auth.ts');
  const { getConfig } = require('../shared/ghl-config.ts');
  const EV = require('../netlify/functions/lib/repair-evidence.ts');
  const OM = require('../src/lib/repair-estimation/operator-model.ts');
  const config = getConfig('test'); const LOC = config.locationId; const F_EST = config.opportunityFacts.repairs;
  const lambdaEvent = { blobs: Buffer.from(JSON.stringify({ url: EDGE, token: 'edge-synthetic-token' })).toString('base64'), headers: { 'x-nf-site-id': EDGE_SITE, 'x-nf-deploy-id': 'deploy-synthetic' } };
  realBlobs.connectLambda(lambdaEvent);

  const complete = () => { const a = {}; OM.OPERATOR_ROWS.forEach((row, i) => { a[row.system] = OM.applyCondition(row, i < 2 ? 'repair' : 'good', OM.EMPTY_ANSWER); }); return a; };
  let n = 0;
  const fixture = () => { n += 1; const opp = `oppDl${String(n).padStart(3, '0')}`; const contact = `contactDl${String(n).padStart(3, '0')}`; fake.opps.set(opp, { id: opp, locationId: LOC, contactId: contact, pipelineId: config.pipelines.sellerLeads, customFields: [] }); return { opp, contact, scope: `repair-approval:test:${LOC}:${opp}` }; };
  const saveEvent = (fx, requestId = crypto.randomUUID()) => ({ httpMethod: 'POST', isBase64Encoded: false, queryStringParameters: {}, blobs: lambdaEvent.blobs,
    headers: { authorization: `Bearer ${issueAppSession(OPERATOR).token}`, origin: ORIGIN, ...lambdaEvent.headers }, body: JSON.stringify({ opportunityId: fx.opp, requestId, answers: complete(), misc: { description: '', amount: '' } }) });
  const ctx = (ms) => ({ getRemainingTimeInMillis: () => ms });
  const parse = (r) => { try { return JSON.parse(r.body); } catch { return null; } };
  const mark = () => ({ s: starts.length, l: fake.log.length, t: timerMark() });
  const since = (m) => starts.slice(m.s);
  const cls = (m, c, method) => since(m).filter((x) => x.cls === c && (method === undefined || x.method === method));
  const provider = (m) => since(m).filter((x) => x.cls !== 'edge');
  const authorityState = (fx) => { const v = fake.blobs.get(BA.authorityKey(fx.scope)); return v ? JSON.parse(v.text).state : null; };
  const run = async (fx, remaining, requestId) => { const t0 = Date.now(); const r = await saveHandler(saveEvent(fx, requestId), ctx(remaining)); return { r, b: parse(r), t0, t1: Date.now() }; };
  const flush = (ms = 250) => new Promise((r) => realSetTimeout(r, ms));
  // 1 s cap: headroom for a cold first request; the hang checks pass their own small caps.
  const claimOpts = (o = {}) => ({ deadline: Date.now() + 10_000, capMs: 1_000, minStartMs: 3, ...o });
  const claim = (o) => R.claimWriteRecorded('op:repair.approval:opp', crypto.randomUUID(), { a: 1 }, claimOpts(o));

  try {
    // ======================================================= CL: recorded claim (real SDK + real helper) ===
    check('CL0 the pinned SDK is @netlify/blobs 11.1.0 main.cjs 24ddd49a… (any other version fails this suite)', SDK_SHA === '24ddd49a4768546302122ba2360c8dba3137fae2158d8c93c2102c8bfcd465e5', SDK_SHA);
    for (const s of [200, 201]) { fake.reset(); const m = mark(); fake.rule({ cls: 'edge', status: s }); const r = await claim();
      check(`CL1 edge ${s} -> claimed with exactly 1 request`, r.kind === 'claimed' && cls(m, 'edge').length === 1, [r, cls(m, 'edge').length]); }
    { fake.reset(); const m = mark(); fake.rule({ cls: 'edge', status: 412 }); const r = await claim(); check('CL2 edge 412 -> duplicate with exactly 1 request', r.kind === 'duplicate' && cls(m, 'edge').length === 1, r); }
    for (const s of [400, 401, 403, 404]) {
      fake.reset(); fake.rule({ cls: 'edge', status: s }); const sdkSays = await realBlobs.getStore({ name: 'iaos-write-receipts', fetch: globalThis.fetch }).setJSON(`probe-${s}`, { x: 1 }, { onlyIfNew: true });
      fake.rule({ cls: 'edge', status: s }); const m = mark(); const r = await claim();
      check(`CL3 edge ${s}: the SDK alone reports modified:true, yet the helper says unavailable (status_${s}), 1 request`, sdkSays.modified === true && r.kind === 'unavailable' && r.reason === `status_${s}` && cls(m, 'edge').length === 1, [sdkSays, r]);
    }
    for (const s of [429, 500, 503]) { fake.reset(); fake.rule({ cls: 'edge', status: s, always: true }); const m = mark(); const r = await claim(); fake.reset();
      check(`CL4 edge ${s} on every attempt -> unavailable, exactly 1 real request, 0 SDK retry sleeps (production delay)`, r.kind === 'unavailable' && cls(m, 'edge').length === 1 && sdkSleeps(m.t).length === 0, [r, cls(m, 'edge').length, sdkSleeps(m.t).length]); }
    { // CL5: a thrown request (connection refused by the guard) and an abort
      const saved = globalThis.fetch; let calls = 0;
      globalThis.fetch = () => { calls += 1; return Promise.reject(new TypeError('fetch failed')); };
      const m1 = timerMark(); const r1 = await claim(); const c1 = calls;
      calls = 0; globalThis.fetch = (u, i) => { calls += 1; return new Promise((_, rej) => i.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))); };
      const m2 = timerMark(); const r2 = await claim({ capMs: 20 }); const c2 = calls; globalThis.fetch = saved;
      check('CL5 thrown -> unavailable(threw); aborted -> unavailable(aborted); 1 request each, no retry, no SDK sleep', r1.kind === 'unavailable' && r1.reason === 'threw' && r2.reason === 'aborted' && c1 === 1 && c2 === 1 && sdkSleeps(m1).length === 0 && sdkSleeps(m2).length === 0, [r1, r2, c1, c2]);
    }
    { fake.reset(); fake.rule({ cls: 'edge', hang: 'headers' }); const m = mark(); const t = realNow(); const r = await within(2000, claim({ capMs: 40 })); const el = realNow() - t;
      check('CL6a hung headers -> aborted at the cap (40 ms) -> unavailable(aborted); no live timer from our code', r.kind === 'unavailable' && r.reason === 'aborted' && el < 400 && liveOurs(m.t).length === 0, [r, el]);
      fake.reset(); fake.rule({ cls: 'edge', status: 200, hang: 'body' }); const m2 = mark(); const r2 = await within(2000, claim({ capMs: 40 }));
      // Not a body-settlement test: the SDK decides a conditional setJSON from status and ETag and does not read the body.
      check('CL6b 200 headers then a hung body -> claimed (the status was recorded at the headers); no live timer', r2.kind === 'claimed' && liveOurs(m2.t).length === 0, r2); }
    { fake.reset(); const m = mark(); const r = await claim({ deadline: Date.now() + 500, capMs: 1_000 });
      check('CL7 deadline closer than the cap -> 0 requests, unavailable(deadline)', r.kind === 'unavailable' && r.reason === 'deadline' && cls(m, 'edge').length === 0, r); }
    useV();
    { fake.reset(); const fx = fixture(); fake.rule({ cls: 'edge', status: 500 }); const m = mark(); const { r, b } = await run(fx, 60_000);
      check('CL8a handler: claim unavailable -> 503 not_sent claim_unavailable; 0 Opportunity, 0 authority, 0 GHL requests', r.statusCode === 503 && b.code === 'claim_unavailable' && b.outcome === 'not_sent' && provider(m).length === 0, [r.statusCode, b, provider(m).length]);
      const id = crypto.randomUUID(); await run(fx, 60_000, id); const m2 = mark(); const again = await run(fx, 60_000, id);
      check('CL8b handler: the same request id again -> 409 not_sent duplicate_request; 0 provider requests', again.r.statusCode === 409 && again.b.code === 'duplicate_request' && provider(m2).length === 0, [again.r.statusCode, again.b]); }
    { // CL9: claimWrite and claimWriteRecorded store the same receipt. The record carries claimedAt, so the comparison is
      // made under ONE frozen clock (Bones); the clock is restored in `finally` and the restoration is checked.
      const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
      const scope = 'operator@example.invalid:repair.approval:oppFrozen';
      const payloads = [{ opportunityId: 'oppFrozen', basisDigest: 'd'.repeat(64) }, { a: 1, nested: { b: [1, 2] } }];
      // One receipt per helper: the key (edge path) and the exact stored bytes, from a clean fake each time.
      const receipt = async (fn) => { fake.reset(); fake.edge.clear(); const out = await fn(); const body = fake.log.filter((x) => x.cls === 'edge').map((x) => x.body); return { out, body, keys: [...fake.edge.keys()] }; };
      const viaClaimWrite = (id, p) => receipt(async () => { try { await R.claimWrite(scope, id, p); return 'resolved'; } catch { return 'threw'; } });
      const viaRecorded = (id, p, now) => receipt(() => R.claimWriteRecorded(scope, id, p, { deadline: now() + 10_000, capMs: 1_000, minStartMs: 3, now }));
      const RealDate = Date; const savedNow = Date.now; const FIXED = RealDate.UTC(2026, 9, 23, 12, 0, 0);
      const rows = [];
      try {
        global.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [FIXED])); } static now() { return FIXED; } };
        for (const [i, p] of payloads.entries()) {
          const id = `frozen-request-${i}`;
          const a = await viaClaimWrite(id, p); const b = await viaRecorded(id, p, () => FIXED);
          // The pinned SDK namespaces a site-scoped store as `site:<name>` in the edge path.
          const expectKey = `/${EDGE_SITE}/site:iaos-write-receipts/${sha(`test:${scope}:${id}`)}`;
          const expectBody = JSON.stringify({ fingerprint: sha(JSON.stringify(p)), claimedAt: new RealDate(FIXED).toISOString() });
          rows.push({ i, key: a.keys[0], expectKey, claimWrite: a.out, recorded: b.out.kind, sameKey: a.keys.length === 1 && a.keys[0] === b.keys[0], keyIsDerived: a.keys[0] === expectKey,
            sameBytes: a.body.length === 1 && b.body.length === 1 && a.body[0] === b.body[0], bodyIsDerived: a.body[0] === expectBody });
        }
      } finally {
        global.Date = RealDate; Date.now = savedNow;
      }
      check('CL9a frozen clock, 2 payloads: claimWriteRecorded stores exactly the key and the bytes claimWrite stores, and both equal the independent derivation (sha256 of env:scope:requestId; { fingerprint, claimedAt })',
        rows.length === 2 && rows.every((r) => r.claimWrite === 'resolved' && r.recorded === 'claimed' && r.sameKey && r.keyIsDerived && r.sameBytes && r.bodyIsDerived), rows);
      check('CL9b the clock is restored afterwards: Date is the real constructor and Date.now advances again', global.Date === RealDate && Date.now === savedNow && new Date().getTime() !== FIXED && Date.now() >= realNow());
      // Control: without the frozen clock the two receipts differ ONLY in claimedAt, so CL9a's byte equality is not vacuous.
      const id = 'unfrozen-request'; const a = await viaClaimWrite(id, payloads[0]); await new Promise((q) => realSetTimeout(q, 15)); const b = await viaRecorded(id, payloads[0], Date.now);
      const ja = JSON.parse(a.body[0]); const jb = JSON.parse(b.body[0]);
      check('CL9c control (unfrozen, 15 ms apart): same key and fingerprint, different claimedAt -> the bytes differ', a.keys[0] === b.keys[0] && ja.fingerprint === jb.fingerprint && ja.claimedAt !== jb.claimedAt && a.body[0] !== b.body[0], [ja.claimedAt, jb.claimedAt]);
    }
    { // CL10: after every helper return, nothing further happens
      fake.reset(); const m = mark(); fake.rule({ cls: 'edge', status: 503 }); await claim(); fake.rule({ cls: 'edge', hang: 'headers' }); await within(2000, claim({ capMs: 30 })); await claim({ deadline: Date.now() + 50 });
      const after = starts.length; await flush(300);
      check('CL10 after the helper returns (503, hung, refused): 0 further fetch calls, 0 live timers from our code', starts.length === after && liveOurs(m.t).length === 0, [starts.length - after, liveOurs(m.t).length]);
    }

    // ============================================================= DL: handler + module ===
    { const v = [undefined, null, {}, { getRemainingTimeInMillis: 5 }, { getRemainingTimeInMillis: () => NaN }, { getRemainingTimeInMillis: () => -1 }, { getRemainingTimeInMillis: () => '60000' }, { getRemainingTimeInMillis: () => { throw new Error('x'); } }];
      check('DL1a remainingRuntimeMs: only a callable finite non-negative number is accepted', v.every((c) => INT.remainingRuntimeMs(c) === null) && INT.remainingRuntimeMs(ctx(59998)) === 59998 && INT.remainingRuntimeMs(ctx(0)) === 0);
      check('DL1b saveDeadline = start + min(50 000, remaining - 5 000): observed 59 998 -> 50 000; 40 000 -> 35 000', INT.saveDeadline(1000, 59998, REAL_D) === 51000 && INT.saveDeadline(1000, 40000, REAL_D) === 36000);
      useV(); fake.reset(); const fx = fixture(); const m = mark(); const outs = [];
      for (const c of v) outs.push(await saveHandler(saveEvent(fx), c));
      check('DL1c handler: missing / invalid / throwing runtime budget -> 503 runtime_budget_unavailable before ANY request (claim included)', outs.every((r) => r.statusCode === 503 && parse(r).code === 'runtime_budget_unavailable') && since(m).length === 0, [outs.map((r) => parse(r).code), since(m).length]);
      const m2 = mark(); const low = await run(fx, 40_000);
      check('DL1d handler: an insufficient budget (35 s < the 44 s claim floor) -> 503 deadline_before_start, 0 requests', low.r.statusCode === 503 && low.b.code === 'deadline_before_start' && since(m2).length === 0, low.b); }
    console.log('NOTE  DL2 was replaced by CL1-CL10 in r4');
    { // DL3: existing callers keep their behaviour -- the shared defect is preserved here on purpose (separate remediation)
      const rows = [];
      for (const [label, fn] of [['claimWrite', () => R.claimWrite('op:x:t', crypto.randomUUID(), { a: 1 })], ['lockContact', () => R.lockContact(`c-${crypto.randomUUID()}`)], ['claimStageTransition', () => R.claimStageTransition(`o-${crypto.randomUUID()}`, 'req', 'op')]]) {
        for (const s of [200, 400, 412]) { fake.reset(); fake.rule({ cls: 'edge', status: s }); let out; try { out = await fn(); out = 'resolved'; } catch (e) { out = 'threw'; } rows.push(`${label}:${s}:${out}`); }
      }
      const want = ['claimWrite:200:resolved', 'claimWrite:400:resolved', 'claimWrite:412:threw', 'lockContact:200:resolved', 'lockContact:400:resolved', 'lockContact:412:threw', 'claimStageTransition:200:resolved', 'claimStageTransition:400:resolved', 'claimStageTransition:412:threw'];
      check('DL3a claimWrite / lockContact / claimStageTransition unchanged (incl. the known 400-as-success defect; separate remediation)', JSON.stringify(rows) === JSON.stringify(want), rows);
      check('DL3b configuredBoundary() without a fetcher keeps the global fetch (every existing caller)', configuredBoundary().fetcher === globalThis.fetch && configuredBoundary(undefined, undefined).fetcher === globalThis.fetch); }
    useR();
    { fake.reset(); const fx = fixture(); fake.rule({ cls: 'ghl', kind: 'oppGet', hang: 'body' }); const m = mark(); const t = realNow(); const { r, b } = await within(3000, run(fx, 600)); const el = realNow() - t;
      check('DL4 Opportunity body hangs -> aborted at its 50 ms cap; 503 could_not_start; 0 authority requests; no live timer', r.statusCode === 503 && b.code === 'could_not_start' && cls(m, 'api').length === 0 && el < 600 && liveOurs(m.t).length === 0, [b, el]); }
    useV({ floorsMs: { admission: 52_000 } });
    { fake.reset(); const fx = fixture(); const m = mark(); const { r, b } = await run(fx, 60_000);
      check('DL5 admission floor not met (floor raised above the budget) -> 503 deadline_before_admission; 0 authority requests', r.statusCode === 503 && b.code === 'deadline_before_admission' && cls(m, 'api').length === 0 && cls(m, 'signed').length === 0, b); }
    { // DL6 module M1 directly (virtual clock via the client's own clock)
      let t = 1_000_000; const now = () => t;
      const mk = (deadline) => BA.createAuthorityClient({ siteID: 's', token: 'k', timeoutMs: 5000, now, deadline, minStartMs: 250 });
      fake.reset(); const m = mark(); const ra = await BA.readAuthority(mk(t + 100), 'scope-dl6');
      check('DL6a a read with less than minStartMs before its limit is not sent (0 requests) -> unreadable', ra.kind === 'unreadable' && since(m).length === 0, ra);
      const intent = { operator: OPERATOR, opportunityId: 'o', contactId: 'c', preconditionDigest: 'a'.repeat(64), expectedResultHash: 'b'.repeat(64) };
      fake.reset(); const m2 = mark(); const o1 = await BA.openAdmission(mk(t + 9_000), 'scope-dl6b', intent);
      check('DL6b open with 9 s left (< read limit 0.25 s + CAS cap 10 s): the read is not sent and nothing is written -> unreadable, 0 requests', o1.kind === 'unreadable' && since(m2).length === 0, o1);
      // This client's clock follows the virtual latency the fake adds: the read takes 1.2 s, leaving 9.8 s < the 10 s CAS cap.
      fake.reset(); fake.rule({ cls: 'signed', method: 'GET', v: 1_200 }); const vstart = vOffset;
      const c2 = BA.createAuthorityClient({ siteID: 's', token: 'k', timeoutMs: 5000, now: () => t + (vOffset - vstart), deadline: t + 11_000, minStartMs: 250 });
      const m3 = mark(); const o2 = await BA.openAdmission(c2, 'scope-dl6c', intent);
      check('DL6c read sent (1 s left before its limit), then 9.8 s left < the 10 s CAS cap: the CAS is NOT sent -> not_sent, never ambiguous', o2.kind === 'not_sent' && cls(m3, 'signed', 'GET').length === 1 && cls(m3, 'api', 'PUT').length === 0 && cls(m3, 'signed', 'PUT').length === 0, o2); }
    useV();
    { // DL7: a slow open + D1 -> the note POST gate fails -> HALTED_NOT_SENT -> the accepted release, with its reserve
      fake.reset(); const fx = fixture(); fake.rule({ cls: 'signed', method: 'GET', nth: 1, v: 9_000 }, { cls: 'signed', method: 'PUT', nth: 1, v: 9_000 }, { cls: 'signed', method: 'GET', nth: 2, v: 10_000 });
      const m = mark(); const { r, b } = await run(fx, 60_000);
      check('DL7a slow open (18 s) + D1 (10 s) -> POST gate (28 s) fails: 0 POSTs; release runs and commits -> 503 note_not_sent; authority IDLE', r.statusCode === 503 && b.code === 'note_not_sent' && cls(m, 'ghl', 'POST').length === 0 && authorityState(fx) === 'IDLE', [b, authorityState(fx)]);
      fake.reset(); const fx2 = fixture(); fake.rule({ cls: 'signed', method: 'GET', nth: 2, v: 40_000 }); const m2 = mark(); const x = await run(fx2, 60_000);
      check('DL7b simulated overrun leaves < 10.25 s: the release read is not sent -> blocked release_unreadable; authority stays ADMITTED; 0 POSTs', x.r.statusCode === 409 && x.b.code === 'release_unreadable' && authorityState(fx2) === 'ADMITTED' && cls(m2, 'ghl', 'POST').length === 0, [x.b, authorityState(fx2)]);
      fake.reset(); const fx3 = fixture(); fake.rule({ cls: 'signed', method: 'GET', nth: 2, v: 39_000 }, { cls: 'signed', method: 'GET', nth: 3, v: 1_500 }); const m3 = mark(); const y = await run(fx3, 60_000);
      check('DL7c release read sent, then < 10 s left: the release CAS is not sent -> blocked release_not_sent; ADMITTED; 0 POSTs', y.r.statusCode === 409 && y.b.code === 'release_not_sent' && authorityState(fx3) === 'ADMITTED' && cls(m3, 'ghl', 'POST').length === 0 && cls(m3, 'signed', 'PUT').length === 1, [y.b, cls(m3, 'signed', 'PUT').length]); }
    useR();
    { // DL7d (module, virtual clock): the note's D1 read cannot use the release reserve. With 15 s left, its first
      // abort timer is min(5 s cap, deadline - 12 s reserve - now) = 3 s; a D1 limited only by the deadline would get 5 s.
      const tag = (url) => String(url).replace(LOOP, 'https://api.netlify.com');
      const ghlTag = (url) => String(url).replace(LOOP, 'https://services.leadconnectorhq.com');
      let t = 2_000_000; const v0 = vOffset; const now = () => t + (vOffset - v0);
      const client = BA.createAuthorityClient({ siteID: 's', token: 'k', apiURL: LOOP, fetch: (u, i) => globalThis.fetch(tag(u), i), timeoutMs: 5_000, now, deadline: t + 15_000, minStartMs: 250, releaseReserveMs: 12_000, closeReserveMs: 12_000, sendFloorsMs: { note: 28_000, fields: 22_000 } });
      const transport = BA.createFakeTargetTransport({ fetch: (u, i) => globalThis.fetch(ghlTag(u), i), origin: LOOP, fieldIds: { repairEstimate: F_EST, repairApprovalId: APPROVAL_FIELD }, timeoutMs: 8_000, readTimeoutMs: 5_000 });
      const payload = EV.validatePayload({ opportunityId: 'oppDl7d', contactId: 'contactDl7d', operator: OPERATOR, total: 5000, complete: true, lineCount: 1, basisDigest: 'c'.repeat(64) });
      fake.reset(); const open = await BA.openAdmission(client, 'scope-dl7d', { operator: OPERATOR, opportunityId: 'oppDl7d', contactId: 'contactDl7d', preconditionDigest: 'a'.repeat(64), expectedResultHash: EV.payloadDigest(payload) });
      const tm = timerMark(); const m = mark(); const note = await BA.dispatchNote(open.admission, transport, payload);
      const d1 = timersSince(tm).filter((r) => /blob-authority/.test(r.top)).map((r) => r.ms);
      check('DL7d the note D1 read is clamped to deadline - release reserve (first timer 3 000 ms, not the 5 000 ms cap); then the POST gate refuses: not_sent, 0 POSTs', open.kind === 'committed' && d1[0] === 3_000 && note.kind === 'not_sent' && cls(m, 'ghl', 'POST').length === 0, [open.kind, d1, note]); }
    { // DL8: M2 -- bodies that are actually consumed, with real aborts
      const cOpts = () => ({ siteID: 's', token: 'k', timeoutMs: 50, deadline: Date.now() + 2_000, minStartMs: 3 });
      fake.blobs.set(BA.authorityKey('scope-dl8'), { text: '{}', etag: '"e0"' });
      fake.reset(); fake.rule({ cls: 'signed', method: 'GET', hang: 'body' }); const m = mark(); const t = realNow(); const ra = await within(2000, BA.readAuthority(BA.createAuthorityClient(cOpts()), 'scope-dl8')); const el = realNow() - t;
      check('DL8a strong read: 200 headers then a hung body -> aborted at the 50 ms cap -> unreadable; no live timer', ra.kind === 'unreadable' && el < 500 && liveOurs(m.t).length === 0, [ra, el]);
      const intent = { operator: OPERATOR, opportunityId: 'o', contactId: 'c', preconditionDigest: 'a'.repeat(64), expectedResultHash: 'b'.repeat(64) };
      fake.reset(); fake.rule({ cls: 'signed', method: 'PUT', hang: 'body' }); const o1 = await within(2000, BA.openAdmission(BA.createAuthorityClient(cOpts()), 'scope-dl8b', intent));
      check('DL8b CAS: 2xx + ETag headers, then a hung body -> committed (decided from the recorded headers)', o1.kind === 'committed', o1);
      fake.reset(); fake.rule({ cls: 'signed', method: 'PUT', hang: 'headers' }); const o2 = await within(2000, BA.openAdmission(BA.createAuthorityClient(cOpts()), 'scope-dl8c', intent));
      check('DL8c CAS sent, no headers -> aborted at its cap -> ambiguous (an abort does not prove nothing was sent)', o2.kind === 'ambiguous', o2); }
    useV();
    { fake.reset(); const fx = fixture(); fake.rule({ cls: 'signed', method: 'GET', nth: 3, v: 30_000 }); const m = mark(); const { r, b } = await run(fx, 60_000);
      check('DL9 slow fields D1 (30 s; simulated overrun of its clamp) -> PUT gate (22 s) fails -> blocked fields_not_sent; 0 PUTs; the note was sent; no release (ADMITTED)', r.statusCode === 409 && b.code === 'fields_not_sent' && cls(m, 'ghl', 'PUT').length === 0 && cls(m, 'ghl', 'POST').length === 1 && authorityState(fx) === 'ADMITTED', [b, authorityState(fx)]); }
    useV({}, 1_500); // the production pass delay, so a sleep would show in the elapsed real time
    { fake.reset(); const fx = fixture(); fake.rule({ cls: 'signed', method: 'GET', nth: 3, v: 27_000 }, { cls: 'ghl', kind: 'noteGet', hide: true, v: 8_000 }); const m = mark(); const t = realNow(); const { r, b } = await run(fx, 60_000); const el = realNow() - t;
      check('DL10 pass 1 pending (8 s, inside the module window), leaving ~15 s < 1.5 s pass delay + 14 s -> blocked deadline_verify; no second pass (4 GHL GETs: Opportunity + contact, one pass); no sleep; ADMITTED', r.statusCode === 409 && b.code === 'deadline_verify' && cls(m, 'ghl', 'GET').length === 4 && el < 1000 && authorityState(fx) === 'ADMITTED', [b, cls(m, 'ghl', 'GET').length, el]); }
    useV();
    { // DL11: CLOSE, row by row (r3 §5)
      fake.reset(); const fx = fixture(); fake.rule({ cls: 'ghl', kind: 'noteGet', v: 37_500 }, { cls: 'signed', method: 'GET', nth: 5, v: 1_000 }); const m = mark(); const a = await run(fx, 60_000);
      check('DL11a verified, then 11.5 s < 12 s left (a2 simulated overrun) -> blocked deadline_before_close; 0 CLOSE requests; never verified', a.r.statusCode === 409 && a.b.code === 'deadline_before_close' && !fake.log.slice(m.l).some((x) => /COMPLETED/.test(x.body)) && authorityState(fx) === 'ADMITTED', a.b);
      fake.reset(); const fx2 = fixture(); fake.rule({ cls: 'signed', method: 'GET', nth: 6, v: 3_000 }); const m2 = mark(); const c = await run(fx2, 60_000);
      check('DL11c control: the same 3 s CLOSE read with time to spare -> 200 verified only after the CLOSE CAS committed (COMPLETED stored)', c.r.statusCode === 200 && c.b.outcome === 'verified' && authorityState(fx2) === 'COMPLETED' && fake.log.slice(m2.l).some((x) => /COMPLETED/.test(x.body)), c.b);
      // CLOSE starts with ~13 s left; its read (the 6th signed GET) takes 3 s, so the CAS (10 s) no longer fits.
      fake.reset(); const fx3 = fixture(); fake.rule({ cls: 'ghl', kind: 'noteGet', v: 37_000 }, { cls: 'signed', method: 'GET', nth: 6, v: 3_000 }); const m3 = mark(); const d = await run(fx3, 60_000);
      check('DL11b CLOSE read sent, then < 10 s left -> the CAS is not sent -> blocked close_not_sent; never verified', d.r.statusCode === 409 && d.b.code === 'close_not_sent' && !fake.log.slice(m3.l).some((x) => /COMPLETED/.test(x.body)) && authorityState(fx3) === 'ADMITTED', d.b);
      useR();
      const closeCase = async (label, rule, want, state) => { fake.reset(); const f = fixture(); fake.rule(rule); const x = await within(4000, run(f, 600));
        check(`DL11${label}`, (want === 'verified' ? x.r.statusCode === 200 && x.b.outcome === 'verified' : x.b.code === want) && authorityState(f) === state, [x.b, authorityState(f)]); };
      await closeCase('d CLOSE strong read, hung body -> aborted at its clamp -> blocked close_unreadable; ADMITTED', { cls: 'signed', method: 'GET', nth: 6, hang: 'body' }, 'close_unreadable', 'ADMITTED');
      await closeCase('e CLOSE CAS sign request hung -> aborted -> not sent -> blocked close_not_sent; ADMITTED', { cls: 'api', method: 'PUT', nth: 2, hang: 'headers' }, 'close_not_sent', 'ADMITTED');
      await closeCase('f CLOSE CAS blob sent, no headers -> aborted -> blocked close_ambiguous; never verified (this fake did not store it)', { cls: 'signed', method: 'PUT', body: /COMPLETED/, hang: 'headers' }, 'close_ambiguous', 'ADMITTED');
      await closeCase('g CLOSE CAS 2xx without an ETag (stored by the fake) -> blocked close_ambiguous; never verified', { cls: 'signed', method: 'PUT', body: /COMPLETED/, etag: false }, 'close_ambiguous', 'COMPLETED');
      await closeCase('h CLOSE CAS 2xx + ETag, then a hung body -> committed from the recorded headers -> 200 verified', { cls: 'signed', method: 'PUT', body: /COMPLETED/, hang: 'body' }, 'verified', 'COMPLETED');
    }
    useV();
    { // DL12: the sampled latencies (validation receipt, R1-R9 classes) replayed on the virtual clock, then the 2 988 ms outlier on each blob request
      const sampled = () => [{ cls: 'api', v: 332, nth: 1, method: 'GET' }, { cls: 'api', v: 70, always: true }, { cls: 'signed', v: 55, always: true }, { cls: 'ghl', kind: 'oppGet', v: 210, always: true }, { cls: 'ghl', kind: 'notePost', v: 264, always: true }, { cls: 'ghl', kind: 'oppPut', v: 552, always: true }, { cls: 'ghl', kind: 'noteGet', v: 164, always: true }];
      fake.reset(); const fx = fixture(); fake.rule(...sampled()); const a = await run(fx, 59_998); const used = a.t1 - a.t0;
      check('DL12a sampled latencies -> 200 verified (sample replay, not a guarantee)', a.r.statusCode === 200 && a.b.outcome === 'verified' && used < 5_000, [a.b.outcome, used]);
      const outs = [];
      for (const [method, k] of [['GET', 1], ['PUT', 1], ['GET', 2], ['GET', 3], ['GET', 4], ['GET', 5], ['GET', 6], ['PUT', 2]]) { fake.reset(); const f = fixture(); fake.rule({ cls: 'signed', method, nth: k, v: 2_988 }, ...sampled()); outs.push((await run(f, 59_998)).b.outcome); }
      check('DL12b the 2 988 ms outlier on each of the 8 blob requests in turn -> verified every time', outs.every((o) => o === 'verified'), outs); }
    useR();
    { // DL13: seeded random REAL latencies around the scaled caps (incl. hangs); invariants on every run
      let seed = 0x5eed1234; const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const D = SCALED_D; const viol = []; const outcomes = {}; let maxOver = -Infinity;
      for (let i = 0; i < 30; i++) {
        fake.reset(); const f = fixture();
        for (const [c, method, cap] of [['edge', 'PUT', D.claimTimeoutMs], ['api', undefined, D.authorityTimeoutMs], ['signed', undefined, D.authorityTimeoutMs], ['ghl', 'GET', D.ghlReadTimeoutMs], ['ghl', 'POST', D.ghlWriteTimeoutMs], ['ghl', 'PUT', D.ghlWriteTimeoutMs]]) {
          for (let k = 1; k <= 8; k++) { const x = rnd(); if (x < 0.55) continue; fake.rule({ cls: c, method, nth: k, ...(x > 0.97 ? { hang: x > 0.985 ? 'body' : 'headers' } : { delay: Math.floor(rnd() * cap * 0.9) }) }); }
        }
        const m = mark(); const t0 = Date.now(); const r = await within(5000, saveHandler(saveEvent(f), ctx(600))); const t1 = Date.now(); const b = parse(r) || {};
        const deadline = t0 + D.budgetMs; maxOver = Math.max(maxOver, t1 - deadline);
        const st = since(m); const srv = fake.log.slice(m.l);
        const key = `${r.statusCode}:${b.code || b.outcome}`; outcomes[key] = (outcomes[key] || 0) + 1;
        const late = st.filter((x) => x.t > deadline - D.minStartMs + 2); if (late.length) viol.push(`run ${i}: request started after the deadline`);
        const wr = st.filter((x) => (x.cls === 'ghl' && x.method !== 'GET') || (x.cls === 'api' && x.method === 'PUT') || x.cls === 'edge');
        for (const w of wr) { const cap = w.cls === 'ghl' ? D.ghlWriteTimeoutMs : w.cls === 'edge' ? D.claimTimeoutMs : 2 * D.authorityTimeoutMs; if (w.t > deadline - cap + 2) viol.push(`run ${i}: ${w.cls} ${w.method} started without its full cap`); }
        const posts = st.filter((x) => x.cls === 'ghl' && x.method === 'POST').length; const puts = st.filter((x) => x.cls === 'ghl' && x.method === 'PUT').length;
        if (posts > 1 || puts > 1 || st.filter((x) => x.cls === 'edge').length > 1) viol.push(`run ${i}: a write was sent twice`);
        const released = srv.some((x) => x.cls === 'signed' && x.method === 'PUT' && /abandoned_undispatched/.test(x.body));
        if (released && (posts || puts)) viol.push(`run ${i}: released after a target send`);
        if (b.outcome === 'not_sent' && (posts || puts)) viol.push(`run ${i}: not_sent after a target send`);
        const closedOk = srv.some((x) => x.cls === 'signed' && x.method === 'PUT' && /COMPLETED/.test(x.body) && !(x.rule && (x.rule.hang === 'headers' || x.rule.status)));
        if (b.outcome === 'verified' && !closedOk) viol.push(`run ${i}: verified without a committed CLOSE`);
        if (!['verified', 'not_sent', 'blocked'].includes(b.outcome)) viol.push(`run ${i}: unexpected outcome ${r.statusCode} ${r.body.slice(0, 80)}`);
      }
      check('DL13 30 seeded real-latency runs: 0 starts after the deadline; writes only with their full cap; no write twice; release only with 0 target sends; verified only after CLOSE', viol.length === 0, { viol: viol.slice(0, 5), outcomes });
      check('DL13b G3 (expected, not guaranteed): every response within 40 ms of the deadline', maxOver <= 40, { maxOverMs: maxOver });
      console.log(`INFO  DL13 outcomes ${JSON.stringify(outcomes)}; latest response relative to the deadline ${maxOver} ms`); }
    { // DL14: nothing left running after the handler resolves -- real hangs at several points
      const cases = [{ cls: 'ghl', kind: 'oppGet', hang: 'body' }, { cls: 'signed', method: 'GET', nth: 4, hang: 'body' }, { cls: 'ghl', kind: 'noteGet', hang: 'headers' }, { cls: 'edge', status: 503 }, { cls: 'ghl', kind: 'notePost', hang: 'headers' }];
      const res = [];
      for (const c of cases) { fake.reset(); const f = fixture(); fake.rule(c); const m = mark(); await within(4000, run(f, 600)); const after = starts.length; await flush(300); res.push([starts.length - after, liveOurs(m.t).length]); }
      check('DL14 after the handler resolves (5 hang/failure points): 0 further fetch calls and 0 live timers from our code', res.every(([a, b]) => a === 0 && b === 0), res); }
    console.log('NOTE  DL15 is a separate run of the existing module suite (test-blob-authority.cjs), recorded in the package');
    check('hygiene: no request left loopback', blocked.length === 0, blocked);
  } finally {
    await fake.close();
  }
  console.log(`\nB1 save deadline: ${checks - failures}/${checks} checks passed`);
  if (checks !== FLOOR) { console.error(`FAIL  check count ${checks} != FLOOR ${FLOOR}`); process.exitCode = 1; }
  if (failures) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exit(1); });
