/**
 * Board 15 cleanup (Brad's Test check, 2026-10-06; Bones's PR #131 blocker)
 * -- an ended read session shows a clear sign-in recovery screen, and signing
 * back in refreshes the page's READS without destroying anything on it.
 *
 * Offline. Vite serves scripts/harness/read-session-recovery (the REAL
 * Layout, ReadAccess, Dashboard, ContactWorkspace and SellerCallWorkspace with
 * the real GHL client) in headless Chromium. Every /.netlify/functions
 * request, app-read-session included, is answered here from an in-memory
 * fixture; every write goes through the REAL durable Current Offer barrier
 * module (harness/current-offer-barrier-fixture.cjs), which applies
 * ghl-write's rules. The sign-in popup is a stub page that posts the same
 * message the real one does. Nothing leaves the machine.
 *
 * While signed out, every GHL READ answers 401 with the read-auth marker,
 * exactly as the read-auth boundary does; writes are unaffected (they carry
 * the separate write session).
 *
 * Proves:
 *   D  Dashboard -- Brad's report (raw 401 JSON) is replaced by the recovery
 *      screen; signing in re-reads the Dashboard; the expiry timer path; an
 *      explicit Sign out still shows the plain landing.
 *   R1 an unsaved call-log draft survives a lapse and recovery; the page is
 *      not remounted (definitions are not re-read) but its reads are.
 *   R2 "Result saved ... Notes and last-touch time were not attempted"
 *      survives recovery, and nothing further is sent.
 *   R3 the first call-log request is delayed BEFORE the server handles it;
 *      the session lapses and recovers while it is pending: no competing save
 *      can start, and on completion the page reports exactly what is stored,
 *      with one note and one last touch.
 *   R4 contact isolation: A's recovery re-reads and A's pending save, both
 *      completing after the move to B, never reach B's page.
 *   R5 Seller Call: an Unresolved Current Offer save (the durable barrier)
 *      stays Unresolved and locked across a lapse and recovery; recovery
 *      sends nothing.
 *   P1CL a confirmed call-log result whose readback failed owns the control
 *      until Check again reconciles it: choosing another result and Save send
 *      nothing; reconciliation completes or ends that attempt exactly once.
 *   P1BLUR the blur from expiry never saves a focused Current Offer (or a
 *      Contact note) draft; the draft survives; the operator's own blur saves.
 *   P2UW a recovery read that answers 500 keeps the Underwriting workspace:
 *      sqft, Miscellaneous description and amount survive it and a later
 *      successful recovery.
 */
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const APP = path.resolve(__dirname, '..');
Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);
Module._resolveFilename = ((original) => function (name, parent, ...rest) {
  if (name.startsWith('.') && parent) {
    const candidate = path.resolve(path.dirname(parent.filename), name + '.ts');
    if (fs.existsSync(candidate)) return candidate;
  }
  return original.call(this, name, parent, ...rest);
})(Module._resolveFilename);
const { getConfig } = require(path.join(APP, 'shared/ghl-config.ts'));
const CFG = getConfig('test');
const F = CFG.fields;
const OFFER_FIELD = CFG.opportunityFacts.currentOffer;
const HARNESS = '/scripts/harness/read-session-recovery/index.html';

let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}

// ── Read session ─────────────────────────────────────────────────────────────
let signedIn = true;
let sessionMs = 3600_000;
const REFUSAL = { error: 'Read sign-in required.', by: 'iaos-app-read-auth' };

// ── In-memory GHL: two contacts, one deal each ──────────────────────────────
const A = 'fixtureContactA';
const B = 'fixtureContactB';
const FIRST = { [A]: 'Alpha', [B]: 'Bravo' };
const opp = (c) => `${c}-opp`;
let db;
function resetDb() {
  const contact = (id) => ({ id, first: FIRST[id], fields: new Map(),
    notes: [{ id: `${id}-n1`, body: `Seed note for ${FIRST[id]}`, dateAdded: '2026-09-30T12:00:00.000Z' }] });
  db = { contacts: { [A]: contact(A), [B]: contact(B) }, offers: { [opp(A)]: null, [opp(B)]: null } };
}
const field = (c, id) => (c.fields.has(id) ? c.fields.get(id) : null);
const contactRow = (c) => ({
  id: c.id, firstName: c.first, lastName: 'Fixture', phone: '+15555550100', email: '', address1: '', city: '', state: '', postalCode: '',
  dateAdded: '2026-09-01T00:00:00.000Z', tags: [], dndSettings: {}, motivationScore: null, dealScore: null, combinedScore: null, completenessScore: null,
  callbackDatetime: field(c, F.callbackDatetimePrecise), callbackDatetimePrecise: field(c, F.callbackDatetimePrecise),
  lastCallAttempt: field(c, F.lastCallAttemptPrecise), lastCallAttemptPrecise: field(c, F.lastCallAttemptPrecise),
  callDisposition: field(c, F.callDisposition), dispositionAt: null,
});
const detail = (c) => ({ contact: { id: c.id, firstName: c.first, lastName: 'Fixture', phone: '+15555550100', dndSettings: {},
  customFields: [...c.fields].map(([id, value]) => ({ id, value })) } });
