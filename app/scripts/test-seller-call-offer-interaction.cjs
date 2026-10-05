/**
 * Board 15 / PR #126 re-review (Bones; Jess 2026-10-05) — the Current Offer
 * label on the Seller Call deal bar, driven as an operator would.
 *
 * Offline. Vite serves scripts/harness/contact-isolation (the REAL
 * SellerCallWorkspace with the real GHL client) in headless Chromium. Every
 * /.netlify/functions request is answered here from an in-memory fixture that
 * models the Opportunity Current Offer carrier: the write (ghl-write
 * opportunity.currentOffer) and its readback (ghl-proxy /opportunities/:id).
 * Any response can be held or refused. Nothing leaves the machine.
 *
 * "Recorded in GHL" must apply ONLY to the amount confirmed saved:
 *   1. typing (before leaving the field) is a draft and sends nothing;
 *   2. leaving the field saves: "Saving to GHL…" while held, then
 *      "Recorded in GHL" once GHL reads the amount back;
 *   3. a refused save says "Not saved", the carrier keeps the old amount,
 *      and the new amount is never labelled recorded;
 *   4. an amount restored from the GHL carrier on load is recorded.
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
const OFFER_FIELD = CFG.opportunityFacts.currentOffer;

let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}

// ── In-memory fixture: one contact, one opportunity ─────────────────────────
const A = 'fixtureContactA';
const OPP = `${A}-opp`;
let db;
function resetDb({ offer = null } = {}) { db = { offer, notes: [{ id: 'n1', body: 'Seed note for Alpha', dateAdded: '2026-09-30T12:00:00.000Z' }] }; }
const oppListRow = () => ({ id: OPP, contactId: A, contactName: 'Alpha', opportunityName: 'Alpha deal', phone: '', email: '', stageId: 'fixture-stage',
  customFields: db.offer === null ? [] : [{ id: OFFER_FIELD, fieldValueNumber: db.offer }] });
const oppDetail = () => ({ opportunity: { id: OPP, customFields: db.offer === null ? [] : [{ id: OFFER_FIELD, fieldValue: db.offer }] } });
let log = [];
let holds = [];
let refuseNext = 0;
function hold(match) {
  let release; let onHit;
  const h = { match, released: new Promise((r) => { release = r; }), hit: new Promise((r) => { onHit = r; }) };
  h.release = release; h.onHit = onHit; holds.push(h); return h;
}
function classify(url, method, post) {
  const u = new URL(url);
  const fn = u.pathname.replace('/.netlify/functions/', '');
  if (fn === 'ghl-write' && method === 'POST') return { kind: 'write', op: post.operation, target: post.targetId, args: post.args };
  if (fn === 'ghl-proxy') {
    const p = u.searchParams.get('path') || '';
    if (/^\/contacts\/[^/?]+\/notes$/.test(p)) return { kind: 'notes' };
    if (/^\/contacts\/[^/?]+$/.test(p)) return { kind: 'detail' };
    if (/^\/opportunities\/[^/?]+$/.test(p)) return { kind: 'opp-read' };
    return { kind: 'proxy-other', path: p };
  }
  return { kind: fn };
}
function answer(req) {
  switch (req.kind) {
    case 'write':
      if (req.op !== 'opportunity.currentOffer' || req.target !== OPP) return { status: 400, body: { error: `fixture does not model ${req.op}` } };
      db.offer = req.args.value; return { status: 200, body: { confirmed: true } };
    case 'opp-read': return { status: 200, body: oppDetail() };
    case 'notes': return { status: 200, body: { notes: db.notes.slice() } };
    case 'detail': return { status: 200, body: { contact: { id: A, firstName: 'Alpha', lastName: 'Fixture', phone: '+15555550100', customFields: [] } } };
    case 'ghl-contact': return { status: 200, body: { id: A, firstName: 'Alpha', lastName: 'Fixture', phone: '+15555550100', tags: [] } };
    case 'ghl-opportunities': return { status: 200, body: { pipelineId: 'fixture-pipeline', stages: [], opportunities: [oppListRow()] } };
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
      let post = null;
      try { post = route.request().postDataJSON(); } catch { post = null; }
      const req = classify(url, route.request().method(), post);
      log.push(req);
      const h = holds.find((x) => !x.used && x.match(req));
      if (h) { h.used = true; h.onHit(req); await h.released; }
      if (req.kind === 'write' && refuseNext > 0) {
        refuseNext -= 1;
        return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'fixture: write refused' }) });
      }
      const res = answer(req);
      return route.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(res.body) });
    });
    await page.context().route(/gohighlevel\.com/, (route) => route.abort());
    await page.goto(`${base}/scripts/harness/contact-isolation/index.html`);
    await page.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 });
    const go = (to) => page.evaluate((t) => window.__iaosNavigate(t), to);
    const until = async (fn, label, ms = 15000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(50); }
      throw new Error(`timed out waiting for ${label}`);
    };
    const note = async () => {
      const el = page.getByTestId('deal-bar-note-current_offer');
      return (await el.count()) ? (await el.innerText()).trim() : null;
    };
    const writes = () => log.filter((r) => r.kind === 'write');
    const input = () => page.getByTestId('negotiation-current-offer-input');
    const fresh = async (opts) => {
      resetDb(opts); log = []; holds = []; refuseNext = 0;
      await go('/'); await page.waitForTimeout(300);
      await go(`/contacts/${A}/seller-call`);
      await input().waitFor({ timeout: 30000 });
    };

    // 1 — typing is a draft and sends nothing.
    await fresh({});
    await input().fill('250000');
    await until(async () => (await note()) !== null, 'current offer note');
    const draftNote = await note();
    check('1 a typed, unsaved amount is labelled a draft', draftNote.startsWith('Draft — not saved yet'), draftNote);
    check('1 the draft is never labelled "Recorded in GHL"', !/Recorded in GHL/.test(draftNote), draftNote);
    check('1 typing sends no write', writes().length === 0, writes());

    // 2 — leaving the field saves; "Saving…" while held; "Recorded" after readback.
    const h = hold((r) => r.kind === 'write');
    await input().press('Tab');
    await h.hit;
    await until(async () => ((await note()) || '').startsWith('Saving to GHL…'), 'saving label');
    check('2 while the save is in flight the label says "Saving to GHL…"', (await note()).startsWith('Saving to GHL…'), await note());
    h.release();
    await until(async () => ((await note()) || '').startsWith('Recorded in GHL'), 'recorded label');
    check('2 after GHL reads the amount back it is "Recorded in GHL"', (await note()).startsWith('Recorded in GHL'), await note());
    check('2 exactly one write, the opportunity Current Offer, with the typed amount',
      writes().length === 1 && writes()[0].op === 'opportunity.currentOffer' && writes()[0].args.value === 250000, writes());
    check('2 the save was confirmed by a readback of the opportunity', log.some((r) => r.kind === 'opp-read'));
    check('2 the carrier now holds 250000', db.offer === 250000, db.offer);

    // 3 — a refused save: "Not saved", carrier unchanged, never "Recorded" for the new amount.
    await input().fill('260000');
    check('3 editing the recorded amount makes it a draft again', ((await note()) || '').startsWith('Draft — not saved yet'), await note());
    refuseNext = 1;
    const before = writes().length;
    await input().press('Tab');
    await until(async () => ((await note()) || '').startsWith('Not saved'), 'not saved label');
    check('3 a refused save is labelled "Not saved"', (await note()).startsWith('Not saved — the save was refused or could not be confirmed'), await note());
    check('3 the save error is shown', await page.getByTestId('current-offer-write-error').isVisible());
    check('3 the refused amount is never labelled recorded', !/Recorded in GHL/.test(await note()), await note());
    check('3 one write was attempted and the carrier still holds the old amount', writes().length === before + 1 && db.offer === 250000, { writes: writes().length - before, offer: db.offer });

    // 4 — an amount restored from the GHL carrier on load is recorded.
    await fresh({ offer: 300000 });
    await until(async () => (await input().inputValue()) !== '', 'restored offer');
    await until(async () => (await note()) !== null, 'restored note');
    check('4 the carrier amount is restored into the field', (await input().inputValue()).replace(/[^0-9]/g, '') === '300000', await input().inputValue());
    check('4 a restored carrier amount is "Recorded in GHL"', (await note()).startsWith('Recorded in GHL'), await note());
    check('4 restoring sends no write', writes().length === 0, writes());

    check('no request left the machine', foreign.length === 0, foreign);
    check('no page errors', pageErrors.length === 0, pageErrors);
  } catch (e) {
    console.error(e);
    failures += 1;
  }
  console.log(`\nSeller Call Current Offer interaction: ${checks - failures}/${checks} checks passed`);
  await exit(failures ? 1 : 0);
}
main();
