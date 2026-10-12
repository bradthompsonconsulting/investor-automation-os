/**
 * B15-11 (INV-111) -- Contacts search also matches the Property Address.
 *
 * Ruling (Jess, 2026-10-08): the search may also match the Property Address
 * value the grid already displays -- case-insensitive, partial -- while Name,
 * Email and punctuation-insensitive phone search stay as they were. A blank
 * address never matches. No native-address fallback, no new read, no save.
 * CONTACTS_OPPORTUNITIES_SPEC.md §5.1, amendment 2026-10-08.
 *
 * BEHAVIOUR, rendered. Vite serves scripts/harness/contacts-search -- the REAL
 * Layout and Contacts page with the real GHL client AND the app's real
 * stylesheet (src/index.css through the same Tailwind Vite plugin the app
 * builds with) -- in headless Chromium, and every /.netlify/functions request
 * is answered here. Each search check types a query into the real search box
 * and polls the rows the grid shows.
 *
 * The search box prompt names the property address ("Search name, phone,
 * email, property address…") and must fit, uncut, at a wide desktop
 * (2560), the usual desktops (1440, 1280) and narrow windows (1024, 768),
 * with no horizontal page overflow (Bones, review of 354edac). Fonts: the
 * offline harness cannot fetch Google Fonts, so text is measured in the
 * browser's fallback for the app's font stack; the box keeps ample slack.
 *
 * NEGATIVE CONTROL: `node scripts/test-contacts-address-search.cjs --before=<rev>`
 * renders <rev>'s Contacts page (via `git show`) and must FAIL (exit 1) for a
 * revision without address search -- e.g. --before=3de480e -- and for the
 * clipped-prompt layout at --before=354edac.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const APP = path.resolve(__dirname, '..');
const HARNESS_DIR = path.join(APP, 'scripts/harness/contacts-search');
const HARNESS = '/scripts/harness/contacts-search/index.html';
const BEFORE_FILE = path.join(HARNESS_DIR, 'ContactsBefore.tsx');
const beforeArg = process.argv.find((a) => a.startsWith('--before='));
const BEFORE_REV = beforeArg ? beforeArg.slice('--before='.length) : null;

/**
 * Taken from the finished file, never back-filled from a passing run: 9 single
 * check() call sites + 1 inside the width loop x 5 widths + 10 expectRows()
 * call sites (one check each) = 24.
 */
const FLOOR = 24;
let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}

