/**
 * Pass 1 F44 follow-up (Bones, 2026-10-24) -- Get Comps layout at narrow and
 * wide windows. OFFLINE, MOCKED BROWSER: the real App (app-routes harness) in
 * headless Chromium with invented data. Every function GET is answered from
 * the fixture below (unmodelled GETs get a 404 and are counted); every
 * non-localhost request is aborted; every non-GET is refused and fails the run.
 *
 * Focused checks (Contact page, contact with no address, 640px and 480px):
 *   - the "Get Comps" label stays on one line;
 *   - the reason sits below the button, inside the window (no sideways scroll);
 *   - disabled, tooltip and aria-describedby are unchanged.
 * Wider-width regression (1440px, 1024px): label on one line, reason beside
 * the button. Also: a contact WITH an address (no reason, enabled) and the
 * Seller Call button (unchanged file) at the same widths.
 *
 *   node scripts/test-b15-44-get-comps-layout.cjs
 */
const path = require('node:path');

const APP = path.resolve(__dirname, '..');
const HARNESS = '/scripts/harness/app-routes/index.html';
const REASON = 'No complete subject-property address on this record (street, city and state are all required)';
const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const watchdog = setTimeout(() => { console.error('FAIL  did not finish within 8 minutes'); process.exit(1); }, 8 * 60_000);

let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (ok) console.log(`PASS  ${name}`);
  else { failures += 1; console.log(`FAIL  ${name}${detail ? ` -- ${detail}` : ''}`); }
}

const PEOPLE = {
  noaddr: { id: 'syn-noaddr', firstName: 'Syn', lastName: 'Noaddress', address1: '', city: '', state: '', postalCode: '' },
  addr: { id: 'syn-addr', firstName: 'Syn', lastName: 'Withaddress', address1: '12 Example St', city: 'Testville', state: 'TX', postalCode: '75001' },
};
const oppFor = (p) => `syn-opp-${p.id}`;
const contactRow = (p) => ({ id: p.id, firstName: p.firstName, lastName: p.lastName, phone: '+15550100001', email: `${p.id}@example.invalid`,
  address1: p.address1, city: p.city, state: p.state, postalCode: p.postalCode, dateAdded: '2026-09-01T00:00:00.000Z', tags: [], dndSettings: {},
  motivationScore: null, dealScore: null, combinedScore: null, completenessScore: null, callbackDatetime: null, callbackDatetimePrecise: null,
  lastCallAttempt: null, lastCallAttemptPrecise: null, propertyAddress: '', phoneStatus: '', callDisposition: '', callRouting: '', dispositionAt: null });
const pipeline = () => ({ pipelineId: 'syn-pipeline', stages: [{ id: 'syn-st-new', name: 'New Lead - Seller' }],
  opportunities: Object.values(PEOPLE).map((p) => ({ id: oppFor(p), contactId: p.id, contactName: `${p.firstName} ${p.lastName}`,
    opportunityName: `${p.firstName} ${p.lastName}`, phone: '+15550100001', email: `${p.id}@example.invalid`, stageId: 'syn-st-new', customFields: [] })) });

