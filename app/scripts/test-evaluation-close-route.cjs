/**
 * B15-04 close (design r3 C1/C2; Bones implementation clearance 2026-10-20) -- T-ROUTE and T-RECOVERY on the
 * PRODUCTION BUILD. `vite build` builds the real app (index.html -> main.tsx boot -> runtime config ->
 * App -> Layout -> /evaluation-close) into a temporary directory, a local static server serves it, and headless
 * Chromium enters /evaluation-close directly by URL. EVERY request is intercepted and recorded; nothing leaves
 * the machine (Google Fonts are recorded and answered empty; the read/write sign-in popups are synthetic pages).
 *
 * Allowed before a deliberate close: static assets of the build, the Google Fonts requests, GET
 * iaos-runtime-config, GET/DELETE app-read-session, the synthetic sign-in pages. Prohibited throughout: any
 * other function (GHL data, Contacts/Dashboard loaders, mailer), any other host, any property-answer action
 * before the click, and any automatic close. After a click: exactly one property-answer `close`. Recovery
 * (after an acknowledged close only): exactly `context` then `drafts` for the chosen pair.
 *
 * Offline; no credential (synthetic tokens), no network.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const Module = require('node:module');
const ts = require('typescript');
const APP = path.resolve(__dirname, '..');

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) {
  if (name.startsWith('.') && parent) { const c = path.resolve(path.dirname(parent.filename), name + '.ts'); if (fs.existsSync(c)) return c; }
  return originalResolve.call(this, name, parent, ...rest);
};
Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
const cfg = require('../shared/ghl-config.ts');
// Committed Test is DEACTIVATED, so its projection is disabled; this suite projects from an in-memory enabled copy
// so the accepted route/recovery checks still run against the two reviewed pairs. Fatal (not counted) if either fails.
const TEST_CFG = cfg.getConfig('test');
const COMMITTED_TEST_RECOVERY = cfg.projectRuntimeConfig(TEST_CFG, 'test').propertyAnswerRecovery;
if (TEST_CFG.propertyAnswerEvaluation.enabled !== cfg.PROPERTY_ANSWER_EVALUATION_DISABLED || JSON.stringify(COMMITTED_TEST_RECOVERY) !== JSON.stringify({ enabled: false, pairs: [] })) {
  console.error('FAIL  committed Test evaluation must be DISABLED and project the close page disabled', JSON.stringify(COMMITTED_TEST_RECOVERY)); process.exit(1);
}
TEST_CFG.propertyAnswerEvaluation.enabled = cfg.PROPERTY_ANSWER_EVALUATION_ENABLED;
const RUNTIME = cfg.projectRuntimeConfig(TEST_CFG, 'test');
const PAIRS = RUNTIME.propertyAnswerRecovery.pairs;
const PROD_RUNTIME = cfg.projectRuntimeConfig(cfg.getConfig('production'), 'production');

/** Checks run, counted from the finished file. */
const FLOOR = 44;
let checks = 0, failures = 0;
function check(name, ok, detail) {
  checks += 1; if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}
const watchdog = setTimeout(() => { console.error('FAIL  the suite did not finish within 8 minutes -- stopped'); process.exit(1); }, 8 * 60_000);

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const OPERATOR = 'brad@example.invalid';
const writeToken = () => `${b64u({ alg: 'HS256' })}.${b64u({ sub: OPERATOR, iat: Math.floor(Date.now() / 1000) })}.synthetic-signature`;
const DIGEST = crypto.createHash('sha256').update(OPERATOR).digest('hex');
const ALLOWED_FN = new Set(['GET iaos-runtime-config', 'GET app-read-session', 'DELETE app-read-session']);

