/**
 * Board 15 / PR #131 -- durable call-log OPERATIONS on the REAL contact page
 * (Bones-approved lifecycle v3, #issuecomment-6023481488), across two browser
 * sessions, reloads and navigation.
 *
 * Offline. Vite serves scripts/harness/contact-isolation (the REAL
 * ContactWorkspace and CallLogControl with the real GHL and call-log clients)
 * in headless Chromium. Every /.netlify/functions request is answered here;
 * every write and every /call-log-barrier request goes through the REAL server
 * module (harness/current-offer-barrier-fixture.cjs), whose state lives in
 * Node -- so a reload and a second browser context see the same records.
 *
 * Every case checks what the page CLAIMS against what the fixture GHL STORES
 * (result field, call notes, last touch) and the write counts. Case ids follow
 * the approved acceptance matrix (section 12).
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

let log = [];
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
  if (fn === 'call-log-barrier') return { kind: 'call-log', method, action: method === 'GET' ? 'status' : post && post.action, operationId: method === 'GET' ? u.searchParams.get('operationId') : post && post.operationId, contact: method === 'GET' ? u.searchParams.get('contactId') : post && post.contactId };
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

/* A wait that never resolves empties the event loop and Node exits 0 mid-suite: that must FAIL, never pass. */
let finished = false;
process.on('exit', (code) => { if (!finished && code === 0) { console.error('FAIL the suite ended before it finished (a wait never resolved)'); process.exitCode = 1; } });

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
  const exit = async (code) => { clearTimeout(watchdog); releaseAll(); finished = true; await browser.close().catch(() => {}); await server.close().catch(() => {}); process.exit(code); };

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
    // A plain hold delays the request BEFORE the server handles it; the others act at the server.
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
      req.response = res.body;
      if (h && h.afterServer) await h.released;      // the server finished; the RESPONSE is held
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
    const fresh = async (contact = A) => { resetDb(); log = []; holds = []; failNext = []; bf.reset(); await open(page, contact); };
    const tid = (p, id) => p.getByTestId(id);
    const has = async (p, id) => (await tid(p, id).count()) > 0;
    const textOf = async (p, id) => ((await has(p, id)) ? (await tid(p, id).first().innerText()).trim() : '');
    const slug = (r) => r.replace(/\s+/g, '-').toLowerCase();
    const choose = (p, r) => tid(p, `call-log-result-${slug(r)}`).click();
    const saveCall = async (p, r, notes) => { await choose(p, r); if (notes !== undefined) await tid(p, 'call-log-notes').fill(notes); await tid(p, 'call-log-save').click(); };
    const writes = (op, contact) => log.filter((x) => x.kind === 'write' && (!op || x.op === op) && (!contact || x.contact === contact));
    const applied = (op, contact) => writes(op, contact).filter((w) => w.applied);
    const begins = (contact) => log.filter((x) => x.kind === 'call-log' && x.action === 'begin' && (!contact || x.contact === contact));
    const opOf = (contact, i = 0) => begins(contact)[i].operationId;
    const oneEach = (c) => applied('contact.callLogResult', c).length === 1 && callNotes(c).length === 1 && applied('contact.lastCallAttempt', c).length === 1;
    const attemptKeys = () => [...bf.records.keys()].filter((k) => k.startsWith('call-log/v3/attempt/')).length;
    const tryCompeting = async (p, r) => {
      await tid(p, `call-log-result-${slug(r)}`).click({ force: true }).catch(() => {});
      await tid(p, 'call-log-save').click({ force: true }).catch(() => {});
      await settle(p);
    };
    const want = (k) => !process.env.ONLY || process.env.ONLY.split(',').includes(k);
    let h;

    // ═══ D1 (Bones's exact order) and D2 (Jeff's variant) ═════════════════════
    for (const ordering of ['D1', 'D2']) {
      if (!want(ordering)) continue;
      await fresh();
      // B1 saves; its note will be refused before sending, with the RESPONSE held.
      h = hold((r) => r.kind === 'write' && r.op === 'note.create' && r.contact === A, { refuse: true, afterServer: true });
      await saveCall(page, 'Spoke with Seller', 'Roof is new.');
      await hitWithin(h, `${ordering} B1 note`);
      await until(async () => { const s = await bf.callLogStatus(A); return s.state === 'open' && s.next.action === 'retry'; }, `${ordering} refusal recorded`);
      // B2 opens the contact and presses Check again; it receives Retry notes.
      await open(page2, A);
      if (await has(page2, 'call-log-check-again')) await tid(page2, 'call-log-check-again').click();
      await until(() => has(page2, 'call-log-retry-note'), `${ordering} B2 offered Retry notes`);
      check(`${ordering} B2: Check again shows the partial save and offers Retry notes`, /Result saved; notes not saved/.test(await textOf(page2, 'call-log-partial')));
      if (ordering === 'D1') {
        h.release();                                    // B1's refusal response released: both browsers now show Retry notes
        await until(() => has(page, 'call-log-retry-note'), 'D1 B1 offered Retry notes');
        check('D1 both browsers show Retry notes', (await has(page, 'call-log-retry-note')) && (await has(page2, 'call-log-retry-note')));
      }
      await tid(page2, 'call-log-retry-note').click();  // B2 retries and completes
      await until(() => has(page2, 'call-log-done'), `${ordering} B2 completed`);
      check(`${ordering} B2 completes: "Saved" only after the recorded completion; GHL 1 result, 1 note, 1 touch`,
        (await textOf(page2, 'call-log-done')) === 'Saved: Spoke with Seller.' && oneEach(A) && callNotes(A)[0].body === `${NOTE_MARK} Spoke with Seller\nRoof is new.`,
        { notes: callNotes(A).map((n) => n.body), results: applied('contact.callLogResult', A).length, touches: applied('contact.lastCallAttempt', A).length });
      if (ordering === 'D2') {
        h.release();                                    // B1's held refusal is seen only now
        await until(async () => (await has(page, 'call-log-done')) || (await has(page, 'call-log-retry-note')), 'D2 B1 settled');
        check('D2 B1 reads ITS operation and shows the recorded completion; it never offers Retry', (await textOf(page, 'call-log-done')) === 'Saved: Spoke with Seller.' && !(await has(page, 'call-log-retry-note')));
      } else {
        const keys0 = attemptKeys();
        const w0 = log.filter((x) => x.kind === 'write').length;
        await tid(page, 'call-log-retry-note').click();   // B1's STALE Retry notes
        await until(() => has(page, 'call-log-done'), 'D1 B1 stale retry answered');
        check('D1 B1\'s stale Retry notes creates nothing (no attempt, no write) and shows the recorded outcome "Saved"',
          attemptKeys() === keys0 && log.filter((x) => x.kind === 'write').length === w0 && (await textOf(page, 'call-log-done')) === 'Saved: Spoke with Seller.');
      }
      check(`${ordering} end state: exactly one result, one call note, one last touch for the operation`, oneEach(A) && stored(A) === 'Spoke with Seller' && touched(A) !== null);
    }

    // ═══ R-2 / E-1 — reload after "saved but unverified" ═════════════════════
    if (want('R')) {
      await fresh();
      failNext.push((r) => r.kind === 'detail' && r.contact === A);
      await saveCall(page, 'Spoke with Seller', 'Wants 30 days.');
      await until(() => has(page, 'call-log-saved-unverified'), 'R unverified');
      await open(page, A);
      check('E-1 after a reload: the call is shown partly saved; Save and results disabled; no reload advice',
        /partly saved: its call note has not been sent yet/.test(await textOf(page, 'call-log-blocked')) && (await tid(page, 'call-log-save').isDisabled()) && !/reload/i.test(await textOf(page, 'call-log-blocked')));
      const w = log.length;
      await tryCompeting(page, 'No Answer');
      check('E-1 a replacement call cannot start: no begin, no write', log.slice(w).every((x) => x.kind !== 'write' && x.action !== 'begin'));
      await tid(page, 'call-log-check-again').click();
      await until(() => has(page, 'call-log-done'), 'R finished');
      const op = opOf(A);
      check('E-1 Check again finishes with the DERIVED original ids (note-1, touch-1); 1/1/1; "Saved"',
        writes('note.create')[0].requestId === `${op}-note-1` && writes('contact.lastCallAttempt')[0].requestId === `${op}-touch-1` && oneEach(A)
        && (await textOf(page, 'call-log-done')) === 'Saved: Spoke with Seller.');
    }

    // ═══ R-1 / N-1 / AB-3 / AB-4 — an undelivered result; Call A, then Call B ══
    if (want('AB')) {
      await fresh();
      h = hold((r) => r.kind === 'write' && r.op === 'contact.callLogResult' && r.contact === A);
      await saveCall(page, 'Spoke with Seller');
      await hitWithin(h, 'AB result A');
      await open(page2, A);
      check('R-1 another session sees the pending call: "may still be on its way"; Save disabled', /may still be on its way/.test(await textOf(page2, 'call-log-blocked')) && (await tid(page2, 'call-log-save').isDisabled()));
      await tid(page2, 'call-log-check-again').click();
      await until(() => has(page2, 'call-log-not-saved'), 'R-1 withdrawn');
      check('R-1 Check again withdraws the undelivered result: "not saved — nothing was sent"; GHL agrees', /was not saved — nothing was sent/.test(await textOf(page2, 'call-log-not-saved')) && stored(A) === null);
      await saveCall(page2, 'Not Interested', 'Call B');
      await until(() => has(page2, 'call-log-done'), 'Call B saved');
      h.release();                                       // Call A's delayed result finally arrives
      await until(async () => (await has(page, 'call-log-not-saved')) || (await has(page, 'call-log-done')), 'AB A settled on page 1');
      await settle(); await settle();
      check('AB-3 Call A\'s stale result changes nothing: GHL holds Call B only (1 applied result, 1 note); A\'s request got operation_not_current',
        stored(A) === 'Not Interested' && applied('contact.callLogResult', A).length === 1 && callNotes(A).length === 1
        && writes('contact.callLogResult').some((w) => w.response && w.response.code === 'operation_not_current'), { stored: stored(A), notes: callNotes(A).map((n) => n.body) });
      check('AB-4 page 1 (Call A) shows A\'s RECORDED outcome -- not saved -- never "Saved"', /was not saved — nothing was sent/.test(await textOf(page, 'call-log-not-saved')) && !(await has(page, 'call-log-done')));
      check('AB-3 Call B\'s page still shows B saved', (await textOf(page2, 'call-log-done')) === 'Saved: Not Interested.');
    }

    // ═══ F-6 — note landed, response pending, reload ══════════════════════════
    if (want('F6')) {
      await fresh();
      h = hold((r) => r.kind === 'write' && r.op === 'note.create' && r.contact === A, { inApply: true });
      await saveCall(page, 'Voicemail', 'Left a message.');
      await hitWithin(h, 'F6 note');
      await until(() => callNotes(A).length === 1, 'F6 note landed');
      await open(page, A);
      check('F-6 after a reload: the note "was sent and is not confirmed yet"; Save disabled',
        /call note for "Voicemail" was sent and is not confirmed yet/.test(await textOf(page, 'call-log-blocked')) && (await tid(page, 'call-log-save').isDisabled()), await textOf(page, 'call-log-blocked'));
      await tryCompeting(page, 'Voicemail');
      await tid(page, 'call-log-check-again').click(); await settle();
      check('F-6 nothing is re-sent while it may still land', writes('note.create').length === 1 && callNotes(A).length === 1);
      h.release();
      await until(async () => { const s = await bf.callLogStatus(A); return s.state === 'open' && s.next.slot === 'touch'; }, 'F6 note confirmed');
      await tid(page, 'call-log-check-again').click();
      await until(() => has(page, 'call-log-done'), 'F6 finished');
      check('F-6 finishing sends ONLY the last touch, with its derived original id; 1 note', writes('note.create').length === 1 && writes('contact.lastCallAttempt').length === 1
        && writes('contact.lastCallAttempt')[0].requestId === `${opOf(A)}-touch-1` && oneEach(A));
    }

    // ═══ F — uncertainty, refusals, retries ═══════════════════════════════════
    if (want('F')) {
      for (const [slot, op, label] of [['result', 'contact.callLogResult', 'call result'], ['note', 'note.create', 'call note'], ['touch', 'contact.lastCallAttempt', 'last-touch time']]) {
        await fresh();
        hold((r) => r.kind === 'write' && r.op === op, { failAfterSend: true });
        await saveCall(page, 'No Answer');
        await until(async () => new RegExp(`Unresolved — the ${label} for "No Answer" was sent and may still reach GHL`).test(await textOf(page, 'call-log-blocked')), `${slot} uncertain`);
        const w = writes().length;
        await tryCompeting(page, 'Voicemail');
        await tid(page, 'call-log-check-again').click(); await settle();
        await open(page, A);
        check(`F uncertain ${slot}: visibly unresolved (never "Saved"), survives reload, nothing further sent`,
          writes().length === w && !(await has(page, 'call-log-done')) && new RegExp(`Unresolved — the ${label}`).test(await textOf(page, 'call-log-blocked')));
      }

      // F-2 / F-3 — note refused (proved), twice; then Retry notes completes once.
      await fresh();
      hold((r) => r.kind === 'write' && r.op === 'note.create', { refuse: true });
      await saveCall(page, 'Spoke with Seller');
      await until(() => has(page, 'call-log-retry-note'), 'F2 retry offered');
      hold((r) => r.kind === 'write' && r.op === 'note.create', { refuse: true });
      await tid(page, 'call-log-retry-note').click();
      await until(async () => (await has(page, 'call-log-retry-note')) && writes('note.create').length === 2, 'F3 refused again');
      await open(page, A);
      check('F-3 a persistent refusal stays a visible partial save after reload, Retry notes still offered, Save disabled, no note in GHL',
        /Result saved; notes not saved/.test(await textOf(page, 'call-log-partial')) && (await has(page, 'call-log-retry-note')) && (await tid(page, 'call-log-save').isDisabled()) && callNotes(A).length === 0);
      await tid(page, 'call-log-retry-note').click();
      await until(() => has(page, 'call-log-done'), 'F2 completed');
      check('F-2 Retry notes finally writes the note once (attempt 3); 1/1/1', oneEach(A) && writes('note.create').map((w) => w.requestId.split('-').pop()).join() === '1,2,3');

      // F-7 — the last touch refused (proved): Retry last-touch time, after the note was confirmed.
      await fresh();
      hold((r) => r.kind === 'write' && r.op === 'contact.lastCallAttempt', { refuse: true });
      await saveCall(page, 'No Answer');
      await until(() => has(page, 'call-log-retry-touch'), 'F7 retry touch offered');
      check('F-7 a refused last touch: "Saved; last-touch time not updated" with Retry last-touch time; not the completed "Saved:"; the note was confirmed first',
        /Saved; last-touch time not updated/.test(await textOf(page, 'call-log-partial')) && !(await has(page, 'call-log-done')) && callNotes(A).length === 1);
      await tid(page, 'call-log-retry-touch').click();
      await until(() => has(page, 'call-log-done'), 'F7 completed');
      check('F-7 Retry last-touch time writes the touch once (attempt 2); 1/1/1', oneEach(A) && writes('contact.lastCallAttempt').map((w) => w.requestId.split('-').pop()).join() === '1,2');

      // R-3 — a result refused (proved): Not saved; a new call is then allowed.
      await fresh();
      hold((r) => r.kind === 'write' && r.op === 'contact.callLogResult', { refuse: true });
      await saveCall(page, 'No Answer');
      await until(() => has(page, 'call-log-not-saved'), 'R3 not saved');
      check('R-3 a refused result shows the recorded "not saved — nothing was sent"; Save is free for a new call', /was not saved — nothing was sent/.test(await textOf(page, 'call-log-not-saved')) && !(await has(page, 'call-log-blocked')) && stored(A) === null);
      await saveCall(page, 'Voicemail');
      await until(() => has(page, 'call-log-done'), 'R3 new call');
      check('R-3 the new call is its own operation and completes 1/1/1', begins(A).length === 2 && opOf(A, 0) !== opOf(A, 1) && oneEach(A));
    }

    // ═══ RA2 — two sessions press Check again together ═══════════════════════
    if (want('RA2')) {
      await fresh();
      failNext.push((r) => r.kind === 'detail' && r.contact === A);
      await saveCall(page, 'Voicemail');
      await until(() => has(page, 'call-log-saved-unverified'), 'RA2 unverified');
      await open(page, A); await open(page2, A);
      await Promise.all([tid(page, 'call-log-check-again').click(), tid(page2, 'call-log-check-again').click()]);
      await until(async () => (await has(page, 'call-log-done')) || (await has(page2, 'call-log-done')), 'RA2 one finished');
      await settle(); await settle();
      for (const p of [page, page2]) if (await has(p, 'call-log-check-again')) { await tid(p, 'call-log-check-again').click(); await settle(p); }
      check('RA2 two sessions finishing together: one note and one touch reach GHL', oneEach(A), { notes: callNotes(A).length, touches: applied('contact.lastCallAttempt', A).length });
    }

    // ═══ K-4 — contact isolation; ST-7 — status unreadable ════════════════════
    if (want('ISO')) {
      await fresh();
      failNext.push((r) => r.kind === 'detail' && r.contact === A);
      await saveCall(page, 'Spoke with Seller');
      await until(() => has(page, 'call-log-saved-unverified'), 'ISO A unverified');
      await go(page, `/contacts/${B}`);
      await until(async () => (await page.locator('body').innerText()).includes('Seed note for Bravo'), 'ISO B loaded');
      await until(async () => (await tid(page, 'call-log-checking').count()) === 0, 'ISO B checked');
      check('K-4 B is not blocked by A\'s unfinished call and shows none of A\'s state', !(await has(page, 'call-log-blocked')) && !(await has(page, 'call-log-saved-unverified')));
      await saveCall(page, 'No Answer');
      await until(() => has(page, 'call-log-done'), 'ISO B saved');
      check('K-4 B saves normally; A is untouched in GHL', stored(B) === 'No Answer' && callNotes(B).length === 1 && stored(A) === 'Spoke with Seller' && callNotes(A).length === 0);
      await go(page, `/contacts/${A}`);
      await until(async () => /partly saved/.test(await textOf(page, 'call-log-blocked')), 'ISO A still partly saved');

      resetDb(); log = []; holds = []; bf.reset();
      failNext.push((r) => r.kind === 'call-log' && r.action === 'status');
      await page.goto(`${base}${HARNESS}`);
      await page.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 });
      await go(page, `/contacts/${A}`);
      await until(() => has(page, 'call-log-blocked'), 'ST7 blocked');
      check('ST-7 an unreadable status is treated as blocked (Save disabled, Check again offered)', /could not check/.test(await textOf(page, 'call-log-blocked')) && (await tid(page, 'call-log-save').isDisabled()));
    }

    check('no request left the machine', foreign.length === 0, foreign);
    check('no page errors', pageErrors.length === 0, pageErrors);
  } catch (e) {
    console.error(e);
    failures += 1;
    releaseAll();
  }
  console.log(`\nCall-log operations (browser): ${checks - failures}/${checks} checks passed`);
  await exit(failures ? 1 : 0);
}
main();