if (fs.existsSync(BEFORE_FILE)) fs.rmSync(BEFORE_FILE);
if (BEFORE_REV) {
  const src = execFileSync('git', ['show', `${BEFORE_REV}:app/src/pages/Contacts.tsx`], { cwd: APP, encoding: 'utf8' });
  fs.writeFileSync(BEFORE_FILE, src.replace(/from "\.\.\//g, 'from "../../../src/'));
  console.log(`NEGATIVE CONTROL: rendering the Contacts page from ${BEFORE_REV}; this run must fail.`);
}

// ── Fixture (ghl-contacts returns ContactRow[]; names arrive lowercased) ─────
const contact = (id, firstName, lastName, phone, email, propertyAddress, dateAdded) =>
  ({ id, firstName, lastName, phone, email, propertyAddress, dateAdded });
const CONTACTS = [
  contact('c-kay', 'kay', 'fixture', '+18175550101', 'kay@example.com', '2623 Greenway Dr, Dallas, TX 75201', '2026-10-07T15:00:00.000Z'),
  contact('c-lee', 'lee', 'blank', '+12149146151', 'lee@sample.org', '', '2026-10-06T15:00:00.000Z'),
  contact('c-max', 'max', 'third', '+14695550123', 'max@third.net', '88 Oak Ln, Austin, TX 78701', '2026-10-05T15:00:00.000Z'),
  contact('c-ann', 'ann', 'oakley', '+19725550188', 'ann@oakley.io', '', '2026-10-04T15:00:00.000Z'),
];
const KAY = 'kay fixture';
const LEE = 'lee blank';
const MAX = 'max third';
const ANN = 'ann oakley';
const ALL = [KAY, LEE, MAX, ANN];
const PLACEHOLDER = 'Search name, phone, email, property address…';
const WIDTHS = [2560, 1440, 1280, 1024, 768];

let log = [];
const foreign = [];
const watchdog = setTimeout(() => { console.error('FAIL  the suite did not finish within 5 minutes -- stopped'); process.exit(1); }, 5 * 60_000);

async function main() {
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const { chromium } = require('playwright');
  const tailwindcss = (await import('@tailwindcss/vite')).default;
  const server = await createServer({
    root: APP, configFile: false, plugins: [react(), tailwindcss()], logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: [HARNESS.slice(1)],
      include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] },
  });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const exit = async (code) => {
    clearTimeout(watchdog);
    await browser.close().catch(() => {}); await server.close().catch(() => {});
    if (fs.existsSync(BEFORE_FILE)) fs.rmSync(BEFORE_FILE);
    process.exit(code);
  };
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { foreign.push(url); return route.abort(); }
      const fn = new URL(url).pathname.replace('/.netlify/functions/', '');
      const method = route.request().method();
      log.push(`${method} ${fn}`);
      const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (fn === 'app-read-session') return json(200, { signedIn: true, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
      if (fn === 'ghl-contacts' && method === 'GET') return json(200, CONTACTS);
      return json(404, { error: `fixture: ${method} ${fn} not answered` });
    });

    await page.goto(`${base}${HARNESS}`);
    await page.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 });
    await page.evaluate(() => window.__iaosNavigate('/contacts'));
    await page.getByRole('link', { name: KAY }).waitFor({ timeout: 30000 });
    check('harness renders the expected Contacts source', (await page.evaluate(() => window.__iaosContactsSource)) === (BEFORE_REV ? 'before' : 'current'));

    const box = page.locator('main input[type="text"]');
    const styled = await page.evaluate(() => ({
      boxSizing: getComputedStyle(document.querySelector('main input[type="text"]')).boxSizing,
      bodyFont: getComputedStyle(document.body).fontFamily,
    }));
    check("the harness renders with the app's real stylesheet", styled.boxSizing === 'border-box' && /^"?Inter"?,/.test(styled.bodyFont), styled);
    check('the search box shows the exact prompt', (await box.getAttribute('placeholder')) === PLACEHOLDER, await box.getAttribute('placeholder'));

    /** Prompt fit and page overflow at one window width, with the real styles. */
    const layoutAt = async (width) => {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      return page.evaluate(() => {
        const el = document.querySelector('main input[type="text"]');
        const main = document.querySelector('main');
        const cs = getComputedStyle(el);
        const ms = getComputedStyle(main);
        const ctx = document.createElement('canvas').getContext('2d');
        ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const b = el.getBoundingClientRect();
        const m = main.getBoundingClientRect();
        return {
          textWidth: Math.ceil(ctx.measureText(el.placeholder).width),
          room: el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
          boxInsideMain: b.left >= m.left + parseFloat(ms.paddingLeft) - 0.5 && b.right <= m.right - parseFloat(ms.paddingRight) + 0.5,
          pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          mainOverflow: main.scrollWidth > main.clientWidth,
        };
      });
    };
    for (const width of WIDTHS) {
      const l = await layoutAt(width);
      check(`at ${width}px the full prompt fits in the box, the box stays inside the page, and nothing overflows sideways`,
        l.textWidth <= l.room && l.boxInsideMain && !l.pageOverflow && !l.mainOverflow, l);
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const rowsNow = () => page.locator('tbody tr td:first-child a').allInnerTexts().then((t) => t.map((s) => s.trim()));
    /** Types `q` into the real search box; polls (up to 3 s) until the grid shows `expected`, and returns what it shows. */
    const search = async (q, expected) => {
      await box.fill(q);
      const until = Date.now() + 3000;
      let rows = await rowsNow();
      while (!same(rows, expected) && Date.now() < until) { await page.waitForTimeout(50); rows = await rowsNow(); }
      return rows;
    };
    const expectRows = async (name, q, expected) => { const r = await search(q, expected); check(name, same(r, expected), r); };

    await expectRows('a street name found only in the address matches, case-insensitive', 'greenWAY', [KAY]);
    await expectRows('the query is trimmed before matching the address', '  GreenWay  ', [KAY]);
    await expectRows('a house number (digits only) matches the address', '2623', [KAY]);
    await expectRows('a partial run across the displayed address, with punctuation, matches', 'dallas, tx 752', [KAY]);
    await expectRows('a digits-only query returns both an address match and a phone match, in Date Added order', '88', [MAX, ANN]);
    await expectRows('an address match and a name/email match both show, in the active Date Added order', 'oak', [MAX, ANN]);
    const badge = (await page.locator('main h1 + span').innerText()).trim();
    check('the count badge counts the address matches', badge === '2', badge);
    const nameHeader = page.locator('thead th', { hasText: /^Name$/ });
    await nameHeader.click();
    const asc = await search('oak', [ANN, MAX]);
    await nameHeader.click();
    const desc = await search('oak', [MAX, ANN]);
    check('with an address search active, Name sort orders the matches ascending, then descending', same(asc, [ANN, MAX]) && same(desc, [MAX, ANN]), { asc, desc });
    await page.locator('thead th', { hasText: /^Date Added$/ }).click();

    const blank = await search('—', []);
    const empty = (await page.locator('tbody').innerText()).includes('No contacts match "—"');
    check('a blank address (shown as —) does not match a nonempty search', same(blank, []) && empty, { blank, empty });
    await expectRows('name search unchanged; a blank-address contact is still found by name', 'lee', [LEE]);
    await expectRows('email search unchanged (case-insensitive)', 'SAMPLE.org', [LEE]);
    const phoneRuns = { digits: await search('9146151', [LEE]), formatted: await search('(214) 914-6151', [LEE]), dotted: await search('214.914.6151', [LEE]) };
    check('phone search unchanged, punctuation-insensitive', Object.values(phoneRuns).every((x) => same(x, [LEE])), phoneRuns);
    await expectRows('a query matching nothing shows no rows', 'zzzz', []);
    await expectRows('clearing the search restores every row in Date Added order', '', ALL);

    check('the page made one contacts read and nothing else: no writes, no other request',
      same(log.filter((x) => x !== 'GET app-read-session'), ['GET ghl-contacts']) && foreign.length === 0, { log, foreign });
    check('no page errors', pageErrors.length === 0, pageErrors);
  } catch (e) {
    console.error(`FAIL  ${e.message}`);
    failures += 1;
  }

  console.log('');
  console.log(`checksRun=${checks} failures=${failures} floor=${FLOOR}${BEFORE_REV ? ` (negative control vs ${BEFORE_REV})` : ''}`);
  if (checks !== FLOOR) { console.error(`FAILED: expected exactly ${FLOOR} checks, ran ${checks}.`); return exit(2); }
  if (failures > 0) { console.error('FAILED'); return exit(1); }
  console.log('OK');
  return exit(0);
}

main();
