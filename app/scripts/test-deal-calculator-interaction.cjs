/**
 * Board 15 / PR #124 re-review (Bones; Jess 2026-10-05) — Deal Calculator
 * itemized repairs, driven as an operator would in a real browser.
 *
 * Offline. Vite serves scripts/harness/deal-calculator, which renders the REAL
 * DealCalculator page in headless Chromium. Every /.netlify/functions request
 * is answered here (only the underwriting-policy read is expected); any other
 * network request is aborted and counted. No GHL, no write.
 *
 * Proves:
 *   1. Opening itemized mode shows Known $0 / total $0 / "Known repairs: $0 —
 *      estimate incomplete" at once (Brad's 2026-10-19 known-amounts policy,
 *      superseding the 2026-10-04 "$66,000" expectation this suite first
 *      asserted), Windows visibly unresolved, and the quick entry is the
 *      blank default.
 *   2. Miscellaneous entered in itemized mode is counted once.
 *   2b. Repair-only Clear ("Clear repairs") returns repairs to $0 incomplete,
 *      resets row answers and the Misc amount, and KEEPS ARV, Test Price and
 *      the Misc description; the page stays in itemized mode.
 *   3. The full calculator Clear resets everything -- ARV, Test Price and
 *      Miscellaneous included: enter -> Clear -> reopen itemized mode shows an
 *      empty description and amount and the $0 incomplete total again.
 *   4. The page sent no write of any kind.
 */
const path = require('node:path');

const APP = path.resolve(__dirname, '..');
const INCOMPLETE_0 = 'Known repairs: $0 — estimate incomplete';
let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}

