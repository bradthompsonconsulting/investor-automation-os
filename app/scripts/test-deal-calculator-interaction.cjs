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
 *   1. Opening itemized mode shows Known $0 / Unanswered $66,000 /
 *      Preliminary $66,000 at once, Windows visibly unresolved, and the quick
 *      entry is the blank default.
 *   2. Miscellaneous entered in itemized mode is counted once.
 *   3. Clear resets Miscellaneous: enter -> Clear -> reopen itemized mode shows
 *      an empty description and amount and the $66,000 total again.
 *   4. The page sent no write of any kind.
 */
const path = require('node:path');

const APP = path.resolve(__dirname, '..');
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
    const k = await textOf('repair-known-subtotal'), u = await textOf('repair-unanswered-subtotal'), p = await textOf('repair-preliminary-total');
    check('1 itemized on open: Known $0 / Unanswered $66,000 / Preliminary $66,000', k === '$0' && u === '$66,000' && p === '$66,000', { k, u, p });
    check('1 itemized on open: Windows is visibly unresolved', await T('repair-unresolved-windows').isVisible());

    // 2 — Miscellaneous is counted once.
    await T('deal-calc-repair-misc-description').fill('Gutters and fence');
    await T('deal-calc-repair-misc-amount').fill('1,800');
    await page.waitForTimeout(200);
    check('2 Miscellaneous $1,800 is counted once (Known $1,800, Preliminary $67,800)',
      (await textOf('repair-known-subtotal')) === '$1,800' && (await textOf('repair-preliminary-total')) === '$67,800',
      { k: await textOf('repair-known-subtotal'), p: await textOf('repair-preliminary-total') });

    // 3 — enter -> Clear -> reopen itemized mode.
    await T('deal-calc-clear').click();
    await page.waitForTimeout(200);
    check('3 Clear returns to the quick entry', (await T('deal-calc-repairs-mode-toggle').innerText()).includes('Itemize repairs'));
    await T('deal-calc-repairs-mode-toggle').click();
    await T('repair-preliminary-total').waitFor();
    const d = await T('deal-calc-repair-misc-description').inputValue(), a = await T('deal-calc-repair-misc-amount').inputValue();
    check('3 after Clear, reopened itemized mode has an empty Miscellaneous description and amount', d === '' && a === '', { d, a });
    check('3 after Clear, the total is back to Known $0 / Preliminary $66,000',
      (await textOf('repair-known-subtotal')) === '$0' && (await textOf('repair-preliminary-total')) === '$66,000',
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
