/**
 * F5 (Board #15 Captain walkthrough) -- truthful outbound message status.
 *
 * Source: HighLevel API, GET /conversations/{conversationId}/messages: `status` is OPTIONAL (connected, delivered,
 * failed, opened, pending, read, scheduled, sent, undelivered, clicked, opt_out); `error` is "Error message if
 * message delivery failed". Rules: a failed message shows as failed; a missing status or the outbound direction is
 * never proof of success; "sent" is never "delivered"; isolation between contacts / conversations is preserved.
 *
 *   U   the pure mapping (src/lib/message-status.ts)
 *   S   the REAL ghl-contact-conversations handler with a stubbed GHL: status and error pass through; absent -> "";
 *       non-string -> ""; error bounded
 *   RC  the REAL Conversations page (harness conversations-styled): every bubble's status words
 *   RW  the REAL Contact page history (harness dashboard-callback-popover): the same
 *   IC / IW  a DELAYED messages read for contact A that settles after the page moved to B never shows on B
 *
 * Offline; nothing leaves the machine; reads only.
 * NEGATIVE CONTROL: --before=<rev> serves <rev>'s Conversations.tsx, ContactWorkspace.tsx and handler. With the base
 * (9e8c8fd) U, S, RC and RW must FAIL. IC / IW also fail there, only because B's bubble then reads "Sent", not
 * "Delivered"; the isolation itself is proven by the mutations that remove each page's guard (each fails only IC or IW).
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');

const APP = path.resolve(__dirname, '..');
const beforeArg = process.argv.find((a) => a.startsWith('--before='));
const BEFORE = beforeArg ? beforeArg.slice('--before='.length) : null;
const show = (rel) => execFileSync('git', ['show', `${BEFORE}:app/${rel}`], { cwd: APP, encoding: 'utf8', maxBuffer: 64 << 20 });
const BEFORE_FN = path.join(APP, 'netlify', 'functions', '_f5_before_ghl-contact-conversations.ts');
const removeBefore = () => { if (BEFORE && fs.existsSync(BEFORE_FN)) fs.rmSync(BEFORE_FN); };   // one exact file, never recursive
process.on('exit', removeBefore);

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

let checks = 0, failures = 0;
const FLOOR = 38;
function check(name, ok, detail) { checks += 1; if (!ok) failures += 1; console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`); }
const tryOr = (fn, alt) => { try { return fn(); } catch { return alt; } };

/* Fictional messages: one per status case, plus one inbound. Bodies name their case so the page can be read. */
const T = (min) => new Date(Date.UTC(2026, 10, 5, 15, min)).toISOString();
const out = (id, status, body, extra = {}) => ({ id, conversationId: 'conv-A', contactId: 'cA', direction: 'outbound', channel: 'SMS', messageType: 'TYPE_SMS', body, dateAdded: T(id.length), ...(status === undefined ? {} : { status }), ...extra });
const A_MESSAGES = [
  { id: 'a-in', conversationId: 'conv-A', contactId: 'cA', direction: 'inbound', channel: 'SMS', messageType: 'TYPE_SMS', body: 'A inbound hello', dateAdded: T(1), status: 'delivered' },
  out('a-delivered', 'delivered', 'A delivered text'),
  out('a-sent', 'sent', 'A sent text'),
  out('a-failed', 'failed', 'A failed text', { error: 'Carrier rejected the message (fictional)' }),
  out('a-undeliv', 'undelivered', 'A undelivered text'),
  out('a-nostatus', '', 'A no-status text'),
  out('a-missing', undefined, 'A missing-status text'),
  out('a-weird', 'something_new', 'A unknown-status text'),
  out('a-err-only', 'delivered', 'A delivered-but-error text', { error: 'Bounced (fictional)' }),
  // r2 (Bones REVISE on 6261dc4): inherited JavaScript property names are not GHL statuses.
  out('a-ctor', 'constructor', 'A constructor-status text'),
  out('a-proto', '__proto__', 'A proto-status text'),
  out('a-tostr', 'toString', 'A tostring-status text'),
  // r2: the email branch, failed with markup-shaped error text (must be shown as text), and unknown.
  out('a-email-failed', 'failed', 'A email failed text', { channel: 'Email', messageType: 'TYPE_EMAIL', contentType: 'text/plain', error: '<b>Bounced</b> <img src=x onerror="window.__f5x=1">' }),
  out('a-email-unknown', 'something_else', 'A email unknown text', { channel: 'Email', messageType: 'TYPE_EMAIL', contentType: 'text/plain' }),
];
const B_MESSAGES = [
  { id: 'b-out', conversationId: 'conv-B', contactId: 'cB', direction: 'outbound', channel: 'SMS', messageType: 'TYPE_SMS', body: 'B delivered text', dateAdded: T(2), status: 'delivered' },
];
const EXPECT = { 'A inbound hello': 'Received', 'A delivered text': 'Delivered', 'A sent text': 'Sent', 'A failed text': 'Failed', 'A undelivered text': 'Not delivered',
  'A no-status text': 'Status unknown', 'A missing-status text': 'Status unknown', 'A unknown-status text': 'Status unknown', 'A delivered-but-error text': 'Failed',
  'A constructor-status text': 'Status unknown', 'A proto-status text': 'Status unknown', 'A tostring-status text': 'Status unknown',
  'A email failed text': 'Failed', 'A email unknown text': 'Status unknown' };
