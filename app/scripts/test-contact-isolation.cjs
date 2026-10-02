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
 *   Contact page — a recorded dial result refreshes the notes list and the
 *   Follow Up callback for the SAME contact (successful write), a failed note
 *   write still reports partial and does not refresh, and a late A write or
 *   a late A notes read never puts A's notes or callback on B.
 *   Seller Call — Pass names a Follow-Up callback saved on this page for the
 *   SAME contact, and a late A save or a late A read never becomes B's Pass
 *   warning; while B's record is loading the warning names no callback.
 */
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const APP = path.resolve(__dirname, '..');
Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);
const { getConfig } = require(path.join(APP, 'shared/ghl-config.ts'));
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
const detail = (c) => ({ contact: { id: c.id, firstName: c.first, lastName: 'Fixture', phone: '+15555550100',
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
    case 'note.create': c.notes.push({ id: `${target}-n${c.notes.length + 1}`, body: args.body, dateAdded: new Date().toISOString() }); return { status: 200, body: { note: { id: 'n' } } };
    case 'contact.disposition': set(F.callDisposition); break;
    case 'contact.routing': set(F.callRouting); break;
    case 'contact.dispositionAt': set(F.dispositionAt); break;
    case 'contact.lastCallAttempt': set(F.lastCallAttempt, F.lastCallAttemptPrecise); break;
    case 'contact.callback': set(F.callbackDatetime, F.callbackDatetimePrecise); break;
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
      const fi = failNext.findIndex((p) => p(req));
      const res = fi >= 0 ? (failNext.splice(fi, 1), { status: 500, body: { error: 'fixture: injected failure' } }) : answer(req);
      return route.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(res.body) });
    });

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
      resetDb(opts); log = []; holds = []; failNext = [];
      await go('/'); await settle();
      await go(to);
    };
    const contactLoaded = (first) => until(async () => (await text()).includes(`Seed note for ${first}`), `${first} notes`);
    const A_NOTE = 'Call (reported by Brad in IAOS): No Answer';

    // ═══ Contact page ═══════════════════════════════════════════════════════
    // C1 — successful write, same contact: the note shows without a reload.
    await fresh({}, `/contacts/${A}`);
    await contactLoaded('Alpha');
    await page.getByTestId('disposition-option-no-answer').click();
    await until(async () => writesFor(A, 'contact.dispositionAt') === 1, 'A bell');
    await until(async () => (await text()).includes(A_NOTE), 'A dial-result note in the list');
    check('contact page: a recorded dial result appears in the notes list without a reload', (await text()).includes(A_NOTE));

    // C2 — successful Follow Up, same contact: the callback shows without a reload.
    await fresh({}, `/contacts/${A}`);
    await contactLoaded('Alpha');
    await page.getByTestId('disposition-option-follow-up').click();
    await page.getByTestId('disposition-confirm-record').click();
    await until(async () => writesFor(A, 'contact.dispositionAt') === 1, 'A Follow Up bell');
    const cbWritten = db[A].fields.get(F.callbackDatetimePrecise);
    const cbText = new Date(cbWritten).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    await until(async () => (await text()).includes(`Callback: ${cbText}`), 'A callback display');
    check('contact page: a Follow Up callback is displayed without a reload', (await text()).includes(`Callback: ${cbText}`), cbText);

    // C3 — partial failure: a failed note write reports partial and does not refresh notes.
    await fresh({}, `/contacts/${A}`);
    await contactLoaded('Alpha');
    failNext.push((r) => r.kind === 'write' && r.op === 'note.create' && r.contact === A);
    const readsBefore = notesReadsFor(A);
    await page.getByTestId('disposition-option-no-answer').click();
    await until(async () => writesFor(A, 'contact.dispositionAt') === 1, 'A bell after note failure');
    await settle();
    check('contact page: a failed note write is reported as partial', /note: /.test(await page.getByTestId('disposition-partial').innerText().catch(() => '')));
    check('contact page: a failed note write does not refresh the notes list', notesReadsFor(A) === readsBefore, { before: readsBefore, after: notesReadsFor(A) });

    // C4 — A's note write still pending at A -> B: B shows only B's notes.
    await fresh({}, `/contacts/${A}`);
    await contactLoaded('Alpha');
    let h = hold((r) => r.kind === 'write' && r.op === 'note.create' && r.contact === A);
    await page.getByTestId('disposition-option-no-answer').click();
    await h.hit;
    await go(`/contacts/${B}`);
    await contactLoaded('Bravo');
    const aReadsAtNav = notesReadsFor(A);
    h.release();
    await until(async () => writesFor(A, 'contact.dispositionAt') === 1, 'A run to finish after navigation');
    await settle();
    let t = await text();
    check('A->B with A\'s note write pending: B shows B\'s notes', t.includes('Seed note for Bravo'));
    check('A->B with A\'s note write pending: none of A\'s notes appear on B', !t.includes('Seed note for Alpha') && !t.includes(A_NOTE));
    check('A->B with A\'s note write pending: no notes read is started for A after navigation', notesReadsFor(A) === aReadsAtNav, { atNav: aReadsAtNav, after: notesReadsFor(A) });

    // C5 — A's notes REFRESH READ still pending at A -> B: its late answer is dropped.
    await fresh({}, `/contacts/${A}`);
    await contactLoaded('Alpha');
    const initialAReads = notesReadsFor(A);
    h = hold((r) => r.kind === 'notes' && r.contact === A && notesReadsFor(A) > initialAReads);
    await page.getByTestId('disposition-option-no-answer').click();
    await h.hit;
    await go(`/contacts/${B}`);
    await contactLoaded('Bravo');
    h.release();
    await until(async () => writesFor(A, 'contact.dispositionAt') === 1, 'A run to finish');
    await settle();
    t = await text();
    check('A->B with A\'s notes read pending: B still shows B\'s notes after A\'s read returns', t.includes('Seed note for Bravo'));
    check('A->B with A\'s notes read pending: A\'s notes never replace B\'s', !t.includes('Seed note for Alpha') && !t.includes(A_NOTE));

    // C6 — A's Follow Up callback write pending at A -> B: B shows B's callback only.
    await fresh({ bCallback: B_CALLBACK }, `/contacts/${A}`);
    await contactLoaded('Alpha');
    h = hold((r) => r.kind === 'write' && r.op === 'contact.callback' && r.contact === A);
    await page.getByTestId('disposition-option-follow-up').click();
    await page.getByTestId('disposition-confirm-record').click();
    const aCbReq = await h.hit;
    await go(`/contacts/${B}`);
    await contactLoaded('Bravo');
    await until(async () => (await text()).includes('Callback: Oct 9, 2:30 PM'), 'B callback display');
    h.release();
    await until(async () => writesFor(A, 'contact.dispositionAt') === 1, 'A Follow Up run to finish');
    await settle();
    t = await text();
    const aCbText = new Date(aCbReq.args.value).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    check('A->B with A\'s callback write pending: B shows B\'s callback', t.includes('Callback: Oct 9, 2:30 PM'));
    check('A->B with A\'s callback write pending: A\'s callback never shows on B', !t.includes(`Callback: ${aCbText}`), aCbText);
    check('A->B with A\'s callback write pending: A\'s write still landed on A only (write target unchanged)',
      db[A].fields.get(F.callbackDatetimePrecise) === aCbReq.args.value && db[B].fields.get(F.callbackDatetimePrecise) === B_CALLBACK);

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
