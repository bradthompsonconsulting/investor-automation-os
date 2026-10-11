/**
 * Board 14-13 Seller Call autosave, rendered (Brad, 2026-10-10; Transaction assumptions v2, Jess 2026-10-10).
 *
 * The real SellerCallWorkspace in the Seller Call harness page (headless Chromium, the AirDroid launcher mocked),
 * with every Netlify function answered by an in-memory GHL fixture. Nothing leaves the machine; no AirDroid
 * helper, no machine-wide dial lock.
 *
 * Covers: Seller Position saves on its own (leave, Enter) and survives a reload, clearing it too; Transaction
 * assumptions partial save + reload, completion, clearing a value, blank never None; the price saves on leave and
 * a blank price writes nothing; Saving / Saved / Couldn't save shown truthfully, text kept on failure, retry by
 * Save changes; opportunity isolation (two deals on one contact); rapid seller switching with a slow save never
 * writing to, or showing on, the wrong seller; deliberate actions (outcome, Current Offer) unchanged.
 *
 * The fixture does NOT run the server's ledger guard; that is test-seller-call-autosave-ledger.cjs (Jeff).
 */
const fs = require('fs');
const path = require('path');
const Module = require('node:module');
const ts = require('typescript');

const APP = path.resolve(__dirname, '..');
const HARNESS_DIR = path.join(APP, 'scripts/harness/seller-call-airdroid');
const WORKSPACE_PAGE = '/scripts/harness/seller-call-airdroid/workspace.html';
const MOCK = path.join(HARNESS_DIR, 'airdroid-launch-mock.ts');

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
const { parseSellerPositionNote } = require(path.join(APP, 'src/lib/seller-call-seller-position-note.ts'));
const { parseTransactionAssumptionsNote, parseSellerPricePositionNote } = require(path.join(APP, 'src/lib/seller-call-readiness-carriers.ts'));

/** Taken from the finished file, never back-filled from a passing run: one per probe()/check() call site. */
const FLOOR = 21;
let checks = 0; let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}
async function probe(name, fn) {
  try { const { ok, detail } = await fn(); check(name, ok, detail); } catch (e) { check(name, false, e.message.split('\n')[0]); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── In-memory GHL fixture ───────────────────────────────────────────────────
const A = 'fixtureContactA';
const B = 'fixtureContactB';
const D = 'fixtureContactD';                        // two opportunities: D-opp and D-opp2
const PEOPLE = { [A]: ['Alpha', '+12145550101'], [B]: ['Bravo', '+14695550123'], [D]: ['Delta', '+19725550199'] };
const OPPS = () => [
  { id: `${A}-opp`, contactId: A, name: 'Alpha deal' },
  { id: `${B}-opp`, contactId: B, name: 'Bravo deal' },
  { id: `${D}-opp`, contactId: D, name: 'Delta first deal' },
  { id: `${D}-opp2`, contactId: D, name: 'Delta second deal' },
];
let db; let slowReads; let writeGate; let failWrites;
function resetDb() {
  db = Object.fromEntries(Object.entries(PEOPLE).map(([id, [first]]) => [id,
    { id, first, notes: [{ id: `${id}-n1`, body: `Seed note for ${first}`, dateAdded: '2026-09-30T12:00:00.000Z' }] }]));
  slowReads = {};
  writeGate = null;   // when set: a promise every note write waits on
  failWrites = 0;     // number of upcoming note writes to fail with a 500
}
const detail = (c) => ({ contact: { id: c.id, firstName: c.first, lastName: 'Fixture', phone: PEOPLE[c.id][1], dndSettings: {}, customFields: [] } });
const pipeline = () => ({ pipelineId: 'fixture-pipeline', stages: [],
  opportunities: OPPS().map((o) => ({ id: o.id, contactId: o.contactId, contactName: db[o.contactId].first, opportunityName: o.name,
    phone: '', email: '', stageId: 'fixture-stage', customFields: [] })) });
const bf = createBarrierFixture({ contactOf: (o) => (OPPS().find((x) => x.id === o) || {}).contactId || null });
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
    case 'detail': return { status: 200, body: detail(db[req.contact]) };
    case 'ghl-opportunities': return { status: 200, body: pipeline() };
    case 'ghl-underwriting-policy': return { status: 200, body: { values: [] } };
    case 'iaos-activation': return { status: 200, body: { state: 'open', activationId: 'v2-act-page-fixture', deployId: 'page-deploy', runtimeDeployId: 'page-deploy' } };
    default: return { status: 404, body: { error: `fixture does not model ${req.kind}` } };
  }
}

