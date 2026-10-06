/**
 * Board 15 / PR #131 (Bones, re-review of 808e105) -- durable call-log
 * ownership on the REAL contact page, across reloads, navigation and two
 * browser sessions. Lifecycle: docs/CALL_LOG_SAVE_LIFECYCLE.md.
 *
 * Offline. Vite serves scripts/harness/contact-isolation (the REAL
 * ContactWorkspace and CallLogControl with the real GHL and call-log clients)
 * in headless Chromium. Every /.netlify/functions request is answered here;
 * every write and every /call-log-barrier request goes through the REAL
 * durable call-log module (harness/current-offer-barrier-fixture.cjs), whose
 * state lives in Node -- so a reload and a second browser context see the same
 * records, as they would on the server.
 *
 * Each case checks what the page CLAIMS against what the fixture GHL STORES
 * (the result field, the call notes, the last touch) and the write counts.
 *   O1  Bones repro 1: saved but unverified -> reload -> a replacement result
 *   O2  Bones repro 2: pending save -> away and back -> competing save -> older completion
 *   O3  Bones repro 3: note landed, response pending -> reload -> duplicate note
 *   O4  two sessions
 *   O5  uncertainty at every step (result, note, last touch)
 *   O6  definite refusals (result, note)
 *   O7  repeated reconciliation
 *   O8  contact isolation
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
const F = getConfig('test').fields;
const HARNESS = '/scripts/harness/contact-isolation/index.html';
const NOTE_MARK = 'Call (reported by Brad in IAOS):';

let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}

// ── In-memory GHL: two contacts ──────────────────────────────────────────────
const A = 'fixtureContactA';
const B = 'fixtureContactB';
const FIRST = { [A]: 'Alpha', [B]: 'Bravo' };
let db;
function resetDb() {
  const contact = (id) => ({ id, first: FIRST[id], fields: new Map(), notes: [{ id: `${id}-n1`, body: `Seed note for ${FIRST[id]}`, dateAdded: '2026-09-30T12:00:00.000Z' }] });
  db = { [A]: contact(A), [B]: contact(B) };
}
const field = (c, id) => (c.fields.has(id) ? c.fields.get(id) : null);
const contactRow = (c) => ({ id: c.id, firstName: c.first, lastName: 'Fixture', phone: '+15555550100', email: '', address1: '', city: '', state: '', postalCode: '',
  dateAdded: '2026-09-01T00:00:00.000Z', tags: [], dndSettings: {}, motivationScore: null, dealScore: null, combinedScore: null, completenessScore: null,
  callbackDatetime: null, callbackDatetimePrecise: null, lastCallAttempt: field(c, F.lastCallAttemptPrecise), lastCallAttemptPrecise: field(c, F.lastCallAttemptPrecise),
  callDisposition: field(c, F.callDisposition), dispositionAt: null });
const detail = (c) => ({ contact: { id: c.id, firstName: c.first, lastName: 'Fixture', phone: '+15555550100', dndSettings: {}, customFields: [...c.fields].map(([id, value]) => ({ id, value })) } });
function applyWrite(op, target, args) {
  const c = db[target];
  if (!c) return false;
  switch (op) {
    case 'note.create': c.notes.push({ id: `${target}-n${c.notes.length + 1}`, body: args.body, dateAdded: new Date().toISOString() }); return true;
    case 'contact.callLogResult': c.fields.set(F.callDisposition, args.value); return true;
    case 'contact.lastCallAttempt': c.fields.set(F.lastCallAttempt, args.value); c.fields.set(F.lastCallAttemptPrecise, args.value); return true;
    default: return false;
  }
}
const stored = (c) => field(db[c], F.callDisposition);
const callNotes = (c) => db[c].notes.filter((n) => n.body.startsWith(NOTE_MARK));
const touched = (c) => field(db[c], F.lastCallAttemptPrecise);

const { createBarrierFixture } = require('./harness/current-offer-barrier-fixture.cjs');
const bf = createBarrierFixture({ contactOf: () => null, callLogRules: process.env.OLD_SERVER !== '1' });

let log = [];        // every functions request: { kind, op?, contact?, requestId?, action?, steps?, applied? }
let holds = [];
let failNext = [];
function hold(match, opts = {}) {
  let release; let onHit;
  const h = { match, ...opts, released: new Promise((r) => { release = r; }), hit: new Promise((r) => { onHit = r; }) };
  h.release = release; h.onHit = onHit; holds.push(h); return h;
}
function hitWithin(h, label, ms = 30000) {
  let timer;
  return Promise.race([h.hit, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out waiting for the held request: ${label}`)), ms); })]).finally(() => clearTimeout(timer));
}
const releaseAll = () => holds.forEach((h) => h.release());
function classify(url, method, post) {
  const u = new URL(url);
  const fn = u.pathname.replace('/.netlify/functions/', '');
  if (fn === 'ghl-write' && method === 'POST') return { kind: 'write', op: post.operation, contact: post.targetId, args: post.args, requestId: post.requestId };
  if (fn === 'call-log-barrier') return { kind: 'call-log', method, action: method === 'GET' ? 'status' : post && post.action, steps: post && post.steps, contact: method === 'GET' ? u.searchParams.get('contactId') : post && post.contactId };
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
    case 'ghl-opportunities': return { status: 200, body: { pipelineId: 'p', stages: [], opportunities: [] } };
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
    optimizeDeps: { entries: [HARNESS.slice(1)], include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] },
  });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const foreign = [];
  const pageErrors = [];
  const watchdog = setTimeout(() => { console.error('FAIL  the call-log ownership suite did not finish within 15 minutes -- stopped'); process.exit(1); }, 15 * 60_000);
  const exit = async (code) => { clearTimeout(watchdog); releaseAll(); await browser.close().catch(() => {}); await server.close().catch(() => {}); process.exit(code); };

  const routeHandler = async (route) => {
    const url = route.request().url();
    if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
    if (!url.includes('/.netlify/functions/')) { foreign.push(url); return route.abort(); }
    let post = null;
    try { post = route.request().postDataJSON(); } catch { post = null; }
    const method = route.request().method();
    const req = classify(url, method, post);
    log.push(req);
    const reply = (res) => route.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(res.body) });
    // A hold BEFORE the server handles the request (unless `afterServer` / `inApply`).
    const h = holds.find((x) => !x.used && x.match(req));
    if (h) { h.used = true; h.onHit(req); if (!h.afterServer && !h.inApply && !h.loseAnswer && !h.refuse && !h.failAfterSend) await h.released; }
    const fi = failNext.findIndex((p) => p(req));
    if (fi >= 0) { failNext.splice(fi, 1); return reply({ status: 500, body: { error: 'fixture: gateway failure, the server never saw it' } }); }
    if (req.kind === 'call-log') return reply(await bf.handleCallLog(method, url, post));
    if (req.kind === 'write') {
      const res = await bf.write({ operation: req.op, targetId: req.contact, requestId: req.requestId, contactId: req.contact, args: req.args },
        async () => {
          const ok = applyWrite(req.op, req.contact, req.args);
          req.applied = ok;
          if (h && h.inApply) await h.released;      // GHL has it; the server's handler has not finished (no outcome yet)
          return { confirmed: ok };
        },
        { refuse: h && h.refuse ? { status: 409, error: 'fixture: refused before sending' } : null, failAfterSend: !!(h && h.failAfterSend) });
      if (h && h.afterServer) await h.released;      // the server finished; the response is still on its way
      if (h && h.loseAnswer) return route.abort('failed');
      return reply(res);
    }
    return reply(answer(req));
  };

  try {
    const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Chicago' });
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Chicago' });
    for (const c of [ctx1, ctx2]) { await c.route(/gohighlevel\.com/, (r) => r.abort()); await c.route('**/*', routeHandler); }
    const page = await ctx1.newPage();
    const page2 = await ctx2.newPage();
    for (const p of [page, page2]) p.on('pageerror', (e) => pageErrors.push(String(e)));

    const until = async (fn, label, ms = 20000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(50); }
      throw new Error(`timed out waiting for: ${label}`);
    };
    const settle = (p = page) => p.waitForTimeout(500);
    const open = async (p, contact) => {
      await p.goto(`${base}${HARNESS}`);
      await p.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 });
      await p.evaluate((t) => window.__iaosNavigate(t), `/contacts/${contact}`);
      await until(async () => (await p.locator('body').innerText()).includes(`Seed note for ${FIRST[contact]}`), `${contact} loaded`);
      await until(async () => (await p.getByTestId('call-log-checking').count()) === 0, `${contact} ownership checked`);
    };
    const go = (p, to) => p.evaluate((t) => window.__iaosNavigate(t), to);
    const fresh = async (contact = A) => {
      resetDb(); log = []; holds = []; failNext = []; bf.reset();
      await open(page, contact);
    };
    const tid = (p, id) => p.getByTestId(id);
    const has = async (p, id) => (await tid(p, id).count()) > 0;
    const textOf = async (p, id) => ((await has(p, id)) ? (await tid(p, id).first().innerText()).trim() : '');
    const slug = (r) => r.replace(/\s+/g, '-').toLowerCase();
    const choose = (p, r) => tid(p, `call-log-result-${slug(r)}`).click();
    const saveCall = async (p, r, notes) => { await choose(p, r); if (notes !== undefined) await tid(p, 'call-log-notes').fill(notes); await tid(p, 'call-log-save').click(); };
    const writes = (op, contact) => log.filter((x) => x.kind === 'write' && (!op || x.op === op) && (!contact || x.contact === contact));
    const begins = (contact) => log.filter((x) => x.kind === 'call-log' && x.action === 'begin' && (!contact || x.contact === contact));
    /* ONLY=O1,O3 runs just those sections (used for the negative controls). */
    const want = (k) => !process.env.ONLY || process.env.ONLY.split(',').includes(k);
    let h;
    const tryCompeting = async (p, r) => {
      // Every way to start another save: click the result (forced past disabled) and Save (forced).
      await tid(p, `call-log-result-${slug(r)}`).click({ force: true }).catch(() => {});
      await tid(p, 'call-log-save').click({ force: true }).catch(() => {});
      await settle(p);
    };

    // ═══ O1 — saved but unverified -> reload -> replacement result ═══════════
    if (want('O1')) {
    await fresh();
    failNext.push((r) => r.kind === 'detail' && r.contact === A);   // the readback after the confirmed result fails
    await saveCall(page, 'Spoke with Seller', 'Wants 30 days.');
    await until(() => has(page, 'call-log-saved-unverified'), 'O1 unverified');
    check('O1 setup: the result is stored, nothing else (GHL: result only)', stored(A) === 'Spoke with Seller' && callNotes(A).length === 0 && touched(A) === null);
    await open(page, A);                                             // RELOAD
    check('O1 after a reload the page shows the unfinished save (not a fresh form)', /partly saved/.test(await textOf(page, 'call-log-blocked')) && !/reload/i.test(await textOf(page, 'call-log-blocked')), await textOf(page, 'call-log-blocked'));
    check('O1 after a reload Save and the results are disabled', (await tid(page, 'call-log-save').isDisabled()) && (await tid(page, 'call-log-result-no-answer').isDisabled()));
    const w1 = log.length;
    await tryCompeting(page, 'No Answer');
    check('O1 a replacement result cannot start: no reservation, no write', log.slice(w1).every((x) => x.kind !== 'write' && !(x.kind === 'call-log' && x.action === 'begin')), log.slice(w1).map((x) => x.kind + ':' + (x.action || x.op || '')));
    check('O1 GHL still holds only the original result; one result write', stored(A) === 'Spoke with Seller' && writes('contact.callLogResult').length === 1);
    await tid(page, 'call-log-check-again').click();
    await until(() => has(page, 'call-log-done'), 'O1 finished');
    const reserved1 = begins(A)[0].steps;
    check('O1 Check again finishes it with the ORIGINAL note and touch ids; the page says saved and GHL agrees (one call note, last touch set)',
      (await textOf(page, 'call-log-done')) === 'Saved: Spoke with Seller.'
      && writes('note.create')[0].requestId === reserved1[1].requestId && writes('contact.lastCallAttempt')[0].requestId === reserved1[2].requestId
      && callNotes(A).length === 1 && callNotes(A)[0].body === `${NOTE_MARK} Spoke with Seller\nWants 30 days.` && touched(A) !== null,
      { notes: callNotes(A).map((n) => n.body), touch: touched(A), ids: writes().map((w) => w.requestId) });
    }

    // ═══ O2 — pending -> away and back -> competing save -> older completion ═
    if (want('O2')) {
    await fresh();
    h = hold((r) => r.kind === 'write' && r.op === 'contact.callLogResult' && r.contact === A);
    await saveCall(page, 'Spoke with Seller');
    await hitWithin(h, 'O2 result');
    await go(page, '/'); await settle();                             // away (the contact page unmounts) ...
    await go(page, `/contacts/${A}`);                                // ... and back, in the same app
    await until(async () => (await page.locator('body').innerText()).includes('Seed note for Alpha'), 'O2 back');
    await until(async () => (await tid(page, 'call-log-checking').count()) === 0, 'O2 checked');
    check('O2 back on the contact: the pending save is shown and blocks', /may still be on its way/.test(await textOf(page, 'call-log-blocked')) && (await tid(page, 'call-log-save').isDisabled()), await textOf(page, 'call-log-blocked'));
    const w2 = log.length;
    await tryCompeting(page, 'Not Interested');
    check('O2 a competing save cannot start while the older one is pending', log.slice(w2).every((x) => x.kind !== 'write' && x.action !== 'begin'));
    h.release();                                                     // the older request completes (its page is gone; the attempt runs on)
    await until(() => touched(A) !== null, 'O2 older attempt finished');
    await tid(page, 'call-log-check-again').click();
    await until(async () => !(await has(page, 'call-log-blocked')), 'O2 cleared');
    check('O2 the older completion stands alone: one result, one note, one touch -- and the page now allows a new save',
      stored(A) === 'Spoke with Seller' && writes('contact.callLogResult').filter((w) => w.applied).length === 1 && callNotes(A).length === 1
      && !(await tid(page, 'call-log-result-no-answer').isDisabled()), { results: writes('contact.callLogResult').length, notes: callNotes(A).length });

    // O2r — the same, but the page is RELOADED (its code is gone): the older result lands; Check again finishes it with the ORIGINAL ids.
    await fresh();
    h = hold((r) => r.kind === 'write' && r.op === 'contact.callLogResult' && r.contact === A);
    await saveCall(page, 'Spoke with Seller', 'Before reload.');
    await hitWithin(h, 'O2r result');
    await open(page, A);                                             // reload while the result is pending
    await tryCompeting(page, 'Not Interested');
    check('O2r after a reload the pending save blocks a competing one', begins(A).length === 1 && writes().length === 1);
    h.release();
    await until(() => stored(A) === 'Spoke with Seller', 'O2r older result landed');
    await settle();
    await tid(page, 'call-log-check-again').click();
    await until(() => has(page, 'call-log-done'), 'O2r finished');
    check('O2r Check again finishes the older save with its ORIGINAL ids: one result, one note, one touch',
      writes('note.create').length === 1 && writes('note.create')[0].requestId === begins(A)[0].steps[1].requestId && callNotes(A).length === 1
      && callNotes(A)[0].body === `${NOTE_MARK} Spoke with Seller\nBefore reload.` && writes('contact.callLogResult').length === 1);

    // O2b — the older request is withdrawn by Check again before it arrives; it lands LATER and sends nothing.
    await fresh();
    h = hold((r) => r.kind === 'write' && r.op === 'contact.callLogResult' && r.contact === A);
    await saveCall(page, 'Spoke with Seller');
    await hitWithin(h, 'O2b result');
    await open(page, A);
    await tid(page, 'call-log-check-again').click();
    await until(() => has(page, 'call-log-not-saved'), 'O2b withdrawn');
    check('O2b Check again: the undelivered older save is withdrawn -- "not saved, nothing sent" -- and GHL agrees', /was not saved — nothing was sent/.test(await textOf(page, 'call-log-not-saved')) && stored(A) === null);
    await saveCall(page, 'Not Interested');
    await until(() => has(page, 'call-log-done'), 'O2b newer saved');
    h.release();                                                     // the older request finally reaches the server
    await until(() => writes('contact.callLogResult').length === 2, 'O2b older arrived');
    await settle(); await settle();
    check('O2b the older completion sends nothing: GHL holds the newer result; one applied result write; one call note',
      stored(A) === 'Not Interested' && writes('contact.callLogResult').filter((w) => w.applied).length === 1 && callNotes(A).length === 1 && callNotes(A)[0].body === `${NOTE_MARK} Not Interested`,
      { stored: stored(A), applied: writes('contact.callLogResult').filter((w) => w.applied).length, notes: callNotes(A).map((n) => n.body) });
    check('O2b the newer save stays "Saved" on screen', (await textOf(page, 'call-log-done')) === 'Saved: Not Interested.');
    }

    // ═══ O3 — note landed, response pending -> reload -> duplicate note ════════
    if (want('O3')) {
    await fresh();
    h = hold((r) => r.kind === 'write' && r.op === 'note.create' && r.contact === A, { inApply: true });
    await saveCall(page, 'Voicemail', 'Left a message.');
    await hitWithin(h, 'O3 note');
    await until(() => callNotes(A).length === 1, 'O3 note landed in GHL');
    await open(page, A);                                             // RELOAD while the note's response is pending
    check('O3 after a reload: unresolved, "may still reach GHL"; Save disabled', /may still reach GHL/.test(await textOf(page, 'call-log-blocked')) && (await tid(page, 'call-log-save').isDisabled()), await textOf(page, 'call-log-blocked'));
    for (let i = 0; i < 2; i++) { await tid(page, 'call-log-check-again').click(); await settle(); }
    // While the original note's handler still holds the contact's write lock, Check again answers "in progress".
    check('O3 Check again while it may still land changes nothing and re-sends nothing', writes('note.create').length === 1 && callNotes(A).length === 1
      && /may still reach GHL|another write for this contact is in progress/i.test(await textOf(page, 'call-log-blocked')), await textOf(page, 'call-log-blocked'));
    await tryCompeting(page, 'Voicemail');
    check('O3 no duplicate note can be started', writes('note.create').length === 1 && callNotes(A).length === 1);
    h.release();                                                     // the original note's handler finishes (confirmed)
    await until(async () => (await bf.callLogStatus(A)).kind === 'resumable', 'O3 note confirmed');
    await tid(page, 'call-log-check-again').click();
    await until(() => has(page, 'call-log-done'), 'O3 finished');
    check('O3 finishing sends ONLY the last touch, with its original id; GHL holds exactly one call note',
      writes('note.create').length === 1 && writes('contact.lastCallAttempt').length === 1 && writes('contact.lastCallAttempt')[0].requestId === begins(A)[0].steps[2].requestId
      && callNotes(A).length === 1 && (await textOf(page, 'call-log-done')) === 'Saved: Voicemail.', { notes: callNotes(A).length, touches: writes('contact.lastCallAttempt').length });
    }

    // ═══ O4 — two sessions ════════════════════════════════════════════════════
    if (want('O4')) {
    await fresh();
    h = hold((r) => r.kind === 'write' && r.op === 'contact.callLogResult' && r.contact === A);
    await saveCall(page, 'Spoke with Seller');
    await hitWithin(h, 'O4 result');
    await open(page2, A);
    check('O4 the second session sees the first session\'s save and is blocked', /may still be on its way/.test(await textOf(page2, 'call-log-blocked')) && (await tid(page2, 'call-log-save').isDisabled()));
    const w4 = log.length;
    await tryCompeting(page2, 'No Answer');
    check('O4 the second session cannot start a save', log.slice(w4).every((x) => x.kind !== 'write' && x.action !== 'begin'));
    h.release();
    await until(() => has(page, 'call-log-done'), 'O4 first session finished');
    await tid(page2, 'call-log-check-again').click();
    await until(async () => !(await has(page2, 'call-log-blocked')), 'O4 second session cleared');
    check('O4 after the first session finishes, the second is free; GHL holds one result, one note, one touch',
      !(await tid(page2, 'call-log-result-no-answer').isDisabled()) && stored(A) === 'Spoke with Seller' && callNotes(A).length === 1 && writes('contact.lastCallAttempt').length === 1);
    }

    // ═══ O5 — uncertainty at every step ═══════════════════════════════════════
    if (want('O5')) {
    /* failAfterSend: GHL applied the write and the SERVER lost GHL's answer --
       the server records the step as uncertain. It may still land; nothing
       clears it and nothing after it is ever sent. */
    await fresh();
    hold((r) => r.kind === 'write' && r.op === 'contact.callLogResult', { failAfterSend: true });
    await saveCall(page, 'No Answer');
    await until(() => has(page, 'call-log-not-saved'), 'O5 result uncertain');
    check('O5 result uncertain: "not confirmed… may still reach GHL" -- never "saved", never "nothing written"; GHL has it',
      /Result not confirmed/.test(await textOf(page, 'call-log-not-saved')) && /may still reach GHL/.test(await textOf(page, 'call-log-not-saved')) && stored(A) === 'No Answer');
    await until(async () => /may still reach GHL/.test(await textOf(page, 'call-log-blocked')), 'O5 blocked');
    await tryCompeting(page, 'Voicemail');
    for (let i = 0; i < 2; i++) { await tid(page, 'call-log-check-again').click(); await settle(); }
    check('O5 nothing more is sent after an uncertain result (no note, no touch, no second result), whatever is pressed', writes().length === 1 && callNotes(A).length === 0);
    await open(page, A);
    check('O5 a reload still shows it unresolved', /may still reach GHL/.test(await textOf(page, 'call-log-blocked')));

    await fresh();
    hold((r) => r.kind === 'write' && r.op === 'note.create', { failAfterSend: true });
    await saveCall(page, 'No Answer');
    await until(() => has(page, 'call-log-partial'), 'O5 note uncertain');
    check('O5 note uncertain: "may or may not have reached GHL"; GHL has one note; no touch sent',
      /may or may not have reached GHL/.test(await textOf(page, 'call-log-partial')) && callNotes(A).length === 1 && writes('contact.lastCallAttempt').length === 0);
    await until(async () => /call note/.test(await textOf(page, 'call-log-blocked')), 'O5 note blocked');
    for (let i = 0; i < 2; i++) { await tid(page, 'call-log-check-again').click(); await settle(); }
    check('O5 Check again on an uncertain note sends nothing (no second note, no touch)', writes('note.create').length === 1 && writes('contact.lastCallAttempt').length === 0 && callNotes(A).length === 1);

    await fresh();
    hold((r) => r.kind === 'write' && r.op === 'contact.lastCallAttempt', { failAfterSend: true });
    await saveCall(page, 'No Answer');
    await until(() => has(page, 'call-log-partial'), 'O5 touch uncertain');
    check('O5 last touch uncertain: "may or may not have been updated"; one note; one touch request',
      /may or may not have been updated/.test(await textOf(page, 'call-log-partial')) && callNotes(A).length === 1 && writes('contact.lastCallAttempt').length === 1);
    await until(async () => /last-touch time/.test(await textOf(page, 'call-log-blocked')), 'O5 touch blocked');
    check('O5 the contact stays blocked naming the last-touch time', (await tid(page, 'call-log-save').isDisabled()));

    /* loseAnswer: the server CONFIRMED the result; only the browser lost the
       answer. The page cannot claim it saved; the server's records show it
       partly saved, and Check again finishes it with the original ids. */
    await fresh();
    hold((r) => r.kind === 'write' && r.op === 'contact.callLogResult', { loseAnswer: true });
    await saveCall(page, 'Voicemail');
    await until(() => has(page, 'call-log-not-saved'), 'O5 answer lost');
    await until(async () => /partly saved/.test(await textOf(page, 'call-log-blocked')), 'O5 partly saved');
    check('O5 a lost answer is not claimed as saved; the server\'s records show the result landed (partly saved)',
      /Result not confirmed/.test(await textOf(page, 'call-log-not-saved')) && stored(A) === 'Voicemail' && callNotes(A).length === 0);
    await tid(page, 'call-log-check-again').click();
    await until(() => has(page, 'call-log-done'), 'O5 lost answer finished');
    check('O5 Check again finishes it: one result, one note, one touch, original ids',
      writes('contact.callLogResult').length === 1 && callNotes(A).length === 1 && writes('note.create')[0].requestId === begins(A)[0].steps[1].requestId && touched(A) !== null);
    }

    // ═══ O6 — definite refusals ═══════════════════════════════════════════════
    if (want('O6')) {
    await fresh();
    hold((r) => r.kind === 'write' && r.op === 'contact.callLogResult', { refuse: true }).release();
    await saveCall(page, 'No Answer');
    await until(() => has(page, 'call-log-not-saved'), 'O6 result refused');
    check('O6 a result the server refused before sending: "not saved — nothing was sent"; GHL agrees; Save is free again',
      /Result not saved — nothing was sent/.test(await textOf(page, 'call-log-not-saved')) && stored(A) === null && !(await has(page, 'call-log-blocked')));

    await fresh();
    hold((r) => r.kind === 'write' && r.op === 'note.create', { refuse: true }).release();
    await saveCall(page, 'Spoke with Seller', 'Roof is new.');
    await until(() => has(page, 'call-log-retry-note'), 'O6 note refused');
    check('O6 a note the server refused before sending: "notes not saved", Retry offered; GHL has the result and no note',
      /Result saved; notes not saved/.test(await textOf(page, 'call-log-partial')) && stored(A) === 'Spoke with Seller' && callNotes(A).length === 0);
    await tid(page, 'call-log-retry-note').click();
    await until(() => has(page, 'call-log-done'), 'O6 retried');
    check('O6 Retry notes writes the note once (a new reservation) and the last touch', callNotes(A).length === 1 && callNotes(A)[0].body === `${NOTE_MARK} Spoke with Seller\nRoof is new.` && touched(A) !== null);
    }

    // ═══ O7 — repeated reconciliation ══════════════════════════════════════════
    if (want('O7')) {
    await fresh();
    failNext.push((r) => r.kind === 'detail' && r.contact === A);
    await saveCall(page, 'Voicemail');
    await until(() => has(page, 'call-log-saved-unverified'), 'O7 unverified');
    await open(page, A); await open(page2, A);
    await Promise.all([tid(page, 'call-log-check-again').click(), tid(page2, 'call-log-check-again').click()]);
    await until(async () => (await has(page, 'call-log-done')) || (await has(page2, 'call-log-done')), 'O7 one finished');
    await settle(); await settle();
    for (const p of [page, page2]) if (await has(p, 'call-log-check-again')) { await tid(p, 'call-log-check-again').click(); await settle(p); }
    check('O7 two sessions pressing Check again together: one note and one touch reach GHL', callNotes(A).length === 1 && writes('contact.lastCallAttempt').filter((w) => w.applied).length === 1 && touched(A) !== null,
      { notes: callNotes(A).length, touches: writes('contact.lastCallAttempt').map((w) => w.applied) });
    check('O7 both sessions end clear (Save free)', !(await has(page, 'call-log-blocked')) && !(await has(page2, 'call-log-blocked')));
    }

    // ═══ O8 — contact isolation ═══════════════════════════════════════════════
    if (want('O8')) {
    await fresh();
    failNext.push((r) => r.kind === 'detail' && r.contact === A);
    await saveCall(page, 'Spoke with Seller');
    await until(() => has(page, 'call-log-saved-unverified'), 'O8 A unverified');
    await go(page, `/contacts/${B}`);
    await until(async () => (await page.locator('body').innerText()).includes('Seed note for Bravo'), 'O8 B loaded');
    await until(async () => (await tid(page, 'call-log-checking').count()) === 0, 'O8 B checked');
    check('O8 B is not blocked by A\'s unfinished save, and shows none of A\'s state', !(await has(page, 'call-log-blocked')) && !(await has(page, 'call-log-saved-unverified')));
    await saveCall(page, 'No Answer');
    await until(() => has(page, 'call-log-done'), 'O8 B saved');
    check('O8 B saves normally; A is untouched in GHL', stored(B) === 'No Answer' && callNotes(B).length === 1 && stored(A) === 'Spoke with Seller' && callNotes(A).length === 0);
    await go(page, `/contacts/${A}`);
    await until(async () => /partly saved/.test(await textOf(page, 'call-log-blocked')), 'O8 A blocked again');
    check('O8 back on A: A\'s unfinished save is still shown', true);
    }

    check('no request left the machine', foreign.length === 0, foreign);
    check('no page errors', pageErrors.length === 0, pageErrors);
  } catch (e) {
    console.error(e);
    failures += 1;
    releaseAll();
  }
  console.log(`\nCall-log ownership (browser): ${checks - failures}/${checks} checks passed`);
  await exit(failures ? 1 : 0);
}
main();
