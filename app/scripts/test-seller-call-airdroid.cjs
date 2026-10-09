/**
 * B14-13 — "Call with AirDroid" in Seller Call, rendered, with MOCKED launches.
 *
 * Vite serves two pages from scripts/harness/seller-call-airdroid in headless
 * Chromium, and aliases the component's launch interface
 * (src/lib/airdroid-launch-stand-in.ts) to airdroid-launch-mock.ts, so every
 * launch is mocked -- handed off (which is also how a launch the operator
 * cancels outside the page looks), a known error, or a throw. Nothing opens a
 * link, window or request; no helper, AirDroid, phone or GHL record is
 * involved. Every /.netlify/functions request is answered from an in-memory
 * fixture and anything else is aborted and counted.
 *
 *   COMPONENT (index.html, the real SellerCallVoiceControls): AirDroid is the
 *   first, primary option on its own row with GHL Phone and Cell after it; the
 *   button hands the seller's 10 US digits to the launch interface and shows
 *   nothing on hand-off, the known error on failure and a fixed error on a
 *   throw; an invalid number disables it with the reason; a new number clears
 *   an error; it never claims a call.
 *
 *   WORKSPACE (workspace.html, the real SellerCallWorkspace): with a launch
 *   cancelled, failed or thrown, the selected seller, unsaved Pass reason and
 *   Follow-Up time, the open outcome form and the full script all survive, the
 *   launch writes nothing, and the existing Pass and Follow-Up saves then
 *   record as before; moving to another seller targets that seller.
 *
 * NEGATIVE CONTROL: `node scripts/test-seller-call-airdroid.cjs --before=<rev>`
 * renders <rev>'s component and must FAIL (exit 1) for a revision without the
 * AirDroid option -- e.g. --before=45361c1. (The workspace page always uses
 * the current component.)
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
 * Taken from the finished file, never back-filled from a passing run: 20 single probe()/check()
 * call sites + 1 inside the invalid-number loop x 3 numbers = 23.
 */
const FLOOR = 23;
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

// ── In-memory GHL fixture for the workspace (from test-contact-isolation.cjs) ─
const A = 'fixtureContactA';
const B = 'fixtureContactB';
const PHONES = { [A]: '+12145550101', [B]: '+14695550123' };
let db;
function resetDb() {
  const contact = (id, first) => ({ id, first, dnd: {}, fields: new Map(), notes: [{ id: `${id}-n1`, body: `Seed note for ${first}`, dateAdded: '2026-09-30T12:00:00.000Z' }] });
  db = { [A]: contact(A, 'Alpha'), [B]: contact(B, 'Bravo') };
}
const field = (c, id) => (c.fields.has(id) ? c.fields.get(id) : null);
const contactRow = (c) => ({
  id: c.id, firstName: c.first, lastName: 'Fixture', phone: PHONES[c.id], email: '', address1: '', city: '', state: '', postalCode: '',
  dateAdded: '2026-09-01T00:00:00.000Z', tags: [], dndSettings: c.dnd, motivationScore: null, dealScore: null, combinedScore: null, completenessScore: null,
  callbackDatetime: field(c, F.callbackDatetimePrecise), callbackDatetimePrecise: field(c, F.callbackDatetimePrecise),
  lastCallAttempt: field(c, F.lastCallAttemptPrecise), lastCallAttemptPrecise: field(c, F.lastCallAttemptPrecise),
  callDisposition: field(c, F.callDisposition), dispositionAt: field(c, F.dispositionAt),
});
const detail = (c) => ({ contact: { id: c.id, firstName: c.first, lastName: 'Fixture', phone: PHONES[c.id], dndSettings: c.dnd,
  customFields: [...c.fields].map(([id, value]) => ({ id, value })) } });
