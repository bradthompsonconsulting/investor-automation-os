/**
 * PR #126 (Bones / Jess, 2026-10-05) -- Confirm Accept protects the frozen
 * accepted price for the WHOLE existing sequence (offer write + readback,
 * acceptance note, last-touch), driven as an operator would with Confirm
 * Accept genuinely ENABLED.
 *
 * Offline. Vite serves scripts/harness/contact-isolation (the REAL
 * SellerCallWorkspace with the real GHL client) in headless Chromium. Every
 * /.netlify/functions request is answered from
 * scripts/harness/seller-call-offer-ready-fixture.cjs: one deal that is
 * objectively Offer Ready (all six readiness categories met on evidence built
 * with the app's own note formatters; no approval/override note), which
 * mirrors the server's own guards (a Current Offer write after an accept note
 * is refused; an accept note must match the stored offer). Any request can be
 * held, refused, or have its response lost.
 *
 *   A1. Bones's Accept reproduction: a blur save is in flight and another is
 *       queued when Confirm Accept is clicked; while the accept's offer write
 *       and then its note are held the operator tries to change the Current
 *       Offer. The input is locked, nothing is queued, the never-sent queued
 *       blur is dropped, nothing is replayed afterward, and GHL ends holding
 *       the accepted price with exactly one accept note that matches it.
 *   A2. The accept's offer write is refused: nothing is recorded, the error
 *       is shown, the deal is usable again.
 *   A3. The accept's offer write gets no response (indeterminate): the note
 *       and last-touch are never sent; the deal is Unresolved and locked.
 *   A4. The acceptance note's outcome is unknown: the deal stays Unresolved
 *       and locked; no later Current Offer write is sent.
 *   A5. Navigation mid-sequence: leaving and coming back while the accept is
 *       held keeps the deal locked; the sequence completes once; a reload
 *       shows Agreement Reached at the accepted price.
 *   A6. A last-touch failure after the acceptance is recorded: Agreement
 *       Reached shows, the timestamp-only recovery is offered, the price
 *       holds (existing partial-failure handling, unchanged).
 */
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const APP = path.resolve(__dirname, '..');
Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);
const fx = require('./harness/seller-call-offer-ready-fixture.cjs');
const { parseOutcomeNote } = require(path.join(APP, 'src/lib/seller-call-outcome.ts'));

let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}

let log = [];
let holds = [];
function hold(match) {
  let release; let onHit;
  const h = { match, released: new Promise((r) => { release = r; }), hit: new Promise((r) => { onHit = r; }) };
  h.release = release; h.onHit = onHit; holds.push(h); return h;
}

