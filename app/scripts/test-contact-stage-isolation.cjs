/**
 * Board 15 / PR #129 re-review (Bones; Jess 2026-10-05) — a late response for
 * contact A must never populate contact B's deal stage or deal data.
 *
 * Offline. Vite serves scripts/harness/contact-isolation (the REAL
 * ContactWorkspace with the real GHL client) in headless Chromium. Every
 * /.netlify/functions request is answered here from an in-memory fixture;
 * any response can be HELD, so A's reads are still pending when the page
 * moves to B. Nothing leaves the machine; no write is expected.
 *
 * A: stage "Seller Offer Sent", Opportunity Ask $111,111.
 * B: stage "New Lead - Seller", Opportunity Ask $222,222.
 *
 * Proves: open A with its pipeline, detail and contact reads held -> move to
 * B -> B loads -> release A's late responses -> B still shows B's stage, B's
 * Ask and B's name, never A's; and B's page shows the Contract Workspace
 * pointer, not a contract status.
 */
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const APP = path.resolve(__dirname, '..');
Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);
const { getConfig } = require(path.join(APP, 'shared/ghl-config.ts'));
const CFG = getConfig('test');
const ASK = CFG.opportunityFacts.askingPrice;

let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}

const A = 'fixtureContactA';
const B = 'fixtureContactB';
const CONTACTS = {
  [A]: { first: 'Alpha', stageId: 'stage-offer', ask: 111111 },
  [B]: { first: 'Bravo', stageId: 'stage-new', ask: 222222 },
};
const STAGES = [
  { id: 'stage-new', name: 'New Lead - Seller', position: 0 },
  { id: 'stage-offer', name: 'Seller Offer Sent', position: 6 },
];
const pipeline = () => ({
  pipelineId: 'fixture-pipeline', stages: STAGES,
  opportunities: [A, B].map((id) => ({ id: `${id}-opp`, contactId: id, contactName: CONTACTS[id].first, opportunityName: `${CONTACTS[id].first} deal`,
    phone: '', email: '', stageId: CONTACTS[id].stageId, customFields: [{ id: ASK, fieldValueNumber: CONTACTS[id].ask }] })),
});
const row = (id) => ({ id, firstName: CONTACTS[id].first, lastName: 'Fixture', phone: '+15555550100', email: '', address1: '', city: '', state: '', postalCode: '',
  dateAdded: '2026-09-01T00:00:00.000Z', tags: [], dndSettings: {}, motivationScore: null, dealScore: null, combinedScore: null, completenessScore: null,
  callbackDatetime: null, callbackDatetimePrecise: null, lastCallAttempt: null, lastCallAttemptPrecise: null, callDisposition: null, dispositionAt: null });
const detail = (id) => ({ contact: { id, firstName: CONTACTS[id].first, lastName: 'Fixture', phone: '+15555550100', dndSettings: {}, customFields: [] } });

let log = [];
let holds = [];
let currentNav = null;
let failNextPipeline = false;   // R2: the next released pipeline read answers 500   // which contact the page was opened for when a request arrived
function hold(match) {
  let release; let onHit;
  const h = { match, released: new Promise((r) => { release = r; }), hit: new Promise((r) => { onHit = r; }) };
  h.release = release; h.onHit = onHit; holds.push(h); return h;
}
function classify(url, method) {
  const u = new URL(url);
  const fn = u.pathname.replace('/.netlify/functions/', '');
  if (fn === 'ghl-write' && method === 'POST') return { kind: 'write' };
  if (fn === 'ghl-proxy') {
    const p = u.searchParams.get('path') || '';
    let m;
    if ((m = p.match(/^\/contacts\/([^/?]+)\/notes$/))) return { kind: 'notes', contact: m[1] };
    if ((m = p.match(/^\/contacts\/([^/?]+)$/))) return { kind: 'detail', contact: m[1] };
    if (/\/customFields\/[^/]+$/.test(p)) return { kind: 'folder' };
    if (/\/customFields$/.test(p)) return { kind: 'defs' };
    return { kind: 'proxy-other', path: p };
  }
  if (fn === 'ghl-contact') return { kind: 'row', contact: u.searchParams.get('id') };
  return { kind: fn };
}
function answer(req) {
  switch (req.kind) {
    case 'notes': return { status: 200, body: { notes: [{ id: `${req.contact}-n1`, body: `Seed note for ${CONTACTS[req.contact].first}`, dateAdded: '2026-09-30T12:00:00.000Z' }] } };
    case 'detail': return { status: 200, body: detail(req.contact) };
    case 'row': return { status: 200, body: row(req.contact) };
    case 'defs': return { status: 200, body: { customFields: [] } };
    case 'folder': return { status: 200, body: { customField: { id: 'folder', name: 'Folder', position: 0 } } };
    case 'ghl-opportunities': return { status: 200, body: pipeline() };
    case 'ghl-underwriting-policy': return { status: 200, body: { values: [] } };
    case 'ghl-contact-conversations': return { status: 200, body: { messages: [], conversations: [] } };
    default: return { status: 404, body: { error: `fixture does not model ${req.kind}` } };
  }
}

