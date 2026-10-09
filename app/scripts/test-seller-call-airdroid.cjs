/**
 * B14-13 — "Call with AirDroid" in Seller Call, rendered, with MOCKED launches.
 *
 * Vite serves two pages from scripts/harness/seller-call-airdroid in headless
 * Chromium and aliases the component's launch interface
 * (src/lib/airdroid-launch-stand-in.ts) to airdroid-launch-mock.ts. The mock
 * returns { ok: true } ("handed-off"), a launch error, or throws. Nothing opens
 * a link, window or request; no helper, AirDroid, phone or GHL record is
 * involved. Every /.netlify/functions request is answered from an in-memory
 * fixture (reads can be delayed per contact) and anything else is aborted and
 * counted.
 *
 * What is proven is exactly what each check names. In particular:
 *   - "handed-off" is the mock's ok result; the suite uses it as its stand-in
 *     for a cancelled launch. How a REAL cancelled or failed launch reaches the
 *     page is not tested here.
 *   - The script check opens and closes the full-script drawer; it does not
 *     test reading position.
 *   - Seller Call has no free-text notes composer. The independent drafts
 *     checked are the ones it has: the negotiation Seller Position input and
 *     the Transaction structure input, plus the Pass reason and Follow-Up time.
 *   - Saves are compared as complete operations (operation, target and all
 *     arguments) against the same save with no launch. Request ids are left
 *     out; only contact.lastCallAttempt's value and the ledger's "Outcome
 *     timestamp:" line are normalised (when taken during the run). The
 *     callback time is asserted exactly.
 *
 * NEGATIVE CONTROL: `node scripts/test-seller-call-airdroid.cjs --before=<rev>`
 * renders <rev>'s component on the component page and must FAIL (exit 1) for
 * a revision without the AirDroid option -- e.g. --before=45361c1. (The
 * workspace page always uses the current component.)
 */
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');

const APP = path.resolve(__dirname, '..');
const HARNESS_DIR = path.join(APP, 'scripts/harness/seller-call-airdroid');
const COMPONENT_PAGE = '/scripts/harness/seller-call-airdroid/index.html';
const WORKSPACE_PAGE = '/scripts/harness/seller-call-airdroid/workspace.html';
const MOCK = path.join(HARNESS_DIR, 'airdroid-launch-mock.ts');
const BEFORE_FILE = path.join(HARNESS_DIR, 'VoiceControlsBefore.tsx');
const beforeArg = process.argv.find((a) => a.startsWith('--before='));
const BEFORE_REV = beforeArg ? beforeArg.slice('--before='.length) : null;

// Load the app's TypeScript modules the fixture needs (as test-contact-isolation.cjs does).
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
const F = getConfig('test').fields;
const { createBarrierFixture } = require('./harness/current-offer-barrier-fixture.cjs');
const { parseOutcomeNote } = require(path.join(APP, 'src/lib/seller-call-outcome.ts'));

/**
 * Taken from the finished file, never back-filled from a passing run: 25 single probe()/check()
 * call sites + 1 inside the invalid-number loop x 3 numbers = 28.
 */
