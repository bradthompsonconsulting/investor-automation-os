/**
 * B15-08 (INV-107) -- the latest inbound seller message is shown from the thread's own source, with honest states.
 *
 * The Dashboard's Unanswered Inbound preview was only GHL's conversation-search summary (`lastMessageBody`), empty for
 * calls and activities (and not the thread's source), so a row could read "No message text (call or activity)" while
 * the seller had written, and the Conversations thread (SMS/email sections only) gave no hint what the latest inbound
 * was. Now `ghl-conversations` classifies each shown unanswered row from that conversation's own messages (one small
 * read, bounded), the thread shows the same "Latest from seller", and both use one shared classifier and one display.
 *
 * Three parts, all offline (fictional data; global fetch / page routes are fixtures; nothing leaves the machine):
 *   P  the pure classifier (shared/inbound-message.ts);
 *   S  the real ghl-conversations handler with a stubbed GHL;
 *   R  the REAL App (scripts/harness/app-routes) in headless Chromium: Dashboard and Conversations.
 * Plus source checks (X).
 *
 * NEGATIVE CONTROL: `node scripts/test-b15-08-inbound-visibility.cjs --before=<rev>` runs the same checks against
 * <rev>'s ghl-conversations handler and Dashboard / Conversations pages (via `git show`) and must FAIL (exit 1).
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');

const APP = path.resolve(__dirname, '..');
const FUNCTIONS = path.join(APP, 'netlify', 'functions');
const HARNESS_DIR = path.join(APP, 'scripts/harness/app-routes');
const HARNESS = '/scripts/harness/app-routes/index.html';
const beforeArg = process.argv.find((a) => a.startsWith('--before='));
const BEFORE = beforeArg ? beforeArg.slice('--before='.length) : null;
const BEFORE_FN = path.join(FUNCTIONS, '_b15_08_before_ghl_conversations.ts');
const APP_BEFORE = path.join(HARNESS_DIR, 'AppBefore.tsx');
const DASH_BEFORE = path.join(HARNESS_DIR, 'DashboardBefore.tsx');
const CONV_BEFORE = path.join(HARNESS_DIR, 'ConversationsBefore.tsx');

/** Literal check() call sites: P 7 + S 9 + R 6 + X 2 = 24. */
const FLOOR = 24;
let checks = 0; let failures = 0;
function check(name, ok, detail) {
  checks += 1; if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail).slice(0, 400)}`}`);
}
const tryOr = (fn, dflt) => { try { return fn(); } catch { return dflt; } };
const cleanup = () => [BEFORE_FN, APP_BEFORE, DASH_BEFORE, CONV_BEFORE].forEach((f) => { if (fs.existsSync(f)) fs.rmSync(f); });
cleanup(); process.on('exit', cleanup);
const show = (p) => execFileSync('git', ['show', `${BEFORE}:app/${p}`], { cwd: APP, encoding: 'utf8' });
const src = (p) => (BEFORE ? tryOr(() => show(p), '') : tryOr(() => fs.readFileSync(path.join(APP, p), 'utf8'), '')).replace(/\r\n/g, '\n');
const watchdog = setTimeout(() => { console.error('FAIL  the suite did not finish within 5 minutes -- stopped'); process.exit(1); }, 5 * 60_000);

// TypeScript loader for the function modules (the existing offline function-test pattern).
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) {
  if (name.startsWith('.') && parent) for (const ext of ['.ts', '.tsx']) { const c = path.resolve(path.dirname(parent.filename), name + ext); if (fs.existsSync(c)) return c; }
  return originalResolve.call(this, name, parent, ...rest);
};
Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);

Object.assign(process.env, {
  IAOS_ENV: 'test', GHL_PRIVATE_API_KEY: 'offline-fixture',
  IAOS_APP_READ_GOOGLE_CLIENT_ID: 'offline-read-client', IAOS_APP_READ_SESSION_SECRET: 'offline-read-fixture-only-not-a-real-secret',
  IAOS_APP_READ_BRAD_EMAILS: 'brad@example.invalid', IAOS_APP_READ_ALLOWED_ORIGIN: 'https://proof.example.invalid',
});
{ const cfg = require('../shared/ghl-config.ts'); cfg.getConfig('test').supplementalReadBudget = { enabled: cfg.SUPPLEMENTAL_READ_BUDGET_DISABLED, budgetId: 'offline-disabled', ceiling: 0 }; }
const readAuth = require('../netlify/functions/lib/app-read-auth.ts');
const COOKIE = `${readAuth.READ_COOKIE}=${readAuth.issueReadSession('brad@example.invalid', readAuth.appReadConfig()).token}`;