const oppRow = (c) => ({ id: opp(c), contactId: c, contactName: FIRST[c], opportunityName: `${FIRST[c]} deal`, phone: '', email: '', stageId: 'fixture-stage',
  customFields: db.offers[opp(c)] === null ? [] : [{ id: OFFER_FIELD, fieldValueNumber: db.offers[opp(c)] }] });
const EMPTY_DIGEST = { weekStartCT: '2026-10-05', weekEndCT: '2026-10-11', thisWeekReady: [], thisWeekBusiness: [], overdue: [], noAddress: [],
  totals: { ready: 0, business: 0, overdue: 0, noAddress: 0, byMailerType: {} } };

function applyWrite(op, target, args) {
  if (op === 'opportunity.currentOffer') { db.offers[target] = args.value; return true; }
  const c = db.contacts[target];
  if (!c) return false;
  const set = (...ids) => ids.forEach((id) => (args.value === null ? c.fields.delete(id) : c.fields.set(id, args.value)));
  switch (op) {
    case 'note.create': c.notes.push({ id: `${target}-n${c.notes.length + 1}`, body: args.body, dateAdded: new Date().toISOString() }); return true;
    case 'contact.callLogResult': set(F.callDisposition); return true;
    case 'contact.lastCallAttempt': set(F.lastCallAttempt, F.lastCallAttemptPrecise); return true;
    case 'contact.callback': case 'contact.explicitCallback': set(F.callbackDatetime, F.callbackDatetimePrecise); return true;
    default: return false;
  }
}

const { createBarrierFixture } = require('./harness/current-offer-barrier-fixture.cjs');
const { parseOutcomeNote } = require(path.join(APP, 'src/lib/seller-call-outcome.ts'));
const bf = createBarrierFixture({ contactOf: (o) => (o === opp(A) ? A : o === opp(B) ? B : null) });

function classify(url, method, post) {
  const u = new URL(url);
  const fn = u.pathname.replace('/.netlify/functions/', '');
  if (fn === 'app-read-session') return { kind: 'session', method };
  if (fn === 'ghl-write' && method === 'POST') return { kind: 'write', op: post.operation, target: post.targetId, args: post.args, requestId: post.requestId };
  // The call-log status GET is a read (read-auth); begin / reconcile are writes.
  if (fn === 'call-log-barrier') return { kind: 'call-log', method, action: method === 'GET' ? 'status' : post && post.action, op: post && post.operationId, read: method === 'GET' };
  if (fn === 'current-offer-barrier') return { kind: 'barrier', method, action: method === 'GET' ? 'status' : post && post.action };
  if (fn === 'ghl-proxy') {
    const p = u.searchParams.get('path') || '';
    let m;
    if ((m = p.match(/^\/contacts\/([^/?]+)\/notes$/))) return { kind: 'notes', contact: m[1], read: true };
    if ((m = p.match(/^\/contacts\/([^/?]+)$/))) return { kind: 'detail', contact: m[1], read: true };
    if ((m = p.match(/^\/opportunities\/([^/?]+)$/))) return { kind: 'opp-read', target: m[1], read: true };
    if (/\/customFields\/[^/]+$/.test(p)) return { kind: 'folder', read: true };
    if (/\/customFields$/.test(p)) return { kind: 'defs', read: true };
    return { kind: 'proxy-other', path: p, read: true };
  }
  if (fn === 'ghl-contact') return { kind: 'row', contact: u.searchParams.get('id'), read: true };
  return { kind: fn, read: true };
}
function answerRead(req) {
  switch (req.kind) {
    case 'notes': return { status: 200, body: { notes: db.contacts[req.contact].notes.slice() } };
    case 'detail': return { status: 200, body: detail(db.contacts[req.contact]) };
    case 'row': return { status: 200, body: contactRow(db.contacts[req.contact]) };
    case 'opp-read': return { status: 200, body: { opportunity: { id: req.target, customFields: db.offers[req.target] === null ? [] : [{ id: OFFER_FIELD, fieldValue: db.offers[req.target] }] } } };
    case 'defs': return { status: 200, body: { customFields: [] } };
    case 'folder': return { status: 200, body: { customField: { id: 'folder', name: 'Folder', position: 0 } } };
    case 'ghl-contacts': return { status: 200, body: Object.values(db.contacts).map(contactRow) };
    case 'ghl-opportunities': return { status: 200, body: { pipelineId: 'fixture-pipeline', stages: [], opportunities: [oppRow(A), oppRow(B)] } };
    case 'ghl-mailers': return { status: 200, body: EMPTY_DIGEST };
    case 'ghl-conversations': return { status: 200, body: [] };
    case 'ghl-underwriting-policy': return { status: 200, body: { values: [] } };
    case 'ghl-contact-conversations': return { status: 200, body: { messages: [], conversations: [] } };
    default: return { status: 404, body: { error: `fixture does not model ${req.kind}` } };
  }
}