const MARKUP_ERROR = 'GHL: <b>Bounced</b> <img src=x onerror="window.__f5x=1">';

async function main() {
  // ───────────────────────────── U: the pure mapping ─────────────────────────────
  const MS = BEFORE ? tryOr(() => { const src = show('src/lib/message-status.ts'); const f = path.join(APP, 'src/lib/_f5_before_message-status.ts'); fs.writeFileSync(f, src); try { return require(f); } finally { fs.rmSync(f); } }, null) : tryOr(() => require('../src/lib/message-status.ts'), null);
  const st = (m) => tryOr(() => MS.messageStatus(m), null);
  const o = (status, error) => st({ direction: 'outbound', status, error });
  check('U1 outbound failed -> Failed (failed kind)', o('failed')?.kind === 'failed' && o('failed').label === 'Failed', o('failed'));
  check('U2 outbound undelivered -> Not delivered; opt_out -> Not delivered: opted out (both failed)', o('undelivered')?.label === 'Not delivered' && o('undelivered').kind === 'failed' && o('opt_out')?.label === 'Not delivered: opted out' && o('opt_out').kind === 'failed', [o('undelivered'), o('opt_out')]);
  check('U3 outbound sent -> Sent, kind sent (never delivered)', o('sent')?.label === 'Sent' && o('sent').kind === 'sent', o('sent'));
  check('U4 outbound delivered / read / opened / clicked -> as GHL says, kind delivered', ['delivered', 'read', 'opened', 'clicked'].every((s, i) => o(s)?.kind === 'delivered' && o(s).label === ['Delivered', 'Read', 'Opened', 'Clicked'][i]), ['delivered', 'read', 'opened', 'clicked'].map((s) => o(s)));
  check('U5 outbound with NO status (missing, empty, non-string) -> Status unknown, never Sent', [o(undefined), o(''), o(5), o(null)].every((x) => x?.kind === 'unknown' && x.label === 'Status unknown'), [o(undefined), o(''), o(5)]);
  check('U6 an unrecognised status is not guessed -> Status unknown (raw kept for the tooltip)', o('something_new')?.kind === 'unknown' && o('something_new').raw === 'something_new', o('something_new'));
  check('U7 any error text means failed, whatever the status says; GHL error kept as detail', o('delivered', 'Bounced')?.kind === 'failed' && o('delivered', 'Bounced').detail === 'Bounced' && o('undelivered', 'x')?.label === 'Not delivered', [o('delivered', 'Bounced'), o('undelivered', 'x')]);
  check('U8 pending / scheduled -> Pending / Scheduled; connected -> Connected', o('pending')?.label === 'Pending' && o('scheduled')?.label === 'Scheduled' && o('connected')?.label === 'Connected', [o('pending'), o('scheduled'), o('connected')]);
  check('U9 inbound -> Received, no delivery claim (even with a status)', st({ direction: 'inbound', status: 'failed' })?.kind === 'received' && st({ direction: 'inbound' })?.label === 'Received');
  check('U10 case and spaces in GHL status are normalised; error bounded to 300 characters', o(' Delivered ')?.kind === 'delivered' && o('failed', 'x'.repeat(500))?.detail.length === 300);
  const INHERITED = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'isPrototypeOf', '__defineGetter__'];
  check('U11 r2: inherited JavaScript names as a status are unknown -- kind "unknown", label "Status unknown" (never blank, never a success)',
    INHERITED.every((s) => o(s)?.kind === 'unknown' && o(s).label === 'Status unknown'), INHERITED.map((s) => [s, o(s)?.kind, o(s)?.label]));
  check('U12 r2: an inherited name with GHL error text is still Failed (error precedence kept)',
    INHERITED.every((s) => o(s, 'Bounced')?.kind === 'failed' && o(s, 'Bounced').label === 'Failed' && o(s, 'Bounced').detail === 'Bounced'), INHERITED.map((s) => o(s, 'Bounced')?.label));

  // ───────────────────────────── S: the REAL ghl-contact-conversations handler ─────────────────────────────
  if (BEFORE) fs.writeFileSync(BEFORE_FN, show('netlify/functions/ghl-contact-conversations.ts'));
  const handler = tryOr(() => require(BEFORE ? BEFORE_FN : path.join(APP, 'netlify/functions/ghl-contact-conversations.ts')).handler, null);
  const wire = [
    { id: 'w1', direction: 'outbound', messageType: 'TYPE_SMS', body: 'one', dateAdded: T(1), status: 'Delivered' },
    { id: 'w2', direction: 'outbound', messageType: 'TYPE_SMS', body: 'two', dateAdded: T(2), status: 'failed', error: '  Carrier rejected (fictional)  ' },
    { id: 'w3', direction: 'outbound', messageType: 'TYPE_SMS', body: 'three', dateAdded: T(3) },
    { id: 'w4', direction: 'outbound', messageType: 'TYPE_SMS', body: 'four', dateAdded: T(4), status: 7, error: { x: 1 } },
    { id: 'w5', direction: 'outbound', messageType: 'TYPE_SMS', body: 'five', dateAdded: T(5), status: 'failed', error: 'e'.repeat(400) },
  ];
  const calls = [];
  global.fetch = async (url, init = {}) => {
    const u = new URL(String(url)); calls.push(`${init.method || 'GET'} ${u.pathname}`);
    const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
    if (u.origin !== 'https://services.leadconnectorhq.com') throw new Error('unexpected origin ' + u.origin);
    if (u.pathname === '/conversations/search') return json({ conversations: [{ id: 'conv-S', contactId: 'cS' }], total: 1 });
    if (u.pathname === '/conversations/conv-S/messages') return json({ messages: { messages: wire, nextPage: false } });
    throw new Error('unexpected path ' + u.pathname);
  };
  const res = handler ? await handler({ httpMethod: 'GET', headers: { cookie: COOKIE }, queryStringParameters: { id: 'cS' } }).catch((e) => ({ statusCode: 0, body: String(e) })) : { statusCode: 0, body: 'null' };
  const rows = tryOr(() => JSON.parse(res.body).messages, []) || [];
  const r = (id) => rows.find((x) => x.id === id) || {};
  check('S1 the handler answers 200 with the messages', res.statusCode === 200 && rows.length === 5, { status: res.statusCode, n: rows.length });
  check('S2 GHL status passes through (lower-cased)', r('w1').status === 'delivered' && r('w2').status === 'failed', [r('w1').status, r('w2').status]);
  check('S3 GHL error passes through (trimmed)', r('w2').error === 'Carrier rejected (fictional)', r('w2').error);
  check('S4 no status from GHL -> "" (never assumed); no error -> ""', r('w3').status === '' && r('w3').error === '', [r('w3').status, r('w3').error]);
  check('S5 non-string status / error -> ""', r('w4').status === '' && r('w4').error === '', [r('w4').status, r('w4').error]);
  check('S6 error bounded to 300 characters', typeof r('w5').error === 'string' && r('w5').error.length === 300, (r('w5').error || '').length);
  check('S7 reads only (GET search + GET messages)', calls.length > 0 && calls.every((c) => c.startsWith('GET ')), calls);

  // ───────────────────────────── R / I: the real pages ─────────────────────────────
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const tailwindcss = (await import('@tailwindcss/vite')).default;
  const { chromium } = require('playwright');
  const SWAP = ['src/pages/Conversations.tsx', 'src/pages/ContactWorkspace.tsx'];
  const before = { name: 'f5-before', enforce: 'pre', load(id) {
    if (!BEFORE) return null;
    const file = path.resolve(id.split('?')[0]); const rel = SWAP.find((x) => path.resolve(APP, x) === file);
    return rel ? show(rel) : null;
  } };
  const server = await createServer({ root: APP, configFile: false, plugins: [before, react(), tailwindcss()], logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: ['scripts/harness/conversations-styled/index.html', 'scripts/harness/dashboard-callback-popover/index.html'], include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] } });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const foreign = [], pageErrors = [], writes = [];
  const holds = {};   // contactId -> { p, open }
  const hold = (id) => { let open; const p = new Promise((r2) => { open = r2; }); holds[id] = { p, open, hit: false, settledAfterRelease: false, released: false }; return holds[id]; };
  const ROW = (id, first) => ({ id, firstName: first, lastName: 'Fixture', phone: '+15555550100', email: '', address1: '1 Fixture St', city: 'Austin', state: 'TX', postalCode: '78701',
    dateAdded: '2026-10-01T00:00:00.000Z', tags: [], dndSettings: {}, motivationScore: null, dealScore: null, combinedScore: null, completenessScore: null, callbackDatetime: null, callbackDatetimePrecise: null,
    lastCallAttempt: null, lastCallAttemptPrecise: null, callDisposition: null, dispositionAt: null, propertyAddress: '' });
  const PEOPLE = { cA: ROW('cA', 'Alma'), cB: ROW('cB', 'Bruno') };
  const THREADS = [
    { conversationId: 'conv-A', contactId: 'cA', contactName: 'Alma Fixture', phone: '+15555550100', email: '', lastMessageDate: Date.parse(T(30)), lastMessageDirection: 'outbound', preview: 'A preview', unreadCount: 0 },
    { conversationId: 'conv-B', contactId: 'cB', contactName: 'Bruno Fixture', phone: '+15555550100', email: '', lastMessageDate: Date.parse(T(20)), lastMessageDirection: 'outbound', preview: 'B preview', unreadCount: 0 },
  ];
  const MAILERS = { weekStartCT: '2026-10-31', weekEndCT: '2026-11-06', thisWeekReady: [], thisWeekBusiness: [], overdue: [], noAddress: [], totals: { ready: 0, business: 0, overdue: 0, noAddress: 0, byMailerType: {} } };
  const { createBarrierFixture } = require(path.join(APP, 'scripts/harness/current-offer-barrier-fixture.cjs'));
  const bf = createBarrierFixture({ contactOf: () => null });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, timezoneId: 'America/Chicago' });
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await context.route(/gohighlevel\.com|leadconnectorhq\.com/, (rt) => { foreign.push(rt.request().url()); return rt.abort(); });
    await context.route('**/*', async (route) => {
      const req = route.request(); const url = req.url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { foreign.push(url); return route.abort(); }
      const u = new URL(url); const fn = u.pathname.replace(/^.*\/\.netlify\/functions\//, ''); const id = u.searchParams.get('id') || '';
      const json = (s, b) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) }).catch(() => {});
      if (fn === 'app-read-session') return json(200, { signedIn: true, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
      if (req.method() === 'GET' && fn === 'call-log-barrier') { const x = await bf.handleCallLog('GET', url, null); return json(x.status, x.body); }
      if (req.method() !== 'GET') { writes.push(fn); return json(409, { error: 'offline test: refused', outcome: 'not_sent' }); }
      if (fn === 'ghl-contact-conversations') {
        const h = holds[id];
        if (h) { h.hit = true; await h.p; h.settledAfterRelease = h.released; }
        return json(200, { contactId: id, conversationCount: 1, messages: id === 'cA' ? A_MESSAGES : id === 'cB' ? B_MESSAGES : [] });
      }
      if (fn === 'ghl-conversations') return json(200, THREADS);
      if (fn === 'ghl-contacts') return json(200, Object.values(PEOPLE));
      if (fn === 'ghl-contact') return PEOPLE[id] ? json(200, PEOPLE[id]) : json(404, { error: 'unknown' });
      if (fn === 'ghl-opportunities') return json(200, { pipelineId: 'p', stages: [], opportunities: [] });
      if (fn === 'ghl-mailers') return json(200, MAILERS);
      if (fn === 'ghl-underwriting-policy') return json(200, { values: [] });
      if (fn === 'ghl-proxy') {
        const p = u.searchParams.get('path') || ''; let m;
        if ((m = p.match(/^\/contacts\/([^/?]+)\/notes$/))) return json(200, { notes: [] });
        if ((m = p.match(/^\/contacts\/([^/?]+)$/))) return json(200, { contact: { id: m[1], firstName: PEOPLE[m[1]]?.firstName ?? 'X', lastName: 'Fixture', phone: '+15555550100', dndSettings: {}, customFields: [] } });
        if (/\/customFields\/[^/]+$/.test(p)) return json(200, { customField: { id: 'folder', name: 'Folder', position: 0 } });
        if (/\/customFields$/.test(p)) return json(200, { customFields: [] });
      }
      return json(404, { error: `not answered: ${fn}` });
    });
    const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(80); } return false; };
    /** Each visible message body with the status words of its own bubble. Works on the base page too (by text). */
    const bubbles = () => page.evaluate((bodies) => {
      const outx = {};
      for (const b of bodies) {
        const el = [...document.querySelectorAll('div')].find((d) => d.textContent.trim() === b && d.children.length === 0);
        if (!el) continue;
        const bubble = el.parentElement; const header = bubble && bubble.firstElementChild;
        const tag = header && (header.querySelector('[data-testid="message-status"]') || [...header.querySelectorAll('span')].find((s) => /^(Sent|Received)$/.test(s.textContent.trim())));
        const detail = bubble && bubble.querySelector('[data-testid="message-status-detail"]');
        outx[b] = { label: tag ? tag.textContent.trim() : null, kind: tag ? tag.getAttribute('data-status-kind') : null, detail: detail ? detail.textContent.trim() : null,
          // r2: GHL's error must be text, never markup: no element inside the detail line, and the probe never ran
          injected: detail ? (detail.querySelector('*') !== null || window.__f5x === 1) : null };
      }
      return outx;
    }, [...Object.keys(EXPECT), 'B delivered text']);
    const judge = (prefix, got) => {
      const wrong = Object.entries(EXPECT).filter(([b, lab]) => !got[b] || got[b].label !== lab).map(([b, lab]) => ({ b, want: lab, got: got[b]?.label ?? null }));
      check(`${prefix} every bubble shows its GHL status (Received / Delivered / Sent / Failed / Not delivered / Status unknown)`, wrong.length === 0, wrong);
      check(`${prefix} no outbound bubble without a confirming status says Sent or Delivered`, ['A no-status text', 'A missing-status text', 'A unknown-status text'].every((b) => got[b] && !/^(Sent|Delivered)$/.test(got[b].label)), ['A no-status text', 'A missing-status text', 'A unknown-status text'].map((b) => got[b]));
      check(`${prefix} a sent message is not shown as Delivered`, got['A sent text']?.label === 'Sent');
      check(`${prefix} failed messages show GHL's error text under the body`, got['A failed text']?.detail === 'GHL: Carrier rejected the message (fictional)' && got['A delivered-but-error text']?.detail === 'GHL: Bounced (fictional)', [got['A failed text'], got['A delivered-but-error text']]);
      check(`${prefix} failed messages are marked failed (not success styling)`, got['A failed text']?.kind === 'failed' && got['A undelivered text']?.kind === 'failed', [got['A failed text']?.kind, got['A undelivered text']?.kind]);
      // r2 (Bones REVISE on 6261dc4)
      check(`${prefix} r2: inherited names (constructor, __proto__, toString) show "Status unknown", kind unknown -- never blank or a success`,
        ['A constructor-status text', 'A proto-status text', 'A tostring-status text'].every((b) => got[b]?.label === 'Status unknown' && got[b]?.kind === 'unknown'),
        ['A constructor-status text', 'A proto-status text', 'A tostring-status text'].map((b) => got[b]));
      check(`${prefix} r2: an email that failed shows Failed with GHL's markup-shaped error as literal text (no element injected); an email with an unknown status shows Status unknown`,
        got['A email failed text']?.label === 'Failed' && got['A email failed text']?.detail === MARKUP_ERROR && got['A email failed text']?.injected === false && got['A email unknown text']?.label === 'Status unknown',
        [got['A email failed text'], got['A email unknown text']]);
    };

    // RC -- Conversations page.
    await page.goto(`${base}/scripts/harness/conversations-styled/index.html`);
    await page.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 });
    await page.evaluate(() => window.__iaosNavigate('/conversations'));
    await page.getByText('Alma Fixture').first().waitFor({ timeout: 30000 });
    await page.locator('button', { hasText: 'Alma Fixture' }).first().click();
    await until(async () => Object.keys(await bubbles()).length >= 14);
    judge('RC Conversations:', await bubbles());

    // IC -- Conversations: A's read held; select B; release A.
    await page.locator('button', { hasText: 'Bruno Fixture' }).first().click();
    await until(async () => (await bubbles())['B delivered text']);
    const hA = hold('cA');
    await page.locator('button', { hasText: 'Alma Fixture' }).first().click();
    await page.waitForTimeout(300);
    await page.locator('button', { hasText: 'Bruno Fixture' }).first().click();
    await until(async () => (await bubbles())['B delivered text']);
    hA.released = true; hA.open(); delete holds.cA;
    await page.waitForTimeout(1200);
    const ic = await bubbles();
    check('IC the delayed read for A was issued, held, and answered only after B was shown', hA.hit && hA.settledAfterRelease, { hit: hA.hit, settled: hA.settledAfterRelease });
    check('IC Conversations: A\'s delayed messages (incl. its failed one) never show under B', !ic['A failed text'] && !ic['A sent text'] && ic['B delivered text']?.label === 'Delivered', Object.keys(ic));

    // RW -- Contact page history.
    await page.goto(`${base}/scripts/harness/dashboard-callback-popover/index.html`);
    await page.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 });
    await page.evaluate(() => window.__iaosNavigate('/contacts/cA'));
    await until(async () => Object.keys(await bubbles()).length >= 14, 30000);
    judge('RW Contact page:', await bubbles());

    // IW -- Contact page: A's read held; navigate to B; release A.
    const hA2 = hold('cA');
    await page.evaluate(() => window.__iaosNavigate('/contacts/cB'));
    await page.waitForTimeout(200);
    await page.evaluate(() => window.__iaosNavigate('/contacts/cA'));
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__iaosNavigate('/contacts/cB'));
    await until(async () => (await bubbles())['B delivered text'], 30000);
    hA2.released = true; hA2.open(); delete holds.cA;
    await page.waitForTimeout(1500);
    const iw = await bubbles();
    check('IW the delayed read for A was issued, held, and answered only after B was shown', hA2.hit && hA2.settledAfterRelease, { hit: hA2.hit, settled: hA2.settledAfterRelease });
    check('IW Contact page: A\'s delayed messages (incl. its failed one) never show on B', !iw['A failed text'] && !iw['A sent text'] && iw['B delivered text']?.label === 'Delivered', Object.keys(iw));

    check('W no write was attempted; nothing left the machine; no page errors', writes.length === 0 && foreign.length === 0 && pageErrors.length === 0, { writes, foreign: foreign.slice(0, 3), pageErrors: pageErrors.slice(0, 3) });
  } catch (e) {
    check(`rendered run completed (${String(e && e.message).split('\n')[0]})`, false);
  }
  await browser.close().catch(() => {}); await server.close().catch(() => {});
  if (checks < FLOOR) check(`at least ${FLOOR} checks ran`, false, checks);
  console.log(`\nF5 message status: ${checks - failures}/${checks} checks passed${BEFORE ? ` (negative control vs ${BEFORE})` : ''}`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
