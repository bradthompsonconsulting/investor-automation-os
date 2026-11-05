/**
 * B15-27 — a delayed result for contact A never changes contact B's page.
 *
 * Offline. Vite serves scripts/harness/b15-27-cross-contact, which renders the
 * REAL ContactWorkspace and SellerCallWorkspace with the real GHL client in
 * headless Chromium (the B14-12 contact-isolation pattern). Every
 * /.netlify/functions request is answered here from an in-memory fixture with
 * two contacts, A (Alpha) and B (Bravo). A single response can be HELD, so the
 * write started for A is still pending when the page moves to B; it can also
 * be answered with a failure after the hold. Nothing leaves the machine.
 *
 * Contact page (the three handlers the Linear issue names):
 *   N  — the note box: A's "last attempted" time, A's save error and A's
 *        busy/draft state never appear on B; B can save its own note while
 *        A's is pending.
 *   CB — Set Callback: A's scheduled time, A's attempt time and A's error
 *        never appear on B; B's callback control is not left busy.
 *   CL — Clear Callback: A's clear never removes B's callback, closes B's
 *        control or shows A's error on B.
 * Seller Call:
 *   SC — a Pass recorded for A: its local outcome note, its error and its
 *        form reset never land on B.
 * Each A -> B case also proves the writes are unchanged: they all go to A,
 * in the same order as the same-contact run, and B gets none.
 * Positives (P*): the same results still appear when the operator stays on
 * the contact, or returns to it before the write finishes.
 *
 * NEGATIVE CONTROL: --before=<rev> renders <rev>'s two pages (written next to
 * the real ones as _b15_27_before_*.tsx, removed on exit) and must FAIL.
 */
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');

const APP = path.resolve(__dirname, '..');
const FLOOR = 49;   // the suite fails if fewer checks run
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

// ── --before=<rev>: render that revision's pages instead ────────────────────
const beforeArg = process.argv.find((a) => a.startsWith('--before='));
const BEFORE_REV = beforeArg ? beforeArg.slice('--before='.length) : null;
const HARNESS = 'scripts/harness/b15-27-cross-contact';
const generated = [];
let entry = `${HARNESS}/index.html`;
if (BEFORE_REV) {
  const show = (p) => execFileSync('git', ['show', `${BEFORE_REV}:app/${p}`], { cwd: APP, encoding: 'utf8', maxBuffer: 64 << 20 });
  const write = (rel, body) => { const f = path.join(APP, rel); fs.writeFileSync(f, body); generated.push(f); };
  write('src/pages/_b15_27_before_ContactWorkspace.tsx', show('src/pages/ContactWorkspace.tsx'));
  write('src/pages/_b15_27_before_SellerCallWorkspace.tsx', show('src/pages/SellerCallWorkspace.tsx'));
  const main = fs.readFileSync(path.join(APP, HARNESS, 'main.tsx'), 'utf8')
    .replace('"../../../src/pages/ContactWorkspace"', '"../../../src/pages/_b15_27_before_ContactWorkspace"')
    .replace('"../../../src/pages/SellerCallWorkspace"', '"../../../src/pages/_b15_27_before_SellerCallWorkspace"');
  write(`${HARNESS}/_before_main.tsx`, main);
  write(`${HARNESS}/_before.html`, fs.readFileSync(path.join(APP, HARNESS, 'index.html'), 'utf8').replace('./main.tsx', './_before_main.tsx'));
  entry = `${HARNESS}/_before.html`;
  console.log(`# NEGATIVE CONTROL: rendering ${BEFORE_REV}'s ContactWorkspace and SellerCallWorkspace`);
}
const cleanup = () => { for (const f of generated) { try { fs.rmSync(f); } catch { /* already gone */ } } };
process.on('exit', cleanup);

let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}

