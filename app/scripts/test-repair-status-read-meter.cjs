/**
 * B15-04 step-044 ruling (Bones) -- repair-approval-status as a SUPPLEMENTAL-READ consumer. Focused offline suite.
 *
 * Drives the REAL repair-approval-status handler and the REAL blob-authority module. The authority record is read
 * through the REAL @netlify/blobs 11.1.0 (API mode) against a loopback fake; GHL is a loopback fake behind a routing
 * fetch; the supplemental budget's store and Lambda context are in-memory stand-ins with injectable faults, as in
 * test-supplemental-read-budget.cjs. The budget is switched per check by editing the in-memory Test config object, as
 * that suite does (committed Test is the accepted deactivation). Credentials, ids and sessions are synthetic.
 *
 * Proves, for the reader's target GET (the Opportunity read; the optional note read uses the same ghlCall GET path,
 * checked statically below): reservation BEFORE dispatch; exhaustion / unavailable accounting refuse it UNSENT; a spent
 * unit stays spent on failure; a redirect never becomes an unreserved second request; the budget-DISABLED path is the
 * platform fetch with the caller's options unchanged; the save path never uses the reader meter.
 */
'use strict';
const fs = require('node:fs');
const http = require('node:http');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const APP = path.resolve(__dirname, '..');
const FUNCTIONS = path.join(APP, 'netlify', 'functions');
/** Literal count of check() executions below; never back-filled from a run. */
const FLOOR = 24;
let checks = 0; let failures = 0;
function check(name, ok, detail) {
  checks += 1; if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}

// ------------------------------------------------------------------ loader ---
const appRequire = Module.createRequire(path.join(APP, 'package.json'));
const realBlobs = appRequire('@netlify/blobs');
// the supplemental budget's environment-context store: onlyIfNew / onlyIfMatch with etags; injectable faults
const budgetData = new Map(); const budgetEtags = new Map(); let etagN = 0; let budgetOps = 0;
let faults = { writeThrow: 0 };
const budgetStore = {
  async getWithMetadata(key) { budgetOps++; return budgetData.has(key) ? { data: structuredClone(budgetData.get(key)), etag: budgetEtags.get(key) } : null; },
  async setJSON(key, value, options) {
    budgetOps++;
    if (faults.writeThrow) { faults.writeThrow--; throw new Error('fixture: budget write failed'); }
    if (options?.onlyIfNew && budgetData.has(key)) return { modified: false };
    if (options?.onlyIfMatch !== undefined && budgetEtags.get(key) !== options.onlyIfMatch) return { modified: false };
    budgetData.set(key, structuredClone(value)); budgetEtags.set(key, 'b' + (++etagN)); return { modified: true };
  },
};
const blobsShim = {
  ...realBlobs,
  connectLambda: (event) => { if (!(event && event.blobs)) throw new Error('fixture: no Blobs context in the event'); },
  // API mode (siteID + token: the authority client) -> the REAL SDK; a named environment-context store -> the budget stand-in
  getStore: (opts) => (opts && typeof opts === 'object' && opts.siteID && opts.token ? realBlobs.getStore(opts) : budgetStore),
};
const originalResolve = Module._resolveFilename; const originalLoad = Module._load;
Module._resolveFilename = function (name, parent, ...rest) {
  if (name.startsWith('.') && parent) { for (const ext of ['.ts', '.tsx']) { const c = path.resolve(path.dirname(parent.filename), name + ext); if (fs.existsSync(c)) return c; } }
  return originalResolve.call(this, name, parent, ...rest);
};
for (const ext of ['.ts', '.tsx']) Module._extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
Module._load = function (name, parent, ...rest) { if (name === '@netlify/blobs') return blobsShim; return originalLoad.call(this, name, parent, ...rest); };

// --------------------------------------------------------------- environment ---
Object.assign(process.env, {
  NODE_ENV: 'test', IAOS_ENV: 'test',
  IAOS_APP_READ_GOOGLE_CLIENT_ID: 'offline-read-client', IAOS_APP_READ_BRAD_EMAILS: 'operator@example.invalid',
  IAOS_APP_READ_SESSION_SECRET: 'offline-read-secret-not-real-9876543210', IAOS_APP_READ_ALLOWED_ORIGIN: 'https://iaos-app-test.example',
  GHL_PRIVATE_API_KEY: 'ghl-synthetic-offline-key', IAOS_REPAIR_AUTHORITY_SITE_ID: 'site-synthetic-repair-approval', IAOS_REPAIR_AUTHORITY_TOKEN: 'netlify-synthetic-offline-token',
});

