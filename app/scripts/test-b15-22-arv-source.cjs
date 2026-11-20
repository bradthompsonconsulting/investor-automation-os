/**
 * B15-22 ARV source (CAPTAIN GO 2026-11-07) -- the REAL Deal Calculator page (scripts/harness/deal-calculator). When a
 * deal is chosen, the ARV starts from that deal's GHL Opportunity ARV (PB-D55: the Opportunity first) and from the
 * contact's ARV only when the deal has none; a typed or kept figure is never overwritten; the source is labelled "On
 * the deal in GHL" / "On the contact in GHL" and never "Approved"; no extra read. B15-24 (Captain GO 2026-11-19): Quick Repairs follows the same order (Q1).
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
 *   Q1  B15-24 (Captain GO 2026-11-19, PB-D55): Quick Repairs follows the deal too -- the deal's 45,000 "On the deal in
 *       GHL", not the contact's 20,000 (before B15-24: the contact's figure, unchanged)
 *   W   reads are only the contact detail, the pipeline and the policy (no new read kind, no single-opportunity read);
 *       no write; nothing left the machine; no page errors
 *
 *   P1  r2 (Bones REVISE P2-1): a contact with NO contact ARV and two deals; choosing the deal with an ARV shows
 *       640,000 "On the deal in GHL"; switching to the other deal (no ARV anywhere) leaves it blank and back restores
 *       it; after reload the deal shows its GHL ARV again (no blank was kept as a draft)
 *   P2  r2 (Bones REVISE P2-2): ownership follows the operator's actions, not the final value -- 310,000 typed away to
 *       500,000 and back to 310,000 before choosing the 640,000 deal stays 310,000 (the operator's); a deliberately
 *       blanked ARV stays blank; after reload, choosing that deal again restores the operator's 310,000
 *
 *   O   r3: ARV ownership established BEFORE linking is carried through linking and the deal choice -- O1 an ARV
 *       typed in the unlinked calculator stays when a multi-deal contact is linked and a deal chosen; O2 one restored
 *       from the scratch draft after reload stays too; O3 an untouched blank adopts the chosen deal's ARV; O4 linking
 *       another contact from a deal shows that contact's chosen deal ARV (nothing carried across contacts)
 *
 *   K   r4: a deliberately blank ARV owned BEFORE linking is honoured by the link's prefill AND the deal choice --
 *       K1 typed then cleared, multi-deal contact (ARV 310,000): no prefill, and choosing the 640,000 deal keeps it
 *       blank; K2 the same after Clear; K3 typed then cleared, single deal without an ARV: the contact's 310,000 is not
 *       prefilled; K4 Clear, single deal with 640,000: not prefilled; K5 an untouched blank with a single deal still
 *       takes the contact's 310,000 "On the contact in GHL"; K6/K7 after reload each of those blanks comes back
 *       blank with its deal (multi-deal: choosing the same deal; single deal: on linking)
 *
 * NEGATIVE CONTROLS: --before=<rev> serves <rev>'s DealCalculator.tsx; with 9e8c8fd, A1, A2, D1 and R2 must FAIL;
 * with 2b8ce1b (r3), K1-K4 must FAIL;
 * with a6ab5b8 (r2), O1 and O2 must FAIL;
 * with 1a00602 (the reviewed candidate), P1 and P2 must FAIL. Each defective branch is also restored on its own by
 * mutation in the package (C-P1, C-P2).
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

const FLOOR = 33;   // literal count of check() calls executed on a full run; a shorter run fails (r2: +6, r3: +4, r4: +7)
let checks = 0, failures = 0;
function check(name, ok, detail) { checks += 1; if (!ok) failures += 1; console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`); }
if (BEFORE) console.log(`NEGATIVE CONTROL: DealCalculator.tsx from ${BEFORE}; this run must fail.`);

const opp = (id, contactId, name, arv, rep) => ({ id, contactId, contactName: name, opportunityName: name, phone: '', email: '', stageId: 's1',
  customFields: [...(arv === undefined ? [] : [{ id: O_ARV, fieldValueNumber: arv }]), ...(rep === undefined ? [] : [{ id: O_REP, fieldValueNumber: rep }])] });
const fixture = {
  contacts: { 'c-k1': { arv: '310000' }, 'c-k2': { arv: '310000' }, 'c-k3': { arv: '310000' }, 'c-k4': { arv: '310000' }, 'c-k5': { arv: '310000' }, 'c-o1': { arv: '310000' }, 'c-o2': { arv: '310000' }, 'c-o3': {}, 'c-o4x': { arv: '310000' }, 'c-o4y': {}, 'c-noarv': {}, 'c-back': { arv: '310000' }, 'c-blank': { arv: '310000' }, 'c-stale': { arv: '310000', rep: '20000' }, 'c-nodeal': { arv: '310000', rep: '20000' }, 'c-none': {}, 'c-two': { arv: '310000', rep: '20000' }, 'c-type': { arv: '310000' }, 'c-keep': { arv: '310000', rep: '20000' } },
  opportunities: [
    opp('o-stale', 'c-stale', 'Stale -- 1 Elm', 640000, 45000), opp('o-nodeal', 'c-nodeal', 'NoDealArv -- 2 Elm'), opp('o-none', 'c-none', 'None -- 3 Elm'),
    opp('o-two-a', 'c-two', 'Two A -- 4 Elm', 640000), opp('o-two-b', 'c-two', 'Two B -- 5 Elm'),
    opp('o-type-a', 'c-type', 'Type A -- 6 Elm', 640000), opp('o-type-b', 'c-type', 'Type B -- 7 Elm'),
    opp('o-keep', 'c-keep', 'Keep -- 8 Elm', 640000),
    opp('o-na-a', 'c-noarv', 'NoArv A -- 9 Elm', 640000), opp('o-na-b', 'c-noarv', 'NoArv B -- 10 Elm'),
    opp('o-o1-a', 'c-o1', 'O1 A -- 15 Elm', 640000), opp('o-o1-b', 'c-o1', 'O1 B -- 16 Elm'),
    opp('o-k1-a', 'c-k1', 'K1 A -- 31 Elm', 640000), opp('o-k1-b', 'c-k1', 'K1 B -- 32 Elm'),
    opp('o-k2-a', 'c-k2', 'K2 A -- 33 Elm', 640000), opp('o-k2-b', 'c-k2', 'K2 B -- 34 Elm'),
    opp('o-k3', 'c-k3', 'K3 -- 35 Elm'), opp('o-k4', 'c-k4', 'K4 -- 36 Elm', 640000), opp('o-k5', 'c-k5', 'K5 -- 37 Elm'),
    opp('o-o2-a', 'c-o2', 'O2 A -- 17 Elm', 640000), opp('o-o2-b', 'c-o2', 'O2 B -- 18 Elm'),
    opp('o-o3-a', 'c-o3', 'O3 A -- 19 Elm', 640000), opp('o-o3-b', 'c-o3', 'O3 B -- 20 Elm'),
    opp('o-o4x', 'c-o4x', 'O4 X -- 21 Elm', 700000),
    opp('o-o4y-a', 'c-o4y', 'O4 Y A -- 22 Elm', 650000), opp('o-o4y-b', 'c-o4y', 'O4 Y B -- 23 Elm'),
    opp('o-back-a', 'c-back', 'Back A -- 11 Elm', 640000), opp('o-back-b', 'c-back', 'Back B -- 12 Elm'),
    opp('o-blank-a', 'c-blank', 'Blank A -- 13 Elm', 640000), opp('o-blank-b', 'c-blank', 'Blank B -- 14 Elm'),
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
    // Q1 -- B15-24: Quick Repairs from the deal first (was: unchanged, the contact's figure)
    const q1 = { rep: await val('deal-calc-repairs-quick-input'), label: await txt('deal-calc-draft-repairsQuick') };
    check('Q1 B15-24: Quick Repairs takes the deal\'s 45,000, labelled "On the deal in GHL" (the contact\'s 20,000 is the fallback only)', q1.rep === '45000' && q1.label === 'On the deal in GHL', q1);
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

    // P1 -- no contact ARV, several deals (Bones P2-1)
    await go('c-noarv');
    const p1pre = await val('deal-calc-arv-input');
    await choose('o-na-a');
    const p1 = { pre: p1pre, arv: await val('deal-calc-arv-input'), label: await txt('deal-calc-draft-arv') };
    check('P1 no contact ARV, two deals: choosing the deal with an ARV shows 640,000 "On the deal in GHL" (not a kept blank)', p1.pre === '' && p1.arv === '640000' && p1.label === 'On the deal in GHL', p1);
    await choose('o-na-b');
    const p1b = { arv: await val('deal-calc-arv-input'), label: await txt('deal-calc-draft-arv') };
    await choose('o-na-a');
    const p1a = { arv: await val('deal-calc-arv-input'), label: await txt('deal-calc-draft-arv') };
    check('P1 switching to the deal with no ARV anywhere leaves it blank; back to the first shows 640,000 again', p1b.arv === '' && p1b.label === null && p1a.arv === '640000' && p1a.label === 'On the deal in GHL', { p1b, p1a });
    await go('c-noarv');
    await choose('o-na-a');
    const p1r = { arv: await val('deal-calc-arv-input'), label: await txt('deal-calc-draft-arv') };
    check('P1 after reload the deal shows its GHL 640,000: no blank was kept as a draft', p1r.arv === '640000' && p1r.label === 'On the deal in GHL', p1r);

    // P2 -- ownership by the operator's actions, not the final value (Bones P2-2)
    await go('c-back');
    const p2pre = await val('deal-calc-arv-input');
    await T('deal-calc-arv-input').fill('500000'); await settle();
    await T('deal-calc-arv-input').fill('310000'); await settle();
    await choose('o-back-a');
    const p2 = { pre: p2pre, arv: await val('deal-calc-arv-input'), label: await txt('deal-calc-draft-arv') };
    check('P2 310,000 typed away to 500,000 and back before choosing the 640,000 deal stays 310,000 (the operator\'s, kept as a draft)',
      p2.pre === '310000' && p2.arv === '310000' && p2.label === 'Draft -- Not saved to GHL', p2);
    await go('c-blank');
    await T('deal-calc-arv-input').fill(''); await settle();
    await choose('o-blank-a');
    const p2b = { arv: await val('deal-calc-arv-input'), label: await txt('deal-calc-draft-arv') };
    check('P2 a deliberately blanked ARV stays blank when the 640,000 deal is chosen', p2b.arv === '' && p2b.label !== 'On the deal in GHL', p2b);
    await go('c-back');
    await choose('o-back-a');
    const p2r = { arv: await val('deal-calc-arv-input'), label: await txt('deal-calc-draft-arv') };
    check('P2 after reload, choosing that deal again restores the operator\'s 310,000 (its draft, with its deal)', p2r.arv === '310000' && p2r.label === 'Draft -- Not saved to GHL', p2r);

    // O -- ownership established BEFORE linking (r3)
    const unlinked = async () => {
      await page.goto(`${base}${PAGE}`);
      await T('deal-calc-repairs-mode-toggle').waitFor({ timeout: 60000 }); await settle();
    };
    const clearScratch = () => page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('iaos-calculator-draft:') && k.includes('scratch')) localStorage.removeItem(k); });
    const linkTo = async (contactId) => {
      await T('deal-calc-link-input').fill(contactId);
      await T('deal-calc-link-button').click();
      await T('deal-calc-unlink').waitFor({ timeout: 30000 }).catch(() => {});
      await page.waitForFunction(() => !/Linking the contact/.test(document.querySelector('[data-testid="deal-calc-draft-status"]')?.textContent || ''), null, { timeout: 30000 }).catch(() => {});
      await settle();
    };
    await unlinked(); await clearScratch(); await unlinked();
    await T('deal-calc-arv-input').fill('300000'); await settle();
    await linkTo('c-o1');
    const o1pre = await val('deal-calc-arv-input');
    await choose('o-o1-a');
    const o1 = { pre: o1pre, arv: await val('deal-calc-arv-input'), label: await txt('deal-calc-draft-arv') };
    check('O1 an ARV typed BEFORE linking stays when a multi-deal contact is linked and the 640,000 deal chosen (the operator\'s)',
      o1.pre === '300000' && o1.arv === '300000' && o1.label === 'Draft -- Not saved to GHL', o1);
    await unlinked(); await clearScratch(); await unlinked();
    await T('deal-calc-arv-input').fill('305000'); await settle();
    await unlinked();   // reload: the scratch draft is restored
    const restored = await val('deal-calc-arv-input');
    await linkTo('c-o2');
    await choose('o-o2-a');
    const o2 = { restored, arv: await val('deal-calc-arv-input'), label: await txt('deal-calc-draft-arv') };
    check('O2 an ARV RESTORED from the scratch draft before linking stays when a deal is chosen', o2.restored === '305000' && o2.arv === '305000' && o2.label === 'Draft -- Not saved to GHL', o2);
    await unlinked(); await clearScratch(); await unlinked();
    await linkTo('c-o3');
    await choose('o-o3-a');
    const o3 = { arv: await val('deal-calc-arv-input'), label: await txt('deal-calc-draft-arv') };
    check('O3 an untouched blank before linking adopts the chosen deal\'s 640,000 "On the deal in GHL"', o3.arv === '640000' && o3.label === 'On the deal in GHL', o3);
    await go('c-o4x');
    const o4x = await val('deal-calc-arv-input');
    await T('deal-calc-unlink').click(); await settle();
    await linkTo('c-o4y');
    await choose('o-o4y-a');
    const o4 = { x: o4x, arv: await val('deal-calc-arv-input'), label: await txt('deal-calc-draft-arv') };
    check('O4 from contact X\'s deal (700,000), linking contact Y and choosing its deal shows Y\'s 650,000 (nothing carried across contacts)',
      o4.x === '700000' && o4.arv === '650000' && o4.label === 'On the deal in GHL', o4);

    // K -- a deliberately blank ARV owned BEFORE linking: honoured by the prefill and the deal choice (r4)
    const blankBeforeLink = async (how) => {
      await unlinked(); await clearScratch(); await unlinked();
      await T('deal-calc-arv-input').fill('300000'); await settle();
      if (how === 'clear-button') await T('deal-calc-clear').click(); else await T('deal-calc-arv-input').fill('');
      await settle();
      return val('deal-calc-arv-input');
    };
    const notFromGhl = (label) => label !== 'On the deal in GHL' && label !== 'On the contact in GHL';
    const k1before = await blankBeforeLink('typed-then-cleared');
    await linkTo('c-k1');
    const k1pre = await val('deal-calc-arv-input');
    await choose('o-k1-a');
    const k1 = { before: k1before, pre: k1pre, arv: await val('deal-calc-arv-input'), label: await txt('deal-calc-draft-arv') };
    check('K1 typed then cleared before linking a multi-deal contact (ARV 310,000): not prefilled, and choosing the 640,000 deal keeps it blank',
      k1.before === '' && k1.pre === '' && k1.arv === '' && notFromGhl(k1.label), k1);
    const k2before = await blankBeforeLink('clear-button');
    await linkTo('c-k2');
    const k2pre = await val('deal-calc-arv-input');
    await choose('o-k2-a');
    const k2 = { before: k2before, pre: k2pre, arv: await val('deal-calc-arv-input'), label: await txt('deal-calc-draft-arv') };
    check('K2 Clear before linking a multi-deal contact: not prefilled, and choosing the 640,000 deal keeps it blank',
      k2.before === '' && k2.pre === '' && k2.arv === '' && notFromGhl(k2.label), k2);
    const k3before = await blankBeforeLink('typed-then-cleared');
    await linkTo('c-k3');
    const k3 = { before: k3before, arv: await val('deal-calc-arv-input'), label: await txt('deal-calc-draft-arv') };
    check('K3 typed then cleared before linking a single-deal contact (deal without an ARV): the contact\'s 310,000 is not prefilled',
      k3.before === '' && k3.arv === '' && notFromGhl(k3.label), k3);
    const k4before = await blankBeforeLink('clear-button');
    await linkTo('c-k4');
    const k4 = { before: k4before, arv: await val('deal-calc-arv-input'), label: await txt('deal-calc-draft-arv') };
    check('K4 Clear before linking a single-deal contact (deal with 640,000): the deal\'s ARV is not prefilled',
      k4.before === '' && k4.arv === '' && notFromGhl(k4.label), k4);
    const reloadMulti = async (c, d) => { await go(c); await choose(d); return { arv: await val('deal-calc-arv-input'), label: await txt('deal-calc-draft-arv') }; };
    const reloadSingle = async (c) => { await go(c); return { arv: await val('deal-calc-arv-input'), label: await txt('deal-calc-draft-arv') }; };
    const k6 = { k1: await reloadMulti('c-k1', 'o-k1-a'), k2: await reloadMulti('c-k2', 'o-k2-a') };
    check('K6 after reload, choosing the same deal brings back the multi-deal blanks (K1 typed-then-cleared, K2 Clear) as kept drafts',
      k6.k1.arv === '' && notFromGhl(k6.k1.label) && k6.k2.arv === '' && notFromGhl(k6.k2.label), k6);
    const k7 = { k3: await reloadSingle('c-k3'), k4: await reloadSingle('c-k4') };
    check('K7 after reload, the single-deal blanks (K3 typed-then-cleared, K4 Clear) come back blank with their deal (no prefill)',
      k7.k3.arv === '' && notFromGhl(k7.k3.label) && k7.k4.arv === '' && notFromGhl(k7.k4.label), k7);
    await unlinked(); await clearScratch(); await unlinked();
    await linkTo('c-k5');
    const k5 = { arv: await val('deal-calc-arv-input'), label: await txt('deal-calc-draft-arv') };
    check('K5 an untouched blank before linking a single-deal contact still takes the contact\'s 310,000 "On the contact in GHL"',
      k5.arv === '310000' && k5.label === 'On the contact in GHL', k5);

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
