/**
 * Pass 1 F33 (Brad, 2026-10-24) -- the Offer Readiness decision panel's
 * starting state and the operator's choice, on the REAL Seller Call page.
 *
 * OFFLINE, MOCKED BROWSER. Vite serves scripts/harness/readiness-panel (the
 * real page, the real GHL client, plus a re-read trigger). Every
 * /.netlify/functions request is answered here from an in-memory fixture;
 * every non-localhost request is aborted. Note saves go to that fixture only
 * (through the same receipt fixture the autosave suite uses); nothing can
 * reach GHL. Decisions are recorded through the page's own Override control,
 * so each decision carries the snapshot the page itself writes.
 *
 * Checks:
 *   1 absent decision starts closed; a current decision opens; a stale one
 *     starts closed and its summary says so;
 *   2 delayed loading and contact/deal navigation never set a starting state
 *     from the previous contact's or deal's data;
 *   3 the operator's toggle survives a save, a re-read and the decision
 *     going stale mid-call;
 *   4 returning to a contact or deal visited earlier keeps its choice.
 *
 *   node scripts/test-b15-33-readiness-panel.cjs
 */
const fs = require('fs');
const path = require('path');
const Module = require('node:module');
const ts = require('typescript');

const APP = path.resolve(__dirname, '..');
const PAGE = '/scripts/harness/readiness-panel/index.html';

Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);
Module._resolveFilename = ((original) => function (name, parent, ...rest) {
  if (name.startsWith('.') && parent) {
    const candidate = path.resolve(path.dirname(parent.filename), name + '.ts');
    if (fs.existsSync(candidate)) return candidate;
  }
  return original.call(this, name, parent, ...rest);
})(Module._resolveFilename);
const { createBarrierFixture } = require('./harness/current-offer-barrier-fixture.cjs');
const { parseOutcomeNote } = require(path.join(APP, 'src/lib/seller-call-outcome.ts'));
const { latestReadinessHumanActionForOpportunity, formatSellerPricePositionNote } = require(path.join(APP, 'src/lib/seller-call-readiness-carriers.ts'));

/** One per check() call site, taken from the finished file. */
const FLOOR = 21;
let checks = 0; let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}

const STALE_SUMMARY = 'Offer Readiness decision — last decision is stale; a fresh one is needed to authorize (optional)';
const PLAIN_SUMMARY = 'Offer Readiness decision — approve or override (optional)';

// ── In-memory GHL fixture ───────────────────────────────────────────────────
const PEOPLE = { A: 'Alpha', B: 'Bravo', C: 'Charlie', E: 'Echo', F: 'Foxtrot', D: 'Delta' };
const cid = (k) => `f33Contact${k}`;
const OPPS = [
  ...['A', 'B', 'C', 'E', 'F'].map((k) => ({ id: `${cid(k)}-opp`, contactId: cid(k), name: `${PEOPLE[k]} deal` })),
  { id: `${cid('D')}-opp`, contactId: cid('D'), name: 'Delta first deal' },
  { id: `${cid('D')}-opp2`, contactId: cid('D'), name: 'Delta second deal' },
];
const db = Object.fromEntries(Object.keys(PEOPLE).map((k) => [cid(k), { first: PEOPLE[k], notes: [] }]));
const slowReads = {};
const detail = (id) => ({ contact: { id, firstName: db[id].first, lastName: 'Fixture', phone: '+12145550101', dndSettings: {}, customFields: [] } });
const pipeline = () => ({ pipelineId: 'fixture-pipeline', stages: [],
  opportunities: OPPS.map((o) => ({ id: o.id, contactId: o.contactId, contactName: db[o.contactId].first, opportunityName: o.name,
    phone: '', email: '', stageId: 'fixture-stage', customFields: [] })) });
