/**
 * B15-25 S6 draft durability -- REAL Deal Calculator page, offline (Captain GO 2026-11-09, priority HIGH).
 *
 *   node scripts/test-b15-25-s6-durability.cjs                  the suite (exact FLOOR)
 *   node scripts/test-b15-25-s6-durability.cjs --before=<rev>   NEGATIVE CONTROL: Vite serves <rev>'s DealCalculator.tsx;
 *                                                              with 0a81688 (main before the correction) D1 must FAIL
 *   node scripts/test-b15-25-s6-durability.cjs --stress=<N>     S6's natural timing N times under CDP 20x CPU throttling;
 *                                                              every run must keep the unsaved figure (0 losses)
 *
 * The defect (Boards/B15-25/S6_DRAFT_DURABILITY_INVESTIGATION_SCOTTY_20261109): the write session is memory-only, so a
 * reload starts as "this-browser". If the operator enables saving as the contact link's last read completes, the
 * session-change effect can run AFTER the link restored the kept draft, with a render closure from the not-kept screen:
 * it blanked the restored figures and the keep-every-change effect then REMOVED the draft from browser storage.
 *
 * FORCED HARMFUL ORDER (deterministic, no throttling): on the reload every pipeline read is held in the page with its
 * body already fetched; the operator signs in and, in the SAME synchronous continuation (no await between them), a
 * MessageChannel task is posted that releases the held reads -- so the link resumes after React has rendered the session
 * change but while that render's session-change effect is still pending (on the uncorrected page: 3/3 lost). Every
 * draft-key removal is recorded from the page.
 *
 *   D1 same operator, single deal (S6's exact transition: saved 250000, unsaved 333000): after the forced reload the
 *      333000 is on screen, still in browser storage, "Restored ..." is said, and the draft key is never removed
 *   D2 operator isolation: B signs in at the forced moment -> B sees none of A's figures, B gets no draft, A's draft stays
 *      stored (never removed); A signing back in shows A's 333000
 *   D3 multi-deal contact: A's kept draft on deal A survives the forced reload while the deal choice is awaited and is
 *      restored on choosing deal A; a GENUINELY not-kept screen (typed before choosing) is still cleared when B signs in,
 *      and B's deal never shows A's figures
 *   D4 the benign order (the sign-in handled before the link resumes) still restores
 *   W  only the setup saves' note.create writes; no page errors, foreign or unmodelled requests
 */
'use strict';
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const APP = path.resolve(__dirname, '..');
const PAGE = path.join(APP, 'src', 'pages', 'DealCalculator.tsx');
const arg = (k) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const BEFORE = arg('before');
const STRESS = arg('stress') ? Number(arg('stress')) : 0;

const FLOOR = 14;
let checks = 0, failures = 0;
function check(name, ok, detail) {
  checks += 1; if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}
const C1 = 'conAAAA0001', DEAL1 = 'oppAAAA0001';                       // single deal
const C2 = 'conBBBB0002', DEAL2A = 'oppCCCC0003', DEAL2B = 'oppDDDD0004'; // two deals
const REPS = 3;

