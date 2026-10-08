/**
 * B15-12 (INV-110), Walkthrough 2 -- the Mailers "No Address" empty state.
 *
 * The page said "Everyone in a mail cadence has an address on file." when
 * nothing was listed. The digest it reads is built from mailer tasks and
 * carries no enrolment data, so an empty No Address list cannot tell "no
 * enrolled contacts" from "everyone enrolled has an address". The wording is
 * now neutral, as ruled: "No contacts missing an address were found."
 *
 * BEHAVIOUR, not source shape (Bones, review of 07644cd). Vite serves
 * scripts/harness/mailers -- the REAL Layout and Mailers page with the real
 * GHL client -- in headless Chromium, and every /.netlify/functions request
 * is answered here. Proves, for an empty digest, a digest with ready tasks
 * but no address gaps, and a digest with a no-address task:
 *   - the neutral sentence appears exactly when nothing is missing an address;
 *   - the old universal claim never appears;
 *   - a no-address task is listed, without the empty sentence;
 *   - Mark as Completed is unchanged (disabled with nothing selected);
 *   - each mount makes exactly one digest read and nothing else: no writes,
 *     no other GHL request, nothing off the machine.
 * Date-window and eligibility behaviour is covered by test-mailer-week.cjs.
 *
 * WRITE COVERAGE (Bones, review of 8ac1cad). The harness starts with a valid
 * offline write session, the activation read is answered OPEN, and every mount
 * must show the REAL Layout bound before anything is tested -- so a write the
 * page made would reach the network and fail the request check. (Unbound, the
 * client refuses writes before sending, and the request check could not see
 * them.) Every request still stays on this machine.
 *
 * CANARY: after every mount is recorded, the page makes one REAL completion
 * call; it must reach the intercepted network carrying the bound activation and
 * the session's bearer token. That proves, on every run, that a write by this
 * page could not go unseen.
 *
 * WRITE NEGATIVE CONTROL: `--inject-write` calls the REAL completion client
 * (ghl.mailers.completeTask) on each mount; the intercepted POST must make the
 * suite FAIL (exit 1).
 *
 * NEGATIVE CONTROL: `node scripts/test-mailers-empty-state.cjs --before=<rev>`
 * renders <rev>'s Mailers page (via `git show`) and must FAIL (exit 1) for a
 * revision with the old wording -- e.g. --before=20e9f4f.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const APP = path.resolve(__dirname, '..');
const HARNESS_DIR = path.join(APP, 'scripts/harness/mailers');
const HARNESS = '/scripts/harness/mailers/index.html';
const BEFORE_FILE = path.join(HARNESS_DIR, 'MailersBefore.tsx');
const beforeArg = process.argv.find((a) => a.startsWith('--before='));
const BEFORE_REV = beforeArg ? beforeArg.slice('--before='.length) : null;
const INJECT_WRITE = process.argv.includes('--inject-write');

const NEUTRAL = 'No contacts missing an address were found.';
const OLD_CLAIM = /mail cadence|has an address on file/i;

/** Literal call-site count taken from the finished file, never back-filled from a passing run. */
const FLOOR = 11;
let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}