const pipeline = () => ({ pipelineId: 'fixture-pipeline', stages: [],
  opportunities: [A, B].map((id) => ({ id: `${id}-opp`, contactId: id, contactName: db[id].first, opportunityName: `${db[id].first} deal`,
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
const bf = createBarrierFixture({ contactOf: (o) => (o === `${A}-opp` ? A : o === `${B}-opp` ? B : null) });
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
const watchdog = setTimeout(() => { console.error('FAIL  the suite did not finish within 8 minutes -- stopped'); process.exit(1); }, 8 * 60_000);

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
      const reply = (res) => route.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(res.body) });
      if (req.kind === 'call-log-barrier') return reply(await bf.handleCallLog(route.request().method(), u, post));
      if (req.kind === 'current-offer-barrier') return reply(await bf.handle(route.request().method(), u, post));
      if (req.kind === 'write' && !(req.op && db[req.contact])) return reply({ status: 400, body: { error: 'fixture: malformed or unknown write' } });
      if (req.kind === 'write') {
        return reply(await bf.write({ operation: req.op, targetId: req.contact, requestId: req.requestId, contactId: req.contact, args: req.args },
          () => { const a = applyWrite(req.op, req.contact, req.args); return { confirmed: a.status === 200 }; },
          { outcome: req.op === 'note.create' ? parseOutcomeNote(req.args.body) : null, refuse: null }));
      }
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
  /** What a save sent, without per-request ids or times: operation, target, and the note body or value kind. */
  const shape = (ws) => ws.map((w) => `${w.op} ${w.contact} ${w.op === 'note.create' ? w.args.body.replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, '<time>') : typeof w.args?.value}`);
  const savedShapes = {};
  /** The same outcome save on a fresh page with no launch at all. */
  const saveWithoutLaunch = async (kind) => {
    const { context, page } = await workspace(A);
    const from = writes().length;
    if (kind === 'pass') {
      await page.getByTestId('call-outcome-pass-toggle').click();
      await page.getByTestId('call-outcome-pass-reason').fill('Seller wants retail, not a cash offer.');
      await until(page, () => page.getByTestId('call-outcome-pass-confirm').isEnabled(), 'Pass confirm enabled');
      await page.getByTestId('call-outcome-pass-confirm').click();
      await until(page, async () => db[A].notes.some((n) => n.body.includes('Seller wants retail, not a cash offer.')), 'Pass note saved');
    } else {
      await page.getByTestId('call-outcome-follow-up-toggle').click();
      await page.getByTestId('call-outcome-follow-up-at').fill('2026-12-01T10:00');
      await page.getByTestId('call-outcome-follow-up-confirm').click();
      await until(page, async () => field(db[A], F.callbackDatetimePrecise) !== null, 'callback saved');
    }
    await page.waitForTimeout(300);
    const out = shape(writes().slice(from));
    await context.close();
    return out;
  };

  try {
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
      await probe('handed off (or cancelled outside the page): the seller\'s 10 digits go to the launch interface, and the card shows no message and no call claim', async () => {
        await mockMode(page, 'handed-off');
        const url = page.url();
        await page.getByTestId('call-with-airdroid').click();
        await page.waitForTimeout(200);
        const text = await card(page);
        return { ok: same(await mockCalls(page), ['2145550101']) && (await errorText(page)) === null && text === 'Call with AirDroid\nKay Fixture · 214-555-0101\nCall with AirDroid'
          && !CLAIMS.test(text) && page.url() === url && popups.length === 0, detail: { calls: await mockCalls(page), text, popups } };
      });
      await probe('a known launch error is shown as an alert with the way on, and claims nothing', async () => {
        await mockMode(page, 'error');
        await page.getByTestId('call-with-airdroid').click();
        const role = await page.getByTestId('airdroid-launch-error').getAttribute('role');
        return { ok: (await errorText(page)) === MOCK_ERROR && role === 'alert' && !CLAIMS.test(await card(page)), detail: { error: await errorText(page), role } };
      });
      await probe('a launch interface that throws shows a fixed error, and the next hand-off clears it', async () => {
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
    const loadedFor = async (page, first) => (await page.locator('body').innerText()).includes(`${first} deal`);

    {
      const { context, page, popups } = await workspace(A);
      await probe('workspace: the real Seller Call page leads its calling options with AirDroid for the selected seller', async () => {
        const l = await page.evaluate(LAYOUT);
        return { ok: l.cards[0] === 'call-with-airdroid-mode' && (await card(page)).includes('Alpha Fixture · 214-555-0101') && await loadedFor(page, 'Alpha'), detail: { l, card: await card(page) } };
      });
      // A failed launch while a Pass is being written.
      await page.getByTestId('call-outcome-pass-toggle').click();
      await page.getByTestId('call-outcome-pass-reason').fill('Seller wants retail, not a cash offer.');
      const writesBefore = writes().length;
      await mockMode(page, 'error');
      await page.getByTestId('call-with-airdroid').click().catch(() => {});
      await probe('failed launch: the error shows, and the seller, route, open Pass form and unsaved reason all stay; the launch wrote nothing', async () => {
        const reason = await page.getByTestId('call-outcome-pass-reason').inputValue();
        return { ok: (await errorText(page)) === MOCK_ERROR && same(await mockCalls(page), ['2145550101'])
          && (await page.evaluate(() => location.pathname)) === `/contacts/${A}/seller-call` && (await card(page)).includes('Alpha Fixture')
          && reason === 'Seller wants retail, not a cash offer.' && writes().length === writesBefore && popups.length === 0,
          detail: { reason, error: await errorText(page), writes: writes().slice(writesBefore) } };
      });
      await probe('after a failed launch the full script still opens and closes, and the unsaved reason is still there', async () => {
        await page.getByTestId('view-full-script').click();
        await page.getByTestId('full-script-drawer').waitFor();
        const scriptText = (await page.getByTestId('full-script-drawer').innerText()).length;
        await page.getByTestId('full-script-close').click();
        await page.getByTestId('full-script-drawer').waitFor({ state: 'hidden' });
        return { ok: scriptText > 200 && (await page.getByTestId('call-outcome-pass-reason').inputValue()) === 'Seller wants retail, not a cash offer.', detail: { scriptText } };
      });
      await probe('after a failed launch the existing Pass save records the reason, for this seller only', async () => {
        await until(page, () => page.getByTestId('call-outcome-pass-confirm').isEnabled(), 'Pass confirm enabled');
        await page.getByTestId('call-outcome-pass-confirm').click();
        await until(page, async () => db[A].notes.some((n) => n.body.includes('Seller wants retail, not a cash offer.')), 'Pass note saved');
        await page.waitForTimeout(300);
        savedShapes.pass = shape(writes().slice(writesBefore));
        return { ok: (await page.getByTestId('call-outcome-error').count()) === 0 && writes().length > writesBefore && writes().every((w) => w.contact === A) && db[B].notes.length === 1,
          detail: { writes: writes().map((w) => `${w.op} ${w.contact}`), error: await page.getByTestId('call-outcome-error').innerText().catch(() => null) } };
      });
      await probe('seller selection: moving to another seller clears the launch error and targets only that seller\'s number', async () => {
        await mockMode(page, 'handed-off');
        await page.evaluate((to) => window.__iaosNavigate(to), `/contacts/${B}/seller-call`);
        await until(page, async () => (await card(page)).includes('Bravo Fixture · 469-555-0123'), 'Bravo card');
        const cleared = await errorText(page);
        await page.getByTestId('call-with-airdroid').click();
        return { ok: cleared === null && same(await mockCalls(page), ['4695550123']) && (await errorText(page)) === null, detail: { cleared, calls: await mockCalls(page) } };
      });
      await context.close();
    }
    {
      // A launch handed off and then cancelled outside the page, while a Follow-Up is being chosen.
      const { context, page } = await workspace(A);
      await page.getByTestId('call-outcome-follow-up-toggle').click();
      await page.getByTestId('call-outcome-follow-up-at').fill('2026-12-01T10:00');
      const writesBefore = writes().length;
      await mockMode(page, 'handed-off');
      await page.getByTestId('call-with-airdroid').click().catch(() => {});
      await page.waitForTimeout(200);
      await probe('cancelled launch: no message or claim; the Follow-Up form and its unsaved time stay; the launch wrote nothing', async () => {
        const at = await page.getByTestId('call-outcome-follow-up-at').inputValue();
        return { ok: (await errorText(page)) === null && !CLAIMS.test(await card(page)) && at === '2026-12-01T10:00' && writes().length === writesBefore
          && same(await mockCalls(page), ['2145550101']), detail: { at, writes: writes().slice(writesBefore) } };
      });
      await probe('after a cancelled launch the existing Follow-Up save schedules the callback, for this seller only', async () => {
        await page.getByTestId('call-outcome-follow-up-confirm').click();
        await until(page, async () => field(db[A], F.callbackDatetimePrecise) !== null, 'callback saved');
        await page.waitForTimeout(300);
        savedShapes.followUp = shape(writes().slice(writesBefore));
        return { ok: (await page.getByTestId('call-outcome-error').count()) === 0 && writes().every((w) => w.contact === A) && field(db[B], F.callbackDatetimePrecise) === null,
          detail: { callback: field(db[A], F.callbackDatetimePrecise), writes: writes().map((w) => `${w.op} ${w.contact}`) } };
      });
      await context.close();
    }
    {
      // A launch interface that throws, after the script was opened and with a Pass reason typed.
      const { context, page } = await workspace(A);
      await page.getByTestId('view-full-script').click();
      await page.getByTestId('full-script-drawer').waitFor();
      await page.getByTestId('full-script-close').click();
      await page.getByTestId('call-outcome-pass-toggle').click();
      await page.getByTestId('call-outcome-pass-reason').fill('Needs to talk to spouse.');
      const writesBefore = writes().length;
      await mockMode(page, 'throw');
      await page.getByTestId('call-with-airdroid').click().catch(() => {});
      await probe('thrown launch: the fixed error shows; the page, seller, Pass form, reason and script all survive; nothing was written', async () => {
        await page.getByTestId('view-full-script').click();
        await page.getByTestId('full-script-drawer').waitFor();
        await page.getByTestId('full-script-close').click();
        return { ok: (await errorText(page)) === THROW_ERROR && (await page.getByTestId('call-outcome-pass-reason').inputValue()) === 'Needs to talk to spouse.'
          && (await card(page)).includes('Alpha Fixture') && writes().length === writesBefore && await loadedFor(page, 'Alpha'), detail: { error: await errorText(page) } };
      });
      await context.close();
    }

    await probe('the Pass and Follow-Up saves after a failed or cancelled launch send exactly what the same saves send with no launch', async () => {
      const control = { pass: await saveWithoutLaunch('pass'), followUp: await saveWithoutLaunch('follow-up') };
      return { ok: savedShapes.pass?.length > 0 && savedShapes.followUp?.length > 0 && same(savedShapes, control), detail: { afterLaunch: savedShapes, noLaunch: control } };
    });

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
