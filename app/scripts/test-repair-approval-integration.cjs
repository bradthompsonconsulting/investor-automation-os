/**
 * B15-26 B1 repair-save completion INTEGRATION -- offline tests.
 *
 * Drives the real handlers (repair-approval-save, repair-approval-status,
 * ghl-write) and the accepted module (blob-authority.ts, unchanged) against
 * loopback fakes: GHL (contacts, opportunities, notes) and the Netlify Blobs
 * API (signing + signed URLs). The module's API-mode Blob calls go through the
 * REAL @netlify/blobs 11.1.0; the environment-context store (claimWrite,
 * lockContact) is an in-memory stand-in, as in the existing handler suites.
 * Every https origin is routed to a loopback fake; anything else is refused.
 * Credentials, ids and sessions are synthetic.
 *
 * Shows the INTEGRATION's behaviour against fakes only. Nothing here proves
 * GHL, Netlify or browser behaviour.
 */
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const Module = require('node:module');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');

const APP = path.resolve(__dirname, '..');
/** Literal count of check() executions below (loops expanded by hand); never back-filled from a run. */
const FLOOR = 44; // 38 check() call sites + 4 extra V1 iterations (5 cases) + 2 extra M1 iterations (3 cases)
let checks = 0; let failures = 0;
function check(name, ok, detail) {
  checks += 1; if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}