function answer(p, fn, u) {
  const q = u.searchParams.get('path') || '';
  switch (fn) {
    case 'app-read-session': return json(200, { signedIn: true, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
    case 'ghl-opportunities': return json(200, pipeline());
    case 'ghl-contact': return json(200, contactRow(p));
    case 'ghl-underwriting-policy': return json(200, { values: [] }); /* as test-b15-26-provisional-repairs.cjs */
    case 'ghl-proxy':
      if (q === `/contacts/${p.id}/notes`) return json(200, { notes: [] });
      if (q === `/contacts/${p.id}`) return json(200, { contact: { ...contactRow(p), customFields: [] } });
      if (q === `/opportunities/${oppFor(p)}`) return json(200, { opportunity: { id: oppFor(p), contactId: p.id, pipelineStageId: 'syn-st-new', customFields: [] } });
      return null;
    default: return null;
  }
}

/* Measured in the page: how many lines the label text occupies, where the
   reason sits relative to the button, and whether the page scrolls sideways. */
function measure({ button, reason }) {
  const b = document.querySelector(`[data-testid="${button}"]`);
  const r = document.querySelector(`[data-testid="${reason}"]`);
  const text = [...b.childNodes].find((n) => n.nodeType === 3 && n.textContent.includes('Get Comps'));
  const range = document.createRange();
  range.selectNodeContents(text);
  const tops = new Set([...range.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top)));
  const br = b.getBoundingClientRect();
  const rr = r ? r.getBoundingClientRect() : null;
  return {
    labelLines: tops.size,
    disabled: b.disabled,
    title: b.getAttribute('title'),
    describedby: b.getAttribute('aria-describedby'),
    reasonId: r ? r.id : null,
    reasonText: r ? r.textContent : null,
    reasonBelow: rr ? rr.top >= br.bottom - 1 : null,
    reasonBeside: rr ? rr.left >= br.right - 1 && rr.top < br.bottom && rr.bottom > br.top : null,
    reasonInside: rr ? rr.left >= 0 && rr.right <= window.innerWidth + 0.5 : null,
    pageScrollsSideways: document.documentElement.scrollWidth > window.innerWidth + 0.5,
  };
}

async function main() {
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const tailwindcss = (await import('@tailwindcss/vite')).default;
  const { chromium } = require('playwright');
  const server = await createServer({
    root: APP, configFile: false, plugins: [react(), tailwindcss()], logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: [HARNESS.slice(1)], include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] },
  });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const log = { writes: [], foreign: [], unmodelled: [], pageErrors: [] };

  async function open(person, route, width) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'America/Chicago', locale: 'en-US' });
    const page = await context.newPage();
    const tag = `${route}@${width}`;
    page.on('pageerror', (e) => log.pageErrors.push(`${tag}: ${String(e)}`));
    await context.route('**/*', async (rt) => {
      const r = rt.request();
      const url = r.url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return rt.continue();
      if (!url.includes('/.netlify/functions/')) { log.foreign.push(url); return rt.abort(); }
      const u = new URL(url);
      const fn = u.pathname.replace('/.netlify/functions/', '');
      const label = `${tag}: ${r.method()} ${fn}${u.searchParams.get('path') ? ` ${u.searchParams.get('path')}` : ''}`;
      if (r.method() !== 'GET') { log.writes.push(label); return rt.fulfill(json(405, { error: 'offline test refuses every write' })); }
      const a = answer(person, fn, u);
      if (a) return rt.fulfill(a);
      log.unmodelled.push(label);
      return rt.fulfill(json(404, { error: `fixture does not model ${label}` }));
    });
    await page.goto(`${base}${HARNESS}?start=${encodeURIComponent(route)}`);
    await page.waitForFunction(() => typeof window.__iaosAppSource === 'string', null, { timeout: 90000 });
    return { context, page };
  }

  const P = { contact: { button: 'get-comps', reason: 'get-comps-reason' }, sellerCall: { button: 'seller-call-get-comps', reason: 'seller-call-get-comps-reason' } };
  try {
    /* Contact page, no address: focused narrow checks and the wide regression. */
    for (const width of [640, 480, 1024, 1440]) {
      const { context, page } = await open(PEOPLE.noaddr, `/contacts/${PEOPLE.noaddr.id}`, width);
      await page.getByTestId('get-comps-reason').waitFor({ timeout: 60000 });
      const m = await page.evaluate(measure, P.contact);
      const w = `Contact, no address, ${width}px`;
      check(`${w}: "Get Comps" label on one line`, m.labelLines === 1, `lines=${m.labelLines}`);
      if (width <= 640) check(`${w}: reason below the button`, m.reasonBelow === true, JSON.stringify(m));
      else check(`${w}: reason beside the button (unchanged wide layout)`, m.reasonBeside === true, JSON.stringify(m));
      check(`${w}: reason inside the window; no sideways page scroll`, m.reasonInside === true && m.pageScrollsSideways === false, JSON.stringify(m));
      check(`${w}: disabled, tooltip and aria-describedby unchanged`,
        m.disabled === true && m.title === REASON && m.describedby === 'get-comps-reason' && m.reasonId === 'get-comps-reason' && m.reasonText === REASON, JSON.stringify(m));
      if (width === 640 || width === 480) {
        /* The page scrolls inside the app shell (<main>), and the deal rail is
           sticky at its top by design (ContactWorkspace.tsx, Board #5 S1). So
           scroll until the button sits just below the stuck rail, then check
           nothing else covers it. */
        const view = await page.evaluate(() => {
          const btn = document.querySelector('[data-testid="get-comps"]');
          const main = btn.closest('main');
          const rail = document.querySelector('[data-testid="deal-rail"]');
          main.scrollTop += btn.getBoundingClientRect().top - main.getBoundingClientRect().top - rail.offsetHeight - 24;
          const r = btn.getBoundingClientRect();
          const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return { onTop: !!e && !!e.closest('[data-testid="get-comps"]'), railHeight: rail.offsetHeight, mainHeight: main.clientHeight };
        });
        check(`${w}: below the sticky deal rail, the button is visible and not covered`, view.onTop === true, JSON.stringify(view));
        await page.getByTestId('get-comps-group').screenshot({ path: path.join(OUT, `contact-noaddr-${width}-group.png`) });
      }
      await context.close();
    }
    /* Contact page, with an address: no reason, enabled, label on one line. */
    for (const width of [480, 1440]) {
      const { context, page } = await open(PEOPLE.addr, `/contacts/${PEOPLE.addr.id}`, width);
      const btn = page.getByTestId('get-comps');
      await page.waitForFunction(() => { const b = document.querySelector('[data-testid="get-comps"]'); return b && !b.disabled; }, null, { timeout: 60000 });
      const m = await page.evaluate(measure, P.contact);
      const w = `Contact, with address, ${width}px`;
      check(`${w}: enabled, label on one line, no reason, no aria-describedby`,
        m.disabled === false && m.labelLines === 1 && m.reasonText === null && m.describedby === null && (await btn.getAttribute('title')).startsWith('Copies 12 Example St'), JSON.stringify(m));
      check(`${w}: no sideways page scroll`, m.pageScrollsSideways === false, JSON.stringify(m));
      await context.close();
    }
    /* Seller Call (file unchanged by this commit): label on one line at every width. */
    for (const width of [640, 480, 1440]) {
      const { context, page } = await open(PEOPLE.noaddr, `/contacts/${PEOPLE.noaddr.id}/seller-call`, width);
      await page.getByTestId('seller-call-get-comps-reason').waitFor({ timeout: 60000 });
      const m = await page.evaluate(measure, P.sellerCall);
      const w = `Seller Call, no address, ${width}px`;
      check(`${w}: label on one line; reason visible inside the window`, m.labelLines === 1 && m.reasonInside === true && m.reasonText === REASON, JSON.stringify(m));
      await context.close();
    }
  } catch (e) {
    check('run completed', false, String(e && e.message || e).split('\n')[0]);
  }
  check('offline: no writes, no foreign requests, no page errors',
    log.writes.length === 0 && log.foreign.length === 0 && log.pageErrors.length === 0, JSON.stringify({ writes: log.writes, foreign: log.foreign, pageErrors: log.pageErrors }));
  console.log(`unmodelled GETs answered 404: ${log.unmodelled.length}${log.unmodelled.length ? ` (${[...new Set(log.unmodelled.map((s) => s.replace(/^[^:]+: /, '')))].join('; ')})` : ''}`);
  console.log(`\nB15 F44 Get Comps layout: ${checks - failures}/${checks} checks passed`);
  clearTimeout(watchdog);
  await browser.close().catch(() => {});
  await server.close().catch(() => {});
  process.exit(failures ? 1 : 0);
}
const OUT = process.env.F44_LAYOUT_SHOTS || path.join(require('node:os').tmpdir(), 'b15-f44-layout');
require('node:fs').mkdirSync(OUT, { recursive: true });
main();
