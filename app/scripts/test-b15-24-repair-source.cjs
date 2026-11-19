/**
 * B15-24 (CAPTAIN GO 2026-11-19) -- the REAL Deal Calculator page (scripts/harness/deal-calculator): Quick Repairs
 * follows PB-D55 like ARV (B15-22 r4, bd5f7ae): for each fresh field, the selected deal's GHL Opportunity value first
 * (opportunityFacts.arv / opportunityFacts.repairs), the contact's figure only when the deal has none. A deal figure
 * is labelled "On the deal in GHL", a contact fallback "On the contact in GHL", never "Approved".
 *
 *   F1-F4  field-by-field fallback on single-deal contacts (both on the deal; repairs only; ARV only; neither)
 *   M1-M2  two deals: an untouched pre-choice figure gives way to each deal's own; a typed one stays the operator's
 *   O1-O2  ownership before linking: an untouched blank adopts the deal's repairs; a typed-then-cleared one stays blank
 *   D1-D3  drafts: a typed figure is kept per deal through reload; the deal's repairs changing under it shows both
 *          (with "On the deal in GHL"); Use GHL takes the deal's figure
 *   W1     the walkthrough: entry -> quick->itemized (the deal's figure moves to Miscellaneous once) -> leave for another
 *          deal and return -> reload, all restored
 *   C1-C2  Clear: blank, kept blank through reload (the deal's figure never refills it); other deals untouched
 *   I1     isolation: no deal's figures appear on another deal
 *   G1     approval gates: the page has no repairs/ARV write; reads only; nothing left the page; no page errors
 *
 * Offline: every /.netlify/functions request is answered here; only GETs are modelled. Synthetic records only.
 * NEGATIVE CONTROL: --before=<rev> serves <rev>'s DealCalculator.tsx; with the ARV-only base (532f366) the repairs
 * checks must FAIL.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const APP = path.resolve(__dirname, '..');
require(path.join(APP, 'scripts/harness/ts-loader.cjs'));
const { getConfig } = require(path.join(APP, 'shared/ghl-config.ts'));
const CFG = getConfig('test');
const PAGE = '/scripts/harness/deal-calculator/index.html';
const PAGE_FILE = path.join(APP, 'src/pages/DealCalculator.tsx');
const beforeArg = process.argv.find((a) => a.startsWith('--before='));
const BEFORE = beforeArg ? beforeArg.slice('--before='.length) : null;
const before = { name: 'b15-24-before', enforce: 'pre', load(id) {
  if (!BEFORE || path.resolve(id.split('?')[0]) !== PAGE_FILE) return null;
  return execFileSync('git', ['show', `${BEFORE}:app/src/pages/DealCalculator.tsx`], { cwd: APP, encoding: 'utf8', maxBuffer: 64 << 20 });
} };

/** Literal check() call sites in this file. */
const FLOOR = 18;
let checks = 0, failures = 0;
function check(name, ok, detail) { checks += 1; if (!ok) failures += 1; console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail).slice(0, 500)}`}`); }

const C_ARV = 'QkWl09I9yXGz8OIcs5Xd', C_REP = 'SU4n8ylrXnUm8xDi729R';     // Test contact field ids (as the drafts suite)
const O_ARV = CFG.opportunityFacts.arv, O_REP = CFG.opportunityFacts.repairs;
const contacts = {
  'c-ann': { arv: '300000', rep: '12000' }, 'c-mix': { arv: '300000', rep: '12000' }, 'c-arv': { arv: '250000', rep: '9000' },
  'c-none': {}, 'c-two': { arv: '280000', rep: '11000' },
};
const oppFacts = { 'o-ann': { arv: 320000, rep: 30000 }, 'o-mix': { rep: 45000 }, 'o-arv': { arv: 270000 }, 'o-none': {}, 'o-two-a': { rep: 50000 }, 'o-two-b': {} };
const oppOwner = { 'o-ann': 'c-ann', 'o-mix': 'c-mix', 'o-arv': 'c-arv', 'o-none': 'c-none', 'o-two-a': 'c-two', 'o-two-b': 'c-two' };
const opportunities = () => Object.keys(oppFacts).map((id) => {
  const f = oppFacts[id]; const customFields = [];
  if (f.arv !== undefined) customFields.push({ id: O_ARV, fieldValueNumber: f.arv });
  if (f.rep !== undefined) customFields.push({ id: O_REP, fieldValueNumber: f.rep });
  return { id, contactId: oppOwner[id], contactName: oppOwner[id], opportunityName: `${id} -- Fixture Rd`, phone: '', email: '', stageId: CFG.stages.sellerCallCompleted, customFields };
});
const watchdog = setTimeout(() => { console.error('FAIL  did not finish within 6 minutes -- stopped'); process.exit(1); }, 6 * 60_000);

