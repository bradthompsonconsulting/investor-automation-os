/**
 * Board 15 / PR #126 re-reviews (Bones; Jess 2026-10-05) — the Current Offer
 * label and save bookkeeping on the Seller Call deal bar, driven as an
 * operator would.
 *
 * Offline. Vite serves scripts/harness/contact-isolation (the REAL
 * SellerCallWorkspace with the real GHL client) in headless Chromium. Every
 * /.netlify/functions request is answered here from an in-memory fixture with
 * TWO deals (contact A / opportunity A, contact B / opportunity B) that models
 * the Opportunity Current Offer carrier: the write (ghl-write
 * opportunity.currentOffer) and its readback (ghl-proxy /opportunities/:id).
 * Any response can be held, refused (403) or have its readback fail.
 *
 * "Recorded in GHL" applies ONLY to the amount confirmed saved for the deal
 * on screen:
 *   1. typing is a draft and sends nothing;
 *   2. a held save shows "Saving to GHL…", then "Recorded in GHL" on readback;
 *   3. a refused save (403) says "Not saved — GHL refused the save";
 *   4. a restored carrier amount is recorded;
 *   5. A's late completion never confirms B's draft and never suppresses B's
 *      save -- including when B independently saves the SAME amount as A;
 *   6. an older failure never labels a newer edited amount;
 *   7. a write that may have landed but cannot be read back says "Save could
 *      not be confirmed", never "Recorded" and never "Not saved";
 *   8. an older readback held: the newer amount waits (one save per deal at
 *      a time), then saves and records; the older amount retyped is a
 *      draft and saves;
 *   9. Bones's exact case: older $410k write held -> newer $420k readback
 *      captured and delayed -> older write released -> newer readback
 *      delivered: never "Recorded" unless GHL holds the amount on screen;
 *  10. edits made while saving are preserved; repeated blurs coalesce;
 *  11. an older uncertain result, and 12. an older refusal, with a newer
 *      amount waiting: the newer saves and records on its own;
 *  13. the corrective save: retyping the recorded amount while a newer one
 *      is in flight is a draft, and its blur is queued, not de-duped;
 *  14. navigation: A's pending save never delays or labels B; back on A,
 *      its own verified amount is restored.
 *
 *  19. Bones's reload reproduction (reconstructed): a save whose request is
 *      still on its way leaves the deal Unresolved; a RELOAD keeps it
 *      Unresolved and locked (the server's durable barrier); Check again
 *      proves the request was never sent and withdraws it; the delayed
 *      request then reaches the server and sends NOTHING;
 *  20. a sent-and-unresolved save survives a reload, and Check again cannot
 *      clear it (no reload or GHL look clears it);
 *  21. two browsers: the second browser sees the first's unresolved save
 *      and its save in progress, and sends nothing until the server proves
 *      it;
 *  22. storage failures: an unreadable status, and a reservation that
 *      could not be stored, block and send nothing.
 *
 * Confirm Accept uses the same save coordinator; its ordering is covered
 * directly in test-current-offer-save-coordinator.cjs (the fixture here
 * cannot reach Offer Ready).
 *
 * A hold either delays the REQUEST (the server has not applied it yet) or,
 * with `early`, delays only the RESPONSE (the server answered on arrival and
 * the answer is delivered late) -- the latter models a held readback.
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
const OFFER_FIELD = getConfig('test').opportunityFacts.currentOffer;

let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}

// ── In-memory fixture: two contacts, one opportunity each ────────────────────
const A = 'fixtureContactA';
const B = 'fixtureContactB';
const FIRST = { [A]: 'Alpha', [B]: 'Bravo' };
const opp = (c) => `${c}-opp`;
let db;
function resetDb({ aOffer = null, bOffer = null } = {}) { db = { [opp(A)]: aOffer, [opp(B)]: bOffer }; }
const oppListRow = (c) => ({ id: opp(c), contactId: c, contactName: FIRST[c], opportunityName: `${FIRST[c]} deal`, phone: '', email: '', stageId: 'fixture-stage',
  customFields: db[opp(c)] === null ? [] : [{ id: OFFER_FIELD, fieldValueNumber: db[opp(c)] }] });
let log = [];
let holds = [];
let refuseNext = 0;          // next N writes answer 403 (definite refusal)
let failReadbackNext = 0;    // next N opportunity readbacks answer 500 (uncertain)
function hold(match) {
  let release; let onHit;
  const h = { match, released: new Promise((r) => { release = r; }), hit: new Promise((r) => { onHit = r; }) };
  h.release = release; h.onHit = onHit; holds.push(h); return h;
}
/* PR #126 stacked server PR: the durable Current Offer barrier, run by the REAL
   server module in Node (harness/current-offer-barrier-fixture.cjs). Its state
   is shared by every browser context and survives page reloads. */
