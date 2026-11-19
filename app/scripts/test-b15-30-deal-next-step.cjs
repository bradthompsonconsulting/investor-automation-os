/**
 * B15-30 / INV-140 -- the Seller Call hub's guided step panel on the REAL App (scripts/harness/app-routes), offline.
 * Fixture: scripts/harness/b15-30/two-stage-deals-fixture.cjs -- one synthetic seller, two deals at different stages:
 *   Deal A: Assignment Mode set, NO repairs; the test records a readiness OVERRIDE through the page's own control.
 *   Deal B: repairs saved on the deal, NO Assignment Mode.
 * Every /.netlify/functions request is answered locally; the override note is the only write the fixture accepts.
 *
 *   R1  Deal A: "Next: enter Estimated Repairs (Underwriting)"
 *   R2  after Brad's override on Deal A (readiness then reads Offer Ready): STILL Estimated Repairs, never the offer
 *       review; the reason says the override does not replace it
 *   R3  Deal B: "Next: choose Assignment Mode (Underwriting)"; the link carries Deal B and the field
 *   R4  switch A -> B -> A on one session (contact page and back): each shows its own step; sampled every ~15 ms
 *       while each deal loads, the panel never shows the other deal's step (no stale-deal flash)
 *   R5  a reload: Deal A resumes at repairs (override still on record), Deal B at Assignment Mode
 *   R6  Deal A's Next opens Underwriting on Deal A (no deal picker) with the repair estimator focused
 *   R7  Deal B's Next opens Underwriting on Deal B with the Assignment Mode selector focused
 *   R8  switching to ANOTHER seller never shows the previous seller's deal or step; the new seller's own step follows
 *   R9  a Seller Call step focuses its panel in place (no navigation)
 *   W1  ZERO non-GET requests from the guidance itself (everything after the override was recorded)
 *   W2  nothing left the machine; every request modelled; no page errors
 *
 * NEGATIVE CONTROLS: B1530_MUTATION=override_skips_inputs | wrong_deal | drop_guard rewrites source IN THE DEV SERVER
 * ONLY; each must fail (exit 1).
 */
'use strict';
const path = require('node:path');
require('./harness/ts-loader.cjs');
const { twoStageDeals, G, OPP_A, OPP_B, O, OPP_O } = require('./harness/b15-30/two-stage-deals-fixture.cjs');
const { createBarrierFixture } = require('./harness/current-offer-barrier-fixture.cjs');
const APP = path.resolve(__dirname, '..');
const { latestReadinessHumanActionForOpportunity } = require(path.join(APP, 'src/lib/seller-call-readiness-carriers.ts'));
const HARNESS = '/scripts/harness/app-routes/index.html';
const fx = twoStageDeals();

const MODEL = '/src/lib/deal-next-step.ts';
const PAGE = '/src/pages/SellerCallWorkspace.tsx';
const MUTATIONS = {
  override_skips_inputs: [[MODEL, 'const next = DEAL_STEP_ORDER.find((id) => !isDone[id])!;', 'const next = r.humanAction.kind === "overridden" ? "offer_review" : DEAL_STEP_ORDER.find((id) => !isDone[id])!;']],
  wrong_deal: [[PAGE, '    const opp = opps.find((o) => o.id === selected.id);\n    if (!opp) return null;\n    try {\n      const v = parseOpportunityValues', '    const opp = opps[0];\n    if (!opp) return null;\n    try {\n      const v = parseOpportunityValues']],
  drop_guard: [[PAGE, '    readiness: writeTarget !== null && !sellerLoading ? readiness : null,\n    economics: writeTarget !== null && !sellerLoading ? board8 : null,', '    readiness,\n    economics: board8,'],
    [PAGE, '      : writeTarget === null || sellerLoading || selectedDealFields === null ? "loading" : "ready",', '      : selectedDealFields === null ? "loading" : "ready",']],
};
const MUTATION = process.env.B1530_MUTATION || '';
if (MUTATION && !MUTATIONS[MUTATION]) { console.error(`FAIL  unknown mutation ${MUTATION}`); process.exit(2); }
{ const fs = require('node:fs'); for (const [file, from] of MUTATIONS[MUTATION] || []) { const t = fs.readFileSync(path.join(APP, file), 'utf8').replace(/\r\n/g, '\n'); if (t.split(from).length !== 2) { console.error(`FAIL  mutation ${MUTATION}: anchor not found exactly once in ${file}`); process.exit(2); } } }

