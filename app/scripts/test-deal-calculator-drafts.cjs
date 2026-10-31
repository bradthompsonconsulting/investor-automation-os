/**
 * B15-25 (INV-133) Phase 1 -- the REAL Deal Calculator page (scripts/harness/deal-calculator) keeps its
 * figures and modes in this browser. Offline: every /.netlify/functions request is answered here from
 * synthetic fixtures (policy, contact detail via ghl-proxy, pipeline); anything else is aborted and recorded.
 *
 * Covers Jess's GO (2026-10-30): works without a contact; figures and modes survive navigation and reload;
 * unlinked scratch work is kept apart from deal drafts; a linked deal's draft is its own (per deal, same
 * contact or not); contact seeds are GHL evidence, never drafts, and never overwrite a kept value; a seed
 * changed under a draft shows both and overwrites neither (Keep My Draft / Use GHL); an unparsable seed is
 * unchecked with the choices disabled; Not saved to GHL everywhere; storage failures said plainly; no write.
 *
 * Vite binds 127.0.0.1 on Scotty's range 5180-5189 with strictPort (first free port).
 *
 * NEGATIVE CONTROLS: `--mutate=<name>` (scripts/harness/calculator-drafts/mutations.cjs) renders the page
 * with a mutant of the draft module or of the page itself; every mutant must FAIL (exit 1).
 */
const path = require('node:path');
const { writeMutant, removeMutants } = require('./harness/calculator-drafts/mutations.cjs');

const APP = path.resolve(__dirname, '..');
const PAGE = '/scripts/harness/deal-calculator/index.html';
const mutateArg = process.argv.find((a) => a.startsWith('--mutate='));
const MUTATE = mutateArg ? mutateArg.slice('--mutate='.length) : null;

/** Taken from the finished file: 21 check() call sites. */
const FLOOR = 21;
let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}

removeMutants();
let mutant = null;
if (MUTATE) {
  try { mutant = writeMutant(MUTATE); } catch (e) { console.error(`FAILED: ${e.message}; nothing rendered.`); process.exit(2); }
  console.log(`NEGATIVE CONTROL: rendering the calculator with --mutate=${MUTATE}; this run must fail.`);
}

const ENV = 'SoTgVoaFGHtBdRFvXWQV';                       // Test location (harness runs the Test config)
const ARV_ID = 'QkWl09I9yXGz8OIcs5Xd', REP_ID = 'SU4n8ylrXnUm8xDi729R';
const SCRATCH_KEY = `iaos-calculator-draft:v1:scratch|${ENV}|this-browser`;
const fixture = {
  contacts: { 'c-kay': { arv: '310000', rep: '20000' }, 'c-two': {}, 'c-none': {} },
  opportunities: [
    { id: 'o-kay-1', contactId: 'c-kay', contactName: 'Kay Fixture', opportunityName: 'Kay -- 2623 Greenway', phone: '', email: '', stageId: 's1', customFields: [] },
    { id: 'o-two-1', contactId: 'c-two', contactName: 'Two Deals', opportunityName: 'Two -- Oak Ln', phone: '', email: '', stageId: 's1', customFields: [] },
    { id: 'o-two-2', contactId: 'c-two', contactName: 'Two Deals', opportunityName: 'Two -- Elm St', phone: '', email: '', stageId: 's1', customFields: [] },
  ],
  pipelineFails: false,
};
const watchdog = setTimeout(() => { console.error('FAIL  the suite did not finish within 8 minutes -- stopped'); process.exit(1); }, 8 * 60_000);

async function listen(createServer, react) {
  const alias = [];
  if (mutant && mutant.kind === 'model') alias.push({ find: /^\.\.\/lib\/calculator-drafts$/, replacement: mutant.file });
  if (mutant && mutant.kind === 'page') alias.push({ find: /^\.\.\/\.\.\/\.\.\/src\/pages\/DealCalculator$/, replacement: mutant.file });
  for (let port = 5180; port <= 5189; port += 1) {
    const server = await createServer({
      root: APP, configFile: false, plugins: [react()], logLevel: 'error', clearScreen: false, resolve: { alias },
      server: { host: '127.0.0.1', port, strictPort: true, hmr: false },
      optimizeDeps: { entries: [PAGE.slice(1)], include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] },
    });
    try { await server.listen(); return server; } catch { await server.close().catch(() => {}); }
  }
  throw new Error('no free port in 5180-5189');
}

