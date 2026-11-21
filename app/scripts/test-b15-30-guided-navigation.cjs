/**
 * B15-30 guided navigation (Captain 2026-11-20, Brad's two Test walkthrough findings) -- the REAL App
 * (scripts/harness/app-routes), offline, 1440x900. Fixture: scripts/harness/b15-30/nav-deals-fixture.cjs -- one seller:
 *   Deal A "7 of 8" (offer review next) · Deal B "6 of 8" (seller's price next) · Probe deal = the IAOS Test Probe state
 *   (Agreement Reached at $415,000, Contract Ready checklist complete, Current Offer empty, no seller's price).
 * Every write is refused and counted.
 *
 * Finding 1 -- the destination after an agreement:
 *   C1  Probe deal: "Agreement reached at $415,000. Your contract checklist is complete." and "Next: open Contract Ready"
 *       -- never the seller's price
 *   C2  ONE click opens the Contract Workspace for THAT deal (?deal=, no picker although the seller has three deals)
 *   C3  a deal with no agreement still gets its own next step (Deal B: the seller's price)
 *   C4  Previous from Contract Ready -> the contract checklist, in place, the panel focused (never a checkbox: Space
 *       would toggle and save it); Next -> "open Contract Ready" again
 *
 * Finding 2 -- Previous beside Guided Next:
 *   P1  Deal A resumed at 7 of 8: a visible, enabled "Previous" beside the Next action
 *   P2  Previous -> the seller's price, in place (no navigation, no prompt): its field focused, "Reviewing"
 *   P3  Previous -> the transaction assumptions, in place: its first field focused; Next names the seller's price
 *   P4  Previous -> skips the GHL-only Investor Policy step -> Assignment Mode on Underwriting for Deal A, the selector
 *       itself focused (never an option button); with a conversation draft open the page's own leave prompt says the
 *       answers stay as a draft; the bar says "Reviewing" and returns to that position
 *   P5  back, then Next, Next, Next: transaction -> seller's price -> the offer review (live again)
 *   P6  the conversation draft survives the round trip and the "7 of 8" progress never changes
 *   P7  at the first step (the property) Previous is disabled and does nothing; the panel is focused, not "Withdraw"
 *   P8  Deal B (6 of 8): Previous -> transaction; Next -> its own next unfinished step
 *   P9  the review position belongs to its deal (switch away and back)
 *   P10 a reload of Underwriting's return link resumes the position; Next moves forward from it
 *   D1  an OFFER FIELD DRAFT (Current Offer typed, not saved) + Previous and Next: no write, the draft stays in the field
 *   W   ZERO writes in the whole run; nothing left the machine; no page errors
 *
 * NEGATIVE CONTROLS (NAV_MUTATION=..., dev server only; each must exit 1):
 *   agreement_ignored | contract_link_without_deal | previous_enabled_at_first | no_policy_skip | review_not_deal_bound |
 *   return_drops_review | review_focuses_button | review_focuses_checkbox | next_ignores_review | navigation_blur_saves |
 *   review_in_url
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
require('./harness/ts-loader.cjs');
const { navDeals, N, OPP_A, OPP_B, OPP_C } = require('./harness/b15-30/nav-deals-fixture.cjs');
const { createBarrierFixture } = require('./harness/current-offer-barrier-fixture.cjs');
const APP = path.resolve(__dirname, '..');
const HARNESS = '/scripts/harness/app-routes/index.html';
const fx = navDeals();

const MODEL = '/src/lib/deal-next-step.ts';
const PAGE = '/src/pages/SellerCallWorkspace.tsx';
const PANEL = '/src/components/DealNextStepPanel.tsx';
const FOCUS = '/src/lib/focus-target.ts';
const BLUR = '/src/lib/lifecycle-blur.ts';
const MUTATIONS = {
  agreement_ignored: [[MODEL, '  if (s.agreement && s.agreement.kind === "accepted") {', '  if (false) {']],
  contract_link_without_deal: [[PANEL, 'to={`/contacts/${encodeURIComponent(contactId)}/contract${dealId ? `?deal=${encodeURIComponent(dealId)}` : ""}`}>', 'to={`/contacts/${encodeURIComponent(contactId)}/contract`}>']],
  previous_enabled_at_first: [[PANEL, 'disabled={nav.previous === null}', 'disabled={false}']],
  no_policy_skip: [[MODEL, 'export const GUIDED_FIELD_STEPS: readonly DealStepId[] = NAV_ORDER.filter((id) => id !== "policy");', 'export const GUIDED_FIELD_STEPS: readonly DealStepId[] = NAV_ORDER.filter(() => true);']],
  review_not_deal_bound: [[PAGE, 'reviewPosition !== null && reviewPosition.deal === guidedDealId ? reviewCursor', 'reviewPosition !== null ? reviewCursor']],
  return_drops_review: [[PANEL, '${reviewStep ? `&step=${encodeURIComponent(reviewStep)}` : ""}', '']],
  review_focuses_button: [[FOCUS, '  const control = opts?.review\n    ? (preferred && preferred.matches(FIELD) ? preferred : el.querySelector<HTMLElement>(FIELD))\n    : preferred ??', '  const control = preferred ??']],
  review_focuses_checkbox: [[FOCUS, ':not([type=checkbox]):not([type=radio])', '']],
  next_ignores_review: [[PAGE, '    onForward: () => goToGuidedStep(navForward),', '    onForward: () => goToGuidedStep(null),']],
  navigation_blur_saves: [[BLUR, '  if (guidedNavigationUntil > Date.now()) { guidedNavigationUntil = 0; return true; }', '']],
  review_in_url: [[PAGE, '    setReviewPosition(review ? { deal: guidedDealId, step: target.id } : null);', '    setReviewPosition(review ? { deal: guidedDealId, step: target.id } : null);\n    navigate({ search: `?deal=${encodeURIComponent(guidedDealId)}${review ? `&step=${target.id}` : ""}` }, { replace: true });']],
};
const MUTATION = process.env.NAV_MUTATION || '';
if (MUTATION && !MUTATIONS[MUTATION]) { console.error(`FAIL  unknown mutation ${MUTATION}`); process.exit(2); }
for (const [file, from] of MUTATIONS[MUTATION] || []) { const t = fs.readFileSync(path.join(APP, file), 'utf8').replace(/\r\n/g, '\n'); if (t.split(from).length !== 2) { console.error(`FAIL  mutation ${MUTATION}: anchor not found exactly once in ${file}`); process.exit(2); } }

let checks = 0, failures = 0;
function check(name, ok, detail) { checks += 1; if (!ok) failures += 1; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : ` -- ${JSON.stringify(detail).slice(0, 700)}`}`); }
const FLOOR = 18;
const SHOTS = process.env.NAV_SHOTS || '';
const watchdog = setTimeout(() => { console.error('FAIL  did not finish within 12 minutes'); process.exit(1); }, 12 * 60_000);

function classify(url, method, post) {
  const u = new URL(url); const fn = u.pathname.replace('/.netlify/functions/', '');
  if (fn === 'ghl-write' && method === 'POST') return { kind: 'write', op: post && post.operation };
  if (fn === 'ghl-proxy') { const p = u.searchParams.get('path') || ''; let m;
    if ((m = p.match(/^\/contacts\/([^/?]+)\/notes$/))) return { kind: 'notes', contact: m[1] };
    if ((m = p.match(/^\/contacts\/([^/?]+)$/))) return { kind: 'detail', contact: m[1] };
    if ((m = p.match(/^\/opportunities\/([^/?]+)$/))) return { kind: 'opp-read', target: m[1] };
    if (/\/customFields\/[^/]+$/.test(p)) return { kind: 'folder' };
    if (/\/customFields$/.test(p)) return { kind: 'defs' };
    return { kind: 'proxy-other', path: p }; }
  if (fn === 'ghl-contact') return { kind: 'row', contact: u.searchParams.get('id') };
  return { kind: fn };
}

async function main() {
  if (MUTATION) console.log(`NEGATIVE CONTROL: mutation ${MUTATION}; this run must fail.`);
  const bf = createBarrierFixture({ contactOf: fx.contactOf });
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const tailwindcss = (await import('@tailwindcss/vite')).default;
  const { chromium } = require('playwright');
  const mutate = { name: 'nav-mutation', enforce: 'pre', transform(code, id) {
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
  const log = []; const foreign = []; const unmodelled = []; const pageErrors = []; const dialogs = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'America/Chicago' });
    await context.addInitScript(() => { window.__iaosHarnessOverride = { writeSession: true }; });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
    page.on('dialog', (d) => { dialogs.push(d.message()); d.accept().catch(() => {}); });   // Brad answers OK, as on a real leave prompt
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
      if (req.kind === 'write' || r.method() !== 'GET') return json(409, { outcome: 'not_sent', error: 'navigation fixture: every write is refused' });
      const a = fx.answer(req); if (a) return json(a.status, a.body);
      unmodelled.push(`${r.method()} ${req.kind}${req.path ? ' ' + req.path : ''}`); return json(404, { error: 'unmodelled' });
    });
    const shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {}); };
    const nonGets = () => log.filter((x) => x.method !== 'GET').length;
    const state = () => page.evaluate(() => {
      const e = document.querySelector('[data-testid="deal-next-step"]'); const t = (sel) => document.querySelector(sel)?.textContent.replace(/\s+/g, ' ').trim() ?? null;
      const prev = document.querySelector('[data-testid="deal-previous-step-go"]'); const a = document.activeElement; const go = document.querySelector('[data-testid="deal-next-step-go"]');
      return { url: location.pathname + location.search, deal: e?.getAttribute('data-deal') ?? null, step: e?.getAttribute('data-step') ?? null, reviewing: e?.getAttribute('data-reviewing') ?? null,
        next: t('[data-testid="deal-next-step-go"]'), nextHref: go?.getAttribute('href') ?? null, reason: t('[data-testid="deal-next-step-reason"]'), progress: t('[data-testid="deal-next-step-progress"]'),
        previous: prev ? { text: prev.textContent.trim(), disabled: prev.disabled, title: prev.getAttribute('title') } : null,
        focused: a && a !== document.body ? (a.getAttribute('data-testid') || a.tagName) : null, focusedTag: a ? a.tagName : null, focusedType: a ? a.getAttribute('type') : null,
        draft: document.querySelector('[data-testid="sc-call-notes"]')?.value ?? null, offer: document.querySelector('[data-testid="negotiation-current-offer-input"]')?.value ?? null,
        bar: t('[data-testid="guided-return"]'), barReviewing: document.querySelector('[data-testid="guided-return"]')?.getAttribute('data-reviewing') ?? null,
        backHref: document.querySelector('[data-testid="guided-return-back"]')?.getAttribute('href') ?? null };
    });
    const settledOn = async (deal) => { const t0 = Date.now(); while (Date.now() - t0 < 30000) { const s = await state(); if (s.deal === deal && s.step && s.step !== 'checking') { await page.waitForTimeout(400); return state(); } await page.waitForTimeout(100); } return state(); };
    const start = async (route) => { await page.goto(`${base}${HARNESS}?start=${encodeURIComponent(route)}`); await page.waitForFunction(() => typeof window.__iaosAppSource === 'string', null, { timeout: 90000 }); };
    const pick = (name) => page.getByRole('button', { name, exact: true }).click({ timeout: 60000 });
    const click = async (tid) => { await page.getByTestId(tid).click(); await page.waitForTimeout(500); };
    const OFFER = 'Next: review the offer — your decision (Seller Call)';
    const PRICE = "Next: record the seller's price position (Seller Call)";
    const SELLER_CALL = `/contacts/${N}/seller-call`;
    const A = encodeURIComponent(OPP_A);

    // ── Finding 1 ──────────────────────────────────────────────────────────────
    await start(SELLER_CALL);
    await pick('Probe deal');
    const c1 = await settledOn(OPP_C);
    check('C1 the IAOS Test Probe deal (Agreement $415,000, checklist complete, Current Offer empty): "Agreement reached at $415,000. Your contract checklist is complete." and "Next: open Contract Ready" -- not the seller\'s price',
      c1.next === 'Next: open Contract Ready' && c1.reason === 'Agreement reached at $415,000. Your contract checklist is complete.' && c1.step === 'contract_ready', c1);
    await shot('01-probe-deal-next-open-contract-ready');
    // C4 first (in place), then C2 (leaves the page)
    await click('deal-previous-step-go');
    const c4a = await state();
    await click('deal-next-step-go');
    const c4b = await state();
    check('C4 Previous from Contract Ready -> the contract checklist, in place, the panel itself focused (never a checkbox); Next -> "open Contract Ready" again',
      c4a.reviewing === 'contract_checklist' && c4a.focused === 'contract-ready-checklist' && c4a.focusedType !== 'checkbox' && c4a.url === SELLER_CALL
        && c4b.reviewing === '' && c4b.next === 'Next: open Contract Ready', { c4a, c4b });
    const writesC = nonGets();
    await page.getByTestId('deal-next-step-go').click();
    const t2 = Date.now(); let c2 = null;
    while (Date.now() - t2 < 30000) {
      c2 = await page.evaluate(() => ({ url: location.pathname + location.search, heading: !!document.querySelector('[data-testid="contract-workspace-heading"]'),
        chooser: !!document.querySelector('[data-testid="deal-chooser"]'), body: document.body.innerText.includes('415,000') }));
      if (c2.heading && c2.body) break; await page.waitForTimeout(200);
    }
    check('C2 ONE click opens the Contract Workspace for THAT deal (?deal=, no deal picker although the seller has three deals), showing the $415,000 agreement; no write',
      c2 && c2.url === `/contacts/${N}/contract?deal=${encodeURIComponent(OPP_C)}` && c2.heading && !c2.chooser && c2.body && nonGets() === writesC, c2);
    await shot('02-contract-ready-workspace-probe-deal');
    // C3
    await start(SELLER_CALL);
    await pick('Deal B');
    const c3 = await settledOn(OPP_B);
    check('C3 a deal with no agreement still gets its own next step (Deal B: "Next: record the seller\'s price position", 6 of 8)', c3.next === PRICE && c3.progress === '6 of 8 steps done', c3);

    // ── Finding 2 ──────────────────────────────────────────────────────────────
    await start(SELLER_CALL);
    await pick('Deal A');
    const p1 = await settledOn(OPP_A);
    check('P1 Deal A resumed at "7 of 8 steps done": a visible, enabled "◀ Previous" beside "Next: review the offer"',
      p1.progress === '7 of 8 steps done' && p1.next === OFFER && p1.previous && p1.previous.text === '◀ Previous' && p1.previous.disabled === false && p1.reviewing === '', p1);
    await shot('03-deal-a-resumed-7-of-8');
    // D1 -- an offer-field draft (typed, NOT saved), then Previous and Next
    const before = nonGets();
    await page.getByTestId('negotiation-current-offer-input').fill('300000');   // focus stays in the field: a draft
    await click('deal-previous-step-go');
    const d1a = await state();
    await click('deal-next-step-go');
    const d1b = await state();
    check('D1 with a Current Offer draft (typed, not saved), Previous and Next make NO write and the draft stays in the field',
      nonGets() === before && d1a.offer === '300000' && d1b.offer === '300000' && d1a.reviewing === 'seller_price' && d1b.reviewing === '', { writes: nonGets() - before, d1a: d1a.offer, d1b: d1b.offer });
    await page.getByTestId('negotiation-current-offer-input').fill('');   // clear the offer draft so later leaves don't depend on it
    // a conversation draft, kept in the browser for this deal
    await page.getByTestId('sc-call-notes').fill('Seller wants a 30-day close; tenant leaves in December.');
    const writes0 = nonGets();
    // P2
    await click('deal-previous-step-go');
    const p2 = await state();
    check('P2 Previous -> the seller\'s price, in place (no navigation, no prompt): its field focused, "Reviewing", Next names the offer review',
      p2.url === SELLER_CALL && p2.reviewing === 'seller_price' && p2.focused === 'seller-price-position-input' && /^Reviewing the seller's price position/.test(p2.reason || '') && p2.next === OFFER && dialogs.length === 0, { p2, dialogs });
    await shot('04-previous-seller-price');
    // P3
    await click('deal-previous-step-go');
    const p3 = await state();
    check('P3 Previous -> the transaction assumptions, in place: its first field focused; Next names the seller\'s price',
      p3.url === SELLER_CALL && p3.reviewing === 'transaction' && p3.focused === 'transaction-structure-input' && p3.next === PRICE, p3);
    // P4
    await click('deal-previous-step-go');
    const t4 = Date.now(); let p4 = await state();
    while (Date.now() - t4 < 30000 && !(p4.bar && p4.focused)) { await page.waitForTimeout(150); p4 = await state(); }
    check('P4 Previous skips the GHL-only Investor Policy step -> Assignment Mode on Underwriting for Deal A, the selector itself focused; the leave prompt says the answers stay as a draft; the bar returns to that position',
      p4.url === `/contacts/${N}/underwriting?deal=${A}&focus=assignment_mode&step=assignment_mode` && p4.focused === 'assignment-mode-selector' && p4.focusedTag !== 'BUTTON'
        && dialogs.length === 1 && /stay as a draft in this browser for this deal/.test(dialogs[0])
        && /^Reviewing from Seller Call/.test(p4.bar || '') && p4.backHref === `/contacts/${N}/seller-call?deal=${A}&step=assignment_mode`, { p4, dialogs });
    await shot('05-previous-assignment-mode-underwriting');
    // P5 + P6
    await page.getByTestId('guided-return-back').click();
    const b5 = await settledOn(OPP_A);
    await click('deal-next-step-go'); const n1 = await state();
    await click('deal-next-step-go'); const n2 = await state();
    await click('deal-next-step-go'); const n3 = await state();
    check('P5 back at the same position, then Next, Next, Next: transaction -> seller\'s price -> the offer review (live again), each field focused',
      b5.reviewing === 'assignment_mode' && n1.reviewing === 'transaction' && n1.focused === 'transaction-structure-input' && n2.reviewing === 'seller_price' && n2.focused === 'seller-price-position-input'
        && n3.reviewing === '' && n3.next === OFFER, { b5, n1, n2, n3 });
    check('P6 the conversation draft survives the Underwriting round trip and the "7 of 8" progress never changes',
      n3.draft === 'Seller wants a 30-day close; tenant leaves in December.' && [p2, p3, b5, n1, n2, n3].every((s) => s.progress === '7 of 8 steps done'), { draft: n3.draft, progress: [p2, p3, b5, n1, n2, n3].map((s) => s.progress) });
    await shot('06-next-back-to-live-draft-kept');
    // P7
    await start(`${SELLER_CALL}?deal=${A}&step=property`);
    const p7 = await settledOn(OPP_A);
    await page.getByTestId('deal-previous-step-go').click({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
    const p7b = await state();
    check('P7 at the first step (the property) Previous is disabled ("This is the first step") and does nothing',
      p7.reviewing === 'property' && p7.previous && p7.previous.disabled === true && p7.previous.title === 'This is the first step' && p7b.reviewing === 'property' && p7b.url === p7.url, { p7, p7b });
    await start(`${SELLER_CALL}?deal=${A}&step=repairs`);
    await settledOn(OPP_A);
    await click('deal-previous-step-go');
    const p7c = await state();
    check('P7 Previous onto the property focuses the property panel itself -- not its "Withdraw confirmation" button', p7c.reviewing === 'property' && p7c.focused === 'property-identity-panel', p7c);
    // P8 + P9
    await start(SELLER_CALL);
    await pick('Deal B');
    const p8 = await settledOn(OPP_B);
    await click('deal-previous-step-go'); const p8a = await state();
    await click('deal-next-step-go'); const p8b = await state();
    check('P8 Deal B (6 of 8): Previous -> transaction; Next -> its own next unfinished step, the seller\'s price',
      p8.next === PRICE && p8a.reviewing === 'transaction' && p8a.deal === OPP_B && p8b.reviewing === '' && p8b.next === PRICE, { p8, p8a, p8b });
    /* P9: on Seller Call a different deal is reached only by re-entering the page, so the realistic way a position could
       follow Brad to the wrong deal is a return link that names a deal which is no longer this seller's, after which
       Brad deliberately chooses another deal (B15-30 R1). That deal must open on its own live step. */
    await start(`${SELLER_CALL}?deal=${encodeURIComponent(`${N}-gone`)}&step=transaction`);
    await page.getByTestId('deal-chooser').waitFor({ timeout: 60000 });
    await page.getByTestId('deal-chooser').getByRole('button', { name: 'Deal B', exact: true }).click();
    const p9 = await settledOn(OPP_B);
    check('P9 the review position belongs to the deal it names: a return link for an unavailable deal, then Deal B chosen deliberately -> Deal B opens on its own live step, not the link\'s review position',
      p9.reviewing === '' && p9.next === PRICE && p9.deal === OPP_B, p9);
    // P10
    await start(`${SELLER_CALL}?deal=${A}&step=transaction`);
    const p10 = await settledOn(OPP_A);
    await click('deal-next-step-go'); const p10b = await state();
    check('P10 a reload of the return link (?deal=&step=transaction) resumes the position; Next moves forward to the seller\'s price', p10.reviewing === 'transaction' && p10b.reviewing === 'seller_price', { p10, p10b });
    // W
    check('W zero writes in the whole run: every move, the offer draft, the conversation draft and both page changes sent no write', nonGets() === 0 && writes0 === 0,
      log.filter((x) => x.method !== 'GET').map((x) => `${x.method} ${x.kind} ${x.op || ''}`));
    check('W nothing left the machine; no page errors', foreign.length === 0 && pageErrors.length === 0, { foreign: foreign.slice(0, 3), pageErrors: pageErrors.slice(0, 3) });
    if (unmodelled.length) console.log(`NOTE  unmodelled GETs answered 404 (reads only): ${JSON.stringify([...new Set(unmodelled)])}`);
  } catch (e) { check(`run completed (${String(e && e.message).split('\n')[0]})`, false); }
  clearTimeout(watchdog);
  await browser.close().catch(() => {}); await server.close().catch(() => {});
  if (checks < FLOOR) check(`at least ${FLOOR} checks ran`, false, checks);
  console.log(`\nB15-30 guided navigation: ${checks - failures}/${checks} checks passed${MUTATION ? ` (mutation ${MUTATION})` : ''}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
