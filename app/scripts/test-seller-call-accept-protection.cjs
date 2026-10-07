/**
 * PR #126 (Bones / Jess, 2026-10-05) and its stacked server PR -- Confirm
 * Accept protects the frozen accepted price for the WHOLE existing sequence
 * (offer write + readback, acceptance note, last-touch), driven as an
 * operator would with Confirm Accept genuinely ENABLED, against the durable
 * Current Offer barrier.
 *
 * Offline. Vite serves scripts/harness/contact-isolation (the REAL
 * SellerCallWorkspace with the real GHL client) in headless Chromium. Every
 * /.netlify/functions request is answered in Node:
 *   - GHL data from scripts/harness/seller-call-offer-ready-fixture.cjs: one
 *     deal that is objectively Offer Ready (all six readiness categories met
 *     on evidence built with the app's own note formatters), mirroring the
 *     server's guards -- decided BEFORE any GHL call (precheckWrite);
 *   - the durable barrier by the REAL server module
 *     (scripts/harness/current-offer-barrier-fixture.cjs): begin / reconcile /
 *     status, the send claimed at the write boundary, outcomes recorded. Its
 *     state is shared by a second browser and survives a reload.
 * Any request can be held, refused before sending, lost before it reaches
 * the server (`lose: 'late'`), or lost after the GHL call (`failAfterSend`).
 *
 *   A1. Bones's Accept reproduction: a blur save in flight and another queued
 *       when Confirm Accept is clicked; edits attempted while the offer and
 *       then the note are held are refused; Accept waits for the in-flight
 *       save, reserves its three steps, writes exactly the accepted price; one
 *       note, one last-touch; nothing replayed; the barrier is released.
 *   A2. The offer write is refused before sending: reported; nothing recorded;
 *       the server proves the rest unsent and the deal is usable.
 *   A3. The offer write is lost: (a) before reaching the server -- Check again
 *       proves it was never sent, the deal clears, a late arrival sends
 *       nothing; (b) after the GHL call -- Unresolved, naming the offer save;
 *       the note and last-touch are never sent.
 *   A4. The acceptance note: (a) refused before sending -- the deal clears;
 *       (b) lost after the GHL call -- Unresolved, naming the note; no
 *       last-touch; no later Current Offer write; a RELOAD keeps it blocked.
 *   A5. Navigation mid-sequence: back on the deal it stays locked; the
 *       sequence completes once; a reload shows Agreement Reached.
 *   A6. Last-touch lost after the acceptance is recorded: Agreement Reached
 *       and the timestamp-only recovery (existing handling); the uncertain
 *       last-touch step is tracked -- Unresolved, naming it.
 *   A7. A second browser during Accept: blocked, sends nothing; clear once
 *       the server has evidence for every step.
 *   A8. Bones's regression: with the submitted Accept note held, Pass is
 *       attempted on the page, from another session, and as an unreserved
 *       request straight to the server -- no Pass note and no extra last-touch
 *       reach GHL; then the Accept completes.
 *   A9. A normal Pass reserves first, then writes; the barrier is released.
 *   A10. A Pass with an unresolved last-touch blocks a later Accept, and the
 *       outcome area says why.
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
const { createBarrierFixture } = require('./harness/current-offer-barrier-fixture.cjs');
const { parseOutcomeNote } = require(path.join(APP, 'src/lib/seller-call-outcome.ts'));
const bf = createBarrierFixture({ contactOf: (o) => (o === fx.OPP ? fx.CONTACT : null) });

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
  const harnessUrl = `${base}/scripts/harness/contact-isolation/index.html`;
  const browser = await chromium.launch();
  const foreign = [];
  const exit = async (code) => { await browser.close().catch(() => {}); await server.close().catch(() => {}); process.exit(code); };
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Chicago' });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    const routeHandler = async (route) => {
      if (route.request().url().includes('/.netlify/functions/iaos-activation')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: 'open', activationId: 'v2-act-page-fixture', deployId: 'page-deploy', runtimeDeployId: 'page-deploy' }) }); // storage v2 (Bones finding 7): the page binds its activation at read sign-in
      const url = route.request().url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { foreign.push(url); return route.abort(); }
      let post = null;
      try { post = route.request().postDataJSON(); } catch { post = null; }
      const method = route.request().method();
      const fulfill = (res) => route.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(res.body) });
      if (url.includes('/.netlify/functions/current-offer-barrier')) {
        log.push({ kind: 'barrier', action: method === 'GET' ? 'status' : post && post.action });
        return fulfill(await bf.handle(method, url, post));
      }
      const req = fx.classify(url, method, post);
      if (req.kind === 'write') req.requestId = post.requestId;
      log.push(req);
      const h = holds.find((x) => !x.used && x.match(req));
      if (h) { h.used = true; h.onHit(req); await h.released; }
      if (req.kind === 'write') {
        const pre = fx.precheckWrite(req);
        const refuse = h && h.refuse ? h.refuse : pre ? { status: pre.status, error: pre.body.error } : null;
        const serverWrite = (opts) => bf.write({ operation: req.op, targetId: req.target, requestId: req.requestId, contactId: fx.CONTACT },
          () => { fx.applyWrite(req); return { confirmed: true }; },
          { ...opts, outcome: req.op === 'note.create' ? parseOutcomeNote(req.args.body) : null });
        if (h && h.lose === 'late') { h.lateWrite = () => serverWrite({ refuse: fx.precheckWrite(req) ? { status: 409, error: 'refused' } : null }); return route.abort('failed'); }
        const res = await serverWrite({ refuse, failAfterSend: !!(h && h.failAfterSend), sentNotApplied: !!(h && h.sentNotApplied) });
        return fulfill(res);
      }
      return fulfill(fx.answer(req));
    };
    await page.route('**/*', routeHandler);
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
    const unresolvedText = async () => { const el = page.getByTestId('current-offer-unresolved'); return (await el.count()) ? (await el.innerText()).trim() : null; };
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
    /* A full page load per case (and for "reload"): new JS state; the server's
       records persist. */
    const load = async () => {
      await page.goto(harnessUrl);
      await page.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 });
      await open();
    };
    const fresh = async (opts) => { fx.reset(opts); bf.reset(); log = []; holds = []; await load(); };
    const openAcceptForm = async () => {
      if (!(await confirm().count())) await toggle().click();
      await confirm().waitFor({ timeout: 5000 });
    };
    const tryEdit = async (value) => {
      await input().click().catch(() => {});
      await page.keyboard.press('Control+A').catch(() => {});
      await page.keyboard.type(String(value)).catch(() => {});
      await input().evaluate((el) => el.blur());
      return input().inputValue();
    };
    const serverClear = async () => (await bf.status(fx.OPP)).state === 'clear';

    // A1 — Bones's Accept reproduction.
    await fresh({});
    await input().fill('410000');
    const hBlur = hold((r) => r.kind === 'write' && r.op === 'opportunity.currentOffer' && r.args.value === 410000);
    await input().press('Tab');
    await hBlur.hit;
    await input().fill('400000'); await input().press('Tab');
    check('A1 setup: 410000 in flight, 400000 queued and not sent', offerWrites().join() === '410000', offerWrites());
    await openAcceptForm();
    check('A1 setup: Confirm Accept is ENABLED (deal is Offer Ready, Current Offer 400000)', await confirm().isEnabled());
    const hAccept = hold((r) => r.kind === 'write' && r.op === 'opportunity.currentOffer' && r.args.value === 400000);
    const hNote = hold((r) => r.kind === 'write' && r.op === 'note.create');
    await confirm().click();
    await page.waitForTimeout(300);
    check('A1 the Current Offer input is locked as soon as Accept starts', (await input().isEditable()) === false);
    check('A1 an attempted edit while waiting is refused', (await tryEdit(455000)) === '400000', await input().inputValue());
    hBlur.release();
    await hAccept.hit;
    check('A1 Accept waited for the save in flight, then reserved its three steps; the queued blur was dropped', offerWrites().join() === '410000,400000' && log.some((r) => r.kind === 'barrier' && r.action === 'begin'), offerWrites());
    hAccept.release();
    await hNote.hit;
    check('A1 while the acceptance note is held the input is still locked, and the server barrier holds', (await input().isEditable()) === false && !(await serverClear()));
    check('A1 an attempted edit during the note write is refused, nothing sent', (await tryEdit(466000)) === '400000' && offerWrites().join() === '410000,400000', offerWrites());
    hNote.release();
    await until(async () => (await recorded().count()) > 0, 'accept recorded').catch(() => {});
    await page.waitForTimeout(800);
    check('A1 the sequence completes: Agreement Reached, one note, one last-touch', (await recorded().count()) > 0 && noteWrites().length === 1 && touchWrites().length === 1);
    check('A1 nothing is replayed: offer writes exactly 410000 then the accepted 400000', offerWrites().join() === '410000,400000', offerWrites());
    check('A1 GHL holds the accepted price, one accept note matches it, and the barrier is released', fx.state.currentOffer === 400000 && acceptNotes().length === 1 && parseOutcomeNote(acceptNotes()[0].body).snapshot.currentOffer === 400000 && (await serverClear()));

    // A2 — offer refused before sending.
    await fresh({ currentOffer: 400000 });
    await openAcceptForm();
    let h = hold((r) => r.kind === 'write' && r.op === 'opportunity.currentOffer'); h.refuse = { status: 403, error: 'fixture: refused' }; h.release();
    await confirm().click();
    await until(async () => (await outcomeError()) !== null, 'error').catch(() => {});
    await page.waitForTimeout(500);
    check('A2 a refused offer write is reported; no note or last-touch is sent', /could not be saved/.test((await outcomeError()) || '') && noteWrites().length === 0 && touchWrites().length === 0, await outcomeError());
    check('A2 the server proved the rest unsent: the deal is usable, the barrier released', (await unresolvedText()) === null && (await input().isEditable()) && (await serverClear()));
    check('A2 GHL is unchanged and no acceptance exists', fx.state.currentOffer === 400000 && acceptNotes().length === 0);

    // A3a — offer lost BEFORE reaching the server.
    await fresh({ currentOffer: 400000 });
    await openAcceptForm();
    h = hold((r) => r.kind === 'write' && r.op === 'opportunity.currentOffer'); h.lose = 'late'; h.release();
    await confirm().click();
    await until(async () => (await outcomeError()) !== null, 'error').catch(() => {});
    await page.waitForTimeout(600);
    check('A3a a request lost before the server: the end-of-sequence check proves nothing was sent -- the deal clears', (await unresolvedText()) === null && (await input().isEditable()) && (await serverClear()) && noteWrites().length === 0, await unresolvedText());
    const lateA3 = await h.lateWrite();
    check('A3a the late request then reaches the server and sends NOTHING', lateA3.body.outcome === 'not_sent' && acceptNotes().length === 0, lateA3);

    // A3b — offer lost AFTER the GHL call.
    await fresh({ currentOffer: 400000 });
    await openAcceptForm();
    h = hold((r) => r.kind === 'write' && r.op === 'opportunity.currentOffer'); h.failAfterSend = true; h.release();
    await confirm().click();
    await until(async () => (await unresolvedText()) !== null, 'unresolved').catch(() => {});
    await page.waitForTimeout(500);
    check('A3b Unresolved and locked, naming the Current Offer save', /Current Offer save may still reach GHL/.test((await unresolvedText()) || '') && (await input().isEditable()) === false, await unresolvedText());
    check('A3b the note and last-touch are never sent; nothing is claimed recorded', noteWrites().length === 0 && touchWrites().length === 0 && (await recorded().count()) === 0);
    check('A3b the error is the unresolved state, not "you may retry"', /Unresolved/.test((await outcomeError()) || '') && !/you may retry/.test((await outcomeError()) || ''), await outcomeError());

    // A4a — note refused before sending.
    await fresh({ currentOffer: 400000 });
    await openAcceptForm();
    h = hold((r) => r.kind === 'write' && r.op === 'note.create'); h.refuse = { status: 409, error: 'Write refused or unconfirmed; refresh and inspect before retrying' }; h.release();
    await confirm().click();
    await until(async () => (await outcomeError()) !== null, 'note error').catch(() => {});
    await page.waitForTimeout(600);
    check('A4a a note refused before sending: reported (existing message), no last-touch', /may or may not have been recorded/.test((await outcomeError()) || '') && touchWrites().length === 0, await outcomeError());
    check('A4a the server proved the note and last-touch unsent: the deal clears; no acceptance exists', (await unresolvedText()) === null && (await serverClear()) && acceptNotes().length === 0);

    // A4b — note lost AFTER the GHL call; a reload keeps it blocked.
    await fresh({ currentOffer: 400000 });
    await openAcceptForm();
    h = hold((r) => r.kind === 'write' && r.op === 'note.create'); h.failAfterSend = true; h.release();
    await confirm().click();
    await until(async () => (await unresolvedText()) !== null, 'unresolved').catch(() => {});
    await page.waitForTimeout(500);
    check('A4b Unresolved and locked, naming the acceptance note; no last-touch', /acceptance note may still reach GHL/.test((await unresolvedText()) || '') && (await input().isEditable()) === false && touchWrites().length === 0, await unresolvedText());
    const before4 = offerWrites().length;
    await tryEdit(410000);
    await page.waitForTimeout(400);
    check('A4b no later Current Offer write is sent', offerWrites().length === before4);
    await load();
    await until(async () => (await unresolvedText()) !== null, 'unresolved after reload').catch(() => {});
    check('A4b after a RELOAD the deal is still Unresolved and locked', /acceptance note/.test((await unresolvedText()) || '') && (await input().isEditable()) === false);
    await page.getByTestId('current-offer-check-again').click();
    await page.waitForTimeout(800);
    check('A4b Check again cannot clear it; nothing tells the operator to reload', (await unresolvedText()) !== null && !/[Rr]eload/.test(await page.locator('body').innerText()));

    // A5 — navigation mid-sequence.
    await fresh({ currentOffer: 400000 });
    await openAcceptForm();
    const hNav = hold((r) => r.kind === 'write' && r.op === 'note.create');
    await confirm().click();
    await hNav.hit;
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
    await page.waitForTimeout(800);
    check('A5 the sequence completes exactly once and the barrier is released', noteWrites().length === 1 && touchWrites().length === 1 && acceptNotes().length === 1 && (await serverClear()));
    await load();
    await until(async () => (await recorded().count()) > 0, 'recorded after reload').catch(() => {});
    check('A5 after a reload: Agreement Reached at the accepted price', (await recorded().count()) > 0 && fx.state.currentOffer === 400000 && (await input().inputValue()) === '400000');

    // A6 — last-touch sent after the acceptance is recorded, response lost, not applied yet.
    await fresh({ currentOffer: 400000 });
    await openAcceptForm();
    // Sent, but not applied yet: GHL may still apply it later -- the case a blind retry would contradict.
    h = hold((r) => r.kind === 'write' && r.op === 'contact.lastCallAttempt'); h.sentNotApplied = true; h.release();
    await confirm().click();
    await until(async () => (await recorded().count()) > 0, 'recorded').catch(() => {});
    await page.waitForTimeout(800);
    check('A6 Agreement Reached shows, with the timestamp-only recovery offered (existing handling)', (await recorded().count()) > 0 && (await page.getByTestId('call-timestamp-recover').count()) > 0, await outcomeError());
    check('A6 the uncertain last-touch step is tracked: Unresolved, naming it; the price holds', /last-touch time may still reach GHL/.test((await unresolvedText()) || '') && fx.state.currentOffer === 400000, await unresolvedText());
    // A6 recovery (Bones / Jess 2026-10-05): "Check & retry call timestamp" obeys the barrier.
    const touchesBefore6 = touchWrites().length;
    const beginsBefore6 = log.filter((r) => r.kind === 'barrier' && r.action === 'begin').length;
    await page.getByTestId('call-timestamp-recover').click();
    await until(async () => /Call timestamp not retried/.test((await outcomeError()) || ''), 'recovery refused').catch(() => {});
    await page.waitForTimeout(500);
    check('A6 recovery while the ORIGINAL last-touch is unresolved sends NOTHING -- no new timestamp write, no reservation', touchWrites().length === touchesBefore6 && log.filter((r) => r.kind === 'barrier' && r.action === 'begin').length === beginsBefore6, { touches: touchWrites().length, before: touchesBefore6 });
    check('A6 it says why, names the unresolved last-touch, and never says reload', /Call timestamp not retried/.test((await outcomeError()) || '') && /last-touch time may still reach GHL/.test((await outcomeError()) || '') && !/[Rr]eload/.test(await page.locator('body').innerText()), await outcomeError());
    await page.getByTestId('call-timestamp-recover').click();
    await page.waitForTimeout(800);
    check('A6 retrying again still sends nothing', touchWrites().length === touchesBefore6);

    // A6b — last-touch refused BEFORE sending: provably not sent, so recovery may proceed -- reserved.
    await fresh({ currentOffer: 400000 });
    await openAcceptForm();
    h = hold((r) => r.kind === 'write' && r.op === 'contact.lastCallAttempt'); h.refuse = { status: 409, error: 'fixture: refused before sending' }; h.release();
    await confirm().click();
    await until(async () => (await page.getByTestId('call-timestamp-recover').count()) > 0, 'recovery offered').catch(() => {});
    await page.waitForTimeout(600);
    check('A6b Agreement Reached; the refused last-touch was never sent, so the deal clears (barrier released)', (await recorded().count()) > 0 && (await serverClear()) && (await unresolvedText()) === null);
    const logAt6b = log.length;
    await page.getByTestId('call-timestamp-recover').click();
    await until(async () => (await page.getByTestId('call-timestamp-recover').count()) === 0, 'recovered').catch(() => {});
    await page.waitForTimeout(600);
    const after6b = log.slice(logAt6b);
    const beginAt = after6b.findIndex((r) => r.kind === 'barrier' && r.action === 'begin');
    const touchAt = after6b.findIndex((r) => r.kind === 'write' && r.op === 'contact.lastCallAttempt');
    check('A6b recovery reserves FIRST (a last-touch-only reservation), then sends exactly one timestamp write', beginAt >= 0 && touchAt > beginAt && after6b.filter((r) => r.kind === 'write' && r.op === 'contact.lastCallAttempt').length === 1, after6b.map((r) => r.kind === 'write' ? r.op : `${r.kind}:${r.action || ''}`));
    check('A6b the recovery write carries a new reserved request id (not the original)', touchAt >= 0 && after6b[touchAt].requestId !== touchWrites()[0].requestId);
    check('A6b recovered: the warning is gone, the timestamp is saved, and the barrier is released', (await page.getByTestId('call-timestamp-recover').count()) === 0 && fx.state.contactFields.some((f) => f.value && String(f.value).includes('T')) && (await serverClear()));

    // A7 — a second browser during Accept.
    await fresh({ currentOffer: 400000 });
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Chicago' });
    const page2 = await ctx2.newPage();
    page2.on('pageerror', (e) => pageErrors.push('browser 2: ' + String(e)));
    await page2.route('**/*', routeHandler);
    await ctx2.route(/gohighlevel\.com/, (rt) => rt.abort());
    const input2 = () => page2.getByTestId('negotiation-current-offer-input');
    await openAcceptForm();
    const hN2 = hold((r) => r.kind === 'write' && r.op === 'note.create');
    await confirm().click();
    await hN2.hit;
    await page2.goto(harnessUrl);
    await page2.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 });
    await page2.evaluate((t) => window.__iaosNavigate(t), `/contacts/${fx.CONTACT}/seller-call`);
    await input2().waitFor({ timeout: 30000 });
    await page2.waitForTimeout(800);
    check('A7 browser 2 opening the deal during Accept is blocked and locked', (await page2.getByTestId('current-offer-unresolved').count()) > 0 && (await input2().isEditable()) === false);
    const w7 = offerWrites().length;
    await input2().evaluate((el) => el.blur());
    await page2.waitForTimeout(400);
    check('A7 browser 2 sends nothing', offerWrites().length === w7);
    hN2.release();
    await until(async () => touchWrites().length === 1, 'accept finished').catch(() => {});
    await page.waitForTimeout(600);
    await page2.getByTestId('current-offer-check-again').click();
    await page2.waitForTimeout(800);
    check('A7 once the server has evidence for every step, Check again clears browser 2 (Agreement now freezes the offer)', (await page2.getByTestId('current-offer-unresolved').count()) === 0 && (await serverClear()));
    await ctx2.close();

    // A8 — Bones's exact regression: hold the submitted Accept note -> attempt Pass from the
    //      page and from another session -> nothing conflicting reaches GHL -> release Accept.
    const passToggle = (pg) => pg.getByTestId('call-outcome-pass-toggle');
    const passReason = (pg) => pg.getByTestId('call-outcome-pass-reason');
    const passConfirm = (pg) => pg.getByTestId('call-outcome-pass-confirm');
    const outcomeNotesOf = (kind) => fx.state.notes.filter((n) => (parseOutcomeNote(n.body) || {}).kind === kind);
    const passNoteWrites = () => log.filter((r) => r.kind === 'write' && r.op === 'note.create' && (parseOutcomeNote(r.args.body) || {}).kind === 'pass');
    const tryPass = async (pg, reason) => {
      await passToggle(pg).click({ timeout: 2000 }).catch(() => {});
      await passReason(pg).fill(reason, { timeout: 2000 }).catch(() => {});
      await passConfirm(pg).click({ timeout: 2000 }).catch(() => {});
      await pg.waitForTimeout(800);
    };
    await fresh({ currentOffer: 400000 });
    await openAcceptForm();
    const hA8 = hold((r) => r.kind === 'write' && r.op === 'note.create' && (parseOutcomeNote(r.args.body) || {}).kind === 'accept');
    await confirm().click();
    await hA8.hit;                                       // the Accept note is submitted and held
    const touches8 = touchWrites().length;
    await tryPass(page, 'Seller changed their mind (page)');
    check('A8 Pass attempted on the same page during Accept: no Pass note and no extra last-touch reach GHL', passNoteWrites().length === 0 && touchWrites().length === touches8 && outcomeNotesOf('pass').length === 0);
    const ctx8 = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Chicago' });
    const page8 = await ctx8.newPage();
    page8.on('pageerror', (e) => pageErrors.push('browser 2: ' + String(e)));
    await page8.route('**/*', routeHandler);
    await ctx8.route(/gohighlevel\.com/, (rt) => rt.abort());
    await page8.goto(harnessUrl);
    await page8.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 });
    await page8.evaluate((t) => window.__iaosNavigate(t), `/contacts/${fx.CONTACT}/seller-call`);
    await page8.getByTestId('negotiation-current-offer-input').waitFor({ timeout: 30000 });
    await page8.waitForTimeout(800);
    check('A8 the other session shows WHY no outcome can be recorded (the Accept in progress)', (await page8.getByTestId('outcome-blocked-reason').count()) > 0 && /An Accept for this deal is in progress/.test(await page8.getByTestId('outcome-blocked-reason').innerText()));
    await tryPass(page8, 'Seller changed their mind (other session)');
    const err8 = await page8.getByTestId('call-outcome-error').count() ? await page8.getByTestId('call-outcome-error').innerText() : '';
    check('A8 Pass attempted from another session is refused before anything is sent, with the reason', /Cannot record Pass/.test(err8) && passNoteWrites().length === 0 && touchWrites().length === touches8, err8);
    const { formatOutcomeNote } = require(path.join(APP, 'src/lib/seller-call-outcome.ts'));
    const rogue = formatOutcomeNote({ opportunityId: fx.OPP, kind: 'pass', at: '2026-10-05T23:00:00.000Z', operator: null, reason: 'unreserved bypass', followUpAt: null,
      snapshot: { sellerPosition: null, currentOffer: 400000, targetAcquisitionPrice: null, maxSupportedOffer: null, expectedSpread: null, arv: null, repairs: null, readinessStatus: 'OFFER_READY' } });
    const bypass = await page8.evaluate(async (body) => {
      const r = await fetch('/.netlify/functions/ghl-write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'note.create', targetId: body.contact, requestId: 'rogue-pass-0001', args: { body: body.note } }) });
      return { status: r.status, body: await r.json() };
    }, { contact: fx.CONTACT, note: rogue });
    check('A8 an UNRESERVED Pass note sent directly to the server is refused (not_sent); nothing reaches GHL', bypass.body.outcome === 'not_sent' && outcomeNotesOf('pass').length === 0, bypass);
    hA8.release();                                       // release the Accept
    await until(async () => (await recorded().count()) > 0 && touchWrites().length === touches8 + 1, 'accept finished').catch(() => {});
    await page.waitForTimeout(600);
    check('A8 Accept completes: exactly one outcome note (the acceptance), no Pass note, one last-touch (Accept\'s own)', outcomeNotesOf('accept').length === 1 && outcomeNotesOf('pass').length === 0 && touchWrites().length === touches8 + 1 && (await serverClear()));
    await ctx8.close();

    // A9 — a normal Pass is reserved and completes; the barrier is released.
    await fresh({ currentOffer: 400000 });
    const logAt9 = log.length;
    await tryPass(page, 'Not selling this year');
    await until(async () => outcomeNotesOf('pass').length === 1 && touchWrites().length === 1, 'pass done').catch(() => {});
    const after9 = log.slice(logAt9);
    const begin9 = after9.findIndex((r) => r.kind === 'barrier' && r.action === 'begin');
    const note9 = after9.findIndex((r) => r.kind === 'write' && r.op === 'note.create');
    check('A9 Pass reserves first, then sends its note and last-touch; the barrier is released', begin9 >= 0 && note9 > begin9 && outcomeNotesOf('pass').length === 1 && touchWrites().length === 1 && (await serverClear()), after9.map((r) => r.kind === 'write' ? r.op : `${r.kind}:${r.action || ''}`));

    // A10 — a Pass whose last-touch is unresolved blocks a later Accept, with the reason shown.
    await fresh({ currentOffer: 400000 });
    h = hold((r) => r.kind === 'write' && r.op === 'contact.lastCallAttempt'); h.sentNotApplied = true; h.release();
    await tryPass(page, 'Not selling this year');
    await until(async () => (await page.getByTestId('outcome-blocked-reason').count()) > 0, 'blocked reason').catch(() => {});
    check('A10 the Pass\'s last-touch is unresolved: the outcome area says so, naming it', /Pass/.test((await page.getByTestId('outcome-blocked-reason').innerText().catch(() => '')) || '') || /last-touch time may still reach GHL/.test((await page.getByTestId('outcome-blocked-reason').innerText().catch(() => '')) || ''));
    const offers10 = offerWrites().length;
    const notes10 = log.filter((r) => r.kind === 'write' && r.op === 'note.create').length;
    if (await confirm().count() === 0) await toggle().click().catch(() => {});
    await confirm().click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(800);
    check('A10 an Accept attempted now sends nothing (no offer write, no note)', offerWrites().length === offers10 && log.filter((r) => r.kind === 'write' && r.op === 'note.create').length === notes10 && outcomeNotesOf('accept').length === 0);

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