async function main() {
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const { chromium } = require('playwright');
  const server = await listen(createServer, react);
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const exit = async (code) => { clearTimeout(watchdog); await browser.close().catch(() => {}); await server.close().catch(() => {}); removeMutants(); process.exit(code); };
  const requests = [];
  const foreign = [];
  const pageErrors = [];
  const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const open = async (init) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, timezoneId: 'America/Chicago' });
    if (init) await context.addInitScript(init);
    await context.route('**/*', async (route) => {
      const r = route.request(); const url = r.url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { foreign.push(`${r.method()} ${url}`); return route.abort(); }
      const u = new URL(url); const fn = u.pathname.replace('/.netlify/functions/', '');
      requests.push({ fn, method: r.method(), path: u.searchParams.get('path') });
      if (r.method() !== 'GET') return json(route, 405, { error: 'fixture: only reads are modelled' });
      if (fn === 'ghl-underwriting-policy') return json(route, 200, { values: [] });
      if (fn === 'ghl-opportunities') return fixture.pipelineFails ? json(route, 500, { error: 'fixture: pipeline down' }) : json(route, 200, { pipelineId: 'p1', stages: [], opportunities: fixture.opportunities });
      const m = fn === 'ghl-proxy' && /^\/contacts\/([^/]+)$/.exec(u.searchParams.get('path') || '');
      if (m && fixture.contacts[m[1]]) {
        const c = fixture.contacts[m[1]];
        const customFields = [];
        if (c.arv !== undefined) customFields.push({ id: ARV_ID, value: c.arv });
        if (c.rep !== undefined) customFields.push({ id: REP_ID, value: c.rep });
        return json(route, 200, { contact: { id: m[1], firstName: m[1], lastName: '', customFields } });
      }
      return json(route, 404, { error: `fixture does not model ${fn}` });
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    return { context, page };
  };

  try {
    const { page } = await open();
    const T = (id) => page.getByTestId(id);
    const settle = () => page.waitForTimeout(250);
    const go = async (q = '') => {
      await page.goto(`${base}${PAGE}${q ? `?${q}` : ''}`);
      await T('deal-calc-repairs-mode-toggle').waitFor({ timeout: 60000 });
      if (q.includes('contactId=')) await page.waitForFunction(() => !/Linking the contact/.test(document.querySelector('[data-testid="deal-calc-draft-status"]')?.textContent || ''), null, { timeout: 15000 });
      await settle();
    };
    const val = async (id) => ((await T(id).count()) ? T(id).inputValue() : null);
    const txt = async (id) => ((await T(id).count()) ? (await T(id).innerText()).trim() : null);
    const status = () => txt('deal-calc-draft-status');
    const disabled = async (id) => ((await T(id).count()) ? T(id).isDisabled() : null);
    const openMore = async () => { if (!(await T('deal-calc-more-detail-panel').count())) await T('deal-calc-more-detail-toggle').click(); };
    const barArv = () => page.evaluate(() => document.querySelector('[data-testid="deal-calc-primary-bar"]').children[0].children[1].textContent);

    // ── unlinked scratch work ──
    await go();
    const cold = { status: await status(), notice: await txt('deal-calc-scratchpad-notice') };
    await T('deal-calc-arv-input').fill('300000');
    await settle();
    cold.bar = await barArv();
    check('the calculator works at once without a contact, and says nothing here is saved to GHL',
      cold.notice === 'Scratchpad -- nothing here is saved to GHL.' && cold.status === 'Figures you change here are kept in this browser only. Not saved to GHL.' && cold.bar === '$300,000', cold);
    await T('deal-calc-test-price-input').fill('150000');
    await T('deal-calc-repairs-mode-toggle').click();
    await T('deal-calc-repair-roof-good').click();
    await T('deal-calc-repair-misc-description').fill('Gutters');
    await T('deal-calc-repair-misc-amount').fill('1,800');
    await openMore();
    await T('deal-calc-assignment-manual').click();
    await T('deal-calc-manual-amount-input').fill('9000');
    await settle();
    const edited = { arv: await txt('deal-calc-draft-arv'), test: await txt('deal-calc-draft-testPrice'), items: await txt('deal-calc-draft-repairItems'), mode: await txt('deal-calc-draft-repairsMode'),
      assign: await txt('deal-calc-draft-assignmentMode'), manual: await txt('deal-calc-draft-manualAmount'), status: await status() };
    check('every kept figure and mode says Draft -- Not saved to GHL, and the status says it is kept as unlinked scratch work, never an approval',
      ['arv', 'test', 'items', 'mode', 'assign', 'manual'].every((k) => edited[k] === 'Draft -- Not saved to GHL')
      && edited.status === 'Kept in this browser only, as unlinked scratch work. Not saved to GHL, and never an approval.', edited);
    const scratchState = async () => { await openMore(); return {
      arv: await val('deal-calc-arv-input'), test: await val('deal-calc-test-price-input'), itemized: (await T('deal-calc-repairs-mode-toggle').innerText()).includes('Quick number'),
      misc: [await val('deal-calc-repair-misc-description'), await val('deal-calc-repair-misc-amount')], roofUnknown: await T('deal-calc-repair-roof-unknown').count(),
      manual: await val('deal-calc-manual-amount-input'), bar: await barArv() }; };
    const expectScratch = (s) => s.arv === '300000' && s.test === '150000' && s.itemized && s.misc[0] === 'Gutters' && s.misc[1] === '1,800' && s.roofUnknown === 0 && s.manual === '9000' && s.bar === '$300,000';
    await page.goto('about:blank');
    await go();
    const afterNav = { ...(await scratchState()), note: await txt('deal-calc-draft-restored') };
    check('leaving and returning restores every figure and mode (itemized rows, Miscellaneous, assignment), and the figures compute from them',
      expectScratch(afterNav) && afterNav.note === 'Restored the figures kept in this browser for unlinked scratch work.', afterNav);
    await page.reload(); await T('deal-calc-repairs-mode-toggle').waitFor(); await settle();
    const afterReload = await scratchState();
    check('a reload restores the same figures and modes', expectScratch(afterReload), afterReload);

    // ── a linked deal (one deal for the contact) ──
    await go('contactId=c-kay');
    const linked = { arv: await val('deal-calc-arv-input'), rep: await val('deal-calc-repairs-quick-input'), test: await val('deal-calc-test-price-input'),
      arvState: await txt('deal-calc-draft-arv'), repState: await txt('deal-calc-draft-repairsQuick'), deal: await txt('deal-calc-deal-name'), status: await status(), note: await txt('deal-calc-draft-restored') };
    check('a linked deal starts apart from scratch work; the contact seeds show as From the linked contact in GHL, not as drafts',
      linked.arv === '310000' && linked.rep === '20000' && linked.test === '' && linked.arvState === 'From the linked contact in GHL' && linked.repState === 'From the linked contact in GHL'
      && linked.deal === 'Deal: Kay -- 2623 Greenway' && linked.status === 'Figures you change here are kept in this browser only. Not saved to GHL.' && linked.note === null, linked);
    await T('deal-calc-test-price-input').fill('200000');
    await T('deal-calc-arv-input').fill('305000');
    await settle();
    const dealEdit = { arv: await txt('deal-calc-draft-arv'), status: await status() };
    await go('contactId=c-kay');
    const dealBack = { arv: await val('deal-calc-arv-input'), test: await val('deal-calc-test-price-input'), arvState: await txt('deal-calc-draft-arv'), rep: await val('deal-calc-repairs-quick-input') };
    check('the deal\'s draft survives reload, and the contact seed never overwrites a kept value',
      dealEdit.arv === 'Draft -- Not saved to GHL' && dealEdit.status === 'Kept in this browser only, for this deal. Not saved to GHL, and never an approval.'
      && dealBack.arv === '305000' && dealBack.test === '200000' && dealBack.arvState === 'Draft -- Not saved to GHL' && dealBack.rep === '20000', { dealEdit, dealBack });

    // ── a seed changed under a draft ──
    fixture.contacts['c-kay'].arv = '320000';
    await go('contactId=c-kay');
    const conflict = { ghl: await txt('deal-calc-draft-arv-ghl'), mine: await txt('deal-calc-draft-arv-mine'), input: await val('deal-calc-arv-input'),
      keep: await disabled('deal-calc-draft-arv-keep'), use: await disabled('deal-calc-draft-arv-use-ghl') };
    await T('deal-calc-draft-arv-keep').click({ timeout: 3000 }).catch(() => {});
    await settle();
    const keptNow = { ghl: await txt('deal-calc-draft-arv-ghl'), state: await txt('deal-calc-draft-arv'), input: await val('deal-calc-arv-input') };
    await go('contactId=c-kay');
    const keptReload = { ghl: await txt('deal-calc-draft-arv-ghl'), state: await txt('deal-calc-draft-arv'), input: await val('deal-calc-arv-input') };
    check('a seed changed under a draft shows both and overwrites neither; Keep My Draft keeps it, still Not saved to GHL, through reload',
      conflict.ghl === 'GHL now: 320000 (changed since your draft)' && conflict.mine === 'Your draft: 305000 -- Not saved to GHL' && conflict.input === '305000' && conflict.keep === false && conflict.use === false
      && [keptNow, keptReload].every((k) => k.ghl === null && k.state === 'Draft -- Not saved to GHL' && k.input === '305000'), { conflict, keptNow, keptReload });
    await T('deal-calc-repairs-quick-input').fill('22000');
    await settle();
    fixture.contacts['c-kay'].rep = '26000';
    await go('contactId=c-kay');
    const repConflict = await txt('deal-calc-draft-repairsQuick-ghl');
    await T('deal-calc-draft-repairsQuick-use-ghl').click({ timeout: 3000 }).catch(() => {});
    await settle();
    const usedNow = { rep: await val('deal-calc-repairs-quick-input'), state: await txt('deal-calc-draft-repairsQuick'), arv: await val('deal-calc-arv-input') };
    await go('contactId=c-kay');
    const usedReload = { rep: await val('deal-calc-repairs-quick-input'), state: await txt('deal-calc-draft-repairsQuick'), arv: await val('deal-calc-arv-input') };
    check('Use GHL takes the contact\'s value for that field only (now From GHL), and the other kept figures stay, through reload',
      repConflict === 'GHL now: 26000 (changed since your draft)' && [usedNow, usedReload].every((u) => u.rep === '26000' && u.state === 'From the linked contact in GHL' && u.arv === '305000'), { repConflict, usedNow, usedReload });

    fixture.contacts['c-kay'].arv = 'not a number';
    await go('contactId=c-kay');
    const unk = { text: await txt('deal-calc-draft-arv'), input: await val('deal-calc-arv-input'), keep: await disabled('deal-calc-draft-arv-keep'), use: await disabled('deal-calc-draft-arv-use-ghl'), conflict: await txt('deal-calc-draft-arv-ghl') };
    check('an unparsable contact seed is unreadable evidence: the draft is unchecked, not a conflict, and Keep My Draft / Use GHL are disabled',
      /^Draft -- Not saved to GHL \(the GHL value could not be checked\)/.test(unk.text || '') && unk.input === '305000' && unk.keep === true && unk.use === true && unk.conflict === null, unk);
    fixture.contacts['c-kay'].arv = '320000';

    // ── scratch and deal stay apart ──
    await go('contactId=c-kay');
    await T('deal-calc-unlink').click();
    await settle();
    const unlinked = { ...(await scratchState()), status: await status() };
    await T('deal-calc-link-input').fill('c-kay');
    await T('deal-calc-link-button').click();
    await T('deal-calc-unlink').waitFor({ timeout: 15000 }); await settle();
    const relinked = { arv: await val('deal-calc-arv-input'), test: await val('deal-calc-test-price-input') };
    check('unlinking shows the scratch work again, and linking again shows the deal\'s own draft: neither leaks into the other',
      expectScratch(unlinked) && relinked.arv === '305000' && relinked.test === '200000', { unlinked, relinked });

    // ── several deals for one contact ──
    await go('contactId=c-two');
    const choose = { select: await T('deal-calc-deal-select').count(), status: await status() };
    await T('deal-calc-deal-select').selectOption('o-two-1'); await settle();
    await T('deal-calc-test-price-input').fill('111000'); await settle();
    await T('deal-calc-deal-select').selectOption('o-two-2'); await settle();
    const deal2 = { test: await val('deal-calc-test-price-input'), state: await txt('deal-calc-draft-testPrice'), status: await status() };
    await T('deal-calc-deal-select').selectOption('o-two-1'); await settle();
    const deal1 = await val('deal-calc-test-price-input');
    check('a contact with several deals needs a choice first; each deal keeps its own draft, never another deal\'s figures',
      choose.select === 1 && choose.status === 'Choose a deal below to keep these figures. Until then they are not kept.'
      && deal2.test === '' && deal2.state === null && deal1 === '111000', { choose, deal2, deal1 });

    // ── nothing is kept without a deal ──
    await go('contactId=c-none');
    const none = { status: await status() };
    await T('deal-calc-test-price-input').fill('5'); await settle();
    none.label = await txt('deal-calc-draft-testPrice');
    await go('contactId=c-none');
    none.afterReload = await val('deal-calc-test-price-input');
    fixture.pipelineFails = true;
    await go('contactId=c-kay');
    const down = { status: await status(), arv: await val('deal-calc-arv-input') };
    fixture.pipelineFails = false;
    check('with no deal, or when the deals cannot be loaded, figures are not kept and the page says so',
      none.status === 'This contact has no deal, so figures here are not kept.' && none.label === null && none.afterReload === ''
      && down.status === "This contact's deals could not be loaded, so figures here are not kept.", { none, down });

    // ── Clear discards ──
    await go('contactId=c-kay');
    await T('deal-calc-clear').click(); await settle();
    await go('contactId=c-kay');
    const cleared = { arv: await val('deal-calc-arv-input'), arvState: await txt('deal-calc-draft-arv'), test: await val('deal-calc-test-price-input'), note: await txt('deal-calc-draft-restored'), status: await status() };
    check('Clear discards the deal\'s draft: after reload only the contact seeds show, as GHL values, and nothing is kept',
      cleared.arv === '320000' && cleared.arvState === 'From the linked contact in GHL' && cleared.test === '' && cleared.status === 'Figures you change here are kept in this browser only. Not saved to GHL.', cleared);
    await go();
    check('Clear on the deal leaves the scratch work untouched', expectScratch(await scratchState()));

    // ── other operators and environments in the same browser ──
    const other = await open(`(${(env, scratch) => {
      const draft = (id) => JSON.stringify({ version: 1, identity: id, savedAt: 'x', fields: { arv: { value: '999999', base: { kind: 'none' } } } });
      localStorage.setItem(`iaos-calculator-draft:v1:scratch|${env}|op-b`, draft({ kind: 'scratch', env, operator: 'op-b' }));
      localStorage.setItem('iaos-calculator-draft:v1:scratch|jmHG4B8RdzwpfqruNf68|this-browser', draft({ kind: 'scratch', env: 'jmHG4B8RdzwpfqruNf68', operator: 'this-browser' }));
      void scratch;
    }})(${JSON.stringify(ENV)}, ${JSON.stringify(SCRATCH_KEY)})`);
    await other.page.goto(`${base}${PAGE}`); await other.page.getByTestId('deal-calc-repairs-mode-toggle').waitFor({ timeout: 60000 }); await other.page.waitForTimeout(250);
    check('another operator\'s or another environment\'s draft in the same browser is not shown',
      (await other.page.getByTestId('deal-calc-arv-input').inputValue()) === '' && (await other.page.getByTestId('deal-calc-draft-restored').count()) === 0);
    await other.context.close();

    // ── storage failures ──
    const failing = await open(() => {
      const set = Storage.prototype.setItem; const rm = Storage.prototype.removeItem;
      window.__fail = { set: false, remove: false };
      Storage.prototype.setItem = function (k, v) { if (window.__fail.set && String(k).startsWith('iaos-calculator-draft')) throw new Error('QuotaExceededError'); return set.call(this, k, v); };
      Storage.prototype.removeItem = function (k) { if (window.__fail.remove && String(k).startsWith('iaos-calculator-draft')) throw new Error('blocked'); return rm.call(this, k); };
    });
    const fp = failing.page; const F = (id) => fp.getByTestId(id);
    const fgo = async () => { await fp.goto(`${base}${PAGE}`); await F('deal-calc-repairs-mode-toggle').waitFor({ timeout: 60000 }); await fp.waitForTimeout(250); };
    await fgo();
    await fp.evaluate(() => { window.__fail.set = true; });
    await F('deal-calc-arv-input').fill('111'); await fp.waitForTimeout(250);
    const refused = { status: (await F('deal-calc-draft-status').innerText()).trim() };
    await fgo();
    refused.afterReload = await F('deal-calc-arv-input').inputValue();
    check('a save refused after a good start is said plainly; nothing claims it was kept, and it is gone after reload',
      refused.status === 'These figures could NOT be kept in this browser: storage refused them. They exist only on this screen and are lost if you leave or reload. Not saved to GHL.' && refused.afterReload === '', refused);
    await fp.evaluate(() => { window.__fail.set = false; });
    await F('deal-calc-arv-input').fill('222'); await fp.waitForTimeout(250);
    const kept = { status: (await F('deal-calc-draft-status').innerText()).trim() };
    await fgo();
    kept.afterReload = await F('deal-calc-arv-input').inputValue();
    check('when saving works again the warning clears, the figures are kept, and they survive reload',
      kept.status === 'Kept in this browser only, as unlinked scratch work. Not saved to GHL, and never an approval.' && kept.afterReload === '222', kept);
    await fp.evaluate(() => { window.__fail.remove = true; });
    await F('deal-calc-clear').click(); await fp.waitForTimeout(250);
    const rm = { status: (await F('deal-calc-draft-status').innerText()).trim() };
    await fgo();
    rm.afterReload = await F('deal-calc-arv-input').inputValue();
    check('a Clear whose removal fails is said plainly; the draft that comes back after reload was warned about',
      rm.status === 'The cleared draft could not be removed from this browser, so it may come back after a reload.' && rm.afterReload === '222', rm);
    await failing.context.close();

    const blocked = await open(() => { const set = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (String(k).startsWith('iaos-calculator-draft')) throw new Error('blocked'); return set.call(this, k, v); }; });
    await blocked.page.goto(`${base}${PAGE}`); await blocked.page.getByTestId('deal-calc-repairs-mode-toggle').waitFor({ timeout: 60000 });
    await blocked.page.getByTestId('deal-calc-arv-input').fill('300000'); await blocked.page.waitForTimeout(250);
    const noStore = { status: (await blocked.page.getByTestId('deal-calc-draft-status').innerText()).trim(),
      bar: await blocked.page.evaluate(() => document.querySelector('[data-testid="deal-calc-primary-bar"]').children[0].children[1].textContent) };
    check('unavailable browser storage is said plainly, and the calculator still works',
      noStore.status === "This browser's storage is unavailable, so figures here are not kept: they are lost if you leave or reload. Not saved to GHL." && noStore.bar === '$300,000', noStore);
    await blocked.context.close();

    const bad = await open(`localStorage.setItem(${JSON.stringify(SCRATCH_KEY)}, '{"version":1,"identity":');`);
    await bad.page.goto(`${base}${PAGE}`); await bad.page.getByTestId('deal-calc-repairs-mode-toggle').waitFor({ timeout: 60000 }); await bad.page.waitForTimeout(250);
    const unreadable = { note: await bad.page.getByTestId('deal-calc-draft-restored').count() ? (await bad.page.getByTestId('deal-calc-draft-restored').innerText()).trim() : null,
      arv: await bad.page.getByTestId('deal-calc-arv-input').inputValue() };
    check('an unreadable kept draft is not used, and the page says so',
      unreadable.note === 'A kept draft for unlinked scratch work could not be read, so it was not used. Editing here replaces it.' && unreadable.arv === '', unreadable);
    await bad.context.close();

    const fns = [...new Set(requests.map((r) => r.fn))].sort();
    check('every request was a GET to an existing read (policy, contact detail, pipeline); nothing left the page; no page errors',
      requests.every((r) => r.method === 'GET') && fns.every((f) => ['ghl-opportunities', 'ghl-proxy', 'ghl-underwriting-policy'].includes(f))
      && requests.filter((r) => r.fn === 'ghl-proxy').every((r) => /^\/contacts\/[^/]+$/.test(r.path || '')) && foreign.length === 0 && pageErrors.length === 0,
      { fns, nonGet: requests.filter((r) => r.method !== 'GET'), foreign, pageErrors });
  } catch (e) {
    console.error(`FAIL  ${e.message}`);
    failures += 1;
  }

  console.log('');
  console.log(`checksRun=${checks} failures=${failures} floor=${FLOOR}${MUTATE ? ` (negative control vs --mutate=${MUTATE})` : ''}`);
  if (checks !== FLOOR) { console.error(`FAILED: expected exactly ${FLOOR} checks, ran ${checks}.`); return exit(failures > 0 ? 1 : 2); }
  if (failures > 0) { console.error('FAILED'); return exit(1); }
  console.log('OK');
  return exit(0);
}

main();