async function main() {
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const { chromium } = require('playwright');
  const server = await createServer({
    root: APP, configFile: false, plugins: [react()], logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: ['scripts/harness/contact-isolation/index.html'],
      include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] },
  });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const foreign = [];
  const exit = async (code) => { await browser.close().catch(() => {}); await server.close().catch(() => {}); process.exit(code); };
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Chicago' });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { foreign.push(url); return route.abort(); }
      let post = null;
      try { post = route.request().postDataJSON(); } catch { post = null; }
      const req = fx.classify(url, route.request().method(), post);
      log.push(req);
      const h = holds.find((x) => !x.used && x.match(req));
      if (h) { h.used = true; h.onHit(req); await h.released; }
      if (h && h.lose) return route.abort('failed');                       // the browser never gets a response
      if (h && h.reply) return route.fulfill({ status: h.reply.status, contentType: 'application/json', body: JSON.stringify(h.reply.body) });
      const res = fx.answer(req);
      return route.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(res.body) });
    });
    await page.context().route(/gohighlevel\.com/, (route) => route.abort());
    const go = (to) => page.evaluate((t) => window.__iaosNavigate(t), to);
    const until = async (fn, label, ms = 15000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(50); }
      throw new Error(`timed out waiting for ${label}`);
    };
    const input = () => page.getByTestId('negotiation-current-offer-input');
    const toggle = () => page.getByTestId('call-outcome-accept-toggle');
    const confirm = () => page.getByTestId('call-outcome-accept-confirm');
    const recorded = () => page.getByTestId('call-outcome-accept-recorded');
    const outcomeError = async () => { const el = page.getByTestId('call-outcome-error'); return (await el.count()) ? (await el.innerText()).trim() : null; };
    const note = async () => { const el = page.getByTestId('deal-bar-note-current_offer'); return (await el.count()) ? (await el.innerText()).trim() : null; };
    const unresolvedShown = async () => (await page.getByTestId('current-offer-unresolved').count()) > 0;
    const offerWrites = () => log.filter((r) => r.kind === 'write' && r.op === 'opportunity.currentOffer').map((r) => r.args.value);
    const noteWrites = () => log.filter((r) => r.kind === 'write' && r.op === 'note.create');
    const touchWrites = () => log.filter((r) => r.kind === 'write' && r.op === 'contact.lastCallAttempt');
    const acceptNotes = () => fx.state.notes.filter((n) => (parseOutcomeNote(n.body) || {}).kind === 'accept');
    const open = async () => {
      await go('/'); await page.waitForTimeout(300);
      await go(`/contacts/${fx.CONTACT}/seller-call`);
      await input().waitFor({ timeout: 30000 });
      await page.getByTestId('offer-readiness-checklist').waitFor({ state: 'attached', timeout: 30000 });
    };
    /* A full page load per case: the save coordinator is shared app-wide. */
    const fresh = async (opts) => {
      fx.reset(opts); log = []; holds = [];
      await page.goto(`${base}/scripts/harness/contact-isolation/index.html`);
      await page.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 });
      await open();
    };
    const openAcceptForm = async () => {
      if (!(await confirm().count())) await toggle().click();
      await confirm().waitFor({ timeout: 5000 });
    };
    /* Try to change the Current Offer the way an operator would; a locked
       (read-only) input refuses the keystrokes. Returns what the input shows. */
    const tryEdit = async (value) => {
      await input().click().catch(() => {});
      await page.keyboard.press('Control+A').catch(() => {});
      await page.keyboard.type(String(value)).catch(() => {});
      await input().evaluate((el) => el.blur());
      return input().inputValue();
    };

    // A1 — Bones's Accept reproduction.
    await fresh({});
    await input().fill('410000');
    const hBlur = hold((r) => r.kind === 'write' && r.op === 'opportunity.currentOffer' && r.args.value === 410000);
    await input().press('Tab');
    await hBlur.hit;                                         // blur save of 410000 in flight
    await input().fill('400000'); await input().press('Tab'); // blur save of 400000 queued (never sent)
    check('A1 setup: 410000 in flight, 400000 queued and not sent', offerWrites().join() === '410000', offerWrites());
    await openAcceptForm();
    check('A1 setup: Confirm Accept is ENABLED (deal is Offer Ready, Current Offer 400000)', await confirm().isEnabled());
    const hAccept = hold((r) => r.kind === 'write' && r.op === 'opportunity.currentOffer' && r.args.value === 400000);
    const hNote = hold((r) => r.kind === 'write' && r.op === 'note.create');
    await confirm().click();
    await page.waitForTimeout(300);
    check('A1 the Current Offer input is locked as soon as Accept starts', (await input().isEditable()) === false);
    check('A1 an attempted edit during the offer write is refused', (await tryEdit(455000)) === '400000', await input().inputValue());
    hBlur.release();                                         // the in-flight blur save finishes
    await hAccept.hit;                                       // then the accept's own offer write is sent (and held)
    check('A1 the accept\'s offer write waited for the save in flight, and the queued blur was dropped', offerWrites().join() === '410000,400000', offerWrites());
    hAccept.release();
    await hNote.hit;                                         // offer saved + read back; the acceptance note is held
    check('A1 while the acceptance note is held the input is still locked', (await input().isEditable()) === false);
    check('A1 an attempted edit during the note write is refused, nothing sent', (await tryEdit(466000)) === '400000' && offerWrites().join() === '410000,400000', offerWrites());
    hNote.release();
    await until(async () => (await recorded().count()) > 0, 'accept recorded').catch(() => {});
    await page.waitForTimeout(800);
    check('A1 the sequence completes: Agreement Reached, one note, one last-touch', (await recorded().count()) > 0 && noteWrites().length === 1 && touchWrites().length === 1);
    check('A1 nothing is replayed afterward: the offer writes are exactly 410000 then the accepted 400000', offerWrites().join() === '410000,400000', offerWrites());
    check('A1 GHL holds the accepted price, and the one accept note matches it', fx.state.currentOffer === 400000 && acceptNotes().length === 1 && parseOutcomeNote(acceptNotes()[0].body).snapshot.currentOffer === 400000, { offer: fx.state.currentOffer, notes: acceptNotes().length });

    // A2 — the accept's offer write is refused.
    await fresh({ currentOffer: 400000 });
    await openAcceptForm();
    let h = hold((r) => r.kind === 'write' && r.op === 'opportunity.currentOffer'); h.reply = { status: 403, body: { error: 'fixture: refused' } };
    h.release();
    await confirm().click();
    await until(async () => (await outcomeError()) !== null, 'error').catch(() => {});
    check('A2 a refused offer write is reported, and no note or last-touch is sent', /could not be saved/.test((await outcomeError()) || '') && noteWrites().length === 0 && touchWrites().length === 0, await outcomeError());
    check('A2 the deal is usable again: not Unresolved, input editable', !(await unresolvedShown()) && (await input().isEditable()), await note());
    check('A2 GHL is unchanged and no acceptance exists', fx.state.currentOffer === 400000 && acceptNotes().length === 0);

    // A3 — the accept's offer write gets no response (indeterminate).
    await fresh({ currentOffer: 400000 });
    await openAcceptForm();
    h = hold((r) => r.kind === 'write' && r.op === 'opportunity.currentOffer'); h.lose = true; h.release();
    await confirm().click();
    await until(async () => unresolvedShown(), 'unresolved').catch(() => {});
    await page.waitForTimeout(500);
    check('A3 no response: the deal is Unresolved and locked', (await unresolvedShown()) && (await input().isEditable()) === false, await note());
    check('A3 the note and last-touch are never sent; nothing is claimed recorded', noteWrites().length === 0 && touchWrites().length === 0 && (await recorded().count()) === 0 && !/Recorded in GHL/.test((await note()) || ''));
    check('A3 the error says the save is unresolved, not "you may retry"', /Unresolved/.test((await outcomeError()) || ''), await outcomeError());
    const before = offerWrites().length;
    if (await confirm().count()) { await confirm().click().catch(() => {}); await page.waitForTimeout(500); }
    check('A3 a second Confirm Accept sends nothing', offerWrites().length === before && noteWrites().length === 0);

    // A4 — the acceptance note's outcome is unknown.
    await fresh({ currentOffer: 400000 });
    await openAcceptForm();
    h = hold((r) => r.kind === 'write' && r.op === 'note.create'); h.reply = { status: 409, body: { error: 'Write refused or unconfirmed; refresh and inspect before retrying' } }; h.release();
    await confirm().click();
    await until(async () => (await outcomeError()) !== null, 'note error').catch(() => {});
    await page.waitForTimeout(500);
    check('A4 an unknown acceptance is reported as such (existing message), and no last-touch is sent', /may or may not have been recorded/.test((await outcomeError()) || '') && touchWrites().length === 0, await outcomeError());
    check('A4 the deal stays Unresolved and locked', (await unresolvedShown()) && (await input().isEditable()) === false, await note());
    const writesBefore = offerWrites().length;
    await tryEdit(410000);
    await page.waitForTimeout(500);
    check('A4 no later Current Offer write is sent, and GHL keeps the accepted price', offerWrites().length === writesBefore && fx.state.currentOffer === 400000, offerWrites());

    // A5 — navigation mid-sequence.
    await fresh({ currentOffer: 400000 });
    await openAcceptForm();
    const hNav = hold((r) => r.kind === 'write' && r.op === 'note.create');
    await confirm().click();
    await hNav.hit;                                          // offer written; note held
    await go('/'); await page.waitForTimeout(300);
    await go(`/contacts/${fx.CONTACT}/seller-call`);
    await input().waitFor({ timeout: 30000 });
    await page.waitForTimeout(500);
    check('A5 back on the deal mid-sequence: the input is still locked', (await input().isEditable()) === false);
    const navWrites = offerWrites().length;
    await tryEdit(420000);
    await page.waitForTimeout(300);
    check('A5 an edit attempt sends nothing', offerWrites().length === navWrites);
    hNav.release();
    await until(async () => touchWrites().length === 1, 'last-touch sent').catch(() => {});
    await page.waitForTimeout(500);
    check('A5 the sequence completes exactly once', noteWrites().length === 1 && touchWrites().length === 1 && acceptNotes().length === 1);
    await page.goto(`${base}/scripts/harness/contact-isolation/index.html`);
    await page.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 });
    await open();
    await until(async () => (await recorded().count()) > 0, 'recorded after reload').catch(() => {});
    check('A5 after a reload: Agreement Reached at the accepted price, GHL unchanged', (await recorded().count()) > 0 && fx.state.currentOffer === 400000 && (await input().inputValue()) === '400000');

    // A6 — last-touch failure after the acceptance is recorded (existing partial-failure handling).
    await fresh({ currentOffer: 400000 });
    await openAcceptForm();
    h = hold((r) => r.kind === 'write' && r.op === 'contact.lastCallAttempt'); h.reply = { status: 502, body: { error: 'bad gateway' } }; h.release();
    await confirm().click();
    await until(async () => (await recorded().count()) > 0, 'recorded').catch(() => {});
    await page.waitForTimeout(500);
    check('A6 Agreement Reached shows, with the timestamp-only recovery offered', (await recorded().count()) > 0 && (await page.getByTestId('call-timestamp-recover').count()) > 0, await outcomeError());
    check('A6 the accepted price holds in GHL and the input is not left locked by the offer save', fx.state.currentOffer === 400000 && !(await unresolvedShown()));

    check('no request left the machine', foreign.length === 0, foreign);
    check('no page errors', pageErrors.length === 0, pageErrors);
  } catch (e) {
    console.error(e);
    failures += 1;
  }
  console.log(`\nSeller Call Accept protection: ${checks - failures}/${checks} checks passed`);
  await exit(failures ? 1 : 0);
}
main();