const bf = createBarrierFixture({ contactOf: (o) => (OPPS.find((x) => x.id === o) || {}).contactId || null });
function classify(url, method, post) {
  const u = new URL(url);
  const fn = u.pathname.replace('/.netlify/functions/', '');
  if (fn === 'ghl-write' && method === 'POST') return { kind: 'write', op: post?.operation, contact: post?.targetId, args: post?.args, requestId: post?.requestId };
  if (fn === 'ghl-proxy') {
    const p = u.searchParams.get('path') || '';
    let m;
    if ((m = p.match(/^\/contacts\/([^/?]+)\/notes$/))) return { kind: 'notes', contact: m[1] };
    if ((m = p.match(/^\/contacts\/([^/?]+)$/))) return { kind: 'detail', contact: m[1] };
    return { kind: 'proxy-other', path: p };
  }
  return { kind: fn };
}
function answer(req) {
  switch (req.kind) {
    case 'notes': return { status: 200, body: { notes: db[req.contact].notes.slice() } };
    case 'detail': return { status: 200, body: detail(req.contact) };
    case 'ghl-opportunities': return { status: 200, body: pipeline() };
    case 'ghl-underwriting-policy': return { status: 200, body: { values: [] } };
    case 'iaos-activation': return { status: 200, body: { state: 'open', activationId: 'v2-act-page-fixture', deployId: 'page-deploy', runtimeDeployId: 'page-deploy' } };
    default: return { status: 404, body: { error: `fixture does not model ${req.kind}` } };
  }
}
const decisionOf = (contact, opp) => latestReadinessHumanActionForOpportunity(db[contact].notes, opp);
/** Someone else records a seller price after the decision: the decision is stale from the next load on. */
function addNewerPriceNote(contact, opp) {
  db[contact].notes.push({ id: `${contact}-ext${db[contact].notes.length + 1}`, dateAdded: new Date().toISOString(),
    body: formatSellerPricePositionNote({ opportunityId: opp, at: new Date().toISOString(), operator: null, kind: 'price', price: 199000 }) });
}

let log = [];
const foreign = [];
const pageErrors = [];
const watchdog = setTimeout(() => { console.error('FAIL  the suite did not finish within 10 minutes -- stopped'); process.exit(1); }, 10 * 60_000);