if (fs.existsSync(BEFORE_FILE)) fs.rmSync(BEFORE_FILE);
if (BEFORE_REV) {
  const src = execFileSync('git', ['show', `${BEFORE_REV}:app/src/pages/Mailers.tsx`], { cwd: APP, encoding: 'utf8' });
  fs.writeFileSync(BEFORE_FILE, src.replace(/from "\.\.\//g, 'from "../../../src/'));
  console.log(`NEGATIVE CONTROL: rendering the Mailers page from ${BEFORE_REV}; this run must fail.`);
}

// ── Fixture digests ──────────────────────────────────────────────────────────
const row = (taskId, contactName, hasAddress) => ({
  taskId, contactId: `contact-${taskId}`, contactName, address: hasAddress ? '1 Main St, Austin, TX 78701' : '', hasAddress,
  tier: 'hot', mailerType: 'Primary', touchNumber: 1, dueDate: '2026-10-07T15:00:00.000Z', dueDateCT: '2026-10-07',
  completed: false, hasBusinessName: false, companyName: null,
});
const EMPTY = { weekStartCT: '2026-10-03', weekEndCT: '2026-10-09', thisWeekReady: [], thisWeekBusiness: [], overdue: [], noAddress: [],
  totals: { ready: 0, business: 0, overdue: 0, noAddress: 0, byMailerType: {} } };
const DIGESTS = {
  empty: EMPTY,
  readyNoGaps: { ...EMPTY, thisWeekReady: [{ key: 'hot-primary', label: 'Hot Primary', rows: [row('ready-1', 'Ready Addressed', true)] }],
    totals: { ...EMPTY.totals, ready: 1, byMailerType: { 'Hot Primary': 1 } } },
  oneNoAddress: { ...EMPTY, noAddress: [row('gap-1', 'Gap Noaddress', false)], totals: { ...EMPTY.totals, noAddress: 1 },
    // An unrelated extra response field must not matter to the page.
    diagnostics: { fixture: true } },
};

// The deployment's activation, answered OPEN (admissionSummary shape plus runtimeDeployId).
const ACTIVATION = { initialized: true, state: 'open', epoch: 1, activationId: 'act-fixture-mailers-1', deployId: 'deploy-fixture-1',
  runtimeDeployId: 'deploy-fixture-1', tickets: { admitted: 0, dispatching: 0, uncertain: 0 }, publication: null };
const writes = [];

let digest = EMPTY;
let log = [];
const foreign = [];
const watchdog = setTimeout(() => { console.error('FAIL  the suite did not finish within 5 minutes -- stopped'); process.exit(1); }, 5 * 60_000);

async function main() {
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const { chromium } = require('playwright');
  const server = await createServer({
    root: APP, configFile: false, plugins: [react()], logLevel: 'error', clearScreen: false,
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
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
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
      if (method !== 'GET') {
        const h = route.request().headers();
        writes.push({ request: `${method} ${fn}`, activation: h['x-iaos-activation'] ?? null,
          bearer: h.authorization === 'Bearer offline-fixture-write-session', body: route.request().postData() });
        return json(409, { error: 'fixture: writes are not answered', confirmed: false });
      }
      if (fn === 'app-read-session') return json(200, { signedIn: true, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
      if (fn === 'iaos-activation') return json(200, ACTIVATION);
      if (fn === 'ghl-mailers' && method === 'GET') return json(200, digest);
      return json(404, { error: `fixture: ${method} ${fn} not answered` });
    });

    const states = {};
    for (const [name, d] of Object.entries(DIGESTS)) {
      digest = d; log = [];
      await page.goto(`${base}${HARNESS}`);
      await page.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 });
      await page.evaluate(() => window.__iaosNavigate('/mailers'));
      await page.getByRole('heading', { name: 'No Address' }).waitFor({ timeout: 30000 });
      await page.waitForFunction(() => window.__iaosPageActivation && window.__iaosPageActivation() !== 'unbound'
        && window.__iaosPageActivation() !== 'binding', null, { timeout: 15000 }).catch(() => {});
      const activation = await page.evaluate(() => window.__iaosPageActivation && window.__iaosPageActivation());
      const writeSessionValid = await page.evaluate(() => !!window.__iaosWriteSession && Date.parse(window.__iaosWriteSession.expiresAt) > Date.now());
      if (INJECT_WRITE) {
        await page.evaluate(() => window.__iaosCompleteTask('contact-inject', 'task-inject').catch(() => null));
      }
      await page.waitForTimeout(300);
      const body = await page.innerText('body');
      const markButton = page.getByRole('button', { name: /Mark as Completed/ });
      states[name] = {
        neutralShown: body.includes(NEUTRAL),
        oldClaimShown: OLD_CLAIM.test(body),
        text: body,
        markDisabled: await markButton.isDisabled(),
        // Storage v2: Layout binds the page to the deployment's activation once per
        // page load (GET iaos-activation, read-only, not GHL). Only that exact read is
        // set aside, like the read-session check; anything else still fails below.
        requests: log.filter((r) => r !== 'GET app-read-session' && r !== 'GET iaos-activation'),
        activationReads: log.filter((r) => r === 'GET iaos-activation').length,
        activation,
        writeSessionValid,
        source: await page.evaluate(() => window.__iaosMailersSource),
      };
    }

    // Canary, after every mount is recorded: the page's own write path is observable.
    const before = writes.length;
    await page.evaluate(() => window.__iaosCompleteTask('contact-canary', 'task-canary').catch(() => null));
    await page.waitForTimeout(300);
    const canary = writes.slice(before);

    check('harness renders the expected Mailers source', Object.values(states).every((s) => s.source === (BEFORE_REV ? 'before' : 'current')));
    check('before testing, each mount has a valid offline write session and the real Layout binds it to the open activation (one activation read)',
      Object.values(states).every((s) => s.writeSessionValid && s.activation === 'bound' && s.activationReads === 1),
      Object.fromEntries(Object.entries(states).map(([n, s]) => [n, { writeSessionValid: s.writeSessionValid, activation: s.activation, activationReads: s.activationReads }])));
    check('empty digest: the neutral sentence is shown', states.empty.neutralShown);
    check('ready tasks but nothing missing an address: the neutral sentence is shown, and the ready task is listed',
      states.readyNoGaps.neutralShown && states.readyNoGaps.text.includes('Ready Addressed'));
    check('a task missing an address: its contact is listed and the neutral sentence is not shown',
      states.oneNoAddress.text.includes('Gap Noaddress') && !states.oneNoAddress.neutralShown);
    check('the old universal claim never appears', Object.values(states).every((s) => !s.oldClaimShown),
      Object.entries(states).filter(([, s]) => s.oldClaimShown).map(([n]) => n));
    check('Mark as Completed is unchanged: disabled with nothing selected', Object.values(states).every((s) => s.markDisabled));
    check('each mount makes exactly one digest read and no other GHL request',
      Object.values(states).every((s) => JSON.stringify(s.requests) === JSON.stringify(['GET ghl-mailers']) && s.activationReads <= 1),
      Object.fromEntries(Object.entries(states).map(([n, s]) => [n, [...s.requests, `activationReads=${s.activationReads}`]])));
    check('canary: a real completion call from this page reaches the intercepted network with the bound activation and session',
      canary.length === 1 && canary[0].request === 'POST ghl-write' && canary[0].activation === ACTIVATION.activationId && canary[0].bearer
        && JSON.parse(canary[0].body).operation === 'task.complete', canary);
    check('nothing left the machine', foreign.length === 0, foreign);
    check('no page errors', pageErrors.length === 0, pageErrors);
  } catch (e) {
    console.error(`FAIL  ${e.message}`);
    failures += 1;
  }

  console.log('');
  console.log(`fixture: activation ${ACTIVATION.activationId} (state ${ACTIVATION.state}, deploy ${ACTIVATION.deployId} = runtime ${ACTIVATION.runtimeDeployId}); intercepted writes=${JSON.stringify(writes)}`);
  console.log(`checksRun=${checks} failures=${failures} floor=${FLOOR}${BEFORE_REV ? ` (negative control vs ${BEFORE_REV})` : ''}`);
  if (checks !== FLOOR) { console.error(`FAILED: expected exactly ${FLOOR} checks, ran ${checks}.`); return exit(2); }
  if (failures > 0) { console.error('FAILED'); return exit(1); }
  console.log('OK');
  return exit(0);
}

main();
