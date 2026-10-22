/**
 * B15-26 B1 repair-save completion -- the ENABLED browser path, on the real
 * page, offline (closes the e0af556 "no enabled-browser coverage" gap).
 *
 * Vite serves scripts/harness/repair-approval, which renders the REAL
 * UnderwritingWorkspace in headless Chromium. The repair-approval switch is
 * enabled ONLY inside this test's Vite server (a resolveId alias to
 * harness/repair-approval/enabled-config.ts); the committed
 * shared/repair-approval-config.ts stays `enabled: false` and is checked.
 *
 * Every /.netlify/functions request is answered here. repair-approval-save and
 * repair-approval-status are the REAL handlers (module ea525f6 unchanged),
 * run in this process against loopback fake GHL and Blob services; the page's
 * own reads (contact, pipeline, policy) come from the same fake GHL state. Any
 * other network request is aborted and counted. No credential, no provider.
 *
 * Harness translations (stated, not hidden): the route adapter plays the
 * Netlify edge -- it maps the page's own http://127.0.0.1 Origin to the
 * configured https test origin (requireAppWriteOrigin accepts https only) and
 * attaches the read-session cookie for a viewer who has one (a __Host- cookie
 * cannot be set on http). Netlify duration limits are not modelled.
 */
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const APP = path.resolve(__dirname, '..');
const HARNESS = path.join(APP, 'scripts', 'harness', 'repair-approval');
const ENABLED_CONFIG = path.join(HARNESS, 'enabled-config.ts');
/** Literal check() call-site count in this file, never back-filled from a run. */
const FLOOR = 62;
let checks = 0; let failures = 0;
function check(name, ok, detail) {
  checks += 1; if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}

// ------------------------------------------------------- server-side loader ---
const appRequire = Module.createRequire(path.join(APP, 'package.json'));
const realBlobs = appRequire('@netlify/blobs');
const memStore = new Map();
const memBlobStore = {
  async get(key) { return memStore.has(key) ? memStore.get(key) : null; },
  async delete(key) { memStore.delete(key); },
  async setJSON(key, value, options) { if (options && options.onlyIfNew && memStore.has(key)) return { modified: false }; memStore.set(key, value); return { modified: true }; },
};
const blobsShim = { ...realBlobs, connectLambda: () => {}, getStore: (opts) => (opts && typeof opts === 'object' && opts.siteID && opts.token ? realBlobs.getStore(opts) : memBlobStore) };
const realCfg = (() => { const m = { exports: {} }; const src = ts.transpileModule(fs.readFileSync(path.join(APP, 'shared', 'repair-approval-config.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText; new Function('module', 'exports', 'require', src)(m, m.exports, require); return m.exports; })();
const APPROVAL_FIELD = 'fldApprovalSynthetic01';
const cfgShim = {
  REPAIR_APPROVAL_CONFIG: Object.freeze({ ...realCfg.REPAIR_APPROVAL_CONFIG, enabled: true, approvalFieldId: Object.freeze({ test: APPROVAL_FIELD, production: realCfg.REPAIR_APPROVAL_FIELD_NOT_PROVISIONED }), verifyPassDelayMs: 40 }),
  REPAIR_APPROVAL_FIELD_NOT_PROVISIONED: realCfg.REPAIR_APPROVAL_FIELD_NOT_PROVISIONED,
  REPAIR_APPROVAL_DISABLED: realCfg.REPAIR_APPROVAL_DISABLED,
};
const originalResolve = Module._resolveFilename; const originalLoad = Module._load;
Module._resolveFilename = function (name, parent, ...rest) {
  if (name.startsWith('.') && parent && parent.filename) { const c = path.resolve(path.dirname(parent.filename), name + '.ts'); if (fs.existsSync(c)) return c; }
  return originalResolve.call(this, name, parent, ...rest);
};
Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);
Module._load = function (name, parent, ...rest) {
  if (name === '@netlify/blobs') return blobsShim;
  if (/repair-approval-config$/.test(name)) return cfgShim;
  return originalLoad.call(this, name, parent, ...rest);
};

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

// -------------------------------------------------------------------- fakes ---
function listen(handler) {
  const server = http.createServer((req, res) => { const c = []; req.on('data', (x) => c.push(x)); req.on('end', () => handler(req, res, Buffer.concat(c).toString('utf8'))); });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((q) => server.close(q)) })));
}
const SIGNED_HOST = 'fake-netliblob.s3.us-east-2.amazonaws.com';
function blobFake() {
  const store = new Map(); const signed = new Map(); const log = []; let etagN = 0;
  const api = { store, log };
  api.ready = listen((req, res, body) => {
    const url = new URL(req.url, 'http://x'); const m = req.method;
    if (url.pathname.startsWith('/api/v1/blobs/')) {
      log.push({ stage: 'sign', method: m });
      const key = decodeURIComponent(url.pathname.slice('/api/v1/blobs/'.length)).split('/').slice(2).join('/');
      const id = crypto.randomUUID(); signed.set(id, { key, method: m });
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ url: `https://${SIGNED_HOST}/signed/${id}` }));
    }
    const sg = signed.get(url.pathname.replace('/signed/', '')); log.push({ stage: 'blob', method: m });
    if (!sg || sg.method !== m) { res.writeHead(403); return res.end(); }
    const cur = store.get(sg.key);
    if (m === 'GET') { if (!cur) { res.writeHead(404); return res.end(); } res.writeHead(200, { etag: cur.etag }); return res.end(cur.text); }
    const inm = req.headers['if-none-match']; const im = req.headers['if-match'];
    if ((inm === '*' && cur) || (im && (!cur || cur.etag !== im)) || (!inm && !im)) { res.writeHead(412); return res.end(); }
    const etag = `"e${++etagN}"`; store.set(sg.key, { text: body, etag }); res.writeHead(200, { etag }); return res.end();
  });
  return api;
}
/** GHL fake. A rule may `hold` (await a promise before answering), answer a `status`, or `hide` a note once. */
function ghlFake() {
  const contacts = new Map(); const opps = new Map(); const notes = new Map(); const log = []; let rules = []; const nth = {}; let noteN = 0;
  const api = { contacts, opps, notes, log, script(r) { rules.push(...r); }, reset() { rules = []; for (const k of Object.keys(nth)) delete nth[k]; } };
  api.ready = listen(async (req, res, raw) => {
    const url = new URL(req.url, 'http://x'); const m = req.method; const p = url.pathname.split('/').filter(Boolean);
    const kind = p[0] === 'contacts' && p.length === 2 && m === 'GET' ? 'contactGet'
      : p[0] === 'contacts' && p[2] === 'notes' && p.length === 3 && m === 'POST' ? 'notePost'
      : p[0] === 'contacts' && p[2] === 'notes' && p.length === 4 && m === 'GET' ? 'noteGet'
      : p[0] === 'opportunities' && m === 'GET' ? 'oppGet' : p[0] === 'opportunities' && m === 'PUT' ? 'oppPut' : 'other';
    nth[kind] = (nth[kind] || 0) + 1;
    const rule = rules.find((x) => x.kind === kind && (x.n === undefined || x.n === nth[kind])); if (rule) rules = rules.filter((x) => x !== rule);
    log.push({ kind, method: m, path: url.pathname });
    if (rule && rule.hold) await rule.hold;
    const send = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    let body = null; try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
    if (kind === 'contactGet') { const c = contacts.get(p[1]); return c ? send(200, { contact: c }) : send(404, {}); }
    if (kind === 'oppGet') { const o = opps.get(p[1]); return o ? send(200, { opportunity: JSON.parse(JSON.stringify(o)) }) : send(404, {}); }
    if (kind === 'oppPut') {
      const o = opps.get(p[1]);
      if (o && body && Array.isArray(body.customFields)) for (const f of body.customFields) o.customFields = o.customFields.filter((e) => e.id !== f.id).concat([{ id: f.id, fieldValue: f.field_value }]);
      return send(rule && rule.status ? rule.status : 200, { opportunity: o });
    }
    if (kind === 'notePost') {
      const note = { id: `note${++noteN}x`, body: body && body.body };
      if (!notes.has(p[1])) notes.set(p[1], []); notes.get(p[1]).push(note);
      return send(rule && rule.status ? rule.status : 201, { note: { ...note, contactId: p[1] } });
    }
    if (kind === 'noteGet') {
      if (rule && rule.hide) return send(404, {});
      for (const [cid, list] of notes) { const x = list.find((e) => e.id === p[3]); if (x) return send(200, { note: { id: x.id, body: x.body, contactId: cid } }); }
      return send(404, {});
    }
    return send(404, {});
  });
  return api;
}
function gate() { let open; const promise = new Promise((r) => { open = r; }); return { promise, open }; }