// ------------------------------------------------------------------- fakes ---
function listen(handler) {
  const server = http.createServer((req, res) => { const c = []; req.on('data', (x) => c.push(x)); req.on('end', () => handler(req, res, Buffer.concat(c).toString('utf8'))); });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((q) => server.close(q)) })));
}
const SIGNED_HOST = 'fake-netliblob.s3.us-east-2.amazonaws.com';
async function main() {
  // authority Blobs fake: every authority record absent (404) -> the reader's "absent" branch, which reads the Opportunity
  const B = await listen((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname.startsWith('/api/v1/blobs/')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ url: `https://${SIGNED_HOST}/signed/x` })); }
    res.writeHead(404); return res.end();
  });
  const ghlLog = []; let ghlMode = 'ok';
  const G = await listen((req, res) => {
    const u = new URL(req.url, 'http://x'); ghlLog.push({ method: req.method, path: u.pathname, auth: req.headers.authorization || null, budgetReservedAtArrival: reservedNow() });
    if (ghlMode === 'redirect') { res.writeHead(302, { location: 'https://services.leadconnectorhq.com/elsewhere' }); return res.end(); }
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ opportunity: { id: 'oppSynthetic001', contactId: 'conSynthetic001', customFields: [] } }));
  });
  const realFetch = globalThis.fetch; const fetchCalls = []; let ghlNetworkFail = false;
  const MAP = { 'https://services.leadconnectorhq.com': G.origin, 'https://api.netlify.com': B.origin, [`https://${SIGNED_HOST}`]: B.origin };
  globalThis.fetch = (url, init = {}) => {
    const u = new URL(String(url)); const o = MAP[u.origin];
    if (u.origin === 'https://services.leadconnectorhq.com') { fetchCalls.push({ path: u.pathname, method: init.method || 'GET', redirect: init.redirect }); if (ghlNetworkFail) return Promise.reject(Object.assign(new Error('fixture: socket reset'), { code: 'ECONNRESET' })); }
    if (!o) return Promise.reject(new Error('offline guard: blocked ' + u.origin));
    return realFetch(o + u.pathname + u.search, init);
  };

  const status = require(path.join(FUNCTIONS, 'repair-approval-status.ts')).handler;
  const lib = require(path.join(FUNCTIONS, 'lib', 'supplemental-read-budget.ts'));
  const cfgMod = require(path.join(APP, 'shared', 'ghl-config.ts'));
  const readAuth = require(path.join(FUNCTIONS, 'lib', 'app-read-auth.ts'));
  const testCfg = cfgMod.getConfig('test');
  const SCOPE = `test:${testCfg.locationId}`;
  const COMMITTED = { ...testCfg.supplementalReadBudget };
  const token = readAuth.issueReadSession('operator@example.invalid', readAuth.appReadConfig()).token;
  const B64 = Buffer.from(JSON.stringify({ url: 'https://blobs.example.invalid', token: 'offline-blob-fixture' })).toString('base64');
  const ev = (withBlobs = true) => ({ httpMethod: 'GET', headers: { cookie: `${readAuth.READ_COOKIE}=${token}` }, queryStringParameters: { opportunityId: 'oppSynthetic001' }, ...(withBlobs ? { blobs: B64 } : {}) });
  const enable = (ceiling, budgetId = 'status-meter') => { testCfg.supplementalReadBudget = { enabled: cfgMod.SUPPLEMENTAL_READ_BUDGET_ENABLED, budgetId, ceiling }; };
  const rec = (budgetId = 'status-meter') => budgetData.get(lib.readBudgetKey(SCOPE, budgetId)) ?? null;
  function reservedNow() { const r = rec(); return r ? r.reserved : 0; }
  const reset = () => { budgetData.clear(); budgetEtags.clear(); budgetOps = 0; faults = { writeThrow: 0 }; ghlLog.length = 0; fetchCalls.length = 0; ghlMode = 'ok'; ghlNetworkFail = false; testCfg.supplementalReadBudget = { ...COMMITTED }; };
  const body = (r) => { try { return JSON.parse(r.body); } catch { return null; } };

  try {
    // committed configuration
    check('M0 committed Test is the accepted deactivation (DISABLED, b15-04-eval-reads-closed, 0)', COMMITTED.enabled === cfgMod.SUPPLEMENTAL_READ_BUDGET_DISABLED && COMMITTED.budgetId === 'b15-04-eval-reads-closed' && COMMITTED.ceiling === 0, COMMITTED);

    // M1 disabled: the platform fetch, unchanged
    reset(); let r = await status(ev());
    check('M1 budget DISABLED: status reads the Opportunity once, 200 (kind none)', r.statusCode === 200 && body(r)?.kind === 'none' && ghlLog.length === 1 && ghlLog[0].path === '/opportunities/oppSynthetic001', { s: r.statusCode, b: body(r), g: ghlLog });
    check('M1 budget DISABLED: the caller\'s options pass through unchanged (redirect "manual"); zero budget-store access; no record', fetchCalls.length === 1 && fetchCalls[0].redirect === 'manual' && budgetOps === 0 && rec() === null, { f: fetchCalls, budgetOps });
    check('M1 budget DISABLED: the GHL read carries the server credential (unchanged)', ghlLog[0].auth === `Bearer ${process.env.GHL_PRIVATE_API_KEY}`);

    // M2 enabled: reservation before dispatch
    reset(); enable(5); r = await status(ev());
    check('M2 budget ENABLED: 200 and exactly one GHL read', r.statusCode === 200 && ghlLog.length === 1, { s: r.statusCode, g: ghlLog.length });
    check('M2 the unit was RESERVED BEFORE the request reached GHL (reserved = 1 at arrival)', ghlLog[0].budgetReservedAtArrival === 1, ghlLog[0]);
    check('M2 the receipt names repair-approval-status and the Opportunity path', rec()?.reserved === 1 && rec().receipts?.[0]?.fn === 'repair-approval-status' && rec().receipts[0].path === '/opportunities/oppSynthetic001', rec());
    check('M2 the metered dispatch forbids redirects (redirect "error", applied after the caller\'s "manual")', fetchCalls.length === 1 && fetchCalls[0].redirect === 'error', fetchCalls);

    // M3 exhausted: refused unsent
    reset(); enable(1); await status(ev()); const before = ghlLog.length; r = await status(ev());
    check('M3 exhausted (ceiling 1 spent): 503 supplemental_read_exhausted, outcome not_sent', r.statusCode === 503 && body(r)?.code === 'supplemental_read_exhausted' && body(r)?.outcome === 'not_sent', { s: r.statusCode, b: body(r) });
    check('M3 exhausted: the refused read was NEVER sent; the record is not reset', ghlLog.length === before && rec()?.reserved === 1, { before, after: ghlLog.length, rec: rec() });

    // M4 accounting unavailable: no Blob context
    reset(); enable(5); r = await status(ev(false));
    check('M4 no Blob context: 503 supplemental_read_unavailable; NO GHL request', r.statusCode === 503 && body(r)?.code === 'supplemental_read_unavailable' && ghlLog.length === 0 && fetchCalls.length === 0, { s: r.statusCode, b: body(r), g: ghlLog.length });

    // M5 accounting unavailable: the reservation write throws
    reset(); enable(5); faults.writeThrow = 50; r = await status(ev());
    check('M5 reservation write throws: 503 supplemental_read_unavailable; NO GHL request', r.statusCode === 503 && body(r)?.code === 'supplemental_read_unavailable' && ghlLog.length === 0 && fetchCalls.length === 0, { s: r.statusCode, b: body(r) });

    // M6 a spent unit stays spent when the request fails
    reset(); enable(5); ghlNetworkFail = true; r = await status(ev());
    check('M6 GHL network failure after reservation: the unit stays spent (reserved 1); one dispatch attempted', rec()?.reserved === 1 && fetchCalls.length === 1, { rec: rec(), f: fetchCalls.length });
    check('M6 the failed read is not reported as a budget refusal (the reader\'s own uncertainty applies)', !(body(r)?.code ?? '').startsWith('supplemental_read_'), { s: r.statusCode, b: body(r) });

    // M7 a redirect never becomes an unreserved second request
    reset(); enable(5); ghlMode = 'redirect'; r = await status(ev());
    check('M7 GHL answers 302: exactly ONE request reached GHL (the redirect target was never contacted)', ghlLog.length === 1 && ghlLog[0].path === '/opportunities/oppSynthetic001', ghlLog);
    check('M7 the 302 spent exactly one unit; nothing else reserved', rec()?.reserved === 1, rec());
    check('M7 the redirected read is not verified (reader uncertainty), never a budget refusal', r.statusCode !== 200 || body(r)?.kind !== 'checked', { s: r.statusCode, b: body(r) });

    // M8 Production / non-Test: the reader never meters outside Test (and status is not active there)
    reset(); enable(5); process.env.IAOS_ENV = 'production'; r = await status(ev()); process.env.IAOS_ENV = 'test';
    check('M8 Production: status is not active (404) before any read or reservation', r.statusCode === 404 && ghlLog.length === 0 && budgetOps === 0, { s: r.statusCode });

    // static: the seam and the save path
    const src = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');   // checkouts may be CRLF
    const ba = src(path.join(FUNCTIONS, 'lib', 'blob-authority.ts'));
    const reader = ba.slice(ba.indexOf('export async function readRepairApproval'));
    check('S1 blob-authority: ONE target dispatch site, and only GETs take readFetch (POST/PUT keep fetchImpl)', /const send = method === "GET" && t\.readFetch \? t\.readFetch : t\.fetchImpl;/.test(ba) && (ba.match(/await send\(/g) || []).length === 1 && !/t\.fetchImpl\(/.test(ba));
    const readerBody = reader.slice(0, reader.indexOf('\n}\n'));
    const noteFn = ba.slice(ba.indexOf('async function readNoteById')); const noteBody = noteFn.slice(0, noteFn.indexOf('\n}\n'));
    check('S2 the reader\'s target reads are GETs through ghlCall only: one inline Opportunity GET, and the note read via readNoteById, whose only request is a ghlCall GET',
      (readerBody.match(/ghlCall\(t, "GET", `\/opportunities\//g) || []).length === 1 && /readNoteById\(t, /.test(readerBody) && !/ghlCall\(t, "(POST|PUT)"/.test(readerBody)
      && (noteBody.match(/ghlCall\(/g) || []).length === 1 && /ghlCall\(t, "GET", `\/contacts\/\$\{encodeURIComponent\(contactId\)\}\/notes\//.test(noteBody));
    const save = src(path.join(FUNCTIONS, 'repair-approval-save.ts'));
    check('S3 repair-approval-save never passes readFetch and never imports the reader meter (B1 save authority unchanged)', !/\breadFetch\b/.test(save) && !/supplemental-read-budget/.test(save));
    const BA = require(path.join(FUNCTIONS, 'lib', 'blob-authority.ts'));
    let threw = null; try { BA.createProductionTargetTransport({ fieldIds: { repairEstimate: 'fldA', repairApprovalId: 'fldB' }, readFetch: 'not-a-function' }); } catch (e) { threw = String(e.message); }
    check('S4 a non-function readFetch is refused at transport creation', /readFetch must be a function/.test(threw ?? ''), threw);
    threw = null; try { BA.createProductionTargetTransport({ fieldIds: { repairEstimate: 'fldA', repairApprovalId: 'fldB' }, fetch: () => {} }); } catch (e) { threw = String(e.message); }
    check('S5 an unknown transport option is still refused (no widening beyond readFetch)', /options must be/.test(threw ?? ''), threw);
    const st = src(path.join(FUNCTIONS, 'repair-approval-status.ts'));
    check('S6 status: activation, method, read auth and setup gates still precede any read', st.indexOf('repairApprovalActiveFor(process.env.IAOS_ENV)') < st.indexOf('readAuthRefusal(event)') && st.indexOf('readAuthRefusal(event)') < st.indexOf('approvalSetup()') && st.indexOf('approvalSetup()') < st.indexOf('ghlReadFetch(event'));
  } finally {
    globalThis.fetch = realFetch; await B.close(); await G.close();
  }
  if (checks !== FLOOR) { failures += 1; console.error(`FAIL  check count ${checks} != FLOOR ${FLOOR}`); }
  console.log(`\nB15-04 step-044 repair-status read meter: ${checks - failures}/${checks} checks passed${failures ? ` (failures=${failures})` : ''}`);
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error('FAIL  harness: ' + (e && e.stack || e)); process.exit(1); });