let checks = 0, failures = 0;
function check(name, ok, detail) { checks += 1; if (!ok) failures += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : ` -- ${JSON.stringify(detail).slice(0, 500)}`}`); }
const note = (s) => console.log(`NOTE  ${s}`);
const FLOOR = 13;
const watchdog = setTimeout(() => { console.error('FAIL  did not finish within 8 minutes'); process.exit(1); }, 8 * 60_000);

function classify(url, method, post) {
  const u = new URL(url); const fn = u.pathname.replace('/.netlify/functions/', '');
  if (fn === 'ghl-write' && method === 'POST') return { kind: 'write', op: post && post.operation, contact: post && post.targetId, args: post && post.args };
  if (fn === 'ghl-proxy') {
    const p = u.searchParams.get('path') || ''; let m;
    if ((m = p.match(/^\/contacts\/([^/?]+)\/notes$/))) return { kind: 'notes', contact: m[1] };
    if ((m = p.match(/^\/contacts\/([^/?]+)$/))) return { kind: 'detail', contact: m[1] };
    if ((m = p.match(/^\/opportunities\/([^/?]+)$/))) return { kind: 'opp-read', target: m[1] };
    if (/\/customFields\/[^/]+$/.test(p)) return { kind: 'folder' };
    if (/\/customFields$/.test(p)) return { kind: 'defs' };
    return { kind: 'proxy-other', path: p };
  }
  if (fn === 'ghl-contact') return { kind: 'row', contact: u.searchParams.get('id') };
  return { kind: fn };
}

async function main() {
  if (MUTATION) console.log(`NEGATIVE CONTROL: mutation ${MUTATION}; this run must fail.`);
  fx.reset();
  const bf = createBarrierFixture({ contactOf: fx.contactOf });
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const tailwindcss = (await import('@tailwindcss/vite')).default;
  const { chromium } = require('playwright');
  const mutate = { name: 'b1530-mutation', enforce: 'pre', transform(code, id) {
    if (!MUTATION) return null;
    const mine = MUTATIONS[MUTATION].filter(([f]) => id.replace(/\\/g, '/').split('?')[0].endsWith(f));
    if (mine.length === 0) return null;
    let out = code.replace(/\r\n/g, '\n'); for (const [, from, to] of mine) out = out.replace(from, () => to); return out;
  } };
  const server = await createServer({ root: APP, configFile: false, plugins: [mutate, react(), tailwindcss()], logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: [HARNESS.slice(1)], include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] } });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const log = []; const foreign = []; const unmodelled = []; const pageErrors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/Chicago' });
    await context.addInitScript(() => { window.__iaosHarnessOverride = { writeSession: true }; });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
    await context.route('**/*', async (route) => {
      const r = route.request(); const url = r.url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { foreign.push(url); return route.abort(); }
      let post = null; try { post = r.postDataJSON(); } catch { /* none */ }
      const req = classify(url, r.method(), post); req.method = r.method(); log.push(req);
      const json = (s, b) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
      if (req.kind === 'app-read-session') return json(200, { signedIn: true, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
      if (req.kind === 'call-log-barrier') { const x = await bf.handleCallLog(r.method(), url, post); return json(x.status, x.body); }
      if (req.kind === 'current-offer-barrier') { const x = await bf.handle(r.method(), url, post); return json(x.status, x.body); }
      if (req.kind === 'write') { const x = fx.write(req.op, req.contact, req.args); return json(x.status, x.body); }
      const a = fx.answer(req); if (a) return json(a.status, a.body);
      unmodelled.push(`${r.method()} ${req.kind}`); return json(404, { error: 'unmodelled' });
    });
    const panel = () => page.evaluate(() => { const e = document.querySelector('[data-testid="deal-next-step"]'); if (!e) return null;
      const go = e.querySelector('[data-testid="deal-next-step-go"]');
      return { deal: e.getAttribute('data-deal'), step: e.getAttribute('data-step'), label: go ? go.textContent.trim() : null, href: go && go.getAttribute('href'),
        reason: e.querySelector('[data-testid="deal-next-step-reason"]')?.textContent.trim() ?? null, progress: e.querySelector('[data-testid="deal-next-step-progress"]')?.textContent.trim() ?? null }; });
    const settled = async (deal) => { const t0 = Date.now(); while (Date.now() - t0 < 30000) { const p = await panel(); if (p && p.deal === deal && p.step !== 'checking') { await page.waitForTimeout(500); return panel(); } await page.waitForTimeout(100); } return panel(); };
    const start = async () => { await page.goto(`${base}${HARNESS}?start=${encodeURIComponent(`/contacts/${G}/seller-call`)}`); await page.waitForFunction(() => typeof window.__iaosAppSource === 'string', null, { timeout: 90000 }); };
    const nav = (to) => page.evaluate((t) => window.__iaosRouter.navigate(t), to);
    /** Picks a deal and samples the panel every ~15 ms until it settles: every (deal, step) pair seen. */
    const choose = async (name, opp) => {
      await page.getByRole('button', { name, exact: true }).click({ timeout: 60000 });
      const seen = []; const t0 = Date.now();
      while (Date.now() - t0 < 2500) { const p = await panel(); if (p) seen.push(`${p.deal}:${p.step}`); await page.waitForTimeout(15); }
      return { settled: await settled(opp), seen: [...new Set(seen)] };
    };
    const away = async () => { await nav(`/contacts/${G}`); await page.waitForTimeout(800); await nav(`/contacts/${G}/seller-call`); };
    const A_LABEL = 'Next: enter Estimated Repairs (Underwriting)'; const B_LABEL = 'Next: choose Assignment Mode (Underwriting)';

    // R1
    await start();
    const a1 = (await choose('Deal A', OPP_A)).settled;
    check('R1 Deal A: "Next: enter Estimated Repairs (Underwriting)"', a1 && a1.step === 'repairs' && a1.label === A_LABEL, a1);

    // R2 -- Brad's override, through the page's own control
    const panelEl = page.getByTestId('readiness-human-action-panel');
    if (!(await panelEl.evaluate((e) => e.open))) await panelEl.locator('summary').click();
    await page.getByPlaceholder('Reason for overriding (required)').fill('B15-30 fixture override');
    await page.getByTestId('readiness-override-button').click();
    const t2 = Date.now(); while (Date.now() - t2 < 15000 && !latestReadinessHumanActionForOpportunity(fx.state.notes, OPP_A)) await page.waitForTimeout(100);
    const overrideRec = latestReadinessHumanActionForOpportunity(fx.state.notes, OPP_A);
    await page.waitForTimeout(1500);
    const a2 = await panel();
    const nbq = await page.evaluate(() => document.body.innerText.includes('Offer Ready — no further underwriting question'));
    note(`R2 the pre-existing Next Best Question line still says "Offer Ready — no further underwriting question" after the override: ${nbq} (unchanged here; see report)`);
    check('R2 after the override (recorded on Deal A), the next step is STILL Estimated Repairs -- never the offer review -- and the reason says the override does not replace it',
      overrideRec && overrideRec.kind === 'overridden' && a2 && a2.deal === OPP_A && a2.step === 'repairs' && /override does not replace/i.test(a2.reason || ''), { overrideRec: overrideRec && overrideRec.kind, a2 });
    const writesBeforeGuidance = log.filter((x) => x.method !== 'GET').length;

    // R3 + R4 -- switch A -> B -> A
    await away();
    const b = await choose('Deal B', OPP_B);
    check('R3 Deal B: "Next: choose Assignment Mode (Underwriting)"; the link carries Deal B and the field',
      b.settled && b.settled.step === 'assignment_mode' && b.settled.label === B_LABEL && b.settled.href === `/contacts/${G}/underwriting?deal=${encodeURIComponent(OPP_B)}&focus=assignment_mode`, b.settled);
    await away();
    const a4 = await choose('Deal A', OPP_A);
    const flashB = b.seen.filter((s) => !s.startsWith(`${OPP_B}:`) || s === `${OPP_B}:repairs`);
    const flashA = a4.seen.filter((s) => !s.startsWith(`${OPP_A}:`) || s === `${OPP_A}:assignment_mode`);
    check('R4 back on Deal A: its own step (Estimated Repairs) again', a4.settled && a4.settled.step === 'repairs', a4.settled);
    check('R4 no stale-deal flash: while each deal loaded, the panel only ever showed that deal (checking, then its own step)', flashB.length === 0 && flashA.length === 0, { b: b.seen, a: a4.seen });

    // R5 -- reload
    await start();
    const a5 = (await choose('Deal A', OPP_A)).settled;
    await start();
    const b5 = (await choose('Deal B', OPP_B)).settled;
    check('R5 after a reload: Deal A resumes at Estimated Repairs (override still on record), Deal B at Assignment Mode', a5 && a5.step === 'repairs' && b5 && b5.step === 'assignment_mode', { a5, b5 });

    // R6 -- Deal A's deep link
    await start();
    await choose('Deal A', OPP_A);
    await page.getByTestId('deal-next-step-go').click();
    const t6 = Date.now(); let r6 = null;
    while (Date.now() - t6 < 30000) {
      r6 = await page.evaluate(() => { const el = document.querySelector('[data-testid="underwriting-repair-estimator"]');
        return { path: location.pathname + location.search, picker: document.body.innerText.includes('Select the deal to underwrite'), applied: el?.getAttribute('data-focus-applied') ?? null, activeInside: !!el && el.contains(document.activeElement) }; });
      if (r6.applied === 'true') break; await page.waitForTimeout(150);
    }
    check('R6 Deal A\'s Next opens Underwriting on Deal A (no deal picker) with the repair estimator focused',
      r6 && r6.path === `/contacts/${G}/underwriting?deal=${encodeURIComponent(OPP_A)}&focus=repairs` && !r6.picker && r6.applied === 'true' && r6.activeInside, r6);

    // R7 -- Deal B's deep link
    await start();
    await choose('Deal B', OPP_B);
    await page.getByTestId('deal-next-step-go').click();
    const t7 = Date.now(); let r7 = null;
    while (Date.now() - t7 < 30000) {
      r7 = await page.evaluate(() => { const el = document.querySelector('[data-testid="assignment-mode-selector"]');
        return { path: location.pathname + location.search, picker: document.body.innerText.includes('Select the deal to underwrite'), applied: el?.getAttribute('data-focus-applied') ?? null, activeInside: !!el && el.contains(document.activeElement) }; });
      if (r7.applied === 'true') break; await page.waitForTimeout(150);
    }
    check('R7 Deal B\'s Next opens Underwriting on Deal B with the Assignment Mode selector focused',
      r7 && r7.path === `/contacts/${G}/underwriting?deal=${encodeURIComponent(OPP_B)}&focus=assignment_mode` && !r7.picker && r7.applied === 'true' && r7.activeInside, r7);

    // R8 -- switch to ANOTHER seller (the page keeps the previous contact's data until the new one loads)
    await start();
    await choose('Deal A', OPP_A);
    await nav(`/contacts/${O}/seller-call`);
    const seen8 = []; const t8 = Date.now();
    while (Date.now() - t8 < 3000) { const p = await panel(); if (p) seen8.push(`${p.deal}:${p.step}`); await page.waitForTimeout(15); }
    const o8 = await settled(OPP_O);
    /* While the new seller loads, the only allowed panel states: "checking" naming NO deal, or the new seller's own deal (checking, then its step). */
    const allowed8 = new Set([':checking', `${OPP_O}:checking`, `${OPP_O}:transaction`]);
    const flash8 = [...new Set(seen8)].filter((s) => !allowed8.has(s));
    check('R8 switching to another seller never shows the previous seller\'s deal or step (sampled every ~15 ms); the new seller\'s own step follows',
      flash8.length === 0 && o8 && o8.step === 'transaction', { seen: [...new Set(seen8)], o8 });

    // R9 -- a Seller Call step focuses the exact panel in place
    const before9 = await page.evaluate(() => location.pathname + location.search);
    await page.getByTestId('deal-next-step-go').click();
    await page.waitForTimeout(600);
    const r9 = await page.evaluate(() => { const el = document.querySelector('[data-testid="transaction-assumptions-panel"]');
      return { path: location.pathname + location.search, applied: el?.getAttribute('data-focus-applied') ?? null, activeInside: !!el && el.contains(document.activeElement), label: document.querySelector('[data-testid="deal-next-step-go"]')?.textContent.trim() }; });
    check('R9 a Seller Call step ("Next: record the transaction assumptions (Seller Call)") focuses that panel in place, without leaving the page',
      r9.label === 'Next: record the transaction assumptions (Seller Call)' && r9.path === before9 && r9.applied === 'true' && r9.activeInside, r9);

    // W
    const guidanceWrites = log.slice(0).filter((x) => x.method !== 'GET').length - writesBeforeGuidance;
    check('W1 zero non-GET requests from the guidance itself (switching, reloading, Next, deep links)', guidanceWrites === 0, log.filter((x) => x.method !== 'GET').map((x) => `${x.method} ${x.kind} ${x.op || ''}`));
    check('W1 the only write in the whole run is the override note Brad recorded', writesBeforeGuidance === 1 && log.filter((x) => x.method !== 'GET' && x.kind === 'write').every((x) => x.op === 'note.create'), writesBeforeGuidance);
    check('W2 nothing left the machine; every request modelled; no page errors', foreign.length === 0 && unmodelled.length === 0 && pageErrors.length === 0, { foreign: foreign.slice(0, 3), unmodelled: [...new Set(unmodelled)], pageErrors: pageErrors.slice(0, 3) });
  } catch (e) { check(`run completed (${String(e && e.message).split('\n')[0]})`, false); }
  clearTimeout(watchdog);
  await browser.close().catch(() => {}); await server.close().catch(() => {});
  if (checks < FLOOR) check(`at least ${FLOOR} checks ran`, false, checks);
  console.log(`\nB15-30 deal next step (rendered): ${checks - failures}/${checks} checks passed${MUTATION ? ` (mutation ${MUTATION})` : ''}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