async function main() {
  const blobs = blobFake(); const ghl = ghlFake();
  const [B, G] = [await blobs.ready, await ghl.ready];
  const realFetch = globalThis.fetch; const offlineBlocked = [];
  const MAP = { 'https://services.leadconnectorhq.com': G.origin, 'https://api.netlify.com': B.origin, [`https://${SIGNED_HOST}`]: B.origin };
  globalThis.fetch = (url, init) => { const u = new URL(String(url)); const o = MAP[u.origin]; if (!o) { offlineBlocked.push(u.origin); return Promise.reject(new Error('offline guard: blocked ' + u.origin)); } return realFetch(o + u.pathname + u.search, init); };

  const saveHandler = require('../netlify/functions/repair-approval-save.ts').handler;
  const statusHandler = require('../netlify/functions/repair-approval-status.ts').handler;
  const { issueAppSession } = require('../netlify/functions/lib/app-write-auth.ts');
  const { issueReadSession, appReadConfig } = require('../netlify/functions/lib/app-read-auth.ts');
  const { getConfig } = require('../shared/ghl-config.ts');
  const BA = require('../netlify/functions/lib/blob-authority.ts');
  const { PROVISIONAL_HEADLINE } = require('../src/lib/provisional-repairs.ts');
  const OM = require('../src/lib/repair-estimation/operator-model.ts');
  const config = getConfig('test'); const LOC = config.locationId; const F_EST = config.opportunityFacts.repairs;
  const ROWS = OM.OPERATOR_ROWS.length;
  const NEEDS_REVIEW = BA.READER_TEXT.needsReview; const NOT_VERIFIED = BA.READER_TEXT.notVerified;

  let n = 0;
  const fixture = () => {
    n += 1; const opp = `oppBrowser${String(n).padStart(3, '0')}`; const contact = `contactBrowser${String(n).padStart(3, '0')}`;
    ghl.contacts.set(contact, { id: contact, locationId: LOC, firstName: 'Fixture', lastName: `Browser${n}`, customFields: [] });
    ghl.opps.set(opp, { id: opp, locationId: LOC, contactId: contact, pipelineId: config.pipelines.sellerLeads, customFields: [] });
    return { opp, contact, scope: `repair-approval:test:${LOC}:${opp}` };
  };
  const stored = (fx) => { const s = blobs.store.get(BA.authorityKey(fx.scope)); return s ? JSON.parse(s.text) : null; };
  const oppValue = (fx, id) => { const f = ghl.opps.get(fx.opp).customFields.find((x) => x.id === id); return f ? f.fieldValue : undefined; };
  const notesOf = (fx) => (ghl.notes.get(fx.contact) || []).length;

  // ----------------------------------------------------- route adapter state ---
  const calls = [];           // { fn, method, status, outcome?, kind? }
  const foreign = [];
  const unmodeled = [];
  let statusHolds = [];       // gates applied to the NEXT status responses, in order (handler runs first; the reply waits)
  let statusUnconfigured = false;
  const readCookie = () => `__Host-iaos_read=${issueReadSession(OPERATOR, appReadConfig()).token}`;
  const pipelineFor = () => ({
    pipelineId: config.pipelines.sellerLeads, stages: [],
    opportunities: [...ghl.opps.values()].map((o) => ({ id: o.id, contactId: o.contactId, contactName: 'Fixture', opportunityName: `${o.id} deal`, phone: '', email: '', stageId: 'fixture-stage',
      customFields: o.customFields.map((f) => (typeof f.fieldValue === 'number' ? { id: f.id, fieldValueNumber: f.fieldValue, fieldValue: f.fieldValue } : { id: f.id, fieldValueString: f.fieldValue, fieldValue: f.fieldValue })) })),
  });

  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const { chromium } = require('playwright');
  const enableAlias = {
    name: 'iaos-repair-approval-enabled-for-this-test-only', enforce: 'pre',
    resolveId(source, importer) {
      if (!/repair-approval-config(\.ts)?$/.test(source) || !importer) return null;
      if (path.resolve(importer.split('?')[0]) === path.resolve(ENABLED_CONFIG)) return null; // the stand-in itself reads the committed file
      return ENABLED_CONFIG;
    },
  };
  const server = await createServer({
    root: APP, configFile: false, plugins: [enableAlias, react()], logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: ['scripts/harness/repair-approval/index.html'], include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] },
  });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  // The LEGACY (committed, disabled) path: the same harness served WITHOUT the alias, so the page runs on enabled: false.
  const legacyServer = await createServer({
    root: APP, configFile: false, plugins: [react()], logLevel: 'error', clearScreen: false, cacheDir: path.join(APP, 'node_modules', '.vite-repair-approval-legacy'),
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: ['scripts/harness/repair-approval/index.html'], include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] },
  });
  await legacyServer.listen();
  const legacyBase = legacyServer.resolvedUrls.local[0].replace(/\/$/, '');
  const legacyWrites = []; let legacyHold = null;
  const browser = await chromium.launch();
  const pageErrors = [];

  async function adapter(route, viewer) {
    const req = route.request(); const url = req.url();
    if ((url.startsWith(base) || url.startsWith(legacyBase)) && !url.includes('/.netlify/functions/')) return route.continue();
    if (!url.includes('/.netlify/functions/')) { foreign.push(url); return route.abort(); }
    const u = new URL(url); const fn = u.pathname.replace('/.netlify/functions/', ''); const method = req.method();
    const fulfill = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (fn === 'ghl-proxy') {
      const p = u.searchParams.get('path') || ''; const m = p.match(/^\/contacts\/([^/?]+)$/);
      if (m && ghl.contacts.has(m[1])) return fulfill(200, { contact: ghl.contacts.get(m[1]) });
      if (/^\/locations\/[^/]+\/customFields$/.test(p)) return fulfill(200, { customFields: [] }); // field definitions (labels only)
      const o = p.match(/^\/opportunities\/([^/?]+)$/); // the legacy save's readback
      if (o && ghl.opps.has(o[1])) return fulfill(200, { opportunity: JSON.parse(JSON.stringify(ghl.opps.get(o[1]))) });
      unmodeled.push(`ghl-proxy ${p}`); return fulfill(404, { error: 'fixture does not model this path' });
    }
    if (fn === 'ghl-opportunities') return fulfill(200, pipelineFor());
    if (fn === 'ghl-underwriting-policy') return fulfill(200, { values: [] });
    if (fn === 'ghl-write' && method === 'POST') { // the legacy repair-total write, as ghl-write's opportunity.repairs applies it
      const b = JSON.parse(req.postData() || '{}'); const w = { op: b.operation, targetId: b.targetId, value: b.args && b.args.value }; legacyWrites.push(w);
      if (legacyHold) await legacyHold.promise;
      const o = ghl.opps.get(b.targetId);
      if (b.operation !== 'opportunity.repairs' || !o) return fulfill(400, { outcome: 'not_sent', error: 'fixture models opportunity.repairs only' });
      o.customFields = o.customFields.filter((f) => f.id !== F_EST).concat([{ id: F_EST, fieldValue: w.value }]);
      return fulfill(200, { confirmed: true });
    }
    if (fn === 'repair-approval-save' || fn === 'repair-approval-status') {
      const h = await req.allHeaders();
      const headers = {};
      if (h.authorization) headers.authorization = h.authorization;
      if (h.origin) headers.origin = h.origin === base || h.origin === legacyBase ? ORIGIN : h.origin; // the edge: same-origin page -> the configured https origin
      if (viewer.readSession) headers.cookie = readCookie();
      const event = { httpMethod: method, isBase64Encoded: false, headers, queryStringParameters: Object.fromEntries(u.searchParams), body: req.postData() ?? null };
      let opp = u.searchParams.get('opportunityId'); try { if (!opp && req.postData()) opp = JSON.parse(req.postData()).opportunityId; } catch { /* not JSON */ }
      const call = { fn, method, opp }; calls.push(call);
      let r;
      if (fn === 'repair-approval-status' && statusUnconfigured) {
        const saved = process.env.IAOS_REPAIR_AUTHORITY_TOKEN; delete process.env.IAOS_REPAIR_AUTHORITY_TOKEN;
        try { r = await statusHandler(event); } finally { process.env.IAOS_REPAIR_AUTHORITY_TOKEN = saved; }
      } else r = await (fn === 'repair-approval-save' ? saveHandler : statusHandler)(event);
      call.status = r.statusCode; try { const b = JSON.parse(r.body); call.outcome = b.outcome; call.kind = b.kind; call.code = b.code; } catch { /* not JSON */ }
      if (fn === 'repair-approval-status' && statusHolds.length) { const g = statusHolds.shift(); await g.promise; }
      return route.fulfill({ status: r.statusCode, contentType: 'application/json', body: r.body });
    }
    unmodeled.push(fn); return fulfill(404, { error: `fixture does not model ${fn}` });
  }

  /** A fresh browser context per viewer: its own JS state, write session (or none) and read session. */
  async function open(fx, viewer = { write: true, readSession: true }) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, timezoneId: 'America/Chicago' });
    if (viewer.write) {
      const s = viewer.badToken ? { token: 'not-a-valid-session-token', expiresAt: '2099-01-01T00:00:00.000Z' } : issueAppSession(OPERATOR);
      await context.addInitScript((sess) => { window.__iaosWriteSession = sess; }, s);
    }
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) pageErrors.push(`console: ${m.text()}`); });
    await page.route('**/*', (route) => adapter(route, viewer));
    // The harness page, then the real route inside its router (a direct /contacts/... load would be the app's own index.html).
    await page.goto(`${viewer.legacy ? legacyBase : base}/scripts/harness/repair-approval/index.html`); await page.getByTestId('elsewhere').waitFor({ timeout: 60000 });
    await page.evaluate((c) => window.__iaosNavigate(`/contacts/${c}/underwriting`), fx.contact);
    try { await (viewer.legacy ? page.getByRole('button', { name: 'Approve and save repair total', exact: true }) : page.getByTestId('repair-approval-approve')).waitFor({ timeout: 60000 }); }
    catch (e) { console.error('OPEN FAILED', { body: (await page.locator('body').innerText().catch(() => '')).slice(0, 1500), pageErrors, unmodeled, calls }); throw e; }
    return { page, context, T: (id) => page.getByTestId(id) };
  }
  const settle = (page, ms = 300) => page.waitForTimeout(ms);
  const pick = async (page, i, label) => page.getByRole('button', { name: label, exact: true }).nth(i).click();
  /** Row 0 Repair (an approved amount), every other row Good: a complete estimate. */
  const completeEstimate = async (page) => { await pick(page, 0, 'Repair'); for (let i = 1; i < ROWS; i++) await pick(page, i, 'Good'); };
  const shownTotal = async (page) => Number((await page.getByTestId('repair-preliminary-total').textContent()).replace(/[^0-9.]/g, ''));
  const saves = () => calls.filter((c) => c.fn === 'repair-approval-save');
  const text = async (loc) => ((await loc.count()) ? (await loc.textContent()).trim() : null);
  const waitText = (loc, re, timeout = 15000) => loc.filter({ hasText: re }).first().waitFor({ timeout }).then(() => true, () => false);

  try {
    // ------------------------------------------------------------- harness ---
    const committedSrc = fs.readFileSync(path.join(APP, 'shared', 'repair-approval-config.ts'), 'utf8');
    { const fx = fixture(); const { page, context, T } = await open(fx);
      check('H1 committed switch is disabled: shared/repair-approval-config.ts says enabled: false, and the page saw the committed value (only this test aliases it on)',
        /\n\s+enabled: false,\n/.test(committedSrc.replace(/\r\n/g, '\n')) && realCfg.REPAIR_APPROVAL_CONFIG.enabled === false && (await page.evaluate(() => window.__repairApprovalCommittedEnabled)) === false);
      check('H2 the enabled action bar rendered on the real page (enabled-only control present)', (await T('repair-approval-approve').count()) === 1 && (await page.getByText('Approving records the total, a repair-approval note and the approval id').count()) === 1);
      await settle(page);
      const st = calls.filter((c) => c.fn === 'repair-approval-status');
      check('H3 one status read on load (no polling), answered by the real handler: none for a deal with no total', st.length === 1 && st[0].status === 200 && st[0].kind === 'none' && (await T('repair-approval-status').count()) === 0, st);
      // ------------------------------------------------------- incomplete ---
      const btn = T('repair-approval-approve');
      check('I1 nothing answered: Approve is disabled and the provisional headline is shown', (await btn.isDisabled()) && (await text(T('repair-approval-incomplete'))) === PROVISIONAL_HEADLINE);
      for (let i = 0; i < ROWS - 1; i++) await pick(page, i, 'Good');
      await btn.click({ force: true }).catch(() => {}); await settle(page);
      check('I2 six of seven rows answered: still disabled, still provisional; a forced click sends no save request', (await btn.isDisabled()) && (await T('repair-approval-incomplete').count()) === 1 && saves().length === 0);
      await pick(page, ROWS - 1, 'Good');
      check('I3 the seventh answer completes the estimate: Approve enabled, headline gone', !(await btn.isDisabled()) && (await T('repair-approval-incomplete').count()) === 0);
      await context.close();
    }

    // -------------------------------------- success, with duplicate clicks ---
    { const fx = fixture(); calls.length = 0; const { page, context, T } = await open(fx);
      await completeEstimate(page); const total = await shownTotal(page);
      const hold = gate(); ghl.reset(); ghl.script([{ kind: 'notePost', hold: hold.promise }]);
      const btn = T('repair-approval-approve');
      await btn.evaluate((b) => { b.click(); b.click(); b.click(); }); // three clicks in one task, before React re-renders
      await page.getByText('Saving the repair approval to this deal, then verifying it in GHL').waitFor({ timeout: 10000 });
      check('S1 while saving: "Saving…" on a disabled button plus the saving line', (await btn.isDisabled()) && (await text(btn)) === 'Saving…');
      await btn.click({ force: true }).catch(() => {}); await settle(page);
      check('S2 duplicate clicks (3 in one task + 1 forced while saving): exactly ONE save request reached the server', saves().length === 1, saves());
      hold.open();
      const ok = await waitText(T('repair-approval-result'), /^Recorded repair approval — checked as of /);
      check('S3 verified: the result is the accepted checked text', ok, await text(T('repair-approval-result')));
      await waitText(T('repair-approval-status'), /^Recorded repair approval — checked as of /);
      check('S4 the status line re-read after the save shows checked (one read on load + one after the save)', /^Recorded repair approval — checked as of /.test(await text(T('repair-approval-status'))) && calls.filter((c) => c.fn === 'repair-approval-status').length === 2);
      const a = stored(fx);
      check('S5 GHL holds the shown total and the approval id; one note; the authority record is COMPLETED for that op', oppValue(fx, F_EST) === total && a && a.state === 'COMPLETED' && oppValue(fx, APPROVAL_FIELD) === a.op.opId && notesOf(fx) === 1, { total, ghl: oppValue(fx, F_EST), state: a && a.state, notes: notesOf(fx) });
      check('S6 settled: Approve stays disabled for the same estimate (no second submit of a verified approval)', await btn.isDisabled());

      // ------------------------- changed estimate -> explicit re-approval (D-2) ---
      const before = saves().length; const firstOp = a.op.opId;
      await pick(page, 1, 'Repair'); await settle(page);
      const total2 = await shownTotal(page);
      check('R1 an edit re-enables Approve and clears the previous result, without sending anything', !(await btn.isDisabled()) && (await T('repair-approval-result').count()) === 0 && saves().length === before && total2 !== total);
      const stale = await text(T('repair-approval-status'));
      check('R2 OBSERVED (D-3 decision): after the edit the status line still reads the PREVIOUS checked approval and names no total, beside a different on-screen total', /^Recorded repair approval — checked as of /.test(stale) && !stale.includes('$'), stale);
      await btn.click();
      const ok2 = await waitText(T('repair-approval-result'), /^Recorded repair approval — checked as of /);
      const a2 = stored(fx);
      check('R3 the explicit second approval verifies: new total in GHL, new op id, a second note; the first op is no longer the record', ok2 && oppValue(fx, F_EST) === total2 && a2.state === 'COMPLETED' && a2.op.opId !== firstOp && oppValue(fx, APPROVAL_FIELD) === a2.op.opId && notesOf(fx) === 2 && saves().length === before + 1);
      await context.close();
    }

    // ----------------------------------------- blocked (uncertain note) ---
    { const fx = fixture(); calls.length = 0; const { page, context, T } = await open(fx);
      await completeEstimate(page);
      ghl.reset(); ghl.script([{ kind: 'notePost', status: 500 }]);
      await T('repair-approval-approve').click();
      const ok = await waitText(T('repair-approval-result'), NEEDS_REVIEW);
      check('B1 an uncertain note write: result is "Repair save needs review. Do not retry this approval."', ok && (await text(T('repair-approval-result'))) === NEEDS_REVIEW);
      await waitText(T('repair-approval-status'), NEEDS_REVIEW);
      check('B2 status needs review; Approve disabled; no retry was sent', (await text(T('repair-approval-status'))) === NEEDS_REVIEW && (await T('repair-approval-approve').isDisabled()) && saves().length === 1 && stored(fx).state === 'ADMITTED');
      await context.close();
      const v2 = await open(fx); await completeEstimate(v2.page); await settle(v2.page);
      check('B3 a fresh page for the blocked deal: needs review on load, Approve disabled even with a complete estimate; nothing sent', (await text(v2.T('repair-approval-status'))) === NEEDS_REVIEW && (await v2.T('repair-approval-approve').isDisabled()) && saves().length === 1);
      await v2.context.close();
    }

    // ------------------- pending verification pass, and a second viewer mid-save ---
    { const fx = fixture(); calls.length = 0; const { page, context, T } = await open(fx);
      await completeEstimate(page);
      const hold = gate(); ghl.reset(); ghl.script([{ kind: 'oppPut', hold: hold.promise }, { kind: 'noteGet', n: 1, hide: true }]);
      await T('repair-approval-approve').click();
      await page.getByText('Saving the repair approval to this deal').waitFor();
      for (let i = 0; i < 50 && ghl.log.filter((e) => e.kind === 'oppPut').length === 0; i++) await settle(page, 100);
      const other = await open(fx); await settle(other.page);
      check('P1 OBSERVED (D-2): a second viewer during the outstanding save sees the module\'s needs-review text (ADMITTED reads as needs review, not "pending") and cannot submit', (await text(other.T('repair-approval-status'))) === NEEDS_REVIEW && (await other.T('repair-approval-approve').isDisabled()));
      hold.open();
      const ok = await waitText(T('repair-approval-result'), /^Recorded repair approval — checked as of /);
      check('P2 a pending first verification pass (note 404 once) then verified on the next pass', ok && ghl.log.filter((e) => e.kind === 'noteGet').length >= 2 && stored(fx).state === 'COMPLETED');
      await other.page.evaluate(() => window.__iaosNavigate('/elsewhere')); await other.page.getByTestId('elsewhere').waitFor();
      await other.page.evaluate((c) => window.__iaosNavigate(`/contacts/${c}/underwriting`), fx.contact);
      await other.T('repair-approval-approve').waitFor(); await settle(other.page);
      check('P3 the second viewer, after leaving and returning (no automatic polling), reads checked', /^Recorded repair approval — checked as of /.test(await text(other.T('repair-approval-status'))));
      await other.context.close(); await context.close();
    }

    // ------------------------------------------------------ unavailable ---
    { const fx = fixture(); statusUnconfigured = true; calls.length = 0; const { page, context, T } = await open(fx);
      await settle(page); statusUnconfigured = false;
      const s = await text(T('repair-approval-status'));
      check('U1 status read refused (503: authority not configured) -> "Repair approval could not be verified", never checked', s === NOT_VERIFIED, s);
      await completeEstimate(page);
      check('U2 OBSERVED (D-7): an unavailable status does not disable Approve; the server decides admission', !(await T('repair-approval-approve').isDisabled()));
      await context.close();
    }
    { const fx = fixture(); ghl.opps.get(fx.opp).customFields.push({ id: F_EST, fieldValue: 41000 });
      const { page, context, T } = await open(fx); await settle(page);
      const s = await text(T('repair-approval-status'));
      check('U3 a legacy total with no authority record (D-5): "Repair approval could not be verified (no_recorded_approval)"', s === `${NOT_VERIFIED} (no_recorded_approval)`, s);
      await context.close();
    }

    // -------------------------------------------------------- view-only ---
    { const fx = fixture(); calls.length = 0; const { page, context, T } = await open(fx, { write: false, readSession: true });
      await settle(page);
      check('V1 view-only (read session, no write session): the status loads', calls.filter((c) => c.fn === 'repair-approval-status' && c.status === 200).length === 1);
      await completeEstimate(page); await T('repair-approval-approve').click(); await settle(page, 600);
      const r = await text(T('repair-approval-result'));
      check('V2 view-only click: no save request leaves the browser, and nothing is written', saves().length === 0 && notesOf(fx) === 0 && stored(fx) === null);
      check('V3 view-only click says sign-in is needed and nothing was submitted -- never "could not be confirmed / Do not retry"', r !== null && /Sign in for application writes/.test(r) && !/Do not retry|could not be confirmed/.test(r), r);
      check('V4 view-only: Approve stays available after signing in would be possible (not settled by a refusal)', !(await T('repair-approval-approve').isDisabled()));
      await context.close();
    }
    { const fx = fixture(); calls.length = 0; const { page, context, T } = await open(fx, { write: true, badToken: true, readSession: true });
      await completeEstimate(page); await T('repair-approval-approve').click(); await settle(page, 600);
      const r = await text(T('repair-approval-result'));
      check('V5 a write session the server refuses (401): one request, refused before any I/O, nothing written', saves().length === 1 && saves()[0].status === 401 && notesOf(fx) === 0 && stored(fx) === null);
      check('V6 a 401 refusal reads as sign-in needed / nothing submitted -- never "could not be confirmed / Do not retry"', r !== null && /Sign in for application writes/.test(r) && !/Do not retry|could not be confirmed/.test(r), r);
      await context.close();
    }

    // ------------------------------------ navigation during an outstanding save ---
    { const fx = fixture(); calls.length = 0; const { page, context, T } = await open(fx);
      await completeEstimate(page);
      const hold = gate(); ghl.reset(); ghl.script([{ kind: 'notePost', hold: hold.promise }]);
      await T('repair-approval-approve').click();
      await page.getByText('Saving the repair approval to this deal').waitFor();
      for (let i = 0; i < 50 && ghl.log.filter((e) => e.kind === 'notePost').length === 0; i++) await settle(page, 100);
      await page.evaluate(() => window.__iaosNavigate('/elsewhere')); await page.getByTestId('elsewhere').waitFor();
      await page.evaluate((c) => window.__iaosNavigate(`/contacts/${c}/underwriting`), fx.contact);
      await T('repair-approval-approve').waitFor(); await settle(page);
      check('N1 back on the deal while the first save is still open: needs review on remount, Approve disabled, the saving line gone', (await text(T('repair-approval-status'))) === NEEDS_REVIEW && (await T('repair-approval-approve').isDisabled()) && (await page.getByText('Saving the repair approval').count()) === 0);
      await completeEstimate(page); await settle(page);
      check('N2 remount with a complete estimate still cannot submit: one save request in total', (await T('repair-approval-approve').isDisabled()) && saves().length === 1);
      hold.open();
      for (let i = 0; i < 60 && stored(fx).state !== 'COMPLETED'; i++) await settle(page, 100);
      check('N3 the abandoned page\'s save completes server-side (verified, COMPLETED) with no browser error', stored(fx).state === 'COMPLETED' && saves()[0].outcome === 'verified');
      await page.evaluate(() => window.__iaosNavigate('/elsewhere')); await page.getByTestId('elsewhere').waitFor();
      await page.evaluate((c) => window.__iaosNavigate(`/contacts/${c}/underwriting`), fx.contact);
      await T('repair-approval-approve').waitFor(); await settle(page);
      check('N4 the next visit reads checked', /^Recorded repair approval — checked as of /.test(await text(T('repair-approval-status'))));
      await context.close();
    }

    // ------------------------------------------ editing during an outstanding save ---
    { const fx = fixture(); calls.length = 0; const { page, context, T } = await open(fx);
      await completeEstimate(page); const submitted = await shownTotal(page);
      const hold = gate(); ghl.reset(); ghl.script([{ kind: 'notePost', hold: hold.promise }]);
      await T('repair-approval-approve').click();
      await page.getByText('Saving the repair approval to this deal').waitFor();
      await pick(page, 1, 'Repair'); const edited = await shownTotal(page);
      hold.open();
      for (let i = 0; i < 60 && !(stored(fx) && stored(fx).state === 'COMPLETED'); i++) await settle(page, 100);
      await settle(page);
      check('E1 an edit during the save does not change what is saved: GHL holds the SUBMITTED total, not the edited one', oppValue(fx, F_EST) === submitted && edited !== submitted);
      check('E2 OBSERVED (D-3): the result for the superseded estimate is not shown; the status line reads checked (the submitted total) beside the edited total, and Approve is enabled for the edit',
        (await T('repair-approval-result').count()) === 0 && /^Recorded repair approval — checked as of /.test(await text(T('repair-approval-status'))) && !(await T('repair-approval-approve').isDisabled()));
      await context.close();
    }

    // ------------------------------------------------- out-of-order status reads ---
    { const fx = fixture(); const late = gate(); statusHolds = [late]; // the load-time read is answered LAST
      calls.length = 0; const { page, context, T } = await open(fx);
      await completeEstimate(page); await T('repair-approval-approve').click();
      await waitText(T('repair-approval-result'), /^Recorded repair approval — checked as of /);
      await waitText(T('repair-approval-status'), /^Recorded repair approval — checked as of /, 5000);
      late.open(); await settle(page, 500);
      const s = await text(T('repair-approval-status'));
      check('O1 a slow load-time status read ("none") answered after the post-save read never replaces the newer checked status', s !== null && /^Recorded repair approval — checked as of /.test(s), s);
      await context.close(); statusHolds = [];
    }

    // ------------- direct deal navigation A -> B inside the underwriting route (Bones P1, bf18928 REVISE) ---
    const goDeal = (page, fx) => page.evaluate((c) => window.__iaosNavigate(`/contacts/${c}/underwriting`), fx.contact);
    const leaks = async (T, page) => ({ status: await text(T('repair-approval-status')), result: await text(T('repair-approval-result')),
      saving: await page.getByText('Saving the repair approval').count(), button: await text(T('repair-approval-approve')) });
    { const fxA = fixture(); const fxB = fixture();
      ghl.opps.get(fxA.opp).customFields.push({ id: F_EST, fieldValue: 41000 }); // A's delayed load-time read is visible if it leaks (no_recorded_approval)
      const lateA = gate(); statusHolds = [lateA]; calls.length = 0;
      const { page, context, T } = await open(fxA);
      await completeEstimate(page);
      const hold = gate(); ghl.reset(); ghl.script([{ kind: 'notePost', hold: hold.promise }]);
      await T('repair-approval-approve').click();
      for (let i = 0; i < 50 && !ghl.log.some((e) => e.kind === 'notePost'); i++) await settle(page, 100);
      await goDeal(page, fxB); await page.waitForURL(new RegExp(fxB.contact)); await settle(page, 800);
      const bStatus = calls.filter((c) => c.fn === 'repair-approval-status' && c.opp === fxB.opp);
      const l1 = await leaks(T, page);
      check('NAV1 A->B with A\'s save held: B\'s own status read is "none", B has no authority record, and B shows no status, result or saving state from A',
        bStatus.length === 1 && bStatus[0].kind === 'none' && stored(fxB) === null && l1.status === null && l1.result === null && l1.saving === 0 && l1.button === 'Approve and save repair total', { bStatus, l1 });
      hold.open();
      for (let i = 0; i < 60 && !(stored(fxA) && stored(fxA).state === 'COMPLETED'); i++) await settle(page, 100);
      await settle(page, 800); lateA.open(); await settle(page, 800); statusHolds = [];
      const l2 = await leaks(T, page);
      check('NAV2 after A\'s save verifies and A\'s delayed load-time status is answered, B still shows none of A\'s approval, errors, blocked or save state (Bones repro)',
        page.url().includes(fxB.contact) && stored(fxA).state === 'COMPLETED' && stored(fxB) === null && l2.status === null && l2.result === null && l2.saving === 0 && l2.button === 'Approve and save repair total', l2);
      const aAfter = calls.filter((c) => c.fn === 'repair-approval-status' && c.opp === fxA.opp);
      check('NAV3 the stale A completion started no status request (only A\'s own load-time read exists) and B sent no save', aAfter.length === 1 && saves().filter((c) => c.opp === fxB.opp).length === 0, aAfter);
      check('NAV4 the dispatched A write was neither cancelled nor retried: one A save, verified, one note', saves().length === 1 && saves()[0].outcome === 'verified' && notesOf(fxA) === 1);
      await context.close();
    }
    { const fxA = fixture(); const fxB = fixture(); calls.length = 0;
      const { page, context, T } = await open(fxA);
      await completeEstimate(page);
      const hold = gate(); ghl.reset(); ghl.script([{ kind: 'notePost', hold: hold.promise }]);
      await T('repair-approval-approve').click();
      for (let i = 0; i < 50 && !ghl.log.some((e) => e.kind === 'notePost'); i++) await settle(page, 100);
      await goDeal(page, fxB); await page.waitForURL(new RegExp(fxB.contact)); await settle(page, 600);
      await goDeal(page, fxA); await page.waitForURL(new RegExp(fxA.contact)); await settle(page, 800);
      const back = await leaks(T, page);
      check('NAV5 A->B->A while the first A save is open: the new A visit shows its own fresh read (needs review: ADMITTED), not the old save\'s saving state', back.status === NEEDS_REVIEW && back.saving === 0 && back.result === null, back);
      const aReads = calls.filter((c) => c.fn === 'repair-approval-status' && c.opp === fxA.opp).length;
      hold.open();
      for (let i = 0; i < 60 && !(stored(fxA) && stored(fxA).state === 'COMPLETED'); i++) await settle(page, 100);
      await settle(page, 800);
      const after = await leaks(T, page);
      check('NAV6 the old A operation completing does not pass on the revisit merely because the id matches again: no result text and no status request from it',
        stored(fxA).state === 'COMPLETED' && after.result === null && after.saving === 0 && after.status === NEEDS_REVIEW && calls.filter((c) => c.fn === 'repair-approval-status' && c.opp === fxA.opp).length === aReads, { after, aReads });
      await goDeal(page, fxB); await page.waitForURL(new RegExp(fxB.contact)); await settle(page, 400);
      await goDeal(page, fxA); await page.waitForURL(new RegExp(fxA.contact)); await settle(page, 800);
      check('NAV7 the next A visit reads checked (its own fresh read); exactly one save was ever sent', /^Recorded repair approval — checked as of /.test(await text(T('repair-approval-status'))) && saves().length === 1);
      await context.close();
    }
    { const fxA = fixture(); const fxB = fixture(); calls.length = 0;
      ghl.opps.get(fxA.opp).customFields.push({ id: F_EST, fieldValue: 41000 }); // A's held read answers not_verified: visible if it leaks
      const lateA = gate(); statusHolds = [lateA];
      const { page, context, T } = await open(fxA);
      await goDeal(page, fxB); await page.waitForURL(new RegExp(fxB.contact)); await settle(page, 600);
      lateA.open(); await settle(page, 800); statusHolds = [];
      check('NAV8 a delayed A status read (no save involved) answered after A->B never reaches B', (await text(T('repair-approval-status'))) === null);
      await context.close();
    }

    // ------------- repair ANSWERS belong to the opportunity being edited (Jess ruling on 628d70a) ---
    const unanswered = (page) => page.locator('[data-testid^="repair-unanswered-"]').count();
    const fresh = async (page) => (await unanswered(page)) === ROWS && (await shownTotal(page)) === 0;
    const onDeal = async (page, fx, sel) => { await goDeal(page, fx); await page.waitForURL(new RegExp(fx.contact)); await sel.waitFor({ timeout: 30000 }); await settle(page, 500); };
    // Enabled path.
    { const fxA = fixture(); const fxB = fixture(); calls.length = 0;
      const { page, context, T } = await open(fxA);
      await completeEstimate(page);
      check('CA1 A answered: complete, Approve enabled', (await unanswered(page)) === 0 && !(await T('repair-approval-approve').isDisabled()));
      await onDeal(page, fxB, T('repair-approval-approve'));
      check('CA2 A->B: B opens with a FRESH estimate (7 unanswered, $0), Approve disabled as incomplete; nothing sent',
        (await fresh(page)) && (await T('repair-approval-approve').isDisabled()) && (await T('repair-approval-incomplete').count()) === 1 && saves().length === 0);
      await onDeal(page, fxA, T('repair-approval-approve'));
      check('CA3 A->B->A: A also opens fresh -- no answers or approval state carried across deals in either direction', (await fresh(page)) && (await T('repair-approval-result').count()) === 0 && (await T('repair-approval-approve').isDisabled()));
      await context.close();
    }
    { const fxA = fixture(); const fxB = fixture(); calls.length = 0;
      const { page, context, T } = await open(fxA);
      await completeEstimate(page);
      // Navigate and click in the SAME task, then again on the next ticks: whatever Approve exists then.
      await page.evaluate((c) => { window.__iaosNavigate(`/contacts/${c}/underwriting`); document.querySelector('[data-testid="repair-approval-approve"]')?.click();
        setTimeout(() => document.querySelector('[data-testid="repair-approval-approve"]')?.click(), 0); setTimeout(() => document.querySelector('[data-testid="repair-approval-approve"]')?.click(), 60); }, fxB.contact);
      await page.waitForURL(new RegExp(fxB.contact)); await T('repair-approval-approve').waitFor(); await settle(page, 1500);
      check('CA4 immediate save attempts during A->B: no save request ever names B, B holds no record or total, and no A answers reached B',
        saves().every((c) => c.opp === fxA.opp) && stored(fxB) === null && oppValue(fxB, F_EST) === undefined && (await fresh(page)), saves());
      check('CA5 B shows no result, saving line or status from those attempts', (await T('repair-approval-result').count()) === 0 && (await page.getByText('Saving the repair approval').count()) === 0 && (await T('repair-approval-status').count()) === 0);
      await context.close();
    }
    { const fxA = fixture(); const fxB = fixture(); calls.length = 0;
      const { page, context, T } = await open(fxA);
      await completeEstimate(page);
      const hold = gate(); ghl.reset(); ghl.script([{ kind: 'notePost', hold: hold.promise }]);
      await T('repair-approval-approve').click();
      for (let i = 0; i < 50 && !ghl.log.some((e) => e.kind === 'notePost'); i++) await settle(page, 100);
      await onDeal(page, fxB, T('repair-approval-approve'));
      hold.open();
      for (let i = 0; i < 60 && !(stored(fxA) && stored(fxA).state === 'COMPLETED'); i++) await settle(page, 100);
      await settle(page, 800);
      check('CA6 A\'s save held across A->B then completed: B stays fresh and incomplete with no A result; A\'s write was not cancelled or retried',
        (await fresh(page)) && (await T('repair-approval-result').count()) === 0 && (await T('repair-approval-approve').isDisabled()) && stored(fxA).state === 'COMPLETED' && saves().length === 1 && stored(fxB) === null);
      await onDeal(page, fxA, T('repair-approval-approve'));
      check('CA7 back on A after its save completed: fresh answers (nothing re-derived from the saved total), no old result; status is A\'s own fresh read',
        (await fresh(page)) && (await T('repair-approval-result').count()) === 0 && /^Recorded repair approval — checked as of /.test(await text(T('repair-approval-status'))));
      await completeEstimate(page); await pick(page, 1, 'Repair');
      await T('repair-approval-approve').click();
      const ok = await waitText(T('repair-approval-result'), /^Recorded repair approval — checked as of /);
      await settle(page, 1200); // the save's own page re-read (onPersisted) on the same deal
      check('CA8 same deal: a normal save verifies and the page re-read after it keeps this deal\'s answers (no remount on the same opportunity)',
        ok && (await unanswered(page)) === 0 && (await T('repair-approval-result').count()) === 1 && oppValue(fxA, F_EST) === (await shownTotal(page)));
      await context.close();
    }
    // Legacy (committed, disabled) path, on the same page served without the alias.
    { const fxA = fixture(); const fxB = fixture(); legacyWrites.length = 0; calls.length = 0;
      const legacy = { write: true, readSession: true, legacy: true };
      const { page, context } = await open(fxA, legacy);
      const approve = page.getByRole('button', { name: 'Approve and save repair total', exact: true });
      await settle(page);
      check('LG1 legacy harness: the disabled UI is rendered (no enabled control, no repair-approval request)', (await page.getByTestId('repair-approval-approve').count()) === 0 && !calls.some((c) => c.fn.startsWith('repair-approval')));
      await completeEstimate(page);
      await onDeal(page, fxB, approve);
      check('LG2 legacy A->B: B opens with a fresh estimate (7 unanswered, $0)', await fresh(page));
      await onDeal(page, fxA, approve);
      check('LG3 legacy A->B->A: A opens fresh too', await fresh(page));
      await completeEstimate(page); const totalA = await shownTotal(page);
      legacyHold = gate(); await approve.click();
      for (let i = 0; i < 50 && legacyWrites.length === 0; i++) await settle(page, 100);
      await onDeal(page, fxB, approve);
      legacyHold.open(); legacyHold = null; await settle(page, 1200);
      check('LG4 legacy save held across A->B then confirmed: it wrote A only, once, with A\'s total; B has no total', legacyWrites.length === 1 && legacyWrites[0].targetId === fxA.opp && oppValue(fxA, F_EST) === totalA && oppValue(fxB, F_EST) === undefined, legacyWrites);
      check('LG5 legacy: B shows no "saved" / "Sent" / error line from A\'s save and stays fresh', (await page.getByText('Repair total saved to this deal').count()) === 0 && (await page.getByText(/^Sent \$/).count()) === 0 && (await fresh(page)));
      await completeEstimate(page);
      await page.evaluate((c) => { window.__iaosNavigate(`/contacts/${c}/underwriting`); [...document.querySelectorAll('button')].find((b) => b.textContent === 'Approve and save repair total')?.click(); }, fxA.contact);
      await page.waitForURL(new RegExp(fxA.contact)); await approve.waitFor(); await settle(page, 1200);
      check('LG6 legacy immediate save during B->A: any write from that task is B\'s own (never A with B\'s answers), A keeps its total, and A opens fresh',
        legacyWrites.slice(1).every((w) => w.targetId === fxB.opp) && oppValue(fxA, F_EST) === totalA && (await fresh(page)), legacyWrites);
      await completeEstimate(page); await pick(page, 1, 'Repair'); const totalA2 = await shownTotal(page);
      await approve.click();
      const saved = await page.getByText('Repair total saved to this deal').first().waitFor({ timeout: 10000 }).then(() => true, () => false);
      await settle(page, 1200);
      check('LG7 legacy same-deal save still works: "Repair total saved", GHL holds it, and the re-read keeps this deal\'s answers',
        saved && oppValue(fxA, F_EST) === totalA2 && (await unanswered(page)) === 0);
      await context.close();
    }

    check('X1 no page errors or console errors in any scenario', pageErrors.length === 0, pageErrors);
    check('X2 no request left the machine, and every function request was modelled', foreign.length === 0 && offlineBlocked.length === 0 && unmodeled.length === 0, { foreign, offlineBlocked, unmodeled });
  } finally {
    await browser.close().catch(() => {}); await server.close().catch(() => {}); await legacyServer.close().catch(() => {});
    globalThis.fetch = realFetch; await B.close(); await G.close();
  }
}

main().then(() => {
  console.log(`\nB1 repair approval, enabled browser path (offline): ${checks - failures}/${checks} checks passed${failures ? ` (failures=${failures})` : ''}`);
  if (checks < FLOOR) { console.error(`FLOOR only ${checks} checks ran (floor ${FLOOR})`); process.exit(1); }
  process.exit(failures ? 1 : 0);
}, (e) => { console.error('ABORT', e); process.exit(1); });