// ------------------------------------------------------------------ loader ---
const appRequire = Module.createRequire(path.join(APP, 'package.json'));
const realBlobs = appRequire('@netlify/blobs');
const memStore = new Map();
const memBlobStore = {
  async get(key) { return memStore.has(key) ? memStore.get(key) : null; },
  async delete(key) { memStore.delete(key); },
  async setJSON(key, value, options) { if (options && options.onlyIfNew && memStore.has(key)) return { modified: false }; memStore.set(key, value); return { modified: true }; },
};
const blobsShim = {
  ...realBlobs,
  connectLambda: () => {},
  // API mode (siteID + token, the module's authority client) -> the REAL SDK; anything else -> the in-memory stand-in.
  getStore: (opts) => (opts && typeof opts === 'object' && opts.siteID && opts.token ? realBlobs.getStore(opts) : memBlobStore),
};
let cfgMode = 'real';
const realCfg = (() => { const m = { exports: {} }; const src = ts.transpileModule(fs.readFileSync(path.join(APP, 'shared', 'repair-approval-config.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText; new Function('module', 'exports', 'require', src)(m, m.exports, require); return m.exports; })();
const APPROVAL_FIELD = 'fldApprovalSynthetic01';
const cfgVariants = {
  enabled: Object.freeze({ ...realCfg.REPAIR_APPROVAL_CONFIG, enabled: true, approvalFieldId: Object.freeze({ test: APPROVAL_FIELD, production: realCfg.REPAIR_APPROVAL_FIELD_NOT_PROVISIONED }), verifyPassDelayMs: 30 }),
  enabledUnprovisioned: Object.freeze({ ...realCfg.REPAIR_APPROVAL_CONFIG, enabled: true, verifyPassDelayMs: 30 }),
};
const cfgShim = {
  get REPAIR_APPROVAL_CONFIG() { return cfgMode === 'real' ? realCfg.REPAIR_APPROVAL_CONFIG : cfgVariants[cfgMode]; },
  REPAIR_APPROVAL_FIELD_NOT_PROVISIONED: realCfg.REPAIR_APPROVAL_FIELD_NOT_PROVISIONED,
  REPAIR_APPROVAL_DISABLED: realCfg.REPAIR_APPROVAL_DISABLED,
};
const originalResolve = Module._resolveFilename;
const originalLoad = Module._load;
Module._resolveFilename = function (name, parent, ...rest) {
  if (name.startsWith('.') && parent) {
    for (const ext of ['.ts', '.tsx']) { const c = path.resolve(path.dirname(parent.filename), name + ext); if (fs.existsSync(c)) return c; }
  }
  return originalResolve.call(this, name, parent, ...rest);
};
for (const ext of ['.ts', '.tsx']) Module._extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, resolveJsonModule: true, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
let appWriteFetchStub = null; let readFetchStub = null;
Module._load = function (name, parent, ...rest) {
  if (name === '@netlify/blobs') return blobsShim;
  if (/repair-approval-config$/.test(name)) return cfgShim;
  if (/\/app-write-session$/.test(name) && appWriteFetchStub) return { appWriteFetch: (...a) => appWriteFetchStub(...a) };
  if (/\/read-session$/.test(name) && readFetchStub) return { readFetch: (...a) => readFetchStub(...a), isReadAuthRefusal: async () => false, ReadUnavailableError: class extends Error {} };
  return originalLoad.call(this, name, parent, ...rest);
};

// --------------------------------------------------------------- environment ---
const ORIGIN = 'https://iaos-app-test.example';
Object.assign(process.env, {
  NODE_ENV: 'test', IAOS_ENV: 'test',
  IAOS_APP_WRITE_GOOGLE_CLIENT_ID: 'offline-client', IAOS_APP_WRITE_BRAD_EMAILS: 'operator@example.invalid',
  IAOS_APP_WRITE_SESSION_SECRET: 'offline-write-secret-not-real-0123456789', IAOS_APP_WRITE_ALLOWED_ORIGIN: ORIGIN,
  IAOS_APP_READ_GOOGLE_CLIENT_ID: 'offline-read-client', IAOS_APP_READ_BRAD_EMAILS: 'operator@example.invalid',
  IAOS_APP_READ_SESSION_SECRET: 'offline-read-secret-not-real-9876543210', IAOS_APP_READ_ALLOWED_ORIGIN: ORIGIN,
  GHL_PRIVATE_API_KEY: 'ghl-synthetic-offline-key', IAOS_REPAIR_AUTHORITY_SITE_ID: 'site-synthetic-repair-approval', IAOS_REPAIR_AUTHORITY_TOKEN: 'netlify-synthetic-offline-token',
});
const OPERATOR = 'operator@example.invalid';

// ------------------------------------------------------------------- fakes ---
function listen(handler) {
  const server = http.createServer((req, res) => { const c = []; req.on('data', (x) => c.push(x)); req.on('end', () => handler(req, res, Buffer.concat(c).toString('utf8'))); });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((q) => server.close(q)) })));
}
const SIGNED_HOST = 'fake-netliblob.s3.us-east-2.amazonaws.com';
function blobFake() {
  const store = new Map(); const signed = new Map(); const log = []; let rules = []; const nth = {}; let etagN = 0;
  const take = (stage, method) => { const k = `${stage}:${method}`; nth[k] = (nth[k] || 0) + 1; const r = rules.find((x) => x.stage === stage && x.method === method && (x.n === undefined || x.n === nth[k])); if (r) rules = rules.filter((x) => x !== r); return r; };
  const api = { store, log, script(r) { rules.push(...r); }, reset() { rules = []; for (const k of Object.keys(nth)) delete nth[k]; log.length = 0; } };
  api.ready = listen((req, res, body) => {
    const url = new URL(req.url, 'http://x'); const m = req.method;
    if (url.pathname.startsWith('/api/v1/blobs/')) {
      const rule = take('sign', m); log.push({ stage: 'sign', method: m });
      if (rule && rule.status) { res.writeHead(rule.status); return res.end('{}'); }
      const key = decodeURIComponent(url.pathname.slice('/api/v1/blobs/'.length)).split('/').slice(2).join('/');
      const id = crypto.randomUUID(); signed.set(id, { key, method: m });
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ url: `https://${SIGNED_HOST}/signed/${id}` }));
    }
    const sg = signed.get(url.pathname.replace('/signed/', '')); const rule = take('blob', m); log.push({ stage: 'blob', method: m });
    if (!sg || sg.method !== m) { res.writeHead(403); return res.end(); }
    if (rule && rule.status) { res.writeHead(rule.status); return res.end(); }
    const cur = store.get(sg.key);
    if (m === 'GET') { if (!cur) { res.writeHead(404); return res.end(); } res.writeHead(200, { etag: cur.etag }); return res.end(cur.text); }
    const inm = req.headers['if-none-match']; const im = req.headers['if-match'];
    if ((inm === '*' && cur) || (im && (!cur || cur.etag !== im)) || (!inm && !im)) { res.writeHead(412); return res.end(); }
    const etag = `"e${++etagN}"`; store.set(sg.key, { text: body, etag }); res.writeHead(200, { etag }); return res.end();
  });
  return api;
}
function ghlFake() {
  const contacts = new Map(); const opps = new Map(); const notes = new Map(); const log = []; let rules = []; const nth = {}; let noteN = 0;
  const api = { contacts, opps, notes, log, script(r) { rules.push(...r); }, reset() { rules = []; for (const k of Object.keys(nth)) delete nth[k]; log.length = 0; } };
  api.ready = listen((req, res, raw) => {
    const url = new URL(req.url, 'http://x'); const m = req.method; const p = url.pathname.split('/').filter(Boolean);
    const kind = p[0] === 'contacts' && p.length === 2 && m === 'GET' ? 'contactGet'
      : p[0] === 'contacts' && p[2] === 'notes' && p.length === 3 && m === 'POST' ? 'notePost'
      : p[0] === 'contacts' && p[2] === 'notes' && p.length === 3 && m === 'GET' ? 'notesList'
      : p[0] === 'contacts' && p[2] === 'notes' && p.length === 4 && m === 'GET' ? 'noteGet'
      : p[0] === 'opportunities' && m === 'GET' ? 'oppGet' : p[0] === 'opportunities' && m === 'PUT' ? 'oppPut' : 'other';
    nth[kind] = (nth[kind] || 0) + 1;
    const rule = rules.find((x) => x.kind === kind && (x.n === undefined || x.n === nth[kind])); if (rule) rules = rules.filter((x) => x !== rule);
    log.push({ kind, method: m, path: url.pathname, auth: req.headers.authorization || null, body: raw });
    const send = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(typeof o === 'string' ? o : JSON.stringify(o)); };
    let body = null; try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
    if (kind === 'contactGet') { const c = contacts.get(p[1]); return c ? send(200, { contact: c }) : send(404, {}); }
    if (kind === 'oppGet') { const o = opps.get(p[1]); return o ? send(200, { opportunity: JSON.parse(JSON.stringify(o)) }) : send(404, {}); }
    if (kind === 'oppPut') {
      const o = opps.get(p[1]);
      if (o && body && Array.isArray(body.customFields) && !(rule && rule.status && !rule.apply)) for (const f of body.customFields) o.customFields = o.customFields.filter((e) => e.id !== f.id).concat([{ id: f.id, fieldValue: rule && rule.alter && f.id === rule.alter.id ? rule.alter.value : f.field_value }]);
      return send(rule && rule.status ? rule.status : 200, { opportunity: o });
    }
    if (kind === 'notePost') {
      const note = { id: `note${++noteN}x`, body: body && body.body };
      if (!(rule && rule.status && !rule.apply)) { if (!notes.has(p[1])) notes.set(p[1], []); notes.get(p[1]).push(note); }
      if (rule && rule.respond) return send(201, rule.respond(note));
      return send(rule && rule.status ? rule.status : 201, { note: { ...note, contactId: p[1] } });
    }
    if (kind === 'noteGet') {
      if (rule && rule.hide) return send(404, {});
      for (const [cid, list] of notes) { const x = list.find((e) => e.id === p[3]); if (x) return send(200, { note: { id: x.id, body: rule && rule.body ? rule.body(x.body) : x.body, contactId: rule && rule.contactId ? rule.contactId : cid } }); }
      return send(404, {});
    }
    if (kind === 'notesList') return send(200, { notes: notes.get(p[1]) || [] });
    return send(404, {});
  });
  return api;
}

