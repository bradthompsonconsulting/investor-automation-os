/**
 * B7-02 PropStream browser handoff -- browser verification.
 *
 * WHY THIS EXISTS ALONGSIDE test-propstream-handoff.cjs. That runner proves the
 * MODULE's branches against injected doubles, and it says so. It cannot prove
 * what a browser does with a real click -- and for this feature the browser IS
 * the mechanism. Two of the three things B7-02 had to establish are browser
 * facts, not module facts:
 *
 *   1. Does a programmatic window.open survive the click that triggered it,
 *      given that a clipboard write happens in the same handler? (Transient
 *      user activation. It did NOT, in the first ordering -- see the module.)
 *   2. Can a blocked popup be DETECTED from window.open's return value?
 *      (No, not with noopener set. The first implementation reported a block
 *      on a tab this harness watched open. See the note on HandoffResult.)
 *   3. What does the app do where the Clipboard API is not exposed at all?
 *
 * So this drives the REAL built application, with the REAL button, in a REAL
 * Chromium, and reads back what the browser actually did.
 *
 * OFFLINE, AND STRICTLY SO. It serves app/dist from localhost, fulfils every
 * /.netlify/functions/* request from a fixture in this file, and ABORTS any
 * request to propstream.com. No GHL, no PropStream, no deployed site, no
 * secret. Nothing here writes anything anywhere.
 *
 * Prerequisites:
 *   pnpm --dir app exec playwright install chromium
 *   pnpm --dir app build
 * Run:
 *   node app/scripts/verify-propstream-handoff.cjs
 *
 * NO BUILD-TIME SELECTOR IS NEEDED, and none must be added. Since Gate 4B-5 the
 * artifact is environment-identical and main.tsx fetches
 * /.netlify/functions/iaos-runtime-config before it imports App — so a build
 * with nothing set boots fine here as long as that ONE request is answered.
 * This harness answers it with projectRuntimeConfig(getConfig("test")), the
 * same projection the real function serves and the browser validates, so the
 * served and checked shapes cannot drift. "test", never "production": the app
 * only has to BOOT, and every GHL request is answered from the fixture below.
 *
 * NOT IN CI, deliberately -- it needs a browser download, which .github/
 * workflows/ci.yml excludes by name ("No Playwright and no live harnesses").
 * Same standing as the other verify-*.cjs harnesses in this directory.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const DIST = path.join(APP, 'dist');
const SHOTS = path.join(APP, '.propstream-verification');

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('ABORT: no build at ' + DIST + '. Run: pnpm --dir app build');
  process.exit(10);
}

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  console.error('ABORT: playwright not resolvable — ' + e.message);
  process.exit(10);
}

/** The runtime-config payload, from the real projection rather than a copy. */
const CONFIG_TMP = path.join(APP, '.tmp-propstream-verification-config');
function runtimeConfigPayload() {
  fs.rmSync(CONFIG_TMP, { recursive: true, force: true });
  fs.mkdirSync(CONFIG_TMP, { recursive: true });
  fs.writeFileSync(path.join(CONFIG_TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf8');
  require('child_process').execSync(
    'npx tsc "' + path.join(APP, 'shared', 'ghl-config.ts') +
      '" --outDir "' + CONFIG_TMP + '" --module commonjs --target es2020 --strict',
    { cwd: APP, stdio: 'inherit' },
  );
  const { getConfig, projectRuntimeConfig } = require(path.join(CONFIG_TMP, 'ghl-config.js'));
  return projectRuntimeConfig(getConfig('test'));
}

/** The fixture contact. A complete subject address, and nothing else populated. */
const CONTACT_ID = 'fixture-contact';
const EXPECTED_ADDRESS = '4821 SW 12th Ter, Cape Coral, FL 33914';
const CONTACT = {
  id: CONTACT_ID,
  firstName: 'Fixture', lastName: 'Seller',
  email: '', phone: '+15555550100',
  address1: '4821 SW 12th Ter', city: 'Cape Coral', state: 'FL', postalCode: '33914',
  dateAdded: '2026-09-01T00:00:00.000Z',
  tags: [], motivationScore: 0, dealScore: 0, combinedScore: 0,
  callbackDatetime: null, callbackDatetimePrecise: null,
  lastCallAttempt: null, lastCallAttemptPrecise: null,
  propertyAddress: '', phoneStatus: '',
  callDisposition: '', callRouting: '', dispositionAt: null,
};

/** A contact with NO city and NO state — the refusal case, in the real UI. */
const PARTIAL_ID = 'fixture-partial';
const PARTIAL = { ...CONTACT, id: PARTIAL_ID, city: '', state: '', postalCode: '' };

let checksRun = 0;
let failures = 0;
const names = new Set();
function check(name, ok, detail) {
  checksRun++;
  names.add(name);
  if (ok) console.log('PASS  ' + name + '  ' + (detail || ''));
  else { failures++; console.log('FAIL  ' + name + '  ' + (detail || '')); }
}

/** Literal call-site count taken from the finished file, never back-filled from a passing run.
 *  9 = secure context(6) + non-secure context(3). */
const FLOOR = 9;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

/** SPA server. Unknown paths fall back to index.html so /contacts/:id resolves. */
function serve() {
  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    let file = path.join(DIST, url);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/**
 * Fixture routing. Every GHL function is answered locally, and PropStream is
 * ABORTED — the tab must be observed to OPEN, which does not require it to
 * load, and this harness must not depend on a third party being up.
 */
async function installRoutes(context, runtimeConfig, requested) {
  /* Records the URL the browser ASKED for, then aborts. Reading page.url()
     instead would report chrome-error://chromewebdata/ for the aborted
     navigation and prove nothing about what was requested. */
  await context.route('**/*propstream.com/**', (route) => {
    if (requested) requested.push(route.request().url());
    route.abort();
  });
  await context.route('**/.netlify/functions/**', (route) => {
    const url = route.request().url();
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('iaos-runtime-config')) return json(runtimeConfig);
    if (url.includes('ghl-contact?id=')) {
      return json(decodeURIComponent(url.split('id=')[1]) === PARTIAL_ID ? PARTIAL : CONTACT);
    }
    if (url.includes('ghl-proxy')) return json({ contact: { ...CONTACT, customFields: [] } });
    if (url.includes('ghl-underwriting-policy')) return json({});
    return json([]);
  });
}

(async () => {
  fs.rmSync(SHOTS, { recursive: true, force: true });
  fs.mkdirSync(SHOTS, { recursive: true });

  const runtimeConfig = runtimeConfigPayload();
  const server = await serve();
  const port = server.address().port;

  const browser = await chromium.launch({
    // MAP sends a NON-localhost hostname to this server. Chromium treats
    // localhost as a secure context but iaos-nonsecure.test as insecure, which
    // is the only way to observe the no-Clipboard-API path in a real browser.
    args: ['--host-resolver-rules=MAP iaos-nonsecure.test 127.0.0.1'],
  });

  // ── Secure context (localhost). Clipboard API present. ───────────────────
  {
    const requested = [];
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    await installRoutes(context, runtimeConfig, requested);
    const page = await context.newPage();
    await page.goto(`http://localhost:${port}/contacts/${CONTACT_ID}`);
    /* main.tsx fails closed on a bad runtime-config payload and renders the
       refusal screen instead of App — in which case the wait below would time
       out saying only that a selector never appeared. Name the real cause. */
    const bodyText = await page.locator('body').innerText();
    if (/Configuration unavailable/.test(bodyText)) {
      console.error('ABORT: the app refused the fixture runtime configuration —\n' + bodyText);
      process.exit(10);
    }
    await page.waitForSelector('[data-testid="get-comps"]:not([disabled])', { timeout: 15000 });

    const pagesOpened = [];
    context.on('page', () => pagesOpened.push(1));

    await page.click('[data-testid="get-comps"]');
    await page.waitForSelector('[data-testid="comps-helper"]', { timeout: 10000 });
    await page.waitForTimeout(1500);

    const helper = page.locator('[data-testid="comps-helper"]');
    const clipboardAttr = await helper.getAttribute('data-comps-clipboard');
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    const shownAddress = (await page.locator('[data-testid="comps-address"]').innerText()).trim();

    check('secure-clipboard-holds-the-subject-address',
      clipboardText === EXPECTED_ADDRESS,
      JSON.stringify(clipboardText));
    check('secure-helper-reports-copied',
      clipboardAttr === 'copied', 'data-comps-clipboard=' + clipboardAttr);
    /* THE TRANSIENT-ACTIVATION CHECK, and the reason the module issues both
       browser calls before its first await. With the clipboard write AWAITED
       first, this was 0 pages and requested=[] -- the popup blocker took it on
       every click. */
    check('secure-exactly-one-tab-opened',
      pagesOpened.length === 1, 'pages opened: ' + pagesOpened.length);
    check('secure-tab-requested-the-login-url-unmodified',
      requested.length === 1 && requested[0] === 'https://login.propstream.com/',
      JSON.stringify(requested));
    check('secure-helper-displays-the-address-for-manual-reuse',
      shownAddress === EXPECTED_ADDRESS, JSON.stringify(shownAddress));
    /* The unconditional fallback. It is present on a SUCCESSFUL handoff, which
       is the whole point: there is no honest blocked-popup signal to gate it
       on, so it is never gated. */
    check('secure-open-propstream-fallback-is-always-offered',
      await page.locator('[data-testid="comps-open-propstream"]').getAttribute('href')
        === 'https://login.propstream.com/',
      'anchor present even though the tab opened');

    await page.screenshot({ path: path.join(SHOTS, 'secure-copied-and-opened.png'), fullPage: false });

    // The refusal case, in the real UI rather than in the module.
    const partial = await context.newPage();
    await partial.goto(`http://localhost:${port}/contacts/${PARTIAL_ID}`);
    await partial.waitForSelector('[data-testid="get-comps"]', { timeout: 15000 });
    await partial.waitForTimeout(1000);
    console.log('OBSERVED  partial-address button disabled=' +
      await partial.locator('[data-testid="get-comps"]').isDisabled() +
      '  title=' + JSON.stringify(await partial.locator('[data-testid="get-comps"]').getAttribute('title')));
    await partial.screenshot({ path: path.join(SHOTS, 'partial-address-disabled.png') });

    await context.close();
  }

  // ── Non-secure context. navigator.clipboard is not exposed at all. ───────
  {
    const requested = [];
    const context = await browser.newContext();
    await installRoutes(context, runtimeConfig, requested);
    const page = await context.newPage();
    await page.goto(`http://iaos-nonsecure.test:${port}/contacts/${CONTACT_ID}`);
    await page.waitForSelector('[data-testid="get-comps"]:not([disabled])', { timeout: 15000 });

    check('nonsecure-context-exposes-no-clipboard-api',
      await page.evaluate(() => !navigator.clipboard),
      'navigator.clipboard absent over plain http on a non-localhost host');

    await page.click('[data-testid="get-comps"]');
    await page.waitForSelector('[data-testid="comps-helper"]', { timeout: 10000 });
    await page.waitForTimeout(1500);

    const helper = page.locator('[data-testid="comps-helper"]');
    check('nonsecure-helper-reports-the-copy-failure',
      await helper.getAttribute('data-comps-clipboard') === 'denied',
      (await page.locator('[data-testid="comps-clipboard-message"]').innerText()).trim());
    /* THE FALLBACK IS THE POINT: the copy failed, and the handoff still worked
       because the address is on screen and PropStream still opened. */
    check('nonsecure-still-opens-propstream-and-shows-the-address',
      requested.length === 1 && requested[0] === 'https://login.propstream.com/' &&
      (await page.locator('[data-testid="comps-address"]').innerText()).trim() === EXPECTED_ADDRESS,
      JSON.stringify(requested));

    await page.screenshot({ path: path.join(SHOTS, 'nonsecure-manual-copy-fallback.png') });
    await context.close();
  }

  await browser.close();
  server.close();
  fs.rmSync(CONFIG_TMP, { recursive: true, force: true });

  console.log('');
  console.log('screenshots=' + SHOTS);
  console.log('checksRun=' + checksRun + ' uniqueNames=' + names.size + ' failures=' + failures + ' floor=' + FLOOR);
  if (names.size !== checksRun) { console.log('ABORT — name-collision detected'); process.exit(4); }
  if (checksRun !== FLOOR) { console.log('ABORT — expected ' + FLOOR + ' checks, ran ' + checksRun); process.exit(2); }
  if (failures > 0) { console.log('PROPSTREAM HANDOFF BROWSER RED'); process.exit(1); }
  console.log('OK');
})().catch((e) => { console.error('ABORT: ' + (e && e.stack || e)); process.exit(3); });