const FLOOR = 28;
let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}
/** One check whose steps may throw (e.g. no AirDroid button in the negative control): a throw is a FAIL, never a missing check. */
async function probe(name, fn) {
  try { const { ok, detail } = await fn(); check(name, ok, detail); } catch (e) { check(name, false, e.message.split('\n')[0]); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

if (fs.existsSync(BEFORE_FILE)) fs.rmSync(BEFORE_FILE);
if (BEFORE_REV) {
  const src = execFileSync('git', ['show', `${BEFORE_REV}:app/src/components/SellerCallVoiceControls.tsx`], { cwd: APP, encoding: 'utf8' });
  fs.writeFileSync(BEFORE_FILE, src.replace(/from "\.\.\/\.\.\//g, 'from "../../../').replace(/from "\.\.\/(?!\.\.\/)/g, 'from "../../../src/')
    .replace(/from "\.\//g, 'from "../../../src/components/').replace(/import "\.\//g, 'import "../../../src/components/'));
  console.log(`NEGATIVE CONTROL: rendering SellerCallVoiceControls from ${BEFORE_REV}; this run must fail.`);
}

const MOCK_ERROR = "The AirDroid helper isn't installed on this PC. Use GHL Phone or Cell.";
const THROW_ERROR = "AirDroid couldn't be started. Use GHL Phone or Cell.";
const NO_NUMBER = 'Unavailable: IAOS has no valid 10-digit US number for this seller. Use GHL Phone or Cell.';
const CLAIMS = /prepared|dial(?:l)?ed|connected|ended|calling|call (?:placed|started)|Check AirDroid and your phone|handed|press Make Call/i;
const PASS_REASON = 'Seller wants retail, not a cash offer.';
const FOLLOW_UP_LOCAL = '2026-12-01T10:00';          // America/Chicago
const FOLLOW_UP_ISO = '2026-12-01T16:00:00.000Z';
const SELLER_POSITION_DRAFT = '245000';
const STRUCTURE_DRAFT = 'Subject-to with seller carry';

// ── In-memory GHL fixture for the workspace (from test-contact-isolation.cjs) ─
const A = 'fixtureContactA';
const B = 'fixtureContactB';
const C = 'fixtureContactC';                         // shares A's phone number
const PEOPLE = { [A]: ['Alpha', '+12145550101'], [B]: ['Bravo', '+14695550123'], [C]: ['Charlie', '+12145550101'] };
let db;
let slow = {};                                        // contact id -> ms to delay that contact's reads
function resetDb() {
  db = Object.fromEntries(Object.entries(PEOPLE).map(([id, [first]]) => [id,
    { id, first, dnd: {}, fields: new Map(), notes: [{ id: `${id}-n1`, body: `Seed note for ${first}`, dateAdded: '2026-09-30T12:00:00.000Z' }] }]));
  slow = {};
}
const field = (c, id) => (c.fields.has(id) ? c.fields.get(id) : null);
const contactRow = (c) => ({
  id: c.id, firstName: c.first, lastName: 'Fixture', phone: PEOPLE[c.id][1], email: '', address1: '', city: '', state: '', postalCode: '',
  dateAdded: '2026-09-01T00:00:00.000Z', tags: [], dndSettings: c.dnd, motivationScore: null, dealScore: null, combinedScore: null, completenessScore: null,
  callbackDatetime: field(c, F.callbackDatetimePrecise), callbackDatetimePrecise: field(c, F.callbackDatetimePrecise),
  lastCallAttempt: field(c, F.lastCallAttemptPrecise), lastCallAttemptPrecise: field(c, F.lastCallAttemptPrecise),
  callDisposition: field(c, F.callDisposition), dispositionAt: field(c, F.dispositionAt),
});
const detail = (c) => ({ contact: { id: c.id, firstName: c.first, lastName: 'Fixture', phone: PEOPLE[c.id][1], dndSettings: c.dnd,
  customFields: [...c.fields].map(([id, value]) => ({ id, value })) } });
const pipeline = () => ({ pipelineId: 'fixture-pipeline', stages: [],
  opportunities: Object.keys(PEOPLE).map((id) => ({ id: `${id}-opp`, contactId: id, contactName: db[id].first, opportunityName: `${db[id].first} deal`,
    phone: '', email: '', stageId: 'fixture-stage', customFields: [] })) });
function applyWrite(op, target, args) {
  const c = target ? db[target] : null;
  if (!c) return { status: 404, body: { error: 'unknown target' } };
  const set = (...ids) => ids.forEach((id) => (args.value === null ? c.fields.delete(id) : c.fields.set(id, args.value)));
  switch (op) {
    case 'note.create': c.notes.push({ id: `${target}-n${c.notes.length + 1}`, body: args.body, dateAdded: new Date().toISOString() }); return { status: 200, body: { note: { id: 'n' } } };
    case 'contact.lastCallAttempt': set(F.lastCallAttempt, F.lastCallAttemptPrecise); break;
    case 'contact.callback': case 'contact.explicitCallback': set(F.callbackDatetime, F.callbackDatetimePrecise); break;
    default: return { status: 400, body: { error: `fixture does not model ${op}` } };
  }
  return { status: 200, body: { confirmed: true } };
}
const bf = createBarrierFixture({ contactOf: (o) => (o.endsWith('-opp') && PEOPLE[o.slice(0, -4)] ? o.slice(0, -4) : null) });
function classify(url, method, post) {
  const u = new URL(url);
  const fn = u.pathname.replace('/.netlify/functions/', '');
  if (fn === 'ghl-write' && method === 'POST') return { kind: 'write', op: post?.operation, contact: post?.targetId, args: post?.args, requestId: post?.requestId };
  if (fn === 'ghl-proxy') {
    const p = u.searchParams.get('path') || '';
    let m;
    if ((m = p.match(/^\/contacts\/([^/?]+)\/notes$/))) return { kind: 'notes', contact: m[1] };
    if ((m = p.match(/^\/contacts\/([^/?]+)$/))) return { kind: 'detail', contact: m[1] };
    if (/\/customFields\/[^/]+$/.test(p)) return { kind: 'folder' };
    if (/\/customFields$/.test(p)) return { kind: 'defs' };
    return { kind: 'proxy-other', path: p };
  }
  if (fn === 'ghl-contact') return { kind: 'row', contact: u.searchParams.get('id') };
  return { kind: fn };
}
function answer(req) {
  switch (req.kind) {
    case 'notes': return { status: 200, body: { notes: db[req.contact].notes.slice() } };
    case 'detail': return { status: 200, body: detail(db[req.contact]) };
    case 'row': return { status: 200, body: contactRow(db[req.contact]) };
    case 'defs': return { status: 200, body: { customFields: [] } };
    case 'folder': return { status: 200, body: { customField: { id: 'folder', name: 'Folder', position: 0 } } };
    case 'ghl-opportunities': return { status: 200, body: pipeline() };
    case 'ghl-underwriting-policy': return { status: 200, body: { values: [] } };
    case 'ghl-contact-conversations': return { status: 200, body: { messages: [], conversations: [] } };
    case 'iaos-activation': return { status: 200, body: { state: 'open', activationId: 'v2-act-page-fixture', deployId: 'page-deploy', runtimeDeployId: 'page-deploy' } };
    default: return { status: 404, body: { error: `fixture does not model ${req.kind}` } };
  }
}

let log = [];
const foreign = [];
const pageErrors = [];
const RUN_START = Date.now();
const watchdog = setTimeout(() => { console.error('FAIL  the suite did not finish within 10 minutes -- stopped'); process.exit(1); }, 10 * 60_000);

/**
 * A save, as complete operations: operation, target and every argument. Request ids are left out. Exactly
 * two values are normalised, and only when they hold a time taken during this run: the value of
 * contact.lastCallAttempt, and the "Outcome timestamp:" line of an outcome-ledger note. Every other value
 * -- the callback, "Follow-up at:", any other timestamp -- is compared exactly.
 */
const isNow = (iso) => { const t = Date.parse(iso); return /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(iso) && t >= RUN_START - 60_000 && t <= Date.now() + 60_000; };
const normalise = (ws) => ws.map((w) => {
  let args = w.args ?? null;
  if (w.op === 'contact.lastCallAttempt' && typeof args?.value === 'string' && isNow(args.value)) args = { ...args, value: '<now>' };
  if (w.op === 'note.create' && typeof args?.body === 'string') {
    args = { ...args, body: args.body.replace(/^Outcome timestamp: (\S+)$/m, (line, iso) => (isNow(iso) ? 'Outcome timestamp: <now>' : line)) };
  }
  return { op: w.op, contact: w.contact, args };
});

/** Card order and rows of the calling options, measured in the page. */
const LAYOUT = () => {
  const rect = (id) => { const el = document.querySelector(`[data-testid="${id}"]`); if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width) }; };
  const btn = document.querySelector('[data-testid="call-with-airdroid"]');
  const ghl = document.querySelector('[data-testid="open-ghl-contact"]');
  return {
    cards: [...document.querySelectorAll('[data-testid="seller-call-modes"] > div')].map((d) => d.getAttribute('data-testid')),
    section: rect('seller-call-modes'), airdroid: rect('call-with-airdroid-mode'), ghlCard: rect('call-with-ghl-mode'), cell: rect('call-with-cell-mode'),
    button: btn ? { tag: btn.tagName, text: btn.textContent.trim(), disabled: btn.disabled, bg: getComputedStyle(btn).backgroundColor } : null,
    ghlBg: ghl ? getComputedStyle(ghl).backgroundColor : null,
    links: document.querySelectorAll('a[href^="iaos-airdroid:"]').length,
    pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
};

async function main() {
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const tailwindcss = (await import('@tailwindcss/vite')).default;
  const { chromium } = require('playwright');
  const server = await createServer({
    root: APP, configFile: false, plugins: [react(), tailwindcss()], logLevel: 'error', clearScreen: false,
    resolve: { alias: [{ find: '../lib/airdroid-launch-stand-in', replacement: MOCK }] },
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: [COMPONENT_PAGE.slice(1), WORKSPACE_PAGE.slice(1)],
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

  /** A fresh page; every function call is answered from the fixture, anything else is aborted and counted. */
  const open = async (url, { width = 1280, ready }) => {
    const mobile = width < 768;
    const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: mobile, hasTouch: mobile, timezoneId: 'America/Chicago' });
    const page = await context.newPage();
    const popups = [];
    context.on('page', (p) => { if (p !== page) popups.push(p.url()); });
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await context.route('**/*', async (route) => {
      const u = route.request().url();
      if (u.startsWith(base) && !u.includes('/.netlify/functions/')) return route.continue();
      if (!u.includes('/.netlify/functions/')) { foreign.push(u); return route.abort(); }
      let post = null;
      try { post = route.request().postDataJSON(); } catch { post = null; }
      const req = classify(u, route.request().method(), post);
      log.push(req);
      const reply = (res) => route.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(res.body) }).catch(() => {});
      if (req.kind === 'call-log-barrier') return reply(await bf.handleCallLog(route.request().method(), u, post));
      if (req.kind === 'current-offer-barrier') return reply(await bf.handle(route.request().method(), u, post));
      if (req.kind === 'write' && !(req.op && db[req.contact])) return reply({ status: 400, body: { error: 'fixture: malformed or unknown write' } });
      if (req.kind === 'write') {
        return reply(await bf.write({ operation: req.op, targetId: req.contact, requestId: req.requestId, contactId: req.contact, args: req.args },
          () => { const a = applyWrite(req.op, req.contact, req.args); return { confirmed: a.status === 200 }; },
          { outcome: req.op === 'note.create' ? parseOutcomeNote(req.args.body) : null, refuse: null }));
      }
      if (req.contact && slow[req.contact]) await new Promise((r) => setTimeout(r, slow[req.contact]));
      return reply(answer(req));
    });
    await page.goto(`${base}${url}`, { timeout: 60000 });
    await ready(page);
    page.setDefaultTimeout(8000);
    return { context, page, popups };
  };
  const mockMode = (page, mode) => page.evaluate((m) => { window.__airdroidMock.mode = m; window.__airdroidMock.calls = []; }, mode);
  const mockCalls = (page) => page.evaluate(() => window.__airdroidMock.calls);
  const card = (page) => page.getByTestId('call-with-airdroid-mode').innerText();
  const errorText = async (page) => ((await page.getByTestId('airdroid-launch-error').count()) ? (await page.getByTestId('airdroid-launch-error').innerText()).trim() : null);
  const until = async (page, fn, label, ms = 15000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await fn()) return; await page.waitForTimeout(50); }
    throw new Error(`timed out waiting for ${label}`);
  };
  const writes = () => log.filter((r) => r.kind === 'write');

  /** A fresh Seller Call page for `contact`, with a fresh fixture. */
  const workspace = async (contact) => {
    resetDb(); bf.reset(); log = [];
    return open(WORKSPACE_PAGE, { ready: async (page) => {
      await page.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 });
      await page.evaluate((to) => window.__iaosNavigate(to), `/contacts/${contact}/seller-call`);
      await page.getByTestId('call-with-airdroid-mode').waitFor({ timeout: 60000 });
      await page.getByTestId('call-outcome-pass-toggle').waitFor({ timeout: 60000 });
    } });
  };
  const go = (page, contact) => page.evaluate((to) => window.__iaosNavigate(to), `/contacts/${contact}/seller-call`);
  const loadedFor = async (page, first) => (await page.locator('body').innerText()).includes(`${first} deal`);
  const recordPass = async (page) => {
    await until(page, () => page.getByTestId('call-outcome-pass-confirm').isEnabled(), 'Pass confirm enabled');
    await page.getByTestId('call-outcome-pass-confirm').click();
    await until(page, async () => db[A].notes.some((n) => /Outcome: pass/.test(n.body)), 'Pass outcome note saved');
    await page.waitForTimeout(300);
  };
  const recordFollowUp = async (page) => {
    await page.getByTestId('call-outcome-follow-up-confirm').click();
    await until(page, async () => db[A].notes.some((n) => /Outcome: follow_up/.test(n.body)), 'Follow-Up outcome note saved');
    await page.waitForTimeout(300);
  };
  /** The independent drafts Seller Call actually has (no free-text notes composer exists). */
  const structureInput = (page) => page.getByPlaceholder('Transaction structure');
  const fillDrafts = async (page) => {
    await page.getByTestId('negotiation-seller-position-input').fill(SELLER_POSITION_DRAFT);
    await structureInput(page).fill(STRUCTURE_DRAFT);
  };
  const drafts = async (page) => ({ sellerPosition: await page.getByTestId('negotiation-seller-position-input').inputValue(), structure: await structureInput(page).inputValue() });
  const DRAFTS = { sellerPosition: SELLER_POSITION_DRAFT, structure: STRUCTURE_DRAFT };

  try {
    // ═══ NORMALISATION (no browser) ═════════════════════════════════════════
    {
      const now = new Date().toISOString();
      const LEDGER = (ts, fu) => `IAOS SELLER CALL OUTCOME LEDGER — iaos-seller-call-outcome-v1
Outcome timestamp: ${ts}
Outcome: follow_up
Follow-up at: ${fu}`;
      const input = [
        { op: 'contact.lastCallAttempt', contact: A, args: { value: now } },
        { op: 'note.create', contact: A, args: { body: LEDGER(now, now) } },
        { op: 'contact.callback', contact: A, args: { value: now } },
        { op: 'note.create', contact: A, args: { body: `Called at ${now}` } },
        { op: 'contact.lastCallAttempt', contact: A, args: { value: '2026-01-02T03:04:05.000Z' } },
      ];
      const out = normalise(input);
      check('normalisation touches only the run-time value of contact.lastCallAttempt and the ledger "Outcome timestamp:" line; an unrelated run-time timestamp (callback, "Follow-up at:", another note) and an older lastCallAttempt stay exact',
        same(out, [
          { op: 'contact.lastCallAttempt', contact: A, args: { value: '<now>' } },
          { op: 'note.create', contact: A, args: { body: LEDGER('<now>', now) } },
          { op: 'contact.callback', contact: A, args: { value: now } },
          { op: 'note.create', contact: A, args: { body: `Called at ${now}` } },
          { op: 'contact.lastCallAttempt', contact: A, args: { value: '2026-01-02T03:04:05.000Z' } },
        ]), out);
    }

    // ═══ COMPONENT ══════════════════════════════════════════════════════════
    const componentReady = (page) => page.getByTestId('seller-call-modes').waitFor({ timeout: 60000 });
    {
      const { context, page, popups } = await open(`${COMPONENT_PAGE}?phone=${encodeURIComponent('(214) 555-0101')}`, { width: 1440, ready: componentReady });
      check('harness renders the expected component source', (await page.evaluate(() => window.__iaosSource)) === (BEFORE_REV ? 'before' : 'current'));
      await probe('AirDroid is the first card on its own full row, a primary button; GHL Phone (not primary) and Cell share the next row', async () => {
        const l = await page.evaluate(LAYOUT);
        return { ok: l.cards.join('|') === 'call-with-airdroid-mode|call-with-ghl-mode|call-with-cell-mode' && l.airdroid.width === l.section.width
          && l.airdroid.top < l.ghlCard.top && l.ghlCard.top === l.cell.top && l.button?.tag === 'BUTTON' && l.button.text === 'Call with AirDroid'
          && !l.button.disabled && l.button.bg === 'rgb(0, 92, 230)' && l.ghlBg !== 'rgb(0, 92, 230)' && l.links === 0 && !l.pageOverflow, detail: l };
      });
      await probe('mock ok result: the seller\'s 10 digits go to the launch interface, and the card shows no message and no call claim', async () => {
        await mockMode(page, 'handed-off');
        const url = page.url();
        await page.getByTestId('call-with-airdroid').click();
        await page.waitForTimeout(200);
        const text = await card(page);
        return { ok: same(await mockCalls(page), ['2145550101']) && (await errorText(page)) === null && text === 'Call with AirDroid\nKay Fixture · 214-555-0101\nCall with AirDroid'
          && !CLAIMS.test(text) && page.url() === url && popups.length === 0, detail: { calls: await mockCalls(page), text, popups } };
      });
      await probe('mock launch error: shown as an alert with the way on, claiming nothing', async () => {
        await mockMode(page, 'error');
        await page.getByTestId('call-with-airdroid').click();
        const role = await page.getByTestId('airdroid-launch-error').getAttribute('role');
        return { ok: (await errorText(page)) === MOCK_ERROR && role === 'alert' && !CLAIMS.test(await card(page)), detail: { error: await errorText(page), role } };
      });
      await probe('mock throw: a fixed error shows, and the next ok result clears it', async () => {
        await mockMode(page, 'throw');
        await page.getByTestId('call-with-airdroid').click();
        const thrown = await errorText(page);
        await mockMode(page, 'handed-off');
        await page.getByTestId('call-with-airdroid').click();
        return { ok: thrown === THROW_ERROR && (await errorText(page)) === null, detail: { thrown, after: await errorText(page) } };
      });
      await probe('keyboard: Enter on the focused button launches once', async () => {
        await mockMode(page, 'handed-off');
        await page.getByTestId('call-with-airdroid').focus();
        await page.keyboard.press('Enter');
        return { ok: same(await mockCalls(page), ['2145550101']), detail: await mockCalls(page) };
      });
      await probe('a different seller with the SAME number (same mounted component) clears the launch error and still launches that number', async () => {
        await mockMode(page, 'error');
        await page.getByTestId('call-with-airdroid').click();
        const shown = await errorText(page);
        await page.evaluate(() => window.__iaosSetSeller('contact-fixture-2', 'Lee Fixture'));
        await page.waitForTimeout(100);
        const cleared = await errorText(page);
        await mockMode(page, 'handed-off');
        await page.getByTestId('call-with-airdroid').click();
        return { ok: shown === MOCK_ERROR && cleared === null && (await card(page)).includes('Lee Fixture · 214-555-0101') && same(await mockCalls(page), ['2145550101']),
          detail: { shown, cleared, card: await card(page), calls: await mockCalls(page) } };
      });
      await probe('a new seller number clears a launch error and targets the new number', async () => {
        await mockMode(page, 'error');
        await page.getByTestId('call-with-airdroid').click();
        const shown = await errorText(page);
        await page.evaluate(() => window.__iaosSetPhone('+1 (469) 555-0123'));
        await page.waitForTimeout(100);
        const cleared = await errorText(page);
        await mockMode(page, 'handed-off');
        await page.getByTestId('call-with-airdroid').click();
        return { ok: shown === MOCK_ERROR && cleared === null && same(await mockCalls(page), ['4695550123']), detail: { shown, cleared, calls: await mockCalls(page) } };
      });
      await probe('GHL Phone stays available as the backup', async () => ({ ok: await page.getByTestId('open-ghl-contact').isEnabled() }));
      await context.close();
    }
    for (const phone of ['', '555', '(114) 555-0101']) {
      const { context, page } = await open(`${COMPONENT_PAGE}?phone=${encodeURIComponent(phone)}`, { ready: componentReady });
      await probe(`no valid number ("${phone}"): the button is disabled with the reason, a forced click launches nothing, GHL Phone stays offered`, async () => {
        await mockMode(page, 'handed-off');
        await page.getByTestId('call-with-airdroid').click({ force: true });
        const reason = (await page.getByTestId('airdroid-no-number').innerText()).trim();
        return { ok: (await page.getByTestId('call-with-airdroid').isDisabled()) && reason === NO_NUMBER && same(await mockCalls(page), [])
          && (await page.getByTestId('open-ghl-contact').isEnabled()), detail: { reason, calls: await mockCalls(page) } };
      });
      await context.close();
    }
    {
      const { context, page } = await open(`${COMPONENT_PAGE}?phone=${encodeURIComponent('(214) 555-0101')}`, { width: 375, ready: componentReady });
      await probe('phone width: one column with AirDroid first, nothing scrolls sideways', async () => {
        const l = await page.evaluate(LAYOUT);
        return { ok: l.cards[0] === 'call-with-airdroid-mode' && l.airdroid.width === l.section.width && l.ghlCard.top > l.airdroid.top && l.cell.top > l.ghlCard.top && !l.pageOverflow, detail: l };
      });
      await context.close();
    }

    // ═══ WORKSPACE (the real Seller Call page) ══════════════════════════════
    // Controls: the same steps -- the same drafts typed, then the same Pass or Follow-Up save -- on a fresh
    // page with no launch at all. (The outcome note snapshots the Seller Position input, so drafts must match.)
    const control = {};
    {
      const { context, page } = await workspace(A);
      await fillDrafts(page);
      await page.getByTestId('call-outcome-pass-toggle').click();
      await page.getByTestId('call-outcome-pass-reason').fill(PASS_REASON);
      await recordPass(page);
      control.pass = normalise(writes());
      await context.close();
    }
    {
      const { context, page } = await workspace(A);
      await fillDrafts(page);
      await page.getByTestId('call-outcome-follow-up-toggle').click();
      await page.getByTestId('call-outcome-follow-up-at').fill(FOLLOW_UP_LOCAL);
      await recordFollowUp(page);
      control.followUp = normalise(writes());
      await context.close();
    }
    await probe('control saves (no launch): Pass sends its outcome note with the reason; Follow-Up sends the callback at exactly 2026-12-01T16:00:00.000Z, its note and its outcome note', async () => {
      const passNote = control.pass.find((w) => w.op === 'note.create' && /Outcome: pass/.test(w.args.body));
      const cb = control.followUp.filter((w) => w.op === 'contact.callback');
      return { ok: !!passNote && passNote.args.body.includes(`Reason: ${PASS_REASON}`) && control.pass.every((w) => w.contact === A)
        && same(cb, [{ op: 'contact.callback', contact: A, args: { value: FOLLOW_UP_ISO } }])
        && control.followUp.some((w) => w.op === 'note.create' && w.args.body === 'Callback scheduled for Dec 1, 10:00 AM')
        && control.followUp.some((w) => w.op === 'note.create' && /Outcome: follow_up/.test(w.args.body) && w.args.body.includes(`Follow-up at: ${FOLLOW_UP_ISO}`))
        && control.followUp.every((w) => w.contact === A), detail: control };
    });

    {
      // Failed launch (mock error) while drafts and a Pass are in progress; then save; then switch sellers.
      const { context, page, popups } = await workspace(A);
      await probe('workspace: the real Seller Call page leads its calling options with AirDroid for the selected seller', async () => {
        const l = await page.evaluate(LAYOUT);
        return { ok: l.cards[0] === 'call-with-airdroid-mode' && (await card(page)).includes('Alpha Fixture · 214-555-0101') && await loadedFor(page, 'Alpha'), detail: { l, card: await card(page) } };
      });
      await fillDrafts(page);
      await page.getByTestId('call-outcome-pass-toggle').click();
      await page.getByTestId('call-outcome-pass-reason').fill(PASS_REASON);
      const writesBefore = writes().length;
      await mockMode(page, 'error');
      await page.getByTestId('call-with-airdroid').click().catch(() => {});
      await page.waitForTimeout(300);
      await probe('mock launch error: the error shows; seller, route, open Pass form, Pass reason and the independent drafts (Seller Position, Transaction structure) stay; nothing was written', async () => {
        const reason = await page.getByTestId('call-outcome-pass-reason').inputValue();
        return { ok: (await errorText(page)) === MOCK_ERROR && same(await mockCalls(page), ['2145550101'])
          && (await page.evaluate(() => location.pathname)) === `/contacts/${A}/seller-call` && (await card(page)).includes('Alpha Fixture')
          && reason === PASS_REASON && same(await drafts(page), DRAFTS) && writes().length === writesBefore && popups.length === 0,
          detail: { reason, drafts: await drafts(page), error: await errorText(page), writes: normalise(writes().slice(writesBefore)) } };
      });
      await probe('after the mock error the full-script drawer opens and closes, and every draft is unchanged', async () => {
        await page.getByTestId('view-full-script').click();
        await page.getByTestId('full-script-drawer').waitFor();
        const scriptText = (await page.getByTestId('full-script-drawer').innerText()).length;
        await page.getByTestId('full-script-close').click();
        await page.getByTestId('full-script-drawer').waitFor({ state: 'hidden' });
        return { ok: scriptText > 200 && (await page.getByTestId('call-outcome-pass-reason').inputValue()) === PASS_REASON && same(await drafts(page), DRAFTS),
          detail: { scriptText, drafts: await drafts(page) } };
      });
      await probe('after the mock error the Pass save sends exactly the control\'s complete operations (targets and arguments)', async () => {
        await recordPass(page);
        const sent = normalise(writes().slice(writesBefore));
        return { ok: (await page.getByTestId('call-outcome-error').count()) === 0 && same(sent, control.pass), detail: { sent, control: control.pass } };
      });
      await probe('seller change to a contact with the SAME number (Charlie, A\'s phone): the launch error is cleared and the card names Charlie', async () => {
        await mockMode(page, 'error');
        await page.getByTestId('call-with-airdroid').click();
        const shown = await errorText(page);
        await go(page, C);
        await until(page, async () => (await card(page).catch(() => '')).includes('Charlie Fixture · 214-555-0101'), 'Charlie card');
        const cleared = await errorText(page);
        await mockMode(page, 'handed-off');
        await page.getByTestId('call-with-airdroid').click();
        return { ok: shown === MOCK_ERROR && cleared === null && same(await mockCalls(page), ['2145550101']) && await loadedFor(page, 'Charlie'),
          detail: { shown, cleared, calls: await mockCalls(page) } };
      });
      await probe('seller change to a different number (Bravo): the launch error is cleared and only Bravo\'s number is launched', async () => {
        await mockMode(page, 'error');
        await page.getByTestId('call-with-airdroid').click();
        const shown = await errorText(page);
        await go(page, B);
        await until(page, async () => (await card(page).catch(() => '')).includes('Bravo Fixture · 469-555-0123'), 'Bravo card');
        const cleared = await errorText(page);
        await mockMode(page, 'handed-off');
        await page.getByTestId('call-with-airdroid').click();
        return { ok: shown === MOCK_ERROR && cleared === null && same(await mockCalls(page), ['4695550123']), detail: { shown, cleared, calls: await mockCalls(page) } };
      });
      await context.close();
    }
    {
      // Rapid seller switching while reads are still loading: A and Charlie are slow, Bravo is fast.
      const { context, page } = await workspace(B);
      await mockMode(page, 'error');
      await page.getByTestId('call-with-airdroid').click();
      slow = { [A]: 1500, [C]: 1500 };
      await go(page, A);
      await page.waitForTimeout(100);
      await go(page, C);
      await page.waitForTimeout(100);
      await go(page, B);
      await page.waitForTimeout(2500);                  // A's and Charlie's late reads have now arrived
      await probe('rapid switching during loading (Bravo -> A -> Charlie -> Bravo, A and Charlie slow): after the late reads land, the page and card show Bravo with no stale error, and a launch targets only Bravo', async () => {
        const shownCard = await card(page);
        const err = await errorText(page);
        await mockMode(page, 'handed-off');
        await page.getByTestId('call-with-airdroid').click();
        return { ok: (await page.evaluate(() => location.pathname)) === `/contacts/${B}/seller-call` && shownCard.includes('Bravo Fixture · 469-555-0123')
          && !/Alpha|Charlie/.test(shownCard) && err === null && same(await mockCalls(page), ['4695550123']) && await loadedFor(page, 'Bravo')
          && writes().length === 0, detail: { shownCard, err, calls: await mockCalls(page), writes: writes().length } };
      });
      await context.close();
    }
    {
      // Mock ok result (the suite's stand-in for a cancelled launch) while a Follow-Up and drafts are in progress.
      const { context, page } = await workspace(A);
      await fillDrafts(page);
      await page.getByTestId('call-outcome-follow-up-toggle').click();
      await page.getByTestId('call-outcome-follow-up-at').fill(FOLLOW_UP_LOCAL);
      const writesBefore = writes().length;
      await mockMode(page, 'handed-off');
      await page.getByTestId('call-with-airdroid').click().catch(() => {});
      await page.waitForTimeout(300);
      await probe('mock ok result: no message or claim; the Follow-Up form, its time and the independent drafts stay; nothing was written', async () => {
        const at = await page.getByTestId('call-outcome-follow-up-at').inputValue();
        return { ok: (await errorText(page)) === null && !CLAIMS.test(await card(page)) && at === FOLLOW_UP_LOCAL && same(await drafts(page), DRAFTS)
          && writes().length === writesBefore && same(await mockCalls(page), ['2145550101']), detail: { at, drafts: await drafts(page), writes: normalise(writes().slice(writesBefore)) } };
      });
      await probe('after the mock ok result the Follow-Up save sends exactly the control\'s complete operations, with the callback at exactly 2026-12-01T16:00:00.000Z', async () => {
        await recordFollowUp(page);
        const sent = normalise(writes().slice(writesBefore));
        return { ok: (await page.getByTestId('call-outcome-error').count()) === 0 && same(sent, control.followUp)
          && sent.some((w) => w.op === 'contact.callback' && w.args.value === FOLLOW_UP_ISO) && field(db[A], F.callbackDatetimePrecise) === FOLLOW_UP_ISO,
          detail: { sent, control: control.followUp } };
      });
      await context.close();
    }
    {
      // Mock throw, after the script was opened, with a Pass reason and drafts typed; then save.
      const { context, page } = await workspace(A);
      await page.getByTestId('view-full-script').click();
      await page.getByTestId('full-script-drawer').waitFor();
      await page.getByTestId('full-script-close').click();
      await fillDrafts(page);
      await page.getByTestId('call-outcome-pass-toggle').click();
      await page.getByTestId('call-outcome-pass-reason').fill(PASS_REASON);
      const writesBefore = writes().length;
      await mockMode(page, 'throw');
      await page.getByTestId('call-with-airdroid').click().catch(() => {});
      await page.waitForTimeout(300);
      await probe('mock throw: the fixed error shows; seller, Pass form, reason and drafts stay; the drawer still opens and closes; nothing was written', async () => {
        await page.getByTestId('view-full-script').click();
        await page.getByTestId('full-script-drawer').waitFor();
        await page.getByTestId('full-script-close').click();
        return { ok: (await errorText(page)) === THROW_ERROR && (await page.getByTestId('call-outcome-pass-reason').inputValue()) === PASS_REASON
          && same(await drafts(page), DRAFTS) && (await card(page)).includes('Alpha Fixture') && writes().length === writesBefore && await loadedFor(page, 'Alpha'),
          detail: { error: await errorText(page), drafts: await drafts(page) } };
      });
      await probe('after the mock throw the Pass save sends exactly the control\'s complete operations', async () => {
        await recordPass(page);
        const sent = normalise(writes().slice(writesBefore));
        return { ok: (await page.getByTestId('call-outcome-error').count()) === 0 && same(sent, control.pass), detail: { sent, control: control.pass } };
      });
      await context.close();
    }

    check('nothing left the machine: every request was the local page or a fixture-answered function', foreign.length === 0, foreign);
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
