/**
 * B14-13 — "Call with AirDroid" in Seller Call, rendered.
 *
 * Vite serves scripts/harness/seller-call-airdroid -- the REAL
 * SellerCallVoiceControls with its stylesheet, above a stand-in script panel
 * and notes box -- in headless Chromium. The harness cancels every launch-link
 * click after recording it, so nothing reaches the operating system: no helper,
 * AirDroid or phone is involved, and nothing leaves the machine. Proves:
 *   - AirDroid is the first, primary option on its own row; GHL Phone (backup)
 *     and Cell follow, at desktop and phone widths;
 *   - the action is an ordinary link to launch contract v1
 *     (`iaos-airdroid:call?number=NNNNNNNNNN`, via the stand-in for Jeff's
 *     builder), opened by mouse or keyboard without the page cancelling it,
 *     navigating, opening a window or making any request;
 *   - the script and notes stay on screen and editable through a click;
 *   - afterwards the card says only what IAOS did (PROVISIONAL wording) and
 *     never that a number was prepared or a call dialled, connected or ended;
 *   - without a valid 10-digit US number the action is a disabled button with
 *     the reason, and GHL Phone stays offered; a new seller number resets it.
 *
 * NEGATIVE CONTROL: `node scripts/test-seller-call-airdroid.cjs --before=<rev>`
 * renders <rev>'s component and must FAIL (exit 1) for a revision without the
 * AirDroid option -- e.g. --before=45361c1.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const APP = path.resolve(__dirname, '..');
const HARNESS_DIR = path.join(APP, 'scripts/harness/seller-call-airdroid');
const HARNESS = '/scripts/harness/seller-call-airdroid/index.html';
const BEFORE_FILE = path.join(HARNESS_DIR, 'VoiceControlsBefore.tsx');
const beforeArg = process.argv.find((a) => a.startsWith('--before='));
const BEFORE_REV = beforeArg ? beforeArg.slice('--before='.length) : null;

/** Taken from the finished file, never back-filled from a passing run: 14 probe()/check() call sites + 1 inside the no-number loop x 3 numbers = 17. */
const FLOOR = 17;
let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}
/** One check whose steps may throw (e.g. no AirDroid link in the negative control): a throw is a FAIL, never a missing check. */
async function probe(name, fn) {
  try { const { ok, detail } = await fn(); check(name, ok, detail); } catch (e) { check(name, false, e.message.split('\n')[0]); }
}

