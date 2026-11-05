/**
 * B15-12 (INV-110) -- an open Mailers page never labels a previous Saturday–Friday week as "This Week".
 *
 * Batch 5 (20e9f4f, accepted) computes the current window on the SERVER (test-mailer-week.cjs: Central-time boundaries,
 * DST, month/year ends). Remaining defect: the page read the digest once, so a tab left open past Friday 23:59 Central
 * -- or a computer waking from sleep -- kept titling last week's lists "This Week". Now the page re-evaluates (every
 * minute, and on focus / visibility; no request) and, once the Central date is past the window's Friday, says the week
 * ended and offers the current one. No automatic re-read.
 *
 * Offline: U = the pure helper (src/lib/mailer-week.ts); W = the REAL Layout + Mailers page (scripts/harness/mailers)
 * in headless Chromium with a controlled browser clock (Playwright page.clock); every function answered locally.
 *
 * NEGATIVE CONTROL: --before=<rev> renders <rev>'s Mailers page (the harness's MailersBefore.tsx) and must FAIL.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');

const APP = path.resolve(__dirname, '..');
const HARNESS_DIR = path.join(APP, 'scripts/harness/mailers');
const HARNESS = '/scripts/harness/mailers/index.html';
const BEFORE_FILE = path.join(HARNESS_DIR, 'MailersBefore.tsx');
const beforeArg = process.argv.find((a) => a.startsWith('--before='));
const BEFORE_REV = beforeArg ? beforeArg.slice('--before='.length) : null;

/** Literal check() call sites: U 2 + W 8 + X 1 = 11. */
const FLOOR = 11;
let checks = 0; let failures = 0;
function check(name, ok, detail) {
  checks += 1; if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail).slice(0, 300)}`}`);
}
const tryOr = (fn, dflt) => { try { return fn(); } catch { return dflt; } };
if (fs.existsSync(BEFORE_FILE)) fs.rmSync(BEFORE_FILE);
const show = (p) => execFileSync('git', ['show', `${BEFORE_REV}:app/${p}`], { cwd: APP, encoding: 'utf8' });
if (BEFORE_REV) {
  fs.writeFileSync(BEFORE_FILE, show('src/pages/Mailers.tsx').replace(/from "\.\.\//g, 'from "../../../src/'));
  console.log(`NEGATIVE CONTROL: rendering the Mailers page from ${BEFORE_REV}; this run must fail.`);
}
const watchdog = setTimeout(() => { console.error('FAIL  the suite did not finish within 5 minutes -- stopped'); process.exit(1); }, 5 * 60_000);

Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, filename);

const row = (taskId, name, dueCT) => ({ taskId, contactId: `contact-${taskId}`, contactName: name, address: '1 Main St, Austin, TX 78701', hasAddress: true,
  tier: 'hot', mailerType: 'Primary', touchNumber: 1, dueDate: `${dueCT}T15:00:00.000Z`, dueDateCT: dueCT, completed: false, hasBusinessName: false, companyName: null });
const digestFor = (start, end, title) => ({ weekStartCT: start, weekEndCT: end,
  thisWeekReady: [{ key: 'hot-primary', label: 'Hot Primary', rows: [row(`r-${start}`, title, end)] }], thisWeekBusiness: [], overdue: [], noAddress: [],
  totals: { ready: 1, business: 0, overdue: 0, noAddress: 0, byMailerType: { 'Hot Primary': 1 } } });

async function main() {
  // ───────────── U: the pure helper ─────────────
  const MW = BEFORE_REV ? tryOr(() => { const t = path.join(APP, 'src/lib/_b15_12_before_mailer_week.ts'); fs.writeFileSync(t, show('src/lib/mailer-week.ts')); try { return require(t); } finally { fs.rmSync(t); } }, null)
    : tryOr(() => require('../src/lib/mailer-week.ts'), null);
  const e = (end, iso) => tryOr(() => MW.weekEnded(end, new Date(iso)), 'ERR');
  const u1 = [e('2026-10-09', '2026-10-10T04:59:59Z'), e('2026-10-09', '2026-10-10T05:00:00Z'), e('2026-10-09', '2026-10-10T02:00:00Z'), e('2026-11-06', '2026-11-01T07:30:00Z')];
  check('U1 ended only after Friday 23:59 CENTRAL (CDT): Fri 23:59:59 CDT no, Sat 00:00 CDT yes, Saturday-in-UTC-but-Friday-in-Chicago no, DST-end Sunday mid-week no',
    JSON.stringify(u1) === JSON.stringify([false, true, false, false]), u1);
  const u2 = [e('2027-01-01', '2027-01-02T05:59:59Z'), e('2027-01-01', '2027-01-02T06:00:00Z'), e('2026-11-13', '2026-11-14T06:00:00Z'), e('2026-03-13', '2026-03-14T05:00:00Z'), e('bad', '2030-01-01T00:00:00Z')];
  check('U2 year end (CST), a CST Friday, a CDT Friday after the March DST change; a malformed date is never "ended"',
    JSON.stringify(u2) === JSON.stringify([false, true, true, true, false]), u2);

  // ───────────── W: the real page with a controlled clock ─────────────
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const { chromium } = require('playwright');
  const server = await createServer({
    root: APP, configFile: false, plugins: [react()], logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: [HARNESS.slice(1)], include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] },
  });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const exit = async (code) => { clearTimeout(watchdog); await browser.close().catch(() => {}); await server.close().catch(() => {}); if (fs.existsSync(BEFORE_FILE)) fs.rmSync(BEFORE_FILE); process.exit(code); };
  const foreign = []; const pageErrors = []; let log = []; let digests = [];
  async function open(startIso) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await context.newPage();
    page.on('pageerror', (er) => pageErrors.push(String(er)));
    await page.clock.install({ time: new Date(startIso) });
    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { foreign.push(url); return route.abort(); }
      const fn = new URL(url).pathname.replace('/.netlify/functions/', ''); const method = route.request().method();
      log.push(`${method} ${fn}`);
      const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (fn === 'app-read-session') return json(200, { signedIn: true, expiresAt: '2030-01-01T00:00:00.000Z' });
      if (fn === 'ghl-mailers' && method === 'GET') return json(200, digests.length > 1 ? digests.shift() : digests[0]);
      return json(404, { error: `fixture: ${method} ${fn} not answered` });
    });
    await page.goto(`${base}${HARNESS}`);
    await page.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 });
    await page.evaluate(() => window.__iaosNavigate('/mailers'));
    await page.getByRole('heading', { name: 'No Address' }).waitFor({ timeout: 30000 });
    return { context, page };
  }
  const body = (page) => page.innerText('body').catch(() => '');
  const settle = async (page, re, ms = 8000) => { const t0 = Date.now(); let b = ''; while (Date.now() - t0 < ms) { b = await body(page); if (re.test(b)) return b; await page.waitForTimeout(100); } return b; };
  try {
    // W1-W4: a page opened Wed Oct 7 (CDT) for the week Oct 3-9, left open across Friday midnight Central.
    digests = [digestFor('2026-10-03', '2026-10-09', 'Fixture Week One'), digestFor('2026-10-10', '2026-10-16', 'Fixture Week Two')];
    log = [];
    let { context, page } = await open('2026-10-07T17:00:00Z');
    const b1 = await body(page);
    check('W1 during the week: "This Week — Ready to Mail" for Oct 3–9, no ended notice', /This Week — Ready to Mail/.test(b1) && /week of 2026-10-03 – 2026-10-09/.test(b1) && !/ended/.test(b1), b1.slice(0, 300));
    await page.clock.setSystemTime(new Date('2026-10-10T04:58:00Z'));   // Fri 23:58 CDT; the next 61 s stay inside Friday
    await page.clock.runFor(61_000);
    const b2 = await body(page);
    check('W2 Friday 23:59 Central (already Saturday in UTC): still the current week -- not ended', /This Week — Ready to Mail/.test(b2) && !/ended/.test(b2), b2.slice(0, 200));
    await page.clock.runFor(121_000);                                    // past Sat 00:00 CDT: at least one re-check after midnight
    const b3 = await settle(page, /ended/);
    check('W3 page left open past Friday midnight Central: titled "Week of 2026-10-03 – 2026-10-09 (ended)", the notice says so, "This Week" is gone',
      /Week of 2026-10-03 – 2026-10-09 \(ended\) — Ready to Mail/.test(b3) && /This week ended on Friday 2026-10-09/.test(b3) && !/This Week — /.test(b3) && /week of 2026-10-03 – 2026-10-09 \(ended\)/.test(b3), b3.slice(0, 400));
    check('W4 noticing the ended week sends NO request (one digest read so far; no automatic re-read)', log.filter((l) => l === 'GET ghl-mailers').length === 1, log);
    await page.getByTestId('mailers-week-reload').click().catch(() => {});
    const b5 = await settle(page, /Fixture Week Two/);
    check('W5 "Show the current week" reads once more and the page shows Oct 10–16 as This Week, notice gone',
      /This Week — Ready to Mail/.test(b5) && /week of 2026-10-10 – 2026-10-16/.test(b5) && !/ended/.test(b5) && log.filter((l) => l === 'GET ghl-mailers').length === 2, [b5.slice(0, 300), log]);
    await context.close();
    // W6: a sleeping computer -- no timer runs; the clock jumps to Monday; focus re-evaluates.
    digests = [digestFor('2026-12-26', '2027-01-01', 'Fixture Year End')]; log = [];
    ({ context, page } = await open('2026-12-31T18:00:00Z'));
    const y1 = await body(page);
    await page.clock.setSystemTime(new Date('2027-01-04T15:00:00Z'));    // Monday after the year-end week, no timers fired
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    const y2 = await settle(page, /ended/);
    check('W6 year end + sleep: Thu Dec 31 shows This Week Dec 26 – Jan 1; after waking on Monday (focus, no timer) it says the week ended, no new request',
      /This Week — Ready to Mail/.test(y1) && /Week of 2026-12-26 – 2027-01-01 \(ended\)/.test(y2) && log.filter((l) => l === 'GET ghl-mailers').length === 1, [y1.slice(0, 160), y2.slice(0, 200), log]);
    await context.close();
    // W7: the DST change inside a week does not end it early (Sun Nov 1 2026, 01:30 CST).
    digests = [digestFor('2026-10-31', '2026-11-06', 'Fixture DST')]; log = [];
    ({ context, page } = await open('2026-11-01T05:30:00Z'));
    await page.clock.setSystemTime(new Date('2026-11-01T07:30:00Z'));
    await page.clock.runFor(61_000);
    const d1 = await body(page);
    check('W7 across the November DST change the week Oct 31 – Nov 6 is still "This Week"', /This Week — Ready to Mail/.test(d1) && !/ended/.test(d1), d1.slice(0, 200));
    await context.close();
    check('W8 reads only (GET), nothing left the machine, no page errors', log.every((l) => l.startsWith('GET ')) && foreign.length === 0 && pageErrors.length === 0, { foreign, pageErrors });
  } catch (er) { console.error(`FAIL  rendered: ${er.message}`); failures += 1; }

  // ───────────── X: source ─────────────
  const src = BEFORE_REV ? tryOr(() => show('src/pages/Mailers.tsx'), '') : fs.readFileSync(path.join(APP, 'src/pages/Mailers.tsx'), 'utf8');
  check('X1 the ended check never re-reads by itself (the timer and focus only re-evaluate); the ruled No-Address sentence and Mark as Completed are unchanged',
    /setInterval\(tick, WEEK_RECHECK_MS\)/.test(src) && !/setInterval\([^)]*load\(/.test(src) && /No contacts missing an address were found\./.test(src) && /Mark as Completed/.test(src));

  console.log(`\nchecksRun=${checks} failures=${failures} floor=${FLOOR}${BEFORE_REV ? ` (negative control vs ${BEFORE_REV})` : ''}`);
  if (checks !== FLOOR) { console.error(`FAILED: expected exactly ${FLOOR} checks, ran ${checks}.`); return exit(2); }
  if (failures > 0) { console.error('FAILED'); return exit(1); }
  console.log('OK'); return exit(0);
}
main().catch((er) => { console.error(`FAIL  startup: ${er && er.stack || er}`); if (fs.existsSync(BEFORE_FILE)) fs.rmSync(BEFORE_FILE); process.exit(2); });
