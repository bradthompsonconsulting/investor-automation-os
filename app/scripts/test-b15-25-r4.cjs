/**
 * B15-25 r4 -- Bones REVISE on 80bfe48: P2-1 (no stale save after the panel's visit ends) and P2-2 (restored
 * browser drafts are unsaved work; only the submitted figures become "saved"). REAL Deal Calculator page, offline.
 *
 *   node scripts/test-b15-25-r4.cjs                  the suite (exact FLOOR)
 *   node scripts/test-b15-25-r4.cjs --before=<rev>   NEGATIVE CONTROL: Vite serves <rev>'s DealCalculationSavePanel.tsx
 *                                                   and DealCalculator.tsx (in-memory transform); the run must FAIL
 *
 * Same harness and fake GHL as test-deal-calculation-save.cjs (scripts/harness/deal-calculation-save; saving is
 * switched on in the harness only -- the committed switches stay DISABLED). A save's evidence read (the
 * opportunity) can be HELD, so a save is still waiting when the operator leaves.
 *
 *   P1 (P2-1) a save waiting on its evidence read sends NOTHING once the visit ends:
 *     S1 the operator changes (the panel remounts);  S2 the contact is unlinked (the panel unmounts);
 *     S3 the deal changes;  S5 a Resend waiting on its read, then the operator changes.
 *     S4 positive: with no change, the held save is sent exactly once when the read returns.
 *   P2 (P2-2) unsaved work is never replaced without asking; "saved" means exactly what was sent:
 *     S6 reload restores a draft -> Load asks; Keep mine keeps it (screen and storage); Replace loads (screen and storage);
 *     S7 an operator-restored draft and S8 a deal-restored draft -> Load asks;
 *     S9 positive: a genuinely clean form, and restored figures that ARE a saved calculation, load directly;
 *     S12 (component, Bones's own case) a panel MOUNTED with restored unsaved figures asks; Keep mine / Replace; a clean mount
 *         loads directly.  S9 is NEW behaviour (restored figures equal to a saved calculation are not asked about),
 *         so it is expected to fail on 80bfe48 (which asked) without being a defect there.
 *     S10 an unconfirmed save reconciled as found, and S10b one resent and confirmed, while newer figures were
 *         typed -> those newer figures stay unsaved (Load asks);  S11 positive: after a confirmed save, new typing asks.
 */
'use strict';
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const APP = path.resolve(__dirname, '..');
const PANEL = path.join(APP, 'src', 'components', 'DealCalculationSavePanel.tsx');
const PAGE = path.join(APP, 'src', 'pages', 'DealCalculator.tsx');
const beforeArg = process.argv.find((a) => a.startsWith('--before='));
const BEFORE = beforeArg ? beforeArg.slice('--before='.length) : null;
const show = (rel) => execFileSync('git', ['show', `${BEFORE}:app/${rel}`], { cwd: APP, encoding: 'utf8', maxBuffer: 64 << 20 });

const FLOOR = 25;
let checks = 0, failures = 0;
function check(name, ok, detail) {
  checks += 1; if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}
const CONTACT = 'conAAAA0001', DEAL1 = 'oppAAAA0001', DEAL2 = 'oppBBBB0002';
const gate = () => { let open; const p = new Promise((r) => { open = r; }); return { p, open }; };