if (fs.existsSync(BEFORE_FILE)) fs.rmSync(BEFORE_FILE);
if (BEFORE_REV) {
  const src = execFileSync('git', ['show', `${BEFORE_REV}:app/src/components/SellerCallVoiceControls.tsx`], { cwd: APP, encoding: 'utf8' });
  fs.writeFileSync(BEFORE_FILE, src.replace(/from "\.\.\/\.\.\//g, 'from "../../../').replace(/from "\.\.\/(?!\.\.\/)/g, 'from "../../../src/')
    .replace(/from "\.\//g, 'from "../../../src/components/').replace(/import "\.\//g, 'import "../../../src/components/'));
  console.log(`NEGATIVE CONTROL: rendering SellerCallVoiceControls from ${BEFORE_REV}; this run must fail.`);
}

const LINK = 'iaos-airdroid:call?number=2145550101';
const IDLE = 'Uses the IAOS AirDroid helper on this Windows PC. Your script and notes stay open here.';
const AFTER = (phone) => `IAOS handed the AirDroid link for ${phone} to this browser. IAOS gets no result back from the helper.`;
const NO_NUMBER = 'Unavailable: IAOS has no valid 10-digit US number for this seller. Use GHL Phone or Cell.';
const CLAIMS = /prepared|dial(?:l)?ed|connected|ended|calling|call (?:placed|started)|Check AirDroid and your phone|press Make Call/i;

const requests = [];
const pageErrors = [];
const watchdog = setTimeout(() => { console.error('FAIL  the suite did not finish within 5 minutes -- stopped'); process.exit(1); }, 5 * 60_000);

/** Card order, rows and styling, measured in the page. */
const LAYOUT = () => {
  const card = (id) => document.querySelector(`[data-testid="${id}"]`);
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width) }; };
  const cards = [...document.querySelectorAll('[data-testid="seller-call-modes"] > div')].map((d) => d.getAttribute('data-testid'));
  const link = document.querySelector('[data-testid="call-with-airdroid"]');
  const ghl = document.querySelector('[data-testid="open-ghl-contact"]');
  return {
    cards, section: rect(card('seller-call-modes')), airdroid: rect(card('call-with-airdroid-mode')), ghlCard: rect(card('call-with-ghl-mode')), cell: rect(card('call-with-cell-mode')),
    link: link ? { tag: link.tagName, href: link.getAttribute('href'), target: link.getAttribute('target'), text: link.textContent.trim(), bg: getComputedStyle(link).backgroundColor } : null,
    ghlBg: ghl ? getComputedStyle(ghl).backgroundColor : null,
    pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
};
const statusText = (page) => page.locator('[data-testid="airdroid-status"]').innerText().then((t) => t.trim());

async function main() {
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const tailwindcss = (await import('@tailwindcss/vite')).default;
  const { chromium } = require('playwright');
  const server = await createServer({
    root: APP, configFile: false, plugins: [react(), tailwindcss()], logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: [HARNESS.slice(1)], include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'lucide-react'] },
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
  const open = async (phone, width = 1440) => {
    const mobile = width < 768;
    const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: mobile, hasTouch: mobile });
    const page = await context.newPage();
    const popups = [];
    context.on('page', (p) => { if (p !== page) popups.push(p.url()); });
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await context.route('**/*', (r) => {
      const url = r.request().url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return r.continue();
      requests.push(`${r.request().method()} ${url}`);
      return r.abort();
    });
    await page.goto(`${base}${HARNESS}?phone=${encodeURIComponent(phone)}`, { timeout: 60000 });
    await page.getByTestId('seller-call-modes').waitFor({ timeout: 60000 });
    page.setDefaultTimeout(5000);
    return { context, page, popups };
  };

  try {
    {
      const { context, page, popups } = await open('(214) 555-0101');
      check('harness renders the expected component source', (await page.evaluate(() => window.__iaosSource)) === (BEFORE_REV ? 'before' : 'current'));
      await probe('desktop: AirDroid is the first card, on its own full row, above GHL Phone and Cell side by side', async () => {
        const l = await page.evaluate(LAYOUT);
        return { ok: l.cards.join('|') === 'call-with-airdroid-mode|call-with-ghl-mode|call-with-cell-mode' && l.airdroid.width === l.section.width
          && l.airdroid.top < l.ghlCard.top && l.ghlCard.top === l.cell.top && l.cell.left > l.ghlCard.left && !l.pageOverflow, detail: l };
      });
      await probe('the AirDroid action is a primary-styled link to exactly iaos-airdroid:call?number=2145550101, opening in place; GHL Phone is not primary', async () => {
        const l = await page.evaluate(LAYOUT);
        return { ok: l.link?.tag === 'A' && l.link.href === LINK && l.link.target === null && l.link.text === 'Call with AirDroid'
          && l.link.bg === 'rgb(0, 92, 230)' && l.ghlBg !== 'rgb(0, 92, 230)', detail: l };
      });
      await probe('before a click the card describes the action only', async () => ({ ok: (await statusText(page)) === IDLE, detail: await statusText(page) }));

      await page.getByTestId('notes').fill('Seller wants 30 days.');
      await probe('a click opens the link by ordinary navigation: not cancelled by the page, no navigation, window or request', async () => {
        const url = page.url();
        await page.getByTestId('call-with-airdroid').click();
        await page.waitForTimeout(300);
        const launches = await page.evaluate(() => window.__iaosLaunches);
        return { ok: same(launches, [{ href: LINK, defaultPrevented: false }]) && page.url() === url && popups.length === 0 && requests.length === 0,
          detail: { launches, url: page.url(), popups, requests } };
      });
      await probe('after the click the card says only what IAOS did, and claims nothing about the helper, number or call', async () => {
        const t = await statusText(page);
        const card = (await page.getByTestId('call-with-airdroid-mode').innerText()).replace('Call with AirDroid', '');
        return { ok: t === AFTER('214-555-0101') && !CLAIMS.test(card), detail: { t, card } };
      });
      await probe('the script and notes stay on screen through the click, and the notes keep their text and stay editable', async () => {
        const before = await page.getByTestId('notes').inputValue();
        await page.getByTestId('notes').press('End');
        await page.getByTestId('notes').type(' Call back Friday.');
        const after = await page.getByTestId('notes').inputValue();
        return { ok: before === 'Seller wants 30 days.' && after === 'Seller wants 30 days. Call back Friday.' && (await page.getByTestId('script-panel').isVisible()),
          detail: { before, after } };
      });
      await probe('keyboard: Tab to the link and Enter opens the same link', async () => {
        await page.evaluate(() => { window.__iaosLaunches = []; document.activeElement?.blur(); });
        await page.getByTestId('call-with-airdroid').focus();
        await page.keyboard.press('Enter');
        await page.waitForTimeout(200);
        const launches = await page.evaluate(() => window.__iaosLaunches);
        return { ok: same(launches, [{ href: LINK, defaultPrevented: false }]), detail: launches };
      });
      await probe('a new seller number resets the card to its description and points the link at the new number', async () => {
        await page.evaluate(() => window.__iaosSetPhone('+1 (469) 555-0123'));
        await page.waitForTimeout(100);
        const l = await page.evaluate(LAYOUT);
        return { ok: l.link?.href === 'iaos-airdroid:call?number=4695550123' && (await statusText(page)) === IDLE, detail: { href: l.link?.href, status: await statusText(page) } };
      });
      await probe('GHL Phone stays available as the backup', async () => ({ ok: await page.getByTestId('open-ghl-contact').isEnabled() && (await page.getByTestId('call-with-ghl-mode').innerText()).includes('Call with GHL Phone') }));
      await context.close();
    }

    for (const phone of ['', '555', '(114) 555-0101']) {
      const { context, page } = await open(phone);
      await probe(`no valid number ("${phone}"): no AirDroid link, a disabled AirDroid button with the reason; GHL Phone stays offered`, async () => {
        const links = await page.locator('a[href^="iaos-airdroid:"]').count();
        const btn = page.getByTestId('call-with-airdroid-unavailable');
        return { ok: links === 0 && (await btn.isDisabled()) && (await statusText(page)) === NO_NUMBER && (await page.getByTestId('open-ghl-contact').isEnabled()),
          detail: { links, status: await statusText(page).catch((e) => e.message) } };
      });
      await context.close();
    }
    {
      const { context, page } = await open('(214) 555-0101');
      await probe('clicking the disabled state never produces a launch', async () => {
        await page.evaluate(() => window.__iaosSetPhone('555'));
        await page.getByTestId('call-with-airdroid-unavailable').click({ force: true });
        await page.waitForTimeout(200);
        return { ok: (await page.evaluate(() => window.__iaosLaunches.length)) === 0 };
      });
      await context.close();
    }

    {
      const { context, page } = await open('(214) 555-0101', 375);
      await probe('phone width: one column, AirDroid first and full width, the link present, nothing scrolls sideways', async () => {
        const l = await page.evaluate(LAYOUT);
        return { ok: l.cards[0] === 'call-with-airdroid-mode' && l.airdroid.width === l.section.width && l.ghlCard.width === l.section.width
          && l.ghlCard.top > l.airdroid.top && l.cell.top > l.ghlCard.top && l.link?.href === LINK && !l.pageOverflow, detail: l };
      });
      await context.close();
    }

    check('no request left the page (no fetch, no function call, nothing off-machine)', requests.length === 0, requests);
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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

main();
