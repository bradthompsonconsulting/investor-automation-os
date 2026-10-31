/**
 * B15-25 Phase 2 (INV-133) -- "Save Calculation to Deal" / "Load Saved Calculation" on the REAL Deal
 * Calculator page, offline. Jess RULING 2026-10-30, Captain approved P2-1..P2-5.
 *
 *   node scripts/test-deal-calculation-save.cjs                   the suite (exact FLOOR)
 *   node scripts/test-deal-calculation-save.cjs --mutate=<name>   a page negative control (in-memory Vite
 *                                                                 transform of DealCalculationSavePanel.tsx);
 *                                                                 the run must FAIL
 *
 * Vite serves scripts/harness/deal-calculation-save, which renders the real page in headless Chromium. Every
 * /.netlify/functions request is answered here from a fake GHL state; any other request is aborted and counted.
 * Proves: no panel unlinked; one deal auto-selects, two need a choice (PB-D55); typing and navigation send
 * nothing; one click sends exactly one note.create with a v1 carrier and nothing else; a newer saved calculation
 * blocks the save (nothing sent) and offers Load Newer / Save as New; Load asks before replacing unsaved figures;
 * an unreadable notes read is never shown as "none"; staleness is flagged; itemized repairs are not saved; a
 * server refusal says nothing was saved.
 */
'use strict';
const path = require('node:path');
const APP = path.resolve(__dirname, '..');
const PANEL = path.join(APP, 'src', 'components', 'DealCalculationSavePanel.tsx');

const MUTATIONS = {
  autosave: { from: '  const dirty = !sameFigures(figures, clean);', to: '  const dirty = !sameFigures(figures, clean);\n  useEffect(() => { if (selected && figures.arvInput !== "") void handleSave(); }, [figures.arvInput]);' },
  overwrite: { from: '=== "newer_calculation_exists" && fresh.latest)', to: '=== "never_refused" && fresh.latest)' },
  'double-write': { from: '      await ghl.notes.create(contactId, formatDealCalculationNote(calc));', to: '      await ghl.notes.create(contactId, formatDealCalculationNote(calc));\n      await ghl.notes.create(contactId, formatDealCalculationNote({ ...calc, saved: new Date(Date.now() + 5).toISOString() }));' },
  'current-offer': { from: '      await ghl.notes.create(contactId, formatDealCalculationNote(calc));', to: '      await ghl.notes.create(contactId, formatDealCalculationNote(calc));\n      await (await import("../lib/write-command")).writeCommand("opportunity.currentOffer", selected.id, { value: 1 });' },
};
const mutateArg = process.argv.find((a) => a.startsWith('--mutate='));
const mutationName = mutateArg ? mutateArg.slice('--mutate='.length) : null;
const mutation = mutationName ? MUTATIONS[mutationName] : null;
if (mutationName && !mutation) { console.error('ABORT: unknown mutation ' + mutationName + '; known: ' + Object.keys(MUTATIONS).join(', ')); process.exit(2); }
let mutationApplied = 0;

const FLOOR = 24;
let checks = 0, failures = 0;
function check(name, ok, detail) {
  checks += 1; if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}

const CONTACT = 'conAAAA0001', DEAL1 = 'oppAAAA0001', DEAL2 = 'oppBBBB0002';

