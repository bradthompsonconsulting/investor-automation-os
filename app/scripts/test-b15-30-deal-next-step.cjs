/**
 * B15-30 / INV-140 -- the Seller Call hub's ONE Next action on the REAL App (scripts/harness/app-routes), offline, at
 * 1440x900 (Captain REVISE 2026-11-19). Fixture: scripts/harness/b15-30/two-stage-deals-fixture.cjs --
 *   seller Guide: Deal A (Assignment Mode set, NO repairs; the test records an OVERRIDE through the page's own control)
 *                 and Deal B (repairs on the deal, NO Assignment Mode; the mode write is accepted in memory);
 *   seller Other: one deal missing only the transaction assumptions; seller Arv: one deal with NO ARV.
 * Every /.netlify/functions request is answered locally; nothing leaves the machine.
 *
 *   L1  1440x900, page not scrolled: the ONE Next action is fully on screen; the conversation still starts right under
 *       the sticky bar (within 80 px of the strip, above y=450: the Release 15-B pins) and is not covered
 *   L2  scrolled 600 px into the conversation: the Next action is still on screen (sticky bar)
 *   R1  Deal A: "Next: enter Estimated Repairs (Underwriting)"
 *   R2  after Brad's override on Deal A (readiness then reads Offer Ready): STILL Estimated Repairs, the reason says the
 *       override does not replace it
 *   C1  ...and the screen gives ONE consistent instruction: the Suggested Next Question block shows the same step and
 *       reason, nothing says "Move to presenting the offer", and there is exactly one Next action
 *   C2  offer approval rules intact: the readiness badge still reads exactly as the engine reports it (Offer Ready, raw
 *       evidence NOT READY -- overridden)
 *   R3  Deal B: "Next: choose Assignment Mode (Underwriting)"; the link carries Deal B and the field
 *   R4  switch A -> B -> A: each its own step; sampled every ~15 ms, never the other deal's step
 *   R5  a reload: Deal A resumes at repairs (override still on record), Deal B at Assignment Mode
 *   R6  Deal A's Next opens Underwriting on Deal A (no picker) with the focus IN the repair estimator's first Known
 *       amount field; typing there lands in that field; the guided bar names Deal A and returns to Seller Call on Deal A
 *   R7  Deal B's Next opens Underwriting on Deal B with the focus ON an Assignment Mode option (the actual choice)
 *   R7b continue without hunting: Enter on the focused option sets the mode (one write, Deal B, the focused label);
 *       "Back to Seller Call" reopens Deal B (no picker) whose Next is now the offer review, your decision
 *   R10 Arv deal: "Next: approve the ARV (Underwriting)" opens Underwriting on that deal with the focus on Get Comps,
 *       the ARV workflow's first control; the guided bar returns to that deal
 *   R8  switching to another seller never shows the previous seller's deal or step
 *   R9  a Seller Call step focuses its panel in place (no navigation)
 *   W1  the only writes in the run are the two the operator made (the override note; the Assignment Mode choice)
 *   W2  nothing left the machine; every request modelled; no page errors
 *
 * NEGATIVE CONTROLS (B1530_MUTATION=...; source rewritten IN THE DEV SERVER ONLY; each must exit 1):
 *   override_skips_inputs | wrong_deal | drop_guard | nbq_inconsistent | return_without_deal | focus_container |
 *   focus_first_control (the first focusable control, the repair estimator's "Not asked" default, instead of the field)
 */
'use strict';
const path = require('node:path');
require('./harness/ts-loader.cjs');
const { twoStageDeals, G, OPP_A, OPP_B, O, OPP_O, V, OPP_V } = require('./harness/b15-30/two-stage-deals-fixture.cjs');
const { createBarrierFixture } = require('./harness/current-offer-barrier-fixture.cjs');
const APP = path.resolve(__dirname, '..');
const { latestReadinessHumanActionForOpportunity } = require(path.join(APP, 'src/lib/seller-call-readiness-carriers.ts'));
const HARNESS = '/scripts/harness/app-routes/index.html';
const fx = twoStageDeals();