async function main() {
  const blobs = blobFake(); const ghl = ghlFake();
  const [B, G] = [await blobs.ready, await ghl.ready];
  const realFetch = globalThis.fetch; const blocked = [];
  const MAP = { 'https://services.leadconnectorhq.com': G.origin, 'https://api.netlify.com': B.origin, [`https://${SIGNED_HOST}`]: B.origin };
  globalThis.fetch = (url, init) => { const u = new URL(String(url)); const o = MAP[u.origin]; if (!o) { blocked.push(u.origin); return Promise.reject(new Error('offline guard: blocked ' + u.origin)); } return realFetch(o + u.pathname + u.search, init); };

  const save = require('../netlify/functions/repair-approval-save.ts').handler;
  const status = require('../netlify/functions/repair-approval-status.ts').handler;
  const ghlWrite = require('../netlify/functions/ghl-write.ts').handler;
  const { issueAppSession } = require('../netlify/functions/lib/app-write-auth.ts');
  const { issueReadSession, appReadConfig } = require('../netlify/functions/lib/app-read-auth.ts');
  const { getConfig } = require('../shared/ghl-config.ts');
  const OM = require('../src/lib/repair-estimation/operator-model.ts');
  const { computeRepairEstimate } = require('../src/lib/repair-estimation/compute.ts');
  const EV = require('../netlify/functions/lib/repair-evidence.ts');
  const BA = require('../netlify/functions/lib/blob-authority.ts');
  const { PROVISIONAL_HEADLINE } = require('../src/lib/provisional-repairs.ts');
  const config = getConfig('test'); const LOC = config.locationId; const F_EST = config.opportunityFacts.repairs;

  const writeToken = () => issueAppSession(OPERATOR).token;
  const readCookie = () => `__Host-iaos_read=${issueReadSession(OPERATOR, appReadConfig()).token}`;
  const saveEvent = (body, o = {}) => ({ httpMethod: o.method || 'POST', isBase64Encoded: false, queryStringParameters: {}, headers: { ...(o.auth === false ? {} : { authorization: `Bearer ${o.token || writeToken()}` }), ...(o.origin === null ? {} : { origin: o.origin || ORIGIN }), ...(o.cookie ? { cookie: o.cookie } : {}) }, body: JSON.stringify(body) });
  const statusEvent = (opportunityId, o = {}) => ({ httpMethod: 'GET', headers: { ...(o.cookie === false ? {} : { cookie: readCookie() }), ...(o.auth ? { authorization: `Bearer ${writeToken()}` } : {}) }, queryStringParameters: { opportunityId } });
  const parse = (r) => { try { return JSON.parse(r.body); } catch { return null; } };

  const complete = () => { const a = {}; OM.OPERATOR_ROWS.forEach((row, i) => { a[row.system] = OM.applyCondition(row, i < 2 ? 'repair' : 'good', OM.EMPTY_ANSWER); }); return a; };
  const expectedTotal = (answers, misc) => OM.operatorEstimate(answers, (lines) => computeRepairEstimate({ lines, property: { squareFeet: null, bathroomCount: null } }), misc).total;
  const MISC = { description: '', amount: '' };
  let n = 0;
  const fixture = () => {
    n += 1; const opp = `oppInteg${String(n).padStart(3, '0')}`; const contact = `contactInteg${String(n).padStart(3, '0')}`;
    ghl.contacts.set(contact, { id: contact, locationId: LOC, customFields: [] });
    ghl.opps.set(opp, { id: opp, locationId: LOC, contactId: contact, pipelineId: config.pipelines.sellerLeads, customFields: [] });
    return { opp, contact, scope: `repair-approval:test:${LOC}:${opp}` };
  };
  const body = (fx, over = {}) => ({ opportunityId: fx.opp, requestId: crypto.randomUUID(), answers: complete(), misc: MISC, ...over });
  const keyOf = (scope) => BA.authorityKey(scope);
  const stored = (fx) => { const s = blobs.store.get(keyOf(fx.scope)); return s ? JSON.parse(s.text) : null; };
  const writes = () => ghl.log.filter((e) => e.kind === 'notePost' || e.kind === 'oppPut').length;
  const mark = () => ({ g: ghl.log.length, b: blobs.log.length });
  const since = (m) => ({ g: ghl.log.slice(m.g), b: blobs.log.slice(m.b) });
  const reset = () => { ghl.reset(); blobs.reset(); };

  try {
    // ============================================== DISABLED (the default) ===
    cfgMode = 'real';
    { reset(); const fx = fixture(); const m = mark();
      const r1 = await save(saveEvent(body(fx), { auth: false, origin: null }));
      const r2 = await status(statusEvent(fx.opp, { cookie: false }));
      check('D1 disabled: save and status answer 404 (by iaos-repair-approval-disabled) before auth or any I/O; zero GHL and Blob requests',
        r1.statusCode === 404 && parse(r1).by === 'iaos-repair-approval-disabled' && r2.statusCode === 404 && since(m).g.length === 0 && since(m).b.length === 0, [r1.statusCode, r2.statusCode]);
      const w = await ghlWrite({ httpMethod: 'POST', isBase64Encoded: false, queryStringParameters: {}, headers: { authorization: `Bearer ${writeToken()}`, origin: ORIGIN }, body: JSON.stringify({ operation: 'opportunity.repairs', targetId: fx.opp, requestId: 'legacyReq001', args: { value: 4321 } }) });
      const o = ghl.opps.get(fx.opp);
      check('D2 disabled: the existing ghl-write opportunity.repairs path is unchanged (PUT sent, readback confirmed)', w.statusCode === 200 && parse(w).confirmed === true && o.customFields.some((f) => f.id === F_EST && f.fieldValue === 4321), [w.statusCode, w.body.slice(0, 160)]);
    }
    { const now = fs.readFileSync(path.join(APP, 'src', 'pages', 'UnderwritingWorkspace.tsx'), 'utf8').replace(/\r\n/g, '\n');
      const base = execFileSync('git', ['show', 'HEAD^1:app/src/pages/UnderwritingWorkspace.tsx'], { cwd: APP, encoding: 'utf8' }).replace(/\r\n/g, '\n');
      const OPEN = '        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "14px", flexWrap: "wrap" }}>\n';
      const a = base.indexOf(OPEN) + OPEN.length; const d = base.indexOf('        <div style={{ marginTop: "12px", fontSize: "11px", color: "#475569", lineHeight: 1.5 }}>\n', a);
      const original = base.slice(a, d); const children = original.slice(0, original.lastIndexOf('        </div>\n'));
      check('D3 disabled UI: the original action-bar JSX is preserved verbatim in the disabled branch, gated only by REPAIR_APPROVAL_CONFIG.enabled',
        now.includes('          ) : (\n          <>\n' + children + '          </>\n          )}\n') && /REPAIR_APPROVAL_CONFIG\.enabled \? \(\n\s+<RepairApprovalActions/.test(now));
    }
    // =========================================================== AUTHORITY ===
    cfgMode = 'enabled';
    { reset(); const fx = fixture(); const m = mark();
      const unauth = await save(saveEvent(body(fx), { auth: false }));
      const viewOnly = await save(saveEvent(body(fx), { auth: false, cookie: readCookie() }));
      const badOrigin = await save(saveEvent(body(fx), { origin: 'https://evil.example' }));
      // Flip the FIRST signature character (every bit significant; the last base64url char has unused low bits -- found when controls K1/K5 showed A3 flaking).
      const forgedToken = (() => { const p = writeToken().split('.'); p[2] = (p[2][0] === 'A' ? 'B' : 'A') + p[2].slice(1); return p.join('.'); })();
      const forged = await save(saveEvent(body(fx), { token: forgedToken }));
      const st = await status(statusEvent(fx.opp, { cookie: false, auth: true }));
      check('A1 unauthenticated save -> 401; zero requests', unauth.statusCode === 401);
      check('A2 view-only session (read cookie, no write session) -> save 401', viewOnly.statusCode === 401);
      check('A3 wrong origin -> 403; forged write token -> 401', badOrigin.statusCode === 403 && forged.statusCode === 401);
      check('A4 status without a read session (write bearer only) -> 401', st.statusCode === 401);
      check('A5 none of the refused requests reached GHL or Blobs', since(m).g.length === 0 && since(m).b.length === 0, since(m));
    }
    // ======================================================= CONFIGURATION ===
    { reset(); const fx = fixture(); const m = mark();
      cfgMode = 'enabledUnprovisioned';
      const r1 = await save(saveEvent(body(fx)));
      cfgMode = 'enabled';
      const savedTok = process.env.IAOS_REPAIR_AUTHORITY_TOKEN; delete process.env.IAOS_REPAIR_AUTHORITY_TOKEN;
      const r2 = await save(saveEvent(body(fx)));
      process.env.IAOS_REPAIR_AUTHORITY_TOKEN = savedTok;
      check('C1 enabled but repair_approval_id not provisioned -> 503 not_sent (approval_field_not_provisioned)', r1.statusCode === 503 && parse(r1).outcome === 'not_sent' && parse(r1).code === 'approval_field_not_provisioned');
      check('C2 enabled but no authority credentials -> 503 not_sent (authority_credentials_missing)', r2.statusCode === 503 && parse(r2).code === 'authority_credentials_missing');
      check('C3 missing configuration never falls back: zero GHL and Blob requests; no legacy write', since(m).g.length === 0 && since(m).b.length === 0 && writes() === 0);
      process.env.IAOS_ENV = 'production';
      const r3 = await save(saveEvent(body(fx)));
      process.env.IAOS_ENV = 'test';
      check('C4 Production is not part of this candidate: IAOS_ENV=production -> 503 not_sent (environment_not_enabled); nothing sent', r3.statusCode === 503 && parse(r3).code === 'environment_not_enabled' && since(m).g.length === 0 && since(m).b.length === 0, [r3.statusCode, r3.body]);
    }
    // ===================================================== REQUEST SHAPE ===
    for (const [label, over] of [
      ['a client-supplied total', { total: 1 }],
      ['a client-supplied contactId', { contactId: 'contactAttacker' }],
      ['a client-supplied operator', { operator: 'someone@else.invalid' }],
      ['an unknown repair row', { answers: { ...complete(), notARow: { condition: 'good', amount: '0', quantity: '', dirty: false } } }],
      ['an answer with an extra key', { answers: { ...complete(), [OM.OPERATOR_ROWS[0].system]: { condition: 'good', amount: '0', quantity: '', dirty: false, total: 9 } } }],
    ]) {
      reset(); const fx = fixture(); const m = mark();
      const b = { ...body(fx), ...over };
      const r = await save(saveEvent(b));
      check(`V1 ${label} -> 400 not_sent; zero GHL/Blob requests`, r.statusCode === 400 && parse(r).outcome === 'not_sent' && since(m).g.length === 0 && since(m).b.length === 0, [r.statusCode]);
    }
    { reset(); const fx = fixture(); const m = mark();
      const a = complete(); delete a[OM.OPERATOR_ROWS[3].system];
      const r = await save(saveEvent(body(fx, { answers: a })));
      check('V2 incomplete repairs (one row unanswered) -> 422 not_sent with "Provisional — repairs incomplete."; never admitted; zero requests', r.statusCode === 422 && parse(r).code === 'incomplete' && parse(r).text === PROVISIONAL_HEADLINE && since(m).g.length === 0 && since(m).b.length === 0);
    }
    // =========================================================== HAPPY PATH ===
    { reset(); const fx = fixture(); const m = mark();
      const answers = complete(); const want = expectedTotal(answers, MISC);
      const r = await save(saveEvent(body(fx, { answers })));
      const s = stored(fx); const notes = ghl.notes.get(fx.contact) || []; const o = ghl.opps.get(fx.opp);
      const e = notes[0] ? EV.parseEvidence(notes[0].body) : null;
      check('H1 complete estimate -> 200 verified with "Recorded repair approval — checked as of ..."', r.statusCode === 200 && parse(r).outcome === 'verified' && /^Recorded repair approval — checked as of /.test(parse(r).text), [r.statusCode, r.body.slice(0, 200)]);
      check('H2 the evidence note went to the contact DERIVED from the Opportunity, once', notes.length === 1 && ghl.log.filter((x) => x.kind === 'notePost').every((x) => x.path === `/contacts/${fx.contact}/notes`));
      check('H3 server-derived values: E operator = the authenticated writer; E total = the server recompute; E contact/opportunity = the Opportunity\'s', e && e.payload.operator === OPERATOR && e.payload.total === want && e.payload.contactId === fx.contact && e.payload.opportunityId === fx.opp, e && e.payload);
      check('H4 fields: repair_estimate = recomputed total, repair_approval_id = the admitted opId; A = COMPLETED with that op', s && s.state === 'COMPLETED' && o.customFields.some((f) => f.id === F_EST && f.fieldValue === want) && o.customFields.some((f) => f.id === APPROVAL_FIELD && f.fieldValue === s.op.opId));
      check('H5 no notes-LIST read; every GHL request carried the server credential', since(m).g.every((x) => x.kind !== 'notesList' && x.auth === `Bearer ${process.env.GHL_PRIVATE_API_KEY}`));
      const st = await status(statusEvent(fx.opp));
      check('H6 approval display: status reads "checked" with the same total', st.statusCode === 200 && parse(st).kind === 'checked' && parse(st).total === want && /^Recorded repair approval — checked as of /.test(parse(st).text), parse(st));
    }
    // ============================================================ DUPLICATES ===
    { reset(); const fx = fixture(); const b = body(fx);
      const r1 = await save(saveEvent(b)); const w1 = writes();
      const r2 = await save(saveEvent(b));
      check('DUP1 the same request id submitted twice -> second 409 not_sent (duplicate_request); no further GHL write', r1.statusCode === 200 && r2.statusCode === 409 && parse(r2).code === 'duplicate_request' && writes() === w1, [r1.statusCode, r2.statusCode]);
    }
    { reset(); const fx = fixture();
      const [r1, r2] = await Promise.all([save(saveEvent(body(fx))), save(saveEvent(body(fx)))]);
      const codes = [parse(r1), parse(r2)];
      check('DUP2 two concurrent saves for one opportunity -> exactly one note POST and one PUT; the other refused at admission (scope_blocked, or the conditional-write race: admission_refused), never a second write',
        ghl.log.filter((x) => x.kind === 'notePost').length === 1 && ghl.log.filter((x) => x.kind === 'oppPut').length === 1 && codes.some((c) => c.outcome === 'verified') && codes.some((c) => (c.outcome === 'blocked' && c.code === 'scope_blocked') || (c.outcome === 'not_sent' && c.code === 'admission_refused')), codes);
    }
    // ================================================ UNCERTAIN / UNBOUND ===
    { reset(); const fx = fixture(); ghl.script([{ kind: 'notePost', status: 500, apply: true }]);
      const r = await save(saveEvent(body(fx)));
      const st = await status(statusEvent(fx.opp));
      const w = writes(); const again = await save(saveEvent(body(fx)));
      check('U1 note 500 (uncertain) -> blocked "Repair save needs review. Do not retry this approval."; fields never sent', r.statusCode === 409 && parse(r).code === 'note_uncertain' && parse(r).text === 'Repair save needs review. Do not retry this approval.' && ghl.log.filter((x) => x.kind === 'oppPut').length === 0);
      check('U1 stays blocked: status needs_review; a later save is refused (scope_blocked) with no GHL write', parse(st).kind === 'needs_review' && parse(again).code === 'scope_blocked' && writes() === w);
    }
    { reset(); const fx = fixture(); ghl.script([{ kind: 'notePost', respond: () => ({ note: {} }) }]);
      const r = await save(saveEvent(body(fx)));
      check('U2 note 2xx without a usable id (unbound) -> blocked note_halted; fields never sent; A ADMITTED', parse(r).code === 'note_halted' && ghl.log.filter((x) => x.kind === 'oppPut').length === 0 && stored(fx).state === 'ADMITTED');
    }
    { reset(); const fx = fixture(); ghl.script([{ kind: 'oppPut', status: 500, apply: true }]);
      const r = await save(saveEvent(body(fx)));
      check('U3 fields 500 (uncertain) -> blocked fields_uncertain; no verification read of the note', parse(r).code === 'fields_uncertain' && ghl.log.filter((x) => x.kind === 'noteGet').length === 0);
    }
    // ===================================================== MISMATCH NEVER VERIFIES ===
    for (const [label, rule, want] of [
      ['the bound note body differs by one value', { kind: 'noteGet', body: (b) => b.replace('Line count:', 'Line count: 9') }, 'verify_hold'],
      ['the bound note answers on another contact', { kind: 'noteGet', contactId: 'contactElsewhere' }, 'verify_hold'],
      ['repair_estimate landed as a different value', { kind: 'oppPut', alter: { id: F_EST, value: 1 } }, 'verify_hold'],
    ]) {
      reset(); const fx = fixture(); ghl.script([rule]);
      const r = await save(saveEvent(body(fx)));
      const st = await status(statusEvent(fx.opp));
      check(`M1 ${label} -> blocked (${want}); A not COMPLETED; display needs_review, never checked`, parse(r).outcome === 'blocked' && parse(r).code === want && stored(fx).state !== 'COMPLETED' && parse(st).kind === 'needs_review', [parse(r), parse(st)]);
    }
    // ===================================================== NOT SENT / PENDING ===
    { reset(); const fx = fixture(); blobs.script([{ stage: 'sign', method: 'GET', n: 2, status: 500 }]); // GET signs: 1 = admission read, 2 = the note's D1 read
      const r = await save(saveEvent(body(fx)));
      const s = stored(fx);
      check('N1 note dispatch not_sent (D1 unreadable) -> one zero-send abandonment -> 503 not_sent "Nothing was sent; the save could not start"; A IDLE; no GHL write', r.statusCode === 503 && parse(r).code === 'note_not_sent' && parse(r).error === 'Nothing was sent; the save could not start' && s.state === 'IDLE' && writes() === 0, parse(r));
      const again = await save(saveEvent(body(fx)));
      check('N1 after the release a new approval can be saved and verified', parse(again).outcome === 'verified');
    }
    { reset(); const fx = fixture(); ghl.script([{ kind: 'noteGet', n: 1, hide: true }]);
      const r = await save(saveEvent(body(fx)));
      check('P1 bound note 404 on pass 1 (pending), found on pass 2 -> verified within the one request', parse(r).outcome === 'verified' && ghl.log.filter((x) => x.kind === 'noteGet').length === 2);
    }
    { reset(); const fx = fixture(); ghl.script([1, 2, 3].map((k) => ({ kind: 'noteGet', n: k, hide: true })));
      const r = await save(saveEvent(body(fx)));
      check('P2 bound note 404 on every pass -> blocked (missing after the window); never verified', parse(r).outcome === 'blocked' && stored(fx).state === 'ADMITTED');
    }
    // ============================================================= DISPLAY ===
    { reset(); const fx = fixture();
      const st = await status(statusEvent(fx.opp));
      check('S1 display: no approval and no GHL total -> kind none (nothing claimed)', parse(st).kind === 'none');
      await save(saveEvent(body(fx)));
      ghl.notes.get(fx.contact)[0].body += '\nedited';
      const st2 = await status(statusEvent(fx.opp));
      check('S2 display: completed approval whose note was edited -> "Repair approval could not be verified" (evidence_mismatch), total kept', parse(st2).kind === 'not_verified' && parse(st2).reason === 'evidence_mismatch' && parse(st2).text === 'Repair approval could not be verified' && typeof parse(st2).total === 'number');
    }
    // ============================================== LEGACY PATH WHILE ENABLED ===
    { reset(); const fx = fixture();
      const w = await ghlWrite({ httpMethod: 'POST', isBase64Encoded: false, queryStringParameters: {}, headers: { authorization: `Bearer ${writeToken()}`, origin: ORIGIN }, body: JSON.stringify({ operation: 'opportunity.repairs', targetId: fx.opp, requestId: 'legacyReq002', args: { value: 4321 } }) });
      check('L1 enabled: the legacy opportunity.repairs write is refused (409 not_sent) and sends nothing -- no alternate approval path', w.statusCode === 409 && parse(w).outcome === 'not_sent' && ghl.log.length === 0, [w.statusCode, w.body]);
    }
    // ============================================================== CLIENT ===
    { let seen = null;
      appWriteFetchStub = async (url, init) => { seen = { url, init }; return new Response(JSON.stringify({ outcome: 'verified', total: 1, text: 'x' }), { status: 200 }); };
      readFetchStub = async () => new Response('{}', { status: 503 });
      const C = require('../src/lib/repair-approval-client.ts');
      const a = complete();
      const r = await C.saveRepairApproval('oppClient01', a, MISC, 'reqClient01');
      const sent = JSON.parse(seen.init.body);
      check('CL1 client sends ONLY { opportunityId, requestId, answers, misc } to repair-approval-save (no total, contact or operator)', seen.url === '/.netlify/functions/repair-approval-save' && Object.keys(sent).join() === 'opportunityId,requestId,answers,misc' && r.outcome === 'verified');
      appWriteFetchStub = async () => { throw new Error('network'); };
      const u = await C.saveRepairApproval('oppClient01', a, MISC, 'reqClient02');
      check('CL2 a failed or unreadable save response -> "unknown" with "Do not retry" (never "nothing was sent")', u.outcome === 'unknown' && /Do not retry/.test(u.error));
      const st = await C.fetchRepairApprovalStatus('oppClient01');
      check('CL3 a failed status read -> "unavailable" (never checked)', st.kind === 'unavailable');
    }
    check('hygiene: no request left loopback', blocked.length === 0, blocked);
  } finally {
    globalThis.fetch = realFetch; await B.close(); await G.close();
  }
}

main().then(() => {
  console.log(`\nB1 repair approval integration: ${checks - failures}/${checks} checks passed${failures ? ` (failures=${failures})` : ''}`);
  if (checks < FLOOR) { console.error(`FLOOR only ${checks} checks ran (floor ${FLOOR})`); process.exit(1); }
  process.exit(failures ? 1 : 0);
}, (e) => { console.error('ABORT', e); process.exit(1); });
