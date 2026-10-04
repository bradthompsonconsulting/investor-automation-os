/**
 * B14-12 / INV-94, PR #115 — contact isolation under A -> B navigation (Bones).
 *
 * Offline. Vite serves scripts/harness/contact-isolation, which renders the
 * REAL ContactWorkspace and SellerCallWorkspace with the real GHL client in
 * headless Chromium. Every /.netlify/functions request is answered here from
 * an in-memory fixture (two contacts, A and B); any single response can be
 * HELD, so A's write or read is still pending when the page moves to B.
 * Nothing leaves the machine: a request that is not /.netlify/functions or
 * the local Vite server is aborted and counted.
 *
 * Proves, with the fix in place:
 *   Contact page — the recording-only call log (B14-12): choosing a result
 *   writes nothing; Save writes the result, the note and the last touch only
 *   (never routing, the trigger timestamp or a callback) for every result;
 *   notes show as the last call; Follow Up never schedules a callback and Set
 *   Callback is the explicit action; a failed note is partial with Retry; a
 *   late A write or notes read never puts A's notes on B.
 *   Seller Call — Pass names a Follow-Up callback saved on this page for the
 *   SAME contact, and a late A save or a late A read never becomes B's Pass
 *   warning; while B's record is loading the warning names no callback, and
 *   Confirm Pass sends no write (button or handler) until B's status is
 *   known, which a late read for A cannot supply.
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
const G = require(path.join(APP, 'shared/ghl-config.ts'));
const { getConfig } = G;
const scopeLib = require(path.join(APP, 'netlify/functions/lib/production-write-scope.ts'));
// Production, as committed, with ONLY the B14-12 call-log class switched on.
const PROD_CALL_LOG_ON = { ...JSON.parse(JSON.stringify(getConfig('production'))), productionCallLog: G.PRODUCTION_CALL_LOG_ENABLED };
let prodScope = false;
let prodScopeConfig = PROD_CALL_LOG_ON;
let saveThenFail = [];   // predicates: apply the write, then answer 500 (an uncertain save)
const handoffs = [];
const CFG = getConfig('test');
const F = CFG.fields;

let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}

// ── In-memory GHL fixture ───────────────────────────────────────────────────
const A = 'fixtureContactA';
const B = 'fixtureContactB';
const A_CALLBACK = '2026-10-06T15:00:00.000Z';   // Oct 6, 10:00 AM CT
const B_CALLBACK = '2026-10-09T19:30:00.000Z';   // Oct 9, 2:30 PM CT
let db;
function resetDb({ aCallback = null, bCallback = null, aDnd = {}, bDnd = {} } = {}) {
  const contact = (id, first, cb, dnd) => ({ dnd: JSON.parse(JSON.stringify(dnd)),
    id, first, fields: new Map(cb ? [[F.callbackDatetimePrecise, cb], [F.callbackDatetime, Date.parse(cb)]] : []),
    notes: [{ id: `${id}-n1`, body: `Seed note for ${first}`, dateAdded: '2026-09-30T12:00:00.000Z' }],
  });
  db = { [A]: contact(A, 'Alpha', aCallback, aDnd), [B]: contact(B, 'Bravo', bCallback, bDnd) };
}
const field = (c, id) => (c.fields.has(id) ? c.fields.get(id) : null);
function contactRow(c) {
  return {
    id: c.id, firstName: c.first, lastName: 'Fixture', phone: '+15555550100', email: '', address1: '', city: '', state: '',
    postalCode: '', dateAdded: '2026-09-01T00:00:00.000Z', tags: [], dndSettings: c.dnd, motivationScore: null, dealScore: null,
    combinedScore: null, completenessScore: null,
    callbackDatetime: field(c, F.callbackDatetimePrecise), callbackDatetimePrecise: field(c, F.callbackDatetimePrecise),
    lastCallAttempt: field(c, F.lastCallAttemptPrecise), lastCallAttemptPrecise: field(c, F.lastCallAttemptPrecise),
    callDisposition: field(c, F.callDisposition), dispositionAt: field(c, F.dispositionAt),
  };
}
const detail = (c) => ({ contact: { id: c.id, firstName: c.first, lastName: 'Fixture', phone: '+15555550100', dndSettings: c.dnd,
  customFields: [...c.fields].map(([id, value]) => ({ id, value })) } });
const pipeline = () => ({
  pipelineId: 'fixture-pipeline', stages: [],
  opportunities: [A, B].map((id) => ({ id: `${id}-opp`, contactId: id, contactName: db[id].first, opportunityName: `${db[id].first} deal`,
    phone: '', email: '', stageId: 'fixture-stage', customFields: [] })),
});
function applyWrite(op, target, args) {
  const c = db[target];
  if (!c) return { status: 404, body: { error: 'unknown target' } };
  const set = (...ids) => ids.forEach((id) => (args.value === null ? c.fields.delete(id) : c.fields.set(id, args.value)));
  switch (op) {
    case 'note.create':
      c.notes.push({ id: `${target}-n${c.notes.length + 1}`, body: args.body, dateAdded: new Date().toISOString() }); return { status: 200, body: { note: { id: 'n' } } };
    case 'contact.disposition': set(F.callDisposition); break;
    case 'contact.callLogResult': set(F.callDisposition); break;
    case 'contact.routing': set(F.callRouting); break;
    case 'contact.dispositionAt': set(F.dispositionAt); break;
    case 'contact.lastCallAttempt': set(F.lastCallAttempt, F.lastCallAttemptPrecise); break;
    case 'contact.callback': case 'contact.explicitCallback': set(F.callbackDatetime, F.callbackDatetimePrecise); break;
    default: return { status: 400, body: { error: `fixture does not model ${op}` } };
  }
  return { status: 200, body: { confirmed: true } };
}

// ── Request log, holds and injected failures ────────────────────────────────
let log = [];        // { kind, contact, op? } in arrival order
let holds = [];      // { match, hit, release, released }
let failNext = [];   // predicates: answer the next matching request with 500
let foreign = [];
function hold(match) {
  let release; let hitResolve;
  const h = { match, released: new Promise((r) => { release = r; }), hit: new Promise((r) => { hitResolve = r; }) };
  h.release = release; h.onHit = hitResolve; holds.push(h);
  return h;
}
function classify(url, method, post) {
  const u = new URL(url);
  const fn = u.pathname.replace('/.netlify/functions/', '');
  if (fn === 'ghl-write' && method === 'POST') return { kind: 'write', op: post.operation, contact: post.targetId, args: post.args };
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
    case 'write': return applyWrite(req.op, req.contact, req.args);
    case 'notes': return { status: 200, body: { notes: db[req.contact].notes.slice() } };
    case 'detail': return { status: 200, body: detail(db[req.contact]) };
    case 'row': return { status: 200, body: contactRow(db[req.contact]) };
    case 'defs': return { status: 200, body: { customFields: [] } };
    case 'folder': return { status: 200, body: { customField: { id: 'folder', name: 'Folder', position: 0 } } };
    case 'ghl-opportunities': return { status: 200, body: pipeline() };
    case 'ghl-underwriting-policy': return { status: 200, body: { values: [] } };
    case 'ghl-contact-conversations': return { status: 200, body: { messages: [], conversations: [] } };
    default: return { status: 404, body: { error: `fixture does not model ${req.kind}` } };
  }
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
      const req = classify(url, route.request().method(), post);
      log.push(req);
      const h = holds.find((x) => !x.used && x.match(req));
      if (h) { h.used = true; h.onHit(req); await h.released; }
      if (prodScope && req.kind === 'write') {
        const decision = scopeLib.evaluateProductionGhlWriteScope(prodScopeConfig, { operation: req.op, targetId: req.contact, args: req.args });
        if (!decision.ok) {
          req.refused = decision.code;
          return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Production write refused by the proof write scope', by: 'iaos-production-write-scope', code: decision.code }) });
        }
      }
      const sf = saveThenFail.findIndex((p) => p(req));
      if (sf >= 0) { saveThenFail.splice(sf, 1); answer(req); return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'fixture: saved, then the response failed' }) }); }
      const fi = failNext.findIndex((p) => p(req));
      const res = fi >= 0 ? (failNext.splice(fi, 1), { status: 500, body: { error: 'fixture: injected failure' } }) : answer(req);
      return route.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(res.body) });
    });

    await page.context().route(/gohighlevel\.com/, (route) => { handoffs.push(route.request().url()); return route.abort(); });
    await page.goto(`${base}/scripts/harness/contact-isolation/index.html`);
    await page.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 });
    const go = (to) => page.evaluate((t) => window.__iaosNavigate(t), to);
    const text = () => page.locator('body').innerText();
    const settle = () => page.waitForTimeout(400);
    const until = async (fn, label, ms = 15000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(50); }
      throw new Error(`timed out waiting for ${label}`);
    };
    const writesFor = (contact, op) => log.filter((r) => r.kind === 'write' && r.contact === contact && (!op || r.op === op)).length;
    const notesReadsFor = (contact) => log.filter((r) => r.kind === 'notes' && r.contact === contact).length;
    const fresh = async (opts, to) => {
      resetDb(opts); log = []; holds = []; failNext = []; saveThenFail = [];
      await go('/'); await settle();
      await go(to);
    };
    const contactLoaded = (first) => until(async () => (await text()).includes(`Seed note for ${first}`), `${first} notes`);
    const A_NOTE = 'Call (reported by Brad in IAOS): No Answer';

    // ═══ Contact page: recording-only call log (B14-12, Jess 2026-10-02) ═══
    const W = () => log.filter((r) => r.kind === 'write');
    const opsFor = (contact, from = 0) => W().slice(from).filter((r) => r.contact === contact).map((r) => r.op);
    const RETIRED = ['contact.routing', 'contact.dispositionAt', 'contact.disposition', 'contact.callback'];
    const save = async (result, notes) => {
      await page.getByTestId('call-log-result-' + result.replace(/\s+/g, '-').toLowerCase()).click();
      if (notes !== undefined) await page.getByTestId('call-log-notes').fill(notes);
      await page.getByTestId('call-log-save').click();
    };

    // C1 — choosing a result writes nothing; Save writes result, note, last touch, in order; the note shows without a reload.
    await fresh({}, `/contacts/${A}`);
    await contactLoaded('Alpha');
    let w0 = W().length;
    await page.getByTestId('call-log-result-no-answer').click();
    await settle();
    check('call log: choosing a result writes nothing', W().length === w0, W().slice(w0));
    await page.getByTestId('call-log-save').click();
    await until(async () => writesFor(A, 'contact.lastCallAttempt') === 1, 'A last touch');
    check('call log: Save writes the result, the note, then the last touch — nothing else',
      JSON.stringify(opsFor(A, w0)) === JSON.stringify(['contact.callLogResult', 'note.create', 'contact.lastCallAttempt']), opsFor(A, w0));
    await until(async () => (await text()).includes(A_NOTE), 'A call-log note in the list');
    check('contact page: a saved call appears in the notes list without a reload', (await text()).includes(A_NOTE));

    // C2 — every result is recording-only: never routing, the bell, the old disposition op or a callback.
    for (const result of ['No Answer', 'Voicemail', 'Spoke with Seller', 'Follow Up', 'Not Interested', 'Incorrect Number']) {
      await fresh({}, `/contacts/${B}`);
      await contactLoaded('Bravo');
      w0 = W().length;
      await save(result);
      await until(async () => writesFor(B, 'contact.lastCallAttempt') === 1, result + ' last touch');
      const ops = opsFor(B, w0);
      check('call log ' + result + ': records only (result, note, last touch); no routing, bell or callback',
        JSON.stringify(ops) === JSON.stringify(['contact.callLogResult', 'note.create', 'contact.lastCallAttempt']) && !ops.some((o) => RETIRED.includes(o)), ops);
      check('call log ' + result + ': the result field holds ' + result, db[B].fields.get(F.callDisposition) === result, db[B].fields.get(F.callDisposition));
    }

    // C3 — notes are saved with the result and shown as the last call.
    await fresh({}, `/contacts/${A}`);
    await contactLoaded('Alpha');
    await save('Spoke with Seller', 'Wants to close in 30 days.\nAsk about the roof next time.');
    await until(async () => writesFor(A, 'contact.lastCallAttempt') === 1, 'A spoke');
    const spokeNote = W().find((r) => r.contact === A && r.op === 'note.create');
    check('call log: the note carries the result and Brad\'s notes',
      spokeNote && spokeNote.args.body === 'Call (reported by Brad in IAOS): Spoke with Seller\nWants to close in 30 days.\nAsk about the roof next time.', spokeNote && spokeNote.args.body);
    await until(async () => (await page.getByTestId('call-log-last').count()) === 1, 'last call summary');
    const last = await page.getByTestId('call-log-last').innerText();
    check('call log: the last call shows its result and notes for the next call', /Last call:\s*Spoke with Seller/.test(last) && last.includes('Ask about the roof next time.'), last);

    // C4 — Follow Up never schedules a callback; Set Callback is the explicit action.
    await fresh({}, `/contacts/${A}`);
    await contactLoaded('Alpha');
    await page.getByTestId('call-log-result-follow-up').click();
    check('call log Follow Up: the hint points to Set Callback',
      (await page.getByTestId('call-log-follow-up-hint').innerText()).includes("Follow Up doesn't set a callback. Use Set Callback to choose a date and time."));
    w0 = W().length;
    await page.getByTestId('call-log-save').click();
    await until(async () => writesFor(A, 'contact.lastCallAttempt') === 1, 'A follow up');
    check('call log Follow Up: no callback is written', writesFor(A, 'contact.callback') === 0 && !db[A].fields.has(F.callbackDatetimePrecise));
    await page.getByTestId('call-log-result-follow-up').click();
    w0 = W().length;
    await page.getByTestId('call-log-set-callback').click();
    await settle();
    check('call log: Set Callback opens the callback control and writes nothing by itself',
      (await page.locator('input[type="datetime-local"]').count()) === 1 && W().length === w0, W().slice(w0));
    await page.locator('input[type="datetime-local"]').fill('2026-10-09T14:30');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await until(async () => writesFor(A, 'contact.explicitCallback') === 1, 'explicit callback');
    await until(async () => (await text()).includes('Callback: Oct 9, 2:30 PM'), 'callback display').catch(() => {});
    check('call log: Set Callback writes through the explicit-callback operation', writesFor(A, 'contact.explicitCallback') === 1 && writesFor(A, 'contact.callback') === 0);
    check('call log: a callback is set only by Brad\'s explicit date and time',
      db[A].fields.get(F.callbackDatetimePrecise) === '2026-10-09T19:30:00.000Z' && (await text()).includes('Callback: Oct 9, 2:30 PM'),
      { stored: db[A].fields.get(F.callbackDatetimePrecise), shown: (await text()).split('\n').filter((l) => l.includes('Callback:')) });

    // C5 — partial failure: a failed note is reported, nothing claims success, Retry completes it.
    await fresh({}, `/contacts/${A}`);
    await contactLoaded('Alpha');
    failNext.push((r) => r.kind === 'write' && r.op === 'note.create' && r.contact === A);
    const readsBefore = notesReadsFor(A);
    await save('No Answer');
    await until(async () => (await page.getByTestId('call-log-partial').count()) === 1, 'partial');
    check('call log: a failed note is reported as partial (result saved, notes not saved)',
      /Result saved; notes not saved/.test(await page.getByTestId('call-log-partial').innerText()) && (await page.getByTestId('call-log-done').count()) === 0);
    check('call log: a failed note does not refresh the notes list or touch last call', notesReadsFor(A) === readsBefore && writesFor(A, 'contact.lastCallAttempt') === 0,
      { readsBefore, readsAfter: notesReadsFor(A), touches: writesFor(A, 'contact.lastCallAttempt'), ops: opsFor(A) });
    await page.getByTestId('call-log-retry-note').click();
    await until(async () => writesFor(A, 'contact.lastCallAttempt') === 1, 'retry');
    check('call log: Retry notes writes the note then the last touch, and reports saved',
      writesFor(A, 'note.create') === 2 && (await page.getByTestId('call-log-done').count()) === 1,
      { notes: writesFor(A, 'note.create'), ops: opsFor(A), done: await page.getByTestId('call-log-done').count() });

    // C5b — Bones (PR #117): the result write lands in GHL, then its readback returns 500.
    await fresh({}, `/contacts/${A}`);
    await contactLoaded('Alpha');
    w0 = W().length;
    failNext.push((r) => r.kind === 'detail' && r.contact === A);
    await save('Spoke with Seller', 'readback will fail');
    await until(async () => (await page.getByTestId('call-log-saved-unverified').count()) + (await page.getByTestId('call-log-not-saved').count()) === 1, 'a settled save state');
    await settle(); await settle();          // room for any (forbidden) retry or follow-on write
    const unverified = (await page.getByTestId('call-log-saved-unverified').count())
      ? await page.getByTestId('call-log-saved-unverified').innerText()
      : 'NOT saved-unverified; showed: ' + await page.getByTestId('call-log-not-saved').innerText();
    check('readback 500: the result stays saved in the GHL record', db[A].fields.get(F.callDisposition) === 'Spoke with Seller', db[A].fields.get(F.callDisposition));
    check('readback 500: the UI says saved but unverified, and that notes and last touch were not attempted',
      /^Result saved -- IAOS confirmed the write, but couldn't read it back to verify it/.test(unverified) && /Notes and last-touch time were not attempted\.$/.test(unverified.trim()), unverified);
    check('readback 500: nothing on the page says "Nothing was written" or "Saved:"',
      !/Nothing was written/.test(await text()) && (await page.getByTestId('call-log-done').count()) === 0 && (await page.getByTestId('call-log-not-saved').count()) === 0);
    check('readback 500: exactly one write, the result — no note, no last touch, no automatic retry',
      JSON.stringify(opsFor(A, w0)) === JSON.stringify(['contact.callLogResult']), opsFor(A, w0));

    // C6 — A's note write still pending at A -> B: B shows only B's notes.
    await fresh({}, `/contacts/${A}`);
    await contactLoaded('Alpha');
    let h = hold((r) => r.kind === 'write' && r.op === 'note.create' && r.contact === A);
    await save('No Answer');
    await h.hit;
    await go(`/contacts/${B}`);
    await contactLoaded('Bravo');
    const aReadsAtNav = notesReadsFor(A);
    h.release();
    await until(async () => writesFor(A, 'contact.lastCallAttempt') === 1, 'A run to finish after navigation');
    await settle();
    let t = await text();
    check('A->B with A\'s note write pending: B shows B\'s notes', t.includes('Seed note for Bravo'));
    check('A->B with A\'s note write pending: none of A\'s notes appear on B', !t.includes('Seed note for Alpha') && !t.includes(A_NOTE));
    check('A->B with A\'s note write pending: no notes read is started for A after navigation', notesReadsFor(A) === aReadsAtNav, { atNav: aReadsAtNav, after: notesReadsFor(A) });

    // C7 — A's notes REFRESH READ still pending at A -> B: its late answer is dropped.
    await fresh({}, `/contacts/${A}`);
    await contactLoaded('Alpha');
    const initialAReads = notesReadsFor(A);
    h = hold((r) => r.kind === 'notes' && r.contact === A && notesReadsFor(A) > initialAReads);
    await save('No Answer');
    await h.hit;
    await go(`/contacts/${B}`);
    await contactLoaded('Bravo');
    h.release();
    await until(async () => writesFor(A, 'contact.lastCallAttempt') === 1, 'A run to finish');
    await settle();
    t = await text();
    check('A->B with A\'s notes read pending: B still shows B\'s notes after A\'s read returns', t.includes('Seed note for Bravo'));
    check('A->B with A\'s notes read pending: A\'s notes never replace B\'s', !t.includes('Seed note for Alpha') && !t.includes(A_NOTE));


    // ═══ Seller Call ════════════════════════════════════════════════════════
    const passText = async () => {
      await until(async () => (await page.getByTestId('call-outcome-pass-toggle').count()) > 0, 'Pass toggle');
      if ((await page.getByTestId('call-outcome-pass-consequence').count()) === 0) await page.getByTestId('call-outcome-pass-toggle').click();
      return (await page.getByTestId('call-outcome-pass-consequence').innerText()).trim();
    };
    const BASE = 'Records the pass. No seller messages.';
    const warns = (when) => `${BASE} Your callback for ${when} stays scheduled: Pass does not clear it. If you won't call back, clear it separately on the contact page.`;
    const scLoaded = (first) => until(async () => (await text()).includes(`${first} deal`), `${first} Seller Call`);
    const recordFollowUp = async (local) => {
      await page.getByTestId('call-outcome-follow-up-toggle').click();
      await page.getByTestId('call-outcome-follow-up-at').fill(local);
      await page.getByTestId('call-outcome-follow-up-confirm').click();
    };

    // S1 — successful Follow-Up then Pass, same contact: Pass names the new callback.
    await fresh({}, `/contacts/${A}/seller-call`);
    await scLoaded('Alpha');
    check('Seller Call: no callback -> unchanged Pass text', (await passText()) === BASE, await passText());
    await page.getByTestId('call-outcome-pass-toggle').click();
    await recordFollowUp('2026-10-06T10:00');
    await until(async () => writesFor(A, 'note.create') === 2, 'A Follow-Up notes');
    check('Seller Call: Pass names the Follow-Up callback just saved for this contact', (await passText()) === warns('Oct 6, 10:00 AM'), await passText());

    // S2 — A's Follow-Up callback save pending at A -> B: B's Pass uses only B's callback.
    await fresh({}, `/contacts/${A}/seller-call`);
    await scLoaded('Alpha');
    h = hold((r) => r.kind === 'write' && r.op === 'contact.callback' && r.contact === A);
    await recordFollowUp('2026-10-06T10:00');
    await h.hit;
    await go(`/contacts/${B}/seller-call`);
    await scLoaded('Bravo');
    h.release();
    await until(async () => writesFor(A, 'note.create') === 2, 'A Follow-Up to finish after navigation');
    await settle();
    let p = await passText();
    check('A->B with A\'s Follow-Up save pending: B\'s Pass names no callback (B has none)', p === BASE, p);
    check('A->B with A\'s Follow-Up save pending: A\'s Oct 6 callback never appears in B\'s warning', !p.includes('Oct 6'), p);

    // S3 — same race, B has its own callback: B's Pass names B's, not A's.
    await fresh({ bCallback: B_CALLBACK }, `/contacts/${A}/seller-call`);
    await scLoaded('Alpha');
    h = hold((r) => r.kind === 'write' && r.op === 'contact.callback' && r.contact === A);
    await recordFollowUp('2026-10-06T10:00');
    await h.hit;
    await go(`/contacts/${B}/seller-call`);
    await scLoaded('Bravo');
    h.release();
    await until(async () => writesFor(A, 'note.create') === 2, 'A Follow-Up to finish');
    await settle();
    p = await passText();
    check('A->B with A\'s Follow-Up save pending: B\'s Pass names B\'s own callback', p === warns('Oct 9, 2:30 PM'), p);

    // S4 — B's record still loading after A -> B: the warning shows no other contact's callback.
    await fresh({ aCallback: A_CALLBACK }, `/contacts/${A}/seller-call`);
    await scLoaded('Alpha');
    check('Seller Call: A\'s own stored callback is named on A', (await passText()) === warns('Oct 6, 10:00 AM'), await passText());
    h = hold((r) => r.kind === 'detail' && r.contact === B);
    await go(`/contacts/${B}/seller-call`);
    await h.hit;
    await settle();
    p = await passText();
    check('A->B with B\'s read pending: B\'s Pass does not name A\'s callback', !p.includes('Oct 6'), p);
    check('A->B with B\'s read pending: B\'s Pass says it is still checking', p === `${BASE} Checking this contact for a scheduled callback…`, p);
    h.release();
    await until(async () => (await passText()) === BASE, 'B Pass text after B loads');
    check('A->B, B loaded: B\'s Pass names no callback (B has none)', (await passText()) === BASE);

    // S5 — A's own initial read late: navigation to B before A's read returns.
    await fresh({ aCallback: A_CALLBACK }, `/`);
    h = hold((r) => r.kind === 'detail' && r.contact === A);
    await go(`/contacts/${A}/seller-call`);
    await h.hit;
    await go(`/contacts/${B}/seller-call`);
    await scLoaded('Bravo');
    h.release();
    await settle();
    p = await passText();
    check('A->B with A\'s initial read pending: A\'s late record never becomes B\'s warning', p === BASE, p);

    // S6 — Bones's repro at b2e27d8: B's read pending, reason entered, Confirm Pass attempted.
    const writes = () => log.filter((r) => r.kind === 'write');
    const attemptPass = async () => {
      const before = log.filter((r) => r.kind === 'write').length;
      // 1) the button as a person would click it (forced past the disabled state)
      await page.getByTestId('call-outcome-pass-confirm').click({ force: true }).catch(() => {});
      await settle();
      if (log.filter((r) => r.kind === 'write').length > before) return;   // already wrote: the zero-writes check reports it
      // 2) the handler itself. React drops clicks on a button whose `disabled`
      //    PROP is set, so call the rendered onClick prop directly: only
      //    handleRecordOutcome's own gate stands between this call and a write.
      const invoked = await page.getByTestId('call-outcome-pass-confirm').evaluate((el) => {
        const key = Object.keys(el).find((k) => k.startsWith('__reactProps$'));
        if (!key || typeof el[key].onClick !== 'function') return false;
        el[key].onClick({}); return true;
      });
      if (!invoked) throw new Error('could not reach the Confirm Pass onClick handler');
      await settle();
    };
    const passConfirmDisabled = () => page.getByTestId('call-outcome-pass-confirm').isDisabled();
    await fresh({ aCallback: A_CALLBACK }, `/contacts/${A}/seller-call`);
    await scLoaded('Alpha');
    h = hold((r) => r.kind === 'detail' && r.contact === B);
    await go(`/contacts/${B}/seller-call`);
    await h.hit;
    let writesAtNav = writes().length;
    await passText();
    await page.getByTestId('call-outcome-pass-reason').fill('14-12 offline gate check');
    check('B\'s read pending: the warning says it is still checking', (await passText()) === `${BASE} Checking this contact for a scheduled callback…`);
    check('B\'s read pending: Confirm Pass stays disabled after a reason is entered', await passConfirmDisabled());
    await attemptPass();
    check('B\'s read pending: attempting confirmation (button and handler) sends zero write requests', writes().length === writesAtNav,
      writes().slice(writesAtNav));
    check('B\'s read pending: the handler explains why nothing was recorded',
      (await page.getByTestId('call-outcome-error').innerText().catch(() => '')).includes('Still checking this contact for a scheduled callback'));
    h.release();
    await until(async () => (await passText()) === BASE, 'B status known');
    check('B\'s read resolved: Confirm Pass is enabled', !(await passConfirmDisabled()));
    check('B\'s read resolved: still zero writes before confirmation', writes().length === writesAtNav, writes().slice(writesAtNav));
    await page.getByTestId('call-outcome-pass-confirm').click();
    await until(async () => writesFor(B, 'contact.lastCallAttempt') === 1, 'B Pass writes');
    const bPass = writes().slice(writesAtNav);
    check('B\'s read resolved: confirmation records the Pass for B only (note, then attempt)',
      JSON.stringify(bPass.map((r) => [r.op, r.contact])) === JSON.stringify([['note.create', B], ['contact.lastCallAttempt', B]]), bPass.map((r) => [r.op, r.contact]));
    check('B\'s Pass note is B\'s opportunity, with the entered reason',
      /\nOpportunity: fixtureContactB-opp\n/.test(bPass[0].args.body) && /\nOutcome: pass\n/.test(bPass[0].args.body) && /\nReason: 14-12 offline gate check\n/.test(bPass[0].args.body));
    check('no write reached A during the B Pass', writes().every((r) => r.contact !== A));

    // S7 — a late read for A cannot unlock B: A -> B -> A -> B with every detail read held.
    await fresh({ aCallback: A_CALLBACK }, `/contacts/${A}/seller-call`);
    await scLoaded('Alpha');
    const hB1 = hold((r) => r.kind === 'detail' && r.contact === B);
    const hA2 = hold((r) => r.kind === 'detail' && r.contact === A);
    const hB2 = hold((r) => r.kind === 'detail' && r.contact === B);
    await go(`/contacts/${B}/seller-call`); await hB1.hit;
    await go(`/contacts/${A}/seller-call`); await hA2.hit;
    await go(`/contacts/${B}/seller-call`); await hB2.hit;
    writesAtNav = writes().length;
    hA2.release();                                   // A's late read lands while B is on screen
    await settle();
    await passText();
    await page.getByTestId('call-outcome-pass-reason').fill('late A read check');
    check('late A read while B is shown: B stays gated (Confirm Pass disabled)', await passConfirmDisabled());
    check('late A read while B is shown: B\'s warning never names A\'s callback', !(await passText()).includes('Oct 6'), await passText());
    await attemptPass();
    check('late A read while B is shown: attempting confirmation sends zero write requests', writes().length === writesAtNav, writes().slice(writesAtNav));
    hB1.release(); hB2.release();
    await until(async () => (await passText()) === BASE, 'B status known after its read');
    check('B\'s own read resolved: Confirm Pass is enabled', !(await passConfirmDisabled()));

    // ═══ Production scope, call-log class ENABLED: the real callers (Bones, PR #118) ═══
    // Every write the real pages send is decided by the REAL production-write-scope
    // with a Production config whose call-log class is ENABLED (Board #9 flags as
    // committed); a refusal is answered exactly as ghl-write answers it and
    // nothing lands.
    const prodWrites = () => log.filter((r) => r.kind === 'write');
    prodScope = true;
    try {
      // PS1 — Contact page Save call: result, note and last touch all pass.
      await fresh({}, `/contacts/${A}`);
      await contactLoaded('Alpha');
      let p0 = prodWrites().length;
      await save('Spoke with Seller', 'Production scope check.');
      await until(async () => (await page.getByTestId('call-log-done').count()) === 1, 'prod save done');
      check('Production scope: Contact page Save call passes (result, note, last touch), nothing refused',
        JSON.stringify(prodWrites().slice(p0).map((r) => [r.op, !!r.refused])) === JSON.stringify([['contact.callLogResult', false], ['note.create', false], ['contact.lastCallAttempt', false]]),
        prodWrites().slice(p0).map((r) => [r.op, r.refused]));

      // PS2 — Contact page Set Callback (explicit op) passes, with its note and touch.
      p0 = prodWrites().length;
      await page.getByRole('button', { name: 'Set Callback', exact: true }).first().click();
      await page.locator('input[type="datetime-local"]').fill('2026-10-09T14:30');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await until(async () => (await text()).includes('Callback: Oct 9, 2:30 PM'), 'prod callback display');
      check('Production scope: Contact page Set Callback uses contact.explicitCallback and passes with its note and touch',
        JSON.stringify(prodWrites().slice(p0).map((r) => [r.op, !!r.refused])) === JSON.stringify([['contact.explicitCallback', false], ['note.create', false], ['contact.lastCallAttempt', false]])
        && db[A].fields.get(F.callbackDatetimePrecise) === '2026-10-09T19:30:00.000Z', prodWrites().slice(p0).map((r) => [r.op, r.refused]));

      // PS3 — Contact page Clear Callback (explicit op) passes; nothing else is written.
      p0 = prodWrites().length;
      await page.getByRole('button', { name: 'Change Callback', exact: true }).click();
      await page.getByRole('button', { name: 'Clear', exact: true }).click();
      await until(async () => !(await text()).includes('Callback: Oct 9'), 'prod callback cleared');
      check('Production scope: Contact page Clear Callback is one explicit-callback write and passes',
        JSON.stringify(prodWrites().slice(p0).map((r) => [r.op, !!r.refused, r.args && r.args.value])) === JSON.stringify([['contact.explicitCallback', false, null]])
        && !db[A].fields.has(F.callbackDatetimePrecise), prodWrites().slice(p0).map((r) => [r.op, r.refused]));

      // PS4 — Seller Call Follow-Up: refused at its FIRST write; nothing lands.
      await fresh({}, `/contacts/${B}/seller-call`);
      await scLoaded('Bravo');
      const notesBefore = db[B].notes.length;
      p0 = prodWrites().length;
      await recordFollowUp('2026-10-06T10:00');
      await until(async () => (await page.getByTestId('call-outcome-error').count()) === 1, 'follow-up refused');
      await settle();
      const fu = prodWrites().slice(p0);
      check('Production scope: Seller Call Follow-Up is refused at its first write (generic contact.callback) and attempts nothing more',
        JSON.stringify(fu.map((r) => [r.op, !!r.refused])) === JSON.stringify([['contact.callback', true]]), fu.map((r) => [r.op, r.refused]));
      check('Production scope: Seller Call Follow-Up landed nothing (no callback, no note, no touch, no ledger)',
        !db[B].fields.has(F.callbackDatetimePrecise) && db[B].notes.length === notesBefore && !db[B].fields.has(F.lastCallAttemptPrecise));

      // PS5 — Seller Call Pass: its outcome ledger note is refused first; nothing lands.
      p0 = prodWrites().length;
      await passText();
      await page.getByTestId('call-outcome-pass-reason').fill('production scope check');
      await page.getByTestId('call-outcome-pass-confirm').click();
      await settle(); await settle();
      const ps = prodWrites().slice(p0);
      check('Production scope: Seller Call Pass is refused at its ledger note and lands nothing',
        JSON.stringify(ps.map((r) => [r.op, !!r.refused])) === JSON.stringify([['note.create', true]]) && db[B].notes.length === notesBefore && !db[B].fields.has(F.lastCallAttemptPrecise),
        ps.map((r) => [r.op, r.refused]));
    } finally {
      prodScope = false;
    }

    // ═══ Contact page: Do Not Call, simplified (Brad 2026-10-04): a button that opens THIS contact
    // in GHL, and a read-only check of what GHL holds. No reason, no note — IAOS writes NOTHING. ═══
    const STOP = { status: 'permanent', message: 'STOP_KEYWORD' };
    const ON = { status: 'active', message: '' };
    const openDnc = async () => { await until(async () => (await page.getByTestId('dnc-open').count()) === 1, 'DNC button'); await page.getByTestId('dnc-open').click(); };
    const dncState = async (id) => (await page.getByTestId(id).count()) ? (await page.getByTestId(id).innerText()).trim() : null;
    const detailReadsFor = (id) => log.filter((r) => r.kind === 'detail' && r.contact === id).length;
    const checkGhl = async () => { const n = detailReadsFor(A) + detailReadsFor(B); await page.getByTestId('dnc-check').click(); await until(async () => detailReadsFor(A) + detailReadsFor(B) > n && (await page.getByTestId('dnc-check').isEnabled()), 'DNC check'); await settle(); };
    const notesNow = () => db[A].notes.length + db[B].notes.length;
    let dncWrites = 0;   // every write sent during this section (fresh() clears the log, so carry the count)
    const freshDnc = async (opts, to) => { dncWrites += W().length; await fresh(opts, to); };

    // D1 — the button opens THIS contact in GHL at once; no reason is asked for; nothing is written.
    await fresh({}, `/contacts/${A}`);
    await contactLoaded('Alpha');
    let d0 = W().length, n0 = notesNow();
    check('DNC: no DND in GHL -> no status line yet; the button says it opens GHL', (await page.getByTestId('dnc-status').count()) === 0 && (await dncState('dnc-open')) === 'Do Not Call (opens GHL)');
    await openDnc();
    await until(async () => handoffs.length > 0, 'GHL handoff');
    check('DNC: the button itself hands off to this exact contact in GHL', /\/contacts\/detail\/fixtureContactA$/.test(handoffs[handoffs.length - 1]), handoffs);
    check('DNC: the handoff says what to set in GHL, and that IAOS does not change DND itself',
      /Turn on Do Not Disturb there for Calls & Voicemails, Text Messages and Emails/.test((await dncState('dnc-handoff-opened')) || '') && /IAOS doesn't change Do Not Disturb itself/.test((await dncState('dnc-handoff-opened')) || ''));
    check('DNC: no reason field, no Retry, nothing "recorded"', (await page.locator('[data-testid="dnc"] textarea').count()) === 0 && (await page.getByTestId('dnc-retry').count()) === 0 && !/recorded/i.test((await dncState('dnc')) || ''));

    // D2 — Check GHL now before DND is set: says so; nothing written.
    await checkGhl();
    check('DNC check (no DND yet): reads GHL and says calls, SMS and email are not suppressed; contact stays on calling lists',
      (await dncState('dnc-status')) === "GHL doesn't show Do Not Disturb on calls, SMS or email. It stays on IAOS calling lists while calls are not suppressed.");

    // D3 — Brad sets DND in GHL (a seller STOP already on SMS): IAOS reads and shows it; DND untouched.
    db[A].dnd = { Call: ON, SMS: STOP, RCS: STOP, Email: ON };
    const dndBefore = JSON.stringify(db[A].dnd);
    await checkGhl();
    check('DNC check (all three set in GHL): shows calls, SMS and email suppressed and out of calling lists',
      (await dncState('dnc-status')) === 'GHL shows Do Not Disturb on calls, SMS and email. This contact is out of IAOS calling lists.');
    check('DNC: opening, handing off and checking wrote NOTHING (no note, no field, no DND) and left the STOP as is',
      W().length === d0 && notesNow() === n0 && JSON.stringify(db[A].dnd) === dndBefore, W().slice(d0));

    // D4 — only calls set: says which, and that calls alone take it off the lists.
    db[A].dnd = { Call: ON };
    await checkGhl();
    check('DNC check (only calls set): names what is and is not suppressed; out of calling lists',
      (await dncState('dnc-status')) === 'GHL shows Do Not Disturb on calls, not on SMS or email. This contact is out of IAOS calling lists.');

    // D5 — Close: the panel closes, the last reading stays, and still nothing was written.
    await page.getByTestId('dnc-close').click();
    await settle();
    check('DNC: Close closes the panel and keeps the last reading', (await page.getByTestId('dnc-panel').count()) === 0 && /on calls, not on SMS or email/.test((await dncState('dnc-status')) || '') && W().length === d0);

    // D6 — contact isolation: A's late answer never shows on B; B shows only B.
    await freshDnc({ aDnd: { Call: ON, SMS: ON, Email: ON } }, `/contacts/${A}`);
    await contactLoaded('Alpha');
    await openDnc();
    h = hold((r) => r.kind === 'detail' && r.contact === A);
    await page.getByTestId('dnc-check').click();
    await h.hit;
    await go(`/contacts/${B}`);
    await contactLoaded('Bravo');
    h.release();
    await settle(); await settle();
    check("DNC: A's check answering after moving to B shows nothing on B (B has no DND)",
      (await page.getByTestId('dnc-status').count()) === 0 && (await page.getByTestId('dnc-panel').count()) === 0, await dncState('dnc'));
    await openDnc();
    await until(async () => /\/contacts\/detail\/fixtureContactB$/.test(handoffs[handoffs.length - 1] || ''), 'B handoff');
    await checkGhl();
    check("DNC: on B, the handoff and the check are B's own",
      /\/contacts\/detail\/fixtureContactB$/.test(handoffs[handoffs.length - 1]) && (await dncState('dnc-status')) === "GHL doesn't show Do Not Disturb on calls, SMS or email. It stays on IAOS calling lists while calls are not suppressed.");

    // D7 — already suppressed in GHL when the page loads: shown without any click.
    await freshDnc({ aDnd: { Call: ON, SMS: STOP, Email: ON } }, `/contacts/${A}`);
    await contactLoaded('Alpha');
    await until(async () => (await page.getByTestId('dnc-status').count()) === 1, 'DNC status on load');
    check('DNC: GHL already holds all three -> shown on load; the button is still there', (await dncState('dnc-status')) === 'GHL shows Do Not Disturb on calls, SMS and email. This contact is out of IAOS calling lists.' && (await page.getByTestId('dnc-open').count()) === 1);

    // D8 — the read fails: says so; nothing written.
    await freshDnc({}, `/contacts/${A}`);
    await contactLoaded('Alpha');
    await openDnc();
    failNext.push((r) => r.kind === 'detail' && r.contact === A);
    await page.getByTestId('dnc-check').click();
    await until(async () => (await page.getByTestId('dnc-read-failed').count()) === 1, 'DNC read failed');
    check('DNC: a failed GHL read says so and asks to check again', /^Couldn't read this contact from GHL \(.*\)\. Check again\.$/.test(await dncState('dnc-read-failed')));

    // D9 — the whole Do Not Call section wrote nothing at all, in either contact.
    dncWrites += W().length;
    check('DNC: across every scenario above, IAOS sent no write of any kind', dncWrites === 0, dncWrites);

    check('no request left the machine', foreign.length === 0, foreign);
    check('no uncaught page errors', pageErrors.length === 0, pageErrors);
  } catch (e) {
    failures += 1;
    console.error(`ABORT  ${e && e.stack || e}`);
  }
  console.log(`\nB14-12 contact isolation: ${checks - failures}/${checks} checks passed${failures ? ` (failures=${failures})` : ''}`);
  await exit(failures ? 1 : 0);
}
main();