const MODEL = '/src/lib/deal-next-step.ts';
const PAGE = '/src/pages/SellerCallWorkspace.tsx';
const PANEL = '/src/components/DealNextStepPanel.tsx';
const FOCUS = '/src/lib/focus-target.ts';
const MUTATIONS = {
  override_skips_inputs: [[MODEL, 'const next = DEAL_STEP_ORDER.find((id) => !isDone[id])!;', 'const next = r.humanAction.kind === "overridden" ? "offer_review" : DEAL_STEP_ORDER.find((id) => !isDone[id])!;']],
  wrong_deal: [[PAGE, '    const opp = opps.find((o) => o.id === selected.id);\n    if (!opp) return null;\n    try {\n      const v = parseOpportunityValues', '    const opp = opps[0];\n    if (!opp) return null;\n    try {\n      const v = parseOpportunityValues']],
  drop_guard: [[PAGE, '    readiness: writeTarget !== null && !sellerLoading ? readiness : null,\n    economics: writeTarget !== null && !sellerLoading ? board8 : null,', '    readiness,\n    economics: board8,'],
    [PAGE, '      : writeTarget === null || sellerLoading || selectedDealFields === null ? "loading" : "ready",', '      : selectedDealFields === null ? "loading" : "ready",']],
  nbq_inconsistent: [[PAGE, ') : nextBestQuestion.kind === "offer_ready" && openStepInstruction(nextStep) !== null ? (', ') : nextBestQuestion.kind === "offer_ready" && false ? (']],
  return_without_deal: [[PANEL, 'to={`/contacts/${encodeURIComponent(contactId)}/seller-call?deal=${encodeURIComponent(dealId)}`}>', 'to={`/contacts/${encodeURIComponent(contactId)}/seller-call`}>']],
  focus_container: [[FOCUS, 'const control = preferred ?? (el.matches(FOCUSABLE) ? el : el.querySelector<HTMLElement>(FOCUSABLE));', 'const control = null as HTMLElement | null;']],
  focus_first_control: [[FOCUS, 'const control = preferred ?? (el.matches(FOCUSABLE)', 'const control = (el.matches(FOCUSABLE)']],
};
const MUTATION = process.env.B1530_MUTATION || '';
if (MUTATION && !MUTATIONS[MUTATION]) { console.error(`FAIL  unknown mutation ${MUTATION}`); process.exit(2); }
{ const fs = require('node:fs'); for (const [file, from] of MUTATIONS[MUTATION] || []) { const t = fs.readFileSync(path.join(APP, file), 'utf8').replace(/\r\n/g, '\n'); if (t.split(from).length !== 2) { console.error(`FAIL  mutation ${MUTATION}: anchor not found exactly once in ${file}`); process.exit(2); } } }

