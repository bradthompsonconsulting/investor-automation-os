/**
 * MAINTAINED v2-COMPATIBLE RUNNER (Bones F2, review of df623e6), generated from the UNCHANGED original
 * test-property-answers-preservation.cjs (which stays as written, 33/37 at df623e6). Only two non-header
 * changes: serverDraft reads the operator-bound v2 draft and validates its binding (the original reads the
 * retired legacy v1 key), and freshState seeds valid empty ledgers for the other pinned fixture contacts
 * (Bones F3: drafts need clean evidence for them). All 37 behavioural assertions are the original's.
 */
/**
 * B15-04 answer preservation (Brad 2026-10-19/20; Bones follow-up 2026-10-19) --
 * the REAL PropertyAnswersPanel in headless Chromium against the REAL
 * property-answer handler, offline.
 *
 * Vite serves scripts/harness/property-answers. Every
 * /.netlify/functions/property-answer request is answered by calling the real
 * handler in this process. It uses in-memory Netlify Blobs, a synthetic GHL and
 * the committed Test evaluation config (budget 40, candidate cap 1), with this
 * suite's own synthetic fixture pinned. Every other request is aborted and counted.
 * No credential, no network.
 *
 * Harness translations, NOT application behaviour:
 *   - The continuation cookie (HttpOnly; Secure; SameSite=Strict; Path=/) is
 *     kept in a jar here and sent with each forwarded request, as one browser
 *     profile would keep it across a reload. A response the browser never
 *     receives never updates the jar.
 *   - The request's Origin is presented as the configured allowed origin.
 *   - __setWriteSession sets the in-memory write session exactly as
 *     AppWriteAccess does after sign-in. A real reload loses it, and so does
 *     this harness.
 *
 * Each check asserts what Brad's requirement asks for: entered answers are
 * preserved and can be recovered without starting over. A FAIL is a finding,
 * kept visible; no assertion is weakened to bless lost or replaced answers.
 * Uncertain-write holds must stay, and nothing may be resent automatically.
 * Expected-gap checks are labelled GAP; harness controls are labelled CONTROL.
 *
 * This is a reproducer, not yet a CI suite. It exits 1 while any finding stands.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const crypto = require('node:crypto');

const APP = path.resolve(__dirname, '..');
const ts = require(path.join(APP, 'node_modules', 'typescript'));

// ── In-memory Netlify Blobs (same semantics as test-property-answer.cjs) ─────
const receipts = new Map(); const etags = new Map(); let etagSeq = 0;
const realBlobs = require('@netlify/blobs');
const receiptShim = require('./lib/receipt-recorder-shim.cjs'); // main's recorded-receipt adapter (204a66f): fetch-bearing receipt stores go through the helpers' recorder (test-only; Bones step 070)
delete process.env.NETLIFY_BLOBS_CONTEXT;
const lambdaHeaders = { 'x-nf-site-id': 'offline-site', 'x-nf-deploy-id': 'offline-deploy' };
const lambdaBlobs = Buffer.from(JSON.stringify({ url: 'https://blobs.example.invalid', token: 'offline-blob-fixture' })).toString('base64');
const originalResolve = Module._resolveFilename; const originalLoad = Module._load;
Module._resolveFilename = function (name, parent, ...rest) {
  if (name.startsWith('.') && parent) { const c = path.resolve(path.dirname(parent.filename), name + '.ts'); if (fs.existsSync(c)) return c; }
  return originalResolve.call(this, name, parent, ...rest);
};
Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
const memStore = {
  async get(key) { return receipts.has(key) ? structuredClone(receipts.get(key)) : null; },
  async getWithMetadata(key) { return receipts.has(key) ? { data: structuredClone(receipts.get(key)), etag: etags.get(key) } : null; },
  async setJSON(key, value, options) {
    if (options?.onlyIfNew && receipts.has(key)) return { modified: false };
    if (options?.onlyIfMatch !== undefined && etags.get(key) !== options.onlyIfMatch) return { modified: false };
    receipts.set(key, structuredClone(value)); const etag = 'etag-' + (++etagSeq); etags.set(key, etag);
    return { modified: true, etag };
  },
  async delete(key) { receipts.delete(key); etags.delete(key); },
};
Module._load = function (name, ...rest) {
  if (name === '@netlify/blobs') return receiptShim.wrap({ connectLambda: (event) => realBlobs.connectLambda(event), getStore: () => memStore });
  return originalLoad.call(this, name, ...rest);
};
const ALLOWED_ORIGIN = 'https://proof.example.invalid';
process.env.IAOS_ENV = 'test';
process.env.IAOS_APP_WRITE_GOOGLE_CLIENT_ID = 'offline-client';
process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN = ALLOWED_ORIGIN;
process.env.IAOS_APP_WRITE_BRAD_EMAILS = 'brad@example.invalid';
process.env.IAOS_APP_WRITE_SESSION_SECRET = 'offline-fixture-only-not-a-real-secret';
process.env.GHL_PRIVATE_API_KEY = 'offline-fixture';

const auth = require(path.join(APP, 'netlify/functions/lib/app-write-auth.ts'));
const cfgMod = require(path.join(APP, 'shared/ghl-config.ts'));
const config = cfgMod.getConfig('test');
const P = config.propertyAnswerFields;
// The committed evaluation config is used as is (40 / 1); only this suite's synthetic fixture is pinned.
assert.deepEqual({ ...config.propertyAnswerEvaluation.requestBudget }, { budgetId: 'b15-04-eval-1', ceiling: 40 });
assert.equal(config.propertyAnswerEvaluation.maxCandidates, 1);
const X1 = 'fxContactX1', DA = 'fxDealA00001';
config.propertyAnswerEvaluation.fixtureContactIds.push(X1);
config.propertyAnswerEvaluation.fixtureOpportunityIds.push(DA);
const SCOPE = `test:${config.locationId}`;
const dg = (s) => crypto.createHash('sha256').update(s).digest('hex');
const draftKey = (f) => `pa/draft/${dg(`${SCOPE}:${X1}:${DA}:${f}`)}`;

// ── Synthetic GHL ─────────────────────────────────────────────────────────────
let ghl; let calls = []; let ghlFail = [];
const ok = (data) => ({ ok: true, status: 200, json: async () => structuredClone(data), text: async () => JSON.stringify(data) });
const status = (code) => ({ ok: false, status: code, json: async () => ({ message: 'fixture: provider error' }), text: async () => '{"message":"fixture: provider error"}' });
const ADDRESS_FIELDS = [[P.propertyStreet, '100 Probe Way'], [P.propertyCity, 'McKinney'], [P.propertyState, 'TX'], [P.propertyZip, '75069']];
global.fetch = async (url, init = {}) => {
  const u = new URL(url); const method = init.method || 'GET';
  if (u.origin !== 'https://services.leadconnectorhq.com') throw new Error('fixture: no external network: ' + u.origin);
  const req = { method, path: u.pathname, query: Object.fromEntries(u.searchParams), body: init.body ? JSON.parse(init.body) : null };
  calls.push(req);
  const fi = ghlFail.findIndex((f) => f.match(req)); if (fi >= 0) { const [f] = ghlFail.splice(fi, 1); return status(f.code); }
  let m;
  if (u.pathname === '/opportunities/search') {
    const list = Object.values(ghl.opps).filter((o) => o.contactId === req.query.contact_id && o.pipelineId === req.query.pipeline_id);
    return ok({ opportunities: structuredClone(list), meta: { total: list.length, nextPage: null, nextPageUrl: null } });
  }
  if ((m = u.pathname.match(/^\/opportunities\/([^/]+)$/))) {
    const o = ghl.opps[m[1]]; if (!o) return status(404);
    if (method === 'PUT') {
      for (const f of req.body.customFields) { o.customFields = o.customFields.filter((x) => x.id !== f.id); if (f.field_value !== '' && f.field_value !== null) o.customFields.push({ id: f.id, fieldValue: f.field_value }); }
      return ok({ succeded: true });
    }
    return ok({ opportunity: structuredClone(o) });
  }
  if ((m = u.pathname.match(/^\/contacts\/([^/]+)(\/notes)?$/))) {
    const c = ghl.contacts[m[1]]; if (!c) return status(404);
    if (m[2]) {
      if (method === 'POST') { const note = { id: `${c.id}-note-${c.notes.length}`, body: req.body.body }; c.notes.push(note); return ok({ note }); }
      return ok({ notes: structuredClone(c.notes) });
    }
    return ok({ contact: { id: c.id, locationId: config.locationId, customFields: [] } });
  }
  throw new Error('fixture: unexpected GHL request ' + method + ' ' + u.pathname);
};
const reasonInGhl = () => (ghl.opps[DA].customFields.find((f) => f.id === P.sellerReason) || {}).fieldValue ?? null;
const puts = () => calls.filter((c) => c.method === 'PUT').length;
// v2 storage adapter: the exact operator/env/location/contact/deal/field binding, validated (Bones's replay adapter).
const serverDraft = (f = 'seller_reason') => {
  const key = 'pa/draft2/' + dg(JSON.stringify(['test', config.locationId, 'brad@example.invalid', X1, DA, f]));
  const d = receipts.get(key); if (d === undefined) return null;
  assert.equal(d.v, 2); assert.equal(d.operator, 'brad@example.invalid'); assert.equal(d.env, 'test');
  assert.equal(d.locationId, config.locationId); assert.equal(d.contactId, X1); assert.equal(d.opportunityId, DA); assert.equal(d.field, f);
  return d.value ?? d;
};

const handler = require(path.join(APP, 'netlify/functions/property-answer.ts')).handler;

// ── Checks ────────────────────────────────────────────────────────────────────
let checks = 0, failures = 0; const results = [];
function check(name, ok, detail) {
  checks += 1; if (!ok) failures += 1;
  results.push({ name, ok: !!ok, detail });
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}

async function main() {
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const { chromium } = require('playwright');
  const server = await createServer({
    root: APP, configFile: false, plugins: [react()], logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: ['scripts/harness/property-answers/index.html'], include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime'] },
  });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const foreign = []; const pageErrors = [];
  const exit = async (code) => { await browser.close().catch(() => {}); await server.close().catch(() => {}); process.exit(code); };

  // Per-scenario state.
  let reqs = []; let rules = []; let jar = null; let page = null;
  const token = () => auth.issueAppSession('brad@example.invalid').token;
  const freshState = (opts = {}) => {
    receipts.clear(); etags.clear(); calls = []; ghlFail = []; reqs = []; rules = []; jar = null;
    ghl = { contacts: { [X1]: { id: X1, notes: [] } }, opps: { [DA]: {
      id: DA, locationId: config.locationId, contactId: X1, pipelineId: config.pipelines.sellerLeads, pipelineStageId: config.stages.newLeadSeller,
      status: 'open', name: 'IAOS PROBE A', createdAt: '2026-10-17T12:00:00.000Z',
      customFields: opts.noAddress ? [] : ADDRESS_FIELDS.map(([id, fieldValue]) => ({ id, fieldValue })) } } };
    // Bones F3: explicit valid (empty) known-deal ledgers for every OTHER pinned fixture contact.
    const ledgerLib = require(path.join(APP, 'netlify/functions/lib/known-deal-ledger.ts'));
    for (const c of config.propertyAnswerEvaluation.fixtureContactIds) {
      if (c === X1) continue;
      const lk = ledgerLib.ledgerKey(SCOPE, c); receipts.set(lk, { v: 1, gen: 1, ids: {}, discoveries: {} }); etags.set(lk, 'seed-' + c);
    }
  };
  /** Rules: { action, mode: 'hold'|'fail500'|'abort'|'dropResponse', then? } applied once, in order, to the next matching request. */
  const rule = (action, mode, extra = {}) => { const r = { action, mode, ...extra }; if (mode === 'hold') { r.hit = new Promise((res) => { r.onHit = res; }); r.gate = new Promise((res) => { r.release = res; }); } rules.push(r); return r; };
  const sent = (action) => reqs.filter((r) => r.action === action);

  async function openPage() {
    const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
    page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { foreign.push(url); return route.abort(); }
      const fn = new URL(url).pathname.replace('/.netlify/functions/', '');
      if (fn !== 'property-answer') { foreign.push(url); return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"fixture does not model this function"}' }); }
      let body = null; try { body = route.request().postDataJSON(); } catch { body = null; }
      const authz = route.request().headers()['authorization'];
      const entry = { action: body && body.action, body, authz, outcome: null }; reqs.push(entry);
      const ri = rules.findIndex((r) => r.action === entry.action); const r = ri >= 0 ? rules.splice(ri, 1)[0] : null;
      let mode = r ? r.mode : null;
      if (mode === 'hold') { r.onHit(entry); await r.gate; mode = r.then || null; }
      if (mode === 'fail500') { entry.outcome = 'fixture-500'; return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"fixture: injected failure before the server"}' }).catch(() => {}); }
      if (mode === 'abort') { entry.outcome = 'fixture-network-failure'; return route.abort('failed').catch(() => {}); }
      const headers = { ...lambdaHeaders, origin: ALLOWED_ORIGIN, ...(authz ? { authorization: authz } : {}), ...(jar ? { cookie: jar } : {}) };
      const res = await handler({ blobs: lambdaBlobs, httpMethod: 'POST', headers, body: JSON.stringify(body) });
      entry.status = res.statusCode; entry.reply = (() => { try { return JSON.parse(res.body); } catch { return null; } })();
      if (mode === 'dropResponse') { entry.outcome = 'server-applied-response-lost'; return route.abort('failed').catch(() => {}); }
      const sc = res.headers && (res.headers['Set-Cookie'] || res.headers['set-cookie']); if (sc) jar = sc.split(';')[0];
      entry.outcome = 'answered';
      return route.fulfill({ status: res.statusCode, contentType: 'application/json', body: res.body }).catch(() => {});
    });
    await page.goto(`${base}/scripts/harness/property-answers/index.html`);
    await page.waitForFunction(() => window.__harnessReady === true, null, { timeout: 60000 });
  }
  const closePage = async () => { if (page) await page.context().close().catch(() => {}); page = null; };
  const setSession = (tok, ttlMs = 15 * 60 * 1000) => page.evaluate((v) => window.__setWriteSession(v), { token: tok, expiresAt: new Date(Date.now() + ttlMs).toISOString() });
  const start = () => page.evaluate(() => window.__start());
  const remount = () => page.evaluate(() => window.__remount());
  const T = (id) => page.getByTestId(id);
  const visible = async (id) => (await T(id).count()) > 0 && T(id).first().isVisible();
  const view = async () => (await visible('property-answers')) ? 'ready' : (await visible('pa-failed')) ? 'failed' : (await visible('pa-loading')) ? 'loading' : 'hidden';
  const reasonText = async () => ((await T('pa-seller-reason').count()) ? T('pa-seller-reason').inputValue() : null);
  const textOf = async (id) => ((await T(id).count()) ? (await T(id).innerText()).trim() : null);
  const until = async (fn, label, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(100); } console.error(`  (waited ${ms} ms for: ${label})`); return false; };
  const settle = () => page.waitForTimeout(500);
  const typeReason = async (text) => { await T('pa-seller-reason').click(); await T('pa-seller-reason').fill(text); };
  const appendReason = async (text) => { await T('pa-seller-reason').click(); await T('pa-seller-reason').press('End'); await T('pa-seller-reason').pressSequentially(text); };
  const snapshot = async () => ({ view: await view(), text: await reasonText(), message: await textOf('pa-message'), failed: await textOf('pa-failed'), op: await textOf('pa-op-state'), draftNote: await textOf('pa-draft-note'),
    sent: reqs.map((r) => `${r.action}:${r.outcome}${r.status ? ':' + r.status : ''}${r.reply && r.reply.code ? ':' + r.reply.code : ''}`) });
  async function ready(tok) { await openPage(); await setSession(tok); await start(); return until(async () => (await view()) === 'ready', 'panel ready'); }

  try {
    // ── P0 CONTROL: a normal save. The harness drives the real panel and real handler.
    {
      freshState(); const tok = token();
      check('P0 CONTROL the real panel loads for the synthetic fixture, address confirmed', await ready(tok) && (await visible('pa-address')), await snapshot());
      const R = 'P0 seller is relocating for work';
      await typeReason(R); await T('pa-save-reason').click();
      await until(async () => (await textOf('pa-message')) === 'Saved.' || (await view()) !== 'ready', 'P0 saved');
      await settle();
      const s = await snapshot();
      check('P0 CONTROL save -> history -> "Saved."; the text stays; GHL holds it; one save and one history request',
        s.view === 'ready' && s.message === 'Saved.' && s.text === R && reasonInGhl() === R && sent('save').length === 1 && sent('history').length === 1, s);
      await closePage();
    }

    // ── P1 (Bones): a DELAYED draft, then a save that never reaches the server, then the late draft lands.
    {
      freshState(); const tok = token(); await ready(tok);
      const R = 'P1 needs to sell before the divorce is final';
      const d = rule('draft', 'hold');
      rule('save', 'abort');                // the save never reaches the server (network failure)
      await typeReason(R);
      await T('pa-save-reason').click();   // the click blurs the textarea: the draft is sent first, and held
      const draftEntry = await d.hit;
      await until(async () => sent('save').length === 1 && (await view()) !== 'loading' && sent('context').length >= 2, 'P1 save failed and the panel re-read');
      await settle();
      const mid = await snapshot();
      check('P1 GAP after a failed save while the draft is still in flight, the exact entered text is still shown', mid.text === R, mid);
      check('P1 the operator is told the save may not have reached the server (not "Saved", not "Not saved")',
        /may not have reached the server/.test(mid.message || '') || /may not have reached the server/.test(mid.failed || ''), mid);
      d.release(); await until(async () => draftEntry.outcome === 'answered', 'P1 late draft answered'); await settle();
      const after = await snapshot();
      check('P1 GAP after the late draft lands, the exact entered text is shown (not replaced by an older value)', after.text === R, after);
      check('P1 the server keeps the entered text as a draft once the late draft lands', serverDraft() === R, serverDraft());
      check('P1 no automatic resend: one save request, no history, no GHL write', sent('save').length === 1 && sent('history').length === 0 && puts() === 0, after.sent);
      await closePage();
    }

    // ── P2: a FAILED draft, then the provider rejects the answer save.
    {
      freshState(); const tok = token(); await ready(tok);
      const R = 'P2 inherited the house and lives out of state';
      rule('draft', 'fail500');
      ghlFail.push({ match: (q) => q.method === 'PUT', code: 500 });
      await typeReason(R);
      await T('pa-save-reason').click();
      await until(async () => sent('save').length === 1 && sent('context').length >= 2 && (await view()) !== 'loading', 'P2 save answered and the panel re-read');
      await settle();
      const s = await snapshot();
      check('P2 the failed draft is reported ("Draft NOT saved.") or the panel shows the failure', s.draftNote === 'Draft NOT saved.' || s.view !== 'ready', s);
      check('P2 GAP after a failed draft and a provider-failed save, the exact entered text is still shown', s.text === R, s);
      check('P2 GAP the operator can continue from the entered text (form shown, not a dead-end failure)', s.view === 'ready', s);
      check('P2 no automatic resend: one save request, no history, at most one GHL write attempt', sent('save').length === 1 && sent('history').length === 0 && puts() <= 1, s.sent);
      await closePage();
    }

    // ── P3: newer typed text must survive a late re-read.
    {
      freshState(); const tok = token(); await ready(tok);
      const R = 'P3 first answer';
      await typeReason(R);
      const ctxHold = rule('context', 'hold');   // the re-read that follows the save
      await T('pa-save-reason').click();
      await ctxHold.hit;
      await appendReason(' plus newer text typed while the save finished');
      const newer = await reasonText();
      ctxHold.release();
      await until(async () => sent('context').length >= 2 && reqs.filter((r) => r.action === 'context').every((r) => r.outcome), 'P3 re-read answered'); await settle();
      const s = await snapshot();
      check('P3 CONTROL the newer text was typed into the field while the re-read was pending', newer === R + ' plus newer text typed while the save finished', newer);
      check('P3 GAP after the late re-read, the newer typed text is still shown (not replaced by the saved value)', s.text === newer, { ...s, newer });
      check('P3 the first answer was saved once (no resend)', reasonInGhl() === R && sent('save').length === 1 && sent('history').length === 1, s.sent);
      await closePage();
    }

    // ── P4: an UNCERTAIN save. The server applies it, and the response never reaches the browser.
    {
      freshState(); const tok = token(); await ready(tok);
      const R = 'P4 tenant moving out next month';
      await typeReason(R);
      rule('save', 'dropResponse');
      await T('pa-save-reason').click();
      await until(async () => sent('save').length === 1 && sent('context').length >= 2 && (await view()) !== 'loading', 'P4 uncertain save and re-read'); await settle();
      const s = await snapshot();
      check('P4 CONTROL the server applied the save (S1 written) and its response was lost', reasonInGhl() === R && sent('save')[0].outcome === 'server-applied-response-lost', { ghl: reasonInGhl(), sent: s.sent });
      check('P4 the operator is told the outcome is uncertain: use Check again, do not save again',
        /Use Check again; do not save again/.test(s.message || '') || /Check again/.test(s.op || ''), s);
      check('P4 GAP the uncertain-write hold stays visible with Check again', /Check again/.test(s.op || '') || (await visible('pa-op-state')), s);
      check('P4 GAP the exact entered text is still shown', s.text === R, s);
      check('P4 no automatic resend: one save, no automatic history (its acknowledgement never arrived), one GHL PUT',
        sent('save').length === 1 && sent('history').length === 0 && puts() === 1, s.sent);
      check('P4 a new save cannot be started while the outcome is uncertain', !(s.view === 'ready' && !(await T('pa-save-reason').isDisabled())), s);
      await closePage();
    }

    // ── P5: write-session EXPIRY, then sign-in again without a reload, then the page is revisited.
    {
      freshState(); const tok = token(); await openPage(); await setSession(tok, 6000); await start();
      await until(async () => (await view()) === 'ready', 'P5 ready');
      const R1 = 'P5 behind on payments';
      await typeReason(R1); await page.locator('body').click({ position: { x: 5, y: 5 } });   // blur: draft
      await until(async () => (await textOf('pa-draft-note')) !== null, 'P5 draft answered'); await settle();
      check('P5 CONTROL the draft was saved on the server before expiry', serverDraft() === R1 && (await textOf('pa-draft-note')) === 'Draft saved on the server.', serverDraft());
      await page.waitForTimeout(6500);   // the write session expires
      const R = R1 + ', wants to avoid foreclosure';
      await appendReason(', wants to avoid foreclosure');
      const before = reqs.length;
      await T('pa-save-reason').click();
      await settle(); await settle();
      const s = await snapshot();
      check('P5 nothing is sent after expiry (the client refuses before sending)', reqs.length === before, s.sent);
      check('P5 GAP after expiry, the exact entered text is still shown', s.text === R, s);
      check('P5 GAP after expiry, the operator is told to sign in again (the message is visible)', /Sign in for application writes/.test(s.message || ''), s);
      await setSession(token());   // sign in again: a NEW write session, no reload
      await page.waitForTimeout(1500);
      const s2 = await snapshot();
      check('P5 GAP after signing in again (no reload), the panel is back with the exact entered text', s2.view === 'ready' && s2.text === R, s2);
      await remount();   // the operator leaves the contact page and comes back
      await until(async () => (await view()) !== 'loading' && (await view()) !== 'hidden', 'P5 remount answered', 8000); await settle();
      const s3 = await snapshot();
      check('P5 GAP after revisiting with the new session, the saved draft is recovered into the form', s3.view === 'ready' && s3.text === R1, s3);
      check('P5 the server still holds the pre-expiry draft (data kept on the server)', serverDraft() === R1, serverDraft());
      check('P5 no save request was ever sent', sent('save').length === 0, s3.sent);
      await closePage();
    }

    // ── P6: RELOAD with a new sign-in (what a real browser does), plus a same-token control.
    {
      freshState(); const tok = token(); await ready(tok);
      const R = 'P6 roof leaks, wants a quick close';
      await typeReason(R); await page.locator('body').click({ position: { x: 5, y: 5 } });
      await until(async () => (await textOf('pa-draft-note')) === 'Draft saved on the server.', 'P6 draft saved');
      await page.reload(); await page.waitForFunction(() => window.__harnessReady === true, null, { timeout: 60000 });
      await setSession(token()); await start();   // the in-memory token is gone: the operator signs in again
      await until(async () => (await view()) !== 'loading' && (await view()) !== 'hidden', 'P6 after reload', 8000); await settle();
      const s = await snapshot();
      check('P6 GAP after a reload and a new sign-in, the entered text is recovered from the server draft', s.view === 'ready' && s.text === R, s);
      check('P6 the server still holds the draft', serverDraft() === R, serverDraft());
      await page.reload(); await page.waitForFunction(() => window.__harnessReady === true, null, { timeout: 60000 });
      await setSession(tok); await start();   // CONTROL only: a real reload cannot keep the old in-memory token
      await until(async () => (await view()) !== 'loading' && (await view()) !== 'hidden', 'P6 control', 8000); await settle();
      const c = await snapshot();
      check('P6 CONTROL with the SAME write session (not real reload behaviour), the draft-restore mechanism returns the exact text', c.view === 'ready' && c.text === R, c);
      await closePage();
    }

    // ── P7: the re-read after a successful save fails, then Retry.
    {
      freshState(); const tok = token(); await ready(tok);
      const R = 'P7 estate sale, family agrees';
      await typeReason(R);
      rule('context', 'fail500');
      await T('pa-save-reason').click();
      await until(async () => sent('history').length === 1 && sent('context').length >= 2 && (await view()) !== 'loading', 'P7 save then failed re-read'); await settle();
      const s = await snapshot();
      check('P7 the answer was saved once (GHL holds it; one save, one history)', reasonInGhl() === R && sent('save').length === 1 && sent('history').length === 1, s.sent);
      check('P7 GAP after a failed re-read, the exact entered text is still shown', s.text === R, s);
      check('P7 GAP after a failed re-read, the save outcome ("Saved.") is still shown', s.message === 'Saved.' || /Saved/.test(s.failed || ''), s);
      if (await visible('pa-failed')) { await T('pa-failed').getByRole('button', { name: 'Retry' }).click(); await until(async () => (await view()) === 'ready', 'P7 retry', 8000); await settle(); }
      const r = await snapshot();
      check('P7 Retry recovers the panel with the saved text', r.view === 'ready' && r.text === R, r);
      await closePage();
    }

    check('no request left the machine (no foreign or unmodelled request)', foreign.length === 0, foreign);
    check('no page error', pageErrors.length === 0, pageErrors);
  } catch (e) {
    failures += 1; console.error('ABORTED  ' + (e && e.stack ? e.stack.split('\n').slice(0, 6).join('\n') : e));
  }
  const FLOOR = 37;
  if (checks < FLOOR) { failures += 1; console.error(`FLOOR  only ${checks} checks ran (floor ${FLOOR})`); }
  const gaps = results.filter((r) => !r.ok).map((r) => r.name);
  console.log(`\nProperty answers preservation: ${results.filter((r) => r.ok).length}/${checks} checks passed (failures=${failures})`);
  if (gaps.length) console.log('Findings (FAIL):\n  - ' + gaps.join('\n  - '));
  await exit(failures ? 1 : 0);
}
main();
