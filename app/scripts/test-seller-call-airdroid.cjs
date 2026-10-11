/**
 * B14-13 — "Call with AirDroid" in Seller Call, rendered, with MOCKED launches.
 *
 * Vite serves two pages from scripts/harness/seller-call-airdroid in headless
 * Chromium and aliases the component's launch interface
 * (src/lib/airdroid-launch.ts) to airdroid-launch-mock.ts. The mock
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
 *     out; only contact.lastCallAttempt's value and the "Outcome timestamp:"
 *     field of a note the app's parseOutcomeNote recognises as a ledger are
 *     normalised (when taken during the run). Every other note is compared
 *     byte for byte. The callback time is asserted exactly.
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
 * Taken from the finished file, never back-filled from a passing run: 28 single probe()/check()
 * call sites + 1 inside the invalid-number loop x 3 numbers + 1 inside the Full Script layout loop
 * x 4 widths + 1 inside the compact Call loop x 3 widths = 38.
 */
const FLOOR = 38;
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
 * contact.lastCallAttempt, and the "Outcome timestamp:" field of a RECOGNISED outcome-ledger note -- one the
 * app's own parseOutcomeNote accepts (exact iaos-seller-call-outcome-v1 header on line 1, required fields
 * valid), and only the field line that parser reads. Any other note, including one that merely contains an
 * "Outcome timestamp:" line, is compared byte for byte, as is every other value.
 */