async function main() {
  const { build } = await import('vite');
  const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'iaos-close-route-'));
  await build({ root: APP, logLevel: 'error', build: { outDir: OUT, emptyOutDir: true } });
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); let f = path.join(OUT, decodeURIComponent(u.pathname));
    if (!f.startsWith(OUT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(OUT, 'index.html');
    const type = f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }); res.end(fs.readFileSync(f));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const exit = async (code) => { clearTimeout(watchdog); await browser.close().catch(() => {}); server.close(); fs.rmSync(OUT, { recursive: true, force: true }); process.exit(code); };

  /**
   * One fresh browser context. state.readSignedIn: the read-session answer; state.writeExpiresInMs: the synthetic
   * write session's lifetime; state.closeModes: answers for successive close calls ('closed' | '503' | 'abort' | 'slow');
   * state.runtime: the runtime-config payload.
   */
  async function open(opts = {}) {
    const state = { readSignedIn: true, writeExpiresInMs: 600_000, closeModes: [], runtime: RUNTIME, ...opts };
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const log = []; const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await context.route('**/*', async (route) => {
      const req = route.request(); const url = new URL(req.url());
      const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com') { log.push({ kind: 'font', url: url.href }); return route.fulfill({ status: 200, contentType: url.host === 'fonts.googleapis.com' ? 'text/css' : 'font/woff2', body: '' }); }
      if (url.origin !== base) { log.push({ kind: 'foreign', url: url.href }); return route.abort(); }
      if (url.pathname === '/app-write-login.html') {
        log.push({ kind: 'signin', what: 'write' });
        const session = { token: writeToken(), expiresAt: new Date(Date.now() + state.writeExpiresInMs).toISOString() };
        return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><script>window.opener.postMessage(${JSON.stringify({ type: 'iaos-app-write-session', session })}, location.origin)</script>` });
      }
      if (url.pathname === '/app-read-login.html') {
        log.push({ kind: 'signin', what: 'read' }); state.readSignedIn = true;
        return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><script>window.opener.postMessage({ type: 'iaos-app-read-signed-in' }, location.origin)</script>` });
      }
      if (!url.pathname.startsWith('/.netlify/functions/')) { log.push({ kind: 'static', path: url.pathname }); return route.continue(); }
      const fn = url.pathname.slice('/.netlify/functions/'.length);
      const entry = { kind: 'fn', key: `${req.method()} ${fn}`, body: req.postData() ? JSON.parse(req.postData()) : null };
      log.push(entry);
      if (entry.key === 'GET iaos-runtime-config') return json(200, state.runtime);
      if (fn === 'app-read-session') return json(200, state.readSignedIn ? { clientId: 'synthetic', signedIn: true, expiresAt: new Date(Date.now() + 3600_000).toISOString() } : { clientId: 'synthetic', signedIn: false, expiresAt: null });
      if (entry.key === 'POST property-answer') {
        const b = entry.body;
        if (b.action === 'close') {
          const mode = state.closeModes.shift() ?? 'closed';
          if (mode === 'abort') return route.abort();
          if (mode === '503') return json(503, { outcome: 'close_unknown', code: 'close_unknown', error: 'The close was not confirmed; it may or may not be stored. The evaluation stays on hold. You may try Close again deliberately.', operatorDigest: DIGEST });
          if (mode === 'slow') await new Promise((r) => setTimeout(r, 1500));
          return json(200, { outcome: 'closed', message: 'The evaluation\'s request budget is durably stopped. New property-answer GHL actions are refused. Work already admitted may still finish; this is not a cancellation. Drafts stay recoverable.', operatorDigest: DIGEST });
        }
        if (b.action === 'context') return json(409, { outcome: 'not_sent', code: 'budget_stopped', error: 'The evaluation is stopped (operator_close). This request sent nothing to GHL.', access: 'none', operatorDigest: DIGEST });
        if (b.action === 'drafts') return json(200, { outcome: 'drafts', drafts: { seller_reason: { state: 'present', value: 'Recovered reason text', savedAt: new Date().toISOString() }, property_address: { state: 'absent' } }, notice: 'Saved draft for a previously observed contact/deal association.', operatorDigest: DIGEST });
        return json(500, { error: 'fixture: action not expected' });
      }
      return json(404, { error: `fixture: ${fn} not answered` });
    });
    await page.goto(`${base}${opts.start ?? '/evaluation-close'}`);
    return { context, page, log, pageErrors, state };
  }
  const fns = (log) => log.filter((x) => x.kind === 'fn');
  const pa = (log) => fns(log).filter((x) => x.key === 'POST property-answer');
  const unexpected = (log) => log.filter((x) => x.kind === 'foreign' || (x.kind === 'fn' && !ALLOWED_FN.has(x.key) && x.key !== 'POST property-answer'));
  const settle = (page, ms = 1200) => page.waitForTimeout(ms);
  const writeSignIn = async (page) => { await page.getByTitle('Sign in for application writes').click(); await page.getByText(/Saving enabled until/).waitFor({ timeout: 15000 }); };
  const closeButton = (page) => page.getByTestId('evaluation-close-button');
  const result = (page) => page.getByTestId('evaluation-close-result');
  const closeBodiesOk = (log) => pa(log).every((x) => x.body.action === 'close' && JSON.stringify(Object.keys(x.body)) === '["action","contactId","opportunityId"]' && x.body.contactId === PAIRS[0].contactId && x.body.opportunityId === PAIRS[0].opportunityId);

  try {
    check('runtime projection carries exactly the two reviewed pairs', PAIRS.length === 2 && PAIRS[0].contactId === 'pYE98meKVyRrbzEt6MMR' && PAIRS[1].opportunityId === 'HCTa65siD41bA9XGpQWM', PAIRS);

    // 1. Fresh entry, signed out: boot + Layout only; no data, no property-answer, no sign-in until clicked.
    {
      const s = await open({ readSignedIn: false });
      await s.page.getByText('Sign in to IAOS').waitFor({ timeout: 30000 }).catch(() => {});
      await settle(s.page);
      check('signed out: the read sign-in screen shows; the close page is not mounted', (await s.page.getByText('Sign in to IAOS').isVisible()) && (await closeButton(s.page).count()) === 0);
      check('signed out: only boot/session requests (runtime config, read session) -- no property-answer, no other function, no foreign host', unexpected(s.log).length === 0 && pa(s.log).length === 0 && fns(s.log).some((x) => x.key === 'GET iaos-runtime-config'), s.log);
      check('signed out: Google Fonts requests are present and recorded (inventoried, answered offline)', s.log.some((x) => x.kind === 'font'), s.log.filter((x) => x.kind === 'font'));
      await s.page.getByRole('button', { name: 'Sign in' }).click();
      await closeButton(s.page).waitFor({ timeout: 15000 }).catch(() => {});
      await settle(s.page);
      check('after a (synthetic) read sign-in the close page mounts; still nothing sent to property-answer', (await closeButton(s.page).count()) === 1 && pa(s.log).length === 0 && unexpected(s.log).length === 0, s.log);
      check('fresh entry: no page error', s.pageErrors.length === 0, s.pageErrors);
      await s.context.close();
    }

    // 2. Existing read session, no write session: mount sends nothing; Close without a write session sends nothing.
    {
      const s = await open();
      await closeButton(s.page).waitFor({ timeout: 30000 }).catch(() => {});
      await settle(s.page, 2500);
      check('existing read session: the close page renders with its warning text (no cancellation claim)', await s.page.getByText(/does not cancel work already admitted/).isVisible());
      check('mount: ZERO property-answer requests and no unexpected request over 2.5 s', pa(s.log).length === 0 && unexpected(s.log).length === 0, s.log);
      check('mount: no recovery offered before a close', (await s.page.getByTestId('evaluation-recovery').count()) === 0);
      await closeButton(s.page).click(); await result(s.page).waitFor({ timeout: 10000 }).catch(() => {});
      check('absent write session: Close sends NOTHING and says so', pa(s.log).length === 0 && (await result(s.page).getAttribute('data-kind')) === 'sign_in', s.log);
      check('absent write session: no unexpected request, no page error', unexpected(s.log).length === 0 && s.pageErrors.length === 0, { u: unexpected(s.log), e: s.pageErrors });
      await s.context.close();
    }

    // 3. Expired write session: the expiry timer turns saving off; Close sends nothing.
    {
      const s = await open({ writeExpiresInMs: 2500 });
      await closeButton(s.page).waitFor({ timeout: 30000 });
      await writeSignIn(s.page);
      await s.page.getByText(/Saving session expired/).waitFor({ timeout: 10000 }).catch(() => {});
      await closeButton(s.page).click(); await result(s.page).waitFor({ timeout: 10000 }).catch(() => {});
      check('expired write session: Close sends nothing (sign-in needed)', pa(s.log).length === 0 && (await result(s.page).getAttribute('data-kind')) === 'sign_in', s.log);
      check('expired write session: the expiry did not trigger any request of its own', unexpected(s.log).length === 0, s.log);
      await s.context.close();
    }

    // 4. Acknowledged close; double click while pending; then recovery for ONE pair.
    {
      const s = await open({ closeModes: ['slow'] });
      await closeButton(s.page).waitFor({ timeout: 30000 });
      await writeSignIn(s.page); await settle(s.page);
      check('write sign-in itself sends no property-answer request', pa(s.log).length === 0, s.log);
      await closeButton(s.page).dblclick();
      await s.page.getByTestId('evaluation-close-result').waitFor({ timeout: 15000 });
      await settle(s.page);
      check('double click while pending: exactly ONE close POST', pa(s.log).length === 1, pa(s.log));
      check('the close body is exactly {action, contactId, opportunityId} with the FIRST reviewed pair', closeBodiesOk(s.log), pa(s.log));
      check('acknowledged: result "closed" shown with the no-cancellation wording', (await result(s.page).getAttribute('data-kind')) === 'closed' && /not a cancellation/.test(await result(s.page).innerText()));
      check('after closed: the Close button is gone (no further close possible)', (await closeButton(s.page).count()) === 0);
      check('after closed: no automatic request followed the close (still exactly one POST, nothing else unexpected)', pa(s.log).length === 1 && unexpected(s.log).length === 0, s.log);
      check('after closed: recovery is offered for exactly the two reviewed pairs, nothing mounted yet', (await s.page.getByTestId('evaluation-recovery-pair-0').count()) === 1 && (await s.page.getByTestId('evaluation-recovery-pair-1').count()) === 1 && (await s.page.getByTestId('evaluation-recovery-panel').count()) === 0);
      const before = pa(s.log).length;
      await s.page.getByTestId('evaluation-recovery-pair-1').click();
      await s.page.locator('[data-testid="pa-recovery"], textarea, input').first().waitFor({ timeout: 15000 }).catch(() => {});
      await settle(s.page, 2000);
      const rec = pa(s.log).slice(before);
      check('recovery: exactly TWO property-answer requests, context then drafts', rec.length === 2 && rec[0].body.action === 'context' && rec[1].body.action === 'drafts', rec);
      check('recovery: both for the chosen pair (pair 2: Y2 / Deal F) only', rec.every((x) => x.body.contactId === PAIRS[1].contactId && x.body.opportunityId === PAIRS[1].opportunityId), rec);
      const shown = await s.page.evaluate(() => [document.body.innerText, ...[...document.querySelectorAll('textarea, input')].map((x) => x.value)].join(' | '));
      check('recovery: the recovered draft text is shown', shown.includes('Recovered reason text'), shown.slice(0, 400));
      check('recovery: no save, history, check or draft write was sent; no other function; no foreign host', !pa(s.log).some((x) => ['save', 'history', 'check', 'draft'].includes(x.body.action)) && unexpected(s.log).length === 0, s.log);
      check('recovery: ContactWorkspace loaders never ran (no ghl-* or other data function at all)', !fns(s.log).some((x) => /ghl-|call-|current-offer|voice-|mailer/.test(x.key)), fns(s.log));
      check('close + recovery: no page error', s.pageErrors.length === 0, s.pageErrors);

      // 5. Read-session lapse and recovery on the same page: no close is repeated, attempts kept.
      s.state.readSignedIn = false;
      await s.page.evaluate(() => window.dispatchEvent(new Event('iaos-read-session-lost')));
      await s.page.getByText(/Your sign-in has ended/).waitFor({ timeout: 10000 }).catch(() => {});
      s.state.readSignedIn = true;
      await s.page.evaluate(() => window.dispatchEvent(new Event('iaos-read-session-lost')));
      await s.page.getByTestId('evaluation-close-attempts').waitFor({ timeout: 10000 }).catch(() => {});
      await settle(s.page, 2000);
      const closes = pa(s.log).filter((x) => x.body.action === 'close').length;
      check('read lapse + recovery: the page kept its closed state and attempt list; NO close was re-sent', closes === 1 && (await s.page.getByTestId('evaluation-close-attempts').count()) === 1, pa(s.log));
      check('read lapse + recovery: only session checks and the panel\'s own refresh were sent (no unexpected request)', unexpected(s.log).length === 0, s.log);
      await s.context.close();
    }

    // 6. close_unknown (503), then a lost reply (abort), then a deliberate manual repeat -> closed.
    {
      const s = await open({ closeModes: ['503', 'abort', 'closed'] });
      await closeButton(s.page).waitFor({ timeout: 30000 }); await writeSignIn(s.page);
      await closeButton(s.page).click(); await result(s.page).waitFor({ timeout: 10000 });
      await settle(s.page, 2500);
      check('503: shown as UNKNOWN (on hold), with the server text', (await result(s.page).getAttribute('data-kind')) === 'unknown' && /may or may not be stored/.test(await result(s.page).innerText()));
      check('503: NO automatic retry over 2.5 s (exactly one POST)', pa(s.log).length === 1, pa(s.log));
      check('UNKNOWN: no recovery is offered while closure is unknown', (await s.page.getByTestId('evaluation-recovery').count()) === 0);
      check('UNKNOWN: the button now reads "Close again" (manual repeat only)', (await closeButton(s.page).innerText()).includes('Close again'));
      await closeButton(s.page).click(); await s.page.waitForFunction(() => document.querySelectorAll('[data-testid="evaluation-close-attempts"] li').length === 2, null, { timeout: 10000 }).catch(() => {});
      await settle(s.page, 2500);
      check('lost reply (aborted): UNKNOWN, still no automatic retry (exactly two POSTs)', (await result(s.page).getAttribute('data-kind')) === 'unknown' && pa(s.log).length === 2, pa(s.log));
      await closeButton(s.page).click(); await s.page.waitForFunction(() => document.querySelectorAll('[data-testid="evaluation-close-attempts"] li').length === 3, null, { timeout: 10000 }).catch(() => {});
      check('deliberate manual repeat: closed; three attempts recorded, each with its own outcome', (await result(s.page).getAttribute('data-kind')) === 'closed' && (await s.page.locator('[data-testid="evaluation-close-attempts"] li').allInnerTexts()).map((x) => x.split(': ')[1]).join('|') === 'UNKNOWN (on hold)|UNKNOWN (on hold)|Closed');
      check('every close body was the fixed first pair; no other request', closeBodiesOk(s.log) && unexpected(s.log).length === 0, s.log);
      await s.context.close();
    }

    // 7. Route remount: in-app away and back, and a full reload -- nothing is re-sent by itself.
    {
      const s = await open({ closeModes: ['closed'] });
      await closeButton(s.page).waitFor({ timeout: 30000 }); await writeSignIn(s.page);
      await closeButton(s.page).click(); await result(s.page).waitFor({ timeout: 10000 });
      await s.page.evaluate(() => { window.history.pushState(null, '', '/import'); window.dispatchEvent(new PopStateEvent('popstate')); });
      await s.page.getByText('Add Leads').first().waitFor({ timeout: 10000 }).catch(() => {});
      await s.page.evaluate(() => { window.history.pushState(null, '', '/evaluation-close'); window.dispatchEvent(new PopStateEvent('popstate')); });
      await closeButton(s.page).waitFor({ timeout: 10000 }).catch(() => {});
      await settle(s.page, 2000);
      check('remount (away and back): the page remounts fresh and sends NOTHING by itself (still one close POST)', pa(s.log).length === 1 && (await closeButton(s.page).count()) === 1 && unexpected(s.log).length === 0, s.log);
      const n = s.log.length;
      await s.page.reload(); await closeButton(s.page).waitFor({ timeout: 30000 }).catch(() => {});
      await settle(s.page, 2500);
      const after = s.log.slice(n);
      check('reload: only static, fonts, runtime config and read session -- zero property-answer requests', !after.some((x) => x.kind === 'fn' && !ALLOWED_FN.has(x.key)) && !after.some((x) => x.kind === 'foreign'), after);
      check('reload: the write session is gone (memory only) and Close would need a new sign-in', (await s.page.getByTitle('Sign in for application writes').count()) === 1);
      check('remount/reload: no page error', s.pageErrors.length === 0, s.pageErrors);
      await s.context.close();
    }

    // 8. A deployment whose projection is disabled (Production): nothing to close, nothing sent.
    {
      const s = await open({ runtime: PROD_RUNTIME });
      await s.page.getByTestId('evaluation-close-unavailable').waitFor({ timeout: 30000 }).catch(() => {});
      await settle(s.page);
      check('disabled projection: the page says it is unavailable and offers no Close', (await s.page.getByTestId('evaluation-close-unavailable').count()) === 1 && (await closeButton(s.page).count()) === 0);
      check('disabled projection: zero property-answer requests, no unexpected request', pa(s.log).length === 0 && unexpected(s.log).length === 0, s.log);
      await s.context.close();
    }

    // 9. Source: the route has no navigation link and no automatic close.
    const page = fs.readFileSync(path.join(APP, 'src/pages/EvaluationClose.tsx'), 'utf8');
    const sidebar = fs.readFileSync(path.join(APP, 'src/components/Sidebar.tsx'), 'utf8');
    check('source: no useEffect in the close page (nothing runs on mount)', !/useEffect/.test(page));
    check('source: the only network call in the close page is closeEvaluation, from the click handler', (page.match(/closeEvaluation\(/g) || []).length === 1 && !/fetch\(/.test(page));
    check('source: no sidebar link to /evaluation-close', !sidebar.includes('evaluation-close'));
  } catch (e) {
    check('suite ran to completion', false, String(e && e.stack || e));
  }
  console.log(`\nchecksRun=${checks} failures=${failures} floor=${FLOOR}`);
  if (checks !== FLOOR) { console.error(`FAILED: expected exactly ${FLOOR} checks, ran ${checks}.`); return exit(2); }
  if (failures > 0) { console.error('FAILED'); return exit(1); }
  console.log('OK');
  return exit(0);
}
main();