const { createBarrierFixture } = require('./harness/current-offer-barrier-fixture.cjs');
const bf = createBarrierFixture({ contactOf: (o) => (o === opp(A) ? A : o === opp(B) ? B : null) });
function classify(url, method, post) {
  const u = new URL(url);
  const fn = u.pathname.replace('/.netlify/functions/', '');
  if (fn === 'ghl-write' && method === 'POST') return { kind: 'write', op: post.operation, target: post.targetId, args: post.args, requestId: post.requestId };
  if (fn === 'current-offer-barrier') return { kind: 'barrier', method, url, post, action: method === 'GET' ? 'status' : post && post.action };
  if (fn === 'ghl-proxy') {
    const p = u.searchParams.get('path') || '';
    let m;
    if ((m = p.match(/^\/contacts\/([^/?]+)\/notes$/))) return { kind: 'notes', contact: m[1] };
    if ((m = p.match(/^\/contacts\/([^/?]+)$/))) return { kind: 'detail', contact: m[1] };
    if ((m = p.match(/^\/opportunities\/([^/?]+)$/))) return { kind: 'opp-read', target: m[1] };
    return { kind: 'proxy-other', path: p };
  }
  if (fn === 'ghl-contact') return { kind: 'row', contact: u.searchParams.get('id') };
  return { kind: fn };
}
function answer(req) {
  switch (req.kind) {
    case 'write':
      if (req.op !== 'opportunity.currentOffer' || !(req.target in db)) return { status: 400, body: { error: `fixture does not model ${req.op}` } };
      db[req.target] = req.args.value; return { status: 200, body: { confirmed: true } };
    case 'opp-read': return { status: 200, body: { opportunity: { id: req.target, customFields: db[req.target] === null ? [] : [{ id: OFFER_FIELD, fieldValue: db[req.target] }] } } };
    case 'notes': return { status: 200, body: { notes: [{ id: `${req.contact}-n1`, body: `Seed note for ${FIRST[req.contact]}`, dateAdded: '2026-09-30T12:00:00.000Z' }] } };
    case 'detail': return { status: 200, body: { contact: { id: req.contact, firstName: FIRST[req.contact], lastName: 'Fixture', phone: '+15555550100', customFields: [] } } };
    case 'row': return { status: 200, body: { id: req.contact, firstName: FIRST[req.contact], lastName: 'Fixture', phone: '+15555550100', tags: [] } };
    case 'ghl-opportunities': return { status: 200, body: { pipelineId: 'fixture-pipeline', stages: [], opportunities: [oppListRow(A), oppListRow(B)] } };
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
  const foreign = [];
  const exit = async (code) => { await browser.close().catch(() => {}); await server.close().catch(() => {}); process.exit(code); };
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Chicago' });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    const routeHandler = async (route) => {
      const url = route.request().url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { foreign.push(url); return route.abort(); }
      let post = null;
      try { post = route.request().postDataJSON(); } catch { post = null; }
      const req = classify(url, route.request().method(), post);
      log.push(req);
      const h = holds.find((x) => !x.used && x.match(req));
      if (h && h.early) {
        const res = h.failRead ? { status: 500, body: { error: 'fixture: readback failed' } } : answer(req);
        h.used = true; h.onHit(req); await h.released;
        return route.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(res.body) });
      }
      if (h) { h.used = true; h.onHit(req); await h.released; }
      /* An indeterminate submission: `lose` drops the response (the browser
         sees a network failure) -- 'landed' applies the write first, 'late'
         leaves it for the test to apply later (a request still on its way);
         `reply` answers with a given status/body (e.g. 502, or the server's
         409 indeterminate), applying the write when `applies` is set. */
      if (req.kind === 'barrier') {
        const res = await bf.handle(req.method, req.url, req.post);
        return route.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(res.body) });
      }
      if (req.kind === 'write') {
        /* The server side of a Current Offer write: the real barrier module claims
           the send, applies the write to the fixture GHL, records the outcome.
           `refuse` is a refusal decided BEFORE the GHL call (not_sent);
           `lose: 'landed'` -- the server finished, the browser lost the answer;
           `lose: 'late'` -- the request is still on its way: `lateWrite()`
           delivers it to the server later (a delayed handler);
           `reply` without `applies` -- a gateway answer, the server never ran;
           `reply` with `applies` -- the GHL call was made, its answer lost. */
        const contactId = req.target === opp(A) ? A : req.target === opp(B) ? B : req.target;
        const serverWrite = (opts) => bf.write({ operation: req.op, targetId: req.target, requestId: req.requestId, contactId },
          () => { db[req.target] = req.args.value; return { confirmed: true }; }, opts);
        if (h && h.lose === 'late') { h.lateWrite = () => serverWrite({}); return route.abort('failed'); }
        if (h && h.reply && !h.applies) return route.fulfill({ status: h.reply.status, contentType: 'application/json', body: JSON.stringify(h.reply.body) });
        const refusing = h ? !!h.refuse : refuseNext > 0;
        if (!h && refusing) refuseNext -= 1;
        const res = await serverWrite({ refuse: refusing ? { status: 409, error: 'fixture: write refused' } : null, failAfterSend: !!(h && h.reply && h.applies) });
        if (h && h.lose === 'landed') return route.abort('failed');
        return route.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(res.body) });
      }
      if (req.kind === 'opp-read' && failReadbackNext > 0) {
        failReadbackNext -= 1;
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'fixture: readback failed' }) });
      }
      const res = answer(req);
      return route.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(res.body) });
    };
    await page.route('**/*', routeHandler);
    await page.context().route(/gohighlevel\.com/, (route) => route.abort());
    await page.goto(`${base}/scripts/harness/contact-isolation/index.html`);
    await page.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 });
    const go = (to) => page.evaluate((t) => window.__iaosNavigate(t), to);
    const until = async (fn, label, ms = 15000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(50); }
      throw new Error(`timed out waiting for ${label}`);
    };
    const note = async () => {
      const el = page.getByTestId('deal-bar-note-current_offer');
      return (await el.count()) ? (await el.innerText()).trim() : null;
    };
    const writes = (target) => log.filter((r) => r.kind === 'write' && (!target || r.target === target));
    const input = () => page.getByTestId('negotiation-current-offer-input');
    const open = async (c) => {
      await go('/'); await page.waitForTimeout(300);
      await go(`/contacts/${c}/seller-call`);
      await input().waitFor({ timeout: 30000 });
      await until(async () => (await page.locator('body').innerText()).includes(`${FIRST[c]} deal`) || (await input().isVisible()), `${c} loaded`);
    };
    /* Each case starts from a full page load: the Current Offer save
       coordinator is shared by the whole loaded app (an unresolved deal
       stays blocked across in-app navigation), so only a reload resets it. */
    const fresh = async (opts, c) => {
      resetDb(opts); log = []; holds = []; refuseNext = 0; failReadbackNext = 0; bf.reset();
      await page.goto(`${base}/scripts/harness/contact-isolation/index.html`);
      await page.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 });
      await open(c);
    };
    const noteStarts = async (prefix) => ((await note()) || '').startsWith(prefix);

    // 1 — typing is a draft and sends nothing.
    await fresh({}, A);
    await input().fill('250000');
    await until(async () => (await note()) !== null, 'note');
    check('1 a typed, unsaved amount is a draft', await noteStarts('Draft — not saved yet'), await note());
    check('1 typing sends no write', writes().length === 0, writes());

    // 2 — held save -> "Saving…"; readback -> "Recorded".
    let h = hold((r) => r.kind === 'write' && r.target === opp(A));
    await input().press('Tab');
    await h.hit;
    await until(async () => noteStarts('Saving to GHL…'), 'saving');
    check('2 a save in flight says "Saving to GHL…"', await noteStarts('Saving to GHL…'), await note());
    h.release();
    await until(async () => noteStarts('Recorded in GHL'), 'recorded');
    check('2 after readback it is "Recorded in GHL"', await noteStarts('Recorded in GHL'), await note());
    check('2 one write to opportunity A with 250000, confirmed by a readback',
      writes().length === 1 && writes()[0].target === opp(A) && writes()[0].args.value === 250000 && log.some((r) => r.kind === 'opp-read'), writes());

    // 3 — a definite refusal.
    await input().fill('260000');
    check('3 editing the recorded amount is a draft again', await noteStarts('Draft — not saved yet'), await note());
    refuseNext = 1;
    await input().press('Tab');
    await until(async () => noteStarts('Not saved'), 'not saved');
    check('3 a save refused before reaching GHL says "Not saved — nothing was sent to GHL"', await noteStarts('Not saved — nothing was sent to GHL'), await note());
    check('3 the carrier keeps 250000', db[opp(A)] === 250000, db[opp(A)]);

    // 4 — restored carrier amount is recorded.
    await fresh({ aOffer: 300000 }, A);
    await until(async () => (await input().inputValue()) !== '', 'restored');
    await until(async () => (await note()) !== null, 'restored note');
    check('4 a restored carrier amount is "Recorded in GHL", with no write', (await noteStarts('Recorded in GHL')) && writes().length === 0, { note: await note(), w: writes().length });

    // 5 — A's late completion vs B: never confirms B's draft, never suppresses B's save of the SAME amount.
    await fresh({}, A);
    await input().fill('250000');
    h = hold((r) => r.kind === 'write' && r.target === opp(A));
    await input().press('Tab');
    await h.hit;                                   // A's save of 250000 is in flight
    /* Move DIRECTLY to deal B: the same SellerCallWorkspace instance stays
       mounted (only the route param changes), which is the case where A's late
       completion could touch B's state. Going via "/" would unmount the page
       and make the check vacuous. */
    await go(`/contacts/${B}/seller-call`);
    await until(async () => (await input().inputValue()) === '' && (await page.locator('body').innerText()).includes('Bravo'), 'B on screen', 15000).catch(() => {});
    check('5 setup: the page moved straight to B (same mounted page, B on screen)', (await page.locator('body').innerText()).includes('Bravo'));
    await input().fill('250000');                  // B types the same amount
    await until(async () => (await note()) !== null, 'B note');
    check('5 B shows its own draft while A\'s save is pending (not "Saving")', await noteStarts('Draft — not saved yet'), await note());
    h.release();                                   // A's save completes now
    await until(async () => db[opp(A)] === 250000, 'A write applied');
    await page.waitForTimeout(800);
    check('5 A\'s completion does NOT confirm B\'s draft', await noteStarts('Draft — not saved yet'), await note());
    const bBefore = writes(opp(B)).length;
    await input().press('Tab');                    // B saves the same amount
    await until(async () => writes(opp(B)).length === bBefore + 1, 'B write sent', 8000).catch(() => {});
    check('5 B\'s save of the SAME amount is sent (not suppressed by A\'s bookkeeping)', writes(opp(B)).length === bBefore + 1, writes(opp(B)));
    await until(async () => noteStarts('Recorded in GHL'), 'B recorded').catch(() => {});
    check('5 B is "Recorded in GHL" only after B\'s own confirmed save', (await noteStarts('Recorded in GHL')) && db[opp(B)] === 250000, { note: await note(), b: db[opp(B)] });

    // 6 — an older failure never labels a newer edited amount.
    await fresh({}, A);
    await input().fill('250000');
    h = hold((r) => r.kind === 'write' && r.target === opp(A));
    h.refuse = true;                               // this held write will be refused when released
    await input().press('Tab');
    await h.hit;
    await input().fill('270000');                  // operator edits while the old save is pending
    check('6 the newer amount is a draft while the older save is pending', await noteStarts('Draft — not saved yet'), await note());
    h.release();                                   // the OLDER save (250000) is refused
    await page.waitForTimeout(800);
    check('6 the older refusal does not label the newer amount', await noteStarts('Draft — not saved yet'), await note());
    check('6 no "Not saved" error is shown for the newer amount', (await page.getByTestId('current-offer-write-error').count()) === 0);
    await input().press('Tab');
    await until(async () => noteStarts('Recorded in GHL'), 'newer recorded').catch(() => {});
    check('6 the newer amount then saves and is recorded on its own', (await noteStarts('Recorded in GHL')) && db[opp(A)] === 270000, { note: await note(), a: db[opp(A)] });

    // 7 — write may have landed, readback fails: "Save could not be confirmed".
    await fresh({}, A);
    await input().fill('280000');
    failReadbackNext = 99;                         // every readback attempt fails
    await input().press('Tab');
    await until(async () => noteStarts('Unresolved'), 'unresolved').catch(() => {});
    check('7 a readback that fails is not proof either way: Unresolved and locked, never "Recorded" or "Not saved"', (await noteStarts('Unresolved')) && (await input().isEditable()) === false, await note());
    failReadbackNext = 0;
    await page.getByTestId('current-offer-check-again').click();
    await until(async () => (await input().isEditable()), 'cleared').catch(() => {});
    check('7 Check again: the server has evidence (its own write was confirmed), so it clears -- as a draft, nothing assumed', (await input().isEditable()) && (await noteStarts('Draft — not saved yet')), await note());

    const writesOf = (v, target = opp(A)) => writes(target).filter((r) => r.args.value === v).length;
    const errCount = () => page.getByTestId('current-offer-write-error').count();
    /* The invariant behind every case: "Recorded in GHL" is shown only when
       GHL holds exactly the amount on screen. */
    const truthful = async (target = opp(A)) => !(await noteStarts('Recorded in GHL')) || db[target] === Number(await input().inputValue());

    // 8 — older readback held: the newer amount waits, then saves; the older amount retyped is a draft that saves.
    await fresh({}, A);
    await input().fill('310000');
    h = hold((r) => r.kind === 'opp-read' && r.target === opp(A)); h.early = true;   // 310000's readback answered, delivery held
    await input().press('Tab');
    await h.hit;
    await input().fill('320000');
    await input().press('Tab');
    await page.waitForTimeout(600);
    check('8 while 310000 is being saved, 320000 is NOT sent (one save per deal at a time)', writesOf(320000) === 0, writes(opp(A)).map((r) => r.args.value));
    check('8 320000 shows "Saving to GHL…" (queued), never "Recorded"', await noteStarts('Saving to GHL…'), await note());
    h.release();
    await until(async () => (await noteStarts('Recorded in GHL')) && db[opp(A)] === 320000, '320000 recorded').catch(() => {});
    check('8 after 310000 settles, 320000 is sent and recorded by its own readback', (await noteStarts('Recorded in GHL')) && db[opp(A)] === 320000 && writesOf(320000) === 1, { note: await note(), a: db[opp(A)] });
    await input().fill('310000');
    check('8 retyped 310000 is a Draft', await noteStarts('Draft — not saved yet'), await note());
    await input().press('Tab');
    await until(async () => (await noteStarts('Recorded in GHL')) && db[opp(A)] === 310000, '310000 recorded').catch(() => {});
    check('8 its blur sends its own save, and it is recorded only once GHL holds it', writesOf(310000) === 2 && db[opp(A)] === 310000 && (await noteStarts('Recorded in GHL')), { w: writes(opp(A)).map((r) => r.args.value), a: db[opp(A)] });

    // 9 — Bones's exact case: hold older $410k write -> capture/delay newer $420k readback -> release older write -> deliver newer readback.
    await fresh({}, A);
    await input().fill('410000');
    const h410 = hold((r) => r.kind === 'write' && r.target === opp(A) && r.args.value === 410000);
    await input().press('Tab');
    await h410.hit;                                // older $410k write held (not yet applied)
    const h420read = hold((r) => r.kind === 'opp-read' && r.target === opp(A) && db[opp(A)] === 420000); h420read.early = true;
    await input().fill('420000');
    await input().press('Tab');
    await page.waitForTimeout(600);
    check('9 while the $410k write is held, the $420k write is NOT sent', writesOf(420000) === 0, writes(opp(A)).map((r) => r.args.value));
    check('9 $420k is not claimed recorded while GHL does not hold it', (await truthful()) && !(await noteStarts('Recorded in GHL')), { note: await note(), a: db[opp(A)] });
    h410.release();                                // older write lands
    await h420read.hit;                            // newer readback captured (answered on arrival), delivery held
    check('9 the $420k write went out only after the $410k write settled', log.filter((r) => r.kind === 'write').map((r) => r.args.value).join() === '410000,420000', log.filter((r) => r.kind === 'write').map((r) => r.args.value));
    check('9 while $420k\'s readback is held: not "Recorded", and the label is truthful', !(await noteStarts('Recorded in GHL')) && (await truthful()), { note: await note(), a: db[opp(A)] });
    h420read.release();                            // newer readback delivered
    await until(async () => noteStarts('Recorded in GHL'), '420000 recorded').catch(() => {});
    check('9 $420k is recorded and GHL holds $420k', (await noteStarts('Recorded in GHL')) && db[opp(A)] === 420000, { note: await note(), a: db[opp(A)] });
    await input().focus(); await input().press('Tab');
    await page.waitForTimeout(500);
    check('9 nothing further is needed: an untouched blur sends nothing', writesOf(420000) === 1);

    // 10 — edits while saving are preserved; repeated blurs coalesce to the latest.
    await fresh({}, A);
    await input().fill('410000');
    h = hold((r) => r.kind === 'write' && r.target === opp(A) && r.args.value === 410000);
    await input().press('Tab');
    await h.hit;
    await input().fill('420000'); await input().press('Tab');
    await input().fill('430000'); await input().press('Tab');
    check('10 the edit made while saving stays on screen', (await input().inputValue()) === '430000', await input().inputValue());
    h.release();
    await until(async () => (await noteStarts('Recorded in GHL')) && db[opp(A)] === 430000, '430000 recorded').catch(() => {});
    check('10 only 410000 and then 430000 were written (the replaced 420000 never)', writes(opp(A)).map((r) => r.args.value).join() === '410000,430000', writes(opp(A)).map((r) => r.args.value));
    check('10 430000 is recorded and the input still shows it', (await noteStarts('Recorded in GHL')) && (await input().inputValue()) === '430000' && (await truthful()), await note());

    // 11 — an older UNCERTAIN result with a newer amount waiting.
    await fresh({}, A);
    await input().fill('410000');
    h = hold((r) => r.kind === 'opp-read' && r.target === opp(A)); h.early = true; h.failRead = true;
    await input().press('Tab');
    await h.hit;
    await input().fill('420000'); await input().press('Tab');
    h.release();                                   // the older readback fails
    await until(async () => noteStarts('Unresolved'), 'unresolved').catch(() => {});
    await page.waitForTimeout(500);
    check('11 an older failed readback blocks: Unresolved, and the waiting 420000 is never sent', (await noteStarts('Unresolved')) && writesOf(420000) === 0, { note: await note(), w: writes(opp(A)).map((x) => x.args.value) });
    await page.getByTestId('current-offer-check-again').click();
    await until(async () => (await input().isEditable()), 'cleared').catch(() => {});
    await input().focus(); await input().press('Tab');
    await until(async () => (await noteStarts('Recorded in GHL')) && db[opp(A)] === 420000, '420000 recorded').catch(() => {});
    check('11 after Check again proves the older save, 420000 saves and records on its own', (await noteStarts('Recorded in GHL')) && db[opp(A)] === 420000 && writesOf(420000) === 1, { note: await note(), a: db[opp(A)] });

    // 12 — an older REFUSAL with a newer amount waiting.
    await fresh({}, A);
    await input().fill('410000');
    h = hold((r) => r.kind === 'write' && r.target === opp(A) && r.args.value === 410000); h.refuse = true;
    await input().press('Tab');
    await h.hit;
    await input().fill('420000'); await input().press('Tab');
    h.release();                                   // the older save is refused
    await until(async () => (await noteStarts('Recorded in GHL')) && db[opp(A)] === 420000, '420000 recorded').catch(() => {});
    check('12 the newer amount is saved and recorded, with no error from the older refusal', (await noteStarts('Recorded in GHL')) && (await errCount()) === 0 && db[opp(A)] === 420000, { note: await note(), a: db[opp(A)] });

    // 13 — the corrective save: back to the recorded amount while a newer one is in flight.
    await fresh({}, A);
    await input().fill('310000'); await input().press('Tab');
    await until(async () => noteStarts('Recorded in GHL'), '310000 recorded');
    await input().fill('320000');
    h = hold((r) => r.kind === 'write' && r.target === opp(A) && r.args.value === 320000);
    await input().press('Tab');
    await h.hit;
    await input().fill('310000');
    check('13 while 320000 is in flight, retyped 310000 is a Draft (not "Recorded")', await noteStarts('Draft — not saved yet'), await note());
    await input().press('Tab');
    check('13 its blur queues a save (shown "Saving to GHL…", not de-duped away)', await noteStarts('Saving to GHL…'), await note());
    h.release();
    await until(async () => (await noteStarts('Recorded in GHL')) && db[opp(A)] === 310000, '310000 recorded').catch(() => {});
    check('13 the corrective 310000 is written after 320000 and recorded; GHL holds 310000', writes(opp(A)).map((r) => r.args.value).join() === '310000,320000,310000' && db[opp(A)] === 310000 && (await noteStarts('Recorded in GHL')), { w: writes(opp(A)).map((r) => r.args.value), a: db[opp(A)] });

    // 14 — navigation: A's pending save never delays or labels B; returning to A shows A's own verified amount.
    await fresh({}, A);
    await input().fill('410000');
    h = hold((r) => r.kind === 'write' && r.target === opp(A) && r.args.value === 410000);
    await input().press('Tab');
    await h.hit;
    await go(`/contacts/${B}/seller-call`);
    await until(async () => (await input().inputValue()) === '' && (await page.locator('body').innerText()).includes('Bravo'), 'B on screen').catch(() => {});
    await input().fill('410000'); await input().press('Tab');
    await until(async () => (await noteStarts('Recorded in GHL')) && db[opp(B)] === 410000, 'B recorded').catch(() => {});
    check('14 B saves and records the same amount while A\'s save is still held', (await noteStarts('Recorded in GHL')) && db[opp(B)] === 410000 && db[opp(A)] === null, { note: await note(), a: db[opp(A)], b: db[opp(B)] });
    h.release();
    await until(async () => db[opp(A)] === 410000, 'A applied');
    await page.waitForTimeout(800);
    check('14 A\'s completion leaves B recorded and truthful', (await noteStarts('Recorded in GHL')) && (await truthful(opp(B))), await note());
    await go(`/contacts/${A}/seller-call`);
    await until(async () => (await input().inputValue()) === '410000', 'A restored').catch(() => {});
    await until(async () => noteStarts('Recorded in GHL'), 'A recorded').catch(() => {});
    check('14 back on A: its verified 410000 is restored and recorded', (await input().inputValue()) === '410000' && (await noteStarts('Recorded in GHL')) && (await truthful()), { v: await input().inputValue(), note: await note() });

    const unresolvedShown = async () => (await page.getByTestId('current-offer-unresolved').count()) > 0;

    // 15 — Bones's uncertain-submission reproduction: the $410k write's response is lost and
    //      the request is still on its way; the operator then enters $420k.
    await fresh({ aOffer: 300000 }, A);
    await until(async () => noteStarts('Recorded in GHL'), 'restored 300000');
    await input().fill('410000');
    h = hold((r) => r.kind === 'write' && r.target === opp(A) && r.args.value === 410000); h.lose = 'late';
    h.release();                                   // the browser gets a network failure; GHL has not applied it yet
    await input().press('Tab');
    await until(async () => unresolvedShown(), 'unresolved shown').catch(() => {});
    check('15 a lost response shows the deal as Unresolved, clearly', (await unresolvedShown()) && (await noteStarts('Unresolved')), await note());
    check('15 the input is locked (read-only) for that deal', (await input().isEditable()) === false);
    check('15 nothing is labelled "Recorded in GHL" -- not even the earlier verified 300000', !(await noteStarts('Recorded in GHL')));
    await input().evaluate((el) => el.blur());
    await page.waitForTimeout(500);
    check('15 no further submission is sent for the deal (no retry)', writes(opp(A)).length === 1, writes(opp(A)).map((r) => r.args.value));
    await h.lateWrite();                           // the earlier request reaches the server and lands now
    check('15 setup: GHL now holds 410000 from the late request', db[opp(A)] === 410000);
    await go('/'); await page.waitForTimeout(300);
    await go(`/contacts/${A}/seller-call`);        // leave and come back: a fresh carrier snapshot is read
    await until(async () => (await input().inputValue()) !== '', 'A back').catch(() => {});
    await page.waitForTimeout(500);
    check('15 a snapshot read after navigating back does not clear it: still Unresolved, still locked', (await noteStarts('Unresolved')) && (await input().isEditable()) === false, await note());
    check('15 still exactly one write sent for the deal', writes(opp(A)).length === 1, writes(opp(A)).map((r) => r.args.value));
    await go(`/contacts/${B}/seller-call`);
    await until(async () => (await page.locator('body').innerText()).includes('Bravo'), 'B on screen').catch(() => {});
    await input().fill('410000'); await input().press('Tab');
    await until(async () => (await noteStarts('Recorded in GHL')) && db[opp(B)] === 410000, 'B recorded').catch(() => {});
    check('15 another deal is unaffected: B saves and records', (await noteStarts('Recorded in GHL')) && db[opp(B)] === 410000, { note: await note(), b: db[opp(B)] });

    // 16 — a queued save behind an indeterminate one is dropped, never released.
    await fresh({}, A);
    await input().fill('410000');
    h = hold((r) => r.kind === 'write' && r.target === opp(A) && r.args.value === 410000); h.lose = 'landed';
    await input().press('Tab');
    await h.hit;
    await input().fill('420000'); await input().press('Tab');   // queued behind 410000
    check('16 setup: 420000 is queued, not sent', writesOf(420000) === 0 && (await noteStarts('Saving to GHL…')), await note());
    h.release();                                   // 410000 landed; the response is lost
    await until(async () => unresolvedShown(), 'unresolved').catch(() => {});
    await page.waitForTimeout(800);
    check('16 the queued 420000 is never sent', writesOf(420000) === 0, writes(opp(A)).map((r) => r.args.value));
    check('16 the deal is Unresolved, not Recorded, though GHL happens to hold 410000', (await noteStarts('Unresolved')) && db[opp(A)] === 410000, await note());

    // 17 — a 502 and the server's own "indeterminate" answer are also unresolved; a snapshot readback cannot clear the 202.
    for (const [label, reply, applies] of [
      ['502', { status: 502, body: { error: 'bad gateway' } }, false],
      ['server indeterminate', { status: 409, body: { outcome: 'indeterminate', error: 'Another write is in progress or unresolved; inspect before retrying' } }, true],
    ]) {
      await fresh({}, A);
      await input().fill('410000');
      h = hold((r) => r.kind === 'write' && r.target === opp(A)); h.reply = reply; h.applies = applies; h.release();
      await input().press('Tab');
      await until(async () => unresolvedShown(), `${label} unresolved`).catch(() => {});
      check(`17 ${label}: Unresolved and locked, never "Recorded"`, (await noteStarts('Unresolved')) && (await input().isEditable()) === false, { note: await note(), a: db[opp(A)] });
    }

    // 18 — determinate failures do NOT block: a refusal and a readback failure after a 200 leave the deal usable.
    await fresh({}, A);
    await input().fill('410000');
    refuseNext = 1;
    await input().press('Tab');
    await until(async () => noteStarts('Not saved'), 'refused');
    check('18 a refusal before sending is "Not saved", not Unresolved, and the input stays editable', (await noteStarts('Not saved — nothing was sent to GHL')) && !(await unresolvedShown()) && (await input().isEditable()), await note());
    await input().fill('420000'); await input().press('Tab');
    await until(async () => (await noteStarts('Recorded in GHL')) && db[opp(A)] === 420000, 'recorded after refusal').catch(() => {});
    check('18 the next save proceeds and records', (await noteStarts('Recorded in GHL')) && db[opp(A)] === 420000, { note: await note(), a: db[opp(A)] });

    const harnessUrl = `${base}/scripts/harness/contact-isolation/index.html`;
    const reloadOn = async (pg, c) => {
      /* A full page load: a new JS context with no in-memory state -- exactly
         what a browser reload gives the app. (The harness URL itself is loaded;
         its in-app routes are not served by the offline dev server.) */
      await pg.goto(harnessUrl);
      await pg.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 });
      await pg.evaluate((t) => window.__iaosNavigate(t), '/');
      await pg.waitForTimeout(300);
      await pg.evaluate((t) => window.__iaosNavigate(t), `/contacts/${c}/seller-call`);
      await pg.getByTestId('negotiation-current-offer-input').waitFor({ timeout: 30000 });
    };
    const bodyText = async (pg = page) => pg.locator('body').innerText();
    const noReloadWording = async (pg = page) => !/[Rr]eload/.test(await bodyText(pg));

    // 19 — Bones's reload reproduction (reconstructed from the ruling): reload must preserve Unresolved.
    await fresh({}, A);
    await input().fill('410000');
    h = hold((r) => r.kind === 'write' && r.target === opp(A) && r.args.value === 410000); h.lose = 'late';
    h.release();
    await input().press('Tab');                     // the request leaves; the browser gets a network failure
    await until(async () => unresolvedShown(), 'unresolved').catch(() => {});
    check('19 setup: the request is still on its way -- the deal is Unresolved', (await noteStarts('Unresolved')) && db[opp(A)] === null, await note());
    await reloadOn(page, A);
    await until(async () => unresolvedShown(), 'unresolved after reload').catch(() => {});
    check('19 after a RELOAD the deal is still Unresolved and locked (the durable barrier)', (await unresolvedShown()) && (await input().isEditable()) === false, await note());
    check('19 nothing on the page tells the operator to reload; it offers Check again', (await noReloadWording()) && (await page.getByTestId('current-offer-check-again').count()) === 1);
    const writesBefore19 = writes(opp(A)).length;
    await input().evaluate((el) => el.blur());
    await page.waitForTimeout(400);
    check('19 after the reload nothing is sent for the deal', writes(opp(A)).length === writesBefore19);
    await page.getByTestId('current-offer-check-again').click();
    await until(async () => (await input().isEditable()), 'cleared').catch(() => {});
    check('19 Check again proves the request was never sent (withdrawn) and clears the deal', (await input().isEditable()) && !(await unresolvedShown()), await note());
    const late19 = await h.lateWrite();             // the delayed request finally reaches the server
    check('19 the delayed handler sends NOTHING: refused as not_sent, GHL unchanged', late19.body.outcome === 'not_sent' && db[opp(A)] === null, late19);
    await input().fill('420000'); await input().press('Tab');
    await until(async () => (await noteStarts('Recorded in GHL')) && db[opp(A)] === 420000, '420000 recorded').catch(() => {});
    check('19 the next save is reserved, sent and recorded normally', (await noteStarts('Recorded in GHL')) && db[opp(A)] === 420000, { note: await note(), a: db[opp(A)] });

    // 20 — a sent-and-unresolved save survives a reload; Check again cannot clear it.
    await fresh({}, A);
    await input().fill('410000');
    h = hold((r) => r.kind === 'write' && r.target === opp(A)); h.reply = { status: 409, body: { outcome: 'indeterminate' } }; h.applies = true; h.release();
    await input().press('Tab');
    await until(async () => unresolvedShown(), 'unresolved').catch(() => {});
    await reloadOn(page, A);
    await until(async () => unresolvedShown(), 'unresolved after reload').catch(() => {});
    check('20 the GHL call was made and its answer lost: after a reload, still Unresolved and locked', (await unresolvedShown()) && (await input().isEditable()) === false && db[opp(A)] === 410000, await note());
    await page.getByTestId('current-offer-check-again').click();
    await page.waitForTimeout(800);
    check('20 Check again cannot clear it, even though GHL now shows 410000; it says the save may still reach GHL', (await unresolvedShown()) && /may still reach GHL/.test(await bodyText()) && (await input().isEditable()) === false);
    check('20 no reload wording anywhere', await noReloadWording());

    // 21 — two browsers.
    await fresh({}, A);
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Chicago' });
    const page2 = await ctx2.newPage();
    page2.on('pageerror', (e) => pageErrors.push('browser 2: ' + String(e)));
    await page2.route('**/*', routeHandler);
    await ctx2.route(/gohighlevel\.com/, (rt) => rt.abort());
    const input2 = () => page2.getByTestId('negotiation-current-offer-input');
    const open2 = async () => {
      await page2.goto(harnessUrl);
      await page2.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 });
      await page2.evaluate((t) => window.__iaosNavigate(t), `/contacts/${A}/seller-call`);
      await input2().waitFor({ timeout: 30000 });
    };
    // 21a: browser 1's save is in progress (reserved, request held) when browser 2 opens the deal.
    await input().fill('410000');
    h = hold((r) => r.kind === 'write' && r.target === opp(A) && r.args.value === 410000);
    await input().press('Tab');
    await h.hit;
    await open2();
    await until(async () => (await page2.getByTestId('current-offer-unresolved').count()) > 0, 'browser 2 blocked').catch(() => {});
    check('21 browser 2 sees browser 1\'s save in progress: blocked and locked', (await page2.getByTestId('current-offer-unresolved').count()) > 0 && (await input2().isEditable()) === false);
    const w21 = log.filter((x) => x.kind === 'write').length;
    const b21 = log.filter((x) => x.kind === 'barrier' && x.action === 'begin').length;
    await input2().evaluate((el) => el.blur());
    await page2.waitForTimeout(400);
    check('21 browser 2 sends nothing -- not even a reservation', log.filter((x) => x.kind === 'write').length === w21 && log.filter((x) => x.kind === 'barrier' && x.action === 'begin').length === b21);
    h.release();
    await until(async () => (await noteStarts('Recorded in GHL')) && db[opp(A)] === 410000, 'browser 1 recorded').catch(() => {});
    await page2.getByTestId('current-offer-check-again').click();
    await until(async () => input2().isEditable(), 'browser 2 cleared').catch(() => {});
    check('21 once browser 1\'s save is confirmed, Check again clears browser 2', await input2().isEditable());
    // 21b: browser 1's save is sent and unresolved; browser 2 (and a reload of it) stays blocked.
    await input().fill('420000');
    h = hold((r) => r.kind === 'write' && r.target === opp(A) && r.args.value === 420000); h.reply = { status: 502, body: {} }; h.applies = true; h.release();
    await input().press('Tab');
    await until(async () => unresolvedShown(), 'browser 1 unresolved').catch(() => {});
    await open2();
    await until(async () => (await page2.getByTestId('current-offer-unresolved').count()) > 0, 'browser 2 blocked').catch(() => {});
    check('21 browser 2 opening the deal later sees it Unresolved and locked', (await page2.getByTestId('current-offer-unresolved').count()) > 0 && (await input2().isEditable()) === false && /may still reach GHL/.test(await bodyText(page2)));
    await page2.getByTestId('current-offer-check-again').click();
    await page2.waitForTimeout(800);
    check('21 Check again in browser 2 cannot clear a sent-and-unresolved save', (await input2().isEditable()) === false);
    await ctx2.close();

    // 22 — storage failures block and send nothing.
    await fresh({}, A);
    bf.failStorageOnce((op, key) => op === 'get' && key.startsWith('current-offer/barrier/'));
    await reloadOn(page, A);
    await until(async () => unresolvedShown(), 'status unreadable').catch(() => {});
    check('22 an unreadable status blocks: locked, "could not check", nothing sent', (await unresolvedShown()) && /could not check/.test(await bodyText()) && (await input().isEditable()) === false && writes().length === 0);
    await page.getByTestId('current-offer-check-again').click();
    await until(async () => input().isEditable(), 'cleared').catch(() => {});
    check('22 Check again (storage healthy, nothing reserved) clears it', await input().isEditable());
    bf.failStorageOnce((op, key) => op === 'setJSON' && key.startsWith('current-offer/request/'));
    await input().fill('430000'); await input().press('Tab');
    await until(async () => unresolvedShown(), 'reservation failed').catch(() => {});
    check('22 a reservation that could not be stored blocks and sends nothing', (await unresolvedShown()) && writes().length === 0 && /could not be reserved/.test(await bodyText()));
    await page.getByTestId('current-offer-check-again').click();
    await until(async () => input().isEditable(), 'cleared').catch(() => {});
    check('22 Check again withdraws the partial reservation and clears', await input().isEditable());

    check('no request left the machine', foreign.length === 0, foreign);
    check('no page errors', pageErrors.length === 0, pageErrors);
  } catch (e) {
    console.error(e);
    failures += 1;
  }
  console.log(`\nSeller Call Current Offer interaction: ${checks - failures}/${checks} checks passed`);
  await exit(failures ? 1 : 0);
}
main();
