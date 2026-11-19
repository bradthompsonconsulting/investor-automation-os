/**
 * B15-04 (Captain GO 2026-11-19, Scotty plan 2026-11-15 §3, A8/A9) -- a kept Seller Call conversation draft and Save
 * at Summary. Offline, rendered: the REAL App (scripts/harness/app-routes) on /contacts/:id/seller-call with the
 * seller-call-offer-ready fixture, exactly as test-seller-conversation-save-rendered.cjs runs its flag-ON cases: the
 * harness override asks for the Save-enabled projection computed by the REAL projectRuntimeConfig from the Test config
 * (the committed configuration stays DISABLED; nothing here changes it). Every ghl-write is answered locally (mock).
 *
 *   C1  every item confirmed: the conversation note is written once; the kept draft is removed; a reload shows an
 *       empty conversation; typing again keeps a new draft (persistence still works after a clear)
 *   C2  confirmed with "not saved" items present (address and reason are carried by the note only): the draft is
 *       still removed once every write is confirmed
 *   R1  the conversation note REFUSED (409 not_sent): the draft is kept exactly; a reload brings the answers back;
 *       nothing is re-sent by the reload
 *   U1  the conversation note UNCERTAIN (network abort): the draft is kept; a reload brings the answers back; nothing
 *       is re-sent by the reload
 *   W   nothing left the machine; no page errors
 */
'use strict';
const path = require('node:path');
require('./harness/ts-loader.cjs');
const fx = require('./harness/seller-call-offer-ready-fixture.cjs');

const APP = path.resolve(__dirname, '..');
const HARNESS = '/scripts/harness/app-routes/index.html';
const A = fx.CONTACT;
const { getConfig } = require(path.join(APP, 'shared/ghl-config.ts'));
const OCC_ID = getConfig('test').fields.occupancyStatus;
const PREFIX = 'iaos-contact-draft:v1:conversation|';
const OPEN_TEXT = 'Open to talking';
const NOTES_TEXT = 'Seller prefers mornings. Dog on site.';
const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const watchdog = setTimeout(() => { console.error('FAIL  did not finish within 8 minutes'); process.exit(1); }, 8 * 60_000);