let log = [];
let holds = [];
let failCallLog = [];  // predicates: answer the next matching call-log request with 503 (the server could not complete it)
let failReads = [];   // predicates: answer the next matching READ with 500 (a server failure, not sign-in)
function hold(match, opts = {}) {
  let release; let onHit;
  const h = { match, ...opts, released: new Promise((r) => { release = r; }), hit: new Promise((r) => { onHit = r; }) };
  h.release = release; h.onHit = onHit; holds.push(h); return h;
}
/** A held request must ARRIVE within ms, or the case fails clearly (never hangs). */
function hitWithin(h, label, ms = 30000) {
  let timer;
  return Promise.race([h.hit, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out waiting for the held request: ${label}`)), ms); })])
    .finally(() => clearTimeout(timer));
}
/** Release every held request (so no route handler is left pending) -- used on failure. */
const releaseAll = () => holds.forEach((h) => h.release());

// The stub popup: the same message the real /app-read-login.html posts after a successful sign-in.
const POPUP = `<!doctype html><title>stub read sign-in</title><script>
  window.opener.postMessage({ type: "iaos-app-read-signed-in" }, location.origin);
</script>`;

/* The whole suite is bounded: a stuck run fails (exit 1) instead of hanging CI or a local run. */
const watchdog = setTimeout(() => {
  console.error('FAIL  the recovery suite did not finish within 15 minutes -- stopped');
  process.exit(1);
}, 15 * 60_000);

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
  const foreign = [];
  const exit = async (code) => { await browser.close().catch(() => {}); await server.close().catch(() => {}); process.exit(code); };
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Chicago' });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await context.route(/gohighlevel\.com/, (route) => route.abort());
    await context.route('**/*', async (route) => {
      if (route.request().url().includes('/.netlify/functions/iaos-activation')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: 'open', activationId: 'v2-act-page-fixture', deployId: 'page-deploy', runtimeDeployId: 'page-deploy' }) }); // storage v2 (Bones finding 7): the page binds its activation at read sign-in
      const url = route.request().url();
      if (url.startsWith(`${base}/app-read-login.html`)) {
        signedIn = true;   // the stub stands in for a successful sign-in, which sets the cookie
        return route.fulfill({ status: 200, contentType: 'text/html', body: POPUP });
      }
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { foreign.push(url); return route.abort(); }
      let post = null;
      try { post = route.request().postDataJSON(); } catch { post = null; }
      const method = route.request().method();
      const req = classify(url, method, post);
      req.signedIn = signedIn;
      log.push(req);
      const reply = (res) => route.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(res.body) });
      if (req.kind === 'session') {
        if (method === 'DELETE') { signedIn = false; return reply({ status: 200, body: { signedIn: false } }); }
        return reply({ status: 200, body: signedIn ? { signedIn: true, expiresAt: new Date(Date.now() + sessionMs).toISOString() } : { signedIn: false } });
      }
      // A hold delays the request BEFORE the server handles it.
      const h = holds.find((x) => !x.used && x.match(req));
      if (h) { h.used = true; h.onHit(req); await h.released; }
      if (req.kind === 'barrier') return reply(await bf.handle(method, url, post));
      if (req.kind === 'call-log' && !(req.read && !signedIn)) {
        const fc = failCallLog.findIndex((pred) => pred(req));
        if (fc >= 0) { failCallLog.splice(fc, 1); return reply({ status: 503, body: { error: 'fixture: the call-log request could not be completed' } }); }
        return reply(await bf.handleCallLog(method, url, post));
      }
      if (req.kind === 'write') {
        const contactId = req.target === opp(A) ? A : req.target === opp(B) ? B : req.target;
        const res = await bf.write({ operation: req.op, targetId: req.target, requestId: req.requestId, contactId, args: req.args },
          () => ({ confirmed: applyWrite(req.op, req.target, req.args) }),
          { outcome: req.op === 'note.create' ? parseOutcomeNote(req.args.body) : null });
        if (h && h.loseAnswer) return route.abort('failed');   // the server finished; the browser lost the answer
        return reply(res);
      }
      // While signed out, every read is refused by the read-auth boundary (it is checked when the request is handled).
      if (!signedIn) return reply({ status: 401, body: REFUSAL });
      const fr = failReads.findIndex((pred) => pred(req));
      if (fr >= 0) { failReads.splice(fr, 1); req.failed = 500; return reply({ status: 500, body: { error: 'fixture: read failed' } }); }
      return reply(answerRead(req));
    });

    const go = (to) => page.evaluate((t) => window.__iaosNavigate(t), to);
    const freshApp = async (to) => {
      resetDb(); log = []; holds = []; failReads = []; failCallLog = []; bf.reset(); signedIn = true;
      await page.goto(`${base}${HARNESS}`);
      await page.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 });
      await go(to);
    };
    const visible = (testId) => page.getByTestId(testId).first().isVisible().catch(() => false);
    const visibleText = (s) => page.getByText(s, { exact: false }).first().isVisible().catch(() => false);
    const until = async (fn, label, ms = 30000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(50); }
      throw new Error(`timed out waiting for: ${label}`);
    };
    const settle = () => page.waitForTimeout(600);
    const writes = (op, target) => log.filter((r) => r.kind === 'write' && (!op || r.op === op) && (!target || r.target === target));
    const readsSince = (i, pred = () => true) => log.slice(i).filter((r) => r.read && pred(r));
    const recovery = () => visible('read-access-recovery');
    /* ONLY=R2,R3 runs just those sections (used for the negative controls). */
    const want = (k) => !process.env.ONLY || process.env.ONLY.split(',').includes(k);
    let mark; let h;
    /** The read session ends server-side. `trigger` makes the page find out the way readFetch does on a refused read. */
    const lapse = async (trigger = true) => {
      signedIn = false;
      if (trigger) await page.evaluate(() => window.dispatchEvent(new Event('iaos-read-session-lost')));
      await until(recovery, 'recovery screen');
    };
    const signInAgain = async () => {
      await page.getByRole('button', { name: 'Sign in again' }).click();
      await until(async () => !(await recovery()), 'recovery screen gone after sign-in');
    };
    const contactLoaded = (first) => until(async () => visibleText(`Seed note for ${first}`), `${first} loaded`);

    // ═══ D — Dashboard (Brad's report) ═══════════════════════════════════════
    if (want('D')) {
    const dashboardLoaded = async () => (await visibleText('Alpha Fixture')) && !(await recovery());
    sessionMs = 3600_000;
    await freshApp('/');
    await until(dashboardLoaded, 'Dashboard loaded while signed in');
    check('D signed in: the Dashboard loads and no recovery screen is shown', !(await recovery()));
    signedIn = false;                               // ends server-side; the page still believes it is signed in
    await go('/elsewhere');
    await until(() => visible('elsewhere'), 'another page');
    mark = log.length;
    await go('/');                                  // the Dashboard mounts and reads -> 401 from the read-auth boundary
    await until(recovery, 'recovery screen after a refused read');
    check('D the Dashboard\'s reads were refused 401 (the reproduction happened)', readsSince(mark).length > 0 && readsSince(mark).every((r) => !r.signedIn), readsSince(mark).map((r) => r.kind));
    check('D the recovery screen says the sign-in has ended and offers "Sign in again"',
      (await visibleText('Your sign-in has ended')) && (await page.getByRole('button', { name: 'Sign in again' }).isVisible()));
    await settle();
    check('D "Failed to load dashboard" is not shown', !(await visibleText('Failed to load dashboard')));
    const shown = await page.locator('body').innerText();
    check('D no raw refusal JSON or status code is shown', !/iaos-app-read-auth|→ 401|\{"error"/.test(shown), shown.slice(0, 400));
    check('D the nav is locked and the signed-in status line is gone', (await visible('sidebar-locked')) && !(await visible('read-access-signed-in')));
    mark = log.length;
    await signInAgain();
    await until(dashboardLoaded, 'Dashboard re-read after sign-in');
    const reread = readsSince(mark);
    check('D signing in again re-reads the Dashboard with the new session',
      ['ghl-contacts', 'ghl-mailers', 'ghl-opportunities', 'ghl-conversations'].every((k) => reread.some((r) => r.kind === k && r.signedIn)), reread.map((r) => r.kind));
    check('D after sign-in the Dashboard shows data, not the earlier failure', !(await visibleText('Failed to load dashboard')));
    check('D the signed-in status line and nav are back', (await visible('read-access-signed-in')) && !(await visible('sidebar-locked')));

    // D-timer — the expiry timer path shows the same screen.
    sessionMs = 2500;
    await freshApp('/');
    await until(dashboardLoaded, 'Dashboard loaded with a short session');
    signedIn = false;
    await until(recovery, 'recovery screen after the expiry timer', 15000);
    check('D-timer the recovery screen appears with the expired message', await visibleText('Read session expired'));
    check('D-timer the Dashboard is hidden behind it', !(await visibleText('Alpha Fixture')));

    // D-signout — an explicit sign-out still shows the plain landing.
    sessionMs = 3600_000;
    await freshApp('/');
    await until(dashboardLoaded, 'Dashboard loaded before sign-out');
    await page.getByTestId('read-access-signed-in').getByRole('button', { name: 'Sign out' }).click();
    await until(() => visibleText('Sign in to IAOS'), 'sign-in landing after sign-out');
    check('D-signout explicit sign-out shows the sign-in landing, not the recovery screen', !(await recovery()));
    }

    // ═══ R1 — an unsaved call-log draft survives ═══════════════════════════
    if (want('R1')) {
    const DRAFT = 'Seller wants 30 days. Draft that must survive the sign-in.';
    sessionMs = 3600_000;
    await freshApp(`/contacts/${A}`);
    await contactLoaded('Alpha');
    await page.getByTestId('call-log-result-spoke-with-seller').click();
    await page.getByTestId('call-log-notes').fill(DRAFT);
    const defsBefore = log.filter((r) => r.kind === 'defs').length;
    await lapse();
    check('R1 the recovery screen covers the page while signed out', await recovery());
    mark = log.length;
    await signInAgain();
    await until(async () => readsSince(mark, (r) => r.signedIn && r.contact === A && r.kind === 'row').length > 0, 'A re-read');
    await settle();
    check('R1 the chosen result is still selected', (await page.getByTestId('call-log-result-spoke-with-seller').getAttribute('aria-pressed')) === 'true');
    check('R1 the typed notes are still there', (await page.getByTestId('call-log-notes').inputValue()) === DRAFT, await page.getByTestId('call-log-notes').inputValue());
    check('R1 recovery sent no write', writes().length === 0, writes());
    const r1Reads = readsSince(mark, (r) => r.signedIn);
    check('R1 the contact\'s reads were refreshed (contact, detail, notes, deals)',
      ['row', 'detail', 'notes', 'ghl-opportunities'].every((k) => r1Reads.some((r) => r.kind === k && (r.contact === undefined || r.contact === A))), r1Reads.map((r) => r.kind));
    check('R1 the page was not remounted (field definitions were not re-read)', log.filter((r) => r.kind === 'defs').length === defsBefore);
    await page.getByTestId('call-log-save').click();
    await until(async () => (await page.getByTestId('call-log-done').count()) === 1, 'R1 saved');
    check('R1 the surviving draft then saves once: result, note, last touch',
      JSON.stringify(writes().map((w) => w.op)) === JSON.stringify(['contact.callLogResult', 'note.create', 'contact.lastCallAttempt'])
      && db.contacts[A].notes.some((n) => n.body.endsWith(DRAFT)), writes().map((w) => w.op));
    }

    // ═══ R2 — "saved but unverified" survives ════════════════════════════════
    if (want('R2')) {
    sessionMs = 3600_000;
    await freshApp(`/contacts/${A}`);
    await contactLoaded('Alpha');
    await page.getByTestId('call-log-result-no-answer').click();
    h = hold((r) => r.kind === 'write' && r.op === 'contact.callLogResult');
    await page.getByTestId('call-log-save').click();
    await hitWithin(h, 'h');
    signedIn = false;                               // the session ends while the result write is on its way
    h.release();                                    // the write is confirmed; its readback is refused 401 -> a real refused read
    await until(recovery, 'R2 recovery screen after the refused readback');
    check('R2 the refused readback itself brought up the recovery screen', log.some((r) => r.kind === 'detail' && r.contact === A && !r.signedIn));
    await signInAgain();
    await settle();
    const unverified = async () => (await page.getByTestId('call-log-saved-unverified').count()) ? page.getByTestId('call-log-saved-unverified').innerText() : '';
    check('R2 "Result saved ... Notes and last-touch time were not attempted" survives recovery',
      /^Result saved -- IAOS confirmed the write/.test(await unverified()) && /Notes and last-touch time were not attempted/.test(await unverified()), await unverified());
    check('R2 nothing further was sent: one result write, no note, no last touch',
      writes('contact.callLogResult').length === 1 && writes('note.create').length === 0 && writes('contact.lastCallAttempt').length === 0, writes().map((w) => w.op));
    check('R2 the stored result is what was confirmed', db.contacts[A].fields.get(F.callDisposition) === 'No Answer');
    }

    // ═══ R3 — a delayed first request, lapse and recovery while it is pending ═
    if (want('R3')) {
    sessionMs = 3600_000;
    await freshApp(`/contacts/${A}`);
    await contactLoaded('Alpha');
    await page.getByTestId('call-log-result-voicemail').click();
    await page.getByTestId('call-log-notes').fill('Left a message.');
    h = hold((r) => r.kind === 'write' && r.op === 'contact.callLogResult');   // delayed BEFORE the server handles it
    await page.getByTestId('call-log-save').click();
    await hitWithin(h, 'h');
    check('R3 setup: the result write has not reached the server', db.contacts[A].fields.get(F.callDisposition) === undefined);
    await lapse();
    await signInAgain();
    await settle();
    check('R3 after recovery the save is still in progress ("Saving…", disabled)',
      (await page.getByTestId('call-log-save').innerText()) === 'Saving…' && (await page.getByTestId('call-log-save').isDisabled()));
    check('R3 no competing save can start: every result button is disabled', await page.getByTestId('call-log-result-no-answer').isDisabled());
    await page.getByTestId('call-log-save').click({ force: true }).catch(() => {});
    await page.getByTestId('call-log-result-no-answer').click({ force: true }).catch(() => {});
    await settle();
    check('R3 forcing clicks sends nothing new (only the held result write exists)', writes().length === 1, writes().map((w) => w.op));
    h.release();                                    // the server now handles the first and only request
    await until(async () => (await page.getByTestId('call-log-done').count()) === 1, 'R3 completion');
    check('R3 completion reports exactly the stored result', (await page.getByTestId('call-log-done').innerText()) === 'Saved: Voicemail.' && db.contacts[A].fields.get(F.callDisposition) === 'Voicemail',
      { shown: await page.getByTestId('call-log-done').innerText(), stored: db.contacts[A].fields.get(F.callDisposition) });
    check('R3 one result write, one note, one last touch -- no duplicate sequence',
      JSON.stringify(writes().map((w) => w.op)) === JSON.stringify(['contact.callLogResult', 'note.create', 'contact.lastCallAttempt']), writes().map((w) => w.op));
    check('R3 GHL holds exactly one call note for it', db.contacts[A].notes.filter((n) => n.body === 'Call (reported by Brad in IAOS): Voicemail\nLeft a message.').length === 1);
    }

    // ═══ R4 — contact isolation across recovery ══════════════════════════════
    if (want('R4')) {
    sessionMs = 3600_000;
    await freshApp(`/contacts/${A}`);
    await contactLoaded('Alpha');
    await page.getByTestId('call-log-result-no-answer').click();
    const hSave = hold((r) => r.kind === 'write' && r.op === 'contact.callLogResult' && r.target === A);
    await page.getByTestId('call-log-save').click();
    await hitWithin(hSave, 'hSave');                                // A's save is pending
    await lapse();
    /* A's recovery refresh reads contact + detail + deals together (the
       screen-keeping refresh); hold A's contact and detail reads. */
    const hRow = hold((r) => r.kind === 'row' && r.contact === A && r.signedIn);
    const hDetail = hold((r) => r.kind === 'detail' && r.contact === A && r.signedIn);
    await signInAgain();
    await hitWithin(hRow, 'A recovery contact read'); await hitWithin(hDetail, 'A recovery detail read');   // A's recovery re-reads are pending
    await go(`/contacts/${B}`);                     // same mounted page, now B
    await contactLoaded('Bravo');
    check('R4 setup: A\'s recovery reads and A\'s save are all still held while B is on screen',
      hRow.used && hDetail.used && hSave.used && db.contacts[A].notes.length === 1 && (await page.locator('main').innerText()).includes('Bravo'));
    hRow.release(); hDetail.release(); hSave.release();
    await until(async () => db.contacts[A].notes.length === 2, 'A\'s pending save completes for A');
    await settle();
    const bText = await page.locator('main').innerText();
    check('R4 B shows B, never A\'s late recovery reads', bText.includes('Bravo') && !bText.includes('Seed note for Alpha') && !bText.includes('Alpha Fixture'), bText.slice(0, 300));
    check('R4 A\'s late save completion puts nothing on B (no saved, partial or warning)',
      (await page.getByTestId('call-log-done').count()) === 0 && (await page.getByTestId('call-log-partial').count()) === 0 && (await page.getByTestId('call-log-saved-unverified').count()) === 0);
    check('R4 A\'s writes went to A only', writes().every((w) => w.target === A) && db.contacts[B].notes.length === 1, writes().map((w) => `${w.op}:${w.target}`));
    }

    // ═══ R5 — the durable Current Offer barrier survives recovery ════════════
    if (want('R5')) {
    sessionMs = 3600_000;
    await freshApp(`/contacts/${A}/seller-call`);
    const input = () => page.getByTestId('negotiation-current-offer-input');
    await input().waitFor({ timeout: 30000 });
    await input().fill('410000');
    h = hold((r) => r.kind === 'write' && r.op === 'opportunity.currentOffer', { loseAnswer: true });
    await input().press('Tab');
    await hitWithin(h, 'h');
    h.release();                                    // GHL took it; the browser lost the answer
    const unresolvedShown = async () => (await page.getByTestId('current-offer-unresolved').count()) > 0;
    await until(unresolvedShown, 'R5 Unresolved');
    check('R5 setup: the save is Unresolved and locked; GHL holds 410000', (await input().isEditable()) === false && db.offers[opp(A)] === 410000);
    const offerWrites = writes('opportunity.currentOffer').length;
    await lapse();
    mark = log.length;
    await signInAgain();
    await until(async () => readsSince(mark, (r) => r.signedIn && r.kind === 'ghl-opportunities').length > 0, 'R5 re-read');
    await settle();
    check('R5 after recovery the deal is still Unresolved and locked', (await unresolvedShown()) && (await input().isEditable()) === false);
    check('R5 recovery sent no write', writes().length === offerWrites, writes().map((w) => w.op));
    check('R5 the Seller Call reads were refreshed with the new session',
      ['detail', 'ghl-opportunities', 'notes'].every((k) => readsSince(mark, (r) => r.signedIn).some((r) => r.kind === k)), readsSince(mark).map((r) => r.kind));
    }

    // ═══ P1-CL — an unresolved confirmed call-log attempt owns the control (Bones, PR #131) ═
    if (want('P1CL')) {
    await freshApp(`/contacts/${A}`);
    await contactLoaded('Alpha');
    await page.getByTestId('call-log-result-spoke-with-seller').click();
    failReads.push((r) => r.kind === 'detail' && r.contact === A);   // the readback after the confirmed write fails (500)
    await page.getByTestId('call-log-save').click();
    await until(async () => (await page.getByTestId('call-log-saved-unverified').count()) === 1, 'P1CL saved but unverified');
    check('P1CL setup: Spoke with Seller confirmed, its readback failed -> saved but unverified',
      writes('contact.callLogResult').length === 1 && db.contacts[A].fields.get(F.callDisposition) === 'Spoke with Seller' && log.some((r) => r.failed === 500));
    await page.getByTestId('call-log-result-no-answer').click({ force: true }).catch(() => {});
    await settle();
    check('P1CL selecting No Answer does not take over: still Spoke with Seller, warning still shown',
      (await page.getByTestId('call-log-result-spoke-with-seller').getAttribute('aria-pressed')) === 'true'
      && (await page.getByTestId('call-log-result-no-answer').getAttribute('aria-pressed')) === 'false'
      && (await page.getByTestId('call-log-saved-unverified').count()) === 1);
    check('P1CL Save and every result are disabled while the attempt is unresolved',
      (await page.getByTestId('call-log-save').isDisabled()) && (await page.getByTestId('call-log-result-no-answer').isDisabled()));
    await page.getByTestId('call-log-save').click({ force: true }).catch(() => {});
    await settle();
    check('P1CL attempted save: zero second result write, zero note, zero last touch',
      writes('contact.callLogResult').length === 1 && writes('note.create').length === 0 && writes('contact.lastCallAttempt').length === 0, writes().map((w) => w.op));
    /* Board 15 / PR #131 (durable call-log ownership): Check again is decided by
       the SERVER's own records, never a GHL read. A check the server cannot
       complete changes nothing and sends nothing. */
    failCallLog.push((r) => r.action === 'resume');
    await page.getByTestId('call-log-check-again').click();
    await settle();
    check('P1CL a Check again the server cannot complete stays blocked and sends nothing',
      (await page.getByTestId('call-log-save').isDisabled()) && writes().length === 1 && (await page.getByTestId('call-log-check-again').count()) === 1, writes().map((w) => w.op));
    // v3: the operation's request ids are DERIVED from its operation id.
    const opId = log.find((r) => r.kind === 'call-log' && r.action === 'begin').op;
    const reserved = ['result', 'note', 'touch'].map((slot) => ({ requestId: `${opId}-${slot}-1` }));
    await page.getByTestId('call-log-check-again').click();
    await until(async () => (await page.getByTestId('call-log-done').count()) === 1, 'P1CL reconciled');
    const sentIds = Object.fromEntries(writes().map((w) => [w.op, w.requestId]));
    check('P1CL reconciliation finishes that attempt once -- note, then last touch -- with its ORIGINAL reserved request ids',
      JSON.stringify(writes().map((w) => w.op)) === JSON.stringify(['contact.callLogResult', 'note.create', 'contact.lastCallAttempt'])
      && sentIds['contact.callLogResult'] === reserved[0].requestId && sentIds['note.create'] === reserved[1].requestId && sentIds['contact.lastCallAttempt'] === reserved[2].requestId
      && (await page.getByTestId('call-log-done').innerText()) === 'Saved: Spoke with Seller.', { ops: writes().map((w) => w.op), sentIds, reserved });
    check('P1CL GHL holds exactly one call note for it', db.contacts[A].notes.filter((n) => n.body === 'Call (reported by Brad in IAOS): Spoke with Seller').length === 1);
    await page.getByTestId('call-log-result-no-answer').click();
    await page.getByTestId('call-log-save').click();
    await until(async () => writes('contact.callLogResult').length === 2, 'P1CL next attempt');
    check('P1CL only after reconciliation does another attempt become possible', writes('contact.callLogResult')[1].args.value === 'No Answer');
    /* Storage correction: the v2 save path makes more (real, strong) storage round trips, so this
       save's note and last touch can still be in flight here. Let it finish before the reload below
       resets the request log -- otherwise its late note is logged as part of the next case. */
    await until(async () => writes('contact.lastCallAttempt').length === 2, 'P1CL next attempt finished');
    // GHL's result changed meanwhile: the server's record of the confirmed write decides; the result is never re-sent.
    sessionMs = 3600_000;
    await freshApp(`/contacts/${A}`);
    await contactLoaded('Alpha');
    await page.getByTestId('call-log-result-spoke-with-seller').click();
    failReads.push((r) => r.kind === 'detail' && r.contact === A);
    await page.getByTestId('call-log-save').click();
    await until(async () => (await page.getByTestId('call-log-saved-unverified').count()) === 1, 'P1CL-b unverified');
    db.contacts[A].fields.set(F.callDisposition, 'Voicemail');   // changed in GHL meanwhile
    await page.getByTestId('call-log-check-again').click();
    await until(async () => (await page.getByTestId('call-log-done').count()) === 1, 'P1CL-b finished');
    check('P1CL a later change in GHL does not re-send the result: Check again finishes only this call\'s note and last touch',
      JSON.stringify(writes().map((w) => w.op)) === JSON.stringify(['contact.callLogResult', 'note.create', 'contact.lastCallAttempt'])
      && db.contacts[A].fields.get(F.callDisposition) === 'Voicemail', writes().map((w) => w.op));
    }

    // ═══ P1-BLUR — the blur from expiry/recovery never saves (Bones, PR #131) ═
    if (want('P1BLUR')) {
    sessionMs = 6000;                               // a session that expires by its own timer
    await freshApp(`/contacts/${A}/seller-call`);
    const offerInput = () => page.getByTestId('negotiation-current-offer-input');
    await offerInput().waitFor({ timeout: 30000 });
    await offerInput().fill('395000');
    check('P1BLUR setup: a focused, unsaved Current Offer draft', (await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))) === 'negotiation-current-offer-input');
    sessionMs = 3600_000;                           // the next sign-in gets a long session
    signedIn = false;
    await until(recovery, 'P1BLUR expiry', 20000);
    await settle();
    check('P1BLUR expiry took focus away from the field (the blur happened)', (await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))) !== 'negotiation-current-offer-input');
    check('P1BLUR zero Current Offer write and zero barrier reservation (only status reads) before or during recovery',
      writes('opportunity.currentOffer').length === 0 && !log.some((r) => r.kind === 'barrier' && r.method !== 'GET'), log.filter((r) => r.kind === 'write' || r.kind === 'barrier').map((r) => `${r.kind}:${r.method || ''}:${r.action || ''}`));
    await signInAgain();
    await settle();
    check('P1BLUR after recovery: still zero writes, and the draft survives in the field',
      writes().length === 0 && (await offerInput().inputValue()) === '395000', { writes: writes().length, value: await offerInput().inputValue() });
    await offerInput().focus();
    await offerInput().press('Tab');                // the operator's own blur
    await until(async () => db.offers[opp(A)] === 395000, 'P1BLUR operator save');
    check('P1BLUR the operator\'s own blur afterwards saves it, once', writes('opportunity.currentOffer').length === 1 && db.offers[opp(A)] === 395000);
    // The same rule on the Contact page's blur-to-save note.
    sessionMs = 3600_000;
    await freshApp(`/contacts/${A}`);
    await contactLoaded('Alpha');
    const noteInput = page.getByPlaceholder('New note (any text = attempted)…');
    await noteInput.fill('Typed but not yet saved');
    await lapse();
    await settle();
    check('P1BLUR the Contact page note draft is not saved by the expiry blur', writes().length === 0, writes().map((w) => w.op));
    await signInAgain();
    check('P1BLUR the Contact page note draft survives', (await noteInput.inputValue()) === 'Typed but not yet saved');
    }

    // ═══ P2-UW — a failed recovery read keeps the Underwriting editors (Bones, PR #131) ═
    if (want('P2UW')) {
    sessionMs = 3600_000;
    await freshApp(`/contacts/${A}/underwriting`);
    const sqft = () => page.getByTestId('arv-subject-squareFeet');
    const miscDesc = () => page.getByTestId('repair-misc-description');
    const miscAmt = () => page.getByTestId('repair-misc-amount');
    await sqft().waitFor({ timeout: 30000 });
    await miscDesc().waitFor({ timeout: 30000 });
    await sqft().fill('1850');
    await miscDesc().fill('Replace back fence');
    await miscAmt().fill('2400');
    const drafts = async () => [await sqft().inputValue(), await miscDesc().inputValue(), await miscAmt().inputValue()];
    await lapse();
    failReads.push((r) => r.kind === 'ghl-opportunities' && r.signedIn);   // the recovery re-read answers 500
    await signInAgain();
    await until(async () => log.some((r) => r.failed === 500), 'P2UW the recovery read failed');
    await settle();
    check('P2UW a recovery read that returns 500 is reported on its own line', (await visible('refresh-read-error')) && /Couldn't refresh this page's data/.test(await page.getByTestId('refresh-read-error').innerText()));
    const draftsOrGone = async () => ((await sqft().count()) && (await miscDesc().count()) ? drafts() : ['editors unmounted']);
    check('P2UW the workspace stays: sqft, Miscellaneous description and amount are kept',
      JSON.stringify(await draftsOrGone()) === JSON.stringify(['1850', 'Replace back fence', '2400']), await draftsOrGone());
    await lapse();
    mark = log.length;
    await signInAgain();
    await until(async () => readsSince(mark, (r) => r.signedIn && r.kind === 'ghl-opportunities' && !r.failed).length > 0, 'P2UW successful recovery');
    await until(async () => !(await visible('refresh-read-error')), 'P2UW error cleared').catch(() => {});
    await settle();
    check('P2UW a later successful recovery clears the error and still keeps all three drafts',
      !(await visible('refresh-read-error')) && JSON.stringify(await draftsOrGone()) === JSON.stringify(['1850', 'Replace back fence', '2400']), await draftsOrGone());
    check('P2UW nothing was written', writes().length === 0, writes().map((w) => w.op));
    }

    check('no request left the machine', foreign.length === 0, foreign);
    check('no page errors', pageErrors.length === 0, pageErrors);
  } catch (e) {
    console.error(e);
    failures += 1;
    releaseAll();                                   // no route handler left waiting on a hold
  }
  clearTimeout(watchdog);
  console.log(`\nRead session recovery: ${checks - failures}/${checks} checks passed`);
  await exit(failures ? 1 : 0);
}
main();
