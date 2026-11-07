/**
 * B15-22 ARV source (CAPTAIN GO 2026-11-07) -- the REAL Deal Calculator page (scripts/harness/deal-calculator). When a
 * deal is chosen, the ARV starts from that deal's GHL Opportunity ARV (PB-D55: the Opportunity first) and from the
 * contact's ARV only when the deal has none; a typed or kept figure is never overwritten; the source is labelled "On
 * the deal in GHL" / "On the contact in GHL" and never "Approved"; no extra read; Quick Repairs unchanged.
 *
 * Offline: every /.netlify/functions request is answered here (policy, contact detail via ghl-proxy, the pipeline);
 * anything else is aborted and counted; every non-GET is refused and counted (zero required).
 *
 *   A1  stale contact ARV: deal ARV 640,000, contact ARV 310,000 -> 640,000, "On the deal in GHL"; the bar uses it
 *   A2  missing deal ARV: deal without ARV, contact 310,000 -> 310,000, "On the contact in GHL"
 *   A3  neither has ARV: the field stays empty, no source line
 *   A4  never "Approved": no ARV label or source line says approved
 *   D1  deal switching: a contact with two deals (one with ARV 640,000, one without): before a choice the contact's
 *       310,000; choosing the first -> 640,000 (deal); the second -> 310,000 (contact); back -> 640,000 (deal)
 *   D2  a figure typed before the choice is never replaced when a deal is chosen
 *   R1  retained draft: 655,000 typed on the deal is kept through reload ("Draft -- Not saved to GHL")
 *   R2  the deal's ARV changes under the kept draft (660,000): both are shown, the draft stays on screen, and the
 *       source line says "On the deal in GHL"; Keep My Draft keeps it
 *   Q1  Quick Repairs unchanged: the contact's 20,000 with its existing label, even when the deal carries a repairs
 *       figure (45,000)
 *   W   reads are only the contact detail, the pipeline and the policy (no new read kind, no single-opportunity read);
 *       no write; nothing left the machine; no page errors
 *
 * NEGATIVE CONTROL: --before=<rev> serves <rev>'s DealCalculator.tsx; with 9e8c8fd, A1, A2, D1 and R2 must FAIL.
 */
'use strict';
const path = require('node:path');
const { execFileSync } = require('node:child_process');
require('./harness/ts-loader.cjs');
const { getConfig } = require('../shared/ghl-config.ts');

const APP = path.resolve(__dirname, '..');
const PAGE = '/scripts/harness/deal-calculator/index.html';
const PAGE_FILE = path.join(APP, 'src/pages/DealCalculator.tsx');
const beforeArg = process.argv.find((a) => a.startsWith('--before='));
const BEFORE = beforeArg ? beforeArg.slice('--before='.length) : null;
const before = { name: 'arv-source-before', enforce: 'pre', load(id) {
  if (!BEFORE || path.resolve(id.split('?')[0]) !== PAGE_FILE) return null;
  return execFileSync('git', ['show', `${BEFORE}:app/src/pages/DealCalculator.tsx`], { cwd: APP, encoding: 'utf8', maxBuffer: 64 << 20 });
} };
const CFG = getConfig('test');
const C_ARV = CFG.fields.arv, C_REP = CFG.fields.estimatedRepairs, O_ARV = CFG.opportunityFacts.arv, O_REP = CFG.opportunityFacts.repairs;