async function main() {
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const { chromium } = require('playwright');
  const server = await createServer({
    root: APP, configFile: false, plugins: [react()], logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: ['scripts/harness/contact-isolation/index.html'],
      include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] },
  });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const foreign = [];
  const exit = async (code) => { await browser.close().catch(() => {}); await server.close().catch(() => {}); process.exit(code); };
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Chicago' });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { foreign.push(url); return route.abort(); }
      const req = classify(url, route.request().method());
      req.nav = currentNav;
      log.push(req);
      const h = holds.find((x) => !x.used && x.match(req));
      if (h) { h.used = true; h.onHit(req); await h.released; }
      if (failNextPipeline && req.kind === 'ghl-opportunities') {
        failNextPipeline = false;
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'fixture: injected refresh failure' }) });
      }
      const res = answer(req);
      return route.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(res.body) });
    });
    await page.context().route(/gohighlevel\.com/, (route) => route.abort());
    await page.goto(`${base}/scripts/harness/contact-isolation/index.html`);
    await page.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 });
    const go = (to) => page.evaluate((t) => window.__iaosNavigate(t), to);
    const text = () => page.locator('body').innerText();
    const until = async (fn, label, ms = 20000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(50); }
      throw new Error(`timed out waiting for ${label}`);
    };
    const stage = async () => {
      const el = page.getByTestId('contact-deal-stage');
      return (await el.count()) ? (await el.innerText()).trim() : null;
    };

    // Baseline: B alone shows B's stage and Ask.
    currentNav = B; await go(`/contacts/${B}`);
    await until(async () => (await stage()) === 'New Lead - Seller', 'B baseline stage');
    check('baseline: B shows its own stage', (await stage()) === 'New Lead - Seller', await stage());
    check('baseline: the contract line is the Contract Workspace pointer',
      (await page.getByTestId('contact-contract-state').innerText()).trim() === 'Open Contract Workspace to check contract status.');
    await go('/'); await page.waitForTimeout(300);

    // Open A with its pipeline, detail and contact reads HELD.
    log = []; holds = [];
    const hPipe = hold((r) => r.kind === 'ghl-opportunities' && r.nav === A);
    const hDetail = hold((r) => r.kind === 'detail' && r.contact === A);
    const hRow = hold((r) => r.kind === 'row' && r.contact === A);
    currentNav = A; await go(`/contacts/${A}`);
    await Promise.all([hPipe.hit, hDetail.hit, hRow.hit]);
    check('A\'s pipeline, detail and contact reads are in flight (held)', true);

    // Move to B; B loads fully.
    currentNav = B; await go(`/contacts/${B}`);
    await until(async () => (await stage()) === 'New Lead - Seller', 'B stage after A pending');
    await until(async () => (await text()).includes('Seed note for Bravo'), 'B notes');

    // Release A's late responses.
    hPipe.release(); hDetail.release(); hRow.release();
    await page.waitForTimeout(1500);
    const t = await text();
    check('after A\'s late responses, B still shows B\'s stage', (await stage()) === 'New Lead - Seller', await stage());
    check('A\'s stage never appears on B\'s page', !t.includes('Seller Offer Sent'), t.slice(0, 400));
    check('B\'s Opportunity Ask stays B\'s ($222,222), never A\'s ($111,111)', t.includes('$222,222') && !t.includes('$111,111'));
    check('A\'s deal name never appears on B\'s page', !t.includes('Alpha deal'));
    check('B\'s name is still the one shown', t.includes('Bravo') && !t.includes('Alpha Fixture'));
    // ── Re-review (Bones / Jess 2026-10-05): the TAB-RETURN refresh (refreshAll) ──
    // A hidden -> visible transition triggers refreshAll for the contact shown.
    const tabReturn = async () => {
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        document.dispatchEvent(new Event('visibilitychange'));
      });
    };
    const openFresh = async (who, first) => {
      currentNav = null; await go('/'); await page.waitForTimeout(300);
      currentNav = who; await go(`/contacts/${who}`);
      await until(async () => (await text()).includes(`Seed note for ${first}`), `${first} loaded`);
      await until(async () => (await stage()) !== null, `${first} stage`);
    };

    // R1 — A's refresh held -> move to B -> release A: B keeps its own data.
    await openFresh(A, 'Alpha');
    check('R1 setup: A shows its own stage', (await stage()) === 'Seller Offer Sent', await stage());
    log = []; holds = [];
    let refreshing = true;
    const rPipe = hold((r) => refreshing && r.kind === 'ghl-opportunities' && r.nav === A);
    const rDetail = hold((r) => refreshing && r.kind === 'detail' && r.contact === A);
    const rRow = hold((r) => refreshing && r.kind === 'row' && r.contact === A);
    await tabReturn();
    await Promise.all([rPipe.hit, rDetail.hit, rRow.hit]);
    check('R1 the tab return started A\'s refresh (pipeline, detail and contact reads held)', true);
    refreshing = false;
    currentNav = B; await go(`/contacts/${B}`);
    await until(async () => (await stage()) === 'New Lead - Seller', 'B stage during A refresh');
    await until(async () => (await text()).includes('Seed note for Bravo'), 'B notes');
    rPipe.release(); rDetail.release(); rRow.release();
    await page.waitForTimeout(1500);
    {
      const t = await text();
      check('R1 after A\'s late refresh, B keeps B\'s stage', (await stage()) === 'New Lead - Seller', await stage());
      check('R1 B keeps B\'s Ask and never shows A\'s', t.includes('$222,222') && !t.includes('$111,111'));
      check('R1 B keeps B\'s contact (no Alpha name, no A deal)', t.includes('Bravo') && !t.includes('Alpha Fixture') && !t.includes('Alpha deal'));
    }

    // R2 — A's refresh FAILS after the move: no refresh error on B.
    await openFresh(A, 'Alpha');
    log = []; holds = [];
    refreshing = true;
    const fPipe = hold((r) => refreshing && r.kind === 'ghl-opportunities' && r.nav === A);
    await tabReturn();
    await fPipe.hit;
    refreshing = false;
    currentNav = B; await go(`/contacts/${B}`);
    await until(async () => (await stage()) === 'New Lead - Seller', 'B stage before A failure');
    failNextPipeline = true;   // A's held pipeline read answers 500 when released
    fPipe.release();
    await page.waitForTimeout(1500);
    check('R2 A\'s failed refresh puts no refresh error on B', (await page.getByTestId('refresh-error').count()) === 0);
    check('R2 B still shows its own stage', (await stage()) === 'New Lead - Seller', await stage());

    check('no write was sent', !log.some((r) => r.kind === 'write'), log.filter((r) => r.kind === 'write'));
    check('no request left the machine', foreign.length === 0, foreign);
    check('no page errors', pageErrors.length === 0, pageErrors);
  } catch (e) {
    console.error(e);
    failures += 1;
  }
  console.log(`\nContact stage isolation: ${checks - failures}/${checks} checks passed`);
  await exit(failures ? 1 : 0);
}
main();