const T = (min) => new Date(Date.UTC(2026, 10, 2, 15, min)).toISOString();     // fictional message times
const msg = (o) => ({ direction: 'inbound', messageType: 'TYPE_SMS', body: '', dateAdded: T(0), ...o });

async function main() {
  // ───────────────────────────── P: the pure classifier ─────────────────────────────
  const IM = BEFORE ? tryOr(() => { throw new Error('absent before'); }, null) : tryOr(() => require('../shared/inbound-message.ts'), null);
  const L = (msgs, scope) => tryOr(() => IM.latestInboundFrom(msgs, scope), null);
  const a1 = L([msg({ body: 'I can sell next month', dateAdded: T(5) }), msg({ direction: 'outbound', body: 'Hi', dateAdded: T(1) })], { conversationId: 'c', contactId: 'k' });
  check('P1 newest inbound SMS with text -> text, SMS, its words and time', a1?.state === 'text' && a1.channel === 'SMS' && a1.text === 'I can sell next month' && a1.at === T(5) && a1.source === 'thread', a1);
  const a2 = L([msg({ messageType: 'TYPE_EMAIL', body: '<div>Call me <b>after 5</b>&nbsp;pm</div>', dateAdded: T(3) })], {});
  check('P2 inbound email body -> plain text (tags removed), channel Email', a2?.state === 'text' && a2.channel === 'Email' && a2.text === 'Call me after 5 pm', a2);
  const a3 = L([msg({ body: 'older text', dateAdded: T(1) }), msg({ messageType: 'TYPE_CALL', dateAdded: T(9) })], {});
  check('P3 newest inbound is a call (after an older SMS) -> no_text "Call" with the call time; the older SMS is not passed off as latest', a3?.state === 'no_text' && a3.channel === 'Call' && a3.at === T(9), a3);
  const a4 = L([msg({ body: '   ', dateAdded: T(2) })], {});
  check('P4 inbound SMS with no body -> unavailable no_body (never "no message", never blank)', a4?.state === 'unavailable' && a4.reason === 'no_body' && a4.channel === 'SMS', a4);
  const a5 = L([msg({ body: 'third', dateAdded: T(7) }), msg({ body: 'first', dateAdded: T(1) }), msg({ direction: 'outbound', body: 'reply', dateAdded: T(8) })], {});
  check('P5 order-independent: the newest INBOUND by time wins regardless of wire order; outbound ignored', a5?.state === 'text' && a5.text === 'third', a5);
  const a6 = L([msg({ body: 'other contact', contactId: 'x', dateAdded: T(9) }), msg({ body: 'other conv', conversationId: 'y', dateAdded: T(8) }), msg({ body: 'mine', contactId: 'k', conversationId: 'c', dateAdded: T(1) })], { conversationId: 'c', contactId: 'k' });
  const a6b = L([msg({ body: 'other contact', contactId: 'x', dateAdded: T(9) })], { contactId: 'k' });
  check('P6 isolation: a message naming another contact or conversation is never used (mine wins; only-foreign -> not_found)', a6?.text === 'mine' && a6b?.state === 'unavailable' && a6b.reason === 'not_found', [a6, a6b]);
  const s1 = tryOr(() => IM.latestInboundFromSummary('  Yes interested ', Date.parse(T(4)), 'read_failed'), null);
  const s2 = tryOr(() => IM.latestInboundFromSummary('', Date.parse(T(4)), 'not_loaded'), null);
  check('P7 summary fallback: text kept (source summary, no channel claimed); empty -> unavailable with the given reason', s1?.state === 'text' && s1.source === 'summary' && s1.channel === '' && s1.text === 'Yes interested' && s2?.state === 'unavailable' && s2.reason === 'not_loaded', [s1, s2]);

  // ───────────────────────────── S: the real ghl-conversations handler ─────────────────────────────
  if (BEFORE) fs.writeFileSync(BEFORE_FN, show('netlify/functions/ghl-conversations.ts'));
  for (const k of Object.keys(require.cache)) if (k.startsWith(FUNCTIONS)) delete require.cache[k];
  const handler = require(BEFORE ? BEFORE_FN : path.join(FUNCTIONS, 'ghl-conversations.ts')).handler;
  let calls = []; let convs = []; let pages = {};
  global.fetch = async (url, init = {}) => {
    const u = new URL(String(url)); calls.push({ method: init.method || 'GET', path: u.pathname });
    const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
    if (u.origin !== 'https://services.leadconnectorhq.com') throw new Error('unexpected origin ' + u.origin);
    if (u.pathname === '/conversations/search') return json({ conversations: convs, total: convs.length });
    const m = u.pathname.match(/^\/conversations\/([^/]+)\/messages$/);
    if (m) { const p = pages[decodeURIComponent(m[1])]; return p === 'fail' ? json({ error: 'x' }, 500) : json({ messages: { messages: p ?? [], nextPage: false } }); }
    throw new Error('unexpected path ' + u.pathname);
  };
  const run = async (q = {}) => { const r = await handler({ httpMethod: 'GET', headers: { cookie: COOKIE }, queryStringParameters: q }); return { status: r.statusCode, body: tryOr(() => JSON.parse(r.body), null) }; };
  const conv = (id, last, dir, body) => ({ id, contactId: `k-${id}`, contactName: `Fixture ${id}`, phone: '+15555550100', email: '', lastMessageDate: Date.parse(T(last)), lastMessageDirection: dir, lastMessageBody: body, unreadCount: 1 });
  convs = [conv('c1', 10, 'inbound', 'Hi is this still open?'), conv('c2', 20, 'inbound', ''), conv('c3', 5, 'inbound', ''), conv('c4', 1, 'outbound', 'sent'), conv('c5', 30, 'inbound', 'summary only'), conv('c6', 40, 'inbound', '')];
  pages = {
    c1: [msg({ body: 'Someone else', contactId: 'k-other', conversationId: 'c1', dateAdded: T(59) }), msg({ body: 'Hi is this still open?', contactId: 'k-c1', conversationId: 'c1', dateAdded: T(10) })],
    c2: [msg({ messageType: 'TYPE_CALL', contactId: 'k-c2', conversationId: 'c2', dateAdded: T(20) }), msg({ body: 'earlier sms', contactId: 'k-c2', conversationId: 'c2', dateAdded: T(2) })],
    c3: [msg({ messageType: 'TYPE_EMAIL', body: '<p>Please send the offer to my email</p>', contactId: 'k-c3', conversationId: 'c3', dateAdded: T(5) })],
    c5: 'fail', c6: 'fail',
  };
  calls = [];
  const r = await run();
  const rows = Array.isArray(r.body) ? r.body : [];
  const by = Object.fromEntries(rows.map((x) => [x.conversationId, x]));
  check('S1 unchanged: same unanswered filter and oldest-first order, outbound-last c4 excluded, preview = the trimmed summary as before',
    r.status === 200 && rows.map((x) => x.conversationId).join() === 'c3,c1,c2,c5,c6' && by.c1?.preview === 'Hi is this still open?' && by.c2?.preview === '' && !by.c4, rows.map((x) => [x.conversationId, x.preview]));
  check('S2 SMS row: latestInbound = text / SMS / the seller\'s words, from the thread\'s source', by.c1?.latestInbound?.state === 'text' && by.c1.latestInbound.channel === 'SMS' && by.c1.latestInbound.source === 'thread' && by.c1.latestInbound.text === 'Hi is this still open?', by.c1?.latestInbound);
  check('S3 call row (blank summary): latestInbound = no_text "Call" (was the neutral "call or activity")', by.c2?.latestInbound?.state === 'no_text' && by.c2.latestInbound.channel === 'Call', by.c2?.latestInbound);
  check('S4 email row with a BLANK summary: the seller\'s email text is now shown (the B15-08 blank-preview case)', by.c3?.latestInbound?.state === 'text' && by.c3.latestInbound.channel === 'Email' && by.c3.latestInbound.text === 'Please send the offer to my email', by.c3?.latestInbound);
  check('S5 failed read: summary text kept (source summary); no summary -> unavailable read_failed (never "no message")',
    by.c5?.latestInbound?.state === 'text' && by.c5.latestInbound.source === 'summary' && by.c6?.latestInbound?.state === 'unavailable' && by.c6.latestInbound.reason === 'read_failed', [by.c5?.latestInbound, by.c6?.latestInbound]);
  check('S6 isolation: c1\'s newer message naming another contact is not shown on c1', by.c1?.latestInbound?.text !== 'Someone else', by.c1?.latestInbound);
  const msgReads = calls.filter((c) => /\/messages$/.test(c.path)).map((c) => c.path.split('/')[2]).sort();
  check('S7 reads: GET only; only /conversations/search + one /messages read per shown unanswered row (none for c4)',
    calls.every((c) => c.method === 'GET') && calls.every((c) => c.path === '/conversations/search' || /\/messages$/.test(c.path)) && msgReads.join() === 'c1,c2,c3,c5,c6', calls);
  convs = Array.from({ length: 30 }, (_, i) => conv(`n${String(i).padStart(2, '0')}`, i, 'inbound', i % 2 ? 'odd summary' : ''));
  pages = Object.fromEntries(convs.map((c) => [c.id, [msg({ body: `t ${c.id}`, contactId: c.contactId, conversationId: c.id, dateAdded: T(c.lastMessageDate % 60) })]]));
  calls = [];
  const rc = await run(); const cr = Array.isArray(rc.body) ? rc.body : [];
  const tail = cr.slice(25);
  check('S8 bounded: 30 unanswered rows -> exactly 25 message reads (oldest first); rows past the cap say not loaded or keep their summary',
    calls.filter((c) => /\/messages$/.test(c.path)).length === 25 && cr.slice(0, 25).every((x) => x.latestInbound?.source === 'thread') &&
    tail.length === 5 && tail.every((x) => (x.preview ? x.latestInbound?.source === 'summary' : x.latestInbound?.state === 'unavailable' && x.latestInbound.reason === 'not_loaded')),
    [calls.filter((c) => /\/messages$/.test(c.path)).length, tail.map((x) => x.latestInbound)]);
  calls = [];
  const ra = await run({ scope: 'all' }); const ar = Array.isArray(ra.body) ? ra.body : [];
  check('S9 ?scope=all (Conversations inbox list) unchanged: no message reads, no new field', ra.status === 200 && ar.length === 30 && calls.every((c) => c.path === '/conversations/search') && ar.every((x) => !('latestInbound' in x)), calls.length);

  // ───────────────────────────── R: the REAL App, Dashboard and Conversations ─────────────────────────────
  if (BEFORE) {
    const repoint = (s) => s.replace(/from "\.\.\//g, 'from "../../../src/').replace(/(from|import) "\.\//g, '$1 "../../../src/pages/');
    fs.writeFileSync(DASH_BEFORE, repoint(show('src/pages/Dashboard.tsx')));
    fs.writeFileSync(CONV_BEFORE, repoint(show('src/pages/Conversations.tsx')));
    fs.writeFileSync(APP_BEFORE, fs.readFileSync(path.join(APP, 'src/App.tsx'), 'utf8')
      .replace('from "./pages/Dashboard"', 'from "./DashboardBefore"').replace('from "./pages/Conversations"', 'from "./ConversationsBefore"')
      .replace(/from "\.\/(?!DashboardBefore|ConversationsBefore)/g, 'from "../../../src/'));
  }
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
  const methods = []; const foreign = []; const pageErrors = [];
  const people = ['ua', 'ub', 'uc', 'ud'];
  const contactRow = (id) => ({ id, firstName: 'Fixture', lastName: id.toUpperCase(), phone: '+15555550142', email: '', address1: '1 Example St', city: 'Sampletown', state: 'TX', postalCode: '75000',
    dateAdded: '2026-09-01T00:00:00.000Z', tags: [], dndSettings: {}, motivationScore: null, dealScore: null, combinedScore: null, completenessScore: null,
    callbackDatetime: null, callbackDatetimePrecise: null, lastCallAttempt: null, lastCallAttemptPrecise: null, callDisposition: null, dispositionAt: null });
  const unRow = (id, li, preview = '') => ({ conversationId: `cv-${id}`, contactId: id, contactName: `Fixture ${id.toUpperCase()}`, phone: '+15555550142', email: '', lastMessageDate: Date.parse(T(3)), preview, unreadCount: 1, ...(li ? { latestInbound: li } : {}) });
  const UNANSWERED = [
    unRow('ua', { state: 'text', channel: 'SMS', text: 'Yes I still want to sell', at: T(3), source: 'thread' }, 'Yes I still want to sell'),
    unRow('ub', { state: 'no_text', channel: 'Call', at: T(4) }),
    unRow('uc', { state: 'unavailable', reason: 'read_failed', channel: null, at: T(5) }),
    unRow('ud', null, ''),
  ];
  const THREADS = [{ conversationId: 'cv-ub', contactId: 'ub', contactName: 'Fixture UB', phone: '+15555550142', email: '', lastMessageDate: Date.parse(T(4)), lastMessageDirection: 'inbound', preview: '', unreadCount: 1 }];
  const UB_MESSAGES = [
    { id: 'm1', conversationId: 'cv-ub', contactId: 'ub', direction: 'inbound', channel: 'SMS', messageType: 'TYPE_SMS', body: 'Earlier text from UB', dateAdded: T(1) },
    { id: 'm2', conversationId: 'cv-ub', contactId: 'ub', direction: 'inbound', channel: 'Call', messageType: 'TYPE_CALL', body: '', dateAdded: T(4) },
    { id: 'm3', conversationId: 'cv-x', contactId: 'someone-else', direction: 'inbound', channel: 'SMS', messageType: 'TYPE_SMS', body: 'NOT UB', dateAdded: T(50) },
  ];
  async function open(start) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { foreign.push(url); return route.abort(); }
      const u = new URL(url); const fn = u.pathname.replace('/.netlify/functions/', ''); const q = u.searchParams;
      methods.push(route.request().method());
      const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
      if (fn === 'app-read-session') return json({ signedIn: true, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
      if (route.request().method() !== 'GET') return json({ error: 'fixture: reads only' }, 405);
      if (fn === 'ghl-contacts') return json(people.map(contactRow));
      if (fn === 'ghl-mailers') return json({ weekStartCT: '2026-11-01', weekEndCT: '2026-11-07', thisWeekReady: [], thisWeekBusiness: [], overdue: [], noAddress: [], totals: { ready: 0, business: 0, overdue: 0, noAddress: 0, byMailerType: {} } });
      if (fn === 'ghl-opportunities') return json({ pipelineId: 'p', stages: [], opportunities: [] });
      if (fn === 'ghl-conversations') return json(q.get('scope') === 'all' ? THREADS : UNANSWERED);
      if (fn === 'ghl-contact-conversations') return json({ contactId: q.get('id'), conversationCount: 1, messages: q.get('id') === 'ub' ? UB_MESSAGES : [] });
      if (fn === 'ghl-proxy' && /\/notes$/.test(q.get('path') || '')) return json({ notes: [] });
      if (fn === 'ghl-calendar-events') return json({ events: [] });
      return json({ error: `fixture: ${fn} not answered` }, 404);
    });
    await page.goto(`${base}${HARNESS}?start=${encodeURIComponent(start)}`);
    await page.waitForFunction(() => typeof window.__iaosAppSource === 'string', null, { timeout: 60000 });
    return { context, page };
  }
  const waitText = async (page, sel, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const t = await page.evaluate((s) => { const el = document.querySelector(s); return el ? el.innerText : null; }, sel).catch(() => null); if (t) return t; await page.waitForTimeout(100); } return null; };
  const exit = async (code) => { clearTimeout(watchdog); await browser.close().catch(() => {}); await server.close().catch(() => {}); cleanup(); process.exit(code); };
  try {
    const { context: dc, page: d } = await open('/');
    const ta = await waitText(d, '[data-testid="unanswered-preview-cv-ua"]');
    check('R1 Dashboard SMS row: channel "SMS", the seller\'s words and "Received <time>"', !!ta && /SMS/.test(ta) && /Yes I still want to sell/.test(ta) && /Received /.test(ta), ta);
    const tb = await waitText(d, '[data-testid="unanswered-preview-cv-ub"]', 3000);
    check('R2 Dashboard call row: "Inbound call — no message text" (was the neutral F51 label)', !!tb && /Inbound call — no message text/.test(tb), tb);
    const tc = await waitText(d, '[data-testid="unanswered-preview-cv-uc"]', 3000);
    check('R3 Dashboard unreadable row: says the text couldn\'t be read and where to look (never blank, never "no message")', !!tc && /Message text couldn.t be read — open the conversation/.test(tc), tc);
    const body = await d.locator('body').innerText().catch(() => '');
    check('R4 Dashboard row from an older response (no latestInbound): the F51 neutral label, unchanged', /Fixture UD/.test(body) && /No message text \(call or activity\)/.test(body), body.slice(0, 200));
    await dc.close();
    const { context: cc, page: c } = await open('/conversations');
    await c.getByText('Fixture UB', { exact: false }).first().click({ timeout: 15000 }).catch(() => {});
    const tl = await waitText(c, '[data-testid="thread-latest-inbound"]');
    check('R5 Conversations thread names the latest inbound like the Dashboard ("Inbound call — no message text"), not the older SMS, and never another contact\'s message',
      !!tl && /Latest from seller:/.test(tl) && /Inbound call — no message text/.test(tl) && !/NOT UB/.test(tl) && !/Earlier text from UB/.test(tl), tl);
    await cc.close();
    check('R6 reads only (GET), nothing left the machine, no page errors', methods.every((m) => m === 'GET') && foreign.length === 0 && pageErrors.length === 0, { methods: [...new Set(methods)], foreign, pageErrors });
  } catch (e) { console.error(`FAIL  rendered: ${e.message}`); failures += 1; }

  // ───────────────────────────── X: source ─────────────────────────────
  const fn = src('netlify/functions/ghl-conversations.ts'); const dash = src('src/pages/Dashboard.tsx'); const cv = src('src/pages/Conversations.tsx');
  check('X1 one shared classifier (server + thread) and one display (Dashboard + thread); the F51 fallback literal is kept',
    /from "\.\.\/\.\.\/shared\/inbound-message"/.test(fn) && /latestInboundFrom\(messages, \{ contactId: selected\.contactId \}\)/.test(cv) &&
    /<InboundPreview li=\{r\.latestInbound\}/.test(dash) && /<InboundPreview li=\{latestInboundFrom/.test(cv) && /\{r\.preview \|\| <em[^>]*>\{NO_MESSAGE_TEXT\}<\/em>\}/.test(dash));
  check('X2 ghl-conversations stays read-only and keeps its rule: no write method, no search type field, same inbound filter and oldest-first sort',
    /c\.lastMessageDirection === "inbound" && !c\.isLastMessageInternalComment/.test(fn) && /\.sort\(\(a, b\) => a\.lastMessageDate - b\.lastMessageDate\)/.test(fn) &&
    !/method:\s*"(POST|PUT|PATCH|DELETE)"/.test(fn) && !/lastMessageType/.test(fn) && /LATEST_INBOUND_CAP = 25/.test(fn));

  console.log(`\nchecksRun=${checks} failures=${failures} floor=${FLOOR}${BEFORE ? ` (negative control vs ${BEFORE})` : ''}`);
  if (checks !== FLOOR) { console.error(`FAILED: expected exactly ${FLOOR} checks, ran ${checks}.`); return exit(2); }
  if (failures > 0) { console.error('FAILED'); return exit(1); }
  console.log('OK'); return exit(0);
}
main().catch((e) => { console.error(`FAIL  startup: ${e && e.stack || e}`); cleanup(); process.exit(2); });