async function main() {
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const { chromium } = require('playwright');
  const server = await createServer({
    root: APP, configFile: false, plugins: [react()], logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: ['scripts/harness/deal-calculator/index.html'],
      include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] },
  });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const log = [];
  const foreign = [];
  const exit = async (code) => { await browser.close().catch(() => {}); await server.close().catch(() => {}); process.exit(code); };
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Chicago' });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { foreign.push(url); return route.abort(); }
      const fn = new URL(url).pathname.replace('/.netlify/functions/', '');
      log.push({ fn, method: route.request().method() });
      if (fn === 'ghl-underwriting-policy') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ values: [] }) });
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: `fixture does not model ${fn}` }) });
    });
    await page.goto(`${base}/scripts/harness/deal-calculator/index.html`);
    const T = (id) => page.getByTestId(id);
    await T('deal-calc-repairs-mode-toggle').waitFor({ timeout: 60000 });
    const textOf = async (id) => (await T(id).innerText()).trim();

    // 1 — default quick entry is blank; opening itemized shows the allowances at once.
    check('1 quick entry is the default and blank', (await T('deal-calc-repairs-quick-input').inputValue()) === '');
    await T('deal-calc-repairs-mode-toggle').click();
    await T('repair-preliminary-total').waitFor();
    const k = await textOf('repair-known-subtotal'), st = await textOf('repair-estimate-status'), p = await textOf('repair-preliminary-total');
    check('1 itemized on open: Known $0 / total $0 / "Known repairs: $0 — estimate incomplete"', k === '$0' && p === '$0' && st === INCOMPLETE_0, { k, st, p });
    check('1 itemized on open: Windows is visibly unresolved', await T('repair-unresolved-windows').isVisible());

    // 2 — Miscellaneous is counted once.
    await T('deal-calc-repair-misc-description').fill('Gutters and fence');
    await T('deal-calc-repair-misc-amount').fill('1,800');
    await page.waitForTimeout(200);
    check('2 Miscellaneous $1,800 is counted once (Known $1,800, total $1,800)',
      (await textOf('repair-known-subtotal')) === '$1,800' && (await textOf('repair-preliminary-total')) === '$1,800',
      { k: await textOf('repair-known-subtotal'), p: await textOf('repair-preliminary-total') });
    // 2b — repair-only Clear keeps ARV, Test Price and the Misc description.
    await T('deal-calc-arv-input').fill('300000');
    await T('deal-calc-test-price-input').fill('150000');
    await T('deal-calc-repair-roof-good').click();
    await page.waitForTimeout(200);
    check('2b before repair-only Clear: Roof answered, Misc still counted once', (await textOf('repair-preliminary-total')) === '$1,800'
      && !(await T('deal-calc-repair-roof-unknown').isVisible().catch(() => false)), { p: await textOf('repair-preliminary-total') });
    await T('deal-calc-repairs-clear').click();
    await page.waitForTimeout(200);
    check('2b repair-only Clear: total $0, "Known repairs: $0 — estimate incomplete"',
      (await textOf('repair-known-subtotal')) === '$0' && (await textOf('repair-preliminary-total')) === '$0' && (await textOf('repair-estimate-status')) === INCOMPLETE_0,
      { k: await textOf('repair-known-subtotal'), p: await textOf('repair-preliminary-total'), st: await textOf('repair-estimate-status') });
    check('2b repair-only Clear keeps ARV and Test Price',
      (await T('deal-calc-arv-input').inputValue()) === '300000' && (await T('deal-calc-test-price-input').inputValue()) === '150000',
      { arv: await T('deal-calc-arv-input').inputValue(), test: await T('deal-calc-test-price-input').inputValue() });
    check('2b repair-only Clear keeps the Misc description and empties the Misc amount, Roof back to unknown',
      (await T('deal-calc-repair-misc-description').inputValue()) === 'Gutters and fence' && (await T('deal-calc-repair-misc-amount').inputValue()) === ''
        && (await T('deal-calc-repair-roof-unknown').isVisible()),
      { d: await T('deal-calc-repair-misc-description').inputValue(), a: await T('deal-calc-repair-misc-amount').inputValue() });
    check('2b repair-only Clear stays in itemized mode', (await T('deal-calc-repairs-mode-toggle').innerText()).includes('Quick number'));
    await T('deal-calc-repair-misc-amount').fill('1,800');
    await page.waitForTimeout(200);

    // 3 — enter -> Clear -> reopen itemized mode.
    await T('deal-calc-clear').click();
    await page.waitForTimeout(200);
    check('3 Clear returns to the quick entry', (await T('deal-calc-repairs-mode-toggle').innerText()).includes('Itemize repairs'));
    check('3 the full Clear also resets ARV and Test Price (unlike repair-only Clear)',
      (await T('deal-calc-arv-input').inputValue()) === '' && (await T('deal-calc-test-price-input').inputValue()) === '',
      { arv: await T('deal-calc-arv-input').inputValue(), test: await T('deal-calc-test-price-input').inputValue() });
    await T('deal-calc-repairs-mode-toggle').click();
    await T('repair-preliminary-total').waitFor();
    const d = await T('deal-calc-repair-misc-description').inputValue(), a = await T('deal-calc-repair-misc-amount').inputValue();
    check('3 after Clear, reopened itemized mode has an empty Miscellaneous description and amount', d === '' && a === '', { d, a });
    check('3 after Clear, the total is back to Known $0 / total $0, incomplete',
      (await textOf('repair-known-subtotal')) === '$0' && (await textOf('repair-preliminary-total')) === '$0'
        && (await textOf('repair-estimate-status')) === INCOMPLETE_0,
      { k: await textOf('repair-known-subtotal'), p: await textOf('repair-preliminary-total') });

    // 4 — nothing written, nothing off-machine, no page errors.
    check('4 the page sent no write', !log.some((r) => r.method !== 'GET' || /write/.test(r.fn)), log);
    check('4 no request left the machine', foreign.length === 0, foreign);
    check('4 no page errors', pageErrors.length === 0, pageErrors);
  } catch (e) {
    console.error(e);
    failures += 1;
  }
  console.log(`\nDeal Calculator interaction: ${checks - failures}/${checks} checks passed`);
  await exit(failures ? 1 : 0);
}
main();