async function main() {
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const { chromium } = require('playwright');
  const mutate = {
    name: 'b15-25-page-mutation', enforce: 'pre',
    transform(code, id) {
      if (!mutation || path.resolve(id.split('?')[0]) !== PANEL) return null;
      const src = code.replace(/\r\n/g, '\n'); const n = src.split(mutation.from).length - 1;
      if (n !== 1) throw new Error('mutation anchor occurs ' + n + ' times');
      mutationApplied++; return src.replace(mutation.from, () => mutation.to);
    },
  };
  const server = await createServer({
    root: APP, configFile: false, plugins: [mutate, react()], logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: ['scripts/harness/deal-calculation-save/index.html'],
      include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] },
  });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const exit = async (code) => { await browser.close().catch(() => {}); await server.close().catch(() => {}); process.exit(code); };

  /* Fake GHL. `arvField` is read from the projected runtime config inside the page. */
  const state = { notes: [], deals: [DEAL1], oppFields: [], notesFail: false, writeStatus: 200 };
  const writes = [], foreign = [], unmodelled = [];
  let noteSeq = 0;
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, timezoneId: 'America/Chicago' });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.route('**/*', async (route) => {
      const req = route.request(); const url = req.url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { foreign.push(url); return route.abort(); }
      const u = new URL(url); const fn = u.pathname.replace('/.netlify/functions/', '');
      const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (fn === 'ghl-underwriting-policy') return json(200, { values: [] });
      if (fn === 'ghl-opportunities') return json(200, { pipelineId: 'pipe', stages: [], opportunities: state.deals.map((id) => ({ id, contactId: CONTACT, contactName: 'Kay Fixture', opportunityName: 'Deal ' + id.slice(-1), phone: '', email: '', stageId: 's1', customFields: [] })) });
      if (fn === 'ghl-proxy') {
        const p = u.searchParams.get('path');
        if (p === `/contacts/${CONTACT}`) return json(200, { contact: { id: CONTACT, firstName: 'Kay', lastName: 'Fixture', customFields: [] } });
        if (p === `/contacts/${CONTACT}/notes`) return state.notesFail ? json(500, { error: 'fixture notes failure' }) : json(200, { notes: state.notes });
        if (p === `/opportunities/${DEAL1}` || p === `/opportunities/${DEAL2}`) return json(200, { opportunity: { id: p.split('/')[2], contactId: CONTACT, customFields: state.oppFields } });
      }
      if (fn === 'ghl-write' && req.method() === 'POST') {
        const body = JSON.parse(req.postData() || '{}'); writes.push(body);
        if (state.writeStatus !== 200) return json(state.writeStatus, { error: 'Write refused or unconfirmed; refresh and inspect before retrying' });
        if (body.operation === 'note.create') state.notes.push({ id: 'note-' + (++noteSeq), body: body.args.body, dateAdded: new Date().toISOString() });
        return json(200, { id: 'note-' + noteSeq, confirmed: true });
      }
      unmodelled.push(fn + ' ' + req.method()); return json(404, { error: 'fixture does not model ' + fn });
    });
    const T = (id) => page.getByTestId(id);
    const until = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await page.waitForTimeout(50); } return false; };
    const parse = (body) => page.evaluate((b) => window.__dealCalc.parse(b), body);
    const format = (c) => page.evaluate((x) => window.__dealCalc.format(x), c);
    const visible = async (id) => (await T(id).count()) > 0 && (await T(id).first().isVisible());

    // 1 -- unlinked: no panel, no write.
    await page.goto(`${base}/scripts/harness/deal-calculation-save/index.html`);
    await T('deal-calc-arv-input').waitFor({ timeout: 60000 });
    check('1 unlinked page shows no Save panel', (await T('deal-calc-save-panel').count()) === 0);

    // 2 -- linked, one deal: auto-selected; empty list.
    await page.goto(`${base}/scripts/harness/deal-calculation-save/index.html?contactId=${CONTACT}`);
    await T('deal-calc-save-panel').waitFor({ timeout: 60000 });
    await T('deal-calc-saved-empty').waitFor({ timeout: 15000 });
    check('2 a single deal is auto-selected (PB-D55) and the empty list says so', (await visible('deal-calc-deal-selected')) && (await visible('deal-calc-saved-empty')) && (await T('deal-calc-deal-select').count()) === 0);

    // 3 -- typing and navigation send nothing.
    await T('deal-calc-arv-input').fill('250000');
    await T('deal-calc-repairs-quick-input').fill('30000');
    await T('deal-calc-test-price-input').fill('150000');
    await T('deal-calc-more-detail-toggle').click(); await T('deal-calc-more-detail-toggle').click();
    await page.waitForTimeout(400);
    check('3 typing figures and toggling panels sends no write (no autosave)', writes.length === 0, writes);

    // 4-7 -- one click, one note.create with a v1 carrier and nothing else.
    await T('deal-calc-save-calculation').click();
    await until(async () => (await T('deal-calc-save-status').getAttribute('data-state')) === 'saved');
    check('4 Save sends exactly one write request', writes.length === 1, writes.map((w) => w.operation));
    check('5 that write is note.create on the linked contact', writes[0]?.operation === 'note.create' && writes[0]?.targetId === CONTACT);
    const first = writes[0] ? await parse(writes[0].args.body) : null;
    check('6 its body is a v1 Deal Calculation carrier for the selected deal with these figures', !!first && first.opportunityId === DEAL1 && first.arvInput === 250000 && first.repairsQuick === 30000 && first.testPrice === 150000 && first.supersedes === null, first);
    check('7 the status says saved -- working calculation, not an approval', /not an approval/.test(await T('deal-calc-save-status').innerText()));
    await T('deal-calc-saved-item-0').waitFor({ timeout: 15000 });
    check('8 the saved calculation is listed as the latest', /\(latest\)/.test(await T('deal-calc-saved-item-0').innerText()));

    // 9-12 -- a newer saved calculation (another session) blocks the save; nothing sent; choices offered.
    const newerSaved = new Date(Date.now() + 2000).toISOString();
    state.notes.push({ id: 'note-x', body: await format({ ...first, saved: newerSaved, supersedes: first.saved, arvInput: 275000 }), dateAdded: newerSaved });
    await page.waitForTimeout(2100);
    await T('deal-calc-arv-input').fill('260000');
    const before = writes.length;
    await T('deal-calc-save-calculation').click();
    await until(async () => (await T('deal-calc-save-status').getAttribute('data-state')) === 'newer');
    check('9 a stale save is blocked: nothing is sent', writes.length === before, writes.slice(before).map((w) => w.operation));
    check('10 it offers Load Newer and Save as New', (await visible('deal-calc-newer-load')) && (await visible('deal-calc-save-as-new')));
    await T('deal-calc-save-as-new').click();
    await until(async () => (await T('deal-calc-save-status').getAttribute('data-state')) === 'saved');
    const asNew = writes[before] ? await parse(writes[before].args.body) : null;
    check('11 Save as New sends one new note that supersedes the newer calculation (no overwrite)', writes.length === before + 1 && !!asNew && asNew.supersedes === newerSaved && asNew.arvInput === 260000, asNew);
    check('12 every write so far is note.create (no ARV, repairs, Current Offer, underwriting or stage write)', writes.every((w) => w.operation === 'note.create'), writes.map((w) => w.operation));

    // 13-16 -- Load asks before replacing unsaved figures.
    await page.waitForTimeout(300);
    await T('deal-calc-arv-input').fill('199000');
    const items = await T('deal-calc-saved-list').locator('[data-testid^="deal-calc-saved-item-"]').count();
    await T(`deal-calc-load-${items - 1}`).click();
    check('13 Load over unsaved figures asks first and changes nothing yet', (await visible('deal-calc-load-confirm-box')) && (await T('deal-calc-arv-input').inputValue()) === '199000');
    await T('deal-calc-load-cancel').click();
    check('14 Keep mine leaves the figures as typed', (await T('deal-calc-arv-input').inputValue()) === '199000' && !(await visible('deal-calc-load-confirm-box')));
    await T(`deal-calc-load-${items - 1}`).click(); await T('deal-calc-load-confirm').click();
    check('15 Replace loads the saved figures and labels them not approved', (await T('deal-calc-arv-input').inputValue()) === '250000' && /not approved/.test(await T('deal-calc-loaded-from').innerText()));
    await T('deal-calc-load-0').click();
    check('16 Load over a clean form replaces directly (no prompt)', !(await visible('deal-calc-load-confirm-box')) && (await T('deal-calc-arv-input').inputValue()) === '260000');
    check('17 loading wrote nothing', writes.length === before + 1);

    // 18 -- staleness: approved ARV changed on the deal after the saves.
    const arvId = await page.evaluate(() => window.__dealCalc.arvField);
    state.oppFields = [{ id: arvId, fieldValue: 300000 }];
    await page.goto(`${base}/scripts/harness/deal-calculation-save/index.html?contactId=${CONTACT}`);
    await T('deal-calc-saved-item-0').waitFor({ timeout: 30000 });
    check('18 a calculation saved before an approved-ARV change is flagged', (await T('deal-calc-stale-arv-0').count()) === 1);

    // 19 -- itemized repairs are not saved in this phase.
    await T('deal-calc-repairs-mode-toggle').click();
    const b19 = writes.length;
    await T('deal-calc-save-calculation').click();
    await until(async () => (await T('deal-calc-save-status').getAttribute('data-state')) === 'refused');
    check('19 itemized mode: Save refuses with nothing sent', writes.length === b19 && /Itemized repairs are not saved yet/.test(await T('deal-calc-save-status').innerText()));
    await T('deal-calc-repairs-mode-toggle').click();

    // 20 -- a server refusal says nothing was saved.
    state.writeStatus = 409;
    await T('deal-calc-arv-input').fill('261000');
    await T('deal-calc-save-calculation').click();
    await until(async () => (await T('deal-calc-save-status').getAttribute('data-state')) === 'refused');
    check('20 a server refusal is shown with "Nothing was saved"', /Nothing was saved/.test(await T('deal-calc-save-status').innerText()));
    state.writeStatus = 200;

    // 21 -- an unreadable notes read is never shown as "none".
    state.notesFail = true;
    await page.goto(`${base}/scripts/harness/deal-calculation-save/index.html?contactId=${CONTACT}`);
    await T('deal-calc-saved-read-error').waitFor({ timeout: 30000 });
    check('21 a notes read failure shows "could not be read", never the empty list', (await T('deal-calc-saved-empty').count()) === 0);
    state.notesFail = false;

    // 22 -- two deals need an explicit choice.
    state.deals = [DEAL1, DEAL2];
    await page.goto(`${base}/scripts/harness/deal-calculation-save/index.html?contactId=${CONTACT}`);
    await T('deal-calc-deal-select').waitFor({ timeout: 30000 });
    check('22 two deals: no Save until a deal is chosen (PB-D55)', (await T('deal-calc-save-calculation').count()) === 0);
    await T('deal-calc-deal-select').selectOption(DEAL2);
    await T('deal-calc-save-calculation').waitFor({ timeout: 15000 });
    check('23 after choosing, Save is offered for that deal', /Deal 2/.test(await T('deal-calc-deal-selected').innerText()));

    check('24 no page errors, no foreign or unmodelled requests', pageErrors.length === 0 && foreign.length === 0 && unmodelled.length === 0, { pageErrors, foreign, unmodelled });
  } catch (e) {
    failures += 1; console.error('FAIL  run aborted: ' + (e && e.stack || e));
  }
  console.log('');
  console.log('checksRun=' + checks + ' failures=' + failures + ' floor=' + FLOOR + (mutation ? ' mutation=' + mutationName + ' applied=' + mutationApplied : ''));
  if (mutation && mutationApplied < 1) { console.error('ABORT: the mutation was not applied'); return exit(2); }
  if (checks !== FLOOR) { console.error('FAILED: expected exactly ' + FLOOR + ' checks, ran ' + checks); return exit(failures ? 1 : 2); }
  if (failures > 0) { console.error('FAILED'); return exit(1); }
  console.log('OK'); return exit(0);
}
main();