async function main() {
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const { chromium } = require('playwright');
  let swapped = 0;
  const before = {
    name: 'b15-25-r4-before', enforce: 'pre',
    transform(code, id) {
      if (!BEFORE) return null;
      const file = path.resolve(id.split('?')[0]);
      if (file === PANEL) { swapped++; return show('src/components/DealCalculationSavePanel.tsx'); }
      if (file === PAGE) { swapped++; return show('src/pages/DealCalculator.tsx'); }
      return null;
    },
  };
  const server = await createServer({
    root: APP, configFile: false, plugins: [before, react()], logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: ['scripts/harness/deal-calculation-save/index.html', 'scripts/harness/deal-calculation-panel/index.html'],
      include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] },
  });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const exit = async (code) => { await browser.close().catch(() => {}); await server.close().catch(() => {}); process.exit(code); };

  const state = { notes: [], deals: [DEAL1], oppFields: [], writeMode: 'ok', holdOpp: null };
  const writes = [], foreign = [], unmodelled = [];
  let noteSeq = 0;
  const pageErrorsAll = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1100 }, timezoneId: 'America/Chicago' });
    const pageErrors = pageErrorsAll;
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.route('**/*', async (route) => {
      const req = route.request(); const url = req.url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { foreign.push(url); return route.abort(); }
      const u = new URL(url); const fn = u.pathname.replace('/.netlify/functions/', '');
      const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }).catch(() => {});
      if (fn === 'ghl-underwriting-policy') return json(200, { values: [] });
      if (fn === 'ghl-opportunities') return json(200, { pipelineId: 'pipe', stages: [], opportunities: state.deals.map((id) => ({ id, contactId: CONTACT, contactName: 'Kay Fixture', opportunityName: id === DEAL1 ? 'Deal 1' : 'Deal 2', phone: '', email: '', stageId: 's', customFields: [] })) });
      if (fn === 'ghl-proxy') {
        const p = u.searchParams.get('path');
        if (p === `/contacts/${CONTACT}`) return json(200, { contact: { id: CONTACT, firstName: 'Kay', lastName: 'Fixture', customFields: [] } });
        if (p === `/contacts/${CONTACT}/notes`) return json(200, { notes: state.notes });
        if (p === `/opportunities/${DEAL1}` || p === `/opportunities/${DEAL2}`) {
          const id = p.split('/')[2];
          if (state.holdOpp && state.holdOpp.id === id && !state.holdOpp.used) { state.holdOpp.used = true; state.holdOpp.hit.open(); await state.holdOpp.gate.p; }
          return json(200, { opportunity: { id, contactId: CONTACT, customFields: state.oppFields } });
        }
      }
      if (fn === 'ghl-write' && req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}'); writes.push(body);
        if (state.writeMode === 'refuse') return json(409, { error: 'Write refused or unconfirmed; refresh and inspect before retrying' });
        if (body.operation === 'note.create') state.notes.push({ id: 'note-' + (++noteSeq), body: body.args.body, dateAdded: new Date().toISOString() });
        if (state.writeMode === 'lost') return json(500, { error: 'fixture: the response was lost' });
        return json(200, { id: 'note-' + noteSeq, confirmed: true });
      }
      unmodelled.push(fn + ' ' + req.method()); return json(404, { error: 'fixture does not model ' + fn });
    });
    const T = (id) => page.getByTestId(id);
    const until = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await page.waitForTimeout(50); } return false; };
    const visible = async (id) => (await T(id).count()) > 0 && (await T(id).first().isVisible());
    const stateOf = () => T('deal-calc-save-status').getAttribute('data-state');
    const waitState = (s) => until(async () => (await stateOf()) === s);
    const linked = async () => { await page.goto(`${base}/scripts/harness/deal-calculation-save/index.html?contactId=${CONTACT}`); await T('deal-calc-arv-input').waitFor({ timeout: 60000 }); };
    const signIn = (sub) => page.evaluate(async (s) => {
      const m = await import('/src/lib/app-write-session.ts');
      const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
      m.setAppWriteSession({ token: b64({ alg: 'none' }) + '.' + b64({ sub: s }) + '.x', expiresAt: new Date(Date.now() + 3600_000).toISOString() });
    }, sub);
    const chooseDeal = async (id) => {
      if (await visible('deal-calc-deal-select')) await T('deal-calc-deal-select').selectOption(id);
      await until(async () => (await T('deal-calc-save-calculation').count()) > 0 && !(await T('deal-calc-save-calculation').isDisabled()));
    };
    const keptArv = (deal) => page.evaluate((d) => Object.keys(localStorage).filter((k) => k.includes('|' + d)).map((k) => JSON.parse(localStorage.getItem(k)).fields.arv?.value ?? null), deal);
    const arv = () => T('deal-calc-arv-input').inputValue();
    /** A fresh scenario: empty fake GHL and browser storage, the page loaded and linked, operator `op`. */
    const fresh = async ({ deals = [DEAL1], op = 'op-a' } = {}) => {
      state.notes = []; state.deals = deals; state.writeMode = 'ok'; state.holdOpp = null; writes.length = 0;
      await linked();
      await page.evaluate(() => { try { localStorage.clear(); } catch { /* none */ } });
      await linked();
      await signIn(op); await page.waitForTimeout(300);
    };
    const holdPreflight = (id = DEAL1) => { state.holdOpp = { id, gate: gate(), hit: gate(), used: false }; return state.holdOpp; };
    const sends = () => writes.filter((w) => w.operation === 'note.create');
    const saveOk = async (value) => {
      await T('deal-calc-arv-input').fill(String(value));
      const n = sends().length;
      await T('deal-calc-save-calculation').click();
      await until(async () => sends().length === n + 1 && (await stateOf()) === 'saved');
    };
    const loadItem = async (i = 0) => { await until(async () => (await T('deal-calc-saved-list').count()) > 0); await T('deal-calc-load-' + i).click(); await page.waitForTimeout(300); };
    const asked = () => visible('deal-calc-load-confirm-box');

    // ── P1 (P2-1) ──
    // S1 operator change while the save's evidence read is held
    await fresh(); await chooseDeal(DEAL1);
    await T('deal-calc-arv-input').fill('333000');
    let h = holdPreflight();
    await T('deal-calc-save-calculation').click();
    await h.hit.p;
    await signIn('op-b'); await page.waitForTimeout(400);
    await chooseDeal(DEAL1);
    await T('deal-calc-arv-input').fill('444000');
    h.gate.open(); await page.waitForTimeout(1200);
    check('S1 operator changes while A\'s save waits on its read: nothing is sent (not A\'s 333000, not anything)', sends().length === 0, sends().map((w) => w.args.body.match(/ARV input: \d+/)?.[0]));
    // S2 the contact is unlinked (the panel unmounts)
    await fresh(); await chooseDeal(DEAL1);
    await T('deal-calc-arv-input').fill('335000');
    h = holdPreflight();
    await T('deal-calc-save-calculation').click();
    await h.hit.p;
    await T('deal-calc-unlink').click(); await page.waitForTimeout(300);
    h.gate.open(); await page.waitForTimeout(1200);
    check('S2 the contact is unlinked while the save waits on its read: nothing is sent', sends().length === 0, sends().length);
    // S3 the deal changes
    await fresh({ deals: [DEAL1, DEAL2] }); await chooseDeal(DEAL1);
    await T('deal-calc-arv-input').fill('336000');
    h = holdPreflight(DEAL1);
    await T('deal-calc-save-calculation').click();
    await h.hit.p;
    await T('deal-calc-deal-select').selectOption(DEAL2); await page.waitForTimeout(300);
    h.gate.open(); await page.waitForTimeout(1200);
    check('S3 the deal changes while the save waits on its read: nothing is sent', sends().length === 0, sends().length);
    // S4 positive: nothing changes -> the held save is sent once
    await fresh(); await chooseDeal(DEAL1);
    await T('deal-calc-arv-input').fill('337000');
    h = holdPreflight();
    await T('deal-calc-save-calculation').click();
    await h.hit.p;
    h.gate.open();
    await waitState('saved');
    check('S4 with nothing changed, the held save is sent exactly once when its read returns', sends().length === 1 && /ARV input: 337000/.test(sends()[0].args.body));
    // S5 a Resend waiting on its read, then the operator changes
    await fresh(); await chooseDeal(DEAL1);
    state.writeMode = 'refuse';
    await T('deal-calc-arv-input').fill('338000');
    await T('deal-calc-save-calculation').click();
    await waitState('unconfirmed');
    await T('deal-calc-unconfirmed-check').click();
    await until(async () => visible('deal-calc-unconfirmed-resend'));
    state.writeMode = 'ok';
    const n5 = sends().length;
    h = holdPreflight();
    await T('deal-calc-unconfirmed-resend').click();
    await h.hit.p;
    await signIn('op-c'); await page.waitForTimeout(400);
    h.gate.open(); await page.waitForTimeout(1200);
    check('S5 a Resend waiting on its read sends nothing once the operator has changed', sends().length === n5, sends().length - n5);

    // ── P2 (P2-2) ──
    // S6 reload -> restored draft -> Load asks; Keep mine; Replace
    await fresh(); await chooseDeal(DEAL1);
    await saveOk(250000);
    await T('deal-calc-arv-input').fill('333000');   // unsaved, kept in this browser
    await page.waitForTimeout(400);
    await linked(); await signIn('op-a'); await chooseDeal(DEAL1);
    await until(async () => (await arv()) === '333000');
    check('S6 after a reload the unsaved 333000 is restored from this browser', (await arv()) === '333000');
    await loadItem(0);
    check('S6 Load over the RESTORED draft asks first and changes nothing yet', (await asked()) && (await arv()) === '333000', { asked: await asked(), arv: await arv() });
    if (await asked()) await T('deal-calc-load-cancel').click();   // Keep mine
    await page.waitForTimeout(400);
    check('S6 Keep mine keeps the restored figures on screen and in this browser', (await arv()) === '333000' && (await keptArv(DEAL1)).map(String).includes('333000'), { arv: await arv(), kept: await keptArv(DEAL1) });
    await loadItem(0);
    if (await asked()) await T('deal-calc-load-confirm').click();
    await page.waitForTimeout(500);
    check('S6 Replace loads the saved 250000, on screen and as this deal\'s kept draft', (await arv()) === '250000' && (await keptArv(DEAL1)).map(String).includes('250000'), { arv: await arv(), kept: await keptArv(DEAL1) });
    check('S6 loading wrote nothing', sends().length === 1);
    // S7 operator restore
    await fresh(); await chooseDeal(DEAL1);
    await saveOk(250000);
    await T('deal-calc-arv-input').fill('336500');
    await page.waitForTimeout(400);
    await signIn('op-b'); await page.waitForTimeout(400); await chooseDeal(DEAL1);
    await signIn('op-a'); await page.waitForTimeout(400); await chooseDeal(DEAL1);
    await until(async () => (await arv()) === '336500');
    await loadItem(0);
    check('S7 back to operator A, A\'s restored unsaved draft is not replaced without asking', (await asked()) && (await arv()) === '336500', { asked: await asked(), arv: await arv() });
    // S8 deal restore
    await fresh({ deals: [DEAL1, DEAL2] }); await chooseDeal(DEAL1);
    await saveOk(250000);
    await T('deal-calc-arv-input').fill('337500');
    await page.waitForTimeout(400);
    await T('deal-calc-deal-select').selectOption(DEAL2); await page.waitForTimeout(300);
    await chooseDeal(DEAL1);
    await until(async () => (await arv()) === '337500');
    await loadItem(0);
    check('S8 back on deal 1, its restored unsaved draft is not replaced without asking', (await asked()) && (await arv()) === '337500', { asked: await asked(), arv: await arv() });
    // S9 positives: a genuinely clean form, and restored figures that ARE a saved calculation, load directly
    await fresh(); await chooseDeal(DEAL1);
    await saveOk(250000);
    await saveOk(260000);
    await linked(); await page.evaluate(() => { try { localStorage.clear(); } catch { /* none */ } }); await linked(); await signIn('op-a'); await chooseDeal(DEAL1);
    await loadItem(1);
    check('S9 Load over a genuinely clean form replaces directly (no prompt)', !(await asked()) && (await arv()) === '250000', { asked: await asked(), arv: await arv() });
    await linked(); await signIn('op-a'); await chooseDeal(DEAL1);
    await until(async () => (await arv()) === '250000');
    await loadItem(0);
    check('S9 restored figures that ARE a saved calculation load another directly (no prompt)', !(await asked()) && (await arv()) === '260000', { asked: await asked(), arv: await arv() });
    // S10 reconcile (found) while newer figures were typed
    await fresh(); await chooseDeal(DEAL1);
    await saveOk(250000);
    state.writeMode = 'lost';
    await T('deal-calc-arv-input').fill('281000');
    await T('deal-calc-save-calculation').click();
    await waitState('unconfirmed');
    state.writeMode = 'ok';
    await T('deal-calc-arv-input').fill('282000');
    await T('deal-calc-unconfirmed-check').click();
    await waitState('saved');
    await loadItem(1);
    check('S10 after the unconfirmed 281000 is found, the newer 282000 is still unsaved: Load asks', (await asked()) && (await arv()) === '282000', { asked: await asked(), arv: await arv() });
    // S10b resend confirmed while newer figures were typed
    await fresh(); await chooseDeal(DEAL1);
    await saveOk(250000);
    state.writeMode = 'refuse';
    await T('deal-calc-arv-input').fill('283000');
    await T('deal-calc-save-calculation').click();
    await waitState('unconfirmed');
    await T('deal-calc-unconfirmed-check').click();
    await until(async () => visible('deal-calc-unconfirmed-resend'));
    state.writeMode = 'ok';
    await T('deal-calc-arv-input').fill('284000');
    await T('deal-calc-unconfirmed-resend').click();
    await waitState('saved');
    await loadItem(1);
    check('S10b after the resent 283000 is confirmed, the newer 284000 is still unsaved: Load asks', (await asked()) && (await arv()) === '284000', { asked: await asked(), arv: await arv() });
    check('S10b the resend sent exactly the 283000 note (never the newer figures)', sends().every((w) => !/ARV input: 284000/.test(w.args.body)));
    // S11 positive: after a confirmed save, new typing asks
    await fresh(); await chooseDeal(DEAL1);
    await saveOk(250000);
    await saveOk(285000);
    await T('deal-calc-arv-input').fill('286000');
    await page.waitForTimeout(300);
    await loadItem(1);
    check('S11 after a confirmed save, new typing is unsaved: Load asks', (await asked()) && (await arv()) === '286000');

    // S12 (component, Bones's own case): the panel MOUNTS with restored, unsaved figures already on screen.
    const panelUrl = (arv, unsaved) => `${base}/scripts/harness/deal-calculation-panel/index.html?contactId=${CONTACT}&deal=${DEAL1}&arv=${arv}&unsaved=${unsaved}`;
    state.notes = []; state.deals = [DEAL1]; state.writeMode = 'ok'; state.holdOpp = null; writes.length = 0;
    await page.goto(panelUrl('333000', 1));
    await page.waitForFunction(() => !!window.__dealCalc, null, { timeout: 60000 });
    const savedBody = await page.evaluate((c) => window.__dealCalc.format(c), { opportunityId: DEAL1, saved: '2026-11-04T12:00:00.000Z', operator: 'brad', supersedes: null,
      propertyIdentity: null, arvInput: 250000, repairsQuick: null, testPrice: null, assignmentMode: 'standard', manualAmount: null, basis: { arv: null, repairs: null, currentOffer: null } });
    state.notes.push({ id: 'note-saved-250', body: savedBody, dateAdded: '2026-11-04T12:00:00.000Z' });
    const hostArv = () => T('panel-host-arv').innerText();
    await page.goto(panelUrl('333000', 1));
    await until(async () => (await T('deal-calc-load-0').count()) > 0);
    await T('deal-calc-load-0').click(); await page.waitForTimeout(300);
    check('S12 a panel mounted with RESTORED unsaved figures asks before Load replaces them', (await asked()) && (await hostArv()) === '333000', { asked: await asked(), arv: await hostArv() });
    if (await asked()) await T('deal-calc-load-cancel').click();
    await page.waitForTimeout(200);
    check('S12 Keep mine keeps the restored 333000', (await hostArv()) === '333000');
    await T('deal-calc-load-0').click(); await page.waitForTimeout(300);
    if (await asked()) await T('deal-calc-load-confirm').click();
    await page.waitForTimeout(300);
    check('S12 Replace loads the saved 250000', (await hostArv()) === '250000');
    await page.goto(panelUrl('', 0));
    await until(async () => (await T('deal-calc-load-0').count()) > 0);
    await T('deal-calc-load-0').click(); await page.waitForTimeout(300);
    check('S12 positive: a panel mounted on a genuinely clean form loads directly', !(await asked()) && (await hostArv()) === '250000', { asked: await asked(), arv: await hostArv() });
    check('S12 loading wrote nothing', sends().length === 0);

    check('every write was note.create (no other GHL write)', writes.every((w) => w.operation === 'note.create'), writes.map((w) => w.operation));
    check('no page errors, no foreign or unmodelled requests', pageErrors.length === 0 && foreign.length === 0 && unmodelled.length === 0, { pageErrors, foreign, unmodelled });
  } catch (e) {
    failures += 1; console.error('FAIL  run aborted: ' + (e && e.stack || e) + ' | page errors: ' + JSON.stringify(pageErrorsAll.slice(0, 3)));
  }
  console.log('');
  console.log('checksRun=' + checks + ' failures=' + failures + ' floor=' + FLOOR + (BEFORE ? ` before=${BEFORE} swapped=${swapped}` : ''));
  if (BEFORE && swapped < 2) { console.error('ABORT: the before files were not served'); return exit(2); }
  if (checks !== FLOOR) { console.error('FAILED: expected exactly ' + FLOOR + ' checks, ran ' + checks); return exit(failures ? 1 : 2); }
  if (failures > 0) { console.error('FAILED'); return exit(1); }
  console.log('OK'); return exit(0);
}
main();