async function main() {
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const tailwindcss = (await import('@tailwindcss/vite')).default;
  const { chromium } = require('playwright');
  const server = await createServer({
    root: APP, configFile: false, plugins: [react(), tailwindcss()], logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: [PAGE.slice(1)], include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] },
  });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const exit = async (code) => { clearTimeout(watchdog); await browser.close().catch(() => {}); await server.close().catch(() => {}); process.exit(code); };

  /** A fresh page load: a new browser session, so no remembered choices. */
  const open = async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Chicago' });
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await context.route('**/*', async (route) => {
      const u = route.request().url();
      if (u.startsWith(base) && !u.includes('/.netlify/functions/')) return route.continue();
      if (!u.includes('/.netlify/functions/')) { foreign.push(u); return route.abort(); }
      let post = null;
      try { post = route.request().postDataJSON(); } catch { post = null; }
      const req = classify(u, route.request().method(), post);
      req.method = route.request().method();
      log.push(req);
      const reply = (res) => route.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(res.body) }).catch(() => {});
      if (req.kind === 'call-log-barrier') return reply(await bf.handleCallLog(route.request().method(), u, post));
      if (req.kind === 'current-offer-barrier') return reply(await bf.handle(route.request().method(), u, post));
      if (req.kind === 'write') {
        if (!(req.op === 'note.create' && db[req.contact])) return reply({ status: 400, body: { error: 'fixture: malformed or unknown write' } });
        return reply(await bf.write({ operation: req.op, targetId: req.contact, requestId: req.requestId, contactId: req.contact, args: req.args },
          () => { db[req.contact].notes.push({ id: `${req.contact}-n${db[req.contact].notes.length + 1}`, body: req.args.body, dateAdded: new Date().toISOString() }); return { confirmed: true }; },
          { outcome: parseOutcomeNote(req.args.body), refuse: null }));
      }
      if (req.contact && slowReads[req.contact]) await new Promise((r) => setTimeout(r, slowReads[req.contact]));
      return reply(answer(req));
    });
    await page.goto(`${base}${PAGE}`, { timeout: 60000 });
    await page.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 });
    page.setDefaultTimeout(8000);
    return { context, page };
  };
  const panel = (page) => page.evaluate(() => {
    const d = document.querySelector('[data-testid="readiness-human-action-panel"]');
    return d ? { open: d.open, summary: d.querySelector('summary').textContent.trim(), contact: location.pathname.split('/')[2] } : null;
  });
  const until = async (page, fn, label, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await fn()) return; await page.waitForTimeout(40); }
    throw new Error(`timed out waiting for ${label}`);
  };
  const notesReads = (contact) => log.filter((r) => r.kind === 'notes' && r.contact === contact && r.method === 'GET').length;
  /** Navigate to a contact (and pick a deal), then wait for that contact's own notes and the panel. */
  const go = async (page, k, { deal, wait = true } = {}) => {
    await page.evaluate((to) => window.__iaosNavigate(to), `/contacts/${cid(k)}/seller-call`);
    if (!wait) return;
    if (deal) await page.getByRole('button', { name: deal }).click({ timeout: 60000 });
    await page.getByTestId('readiness-human-action-panel').waitFor({ timeout: 60000 });
    await until(page, async () => (await page.getByTestId('seller-price-position-input').count()) === 1, 'page loaded', 60000);
    await page.waitForTimeout(250);
  };
  const toggle = async (page) => { await page.getByTestId('readiness-human-action-panel').locator('summary').click(); await page.waitForTimeout(150); };
  /** Records an override through the page's own control (opening the panel first if needed). */
  const override = async (page, contact, opp) => {
    if (!(await panel(page)).open) await toggle(page);
    await page.getByPlaceholder('Reason for overriding (required)').fill('F33 fixture decision');
    await page.getByTestId('readiness-override-button').click();
    await until(page, async () => decisionOf(contact, opp) !== null, 'decision saved');
    await page.waitForTimeout(300);
  };
  const step = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, e.message.split('\n')[0]); } };

  try {
    const A = cid('A'), B = cid('B'), C = cid('C'), D = cid('D'), E = cid('E'), F = cid('F');
    const opp = (c) => `${c}-opp`;

    // ═══ 1. Starting state; a save keeps the operator's choice ═══════════════
    await step('absent decision starts closed', async () => {
      const { context, page } = await open();
      await go(page, 'A');
      const p0 = await panel(page);
      check('1 absent decision: the panel starts closed with the plain summary', p0 && p0.open === false && p0.summary === PLAIN_SUMMARY, p0);
      await override(page, A, opp(A));
      const p1 = await panel(page);
      check('3 the operator opened it and recorded a decision: the save leaves it open', p1 && p1.open === true && decisionOf(A, opp(A)).kind === 'overridden', p1);
      await context.close();
    });
    await step('current decision opens', async () => {
      const { context, page } = await open();
      await go(page, 'A');
      const p = await panel(page);
      check('1 current decision: the panel starts open with the plain summary', p && p.open === true && p.summary === PLAIN_SUMMARY, p);
      // Re-read with the operator's choice set to closed.
      await toggle(page);
      const before = notesReads(A);
      await page.evaluate(() => window.__iaosReread());
      await until(page, async () => notesReads(A) > before, 're-read');
      await page.waitForTimeout(400);
      const q = await panel(page);
      check('3 the operator closed it; a re-read keeps it closed', q && q.open === false && notesReads(A) > before, { q, reads: notesReads(A) - before });
      await toggle(page);
      const before2 = notesReads(A);
      await page.evaluate(() => window.__iaosReread());
      await until(page, async () => notesReads(A) > before2, 're-read 2');
      await page.waitForTimeout(400);
      const r = await panel(page);
      check('3 the operator re-opened it; a re-read keeps it open', r && r.open === true, r);
      await context.close();
    });
    await step('stale decision starts closed', async () => {
      addNewerPriceNote(A, opp(A));
      const { context, page } = await open();
      await go(page, 'A');
      const p = await panel(page);
      check('1 stale decision: the panel starts closed and its summary says the decision is stale', p && p.open === false && p.summary === STALE_SUMMARY, p);
      await context.close();
    });

    // ═══ 3. A decision going stale mid-call never moves the panel ═══════════
    for (const [k, close] of [['B', false], ['C', true]]) {
      await step(`stale mid-call (${k})`, async () => {
        const c = cid(k);
        { const { context, page } = await open(); await go(page, k); await override(page, c, opp(c)); await context.close(); }
        const { context, page } = await open();
        await go(page, k);
        const p0 = await panel(page);
        if (close) await toggle(page);
        await page.getByTestId('seller-price-position-input').fill('205000');
        await page.getByTestId('seller-price-position-panel').click({ position: { x: 5, y: 5 } });
        await until(page, async () => (await panel(page)).summary === STALE_SUMMARY, 'stale summary');
        await page.waitForTimeout(400);
        const p1 = await panel(page);
        check(`3 decision goes stale mid-call with the panel ${close ? 'closed by the operator' : 'open'}: it stays ${close ? 'closed' : 'open'}; the summary turns stale`,
          p0.open === true && p1.open === !close && p1.summary === STALE_SUMMARY, { p0, p1 });
        await context.close();
      });
    }

    // ═══ 2 + 4. Delayed loading, contact navigation, returning ═════════════
    await step('contact navigation', async () => {
      { const { context, page } = await open(); await go(page, 'F'); await override(page, F, opp(F)); await context.close(); }
      const { context, page } = await open();
      await go(page, 'F');
      const f0 = await panel(page);
      check('1 F has a current decision: open', f0 && f0.open === true, f0);
      // F -> E (no decision), with E's reads held back.
      slowReads[E] = 1500;
      await go(page, 'E', { wait: false });
      await page.waitForTimeout(500);
      const during = await panel(page);
      check("2 while E's reads are delayed, F's data on screen does not open the panel", during === null || during.open === false, during);
      await page.waitForTimeout(1500);
      await go(page, 'E');
      const e0 = await panel(page);
      check("2 E's own data decides E's start: no decision, so closed (not F's open)", e0 && e0.open === false && e0.contact === E, e0);
      await toggle(page);
      check('4 the operator opens E', (await panel(page)).open === true);
      // E -> F (delayed): F keeps its default; then the operator closes F.
      slowReads[F] = 1500;
      await go(page, 'F', { wait: false });
      await page.waitForTimeout(500);
      const during2 = await panel(page);
      check("2 while F's reads are delayed, the panel does not take a start from E's data", during2 === null || during2.contact === F, during2);
      await page.waitForTimeout(1500);
      await go(page, 'F');
      const f1 = await panel(page);
      check('4 back on F (visited earlier): open, as left', f1 && f1.open === true && f1.contact === F, f1);
      await toggle(page);
      delete slowReads[E]; delete slowReads[F];
      await go(page, 'E');
      const e1 = await panel(page);
      check("4 back on E: the operator's open is kept (E's default was closed)", e1 && e1.open === true && e1.contact === E, e1);
      await go(page, 'F');
      const f2 = await panel(page);
      check("4 back on F: the operator's close is kept (F's default was open)", f2 && f2.open === false && f2.contact === F, f2);
      await context.close();
    });

    // ═══ 2 + 4. Deal navigation ═══════════════════════════════════════════
    // Once a deal is chosen the page offers no in-page switch; choosing another
    // deal means leaving the page and picking it again (which remounts it).
    await step('deal navigation', async () => {
      { const { context, page } = await open(); await go(page, 'D', { deal: 'Delta first deal' }); await override(page, D, `${D}-opp`); await context.close(); }
      const { context, page } = await open();
      const leave = async () => { await page.evaluate(() => window.__iaosNavigate('/elsewhere')); await page.getByTestId('elsewhere').waitFor(); };
      await go(page, 'D', { deal: 'Delta first deal' });
      const d1 = await panel(page);
      check('1 deal 1 has a current decision: open', d1 && d1.open === true, d1);
      await toggle(page);
      await leave();
      await go(page, 'D', { deal: 'Delta second deal' });
      const d2 = await panel(page);
      check("2 deal 2 (no decision) starts closed, from its own data", d2 && d2.open === false && decisionOf(D, `${D}-opp2`) === null, d2);
      await toggle(page);
      await leave();
      await go(page, 'D', { deal: 'Delta first deal' });
      const d1b = await panel(page);
      check("4 back on deal 1: the operator's close is kept (its default was open)", d1b && d1b.open === false, d1b);
      await leave();
      await go(page, 'D', { deal: 'Delta second deal' });
      const d2b = await panel(page);
      check("4 back on deal 2: the operator's open is kept (its default was closed)", d2b && d2b.open === true, d2b);
      await context.close();
    });
  } catch (e) {
    check('suite completed', false, e.message.split('\n')[0]);
  }

  const writes = log.filter((r) => r.kind === 'write');
  check('offline: no foreign request and no page error', foreign.length === 0 && pageErrors.length === 0, { foreign, pageErrors });
  check('offline: every write was a note to the in-memory fixture', writes.length > 0 && writes.every((w) => w.op === 'note.create' && db[w.contact]), writes.map((w) => w.op));
  const unmodelled = [...new Set(log.filter((r) => !['notes', 'detail', 'ghl-opportunities', 'ghl-underwriting-policy', 'iaos-activation', 'write', 'call-log-barrier', 'current-offer-barrier'].includes(r.kind)).map((r) => r.kind + (r.path ? ` ${r.path}` : '')))];
  console.log(`unmodelled GET kinds answered 404: ${unmodelled.length ? unmodelled.join('; ') : 'none'}`);
  if (checks < FLOOR) { console.error(`FAIL  only ${checks} of ${FLOOR} checks ran`); failures += 1; }
  console.log(`\nB15 F33 readiness panel: ${checks - failures}/${checks} checks passed`);
  await exit(failures ? 1 : 0);
}
main();