const isNow = (iso) => { const t = Date.parse(iso); return /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(iso) && t >= RUN_START - 60_000 && t <= Date.now() + 60_000; };
const normalise = (ws) => ws.map((w) => {
  let args = w.args ?? null;
  if (w.op === 'contact.lastCallAttempt' && typeof args?.value === 'string' && isNow(args.value)) args = { ...args, value: '<now>' };
  if (w.op === 'note.create' && typeof args?.body === 'string' && parseOutcomeNote(args.body) !== null) {
    const lines = args.body.split('\n');
    const i = lines.findIndex((l) => l.startsWith('Outcome timestamp: '));   // the line parseOutcomeNote reads
    if (i > 0 && isNow(lines[i].slice('Outcome timestamp: '.length))) {
      lines[i] = 'Outcome timestamp: <now>';
      args = { ...args, body: lines.join('\n') };
    }
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
    resolve: { alias: [{ find: '../lib/airdroid-launch', replacement: MOCK }] },
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
  /** Board 14-13 autosave: leaving each draft saves it; wait until both show Saved, so later baselines are exact. */
  const fillDrafts = async (page) => {
    await page.getByTestId('negotiation-seller-position-input').fill(SELLER_POSITION_DRAFT);
    await page.getByTestId('negotiation-seller-position-input').press('Tab');
    await structureInput(page).fill(STRUCTURE_DRAFT);
    await structureInput(page).press('Tab');
    const saved = async (id) => (await page.getByTestId(id).getAttribute('data-state')) === 'saved';
    await until(page, async () => (await saved('negotiation-seller-position-save-status')) && (await saved('transaction-assumptions-save-status')), 'drafts autosaved');
  };
  /** Autosave ledger notes (Seller Position, Transaction assumptions, Seller price position), as opposed to deliberate writes. */
  const isAutosaveNote = (w) => w.op === 'note.create' && /^IAOS (?:SELLER POSITION|TRANSACTION ASSUMPTIONS|SELLER PRICE POSITION) — /.test(w.args?.body || '');
  const drafts = async (page) => ({ sellerPosition: await page.getByTestId('negotiation-seller-position-input').inputValue(), structure: await structureInput(page).inputValue() });
  const DRAFTS = { sellerPosition: SELLER_POSITION_DRAFT, structure: STRUCTURE_DRAFT };

  try {
    // ═══ NORMALISATION (no browser) ═════════════════════════════════════════
    {
      const now = new Date().toISOString();
      /** A complete ledger in the exact format Seller Call writes (see the debug capture in the README). */
      const LEDGER = (ts, fu) => ['IAOS SELLER CALL OUTCOME LEDGER — iaos-seller-call-outcome-v1', `Outcome timestamp: ${ts}`,
        'Operator: Not recorded (saved through IAOS write sign-in)', `Opportunity: ${A}-opp`, 'Outcome: follow_up', 'Seller Position: UNAVAILABLE',
        'Current Offer: UNAVAILABLE', 'Target Acquisition Price: UNAVAILABLE', 'Max Supported Offer: UNAVAILABLE', 'Expected Spread: UNAVAILABLE',
        'ARV: UNAVAILABLE', 'Repairs: UNAVAILABLE', 'Offer Readiness: NOT_READY', 'Reason: UNAVAILABLE', `Follow-up at: ${fu}`].join('\n');
      const ledgerIsRecognised = parseOutcomeNote(LEDGER(now, now)) !== null;
      const input = [
        { op: 'contact.lastCallAttempt', contact: A, args: { value: now } },
        { op: 'note.create', contact: A, args: { body: LEDGER(now, now) } },
        { op: 'contact.callback', contact: A, args: { value: now } },
        { op: 'note.create', contact: A, args: { body: `Called at ${now}` } },
        { op: 'contact.lastCallAttempt', contact: A, args: { value: '2026-01-02T03:04:05.000Z' } },
      ];
      const out = normalise(input);
      check('normalisation changes only the run-time value of contact.lastCallAttempt and the "Outcome timestamp:" field of a recognised ledger; the callback, the "Follow-up at:" line of the ledger, another note and an older lastCallAttempt stay exact',
        ledgerIsRecognised && same(out, [
          { op: 'contact.lastCallAttempt', contact: A, args: { value: '<now>' } },
          { op: 'note.create', contact: A, args: { body: LEDGER('<now>', now) } },
          { op: 'contact.callback', contact: A, args: { value: now } },
          { op: 'note.create', contact: A, args: { body: `Called at ${now}` } },
          { op: 'contact.lastCallAttempt', contact: A, args: { value: '2026-01-02T03:04:05.000Z' } },
        ]), { ledgerIsRecognised, out });

      // Control (Bones, db22c8c): notes that are NOT recognised ledgers keep "Outcome timestamp: <run-time ISO>" byte for byte.
      const unrelated = [
        `Outcome timestamp: ${now}`,                                                              // the line alone
        `Seller asked about timing.\nOutcome timestamp: ${now}\nWill call back.`,                 // inside an ordinary note
        `IAOS SELLER CALL OUTCOME LEDGER — iaos-seller-call-outcome-v1\nOutcome timestamp: ${now}`, // ledger header, but not a valid ledger
        LEDGER(now, now).replace('iaos-seller-call-outcome-v1', 'iaos-seller-call-outcome-v2'),    // a different ledger version
      ];
      const kept = normalise(unrelated.map((body) => ({ op: 'note.create', contact: A, args: { body } })));
      check('control: a note that is not a recognised outcome ledger keeps its "Outcome timestamp: <run-time ISO>" line byte for byte (4 cases)',
        unrelated.every((body) => parseOutcomeNote(body) === null) && kept.every((w, i) => w.args.body === unrelated[i] && Buffer.from(w.args.body).equals(Buffer.from(unrelated[i]))),
        { parsed: unrelated.map((b) => parseOutcomeNote(b) !== null), kept: kept.map((w) => w.args.body) });
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
      const base = writes().length;   // the drafts' own autosaves are not part of the Pass save
      await page.getByTestId('call-outcome-pass-toggle').click();
      await page.getByTestId('call-outcome-pass-reason').fill(PASS_REASON);
      await recordPass(page);
      control.pass = normalise(writes().slice(base));
      await context.close();
    }
    {
      const { context, page } = await workspace(A);
      await fillDrafts(page);
      const base = writes().length;
      await page.getByTestId('call-outcome-follow-up-toggle').click();
      await page.getByTestId('call-outcome-follow-up-at').fill(FOLLOW_UP_LOCAL);
      await recordFollowUp(page);
      control.followUp = normalise(writes().slice(base));
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
      await probe('with the Full Script open beside the workspace (not a modal), Call and the answers stay usable and the script stays open', async () => {
        await page.getByTestId('view-full-script').click();
        const panel = page.getByTestId('full-script-drawer');
        await panel.waitFor();
        const ariaModal = await panel.getAttribute('aria-modal');
        const box = async (id) => page.getByTestId(id).boundingBox();
        const overlaps = (a, b) => !!(a && b) && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
        await mockMode(page, 'handed-off');
        await page.getByTestId('call-with-airdroid').click({ timeout: 3000 });
        const calls = await mockCalls(page);
        const reason = page.getByTestId('call-outcome-pass-reason');
        await reason.click({ timeout: 3000 });
        await page.keyboard.press('End');
        await page.keyboard.type(' typed');
        const typed = await reason.inputValue();
        await page.keyboard.press('Escape');
        const openAfterFieldEscape = await panel.isVisible();
        await reason.fill(PASS_REASON);
        const geometry = { panel: await box('full-script-drawer'), call: await box('call-with-airdroid'), reason: await box('call-outcome-pass-reason') };
        const covered = overlaps(geometry.panel, geometry.call) || overlaps(geometry.panel, geometry.reason);
        await page.getByTestId('full-script-close').focus();
        await page.keyboard.press('Escape');
        await panel.waitFor({ state: 'hidden' });
        return { ok: ariaModal === null && same(calls, ['2145550101']) && typed === `${PASS_REASON} typed` && openAfterFieldEscape && !covered
          && (await reason.inputValue()) === PASS_REASON && same(await drafts(page), DRAFTS) && writes().length === writesBefore && popups.length === 0,
          detail: { ariaModal, calls, typed, openAfterFieldEscape, geometry, writes: normalise(writes().slice(writesBefore)) } };
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

    // ═══ FULL SCRIPT LAYOUT IN THE APP FRAME (Bones, 3226493) ══════════════
    // Seller Call inside a copy of the app's frame, where <main> is the element that scrolls. With the script open at
    // each width: sweep the whole scroll range and hit-test the controls; click Call once; edit answers; reach Call by
    // keyboard; toggle the panel. 1280 is the side-by-side layout; 1200 and below are stacked. Every control must be
    // clear (hit-tests as itself) somewhere in the range, and the panel must never cover one anywhere.
    const SWEEP = () => {
      const main = document.querySelector('[data-testid="harness-main"]');
      const panel = document.querySelector('[data-testid="full-script-drawer"]');
      const shellMain = document.querySelector('.seller-call-shell__main');
      const els = [['call-with-airdroid', document.querySelector('[data-testid="call-with-airdroid"]')],
        ['negotiation-seller-position-input', document.querySelector('[data-testid="negotiation-seller-position-input"]')],
        ['transaction-structure', document.querySelector('[placeholder="Transaction structure"]')],
        ['call-outcome-pass-reason', document.querySelector('[data-testid="call-outcome-pass-reason"]')],
        ['view-full-script', document.querySelector('[data-testid="view-full-script"]')]];
      const vis = main.getBoundingClientRect();
      const conflicts = []; const seen = new Set(); const clear = new Set(); let underOwnStickyBar = 0;
      for (let y = 0; y <= main.scrollHeight; y += 120) {
        main.scrollTop = y;
        const p = panel.getBoundingClientRect();
        for (const [id, el] of els) {
          if (!el) { conflicts.push({ id, missing: true }); continue; }
          const r = el.getBoundingClientRect();
          const cx = r.left + r.width / 2; const cy = r.top + r.height / 2;
          if (cy < vis.top || cy > vis.bottom || cx < vis.left || cx > vis.right) continue;
          seen.add(id);
          const hit = document.elementFromPoint(cx, cy);
          const overlap = r.left < p.right && p.left < r.right && r.top < p.bottom && p.top < r.bottom;
          // A failure is the script panel covering a control. A control passing under Seller Call's own sticky bar
          // while it scrolls is the page's existing behaviour; it is counted, not failed.
          if (overlap || (hit && panel.contains(hit))) conflicts.push({ id, y, hit: hit && (hit.getAttribute('data-testid') || hit.tagName), overlap });
          else if (hit && (hit === el || el.contains(hit))) clear.add(id);
          else if (hit && hit.closest('[data-testid="seller-call-sticky-bar"]')) underOwnStickyBar += 1;
          else conflicts.push({ id, y, hit: hit && (hit.getAttribute('data-testid') || hit.tagName), overlap });
        }
      }
      main.scrollTop = 0;
      const p = panel.getBoundingClientRect(); const m = shellMain.getBoundingClientRect();
      return { seen: [...seen].sort(), clear: [...clear].sort(), underOwnStickyBar, conflicts: conflicts.slice(0, 8), conflictCount: conflicts.length, position: getComputedStyle(panel).position,
        sideBySide: p.left >= m.right, stackedAbove: p.bottom <= m.top, scrollHeight: main.scrollHeight, clientHeight: main.clientHeight };
    };
    const ALL_CONTROLS = ['call-outcome-pass-reason', 'call-with-airdroid', 'negotiation-seller-position-input', 'transaction-structure', 'view-full-script'];
    const hitOk = (page, testid) => page.evaluate((id) => {
      const el = document.querySelector(`[data-testid="${id}"]`); const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && (hit === el || el.contains(hit));
    }, testid);
    for (const width of [1280, 1200, 1000, 768]) {
      resetDb(); bf.reset(); log = [];
      const { context, page, popups } = await open(WORKSPACE_PAGE, { width, ready: async (pg) => {
        await pg.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 });
        await pg.evaluate((to) => window.__iaosNavigate(to), `/framed/contacts/${A}/seller-call`);
        await pg.getByTestId('call-with-airdroid-mode').waitFor({ timeout: 60000 });
        await pg.getByTestId('call-outcome-pass-toggle').waitFor({ timeout: 60000 });
      } });
      await fillDrafts(page);
      await page.getByTestId('call-outcome-pass-toggle').click();
      await page.getByTestId('call-outcome-pass-reason').fill(PASS_REASON);
      const writesBefore = writes().length;
      await probe(`app frame at ${width}px with the Full Script open: ${width > 1200 ? 'beside' : 'above, not sticky'}; no control is covered anywhere in the scroll range; Call once, answers, keyboard and panel toggling all work; drafts survive; only the Seller Position edit is autosaved`, async () => {
        await page.getByTestId('view-full-script').click();
        const panel = page.getByTestId('full-script-drawer');
        await panel.waitFor();
        const sweep = await page.evaluate(SWEEP);
        const layoutOk = width > 1200 ? sweep.sideBySide : (sweep.stackedAbove && sweep.position === 'static');
        // Click Call once.
        await mockMode(page, 'handed-off');
        await page.getByTestId('call-with-airdroid').click({ timeout: 3000 });
        const clickCalls = await mockCalls(page);
        // Edit answers with the script open.
        const sp = page.getByTestId('negotiation-seller-position-input');
        await sp.click({ timeout: 3000 }); await page.keyboard.press('End'); await page.keyboard.type('1');
        const spTyped = await sp.inputValue();
        await sp.fill(SELLER_POSITION_DRAFT);
        const reason = page.getByTestId('call-outcome-pass-reason');
        await reason.click({ timeout: 3000 }); await page.keyboard.press('End'); await page.keyboard.type(' typed');
        const reasonTyped = await reason.inputValue();
        await page.keyboard.press('Escape');
        const openAfterFieldEscape = await panel.isVisible();
        await reason.fill(PASS_REASON);
        // Keyboard: from the Pass reason, Shift+Tab back to Call, then Enter.
        await mockMode(page, 'handed-off');
        await reason.focus();
        let tabs = 0; let onCall = false;
        while (tabs < 150 && !onCall) {
          await page.keyboard.press('Shift+Tab'); tabs += 1;
          onCall = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'call-with-airdroid');
        }
        const keyboardHit = onCall && await hitOk(page, 'call-with-airdroid');
        if (onCall) await page.keyboard.press('Enter');
        const keyboardCalls = await mockCalls(page);
        // Toggle: close, reopen, then close with Escape from inside the panel.
        await page.getByTestId('full-script-close').click();
        await panel.waitFor({ state: 'hidden' });
        await page.getByTestId('view-full-script').click();
        await panel.waitFor();
        await page.getByTestId('full-script-close').focus();
        await page.keyboard.press('Escape');
        await panel.waitFor({ state: 'hidden' });
        const after = { drafts: await drafts(page), reason: await reason.inputValue(), error: await errorText(page) };
        const ok = layoutOk && sweep.conflictCount === 0 && same(sweep.seen, ALL_CONTROLS) && same(sweep.clear, ALL_CONTROLS)
          && same(clickCalls, ['2145550101']) && spTyped === `${SELLER_POSITION_DRAFT}1` && reasonTyped === `${PASS_REASON} typed` && openAfterFieldEscape
          && onCall && keyboardHit && same(keyboardCalls, ['2145550101'])
          && same(after.drafts, DRAFTS) && after.reason === PASS_REASON && after.error === null
          && writes().slice(writesBefore).every((w) => isAutosaveNote(w) && /^IAOS SELLER POSITION — /.test(w.args.body)) && popups.length === 0;
        return { ok, detail: { sweep, layoutOk, clickCalls, spTyped, reasonTyped, openAfterFieldEscape, tabs, onCall, keyboardHit, keyboardCalls, after,
          writes: normalise(writes().slice(writesBefore)) } };
      });
      await context.close();
    }

    // ═══ LIVE TEST FINDINGS AT f32a17e: CALL ACCESS AND SELLER POSITION ═══════
    // F-SP-SAVE: at f32a17e Seller Position had no save of its own (B8-08 / INV-51). Board 14-13 autosave (Brad,
    // 2026-10-10): Enter (or leaving the field) saves it once in its own ledger, independent of any outcome; leaving
    // it unchanged writes nothing more; the outcome still records it; a fresh load restores it.
    {
      const { context, page, popups } = await workspace(A);
      const sp = page.getByTestId('negotiation-seller-position-input');
      await probe('Seller Position: a real number Entered is saved once in its own ledger and shows Saved; leaving it unchanged writes nothing more; recording Pass still writes it in the outcome record; a reload restores it', async () => {
        const logBefore = log.length;
        await sp.fill(SELLER_POSITION_DRAFT);
        await sp.press('Enter');
        await page.keyboard.press('Tab');
        await page.waitForTimeout(600);
        const sentWhileEditing = log.slice(logBefore).filter((r) => r.kind === 'write').map((r) => `${r.op}:${(r.args?.body || '').split('\n')[0]}:${((r.args?.body || '').match(/^Seller Position: .*$/m) || [''])[0]}`);
        const hint = (await page.getByTestId('negotiation-seller-position-save-status').count())
          ? await page.getByTestId('negotiation-seller-position-save-status').getAttribute('data-state') : null;
        await page.getByTestId('call-outcome-pass-toggle').click();
        await page.getByTestId('call-outcome-pass-reason').fill(PASS_REASON);
        await recordPass(page);
        const outcome = db[A].notes.find((n) => /Outcome: pass/.test(n.body));
        const recorded = outcome ? (outcome.body.match(/^Seller Position: .*$/m) || [null])[0] : null;
        // A fresh page load of the harness (a reload would load the app's own index page at the navigated path).
        await page.goto(`${base}${WORKSPACE_PAGE}`, { timeout: 60000 });
        await page.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 });
        await page.evaluate((to) => window.__iaosNavigate(to), `/contacts/${A}/seller-call`);
        await page.getByTestId('call-outcome-pass-toggle').waitFor({ timeout: 60000 });
        await until(page, async () => (await sp.inputValue()) !== '', 'Seller Position restored', 8000).catch(() => {});
        const restored = await sp.inputValue();
        const ok = same(sentWhileEditing, [`note.create:IAOS SELLER POSITION — iaos-seller-position-v1:Seller Position: ${SELLER_POSITION_DRAFT}`]) && hint === 'saved'
          && recorded === `Seller Position: ${SELLER_POSITION_DRAFT}` && restored === SELLER_POSITION_DRAFT && popups.length === 0;
        return { ok, detail: { sentWhileEditing, hint, recorded, restored } };
      });
      await context.close();
    }

    // F-CALLBTN: a compact Call in the sticky deal bar while the full button is out of view, at desktop and stacked widths,
    // with the Full Script open. Same seller and number, one launch per click, drafts kept, nothing covered, nothing written.
    for (const width of [1280, 1000, 768]) {
      resetDb(); bf.reset(); log = [];
      const { context, page, popups } = await open(WORKSPACE_PAGE, { width, ready: async (pg) => {
        await pg.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 });
        await pg.evaluate((to) => window.__iaosNavigate(to), `/framed/contacts/${A}/seller-call`);
        await pg.getByTestId('call-with-airdroid-mode').waitFor({ timeout: 60000 });
        await pg.getByTestId('call-outcome-pass-toggle').waitFor({ timeout: 60000 });
      } });
      await fillDrafts(page);
      await page.getByTestId('call-outcome-pass-toggle').click();
      await page.getByTestId('call-outcome-pass-reason').fill(PASS_REASON);
      await page.getByTestId('view-full-script').click();
      await page.getByTestId('full-script-drawer').waitFor();
      const writesBefore = writes().length;
      await probe(`app frame at ${width}px, Full Script open: the compact Call is hidden while the full Call button is in view, shown and clear once it scrolls away, launches the same number once per click (mouse and keyboard), shows a launch error compactly, covers no field or the script; drafts kept; nothing written`, async () => {
        const compact = page.getByTestId('call-with-airdroid-compact');
        const shown = () => page.evaluate(() => {
          const w = document.querySelector('[data-testid="call-with-airdroid-compact-wrap"]');
          return !!w && getComputedStyle(w).visibility === 'visible';
        });
        await page.evaluate(() => { document.querySelector('[data-testid="harness-main"]').scrollTop = 0; });
        await page.waitForTimeout(250);
        const hiddenAtTop = (await compact.count()) === 1 && !(await shown());
        // Scroll the Pass reason into view: the full Call button is then out of view.
        await page.getByTestId('call-outcome-pass-reason').scrollIntoViewIfNeeded();
        await page.waitForTimeout(250);
        const mainOut = await page.evaluate(() => {
          const r = document.querySelector('[data-testid="call-with-airdroid"]').getBoundingClientRect();
          const m = document.querySelector('[data-testid="harness-main"]').getBoundingClientRect();
          return r.bottom <= m.top || r.top >= m.bottom;
        });
        const shownAway = await shown();
        const compactClear = await hitOk(page, 'call-with-airdroid-compact');
        const label = await compact.getAttribute('aria-label');
        await mockMode(page, 'handed-off');
        await compact.click({ timeout: 3000 });
        const clickCalls = await mockCalls(page);
        await mockMode(page, 'handed-off');
        await compact.focus(); await page.keyboard.press('Enter');
        const keyCalls = await mockCalls(page);
        await mockMode(page, 'error');
        await compact.click({ timeout: 3000 });
        const compactError = (await page.getByTestId('airdroid-compact-error').count()) ? (await page.getByTestId('airdroid-compact-error').innerText()).trim() : null;
        const mainError = await errorText(page);
        // Sweep the whole scroll range: no control's centre may land on the compact button, and the compact
        // button never overlaps the Full Script panel.
        const sweep = await page.evaluate(() => {
          const main = document.querySelector('[data-testid="harness-main"]');
          const panel = document.querySelector('[data-testid="full-script-drawer"]');
          const wrap = document.querySelector('[data-testid="call-with-airdroid-compact-wrap"]');
          const els = [...document.querySelectorAll('[data-testid="negotiation-panel"] input, [data-testid="call-outcome-panel"] input, [data-testid="call-outcome-panel"] textarea, [placeholder="Transaction structure"], [data-testid="call-with-airdroid"]')];
          const vis = main.getBoundingClientRect(); const conflicts = [];
          for (let y = 0; y <= main.scrollHeight; y += 120) {
            main.scrollTop = y;
            const w = wrap.getBoundingClientRect(); const p = panel.getBoundingClientRect();
            const wShown = getComputedStyle(wrap).visibility === 'visible';
            if (wShown && w.left < p.right && p.left < w.right && w.top < p.bottom && p.top < w.bottom) conflicts.push({ y, panelOverlap: true });
            for (const el of els) {
              const r = el.getBoundingClientRect(); const cx = r.left + r.width / 2; const cy = r.top + r.height / 2;
              if (cy < vis.top || cy > vis.bottom) continue;
              const hit = document.elementFromPoint(cx, cy);
              if (hit && wrap.contains(hit)) conflicts.push({ y, id: el.getAttribute('data-testid') || el.getAttribute('placeholder') });
            }
          }
          main.scrollTop = 0;
          return { conflicts: conflicts.slice(0, 8), count: conflicts.length, controls: els.length };
        });
        const after = { drafts: await drafts(page), reason: await page.getByTestId('call-outcome-pass-reason').inputValue(), scriptOpen: await page.getByTestId('full-script-drawer').isVisible() };
        const ok = hiddenAtTop && mainOut && shownAway && compactClear && /^Call Alpha .+ with AirDroid$/.test(label || '')
          && same(clickCalls, ['2145550101']) && same(keyCalls, ['2145550101'])
          && compactError === 'Not started. Use GHL Phone or Cell.' && mainError !== null
          && sweep.count === 0 && sweep.controls >= 3
          && same(after.drafts, DRAFTS) && after.reason === PASS_REASON && after.scriptOpen && writes().length === writesBefore && popups.length === 0;
        return { ok, detail: { hiddenAtTop, mainOut, shownAway, compactClear, label, clickCalls, keyCalls, compactError, mainError, sweep, after } };
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
