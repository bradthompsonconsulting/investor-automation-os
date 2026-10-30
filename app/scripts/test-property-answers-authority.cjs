/**
 * B15-04 C1–C4 r4 (Bones design clearance 2026-10-20) -- focused BROWSER checks for status authority,
 * read/write wording, identity/target generations, late replies and fresh-load non-bypass.
 *
 * The REAL PropertyAnswersPanel in headless Chromium (scripts/harness/property-answers-authority) against
 * the REAL property-answer handler in Node: in-memory Blobs, a synthetic GHL, the committed Test evaluation
 * config (40 / 1) plus this suite's synthetic fixtures. Every other request is aborted and counted.
 * Harness translations (not app behaviour): a Node-side continuation-cookie jar per browser profile; the
 * request Origin presented as the allowed origin; the write session set exactly as AppWriteAccess sets it.
 * One synthetic reply is used (O): a read-only check view, to prove a final-looking status cannot reopen
 * saving; it carries the real operator echo.
 *
 * The unchanged 37-check reproducer (test-property-answers-preservation.cjs) is separate.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const crypto = require('node:crypto');

const APP = path.resolve(__dirname, '..');
const ts = require(path.join(APP, 'node_modules', 'typescript'));
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
const OP_A = 'brad@example.invalid', OP_B = 'second@example.invalid';
process.env.IAOS_ENV = 'test';
process.env.IAOS_APP_WRITE_GOOGLE_CLIENT_ID = 'offline-client';
process.env.IAOS_APP_WRITE_ALLOWED_ORIGIN = ALLOWED_ORIGIN;
process.env.IAOS_APP_WRITE_BRAD_EMAILS = `${OP_A},${OP_B}`;
process.env.IAOS_APP_WRITE_SESSION_SECRET = 'offline-fixture-only-not-a-real-secret';
process.env.GHL_PRIVATE_API_KEY = 'offline-fixture';

const auth = require(path.join(APP, 'netlify/functions/lib/app-write-auth.ts'));
const ledger = require(path.join(APP, 'netlify/functions/lib/known-deal-ledger.ts'));
const cfgMod = require(path.join(APP, 'shared/ghl-config.ts'));
const config = cfgMod.getConfig('test');
// Committed Test is DEACTIVATED; this offline suite enables ONLY its own in-memory copy (the handler's getConfig returns this object).
assert.equal(config.propertyAnswerEvaluation.enabled, cfgMod.PROPERTY_ANSWER_EVALUATION_DISABLED, 'committed Test evaluation is DISABLED');
config.propertyAnswerEvaluation.enabled = cfgMod.PROPERTY_ANSWER_EVALUATION_ENABLED;
assert.equal(cfgMod.getConfig('test').propertyAnswerEvaluation.enabled, cfgMod.PROPERTY_ANSWER_EVALUATION_ENABLED, 'the handler sees the suite-enabled copy');
const P = config.propertyAnswerFields;
assert.deepEqual({ ...config.propertyAnswerEvaluation.requestBudget }, { budgetId: 'b15-04-eval-1', ceiling: 40 });
const X1 = 'fxContactX1', X2 = 'fxContactX2', DA = 'fxDealA00001', DB = 'fxDealB00001';
config.propertyAnswerEvaluation.fixtureContactIds.push(X1, X2);
config.propertyAnswerEvaluation.fixtureOpportunityIds.push(DA, DB);
const dg = (s) => crypto.createHash('sha256').update(s).digest('hex');
const budgetSnap = () => JSON.stringify([...receipts.keys()].filter((k) => k.startsWith('pa/eval-budget/')).sort().map((k) => [k, receipts.get(k), etags.get(k)]));

let ghl; let calls = []; let putFails = 0;
const ok = (data) => ({ ok: true, status: 200, json: async () => structuredClone(data), text: async () => JSON.stringify(data) });
const status = (code) => ({ ok: false, status: code, json: async () => ({}), text: async () => '{}' });
const ADDRESS_FIELDS = [[P.propertyStreet, '100 Probe Way'], [P.propertyCity, 'McKinney'], [P.propertyState, 'TX'], [P.propertyZip, '75069']];
global.fetch = async (url, init = {}) => {
  const u = new URL(url); const method = init.method || 'GET';
  if (u.origin !== 'https://services.leadconnectorhq.com') throw new Error('fixture: no external network: ' + u.origin);
  const req = { method, path: u.pathname, query: Object.fromEntries(u.searchParams), body: init.body ? JSON.parse(init.body) : null };
  calls.push(req);
  let m;
  if (u.pathname === '/opportunities/search') {
    const list = Object.values(ghl.opps).filter((o) => o.contactId === req.query.contact_id && o.pipelineId === req.query.pipeline_id);
    return ok({ opportunities: structuredClone(list), meta: { total: list.length, nextPage: null, nextPageUrl: null } });
  }
  if ((m = u.pathname.match(/^\/opportunities\/([^/]+)$/))) {
    const o = ghl.opps[m[1]]; if (!o) return status(404);
    if (method === 'PUT') {
      if (putFails > 0) { putFails -= 1; return status(500); }
      for (const f of req.body.customFields) { o.customFields = o.customFields.filter((x) => x.id !== f.id); if (f.field_value !== '' && f.field_value !== null) o.customFields.push({ id: f.id, fieldValue: f.field_value }); }
      return ok({ succeded: true });
    }
    return ok({ opportunity: structuredClone(o) });
  }
  if ((m = u.pathname.match(/^\/contacts\/([^/]+)(\/notes)?$/))) {
    const c = ghl.contacts[m[1]]; if (!c) return status(404);
    if (m[2]) { if (method === 'POST') { c.notes.push({ id: `${c.id}-n${c.notes.length}`, body: req.body.body }); return ok({ note: c.notes[c.notes.length - 1] }); } return ok({ notes: structuredClone(c.notes) }); }
    return ok({ contact: { id: c.id, locationId: config.locationId, customFields: [] } });
  }
  throw new Error('fixture: unexpected GHL request ' + method + ' ' + u.pathname);
};
const puts = () => calls.filter((c) => c.method === 'PUT').length;
const handler = require(path.join(APP, 'netlify/functions/property-answer.ts')).handler;

let checks = 0, failures = 0; const results = [];
function check(name, okv, detail) {
  checks += 1; if (!okv) failures += 1; results.push({ name, ok: !!okv });
  console[okv ? 'log' : 'error'](`${okv ? 'PASS' : 'FAIL'}  ${name}${okv || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}

async function main() {
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const { chromium } = require('playwright');
  const server = await createServer({
    root: APP, configFile: false, plugins: [react()], logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: ['scripts/harness/property-answers-authority/index.html'], include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime'] },
  });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const foreign = []; const pageErrors = [];
  const exit = async (code) => { await browser.close().catch(() => {}); await server.close().catch(() => {}); process.exit(code); };

  let reqs = []; let rules = []; let jar = null; let page = null; let seq = 0; let lastIssue = Date.now();
  const token = (op = OP_A, ttlMs) => {
    // Strictly earlier, distinct issue seconds: two sign-ins can never mint the same token (same sub/iat/exp).
    lastIssue = Math.min(Date.now(), lastIssue - 1000); const now = lastIssue; seq += 1;
    const t = auth.issueAppSession(op, process.env, now);
    return { token: t.token, expiresAt: ttlMs ? new Date(Date.now() + ttlMs).toISOString() : t.expiresAt };
  };
  const freshState = () => {
    receipts.clear(); etags.clear(); calls = []; reqs = []; rules = []; jar = null; putFails = 0;
    const deal = (id, contactId) => ({ id, locationId: config.locationId, contactId, pipelineId: config.pipelines.sellerLeads, pipelineStageId: config.stages.newLeadSeller, status: 'open', name: 'IAOS PROBE ' + id, createdAt: '2026-10-17T12:00:00.000Z', customFields: ADDRESS_FIELDS.map(([id2, fieldValue]) => ({ id: id2, fieldValue })) });
    ghl = { contacts: { [X1]: { id: X1, notes: [] }, [X2]: { id: X2, notes: [] } }, opps: { [DA]: deal(DA, X1), [DB]: deal(DB, X2) } };
    // Bones F3: drafts need clean ledger evidence for every OTHER pinned contact -- explicit valid (empty) ledgers.
    for (const c of config.propertyAnswerEvaluation.fixtureContactIds) {
      if (c === X1) continue;
      const lk = ledger.ledgerKey(`test:${config.locationId}`, c); receipts.set(lk, { v: 1, gen: 1, ids: {}, discoveries: {} }); etags.set(lk, 'seed-' + c);
    }
  };
  const rule = (action, mode, extra = {}) => { const r = { action, mode, ...extra }; if (mode === 'hold') { r.hit = new Promise((res) => { r.onHit = res; }); r.gate = new Promise((res) => { r.release = res; }); } rules.push(r); return r; };
  const sent = (action) => reqs.filter((r) => r.action === action);
  /** Calls the real handler directly (as another browser tab of the same profile would), sharing the jar. */
  const direct = async (tok, body) => {
    const res = await handler({ blobs: lambdaBlobs, httpMethod: 'POST', headers: { ...lambdaHeaders, origin: ALLOWED_ORIGIN, authorization: `Bearer ${tok.token}`, ...(jar ? { cookie: jar } : {}) }, body: JSON.stringify(body) });
    const sc = res.headers && res.headers['Set-Cookie']; if (sc) jar = sc.split(';')[0];
    return { status: res.statusCode, body: JSON.parse(res.body) };
  };

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
      if (mode === 'synthetic') { entry.outcome = 'synthetic'; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r.reply) }).catch(() => {}); }
      const headers = { ...lambdaHeaders, origin: ALLOWED_ORIGIN, ...(authz ? { authorization: authz } : {}), ...(jar ? { cookie: jar } : {}) };
      const res = await handler({ blobs: lambdaBlobs, httpMethod: 'POST', headers, body: JSON.stringify(body) });
      entry.status = res.statusCode; entry.reply = (() => { try { return JSON.parse(res.body); } catch { return null; } })();
      if (mode === 'dropResponse') { entry.outcome = 'server-applied-response-lost'; return route.abort('failed').catch(() => {}); }
      const sc = res.headers && (res.headers['Set-Cookie'] || res.headers['set-cookie']); if (sc) jar = sc.split(';')[0];
      entry.outcome = 'answered';
      return route.fulfill({ status: res.statusCode, contentType: 'application/json', body: res.body }).catch(() => {});
    });
    await page.goto(`${base}/scripts/harness/property-answers-authority/index.html`);
    await page.waitForFunction(() => window.__harnessReady === true, null, { timeout: 60000 });
  }
  const closePage = async () => { if (page) await page.context().close().catch(() => {}); page = null; };
  const setSession = (tok) => page.evaluate((v) => window.__setWriteSession(v), tok);
  const start = (c = X1, d = DA) => page.evaluate(([cc, dd]) => window.__start(cc, dd), [c, d]);
  const setTarget = (c, d) => page.evaluate(([cc, dd]) => window.__setTarget(cc, dd), [c, d]);
  const T = (id) => page.getByTestId(id);
  const visible = async (id) => (await T(id).count()) > 0 && T(id).first().isVisible();
  const view = async () => (await visible('property-answers')) ? 'ready' : (await visible('pa-failed')) ? 'failed' : (await visible('pa-loading')) ? 'loading' : 'hidden';
  const reasonText = async () => ((await T('pa-seller-reason').count()) ? T('pa-seller-reason').inputValue() : null);
  const textOf = async (id) => ((await T(id).count()) ? (await T(id).first().innerText()).trim() : null);
  const until = async (fn, label, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(100); } console.error(`  (waited ${ms} ms for: ${label})`); return false; };
  const settle = () => page.waitForTimeout(500);
  const buttons = async () => page.locator('[data-testid="property-answers"] button, [data-testid="pa-failed"] button').allInnerTexts();
  const hasCheck = async () => (await buttons()).some((b) => b.trim() === 'Check again');
  const hasRead = async () => (await buttons()).some((b) => b.startsWith('View recorded status'));
  const bodyText = async () => page.locator('body').innerText();
  const blur = () => page.evaluate(() => { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); });
  async function ready(tok, c = X1, d = DA) { await openPage(); await setSession(tok); await start(c, d); return until(async () => (await view()) === 'ready', 'panel ready'); }
  const SAVE_UNCERTAIN = /may have reached GHL: the earlier write remains unresolved\. Do not save again\./;

  try {
    // ── H (A2h): an APPLIED save whose reply is lost; then EXPIRED, then REPLACED authority. ─────────────
    {
      freshState(); const t1 = token(OP_A, 12000);
      check('H CONTROL ready', await ready(t1));
      await T('pa-seller-reason').fill('H applied answer');
      rule('save', 'dropResponse');
      await T('pa-save-reason').click();
      await until(async () => sent('save').length === 1 && sent('context').length >= 2 && (await hasCheck()), 'H same session offered Check again');
      check('H the same (holder) session sees the uncertain write with Check again (server access: settle)', (await hasCheck()) && SAVE_UNCERTAIN.test(await textOf('pa-op-state') || ''), await textOf('pa-op-state'));
      check('H CONTROL the save was applied once and its reply lost; no automatic history', puts() === 1 && sent('history').length === 0 && sent('save')[0].outcome === 'server-applied-response-lost');
      await page.waitForTimeout(Math.max(0, Date.parse(t1.expiresAt) - Date.now() + 300));
      await T('pa-seller-reason').click(); await blur();   // the next request detects expiry before sending
      await settle();
      check('H EXPIRED: no status button at all (neither Check again nor read-only status)', !(await hasCheck()) && !(await hasRead()), await buttons());
      check('H EXPIRED: the uncertain-write outcome and the text are kept; saving is off', SAVE_UNCERTAIN.test(await textOf('pa-message') || '') && SAVE_UNCERTAIN.test(await textOf('pa-op-state') || '')
        && (await reasonText()) === 'H applied answer' && (await T('pa-save-reason').isDisabled()), { msg: await textOf('pa-message'), banner: await textOf('pa-banner') });
      check('H EXPIRED: the banner never says signing in resumes the evaluation', /does not resume this evaluation/.test(await textOf('pa-banner') || ''), await textOf('pa-banner'));
      const h0 = sent('history').length, p0 = puts();
      await setSession(token(OP_A));   // a NEW session of the same operator (replaced authority)
      await until(async () => (await hasRead()) || (await hasCheck()), 'H replaced: a status action decided by the server');
      await settle();
      check('H REPLACED: only the read-only recorded status is offered (never Check again)', (await hasRead()) && !(await hasCheck()), await buttons());
      await page.locator('button', { hasText: 'View recorded status' }).first().click();
      await until(async () => /Recorded status \(read-only\)/.test(await textOf('pa-message') || ''), 'H read-only status');
      await settle();
      check('H REPLACED: the read-only status reports the stored state, sends no history and no PUT, and the hold stays', /Recorded status \(read-only\): Saved\. Recording history/.test(await textOf('pa-message') || '')
        && sent('history').length === h0 && puts() === p0 && (await visible('pa-op-state')) && (await T('pa-save-reason').isDisabled()), { msg: await textOf('pa-message'), sent: reqs.map((r) => r.action) });
      check('H REPLACED: the entered text is kept', (await reasonText()) === 'H applied answer');
      await closePage();
    }

    // ── I (A2i): a later READ failure never replaces the earlier uncertain write outcome. ─────────────────
    {
      freshState(); const t1 = token();
      await ready(t1);
      await T('pa-seller-reason').fill('I answer');
      rule('save', 'dropResponse');
      await T('pa-save-reason').click();
      await until(async () => sent('context').length >= 2 && SAVE_UNCERTAIN.test(await textOf('pa-message') || ''), 'I uncertain');
      rule('context', 'fail500');
      await page.locator('button', { hasText: 'Reload' }).first().click();
      await until(async () => reqs.some((r) => r.action === 'context' && r.outcome === 'fixture-500'), 'I failed re-read'); await settle();
      check('I a failed re-read after the uncertain write: the write outcome is unchanged; the read failure shows separately', SAVE_UNCERTAIN.test(await textOf('pa-message') || '') && /fixture: injected failure/.test(await textOf('pa-banner') || ''),
        { msg: await textOf('pa-message'), banner: await textOf('pa-banner') });
      check('I no false not-sent or final claim anywhere', !/sent nothing|Nothing was sent|Not saved\./.test(await bodyText()));
      await closePage();
    }

    // ── J (A3j): same target, session replaced while the old session's reply is in flight. ───────────────
    {
      freshState(); const t1 = token(), t2 = token();
      await openPage(); await setSession(t1);
      const held = rule('context', 'hold');
      await start(); await held.hit;
      await setSession(t2);   // replaced before the first reply arrives
      await until(async () => (await view()) === 'ready', 'J ready under the new session');
      held.release();
      await until(async () => reqs.filter((r) => r.action === 'context').every((r) => r.outcome), 'J late reply answered'); await settle();
      const late = reqs.find((r) => r.authz === `Bearer ${t1.token}` && r.action === 'context');
      check('J CONTROL the late reply from the replaced session was a refusal (another write session)', late && late.status === 409 && /another write session/.test(late.reply.error), late && late.reply);
      await T('pa-seller-reason').fill('J current session text');
      check('J the late reply is discarded: no refusal banner, the current session can still save, the field is untouched',
        (await textOf('pa-banner')) === null && (await view()) === 'ready' && !(await T('pa-save-reason').isDisabled()) && (await reasonText()) === 'J current session text', { banner: await textOf('pa-banner') });
      await closePage();
    }

    // ── K (A3k): A -> B navigation; A's late reply never reaches B. ─────────────────────────────────────
    {
      freshState(); const t1 = token();
      await direct(t1, { action: 'context', contactId: X1, opportunityId: DA });
      assert.equal((await direct(t1, { action: 'draft', contactId: X1, opportunityId: DA, field: 'seller_reason', value: 'A SECRET TEXT' })).status, 200);
      await openPage(); await setSession(t1);
      const held = rule('context', 'hold');
      await start(X1, DA); await held.hit;
      await setTarget(X2, DB);
      await until(async () => (await view()) === 'ready', 'K B ready');
      held.release();
      await until(async () => reqs.filter((r) => r.action === 'context').every((r) => r.outcome), 'K late A reply answered'); await settle(); await settle();
      const lateA = reqs.find((r) => r.action === 'context' && r.body.contactId === X1);
      check('K CONTROL A\'s late reply carried A\'s draft', lateA && lateA.reply && lateA.reply.drafts && lateA.reply.drafts.seller_reason === 'A SECRET TEXT', lateA && lateA.reply);
      check('K nothing of A appears in B (field, recovery note or anywhere on the page)', (await reasonText()) === '' && !(await bodyText()).includes('A SECRET TEXT'), await reasonText());
      await closePage();
    }

    // ── L (A3l): operator change A -> expired -> B; nothing of A carries over. ───────────────────────────
    {
      freshState(); const t1 = token(OP_A, 8000);
      await ready(t1);
      await T('pa-seller-reason').fill('A TYPED NOT SAVED');
      await page.waitForTimeout(Math.max(0, Date.parse(t1.expiresAt) - Date.now() + 300));
      await blur(); await settle();
      check('L CONTROL after A\'s expiry the form and A\'s text are kept (A -> expired)', (await reasonText()) === 'A TYPED NOT SAVED');
      await setSession(token(OP_B));
      await until(async () => (await view()) !== 'loading', 'L B loaded'); await settle(); await settle();
      check('L a DIFFERENT operator gets nothing of A: no text, draft or status', !(await bodyText()).includes('A TYPED NOT SAVED') && ((await reasonText()) === null || (await reasonText()) === ''), { view: await view(), text: await reasonText() });
      await closePage();
    }

    // ── M (A3m): same operator, new session: local text kept; access/buttons cleared until its own reply. ─
    {
      freshState(); const t1 = token();
      await ready(t1);
      await T('pa-seller-reason').fill('M answer');
      rule('save', 'dropResponse');
      await T('pa-save-reason').click();
      await until(async () => await hasCheck(), 'M Check again for the holder');
      const held = rule('context', 'hold');
      const t2 = token(); assert.notEqual(t2.token, t1.token, 'a genuinely different session');
      await setSession(t2);
      await held.hit; await settle();
      check('M right after the new session, before its own reply: no status button, text kept', !(await hasCheck()) && !(await hasRead()) && (await reasonText()) === 'M answer', await buttons());
      held.release();
      await until(async () => (await hasRead()) || (await hasCheck()), 'M new session reply'); await settle();
      check('M the new session\'s own reply grants read-only status only; text kept', (await hasRead()) && !(await hasCheck()) && (await reasonText()) === 'M answer', { buttons: await buttons(), sent: reqs.map((r) => [r.action, r.authz === `Bearer ${t1.token}` ? 's1' : 's2', r.status, r.reply && (r.reply.code || r.reply.outcome), r.reply && r.reply.access]) });
      await closePage();
    }

    // ── N (Fresh load) + O (a final-looking status never reopens saving). ────────────────────────────────
    {
      freshState(); const t1 = token();
      await ready(t1);
      await T('pa-seller-reason').fill('N stopped answer'); await blur();
      await until(async () => (await textOf('pa-draft-note')) === 'Draft saved on the server.', 'N draft');
      putFails = 1;
      await T('pa-save-reason').click();
      await until(async () => sent('save').length === 1 && sent('context').length >= 2, 'N provider-failed save'); await settle();
      check('N CONTROL the evaluation is stopped (provider-failed save: not_confirmed)', /stopped/.test(JSON.stringify(sent('context').slice(-1)[0].reply || {})), sent('context').slice(-1)[0].reply);
      const b0 = budgetSnap(), p0 = puts(), s0 = sent('save').length, h0 = sent('history').length;
      await page.reload(); await page.waitForFunction(() => window.__harnessReady === true, null, { timeout: 60000 });
      await setSession(token()); await start();   // FRESH load: empty state, a new sign-in
      await until(async () => (await view()) !== 'loading' && (await view()) !== 'hidden', 'N fresh load'); await settle();
      check('N FRESH load: the saved draft is recovered READ-ONLY, labelled as unverified prior association', (await reasonText()) === 'N stopped answer' && (await T('pa-seller-reason').getAttribute('readonly')) !== null
        && /previously observed contact\/deal association/.test(await bodyText()), { text: await reasonText(), recovery: await textOf('pa-recovery') });
      check('N FRESH load: saving stays disabled', (await T('pa-save-reason').isDisabled()));
      await page.evaluate(() => document.querySelector('[data-testid="pa-save-reason"]').click()); await settle();
      check('N FRESH load: no grant, capacity or continuation change; no S1, history or resend', budgetSnap() === b0 && puts() === p0 && sent('save').length === s0 && sent('history').length === h0);
      // O: a final-looking read-only status (synthetic reply carrying the real operator echo) never reopens saving.
      const view0 = sent('context').slice(-1)[0].reply;
      check('O CONTROL the fresh session is offered read-only status only', (await hasRead()) && !(await hasCheck()), { buttons: await buttons(), access: view0 && view0.access });
      rule('check', 'synthetic', { reply: { outcome: 'not_saved', access: 'read', readOnly: true, operatorDigest: dg(OP_A), view: { op: 'synthetic-op-00001', field: 'seller_reason', opportunityId: DA, state: 'not_saved', s1: 'withdrawn', s2: 'pending', s2Attempt: 0 } } });
      await page.locator('button', { hasText: 'View recorded status' }).first().click();
      await until(async () => /Recorded status \(read-only\): Not saved/.test(await textOf('pa-message') || ''), 'O final-looking status'); await settle();
      check('O a final-looking status (not_saved) does not reopen saving under closed authority', (await T('pa-save-reason').isDisabled()) && budgetSnap() === b0, await textOf('pa-message'));
      await closePage();
    }

    // ── F1 (Bones, review of df623e6): the operator-echo digest is asynchronous. Hold it, switch to a genuinely new
    //    same-operator session (refused session_mismatch), then release: the stale 200 must never reopen saving.
    {
      freshState(); const t1 = token(), t2 = token(); assert.notEqual(t1.token, t2.token);
      await openPage(); await setSession(t1);
      await page.evaluate(() => {
        const real = crypto.subtle.digest.bind(crypto.subtle); let first = true;
        crypto.subtle.digest = async (...args) => {
          if (first) { first = false; window.__digestHit = true; await new Promise((r) => { window.__releaseDigest = r; }); }
          return real(...args);
        };
      });
      await start();
      await page.waitForFunction(() => window.__digestHit === true);
      check('F1 CONTROL the old context was a genuine server 200 before the identity changed', sent('context')[0] && sent('context')[0].status === 200);
      await setSession(t2);
      await until(async () => sent('context').length >= 2 && sent('context')[1].status === 409, 'F1 new session refused');
      await settle(); await settle();
      check('F1 CONTROL the new session\'s context was refused session_mismatch; no write dispatched', sent('context')[1] && sent('context')[1].reply && sent('context')[1].reply.code === 'budget_session_mismatch' && puts() === 0);
      await page.evaluate(() => window.__releaseDigest());
      await settle(); await settle();
      if ((await view()) === 'ready') await T('pa-seller-reason').fill('Current session unsaved text');
      const enabled = (await view()) === 'ready' && !(await T('pa-save-reason').isDisabled());
      check('F1 the stale old 200 released after its digest cannot reopen saving for the newer, refused session', !enabled, { view: await view(), enabled, banner: await textOf('pa-banner'), puts: puts() });
      await closePage();
    }

    check('no request left the machine (no foreign or unmodelled request)', foreign.length === 0, foreign);
    check('no page error', pageErrors.length === 0, pageErrors);
  } catch (e) {
    failures += 1; console.error('ABORTED  ' + (e && e.stack ? e.stack.split('\n').slice(0, 6).join('\n') : e));
  }
  const FLOOR = 30;
  if (checks < FLOOR) { failures += 1; console.error(`FLOOR  only ${checks} checks ran (floor ${FLOOR})`); }
  console.log(`\nProperty answers authority: ${results.filter((r) => r.ok).length}/${checks} checks passed (failures=${failures})`);
  await exit(failures ? 1 : 0);
}
main();