let checks = 0, failures = 0;
function check(name, ok, detail) { checks += 1; if (!ok) failures += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : ` -- ${JSON.stringify(detail).slice(0, 600)}`}`); }
const FLOOR = 21;
const SHOTS = process.env.B1530_SHOTS || '';   // optional: a folder for 1440x900 screenshots (evidence only)
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {}); };
const watchdog = setTimeout(() => { console.error('FAIL  did not finish within 10 minutes'); process.exit(1); }, 10 * 60_000);

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
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'America/Chicago' });
    await context.addInitScript(() => { window.__iaosHarnessOverride = { writeSession: true }; });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
    page.on('dialog', (d) => d.accept().catch(() => {}));
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
    const start = async (c = G) => { await page.goto(`${base}${HARNESS}?start=${encodeURIComponent(`/contacts/${c}/seller-call`)}`); await page.waitForFunction(() => typeof window.__iaosAppSource === 'string', null, { timeout: 90000 }); };
    const nav = (to) => page.evaluate((t) => window.__iaosRouter.navigate(t), to);
    const choose = async (name, opp) => {
      await page.getByRole('button', { name, exact: true }).click({ timeout: 60000 });
      const seen = []; const t0 = Date.now();
      while (Date.now() - t0 < 2500) { const p = await panel(); if (p) seen.push(`${p.deal}:${p.step}`); await page.waitForTimeout(15); }
      return { settled: await settled(opp), seen: [...new Set(seen)] };
    };
    const away = async () => { await nav(`/contacts/${G}`); await page.waitForTimeout(800); await nav(`/contacts/${G}/seller-call`); };
    /** After Next opened Underwriting: where we are, the focused element and the guided bar. */
    const landed = async (targetTestId) => {
      const t0 = Date.now(); let r = null;
      while (Date.now() - t0 < 30000) {
        r = await page.evaluate((tid) => { const el = document.querySelector(`[data-testid="${tid}"]`); const a = document.activeElement; const bar = document.querySelector('[data-testid="guided-return"]');
          const back = document.querySelector('[data-testid="guided-return-back"]');
          return { path: location.pathname + location.search, picker: document.body.innerText.includes('Select the deal to underwrite'), applied: el?.getAttribute('data-focus-applied') ?? null,
            activeInside: !!el && !!a && el.contains(a), activeTag: a ? a.tagName : null, activeTestId: a?.getAttribute('data-testid') ?? null, activeText: a ? (a.textContent || '').trim().slice(0, 40) : null,
            barDeal: bar?.getAttribute('data-deal') ?? null, barText: bar ? bar.textContent.replace(/\s+/g, ' ').trim() : null, backHref: back?.getAttribute('href') ?? null }; }, targetTestId);
        if (r.applied === 'true' && r.barDeal) break; await page.waitForTimeout(150);
      }
      return r;
    };
    const A_LABEL = 'Next: enter Estimated Repairs (Underwriting)'; const B_LABEL = 'Next: choose Assignment Mode (Underwriting)';
    const back = (c, o) => `/contacts/${c}/seller-call?deal=${encodeURIComponent(o)}`;

    // R1 + L1 + L2
    await start();
    const a1 = (await choose('Deal A', OPP_A)).settled;
    check('R1 Deal A: "Next: enter Estimated Repairs (Underwriting)"', a1 && a1.step === 'repairs' && a1.label === A_LABEL, a1);
    const L = await page.evaluate(() => { const R = (t) => { const e = document.querySelector(`[data-testid="${t}"]`); if (!e) return null; const r = e.getBoundingClientRect(); return { y: r.y, bottom: r.bottom, x: r.x, right: r.right }; };
      const main = document.querySelector('main'); return { scrollTop: main ? main.scrollTop : null, vh: innerHeight, vw: innerWidth, go: R('deal-next-step-go'), row: R('deal-next-step'), strip: R('seller-call-deal-strip'), bar: R('seller-call-sticky-bar'), conv: R('seller-conversation') }; });
    check('L1 1440x900, not scrolled: the one Next action is fully on screen; the conversation starts right under the sticky bar (<80 px below the strip, above y=450) and is not covered',
      L.scrollTop === 0 && L.go && L.go.y >= 0 && L.go.bottom <= L.vh && L.go.right <= L.vw && L.conv && L.strip && L.conv.y - L.strip.bottom < 80 && L.conv.y < 450 && L.bar.bottom <= L.conv.y + 1, L);
    await shot(page, '00-deal-a-top-of-page-not-scrolled-1440x900');
    await page.evaluate(() => { const m = document.querySelector('main'); if (m) m.scrollTop = 600; });
    await page.waitForTimeout(300);
    await shot(page, '00b-deal-a-scrolled-600px-into-conversation');
    const L2 = await page.evaluate(() => { const e = document.querySelector('[data-testid="deal-next-step-go"]'); const r = e && e.getBoundingClientRect(); const m = document.querySelector('main');
      const hit = r ? document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) : null; return { scrollTop: m ? m.scrollTop : null, y: r && r.y, bottom: r && r.bottom, onTop: !!hit && !!e && e.contains(hit) }; });
    check('L2 scrolled 600 px into the conversation: the Next action is still on screen and on top (sticky bar)', L2.scrollTop >= 500 && L2.y >= 0 && L2.bottom <= 900 && L2.onTop, L2);
    await page.evaluate(() => { const m = document.querySelector('main'); if (m) m.scrollTop = 0; });

    // R2 + C1 + C2 -- Brad's override, through the page's own control
    const badgeBefore = await page.getByTestId('seller-call-readiness-chip').evaluate((e) => e.firstElementChild.textContent.replace(/\s+/g, ' ').trim());
    const panelEl = page.getByTestId('readiness-human-action-panel');
    if (!(await panelEl.evaluate((e) => e.open))) await panelEl.locator('summary').click();
    await page.getByPlaceholder('Reason for overriding (required)').fill('B15-30 fixture override');
    await page.getByTestId('readiness-override-button').click();
    const t2 = Date.now(); while (Date.now() - t2 < 15000 && !latestReadinessHumanActionForOpportunity(fx.state.notes[G], OPP_A)) await page.waitForTimeout(100);
    const overrideRec = latestReadinessHumanActionForOpportunity(fx.state.notes[G], OPP_A);
    await page.waitForTimeout(1500);
    const a2 = await panel();
    check('R2 after the override (recorded on Deal A), the Next action is STILL Estimated Repairs and its reason says the override does not replace it',
      overrideRec && overrideRec.kind === 'overridden' && a2 && a2.deal === OPP_A && a2.step === 'repairs' && /override does not replace/i.test(a2.reason || ''), { overrideRec: overrideRec && overrideRec.kind, a2 });
    const c1 = await page.evaluate(() => ({ nbq: document.querySelector('[data-testid="next-best-question-open-step"]')?.textContent.trim() ?? null,
      presenting: /Move to presenting the offer/i.test(document.body.innerText), nexts: document.querySelectorAll('[data-testid="deal-next-step-go"]').length }));
    check('C1 one consistent instruction after the override: the Suggested Next Question block gives the same step and reason, nothing says "Move to presenting the offer", one Next action',
      c1.nbq !== null && c1.nbq.includes(A_LABEL) && c1.nbq.includes(a2 ? a2.reason : '\u0000') && !c1.presenting && c1.nexts === 1, c1);
    await shot(page, '01-deal-a-after-override-1440x900');
    const badgeAfter = await page.getByTestId('seller-call-readiness-chip').evaluate((e) => e.firstElementChild.textContent.replace(/\s+/g, ' ').trim());
    check('C2 offer approval rules intact: the readiness badge reads Offer Ready with the raw NOT READY evidence and the override, exactly as the engine reports it',
      badgeAfter === 'OFFER READY(raw evidence: NOT READY -- overridden)' && badgeBefore !== badgeAfter, { badgeBefore, badgeAfter });

    // R3 + R4
    await away();
    const b = await choose('Deal B', OPP_B);
    check('R3 Deal B: "Next: choose Assignment Mode (Underwriting)"; the link carries Deal B and the field',
      b.settled && b.settled.step === 'assignment_mode' && b.settled.label === B_LABEL && b.settled.href === `/contacts/${G}/underwriting?deal=${encodeURIComponent(OPP_B)}&focus=assignment_mode`, b.settled);
    await away();
    const a4 = await choose('Deal A', OPP_A);
    const flashB = b.seen.filter((s) => !s.startsWith(`${OPP_B}:`) || s === `${OPP_B}:repairs`);
    const flashA = a4.seen.filter((s) => !s.startsWith(`${OPP_A}:`) || s === `${OPP_A}:assignment_mode`);
    check('R4 back on Deal A: its own step (Estimated Repairs) again', a4.settled && a4.settled.step === 'repairs', a4.settled);
    check('R4 no stale-deal flash: while each deal loaded, the Next action only ever showed that deal (checking, then its own step)', flashB.length === 0 && flashA.length === 0, { b: b.seen, a: a4.seen });

    // R5
    await start();
    const a5 = (await choose('Deal A', OPP_A)).settled;
    await start();
    const b5 = (await choose('Deal B', OPP_B)).settled;
    check('R5 after a reload: Deal A resumes at Estimated Repairs (override still on record), Deal B at Assignment Mode', a5 && a5.step === 'repairs' && b5 && b5.step === 'assignment_mode', { a5, b5 });

    // R6 -- Deal A -> the repair estimator's first field
    await start();
    await choose('Deal A', OPP_A);
    await page.getByTestId('deal-next-step-go').click();
    const r6 = await landed('underwriting-repair-estimator');
    await shot(page, '02-deal-a-next-repairs-field-focused');
    if (r6) {
      Object.assign(r6, await page.evaluate(() => { const a = document.activeElement; const first = document.querySelector('[data-testid="underwriting-repair-estimator"] input[placeholder="Known amount"]');
        return { activePlaceholder: a?.getAttribute('placeholder') ?? null, firstAmount: !!a && a === first }; }));
      await page.keyboard.type('12500');   // no click: the keystrokes land in the focused field (draft only; nothing is saved)
      r6.typed = await page.evaluate(() => document.querySelector('[data-testid="underwriting-repair-estimator"] input[placeholder="Known amount"]')?.value ?? null);
    }
    check('R6 Deal A\'s Next opens Underwriting on Deal A (no picker) with the focus IN the repair estimator\'s first Known amount field, and typing (no click) lands there',
      r6 && r6.path === `/contacts/${G}/underwriting?deal=${encodeURIComponent(OPP_A)}&focus=repairs` && !r6.picker && r6.applied === 'true' && r6.activeInside && r6.activeTag === 'INPUT' && r6.activePlaceholder === 'Known amount' && r6.firstAmount === true && r6.typed === '12500', r6);
    check('R6 the guided bar names Deal A and "enter Estimated Repairs", and returns to Seller Call on Deal A',
      r6 && r6.barDeal === OPP_A && /Deal A: enter Estimated Repairs/.test(r6.barText || '') && r6.backHref === back(G, OPP_A), r6 && { barDeal: r6.barDeal, barText: r6.barText, backHref: r6.backHref });

    // R7 -- Deal B -> an Assignment Mode option, then continue
    await start();
    await choose('Deal B', OPP_B);
    await page.getByTestId('deal-next-step-go').click();
    const r7 = await landed('assignment-mode-selector');
    check('R7 Deal B\'s Next opens Underwriting on Deal B with the focus ON an Assignment Mode option (the actual choice)',
      r7 && r7.path === `/contacts/${G}/underwriting?deal=${encodeURIComponent(OPP_B)}&focus=assignment_mode` && !r7.picker && r7.applied === 'true' && r7.activeInside && /^assignment-mode-option-/.test(r7.activeTestId || ''), r7);
    await shot(page, '03-deal-b-next-assignment-mode-focused');
    const writesBefore7 = fx.state.writes.length;
    await page.keyboard.press('Enter');
    const t7 = Date.now(); while (Date.now() - t7 < 15000 && !fx.state.modes[OPP_B]) await page.waitForTimeout(100);
    await page.waitForTimeout(1500);
    const w7 = fx.state.writes.slice(writesBefore7);
    check('R7b Enter on the focused option sets the mode: one write, on Deal B, with the focused option\'s label',
      w7.length === 1 && w7[0].op === 'opportunity.assignmentMode' && w7[0].target === OPP_B && fx.state.modes[OPP_B] === (r7 && r7.activeText), { w7, mode: fx.state.modes[OPP_B], focused: r7 && r7.activeText });
    await page.getByTestId('guided-return-back').click();
    const t7b = Date.now(); let b7 = null;
    while (Date.now() - t7b < 30000) { b7 = await panel(); if (b7 && b7.deal === OPP_B && b7.step !== 'checking') break; await page.waitForTimeout(150); }
    await page.waitForTimeout(400); b7 = await panel();
    const path7 = await page.evaluate(() => location.pathname + location.search);
    await shot(page, '04-deal-b-back-on-seller-call-offer-review');
    check('R7b "Back to Seller Call" reopens Deal B (no picker); its Next is now the offer review, your decision',
      path7 === back(G, OPP_B) && b7 && b7.deal === OPP_B && b7.step === 'offer_review' && b7.label === 'Next: review the offer — your decision (Seller Call)', { path7, b7 });

    // R10 -- the Arv deal -> Get Comps
    await start(V);
    const v0 = await settled(OPP_V);
    check('R10 Arv deal: "Next: approve the ARV (Underwriting)"', v0 && v0.step === 'arv' && v0.label === 'Next: approve the ARV (Underwriting)', v0);
    await page.getByTestId('deal-next-step-go').click();
    const r10 = await landed('arv-comps-workspace');
    await shot(page, '05-arv-deal-next-get-comps-focused');
    check('R10 the ARV Next opens Underwriting on that deal with the focus on Get Comps (the ARV workflow\'s first control); the guided bar returns to that deal',
      r10 && r10.path === `/contacts/${V}/underwriting?deal=${encodeURIComponent(OPP_V)}&focus=arv` && !r10.picker && r10.applied === 'true' && r10.activeTestId === 'arv-get-comps'
        && r10.barDeal === OPP_V && /approve the ARV/.test(r10.barText || '') && r10.backHref === back(V, OPP_V), r10);

    // R8 -- another seller
    await start();
    await choose('Deal A', OPP_A);
    await nav(`/contacts/${O}/seller-call`);
    const seen8 = []; const t8 = Date.now();
    while (Date.now() - t8 < 3000) { const p = await panel(); if (p) seen8.push(`${p.deal}:${p.step}`); await page.waitForTimeout(15); }
    const o8 = await settled(OPP_O);
    const allowed8 = new Set([':checking', `${OPP_O}:checking`, `${OPP_O}:transaction`]);
    const flash8 = [...new Set(seen8)].filter((s) => !allowed8.has(s));
    check('R8 switching to another seller never shows the previous seller\'s deal or step (sampled every ~15 ms); the new seller\'s own step follows',
      flash8.length === 0 && o8 && o8.step === 'transaction', { seen: [...new Set(seen8)], o8 });

    // R9 -- in place
    const before9 = await page.evaluate(() => location.pathname + location.search);
    await page.getByTestId('deal-next-step-go').click();
    await page.waitForTimeout(600);
    const r9 = await page.evaluate(() => { const el = document.querySelector('[data-testid="transaction-assumptions-panel"]');
      return { path: location.pathname + location.search, applied: el?.getAttribute('data-focus-applied') ?? null, activeInside: !!el && el.contains(document.activeElement), label: document.querySelector('[data-testid="deal-next-step-go"]')?.textContent.trim() }; });
    check('R9 a Seller Call step ("Next: record the transaction assumptions (Seller Call)") focuses that panel in place, without leaving the page',
      r9.label === 'Next: record the transaction assumptions (Seller Call)' && r9.path === before9 && r9.applied === 'true' && r9.activeInside, r9);

    // W
    const nonGet = log.filter((x) => x.method !== 'GET');
    check('W1 the only writes in the run are the two the operator made: the override note and the Assignment Mode choice (the guidance writes nothing)',
      nonGet.length === 2 && nonGet.filter((x) => x.kind === 'write' && x.op === 'note.create').length === 1 && nonGet.filter((x) => x.kind === 'write' && x.op === 'opportunity.assignmentMode').length === 1,
      nonGet.map((x) => `${x.method} ${x.kind} ${x.op || ''}`));
    check('W2 nothing left the machine; every request modelled; no page errors', foreign.length === 0 && unmodelled.length === 0 && pageErrors.length === 0, { foreign: foreign.slice(0, 3), unmodelled: [...new Set(unmodelled)], pageErrors: pageErrors.slice(0, 3) });
  } catch (e) { check(`run completed (${String(e && e.message).split('\n')[0]})`, false); }
  clearTimeout(watchdog);
  await browser.close().catch(() => {}); await server.close().catch(() => {});
  if (checks < FLOOR) check(`at least ${FLOOR} checks ran`, false, checks);
  console.log(`\nB15-30 deal next step (rendered): ${checks - failures}/${checks} checks passed${MUTATION ? ` (mutation ${MUTATION})` : ''}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