let log = [];
const foreign = [];
const pageErrors = [];
const watchdog = setTimeout(() => { console.error('FAIL  the suite did not finish within 10 minutes -- stopped'); process.exit(1); }, 10 * 60_000);
const noteWrites = (contact) => log.filter((r) => r.kind === 'write' && r.op === 'note.create' && (!contact || r.contact === contact));
const ledger = (contact) => db[contact].notes.map((n) => n.body);
const spNotes = (contact) => ledger(contact).map(parseSellerPositionNote).filter(Boolean);
const taNotes = (contact) => ledger(contact).map(parseTransactionAssumptionsNote).filter(Boolean);
const priceNotes = (contact) => ledger(contact).map(parseSellerPricePositionNote).filter(Boolean);

async function main() {
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const tailwindcss = (await import('@tailwindcss/vite')).default;
  const { chromium } = require('playwright');
  const server = await createServer({
    root: APP, configFile: false, plugins: [react(), tailwindcss()], logLevel: 'error', clearScreen: false,
    resolve: { alias: [{ find: '../lib/airdroid-launch', replacement: MOCK }] },
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: [WORKSPACE_PAGE.slice(1)],
      include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] },
  });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const exit = async (code) => { clearTimeout(watchdog); await browser.close().catch(() => {}); await server.close().catch(() => {}); process.exit(code); };

  const open = async (width = 1280) => {
    const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'America/Chicago' });
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
        if (writeGate) await writeGate;
        if (failWrites > 0) { failWrites -= 1; req.failed = true; return reply({ status: 500, body: { error: 'GHL is not answering right now.' } }); }
        return reply(await bf.write({ operation: req.op, targetId: req.contact, requestId: req.requestId, contactId: req.contact, args: req.args },
          () => { db[req.contact].notes.push({ id: `${req.contact}-n${db[req.contact].notes.length + 1}`, body: req.args.body, dateAdded: new Date().toISOString() }); return { confirmed: true }; },
          { outcome: parseOutcomeNote(req.args.body), refuse: null }));
      }
      if (req.contact && slowReads[req.contact]) await new Promise((r) => setTimeout(r, slowReads[req.contact]));
      return reply(answer(req));
    });
    await page.goto(`${base}${WORKSPACE_PAGE}`, { timeout: 60000 });
    await page.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 });
    page.setDefaultTimeout(8000);
    return { context, page };
  };
  const go = async (page, contact, { deal } = {}) => {
    await page.evaluate((to) => window.__iaosNavigate(to), `/contacts/${contact}/seller-call`);
    if (deal) { await page.getByRole('button', { name: deal }).click({ timeout: 60000 }); }
    // Waits for controls the page had before autosave too, so a negative control reaches every check.
    await page.getByTestId('call-outcome-pass-toggle').waitFor({ timeout: 60000 });
    await page.getByTestId('negotiation-seller-position-input').waitFor({ timeout: 60000 });
    await page.waitForTimeout(150);
  };
  /** A fresh page load (as a browser reload), then the seller (and deal). */
  const reload = async (page, contact, opts) => { await page.goto(`${base}${WORKSPACE_PAGE}`, { timeout: 60000 }); await page.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 }); await go(page, contact, opts); };
  const until = async (page, fn, label, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await fn()) return; await page.waitForTimeout(40); }
    throw new Error(`timed out waiting for ${label}`);
  };
  const state = async (page, id) => ((await page.getByTestId(id).count()) ? page.getByTestId(id).getAttribute('data-state') : null);
  const text = async (page, id) => ((await page.getByTestId(id).count()) ? (await page.getByTestId(id).innerText()).trim() : null);
  // Text fields by placeholder (the same before and after autosave); the None boxes by their new test ids.
  const ta = (page) => ({ s: page.getByPlaceholder('Transaction structure'), c: page.getByPlaceholder('Closing/possession expectations'), t: page.getByPlaceholder('Known title complications'),
    sN: page.getByTestId('transaction-structure-none'), cN: page.getByTestId('transaction-closing-none'), tN: page.getByTestId('transaction-title-none') });
  const sp = (page) => page.getByTestId('negotiation-seller-position-input');
  const leave = (page) => page.getByTestId('negotiation-panel').click({ position: { x: 5, y: 5 } });
  const saveChangesShown = async (page) => (await page.getByTestId('seller-call-save-changes').count()) === 1;

  try {
    // ═══ Seller Position ═══════════════════════════════════════════════════
    {
      resetDb(); bf.reset(); log = [];
      const { context, page } = await open();
      await go(page, A);
      await probe('Seller Position: typing alone writes nothing; leaving the field saves it once (Saving -> Saved); leaving again writes nothing more', async () => {
        await sp(page).fill('245000');
        await page.waitForTimeout(300);
        const whileTyping = noteWrites().length;
        await leave(page);
        await until(page, async () => (await state(page, 'negotiation-seller-position-save-status')) === 'saved', 'Saved');
        await sp(page).click(); await leave(page); await page.waitForTimeout(300);
        const notes = spNotes(A);
        const ok = whileTyping === 0 && notes.length === 1 && notes[0].kind === 'value' && notes[0].value === 245000 && notes[0].opportunityId === `${A}-opp`
          && noteWrites().length === 1 && !(await saveChangesShown(page));
        return { ok, detail: { whileTyping, notes, writes: noteWrites().length } };
      });
      await probe('Seller Position: Enter saves a change; no conversation outcome is recorded; a reload restores the value', async () => {
        await sp(page).fill('250000');
        await sp(page).press('Enter');
        await until(page, async () => spNotes(A).length === 2, 'second SP note');
        const outcomes = ledger(A).filter((b) => parseOutcomeNote(b)).length;
        await reload(page, A);
        await until(page, async () => (await sp(page).inputValue()) !== '', 'restored');
        const restored = await sp(page).inputValue();
        return { ok: spNotes(A)[1].value === 250000 && outcomes === 0 && restored === '250000', detail: { notes: spNotes(A), outcomes, restored } };
      });
      await probe('Seller Position: clearing the field is saved, and a reload shows it empty (never the older number)', async () => {
        await sp(page).fill('');
        await leave(page);
        await until(page, async () => spNotes(A).length === 3, 'cleared note');
        await reload(page, A);
        await page.waitForTimeout(400);
        return { ok: spNotes(A)[2].kind === 'cleared' && (await sp(page).inputValue()) === '', detail: { last: spNotes(A)[2], value: await sp(page).inputValue() } };
      });
      await probe('Seller Position: an invalid entry is never saved and says why', async () => {
        const before = noteWrites().length;
        await sp(page).fill('abc');
        await leave(page);
        await page.waitForTimeout(400);
        const err = await text(page, 'negotiation-seller-position-error');
        await sp(page).fill('');
        await leave(page); await page.waitForTimeout(200);
        return { ok: noteWrites().length === before && !!err, detail: { writes: noteWrites().length - before, err } };
      });
      await context.close();
    }

    // ═══ Transaction assumptions v2 ════════════════════════════════════════
    {
      resetDb(); bf.reset(); log = [];
      const { context, page } = await open();
      await go(page, A);
      const f = ta(page);
      await probe('TA: one answer saves a partial v2 record (others "not yet answered", never None); the section says partly answered and it is not complete', async () => {
        await f.s.fill('Standard assignment');
        await f.s.press('Tab');
        await until(page, async () => taNotes(A).length === 1, 'partial TA note');
        await until(page, async () => (await state(page, 'transaction-assumptions-save-status')) === 'saved', 'Saved');
        const n = taNotes(A)[0];
        const status = await text(page, 'transaction-assumptions-status');
        const ok = n.version === 2 && n.complete === false && same(n.transactionStructure, { kind: 'value', value: 'Standard assignment' })
          && same(n.closingPossession, { kind: 'unanswered' }) && same(n.titleComplications, { kind: 'unanswered' })
          && /Partly answered/.test(status) && /Still needed: closing\/possession, title/.test(status);
        return { ok, detail: { n, status } };
      });
      await probe('TA: a reload restores the partial answer and leaves the unanswered items blank with None unticked', async () => {
        await reload(page, A);
        const g = ta(page);
        const v = [await g.s.inputValue(), await g.c.inputValue(), await g.t.inputValue(), await g.sN.isChecked(), await g.cN.isChecked(), await g.tN.isChecked()];
        return { ok: same(v, ['Standard assignment', '', '', false, false, false]), detail: v };
      });
      await probe('TA: completing (a value + None known by its own box) saves a complete record; the section shows Complete', async () => {
        const g = ta(page);
        await g.c.fill('Close in 21 days');
        await g.c.press('Enter');
        await until(page, async () => taNotes(A).length === 2, 'second TA note');
        await g.tN.check();
        await until(page, async () => taNotes(A).length === 3, 'third TA note');
        const n = taNotes(A)[2];
        await until(page, async () => /Complete/.test(await text(page, 'transaction-assumptions-status')), 'Complete');
        return { ok: n.complete === true && same(n.titleComplications, { kind: 'none' }), detail: n };
      });
      await probe('TA: clearing a value saves it as "not yet answered" (not None) and the section is incomplete again, also after reload', async () => {
        const g = ta(page);
        await g.c.fill('');
        await g.c.press('Tab');
        await until(page, async () => taNotes(A).length === 4, 'fourth TA note');
        const n = taNotes(A)[3];
        await reload(page, A);
        const status = await text(page, 'transaction-assumptions-status');
        const h = ta(page);
        return { ok: n.complete === false && same(n.closingPossession, { kind: 'unanswered' }) && /Partly answered/.test(status) && (await h.c.inputValue()) === '' && !(await h.cN.isChecked()),
          detail: { n, status } };
      });
      await probe('TA: a failed save says Couldn\'t save, keeps the text, shows Save changes; Save changes retries and saves it', async () => {
        const g = ta(page);
        failWrites = 1;
        const before = taNotes(A).length;
        await g.c.fill('Close in 30 days');
        await g.c.press('Tab');
        await until(page, async () => (await state(page, 'transaction-assumptions-save-status')) === 'error', 'error');
        const msg = await text(page, 'transaction-assumptions-save-status');
        const kept = await g.c.inputValue();
        const shown = await saveChangesShown(page);
        const stillBefore = taNotes(A).length;
        await page.getByTestId('seller-call-save-changes').click();
        await until(page, async () => (await state(page, 'transaction-assumptions-save-status')) === 'saved', 'saved after retry');
        const n = taNotes(A)[taNotes(A).length - 1];
        const ok = /Couldn.t save: GHL is not answering right now\./.test(msg) && /Your text is kept/.test(msg) && kept === 'Close in 30 days' && shown
          && stillBefore === before && taNotes(A).length === before + 1 && same(n.closingPossession, { kind: 'value', value: 'Close in 30 days' }) && !(await saveChangesShown(page));
        return { ok, detail: { msg, kept, shown, stillBefore, before, after: taNotes(A).length } };
      });
      await context.close();
    }

    // ═══ Seller price position ═════════════════════════════════════════════
    {
      resetDb(); bf.reset(); log = [];
      const { context, page } = await open();
      await go(page, A);
      await probe('price: saves on leave; a blank price writes nothing; the refusal is its own one-click record', async () => {
        const input = page.getByTestId('seller-price-position-input');
        await input.fill('$230,000');
        await input.press('Tab');
        await until(page, async () => priceNotes(A).length === 1, 'price note');
        await input.fill('');
        await input.press('Tab');
        await page.waitForTimeout(400);
        const afterBlank = priceNotes(A).length;
        await page.getByTestId('record-seller-price-refused').click();
        await until(page, async () => priceNotes(A).length === 2, 'refusal note');
        const ok = priceNotes(A)[0].kind === 'price' && priceNotes(A)[0].price === 230000 && afterBlank === 1 && priceNotes(A)[1].kind === 'refused';
        return { ok, detail: { notes: priceNotes(A), afterBlank } };
      });
      await context.close();
    }

    // ═══ Bones review regressions: a failed clear and a failed refusal are kept for retry ═══
    {
      resetDb(); bf.reset(); log = [];
      const { context, page } = await open();
      await go(page, A);
      const switchAwayAndBack = async () => {
        await go(page, B);
        await until(page, async () => (await page.locator('body').innerText()).includes('Bravo deal'), 'Bravo shown');
        await go(page, A);
        await until(page, async () => (await page.locator('body').innerText()).includes('Alpha deal'), 'Alpha shown');
        await page.waitForTimeout(400);
      };
      await probe('Seller Position: a failed clear stays an empty draft across a seller switch; Save changes retries the clear (never the older number); a reload shows it empty', async () => {
        await sp(page).fill('123000');
        await leave(page);
        await until(page, async () => (await state(page, 'negotiation-seller-position-save-status')) === 'saved', 'saved 123000');
        failWrites = 1;
        await sp(page).fill('');
        await leave(page);
        await until(page, async () => (await state(page, 'negotiation-seller-position-save-status')) === 'error', 'clear failed');
        await switchAwayAndBack();
        const back = await sp(page).inputValue();
        const st = await state(page, 'negotiation-seller-position-save-status');
        const shown = await saveChangesShown(page);
        const beforeRetry = spNotes(A).map((n) => n.kind);
        await page.getByTestId('seller-call-save-changes').click();
        await until(page, async () => (await state(page, 'negotiation-seller-position-save-status')) === 'saved', 'saved after retry');
        const after = spNotes(A).map((n) => (n.kind === 'value' ? n.value : n.kind));
        await reload(page, A);
        await page.waitForTimeout(400);
        const reloaded = await sp(page).inputValue();
        const ok = back === '' && st === 'error' && shown && same(beforeRetry, ['value']) && same(after, [123000, 'cleared']) && reloaded === '' && spNotes(B).length === 0;
        return { ok, detail: { back, st, shown, beforeRetry, after, reloaded } };
      });
      await probe('price refusal: a failed refusal says the refusal is kept, shows Save changes, survives a seller switch, and Save changes records the refusal once', async () => {
        failWrites = 1;
        await page.getByTestId('record-seller-price-refused').click();
        await until(page, async () => (await state(page, 'seller-price-position-save-status')) === 'error', 'refusal failed');
        const msg = await text(page, 'seller-price-position-save-status');
        const shown = await saveChangesShown(page);
        await switchAwayAndBack();
        const stBack = await state(page, 'seller-price-position-save-status');
        const shownBack = await saveChangesShown(page);
        const before = priceNotes(A).length;
        await page.getByTestId('seller-call-save-changes').click();
        await until(page, async () => (await state(page, 'seller-price-position-save-status')) === 'saved', 'refusal saved after retry');
        await page.waitForTimeout(300);
        const ok = /Couldn.t save: GHL is not answering right now\. The refusal is kept\. Use Save changes to try again\./.test(msg || '') && !/Your text is kept/.test(msg || '')
          && shown && stBack === 'error' && shownBack && before === 0 && same(priceNotes(A).map((n) => n.kind), ['refused'])
          && !(await saveChangesShown(page)) && priceNotes(B).length === 0;
        return { ok, detail: { msg, shown, stBack, shownBack, before, notes: priceNotes(A) } };
      });
      await probe('price: blank edits stay no-write (after a refusal, and after a failed price that is then cleared); no retry is offered for a blank field', async () => {
        const input = page.getByTestId('seller-price-position-input');
        const before = noteWrites().length;
        await input.fill('5');
        await input.fill('');
        await input.press('Tab');
        await page.waitForTimeout(400);
        const afterBlank = noteWrites().length - before;
        failWrites = 1;
        await input.fill('240000');
        await input.press('Tab');
        await until(page, async () => (await state(page, 'seller-price-position-save-status')) === 'error', 'price failed');
        const attempts = noteWrites().length - before;
        await input.fill('');
        await input.press('Tab');
        await page.waitForTimeout(400);
        const afterClear = noteWrites().length - before;
        const msg = await text(page, 'seller-price-position-save-status');
        const shown = await saveChangesShown(page);
        const ok = afterBlank === 0 && attempts === 1 && afterClear === 1 && !/Use Save changes/.test(msg || '') && !shown
          && same(priceNotes(A).map((n) => n.kind), ['refused']);
        return { ok, detail: { afterBlank, attempts, afterClear, msg, shown, notes: priceNotes(A) } };
      });
      await context.close();
    }

    // ═══ Opportunity isolation: two deals on one contact ═══════════════════
    {
      resetDb(); bf.reset(); log = [];
      const { context, page } = await open();
      await go(page, D, { deal: 'Delta first deal' });
      await probe('isolation: answers saved for one deal are scoped to it; the other deal on the same contact starts empty and saves separately', async () => {
        await ta(page).s.fill('Deal one structure');
        await ta(page).s.press('Tab');
        await sp(page).fill('111000');
        await sp(page).press('Enter');
        await until(page, async () => taNotes(D).length === 1 && spNotes(D).length === 1, 'deal one notes');
        await reload(page, D, { deal: 'Delta second deal' });
        const empty = [await ta(page).s.inputValue(), await sp(page).inputValue()];
        await ta(page).s.fill('Deal two structure');
        await ta(page).s.press('Tab');
        await until(page, async () => taNotes(D).length === 2, 'deal two note');
        await reload(page, D, { deal: 'Delta first deal' });
        const back = [await ta(page).s.inputValue(), await sp(page).inputValue()];
        const opps = taNotes(D).map((n) => n.opportunityId);
        const ok = same(empty, ['', '']) && same(back, ['Deal one structure', '111000']) && same(opps, [`${D}-opp`, `${D}-opp2`]) && spNotes(D)[0].opportunityId === `${D}-opp`;
        return { ok, detail: { empty, back, opps } };
      });
      await context.close();
    }

    // ═══ Rapid seller switching ════════════════════════════════════════════
    {
      resetDb(); bf.reset(); log = [];
      const { context, page } = await open();
      await go(page, A);
      await probe('switching: a slow save for Alpha still lands on Alpha only; Bravo\'s page shows none of Alpha\'s text or status; Alpha\'s answers come back', async () => {
        let release; writeGate = new Promise((r) => { release = r; });
        await ta(page).s.fill('Alpha structure');
        await ta(page).s.press('Tab');
        await until(page, async () => (await state(page, 'transaction-assumptions-save-status')) === 'saving', 'saving');
        await go(page, B);
        await until(page, async () => (await page.locator('body').innerText()).includes('Bravo deal'), 'Bravo shown');
        const onBravo = [await ta(page).s.inputValue(), await state(page, 'transaction-assumptions-save-status')];
        release(); writeGate = null;
        await until(page, async () => taNotes(A).length === 1, 'Alpha note landed');
        await page.waitForTimeout(300);
        const onBravoAfter = [await ta(page).s.inputValue(), await state(page, 'transaction-assumptions-save-status'), await saveChangesShown(page)];
        await go(page, A);
        await until(page, async () => (await page.locator('body').innerText()).includes('Alpha deal'), 'Alpha shown');
        const backOnAlpha = await ta(page).s.inputValue();
        const ok = same(onBravo, ['', 'idle']) && same(onBravoAfter, ['', 'idle', false]) && taNotes(B).length === 0
          && taNotes(A)[0].opportunityId === `${A}-opp` && backOnAlpha === 'Alpha structure';
        return { ok, detail: { onBravo, onBravoAfter, backOnAlpha, bravoNotes: taNotes(B).length } };
      });
      // Board 14-13 correction: while the selected seller loads, the previous seller's data is still on screen.
      // The autosaved fields are locked with a notice, so editing cannot begin against the wrong record, and
      // unsaved text typed for a seller survives switching away and back.
      const lockedFields = async () => ({
        sellerPosition: await sp(page).isDisabled(), structure: await ta(page).s.isDisabled(), closing: await ta(page).c.isDisabled(),
        title: await ta(page).t.isDisabled(), structureNone: await ta(page).sN.isDisabled(), price: await page.getByTestId('seller-price-position-input').isDisabled(),
        refused: await page.getByTestId('record-seller-price-refused').isDisabled(),
      });
      const allTrue = (o) => Object.values(o).every((v) => v === true);
      const allFalse = (o) => Object.values(o).every((v) => v === false);
      const notice = async () => (await page.getByTestId('seller-call-loading-seller').count()) === 1;
      await probe('loading lock: with a delayed load for the next seller, every autosaved field is locked with a loading notice; typing reaches no field and nothing is written', async () => {
        // Seller Position is typed and left (so it saves, to Alpha); then a structure draft is typed and NOT left,
        // so it is Alpha's unsaved draft when Brad switches seller.
        await sp(page).fill('123000');
        await ta(page).s.fill('Alpha unsaved draft');
        await until(page, async () => (await state(page, 'negotiation-seller-position-save-status')) === 'saved', 'Seller Position saved');
        const before = noteWrites().length;
        slowReads[B] = 2500;
        await page.evaluate((to) => window.__iaosNavigate(to), `/contacts/${B}/seller-call`);
        await until(page, notice, 'loading notice', 3000);
        const locked = await lockedFields();
        const noticeText = await text(page, 'seller-call-loading-seller');
        // Try to edit anyway: a fill must be refused, and keystrokes must not change any field.
        let fillRefused = false;
        try { await ta(page).c.fill('typed during load', { timeout: 500 }); } catch { fillRefused = true; }
        await page.keyboard.type('zz');
        const shown = [await ta(page).s.inputValue(), await ta(page).c.inputValue(), await sp(page).inputValue()];
        const during = noteWrites().length - before;
        const ok = allTrue(locked) && /Loading the selected seller\. Answers are locked until their details arrive\./.test(noticeText || '')
          && fillRefused && same(shown, ['Alpha unsaved draft', '', '123000']) && during === 0;
        return { ok, detail: { locked, noticeText, fillRefused, shown, during } };
      });
      await probe('loading lock: after loading, the fields unlock with the selected seller\'s own (empty) answers; going back restores the first seller\'s unsaved draft (still Not saved yet) and its saved Seller Position; nothing was written for either seller', async () => {
        const before = noteWrites().length;
        await until(page, async () => !(await notice()) && (await page.locator('body').innerText()).includes('Bravo deal'), 'Bravo loaded', 8000);
        slowReads[B] = 0;
        const unlocked = await lockedFields();
        const bravo = [await ta(page).s.inputValue(), await sp(page).inputValue()];
        slowReads[A] = 1500;
        await page.evaluate((to) => window.__iaosNavigate(to), `/contacts/${A}/seller-call`);
        await until(page, notice, 'loading notice (back to Alpha)', 3000);
        const lockedBack = allTrue(await lockedFields());
        await until(page, async () => !(await notice()) && (await page.locator('body').innerText()).includes('Alpha deal'), 'Alpha loaded', 8000);
        slowReads[A] = 0;
        const alpha = [await ta(page).s.inputValue(), await sp(page).inputValue()];
        const states = [await state(page, 'transaction-assumptions-save-status'), await state(page, 'negotiation-seller-position-save-status')];
        const ok = allFalse(unlocked) && same(bravo, ['', '']) && lockedBack && same(alpha, ['Alpha unsaved draft', '123000'])
          && same(states, ['unsaved', 'saved']) && (await saveChangesShown(page)) && noteWrites().length === before
          && taNotes(B).length === 0 && spNotes(B).length === 0 && same(spNotes(A).map((n) => n.value), [123000])
          && same(taNotes(A).map((n) => n.transactionStructure.value), ['Alpha structure']);
        return { ok, detail: { unlocked, bravo, lockedBack, alpha, states, writes: noteWrites().length - before } };
      });
      await probe('loading lock: Current Offer is also locked during a delayed load (typing does not reach it; nothing is saved or reserved), and unlocks empty for the selected seller once loaded', async () => {
        const co = page.getByTestId('negotiation-current-offer-input');
        // Saves and reservations only; the page's status read (a GET on every deal change) is not a write.
        const offerTraffic = () => log.filter((r) => r.kind === 'write' || (r.kind === 'current-offer-barrier' && r.method !== 'GET')).length;
        const enabledOnAlpha = await co.isEnabled();
        const before = offerTraffic();
        slowReads[B] = 2500;
        await page.evaluate((to) => window.__iaosNavigate(to), `/contacts/${B}/seller-call`);
        await until(page, notice, 'loading notice (Current Offer)', 3000);
        const lockedDuring = await co.isDisabled();
        let fillRefused = false;
        try { await co.fill('150000', { timeout: 500 }); } catch { fillRefused = true; }
        await page.keyboard.type('99');
        const shownDuring = await co.inputValue();
        const during = offerTraffic() - before;
        await until(page, async () => !(await notice()) && (await page.locator('body').innerText()).includes('Bravo deal'), 'Bravo loaded (Current Offer)', 8000);
        slowReads[B] = 0;
        const enabledAfter = await co.isEnabled();
        const shownAfter = await co.inputValue();
        const ok = enabledOnAlpha && lockedDuring && fillRefused && shownDuring === '' && during === 0 && enabledAfter && shownAfter === ''
          && offerTraffic() === before;
        return { ok, detail: { enabledOnAlpha, lockedDuring, fillRefused, shownDuring, during, enabledAfter, shownAfter, after: offerTraffic() - before } };
      });
      await context.close();
    }

    // ═══ Deliberate actions are not autosaved ══════════════════════════════
    {
      resetDb(); bf.reset(); log = [];
      const { context, page } = await open();
      await go(page, A);
      await probe('deliberate actions: typing a Pass reason and leaving writes nothing; only Confirm Pass records the outcome (with the saved Seller Position)', async () => {
        await sp(page).fill('260000');
        await sp(page).press('Enter');
        await until(page, async () => spNotes(A).length === 1, 'SP note');
        const before = noteWrites().length;
        await page.getByTestId('call-outcome-pass-toggle').click();
        await page.getByTestId('call-outcome-pass-reason').fill('Seller wants retail.');
        await leave(page);
        await page.waitForTimeout(400);
        const afterTyping = noteWrites().length - before;
        await until(page, () => page.getByTestId('call-outcome-pass-confirm').isEnabled(), 'confirm enabled');
        await page.getByTestId('call-outcome-pass-confirm').click();
        await until(page, async () => ledger(A).some((b) => /Outcome: pass/.test(b)), 'outcome');
        const outcome = ledger(A).find((b) => /Outcome: pass/.test(b));
        return { ok: afterTyping === 0 && /^Seller Position: 260000$/m.test(outcome), detail: { afterTyping } };
      });
      await context.close();
    }

    check('nothing left the machine: every request was the local page or a fixture-answered function', foreign.length === 0, foreign);
    check('no page errors', pageErrors.length === 0, pageErrors);
  } catch (e) {
    console.error(`FAIL  ${e.message}`);
    failures += 1;
  }
  console.log('');
  console.log(`checksRun=${checks} failures=${failures} floor=${FLOOR}`);
  if (checks !== FLOOR) { console.error(`FAILED: expected exactly ${FLOOR} checks, ran ${checks}.`); return exit(2); }
  if (failures > 0) { console.error('FAILED'); return exit(1); }
  console.log('OK');
  return exit(0);
}

main();