const FLOOR = 16;   // literal count of check() calls executed on a full run; a shorter run fails
let checks = 0, failures = 0;
function check(name, ok, detail) { checks += 1; if (!ok) failures += 1; console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`); }
if (BEFORE) console.log(`NEGATIVE CONTROL: DealCalculator.tsx from ${BEFORE}; this run must fail.`);

const opp = (id, contactId, name, arv, rep) => ({ id, contactId, contactName: name, opportunityName: name, phone: '', email: '', stageId: 's1',
  customFields: [...(arv === undefined ? [] : [{ id: O_ARV, fieldValueNumber: arv }]), ...(rep === undefined ? [] : [{ id: O_REP, fieldValueNumber: rep }])] });
const fixture = {
  contacts: { 'c-stale': { arv: '310000', rep: '20000' }, 'c-nodeal': { arv: '310000', rep: '20000' }, 'c-none': {}, 'c-two': { arv: '310000', rep: '20000' }, 'c-type': { arv: '310000' }, 'c-keep': { arv: '310000', rep: '20000' } },
  opportunities: [
    opp('o-stale', 'c-stale', 'Stale -- 1 Elm', 640000, 45000), opp('o-nodeal', 'c-nodeal', 'NoDealArv -- 2 Elm'), opp('o-none', 'c-none', 'None -- 3 Elm'),
    opp('o-two-a', 'c-two', 'Two A -- 4 Elm', 640000), opp('o-two-b', 'c-two', 'Two B -- 5 Elm'),
    opp('o-type-a', 'c-type', 'Type A -- 6 Elm', 640000), opp('o-type-b', 'c-type', 'Type B -- 7 Elm'),
    opp('o-keep', 'c-keep', 'Keep -- 8 Elm', 640000),
  ],
};

async function main() {
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const { chromium } = require('playwright');
  const server = await createServer({ root: APP, configFile: false, plugins: [before, react()], logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: [PAGE.slice(1)], include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] } });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const requests = [], foreign = [], pageErrors = [];
  const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, timezoneId: 'America/Chicago' });
    await context.route('**/*', async (route) => {
      const r = route.request(); const url = r.url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { foreign.push(url); return route.abort(); }
      const u = new URL(url); const fn = u.pathname.replace('/.netlify/functions/', '');
      requests.push({ fn, method: r.method(), path: u.searchParams.get('path') });
      if (r.method() !== 'GET') return json(route, 405, { error: 'fixture: only reads are modelled' });
      if (fn === 'ghl-underwriting-policy') return json(route, 200, { values: [] });
      if (fn === 'ghl-opportunities') return json(route, 200, { pipelineId: 'p1', stages: [], opportunities: fixture.opportunities });
      const m = fn === 'ghl-proxy' && /^\/contacts\/([^/]+)$/.exec(u.searchParams.get('path') || '');
      if (m && fixture.contacts[m[1]]) {
        const c = fixture.contacts[m[1]]; const customFields = [];
        if (c.arv !== undefined) customFields.push({ id: C_ARV, value: c.arv });
        if (c.rep !== undefined) customFields.push({ id: C_REP, value: c.rep });
        return json(route, 200, { contact: { id: m[1], firstName: m[1], lastName: '', customFields } });
      }
      return json(route, 404, { error: `fixture does not model ${fn}` });
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    const T = (id) => page.getByTestId(id);
    const settle = () => page.waitForTimeout(300);
    const val = async (id) => ((await T(id).count()) ? T(id).inputValue() : null);
    const txt = async (id) => ((await T(id).count()) ? (await T(id).innerText()).trim() : null);
    const go = async (contactId) => {
      await page.goto(`${base}${PAGE}?contactId=${contactId}`);
      await T('deal-calc-repairs-mode-toggle').waitFor({ timeout: 60000 });
      await page.waitForFunction(() => !/Linking the contact/.test(document.querySelector('[data-testid="deal-calc-draft-status"]')?.textContent || ''), null, { timeout: 30000 }).catch(() => {});
      await settle();
    };
    const choose = async (dealId) => { await T('deal-calc-deal-select').selectOption(dealId); await settle(); };
    const barArv = () => page.evaluate(() => { const bar = document.querySelector('[data-testid="deal-calc-primary-bar"]'); const c = bar && [...bar.children].find((x) => /ARV/i.test(x.children[0]?.textContent || '')); return c ? c.children[1].textContent : null; });
    await page.goto(`${base}${PAGE}`);
    await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('iaos-calculator-draft:')) localStorage.removeItem(k); });

    // A1 -- stale contact ARV
    await go('c-stale');
    const a1 = { arv: await val('deal-calc-arv-input'), label: await txt('deal-calc-draft-arv'), bar: await barArv() };
    check('A1 stale contact ARV: the deal\'s 640,000 is shown, labelled "On the deal in GHL"', a1.arv === '640000' && a1.label === 'On the deal in GHL', a1);
    check('A1 ...and the calculation uses it (the bar\'s ARV is $640,000)', a1.bar === '$640,000', a1.bar);
    // Q1 -- Quick Repairs unchanged
    const q1 = { rep: await val('deal-calc-repairs-quick-input'), label: await txt('deal-calc-draft-repairsQuick') };
    check('Q1 Quick Repairs unchanged: the contact\'s 20,000 with its existing label, even though the deal carries 45,000', q1.rep === '20000' && q1.label === 'From the linked contact in GHL', q1);
    // A2 -- missing deal ARV
    await go('c-nodeal');
    const a2 = { arv: await val('deal-calc-arv-input'), label: await txt('deal-calc-draft-arv') };
    check('A2 missing deal ARV: the contact\'s 310,000, labelled "On the contact in GHL"', a2.arv === '310000' && a2.label === 'On the contact in GHL', a2);
    // A3 -- neither
    await go('c-none');
    const a3 = { arv: await val('deal-calc-arv-input'), label: await txt('deal-calc-draft-arv') };
    check('A3 neither has an ARV: the field stays empty and no source is claimed', a3.arv === '' && a3.label === null, a3);

    // D1 -- deal switching
    await go('c-two');
    const pre = await val('deal-calc-arv-input');
    await choose('o-two-a');
    const dA = { arv: await val('deal-calc-arv-input'), label: await txt('deal-calc-draft-arv') };
    await choose('o-two-b');
    const dB = { arv: await val('deal-calc-arv-input'), label: await txt('deal-calc-draft-arv') };
    await choose('o-two-a');
    const dA2 = { arv: await val('deal-calc-arv-input'), label: await txt('deal-calc-draft-arv') };
    check('D1 before a deal is chosen the contact\'s 310,000 is shown', pre === '310000', pre);
    check('D1 choosing the deal with an ARV -> 640,000 "On the deal in GHL" (the untouched pre-choice figure gives way)', dA.arv === '640000' && dA.label === 'On the deal in GHL', dA);
    check('D1 switching to the deal without an ARV -> 310,000 "On the contact in GHL"', dB.arv === '310000' && dB.label === 'On the contact in GHL', dB);
    check('D1 switching back -> 640,000 "On the deal in GHL" (no draft was kept for either)', dA2.arv === '640000' && dA2.label === 'On the deal in GHL', dA2);
    // D2 -- typed before the choice
    await go('c-type');
    await T('deal-calc-arv-input').fill('500000');
    await settle();
    await choose('o-type-a');
    const d2 = { arv: await val('deal-calc-arv-input'), label: await txt('deal-calc-draft-arv') };
    check('D2 a figure typed before the choice is not replaced by the deal\'s ARV (500,000 stays, as the operator\'s)', d2.arv === '500000' && d2.label !== 'On the deal in GHL', d2);

    // R1 / R2 -- retained draft
    await go('c-keep');
    await T('deal-calc-arv-input').fill('655000');
    await settle();
    await go('c-keep');
    const r1 = { arv: await val('deal-calc-arv-input'), label: await txt('deal-calc-draft-arv') };
    check('R1 a typed figure on the deal is kept through reload as a draft', r1.arv === '655000' && r1.label === 'Draft -- Not saved to GHL', r1);
    fixture.opportunities.find((o) => o.id === 'o-keep').customFields[0].fieldValueNumber = 660000;
    await go('c-keep');
    const r2 = { arv: await val('deal-calc-arv-input'), ghl: await txt('deal-calc-draft-arv-ghl'), mine: await txt('deal-calc-draft-arv-mine'), source: await txt('deal-calc-draft-arv-ghl-source') };
    check('R2 the deal\'s ARV changed under the kept draft: both shown, the draft stays on screen, the GHL figure named as the deal\'s',
      r2.arv === '655000' && r2.ghl === 'GHL now: 660000 (changed since your draft)' && r2.mine === 'Your draft: 655000 -- Not saved to GHL' && r2.source === 'On the deal in GHL', r2);
    await T('deal-calc-draft-arv-keep').click({ timeout: 3000 }).catch(() => {});
    await settle();
    check('R2 Keep My Draft keeps 655,000 (never overwritten)', (await val('deal-calc-arv-input')) === '655000' && (await txt('deal-calc-draft-arv')) === 'Draft -- Not saved to GHL');

    // A4 -- never "Approved"
    const allLabels = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="deal-calc-draft-arv"]')].map((e) => e.textContent).join(' | '));
    check('A4 no ARV label or source line says "approved" (approval evidence is not read here)', !/approved/i.test(allLabels) && !/approved/i.test(JSON.stringify([a1, a2, dA, dB])), allLabels);

    // W
    const kinds = [...new Set(requests.map((r) => r.fn === 'ghl-proxy' ? `ghl-proxy ${(r.path || '').replace(/\/[^/]+$/, '/:id')}` : r.fn))].sort();
    check('W reads are only the contact detail, the pipeline and the policy (no new read kind, no single-opportunity read)',
      JSON.stringify(kinds) === JSON.stringify(['ghl-opportunities', 'ghl-proxy /contacts/:id', 'ghl-underwriting-policy']), kinds);
    check('W no write; nothing left the machine; no page errors', requests.every((r) => r.method === 'GET') && foreign.length === 0 && pageErrors.length === 0,
      { writes: requests.filter((r) => r.method !== 'GET'), foreign: foreign.slice(0, 3), pageErrors: pageErrors.slice(0, 3) });
  } catch (e) {
    check(`run completed (${String(e && e.message).split('\n')[0]})`, false);
  }
  await browser.close().catch(() => {}); await server.close().catch(() => {});
  if (checks < FLOOR) check(`at least ${FLOOR} checks ran`, false, checks);
  console.log(`\nB15-22 Deal Calculator ARV source: ${checks - failures}/${checks} checks passed${BEFORE ? ` (negative control vs ${BEFORE})` : ''}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
