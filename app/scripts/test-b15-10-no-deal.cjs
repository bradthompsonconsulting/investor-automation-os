/**
 * B15-10 (INV-109, Pass 1 F19) -- a contact with no opportunity, on every deal page.
 *
 * F19 (f2b65af) gave the Contact, Seller Call and Underwriting pages the shared
 * "No deal yet" card (NoDealYet): the page's reason, "Create the opportunity for
 * this contact in GHL, then reload this page. IAOS doesn't create deals." and an
 * "Open this contact in GHL" button. The Contract Workspace kept its older notice
 * ("No opportunity on this contact ... Create an opportunity in GHL first.") with
 * no way to get there; it now shows the same card. Navigation only: no deal is
 * created and nothing is written.
 *
 * Offline, RENDERED. Vite serves scripts/harness/app-routes (the REAL App, its
 * routes, Layout and the app's real stylesheet) in headless Chromium. A FICTIONAL
 * contact has no Seller Leads opportunity; every /.netlify/functions request is
 * answered here; the GHL hand-off is captured and aborted; nothing leaves the
 * machine. Plus source checks.
 *
 * NEGATIVE CONTROL: `node scripts/test-b15-10-no-deal.cjs --before=<rev>` renders
 * the CURRENT App with <rev>'s Contract Workspace page only (via `git show`) and
 * must FAIL (exit 1) -- e.g. --before=6806f6f.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const APP = path.resolve(__dirname, '..');
const HARNESS_DIR = path.join(APP, 'scripts/harness/app-routes');
const HARNESS = '/scripts/harness/app-routes/index.html';
const APP_BEFORE = path.join(HARNESS_DIR, 'AppBefore.tsx');
const CW_BEFORE = path.join(HARNESS_DIR, 'ContractWorkspaceBefore.tsx');
const beforeArg = process.argv.find((a) => a.startsWith('--before='));
const BEFORE = beforeArg ? beforeArg.slice('--before='.length) : null;

/** Literal call-site count taken from the finished file: 6 single check() sites + 1 inside the page loop x 3 pages = 9. */
const FLOOR = 9;
let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}
const removeBefore = () => [APP_BEFORE, CW_BEFORE].forEach((f) => { if (fs.existsSync(f)) fs.rmSync(f); });
removeBefore();
process.on('exit', removeBefore);
const show = (p) => execFileSync('git', ['show', `${BEFORE}:app/${p}`], { cwd: APP, encoding: 'utf8' });
const read = (p) => (BEFORE && p === 'src/pages/ContractWorkspace.tsx' ? show(p) : fs.readFileSync(path.join(APP, p), 'utf8')).replace(/\r\n/g, '\n');
if (BEFORE) {
  // The current App, with ONLY the Contract Workspace taken from <rev>.
  fs.writeFileSync(CW_BEFORE, show('src/pages/ContractWorkspace.tsx').replace(/from "\.\.\//g, 'from "../../../src/').replace(/(from|import) "\.\//g, '$1 "../../../src/pages/'));
  fs.writeFileSync(APP_BEFORE, fs.readFileSync(path.join(APP, 'src/App.tsx'), 'utf8')
    .replace('from "./pages/ContractWorkspace"', 'from "./ContractWorkspaceBefore"').replace(/from "\.\/(?!ContractWorkspaceBefore)/g, 'from "../../../src/'));
  console.log(`NEGATIVE CONTROL: the current App with the Contract Workspace from ${BEFORE}; this run must fail.`);
}

const CONTACT = 'fixtureNoDealC1';
const TITLE = 'No deal yet';
const STEP = "Create the opportunity for this contact in GHL, then reload this page. IAOS doesn't create deals.";
const BUTTON = 'Open this contact in GHL';
const watchdog = setTimeout(() => { console.error('FAIL  the suite did not finish within 5 minutes -- stopped'); process.exit(1); }, 5 * 60_000);

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
  const exit = async (code) => { clearTimeout(watchdog); await browser.close().catch(() => {}); await server.close().catch(() => {}); removeBefore(); process.exit(code); };
  const methods = []; const foreign = []; const handoffs = [];

  /** A fresh page at a direct route; FICTIONAL contact, no opportunity; reads only. */
  async function open(start) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    // One route for everything (Playwright tries the LAST-registered route first, so a separate GHL route would never run).
    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (/^https:\/\/[^/]*(gohighlevel\.com|leadconnectorhq\.com)\//.test(url)) { handoffs.push(url); return route.abort(); }   // the GHL hand-off: captured, not sent
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { foreign.push(url); return route.abort(); }
      const u = new URL(url); const fn = u.pathname.replace('/.netlify/functions/', ''); const p = u.searchParams.get('path') || '';
      methods.push(route.request().method());
      const json = (s, b) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
      if (fn === 'app-read-session') return json(200, { signedIn: true, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
      if (route.request().method() !== 'GET') return json(405, { error: 'fixture: reads only' });
      const contact = { id: CONTACT, firstName: 'Nolan', lastName: 'Nodeal', phone: '+15555550100', email: '', address1: '9 Fictional Way', city: 'Waco', state: 'TX', postalCode: '76701', dndSettings: {}, customFields: [] };
      if (fn === 'ghl-opportunities') return json(200, { pipelineId: 'p-test', stages: [], opportunities: [] });   // NO deal for anyone
      if (fn === 'ghl-proxy' && /\/notes$/.test(p)) return json(200, { notes: [] });
      if (fn === 'ghl-proxy' && /\/customFields\/[^/]+$/.test(p)) return json(200, { customField: { id: 'folder', name: 'Folder', position: 0 } });
      if (fn === 'ghl-proxy' && /\/customFields$/.test(p)) return json(200, { customFields: [] });
      if (fn === 'ghl-proxy' && /^\/contacts\/[^/?]+$/.test(p)) return json(200, { contact });
      if (fn === 'ghl-contact') return json(200, { ...contact, firstName: 'Nolan', lastName: 'Nodeal', dateAdded: '2026-10-01T00:00:00.000Z', tags: [], propertyAddress: '' });
      if (fn === 'ghl-underwriting-policy') return json(200, { values: [] });
      if (fn === 'ghl-contact-conversations') return json(200, { messages: [], conversations: [] });
      if (fn === 'ghl-contacts') return json(200, []);
      return json(404, { error: `fixture: ${fn} not answered` });
    });
    await page.goto(`${base}${HARNESS}?start=${encodeURIComponent(start)}`);
    await page.waitForFunction(() => typeof window.__iaosAppSource === 'string', null, { timeout: 60000 });
    return { context, page };
  }
  /** The no-deal card on the page, or null (waits up to 15 s; never throws). */
  const card = async (page, scope) => {
    const sel = scope ? `[data-testid="${scope}"] [data-testid="no-deal-yet"]` : '[data-testid="no-deal-yet"]';
    const t0 = Date.now();
    while (Date.now() - t0 < 15000) {
      const c = await page.evaluate((s) => { const el = document.querySelector(s); if (!el) return null;
        const btn = el.querySelector('[data-testid="no-deal-open-ghl"]'); return { text: el.innerText, button: btn ? btn.innerText.trim() : null }; }, sel).catch(() => null);
      if (c) return c;
      await page.waitForTimeout(100);
    }
    return null;
  };
  const isCard = (c, reason) => !!c && c.text.includes(TITLE) && c.text.includes(STEP) && c.button === BUTTON && (!reason || c.text.includes(reason));

  try {
    // ── The Contract Workspace (the change) ──
    const { context: cc, page } = await open(`/contacts/${CONTACT}/contract`);
    const c = await card(page, 'contract-no-opportunity');
    check('Contract Workspace, no deal: the shared card -- "No deal yet", its reason, the next step and the GHL button',
      isCard(c, 'A seller contract belongs to the deal, not the person.'), c);
    const bodyText = await page.locator('body').innerText();
    check('the old dead-end notice is gone ("No opportunity on this contact" / "Create an opportunity in GHL first.")',
      !/No opportunity on this contact|Create an opportunity in GHL first/.test(bodyText));
    const before = handoffs.length;
    if (c) await page.getByTestId('no-deal-open-ghl').click().catch(() => {});
    const t0 = Date.now(); while (handoffs.length === before && Date.now() - t0 < 8000) await page.waitForTimeout(100);
    const url = handoffs[handoffs.length - 1] || '';
    check('"Open this contact in GHL" opens THIS contact\'s GHL record (captured, not sent)', handoffs.length > before && url.endsWith(`/contacts/detail/${CONTACT}`), url);
    await cc.close();

    // ── The other three pages (regression: unchanged F19 behaviour) ──
    for (const [route, reason] of [[`/contacts/${CONTACT}`, 'Seller Ask, MAO and underwriting attach to a deal, not to the contact.'],
      [`/contacts/${CONTACT}/seller-call`, null], [`/contacts/${CONTACT}/underwriting`, null]]) {
      const { context, page: p } = await open(route);
      const k = await card(p);
      check(`${route.replace(CONTACT, ':id')}: the same "No deal yet" card with the GHL button (unchanged)`, isCard(k, reason), k);
      await context.close();
    }

    // ── Boundaries ──
    check('reads only (GET), nothing left the machine, and no deal was created', methods.every((m) => m === 'GET') && foreign.length === 0, { methods: [...new Set(methods)], foreign });

    // ── Source ──
    const cw = read('src/pages/ContractWorkspace.tsx');
    check('the Contract Workspace imports the shared NoDealYet and renders it for no_opportunity (no copy of the card)',
      /import NoDealYet from "\.\.\/components\/NoDealYet";/.test(cw) && /screen\.state === "no_opportunity" \? \(\s*<div data-testid="contract-no-opportunity">\s*<NoDealYet contactId=\{contactId\} reason="A seller contract belongs to the deal, not the person\." \/>/.test(cw));
    const nd = fs.readFileSync(path.join(APP, 'src/components/NoDealYet.tsx'), 'utf8');
    check('NoDealYet is navigation only (window.open to ghlContactDetailUrl, noopener; no ghl write)',
      /window\.open\(ghlContactDetailUrl\(contactId\), "_blank", "noopener,noreferrer"\)/.test(nd) && !/ghl\.[a-z]+\.(create|set|update)|appWriteFetch|fetch\(/.test(nd));
  } catch (e) {
    console.error(`FAIL  ${e.message}`);
    failures += 1;
  }
  console.log('');
  console.log(`checksRun=${checks} failures=${failures} floor=${FLOOR}${BEFORE ? ` (negative control vs ${BEFORE})` : ''}`);
  if (checks !== FLOOR) { console.error(`FAILED: expected exactly ${FLOOR} checks, ran ${checks}.`); return exit(2); }
  if (failures > 0) { console.error('FAILED'); return exit(1); }
  console.log('OK');
  return exit(0);
}

main().catch((e) => { console.error(`FAIL  startup: ${e && e.stack || e}`); removeBefore(); process.exit(2); });