async function listen(createServer, react) {
  for (let port = 5180; port <= 5189; port += 1) {
    const server = await createServer({ root: APP, configFile: false, plugins: [before, react()], logLevel: 'error', clearScreen: false,
      server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
      optimizeDeps: { entries: [PAGE.slice(1)], include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] } });
    try { await server.listen(); return server; } catch { await server.close().catch(() => {}); }
  }
  throw new Error('no free port in 5180-5189');
}

async function main() {
  if (BEFORE) console.log(`NEGATIVE CONTROL: serving DealCalculator.tsx from ${BEFORE}; this run must fail.`);
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const { chromium } = require('playwright');
  const server = await listen(createServer, react);
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const requests = [], foreign = [], pageErrors = [];
  const exit = async (code) => { clearTimeout(watchdog); await browser.close().catch(() => {}); await server.close().catch(() => {}); process.exit(code); };
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1200 }, timezoneId: 'America/Chicago' });
    await context.route('**/*', async (route) => {
      const r = route.request(); const url = r.url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { foreign.push(`${r.method()} ${url}`); return route.abort(); }
      const u = new URL(url); const fn = u.pathname.replace('/.netlify/functions/', '');
      const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      requests.push(`${r.method()} ${fn}`);
      if (r.method() !== 'GET') return json(405, { error: 'fixture: reads only' });
      if (fn === 'ghl-underwriting-policy') return json(200, { values: [] });
      if (fn === 'ghl-opportunities') return json(200, { pipelineId: 'p1', stages: [], opportunities: opportunities() });
      const m = fn === 'ghl-proxy' && /^\/contacts\/([^/]+)$/.exec(u.searchParams.get('path') || '');
      if (m && contacts[m[1]]) {
        const c = contacts[m[1]]; const customFields = [];
        if (c.arv !== undefined) customFields.push({ id: C_ARV, value: c.arv });
        if (c.rep !== undefined) customFields.push({ id: C_REP, value: c.rep });
        return json(200, { contact: { id: m[1], firstName: m[1], lastName: '', customFields } });
      }
      return json(404, { error: `fixture does not model ${fn}` });
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    const T = (id) => page.getByTestId(id);
    const settle = () => page.waitForTimeout(250);
    const ready = async (linked) => {
      await T('deal-calc-repairs-mode-toggle').waitFor({ timeout: 60000 });
      if (linked) await page.waitForFunction(() => !/Linking the contact/.test(document.querySelector('[data-testid="deal-calc-draft-status"]')?.textContent || ''), null, { timeout: 15000 });
      await settle();
    };
    const go = async (q = '') => { await page.goto(`${base}${PAGE}${q ? `?${q}` : ''}`); await ready(q.includes('contactId=')); };
    const reload = async () => { await page.reload(); await ready(true); };
    const val = async (id) => ((await T(id).count()) ? T(id).inputValue() : null);
    const txt = async (id) => ((await T(id).count()) ? (await T(id).innerText()).replace(/\s+/g, ' ').trim() : null);
    const view = async () => ({ arv: await val('deal-calc-arv-input'), rep: await val('deal-calc-repairs-quick-input'),
      arvLabel: await txt('deal-calc-draft-arv'), repLabel: await txt('deal-calc-draft-repairsQuick') });
    const chooseDeal = async (id) => { await T('deal-calc-deal-select').selectOption(id); await settle(); };
    const linkFromHere = async (cid) => { await T('deal-calc-link-input').fill(cid); await T('deal-calc-link-button').click(); await page.waitForTimeout(300);
      await page.waitForFunction(() => !/Linking the contact/.test(document.querySelector('[data-testid="deal-calc-draft-status"]')?.textContent || ''), null, { timeout: 15000 }); await settle(); };
    const DEAL = 'On the deal in GHL', CONTACT = 'On the contact in GHL';

    // ── F: field-by-field fallback, single-deal contacts ──
    await go('contactId=c-ann'); const f1 = await view();
    check('F1 both on the deal: ARV 320,000 and repairs 30,000, each "On the deal in GHL" (contact 300,000 / 12,000 not used)', f1.arv === '320000' && f1.rep === '30000' && f1.arvLabel === DEAL && f1.repLabel === DEAL, f1);
    await go('contactId=c-mix'); const f2 = await view();
    check('F2 repairs on the deal only: repairs 45,000 "On the deal in GHL"; ARV falls back to the contact 300,000 "On the contact in GHL"', f2.rep === '45000' && f2.repLabel === DEAL && f2.arv === '300000' && f2.arvLabel === CONTACT, f2);
    await go('contactId=c-arv'); const f3 = await view();
    check('F3 ARV on the deal only: ARV 270,000 "On the deal in GHL"; repairs fall back to the contact 9,000 "On the contact in GHL"', f3.arv === '270000' && f3.arvLabel === DEAL && f3.rep === '9000' && f3.repLabel === CONTACT, f3);
    await go('contactId=c-none'); const f4 = await view();
    check('F4 neither anywhere: both blank, no GHL label', f4.arv === '' && f4.rep === '' && f4.arvLabel === null && f4.repLabel === null, f4);

    // ── M: two deals ──
    await go('contactId=c-two'); const m0 = await view();
    await chooseDeal('o-two-a'); const ma = await view();
    await chooseDeal('o-two-b'); const mb = await view();
    await chooseDeal('o-two-a'); const ma2 = await view();
    check('M1 two deals: pre-choice shows the contact 11,000; deal A -> 50,000 "On the deal in GHL"; deal B (none) -> 11,000 "On the contact in GHL"; back to A -> 50,000',
      m0.rep === '11000' && ma.rep === '50000' && ma.repLabel === DEAL && mb.rep === '11000' && mb.repLabel === CONTACT && ma2.rep === '50000' && ma2.repLabel === DEAL, { m0, ma, mb, ma2 });
    await page.evaluate(() => localStorage.clear());
    await go('contactId=c-two');
    await T('deal-calc-repairs-quick-input').fill('7777'); await settle();
    await chooseDeal('o-two-a'); const m2 = await view();
    check('M2 a repairs figure typed before the deal choice stays the operator\'s (7,777, Draft), not replaced by the deal\'s 50,000', m2.rep === '7777' && /Draft/.test(m2.repLabel || ''), m2);

    // ── O: ownership before linking ──
    await page.evaluate(() => localStorage.clear());
    await go(); await linkFromHere('c-ann'); const o1 = await view();
    check('O1 an untouched blank before linking adopts the deal\'s 30,000 "On the deal in GHL"', o1.rep === '30000' && o1.repLabel === DEAL, o1);
    await page.evaluate(() => localStorage.clear());
    await go(); await T('deal-calc-repairs-quick-input').fill('5'); await settle(); await T('deal-calc-repairs-quick-input').fill(''); await settle();
    await linkFromHere('c-ann'); const o2 = await view();
    check('O2 a repairs figure typed then cleared before linking stays blank (the deal\'s 30,000 does not fill it)', o2.rep === '' && o2.repLabel !== DEAL, o2);

    // ── D: drafts per deal ──
    await page.evaluate(() => localStorage.clear());
    await go('contactId=c-ann'); await T('deal-calc-repairs-quick-input').fill('15000'); await settle();
    await reload(); const d1 = await view();
    check('D1 a typed 15,000 on deal A is kept through reload, "Draft -- Not saved to GHL"', d1.rep === '15000' && /Draft -- Not saved to GHL/.test(d1.repLabel || ''), d1);
    oppFacts['o-ann'].rep = 31000;
    await reload();
    const d2 = { ghl: await txt('deal-calc-draft-repairsQuick-ghl'), source: await txt('deal-calc-draft-repairsQuick-ghl-source'), mine: await txt('deal-calc-draft-repairsQuick-mine'), rep: await val('deal-calc-repairs-quick-input') };
    check('D2 the deal\'s repairs change under the draft (31,000): both shown, source "On the deal in GHL", the draft stays on screen',
      d2.ghl === 'GHL now: 31000 (changed since your draft)' && d2.source === DEAL && d2.mine === 'Your draft: 15000 -- Not saved to GHL' && d2.rep === '15000', d2);
    await T('deal-calc-draft-repairsQuick-use-ghl').click(); await settle(); const d3a = await view(); await reload(); const d3 = await view();
    check('D3 Use GHL takes the deal\'s 31,000 ("On the deal in GHL"), through reload', [d3a, d3].every((v) => v.rep === '31000' && v.repLabel === DEAL), { d3a, d3 });

    // ── W1: the walkthrough on deal A ──
    await T('deal-calc-repairs-mode-toggle').click(); await settle();
    const w1 = { misc: await val('deal-calc-repair-misc-amount'), total: await txt('deal-calc-repairs-detailed-total') };
    await T('deal-calc-repair-roof-amount').fill('4000'); await settle();
    await go('contactId=c-mix'); const wMix = await view();
    await go('contactId=c-ann');
    const w2 = { quick: await T('deal-calc-repairs-quick-input').count(), misc: await val('deal-calc-repair-misc-amount'), roof: await val('deal-calc-repair-roof-amount'), total: await txt('deal-calc-repairs-detailed-total') };
    await reload();
    const w3 = { quick: await T('deal-calc-repairs-quick-input').count(), misc: await val('deal-calc-repair-misc-amount'), roof: await val('deal-calc-repair-roof-amount'), total: await txt('deal-calc-repairs-detailed-total') };
    check('W1 walkthrough: quick -> itemized moves the deal\'s 31,000 to Miscellaneous once; with Roof 4,000 the total 35,000 is restored after leaving for another deal and after reload',
      w1.misc === '31000' && /31,000/.test(w1.total || '') && [w2, w3].every((w) => w.quick === 0 && w.misc === '31000' && w.roof === '4000' && /35,000/.test(w.total || '')), { w1, w2, w3 });
    check('I1 isolation: the other deal (c-mix) shows only its own figures (45,000 deal / 300,000 contact), none of deal A\'s', wMix.rep === '45000' && wMix.arv === '300000' && wMix.repLabel === DEAL, wMix);

    // ── C: Clear ──
    await T('deal-calc-clear').click(); await settle(); const c1a = await view(); await reload(); const c1 = await view();
    check('C1 full Clear on deal A: ARV and repairs blank, and still blank after reload -- the deal\'s figures never refill them',
      [c1a, c1].every((v) => v.arv === '' && v.rep === '' && v.repLabel !== DEAL && v.arvLabel !== DEAL), { c1a, c1 });
    await go('contactId=c-mix'); const c2 = await view();
    check('C2 Clear on deal A leaves the other deal untouched (45,000 "On the deal in GHL")', c2.rep === '45000' && c2.repLabel === DEAL, c2);

    // ── G: gates ──
    const src = BEFORE ? execFileSync('git', ['show', `${BEFORE}:app/src/pages/DealCalculator.tsx`], { cwd: APP, encoding: 'utf8', maxBuffer: 64 << 20 }) : fs.readFileSync(PAGE_FILE, 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    check('G1 approval gates: no ARV/repairs write on the page (setApprovedArv, persistApproved*, setRepairEstimate absent), and the label is never "Approved"',
      !/setApprovedArv|persistApproved\w*|setRepairEstimate|ghl\.opportunities\.(?!listPipeline)\w+/.test(code) && !/>\s*Approved/.test(code), null);
    check('G2 reads only (GET); nothing left the page; no page errors', requests.every((x) => x.startsWith('GET ')) && foreign.length === 0 && pageErrors.length === 0, { bad: requests.filter((x) => !x.startsWith('GET ')), foreign, pageErrors });
    check('G3 the only reads are the policy, contact detail and pipeline', requests.every((x) => /GET (ghl-underwriting-policy|ghl-proxy|ghl-opportunities)$/.test(x)), [...new Set(requests)]);
  } catch (e) { check(`run completed (${String(e && e.message).split('\n')[0]})`, false); }
  if (checks < FLOOR) check(`at least ${FLOOR} checks ran`, false, checks);
  console.log(`\nB15-24 repair source: ${checks - failures}/${checks} checks passed${BEFORE ? ` (negative control vs ${BEFORE})` : ''}`);
  return exit(failures === 0 ? 0 : 1);
}
main();