/** Literal check() call sites: C1 x4, C2, R1 x3, U1 x3, W = 12. */
const FLOOR = 12;
let checks = 0; let failures = 0;
function check(name, ok, detail) {
  checks += 1; if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : ` -- ${JSON.stringify(detail).slice(0, 600)}`}`);
}

async function main() {
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const tailwindcss = (await import('@tailwindcss/vite')).default;
  const { chromium } = require('playwright');
  const server = await createServer({
    root: APP, configFile: false, plugins: [react(), tailwindcss()], logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: [HARNESS.slice(1)], include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] },
  });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const log = { foreign: [], pageErrors: [] };

  /** The fixture's own write model (as test-seller-conversation-save-rendered): notes appended; occupancy stored. */
  function land(req) {
    if (req.operation === 'note.create') {
      fx.state.createdNotes += 1;
      fx.state.notes.push({ id: `b1504-${fx.state.createdNotes}`, body: req.args.body, dateAdded: '2026-11-19T15:00:00.000Z' });
      return { status: 200, body: { confirmed: true, note: { id: `b1504-${fx.state.createdNotes}` } } };
    }
    if (req.operation === 'contact.occupancy') {
      fx.state.contactFields = fx.state.contactFields.filter((f) => f.id !== OCC_ID);
      if (req.args.value !== '') fx.state.contactFields.push({ id: OCC_ID, value: [req.args.value] });
      return { status: 200, body: { confirmed: true } };
    }
    return { status: 400, body: { error: `fixture does not model ${req.operation}` } };
  }

  /** One browser context (its own localStorage) with Save enabled in the harness; `respond(w, n)` answers the n-th write. */
  async function session(respond) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'America/Chicago', locale: 'en-US' });
    await context.addInitScript((o) => { window.__iaosHarnessOverride = o; }, { sellerConversationSave: true, writeSession: true });
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.on('dialog', (d) => d.accept().catch(() => {}));   // the leave prompt on reload: the operator chooses Leave
    page.on('pageerror', (e) => log.pageErrors.push(String(e)));
    const writes = [];
    await context.route('**/*', async (rt) => {
      const r = rt.request(); const url = r.url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return rt.continue();
      if (!url.includes('/.netlify/functions/')) { log.foreign.push(url); return rt.abort(); }
      const fn = new URL(url).pathname.replace('/.netlify/functions/', '');
      if (r.method() !== 'GET') {
        let post = null; try { post = JSON.parse(r.postData() || 'null'); } catch { /* as is */ }
        const w = { fn, operation: post && post.operation, args: post && post.args };
        writes.push(w);
        if (fn !== 'ghl-write') return rt.fulfill(json(405, { error: 'offline test refuses this' }));
        const a = await respond(w, writes.length);
        if (a === 'abort') return rt.abort('failed');
        return rt.fulfill(json(a.status, a.body));
      }
      if (fn === 'app-read-session') return rt.fulfill(json(200, { signedIn: true, expiresAt: new Date(Date.now() + 3600_000).toISOString() }));
      const a = fx.answer(fx.classify(url, 'GET', null));
      return rt.fulfill(json(a.status, a.body));
    });
    const open = async () => {
      await page.goto(`${base}${HARNESS}?start=${encodeURIComponent(`/contacts/${A}/seller-call`)}`);
      await page.waitForFunction(() => typeof window.__iaosAppSource === 'string', null, { timeout: 90000 });
      await page.getByTestId('sc-card').waitFor({ timeout: 60000 });
      await page.getByTestId('sc-readiness-status').waitFor({ timeout: 60000 });
      await page.waitForTimeout(500);
    };
    return { context, page, writes, open };
  }
  const T = (page, id) => page.getByTestId(id);
  const press = async (page, id) => { try { await T(page, id).click({ timeout: 4000 }); return true; } catch { return false; } };
  const fill = async (page, id, v) => { try { await T(page, id).fill(v, { timeout: 4000 }); return true; } catch { return false; } };
  const kept = (page) => page.evaluate((p) => Object.keys(localStorage).filter((k) => k.startsWith(p)).map((k) => localStorage.getItem(k)), PREFIX);
  const shown = async (page) => { await press(page, 'sc-nav-opening'); return { open: await T(page, 'sc-field-opening-response').inputValue().catch(() => null), notes: await T(page, 'sc-call-notes').inputValue().catch(() => null) }; };
  const waitIdle = async (page) => { for (let i = 0; i < 80; i++) { if ((await T(page, 'sc-save').textContent().catch(() => '')) === 'Save') return; await page.waitForTimeout(100); } };
  const results = (page) => page.locator('[data-testid^="sc-save-result-"]').evaluateAll((els) => els.map((e) => e.className.replace(/.*sc-save-result-/, '')));
  async function typeCall(page, { address = false } = {}) {
    await press(page, 'sc-nav-opening'); await fill(page, 'sc-field-opening-response', OPEN_TEXT);
    await press(page, 'sc-nav-occupancy'); await T(page, 'sc-field-occupancy-occupancy').selectOption('Tenant Occupied').catch(() => {});
    await press(page, 'sc-nav-timing'); await fill(page, 'sc-field-timing-timing', 'Close by March 1');
    await press(page, 'sc-nav-price'); await fill(page, 'sc-field-price-amount', '410000');
    await press(page, 'sc-nav-asis'); await press(page, 'sc-dont-know');
    if (address) {
      await press(page, 'sc-nav-address'); await fill(page, 'sc-field-address-street', '1 Main St');
      await press(page, 'sc-nav-reason'); await fill(page, 'sc-field-reason-reason', 'Relocating for work');
    }
    await fill(page, 'sc-call-notes', NOTES_TEXT);
    await page.waitForTimeout(500);
  }
  const conversationNotes = (writes) => writes.filter((w) => w.operation === 'note.create' && /conversation/i.test(String(w.args && w.args.body))).length;

  try {
    // ── C1: every item confirmed ──
    fx.reset();
    {
      const s = await session((w) => land(w));
      await s.open();
      await typeCall(s.page);
      await press(s.page, 'sc-nav-summary'); await s.page.waitForTimeout(400);
      const before = await kept(s.page);   // after moving to Summary (the current question is part of the draft)
      await press(s.page, 'sc-save'); await s.page.waitForTimeout(300); await waitIdle(s.page); await s.page.waitForTimeout(800);
      const res = await results(s.page);
      const after = await kept(s.page);
      check('C1 every item confirmed: the conversation note was written once and every result reads confirmed', conversationNotes(s.writes) === 1 && res.length > 0 && res.every((r) => r === 'confirmed'), { res, ops: s.writes.map((w) => w.operation) });
      check('C1 the kept draft existed before Save and is removed after the confirmed Save', before.length === 1 && after.length === 0, { before: before.length, after: after.length });
      const n0 = s.writes.length;
      await s.open();
      const r = await shown(s.page);
      check('C1 a reload shows an empty conversation, and nothing was sent by the reload', r.open === '' && r.notes === '' && s.writes.length === n0, { r, extra: s.writes.slice(n0) });
      await fill(s.page, 'sc-field-opening-response', 'A new call starts'); await s.page.waitForTimeout(500);
      check('C1 typing again keeps a new draft (persistence works after a clear)', (await kept(s.page)).length === 1);
      await s.context.close();
    }
    // ── C2: confirmed with "not saved" items present ──
    fx.reset();
    {
      const s = await session((w) => land(w));
      await s.open();
      await typeCall(s.page, { address: true });
      await press(s.page, 'sc-nav-summary');
      const notSaved = await s.page.locator('[data-testid^="sc-save-item-"][data-action="not_saved"]').count();
      await press(s.page, 'sc-save'); await s.page.waitForTimeout(300); await waitIdle(s.page); await s.page.waitForTimeout(800);
      const res = await results(s.page);
      check('C2 with "not saved" items (address, reason) present, every write confirmed removes the draft', notSaved >= 1 && res.every((r) => r === 'confirmed') && (await kept(s.page)).length === 0, { notSaved, res });
      await s.context.close();
    }
    // ── R1: refused ──
    fx.reset();
    {
      const s = await session((w, n) => (n === 1 ? { status: 409, body: { outcome: 'not_sent', error: 'Malformed or undeclared ledger note' } } : land(w)));
      await s.open();
      await typeCall(s.page);
      await press(s.page, 'sc-nav-summary'); await s.page.waitForTimeout(400);
      const before = await kept(s.page);   // after moving to Summary (the current question is part of the draft)
      await press(s.page, 'sc-save'); await s.page.waitForTimeout(300); await waitIdle(s.page); await s.page.waitForTimeout(800);
      const res = await results(s.page);
      const after = await kept(s.page);
      check('R1 the conversation note refused: its result reads refused and the kept draft is unchanged', res.includes('refused') && after.length === 1 && after[0] === before[0], { res, same: after[0] === before[0] });
      const n0 = s.writes.length;
      await s.open();
      const r = await shown(s.page);
      check('R1 a reload brings the answers back', r.open === OPEN_TEXT && r.notes === NOTES_TEXT, r);
      check('R1 nothing was re-sent by the reload', s.writes.length === n0, s.writes.slice(n0).map((w) => w.operation));
      await s.context.close();
    }
    // ── U1: uncertain ──
    fx.reset();
    {
      const s = await session((w, n) => (n === 1 ? 'abort' : land(w)));
      await s.open();
      await typeCall(s.page);
      await press(s.page, 'sc-nav-summary'); await s.page.waitForTimeout(400);
      const before = await kept(s.page);   // after moving to Summary (the current question is part of the draft)
      await press(s.page, 'sc-save'); await s.page.waitForTimeout(300); await waitIdle(s.page); await s.page.waitForTimeout(800);
      const res = await results(s.page);
      const after = await kept(s.page);
      check('U1 the conversation note uncertain (network abort): its result reads uncertain and the kept draft is unchanged', res.includes('uncertain') && after.length === 1 && after[0] === before[0], { res, same: after[0] === before[0] });
      const n0 = s.writes.length;
      await s.open();
      const r = await shown(s.page);
      check('U1 a reload brings the answers back', r.open === OPEN_TEXT && r.notes === NOTES_TEXT, r);
      check('U1 nothing was re-sent by the reload', s.writes.length === n0, s.writes.slice(n0).map((w) => w.operation));
      await s.context.close();
    }
    check('W nothing left the machine; no page errors', log.foreign.length === 0 && log.pageErrors.length === 0, { foreign: log.foreign.slice(0, 3), pageErrors: log.pageErrors.slice(0, 3) });
  } catch (e) { check(`run completed (${String(e && e.message).split('\n')[0]})`, false); }
  clearTimeout(watchdog);
  await browser.close().catch(() => {}); await server.close().catch(() => {});
  if (checks < FLOOR) check(`at least ${FLOOR} checks ran`, false, checks);
  console.log(`\nB15-04 conversation drafts and Save: ${checks - failures}/${checks} checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