// ── In-memory GHL fixture (as test-contact-isolation.cjs) ───────────────────
const A = 'fixtureContactA';
const B = 'fixtureContactB';
const A_CALLBACK = '2026-10-06T15:00:00.000Z';   // Oct 6, 10:00 AM CT
const B_CALLBACK = '2026-10-09T19:30:00.000Z';   // Oct 9, 2:30 PM CT
let db;
function resetDb({ aCallback = null, bCallback = null } = {}) {
  const contact = (id, first, cb) => ({
    id, first, fields: new Map(cb ? [[F.callbackDatetimePrecise, cb], [F.callbackDatetime, Date.parse(cb)]] : []),
    notes: [{ id: `${id}-n1`, body: `Seed note for ${first}`, dateAdded: '2026-09-30T12:00:00.000Z' }],
  });
  db = { [A]: contact(A, 'Alpha', aCallback), [B]: contact(B, 'Bravo', bCallback) };
}
const field = (c, id) => (c.fields.has(id) ? c.fields.get(id) : null);
function contactRow(c) {
  return {
    id: c.id, firstName: c.first, lastName: 'Fixture', phone: '+15555550100', email: '', address1: '', city: '', state: '',
    postalCode: '', dateAdded: '2026-09-01T00:00:00.000Z', tags: [], dndSettings: {}, motivationScore: null, dealScore: null,
    combinedScore: null, completenessScore: null,
    callbackDatetime: field(c, F.callbackDatetimePrecise), callbackDatetimePrecise: field(c, F.callbackDatetimePrecise),
    lastCallAttempt: field(c, F.lastCallAttemptPrecise), lastCallAttemptPrecise: field(c, F.lastCallAttemptPrecise),
    callDisposition: field(c, F.callDisposition), dispositionAt: field(c, F.dispositionAt),
  };
}
const detail = (c) => ({ contact: { id: c.id, firstName: c.first, lastName: 'Fixture', phone: '+15555550100', dndSettings: {},
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
    case 'contact.callLogResult': set(F.callDisposition); break;
    case 'contact.lastCallAttempt': set(F.lastCallAttempt, F.lastCallAttemptPrecise); break;
    case 'contact.callback': case 'contact.explicitCallback': set(F.callbackDatetime, F.callbackDatetimePrecise); break;
    default: return { status: 400, body: { error: `fixture does not model ${op}` } };
  }
  return { status: 200, body: { confirmed: true } };
}
const { createBarrierFixture } = require('./harness/current-offer-barrier-fixture.cjs');
const { parseOutcomeNote } = require(path.join(APP, 'src/lib/seller-call-outcome.ts'));
const bf = createBarrierFixture({ contactOf: (o) => (o === `${A}-opp` ? A : o === `${B}-opp` ? B : null) });

// ── Request log, holds and injected failures ────────────────────────────────
let log = [];
let holds = [];
let failNext = [];
const foreign = [];
function hold(match) {
  let release; let hitResolve;
  const h = { match, released: new Promise((r) => { release = r; }), hit: new Promise((r) => { hitResolve = r; }) };
  h.release = release; h.onHit = hitResolve; holds.push(h);
  return h;
}
function classify(url, method, post) {
  const u = new URL(url);
  const fn = u.pathname.replace('/.netlify/functions/', '');
  if (fn === 'ghl-write' && method === 'POST') return { kind: 'write', op: post.operation, contact: post.targetId, args: post.args, requestId: post.requestId };
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
    optimizeDeps: { entries: [entry],
      include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] },
  });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const exit = async (code) => { await browser.close().catch(() => {}); await server.close().catch(() => {}); cleanup(); process.exit(code); };
  const watchdog = setTimeout(() => { console.error('FAIL  watchdog: suite exceeded 5 minutes'); exit(1); }, 5 * 60 * 1000);

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
      if (req.kind === 'call-log-barrier') {
        const res = await bf.handleCallLog(route.request().method(), url, post);
        return route.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(res.body) });
      }
      if (req.kind === 'current-offer-barrier') {
        const res = await bf.handle(route.request().method(), url, post);
        return route.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(res.body) });
      }
      const fi = failNext.findIndex((p) => p(req));
      const res = fi >= 0
        ? (failNext.splice(fi, 1), { status: 500, body: { error: 'fixture: injected failure' } })
        : req.kind === 'write'
          ? await bf.write({ operation: req.op, targetId: req.contact, requestId: req.requestId, contactId: req.contact, args: req.args },
            () => { const a = applyWrite(req.op, req.contact, req.args); return { confirmed: a.status === 200 }; },
            { outcome: req.op === 'note.create' ? parseOutcomeNote(req.args.body) : null, refuse: null })
          : answer(req);
      req.status = res.status;
      req.done = true;
      return route.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(res.body) });
    });
    await page.context().route(/gohighlevel\.com/, (route) => route.abort());

    await page.goto(`${base}/${entry}`);
    await page.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 });
    const go = (to) => page.evaluate((t) => window.__iaosNavigate(t), to);
    const text = () => page.locator('body').innerText();
    const settle = () => page.waitForTimeout(400);
    const until = async (fn, label, ms = 15000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(50); }
      throw new Error(`timed out waiting for ${label}`);
    };
    const writes = (contact) => log.filter((r) => r.kind === 'write' && (!contact || r.contact === contact));
    const opsFor = (contact) => writes(contact).map((r) => r.op);
    const doneWrites = (contact, op) => log.filter((r) => r.kind === 'write' && r.contact === contact && r.op === op && r.done).length;
    const fresh = async (opts, to) => {
      resetDb(opts); log = []; holds = []; failNext = []; bf.reset();
      await go('/'); await settle();
      await go(to);
    };
    const isA = (op) => (r) => r.kind === 'write' && r.op === op && r.contact === A;
    // A held request that is then answered with a failure.
    const holdThenFail = (op) => { failNext.push(isA(op)); return hold(isA(op)); };

    // ═══ Contact page ═══════════════════════════════════════════════════════
    const contactLoaded = (first) => until(async () => (await text()).includes(`Seed note for ${first}`), `${first} notes`);
    const noteBox = () => page.locator('input[placeholder="New note (any text = attempted)…"], input[placeholder="Saving…"]');
    const typeNote = async (t) => { await noteBox().fill(t); await noteBox().press('Tab'); };
    const ATTEMPTED = 'Last attempted';
    const NOT_CONTACTED = 'Not yet contacted';
    const MARK_FAILED = "couldn't mark attempted";
    const INJECTED = 'fixture: injected failure';
    const openCallback = async () => {
      const btn = page.getByRole('button', { name: /^(Set|Change) Callback$/ }).first();
      await btn.click();
      await until(async () => (await page.locator('input[type="datetime-local"]').count()) === 1, 'callback control');
    };
    const popoverOpen = async () => (await page.locator('input[type="datetime-local"]').count()) === 1;
    const popoverSaveEnabled = async () => !(await page.getByRole('button', { name: 'Save', exact: true }).isDisabled());
    const NOTE_OPS = ['note.create', 'contact.lastCallAttempt'];
    const CALLBACK_OPS = ['contact.explicitCallback', 'note.create', 'contact.lastCallAttempt'];

    // P1 — same contact: a saved note marks the attempt, clears the box.
    await fresh({}, `/contacts/${A}`);
    await contactLoaded('Alpha');
    check('P1 same contact: before saving, A reads "Not yet contacted"', (await text()).includes(NOT_CONTACTED));
    await typeNote('B15-27 Alpha note one');
    await until(async () => doneWrites(A, 'contact.lastCallAttempt') === 1, 'P1 attempt');
    await until(async () => (await text()).includes(ATTEMPTED), 'P1 attempted label').catch(() => {});
    check('P1 same contact: the note marks A attempted', (await text()).includes(ATTEMPTED));
    check('P1 same contact: the note box is cleared and enabled', (await noteBox().inputValue()) === '' && !(await noteBox().isDisabled()));
    check('P1 same contact: writes are note then attempt, for A only', JSON.stringify(opsFor()) === JSON.stringify(NOTE_OPS) && writes(B).length === 0, opsFor());

    // P2 — same contact: a failed attempt mark is reported.
    await fresh({}, `/contacts/${A}`);
    await contactLoaded('Alpha');
    failNext.push(isA('contact.lastCallAttempt'));
    await typeNote('B15-27 Alpha note two');
    await until(async () => (await text()).includes(MARK_FAILED), 'P2 error').catch(() => {});
    check('P2 same contact: a failed attempt mark is reported on A', (await text()).includes(MARK_FAILED));

    // N1 — A's attempt mark pending at A -> B: B never shows A's attempt time.
    await fresh({}, `/contacts/${A}`);
    await contactLoaded('Alpha');
    let h = hold(isA('contact.lastCallAttempt'));
    await typeNote('B15-27 Alpha note N1');
    await h.hit;
    await go(`/contacts/${B}`);
    await contactLoaded('Bravo');
    h.release();
    await until(async () => doneWrites(A, 'contact.lastCallAttempt') === 1, 'N1 A attempt to finish');
    await settle();
    let t = await text();
    check('N1 A->B, A\'s attempt mark pending: B still reads "Not yet contacted"', t.includes(NOT_CONTACTED) && !t.includes(ATTEMPTED), t.split('\n').filter((l) => /attempted|contacted/i.test(l)));
    check('N1 A->B: the writes are unchanged (note then attempt, both for A; none for B)',
      JSON.stringify(opsFor(A)) === JSON.stringify(NOTE_OPS) && writes(B).length === 0 && db[A].fields.has(F.lastCallAttemptPrecise), opsFor());

    // N2 — A's note write pending at A -> B: B's note box is B's (empty, usable).
    await fresh({}, `/contacts/${A}`);
    await contactLoaded('Alpha');
    h = hold(isA('note.create'));
    await typeNote('B15-27 Alpha draft N2');
    await h.hit;
    await go(`/contacts/${B}`);
    await contactLoaded('Bravo');
    await settle();
    check('N2 A->B, A\'s note pending: B\'s note box does not show A\'s text', !(await noteBox().inputValue()).includes('Alpha draft N2'), await noteBox().inputValue());
    check('N2 A->B, A\'s note pending: B\'s note box is not left busy by A\'s save', !(await noteBox().isDisabled()));
    h.release();
    await until(async () => doneWrites(A, 'contact.lastCallAttempt') === 1, 'N2 A run to finish');
    await settle();
    t = await text();
    check('N2 after A finishes: B shows no attempt, no A note, no error', t.includes(NOT_CONTACTED) && !t.includes('Alpha draft N2') && !t.includes(MARK_FAILED));
    check('N2: A\'s note and attempt still land on A, nothing on B',
      JSON.stringify(opsFor(A)) === JSON.stringify(NOTE_OPS) && writes(B).length === 0 && db[A].notes.some((n) => n.body === 'B15-27 Alpha draft N2'), opsFor());

    // N3 — B saves its own note while A's is still pending; A's late result changes nothing on B.
    await fresh({}, `/contacts/${A}`);
    await contactLoaded('Alpha');
    h = hold(isA('note.create'));
    await typeNote('B15-27 Alpha note N3');
    await h.hit;
    await go(`/contacts/${B}`);
    await contactLoaded('Bravo');
    let bSaved = true;
    try { await noteBox().fill('B15-27 Bravo note N3', { timeout: 3000 }); await noteBox().press('Tab', { timeout: 3000 }); } catch { bSaved = false; }
    if (bSaved) await until(async () => doneWrites(B, 'contact.lastCallAttempt') === 1, 'N3 B attempt').catch(() => { bSaved = false; });
    check('N3 B can save its own note while A\'s is pending', bSaved && db[B].notes.some((n) => n.body === 'B15-27 Bravo note N3'), opsFor(B));
    h.release();
    await until(async () => doneWrites(A, 'contact.lastCallAttempt') === 1, 'N3 A run to finish');
    await settle();
    t = await text();
    check('N3 B\'s own note shows on B; A\'s note never does', t.includes('B15-27 Bravo note N3') && !t.includes('Alpha note N3'));
    check('N3 each note went to its own contact', db[A].notes.some((n) => n.body === 'B15-27 Alpha note N3') && !db[B].notes.some((n) => n.body.includes('Alpha')));

    // N4 — A's attempt mark FAILS after A -> B: the error is not shown on B.
    await fresh({}, `/contacts/${A}`);
    await contactLoaded('Alpha');
    h = holdThenFail('contact.lastCallAttempt');
    await typeNote('B15-27 Alpha note N4');
    await h.hit;
    await go(`/contacts/${B}`);
    await contactLoaded('Bravo');
    h.release();
    await until(async () => doneWrites(A, 'contact.lastCallAttempt') === 1, 'N4 A failure to land');
    await settle();
    t = await text();
    check('N4 A->B, A\'s attempt mark fails: B shows no "couldn\'t mark attempted"', !t.includes(MARK_FAILED) && !t.includes(INJECTED));

    // N5 — A's note write FAILS after A -> B: the error is not shown on B.
    await fresh({}, `/contacts/${A}`);
    await contactLoaded('Alpha');
    h = holdThenFail('note.create');
    await typeNote('B15-27 Alpha note N5');
    await h.hit;
    await go(`/contacts/${B}`);
    await contactLoaded('Bravo');
    h.release();
    await until(async () => doneWrites(A, 'note.create') === 1, 'N5 A failure to land');
    await settle();
    t = await text();
    check('N5 A->B, A\'s note fails: B shows no error from A', !t.includes(INJECTED));
    check('N5: a failed note is not followed by an attempt mark (unchanged)', JSON.stringify(opsFor(A)) === JSON.stringify(['note.create']) && writes(B).length === 0, opsFor());

    // P3 — A -> B -> A while A's attempt mark is pending: back on A, A's result is shown.
    await fresh({}, `/contacts/${A}`);
    await contactLoaded('Alpha');
    h = hold(isA('contact.lastCallAttempt'));
    await typeNote('B15-27 Alpha note P3');
    await h.hit;
    await go(`/contacts/${B}`);
    await contactLoaded('Bravo');
    await go(`/contacts/${A}`);
    await contactLoaded('Alpha');
    h.release();
    await until(async () => doneWrites(A, 'contact.lastCallAttempt') === 1, 'P3 A attempt');
    await until(async () => (await text()).includes(ATTEMPTED), 'P3 attempted label').catch(() => {});
    check('P3 back on A before the write finished: A shows its own attempt', (await text()).includes(ATTEMPTED));

    // P4 — same contact: Set Callback shows the time and closes; a callback-stage failure is shown.
    await fresh({}, `/contacts/${A}`);
    await contactLoaded('Alpha');
    await openCallback();
    await page.locator('input[type="datetime-local"]').fill('2026-10-06T10:00');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await until(async () => doneWrites(A, 'contact.lastCallAttempt') === 1, 'P4 callback writes');
    await until(async () => (await text()).includes('Callback: Oct 6, 10:00 AM'), 'P4 callback display').catch(() => {});
    t = await text();
    check('P4 same contact: Set Callback shows A\'s callback and attempt and closes the control',
      t.includes('Callback: Oct 6, 10:00 AM') && t.includes(ATTEMPTED) && !(await popoverOpen()));
    check('P4 same contact: writes are callback, note, attempt for A only', JSON.stringify(opsFor()) === JSON.stringify(CALLBACK_OPS), opsFor());
    await fresh({}, `/contacts/${A}`);
    await contactLoaded('Alpha');
    await openCallback();
    failNext.push(isA('contact.explicitCallback'));
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await until(async () => (await text()).includes(INJECTED), 'P4 error').catch(() => {});
    check('P4 same contact: a failed callback save is shown in the open control', (await text()).includes(INJECTED) && (await popoverOpen()));

    // CB1 — A's callback save pending at A -> B: B shows no callback and no attempt from A.
    await fresh({}, `/contacts/${A}`);
    await contactLoaded('Alpha');
    await openCallback();
    await page.locator('input[type="datetime-local"]').fill('2026-10-06T10:00');
    h = hold(isA('contact.explicitCallback'));
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await h.hit;
    await go(`/contacts/${B}`);
    await contactLoaded('Bravo');
    h.release();
    await until(async () => doneWrites(A, 'contact.lastCallAttempt') === 1, 'CB1 A writes');
    await settle();
    t = await text();
    check('CB1 A->B, A\'s callback pending: B never shows A\'s Oct 6 callback', !t.includes('Oct 6'), t.split('\n').filter((l) => l.includes('Callback')));
    check('CB1 A->B: B never shows A\'s attempt time', t.includes(NOT_CONTACTED) && !t.includes(ATTEMPTED));
    check('CB1 A->B: the writes are unchanged (callback, note, attempt, all for A; none for B)',
      JSON.stringify(opsFor(A)) === JSON.stringify(CALLBACK_OPS) && writes(B).length === 0 && db[A].fields.get(F.callbackDatetimePrecise) === A_CALLBACK, opsFor());

    // CB2 — A's callback save FAILS after A -> B, with B's own control open.
    await fresh({}, `/contacts/${A}`);
    await contactLoaded('Alpha');
    await openCallback();
    h = holdThenFail('contact.explicitCallback');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await h.hit;
    await go(`/contacts/${B}`);
    await contactLoaded('Bravo');
    await openCallback();
    check('CB2 A->B, A\'s callback pending: B\'s callback control is not left busy', await popoverSaveEnabled());
    h.release();
    await until(async () => doneWrites(A, 'contact.explicitCallback') === 1, 'CB2 A failure to land');
    await settle();
    t = await text();
    check('CB2 A->B, A\'s callback fails: B\'s open control shows no error from A', (await popoverOpen()) && !t.includes(INJECTED));
    check('CB2: a failed callback is not followed by a note or attempt (unchanged)', JSON.stringify(opsFor()) === JSON.stringify(['contact.explicitCallback']), opsFor());

    // P5 — same contact: Clear Callback removes it; a failed clear is shown.
    await fresh({ aCallback: A_CALLBACK }, `/contacts/${A}`);
    await contactLoaded('Alpha');
    await until(async () => (await text()).includes('Callback: Oct 6, 10:00 AM'), 'P5 A callback');
    await openCallback();
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await until(async () => doneWrites(A, 'contact.explicitCallback') === 1, 'P5 clear');
    await until(async () => !(await text()).includes('Callback: Oct 6'), 'P5 cleared').catch(() => {});
    check('P5 same contact: Clear removes A\'s callback and closes the control', !(await text()).includes('Callback: Oct 6') && !(await popoverOpen()));
    await fresh({ aCallback: A_CALLBACK }, `/contacts/${A}`);
    await contactLoaded('Alpha');
    await until(async () => (await text()).includes('Callback: Oct 6, 10:00 AM'), 'P5b A callback');
    await openCallback();
    failNext.push(isA('contact.explicitCallback'));
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await until(async () => (await text()).includes("Couldn't clear callback"), 'P5b error').catch(() => {});
    check('P5 same contact: a failed clear is reported', (await text()).includes("Couldn't clear callback"));

    // CL1 — A's clear pending at A -> B (B has its own callback, control open): B keeps it.
    await fresh({ aCallback: A_CALLBACK, bCallback: B_CALLBACK }, `/contacts/${A}`);
    await contactLoaded('Alpha');
    await until(async () => (await text()).includes('Callback: Oct 6, 10:00 AM'), 'CL1 A callback');
    await openCallback();
    h = hold(isA('contact.explicitCallback'));
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await h.hit;
    await go(`/contacts/${B}`);
    await contactLoaded('Bravo');
    await until(async () => (await text()).includes('Callback: Oct 9, 2:30 PM'), 'CL1 B callback');
    await openCallback();
    h.release();
    await until(async () => doneWrites(A, 'contact.explicitCallback') === 1, 'CL1 A clear');
    await settle();
    t = await text();
    check('CL1 A->B, A\'s clear pending: B still shows B\'s own callback', t.includes('Callback: Oct 9, 2:30 PM'), t.split('\n').filter((l) => l.includes('Callback')));
    check('CL1 A->B: A\'s clear does not close B\'s open callback control', await popoverOpen());
    check('CL1: the clear still lands on A only (unchanged)',
      JSON.stringify(opsFor()) === JSON.stringify(['contact.explicitCallback']) && writes(A)[0].args.value === null
      && !db[A].fields.has(F.callbackDatetimePrecise) && db[B].fields.get(F.callbackDatetimePrecise) === B_CALLBACK, opsFor());

    // CL2 — A's clear FAILS after A -> B: B's open control shows no error from A.
    await fresh({ aCallback: A_CALLBACK, bCallback: B_CALLBACK }, `/contacts/${A}`);
    await contactLoaded('Alpha');
    await until(async () => (await text()).includes('Callback: Oct 6, 10:00 AM'), 'CL2 A callback');
    await openCallback();
    h = holdThenFail('contact.explicitCallback');
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await h.hit;
    await go(`/contacts/${B}`);
    await contactLoaded('Bravo');
    await until(async () => (await text()).includes('Callback: Oct 9, 2:30 PM'), 'CL2 B callback');
    await openCallback();
    check('CL2 A->B, A\'s clear pending: B\'s callback control is not left busy', await popoverSaveEnabled());
    h.release();
    await until(async () => doneWrites(A, 'contact.explicitCallback') === 1, 'CL2 A failure');
    await settle();
    t = await text();
    check('CL2 A->B, A\'s clear fails: B shows no "Couldn\'t clear callback"', !t.includes("Couldn't clear callback") && (await popoverOpen()));

    // ═══ Seller Call ════════════════════════════════════════════════════════
    const scLoaded = (first) => until(async () => (await text()).includes(`${first} deal`), `${first} Seller Call`);
    const openPass = async () => {
      await until(async () => (await page.getByTestId('call-outcome-pass-toggle').count()) > 0, 'Pass toggle');
      if ((await page.getByTestId('call-outcome-pass-reason').count()) === 0) await page.getByTestId('call-outcome-pass-toggle').click();
      await until(async () => !(await page.getByTestId('call-outcome-pass-confirm').isDisabled()) || true, 'pass form');
    };
    const pass = async (reason) => {
      await openPass();
      await page.getByTestId('call-outcome-pass-reason').fill(reason);
      await until(async () => !(await page.getByTestId('call-outcome-pass-confirm').isDisabled()), 'Confirm Pass enabled');
      await page.getByTestId('call-outcome-pass-confirm').click();
    };
    const PASS_OPS = ['note.create', 'contact.lastCallAttempt'];
    const openNotes = async () => {
      if ((await page.getByTestId('seller-call-notes-panel').count()) === 0) await page.getByTestId('seller-call-notes-toggle').click();
      await until(async () => (await page.getByTestId('seller-call-notes-list').count()) > 0, 'notes list');
    };
    // textContent, not innerText: an IAOS record's full body sits in a collapsed <details>.
    const notesText = () => page.getByTestId('seller-call-notes-list').textContent();
    const outcomeError = async () => (await page.getByTestId('call-outcome-error').count()) > 0;

    // P6 — same contact: a recorded Pass appears in A's notes and closes the form.
    await fresh({}, `/contacts/${A}/seller-call`);
    await scLoaded('Alpha');
    await pass('B15-27 Alpha pass reason P6');
    await until(async () => doneWrites(A, 'contact.lastCallAttempt') === 1, 'P6 pass writes');
    await until(async () => (await text()).includes('B15-27 Alpha pass reason P6'), 'P6 local note').catch(() => {});
    check('P6 same contact: the recorded Pass shows in A\'s notes at once (local append)', (await text()).includes('B15-27 Alpha pass reason P6'));
    await openNotes();
    check('P6 same contact: the outcome note is in A\'s Notes list', (await notesText()).includes('B15-27 Alpha pass reason P6'));
    check('P6 same contact: the Pass form closes', (await page.getByTestId('call-outcome-pass-reason').count()) === 0);
    check('P6 same contact: writes are outcome note then attempt, for A only', JSON.stringify(opsFor()) === JSON.stringify(PASS_OPS), opsFor());

    // P7 — same contact: a failed outcome note is reported.
    await fresh({}, `/contacts/${A}/seller-call`);
    await scLoaded('Alpha');
    failNext.push(isA('note.create'));
    await pass('B15-27 Alpha pass reason P7');
    await until(outcomeError, 'P7 error').catch(() => {});
    check('P7 same contact: a failed Pass is reported on A', await outcomeError());

    // SC1 — A's Pass pending at A -> B: A's outcome note never lands in B's notes.
    await fresh({}, `/contacts/${A}/seller-call`);
    await scLoaded('Alpha');
    h = hold(isA('note.create'));
    await pass('B15-27 Alpha pass reason SC1');
    await h.hit;
    await go(`/contacts/${B}/seller-call`);
    await scLoaded('Bravo');
    await openNotes();
    await until(async () => (await notesText()).includes('Seed note for Bravo'), 'SC1 B notes');
    h.release();
    await until(async () => doneWrites(A, 'contact.lastCallAttempt') === 1, 'SC1 A pass to finish');
    await settle();
    t = await text();
    // textContent: the page's whole text, including collapsed full records.
    check('SC1 A->B, A\'s Pass pending: A\'s outcome note appears nowhere on B\'s page', !(await page.locator('body').textContent()).includes('B15-27 Alpha pass reason SC1'));
    const bNotes = await notesText();
    check('SC1 A->B: B\'s Notes list holds B\'s notes only', bNotes.includes('Seed note for Bravo') && !bNotes.includes('Seed note for Alpha') && !bNotes.includes('Alpha pass reason'), bNotes);
    check('SC1: the writes are unchanged (outcome note then attempt, for A; none for B)',
      JSON.stringify(opsFor(A)) === JSON.stringify(PASS_OPS) && writes(B).length === 0
      && db[A].notes.some((n) => n.body.includes('B15-27 Alpha pass reason SC1')), opsFor());

    // SC2 — A's Pass form (open, with A's typed reason) never becomes B's; after A's
    // Pass finishes, B's own Pass starts empty and is recorded for B with B's reason.
    const reasonOnPage = async () => ((await page.getByTestId('call-outcome-pass-reason').count()) === 1
      ? page.getByTestId('call-outcome-pass-reason').inputValue() : '');
    await fresh({}, `/contacts/${A}/seller-call`);
    await scLoaded('Alpha');
    h = hold(isA('note.create'));
    await pass('B15-27 Alpha pass reason SC2');
    await h.hit;
    await go(`/contacts/${B}/seller-call`);
    await scLoaded('Bravo');
    await settle();
    check('SC2 A->B, A\'s Pass pending: B shows no Pass form holding A\'s reason', !(await reasonOnPage()).includes('Alpha'), await reasonOnPage());
    h.release();
    await until(async () => doneWrites(A, 'contact.lastCallAttempt') === 1, 'SC2 A pass to finish');
    await settle();
    await openPass();
    check('SC2 after A finishes: B\'s Pass form opens empty', (await reasonOnPage()) === '', await reasonOnPage());
    await pass('B15-27 Bravo pass reason SC2');
    await until(async () => doneWrites(B, 'contact.lastCallAttempt') === 1, 'SC2 B pass');
    await settle();
    check('SC2: B\'s Pass is recorded for B with B\'s reason only',
      JSON.stringify(opsFor(B)) === JSON.stringify(PASS_OPS)
      && db[B].notes.some((n) => n.body.includes('Reason: B15-27 Bravo pass reason SC2')) && !db[B].notes.some((n) => n.body.includes('Alpha')), opsFor(B));

    // SC3 — A's Pass FAILS after A -> B: the error is not shown on B.
    await fresh({}, `/contacts/${A}/seller-call`);
    await scLoaded('Alpha');
    h = holdThenFail('note.create');
    await pass('B15-27 Alpha pass reason SC3');
    await h.hit;
    await go(`/contacts/${B}/seller-call`);
    await scLoaded('Bravo');
    h.release();
    await until(async () => doneWrites(A, 'note.create') === 1, 'SC3 A failure to land');
    await settle();
    check('SC3 A->B, A\'s Pass fails: B shows no outcome error from A', !(await outcomeError()));
    check('SC3: a failed outcome note is not followed by an attempt (unchanged)', JSON.stringify(opsFor()) === JSON.stringify(['note.create']), opsFor());

    // ═══ Whole run ══════════════════════════════════════════════════════════
    check('no request left the machine', foreign.length === 0, foreign.slice(0, 5));
    check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 5));
  } catch (e) {
    check(`suite ran to completion (${e.message})`, false);
  }
  clearTimeout(watchdog);
  if (checks < FLOOR) check(`at least ${FLOOR} checks ran`, false, checks);
  console.log(`\n${checks - failures}/${checks} checks passed${BEFORE_REV ? ` (negative control vs ${BEFORE_REV})` : ''}`);
  await exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); cleanup(); process.exit(1); });