async function main() {
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const { chromium } = require('playwright');
  let swapped = 0;
  const before = { name: 'b15-25-s6-before', enforce: 'pre', transform(code, id) {
    if (!BEFORE || path.resolve(id.split('?')[0]) !== PAGE) return null;
    swapped++; return execFileSync('git', ['show', `${BEFORE}:app/src/pages/DealCalculator.tsx`], { cwd: APP, encoding: 'utf8', maxBuffer: 64 << 20 });
  } };
  const server = await createServer({
    root: APP, configFile: false, plugins: [before, react()], logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: ['scripts/harness/deal-calculation-save/index.html'],
      include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] },
  });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const exit = async (code) => { await browser.close().catch(() => {}); await server.close().catch(() => {}); process.exit(code); };

  const deals = { [C1]: [DEAL1], [C2]: [DEAL2A, DEAL2B] };
  const state = { notes: { [C1]: [], [C2]: [] } };
  const writes = [], foreign = [], unmodelled = [], pageErrors = [], removals = [], heldReads = [];
  let noteSeq = 0;
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1100 }, timezoneId: 'America/Chicago' });
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    page.on('console', (m) => { const t = m.text(); if (t.startsWith('[s6-remove] ')) removals.push(t.slice(12)); });
    // Every removal of a draft key is recorded; on ?s6hold=1 the pipeline read is held with its body already fetched.
    await page.addInitScript(() => {
      const rem = Storage.prototype.removeItem;
      Storage.prototype.removeItem = function (k) { if (String(k).startsWith('iaos-calculator-draft:')) console.log('[s6-remove] ' + k); return rem.call(this, k); };
      if (!location.search.includes('s6hold=1')) return;
      // Every pipeline read until the release is held (in development the mount effect runs twice, so the live link's
      // read is the LAST one); the release resolves them all, in order, from one task.
      const of = window.fetch.bind(window);
      const held = [];
      window.__s6Release = () => { window.__s6Released = true; for (const h of held.splice(0)) h(); };
      window.fetch = (u, i) => {
        if (!String(u).includes('/.netlify/functions/ghl-opportunities') || window.__s6Released) return of(u, i);
        return new Promise((res) => { of(u, i).then(async (r) => { const body = await r.text(); const status = r.status;
          held.push(() => res(new Response(body, { status, headers: { 'content-type': 'application/json' } })));
          window.__s6HeldCount = held.length; window.__s6Held = true; }); });
      };
    });
    await page.route('**/*', async (route) => {
      const req = route.request(); const url = req.url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { foreign.push(url); return route.abort(); }
      const u = new URL(url); const fn = u.pathname.replace('/.netlify/functions/', '');
      const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }).catch(() => {});
      if (fn === 'ghl-underwriting-policy') return json(200, { values: [] });
      if (fn === 'ghl-opportunities') return json(200, { pipelineId: 'pipe', stages: [], opportunities: Object.entries(deals).flatMap(([contactId, ids]) => ids.map((id) => ({ id, contactId, contactName: 'Kay Fixture', opportunityName: id, phone: '', email: '', stageId: 's', customFields: [] }))) });
      if (fn === 'ghl-proxy') {
        const p = u.searchParams.get('path');
        const contact = Object.keys(deals).find((c) => p === `/contacts/${c}`);
        if (contact) return json(200, { contact: { id: contact, firstName: 'Kay', lastName: 'Fixture', customFields: [] } });
        const notesOf = Object.keys(deals).find((c) => p === `/contacts/${c}/notes`);
        if (notesOf) return json(200, { notes: state.notes[notesOf] });
        const opp = Object.entries(deals).find(([, ids]) => ids.some((id) => p === `/opportunities/${id}`));
        if (opp) return json(200, { opportunity: { id: p.split('/')[2], contactId: opp[0], customFields: [] } });
      }
      if (fn === 'ghl-write' && req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}'); writes.push(body);
        if (body.operation === 'note.create') state.notes[body.args.contactId || C1]?.push({ id: 'note-' + (++noteSeq), body: body.args.body, dateAdded: new Date().toISOString() });
        return json(200, { id: 'note-' + noteSeq, confirmed: true });
      }
      unmodelled.push(fn + ' ' + req.method()); return json(404, { error: 'fixture does not model ' + fn });
    });
    const T = (id) => page.getByTestId(id);
    const until = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await page.waitForTimeout(50); } return false; };
    const visible = async (id) => (await T(id).count()) > 0 && (await T(id).first().isVisible());
    const url = (c, hold) => `${base}/scripts/harness/deal-calculation-save/index.html?contactId=${c}${hold ? '&s6hold=1' : ''}`;
    const linked = async (c) => { await page.goto(url(c)); await T('deal-calc-arv-input').waitFor({ timeout: 60000 }); };
    const session = (sub) => `(async () => { const m = await import('/src/lib/app-write-session.ts'); const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, ''); m.setAppWriteSession({ token: b64({ alg: 'none' }) + '.' + b64({ sub: ${JSON.stringify(sub)} }) + '.x', expiresAt: new Date(Date.now() + 3600000).toISOString() }); })()`;
    const signIn = (sub) => page.evaluate(session(sub));
    const chooseDeal = async (id) => {
      if (await visible('deal-calc-deal-select')) await T('deal-calc-deal-select').selectOption(id);
      await until(async () => (await T('deal-calc-save-calculation').count()) > 0 && !(await T('deal-calc-save-calculation').isDisabled()));
    };
    const arv = () => T('deal-calc-arv-input').inputValue();
    const stored = (op, deal) => page.evaluate(([o, d]) => { const k = Object.keys(localStorage).find((x) => x.includes(`|${o}|`) && x.endsWith('|' + d)); return k ? (JSON.parse(localStorage.getItem(k)).fields.arv?.value ?? null) : null; }, [op, deal]);
    const anyDraftOf = (op) => page.evaluate((o) => Object.keys(localStorage).some((x) => x.startsWith('iaos-calculator-draft:') && x.includes(`|${o}|`)), op);
    const removedFor = (op, deal) => removals.filter((k) => k.includes(`|${op}|`) && k.endsWith('|' + deal)).length;
    const note = async () => ((await T('deal-calc-restore-note').count()) ? (await T('deal-calc-restore-note').innerText()) : (await page.locator('body').innerText()));
    const saveOk = async (value) => {
      await T('deal-calc-arv-input').fill(String(value));
      const n = writes.length; await T('deal-calc-save-calculation').click();
      await until(async () => writes.length === n + 1 && (await T('deal-calc-save-status').getAttribute('data-state')) === 'saved');
    };
    /** A clean browser and the operator's kept draft: S6's exact setup (saved 250000, then the unsaved figure). */
    const seed = async (op, c, deal, unsaved, { save = true } = {}) => {
      await linked(c); await page.evaluate(() => { try { localStorage.clear(); } catch { /* none */ } }); await linked(c);
      await signIn(op); await page.waitForTimeout(300); await chooseDeal(deal);
      if (save) await saveOk(250000);
      await T('deal-calc-arv-input').fill(String(unsaved));
      return stored(op, deal);
    };
    /** The reload with the harmful order forced: sign in, then release the held link read from the next task. */
    const waitHeld = async () => {
      await page.waitForFunction(() => window.__s6Held === true, null, { timeout: 60000 });
      await page.waitForTimeout(400);   // the second (live) mount read in development
      heldReads.push(await page.evaluate(() => window.__s6HeldCount));
    };
    const cdp = await page.context().newCDPSession(page);
    const reloadForced = async (c, op) => {
      await page.goto(url(c, true)); await waitHeld();
      // The sign-in and the posting of the release task happen in ONE synchronous continuation (no await between them).
      await page.evaluate(async (sub) => {
        const m = await import('/src/lib/app-write-session.ts');
        const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
        m.setAppWriteSession({ token: b64({ alg: 'none' }) + '.' + b64({ sub }) + '.x', expiresAt: new Date(Date.now() + 3600000).toISOString() });
        const ch = new MessageChannel(); ch.port1.onmessage = () => window.__s6Release(); ch.port2.postMessage(0);
      }, op);
      await page.waitForTimeout(1500);
    };
    /** The benign order: the sign-in is fully handled before the held link read is released. */
    const reloadBenign = async (c, op) => {
      await page.goto(url(c, true)); await waitHeld();
      await signIn(op); await page.waitForTimeout(600);
      await page.evaluate(() => window.__s6Release()); await page.waitForTimeout(800);
    };

    if (STRESS > 0) {
      // ── STRESS: S6's natural timing (400 ms, plain reload, sign in, choose) under CDP 20x CPU throttling ──
      const lost = [];
      for (let i = 1; i <= STRESS; i += 1) {
        removals.length = 0;
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
        await seed('op-a', C1, DEAL1, 333000);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 20 });
        await page.waitForTimeout(400);
        await linked(C1); await signIn('op-a'); await chooseDeal(DEAL1);
        const ok = await until(async () => (await arv()) === '333000', 15000);
        const r = { run: i, screen: await arv(), stored: await stored('op-a', DEAL1), removed: removedFor('op-a', DEAL1) };
        if (!ok || r.stored !== '333000' || r.removed) lost.push(r);
        console.log(`stress run ${i}/${STRESS}: screen=${r.screen} stored=${r.stored} removed=${r.removed}`);
      }
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      check(`STRESS ${STRESS} runs of S6's natural timing at 20x CPU throttling: no unsaved figure lost (screen, storage, no removal)`, lost.length === 0, lost);
      console.log(`\nstress: ${STRESS} runs, ${lost.length} lost${BEFORE ? ` (before=${BEFORE} swapped=${swapped})` : ''}`);
      return exit(lost.length ? 1 : 0);
    }

    // ── D1 same operator, single deal, forced harmful order (S6's exact transition), x3 ──
    const d1 = [];
    for (let i = 0; i < REPS; i += 1) {
      const pre = await seed('op-a', C1, DEAL1, 333000);
      removals.length = 0;
      await reloadForced(C1, 'op-a');
      await until(async () => (await arv()) === '333000', 5000);
      d1.push({ pre, screen: await arv(), stored: await stored('op-a', DEAL1), removed: removedFor('op-a', DEAL1), note: /Restored the figures kept in this browser/.test(await note()) });
    }
    check('D1 precondition: the unsaved 333000 was in browser storage before every reload', d1.every((r) => r.pre === '333000'), d1);
    check('D1 after the forced reload the unsaved 333000 is on screen (x3)', d1.every((r) => r.screen === '333000'), d1);
    check('D1 ...and still in browser storage under the operator\'s deal draft (x3)', d1.every((r) => r.stored === '333000'), d1);
    check('D1 ...and the draft was never removed (x3)', d1.every((r) => r.removed === 0), d1);
    check('D1 ...and the page says it restored the kept figures', d1.every((r) => r.note), d1);

    // ── D2 operator isolation: B signs in at the forced moment ──
    await seed('op-a', C1, DEAL1, 333000);
    removals.length = 0;
    await reloadForced(C1, 'op-b');
    await chooseDeal(DEAL1);
    const d2 = { screen: await arv(), bDraft: await anyDraftOf('op-b'), aStored: await stored('op-a', DEAL1), aRemoved: removedFor('op-a', DEAL1) };
    check('D2 B signing in at the forced moment sees none of A\'s figures and gets no draft of A\'s', d2.screen !== '333000' && d2.bDraft === false, d2);
    check('D2 ...and A\'s kept draft stays in browser storage (never removed)', d2.aStored === '333000' && d2.aRemoved === 0, d2);
    await signIn('op-a'); await until(async () => (await arv()) === '333000', 5000);
    check('D2 A signing back in shows A\'s own 333000 again', (await arv()) === '333000', await arv());

    // ── D3 multi-deal contact ──
    await seed('op-a', C2, DEAL2A, 333000, { save: false });
    removals.length = 0;
    await reloadForced(C2, 'op-a');
    const d3await = { select: await visible('deal-calc-deal-select'), stored: await stored('op-a', DEAL2A), removed: removedFor('op-a', DEAL2A) };
    await chooseDeal(DEAL2A); await until(async () => (await arv()) === '333000', 5000);
    const d3 = { ...d3await, screen: await arv() };
    check('D3 multi-deal: A\'s kept deal-A draft survives the forced reload while the choice is awaited, and choosing deal A restores 333000', d3.select && d3.stored === '333000' && d3.removed === 0 && d3.screen === '333000', d3);
    // a genuinely not-kept screen: link the two-deal contact, type before choosing, then B signs in
    await linked(C2); await signIn('op-a'); await page.waitForTimeout(300);
    await until(async () => visible('deal-calc-deal-select'));
    await T('deal-calc-arv-input').fill('777000'); await page.waitForTimeout(200);
    await signIn('op-b'); await page.waitForTimeout(500);
    const cleared = await arv();
    await chooseDeal(DEAL2B);
    const d3b = { cleared, bDeal: await arv(), aStored: await stored('op-a', DEAL2A), bStored: await stored('op-b', DEAL2B) };
    check('D3 a genuinely not-kept screen (typed before choosing) is still cleared when B signs in', d3b.cleared === '', d3b);
    check('D3 ...B\'s deal never shows A\'s figures, nothing of A\'s is kept for B, and A\'s deal-A draft is untouched', d3b.bDeal !== '777000' && d3b.bDeal !== '333000' && d3b.bStored === null && d3b.aStored === '333000', d3b);

    // ── D4 benign order ──
    await seed('op-a', C1, DEAL1, 333000);
    removals.length = 0;
    await reloadBenign(C1, 'op-a'); await chooseDeal(DEAL1); await until(async () => (await arv()) === '333000', 5000);
    check('D4 the benign order (sign-in handled before the link resumes) still restores 333000 and keeps it stored', (await arv()) === '333000' && (await stored('op-a', DEAL1)) === '333000' && removedFor('op-a', DEAL1) === 0);

    // ── W ──
    check('W the only writes are the setup saves\' note.create', writes.length > 0 && writes.every((w) => w.operation === 'note.create'), writes.map((w) => w.operation));
    check('W no page errors, no foreign or unmodelled requests', pageErrors.length === 0 && foreign.length === 0 && unmodelled.length === 0, { pageErrors: pageErrors.slice(0, 3), foreign, unmodelled });
  } catch (e) {
    failures += 1; console.error('FAIL  run aborted: ' + (e && e.stack || e) + ' | page errors: ' + JSON.stringify(pageErrors.slice(0, 3)));
  }
  console.log('');
  if (!STRESS) console.log('held pipeline reads per forced/benign reload: ' + JSON.stringify(heldReads));
  console.log('checksRun=' + checks + ' failures=' + failures + ' floor=' + FLOOR + (BEFORE ? ` before=${BEFORE} swapped=${swapped}` : ''));
  if (BEFORE && swapped < 1) { console.error('ABORT: the before file was not served'); return exit(2); }
  if (checks !== FLOOR) { console.error('FAILED: expected exactly ' + FLOOR + ' checks, ran ' + checks); return exit(failures ? 1 : 2); }
  if (failures > 0) { console.error('FAILED'); return exit(1); }
  console.log('OK'); return exit(0);
}
main();
