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
 *   8. Bones's reproduction: $310,000's readback held, $320,000 saved and read
 *      back, the older response released, $310,000 typed again -> Draft, and
 *      its blur sends its own save;
 *   9. reversed completion order: the older save completes while the newer is
 *      still saving -- it records nothing, the newer then records alone;
 *  10. stale failures after a newer recorded save: an uncertain older result
 *      drops the recorded label (GHL may hold either amount); a refused older
 *      save changes nothing;
 *  11. a newer save in flight: retyping the previously recorded amount is a
 *      draft and its blur sends a save (not de-duped).
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
function classify(url, method, post) {
  const u = new URL(url);
  const fn = u.pathname.replace('/.netlify/functions/', '');
  if (fn === 'ghl-write' && method === 'POST') return { kind: 'write', op: post.operation, target: post.targetId, args: post.args };
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
    await page.route('**/*', async (route) => {
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
      if (req.kind === 'write' && (h ? h.refuse : refuseNext > 0)) {
        if (!h) refuseNext -= 1;
        return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'fixture: write refused' }) });
      }
      if (req.kind === 'opp-read' && failReadbackNext > 0) {
        failReadbackNext -= 1;
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'fixture: readback failed' }) });
      }
      const res = answer(req);
      return route.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(res.body) });
    });
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
    const fresh = async (opts, c) => { resetDb(opts); log = []; holds = []; refuseNext = 0; failReadbackNext = 0; await open(c); };
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
    check('3 a refused save says "Not saved — GHL refused the save"', await noteStarts('Not saved — GHL refused the save'), await note());
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
    await until(async () => noteStarts('Save could not be confirmed'), 'unconfirmed').catch(() => {});
    check('7 an uncertain result says "Save could not be confirmed"', await noteStarts('Save could not be confirmed'), await note());
    check('7 an uncertain result is never "Recorded" and never "Not saved"', !/Recorded in GHL|Not saved/.test((await note()) || ''), await note());
    failReadbackNext = 0;

    const writesOf = (v) => writes(opp(A)).filter((r) => r.args.value === v).length;
    const errCount = () => page.getByTestId('current-offer-write-error').count();

    // 8 — Bones's exact reproduction (a stale success after a newer recorded save).
    await fresh({}, A);
    await input().fill('310000');
    h = hold((r) => r.kind === 'opp-read' && r.target === opp(A)); h.early = true;   // 310000's readback answered, delivery held
    await input().press('Tab');
    await h.hit;
    check('8 setup: 310000 was written and its readback is held', db[opp(A)] === 310000 && writesOf(310000) === 1, db[opp(A)]);
    await input().fill('320000');
    await input().press('Tab');
    await until(async () => (await noteStarts('Recorded in GHL')) && db[opp(A)] === 320000, '320000 recorded');
    check('8 320000 saves and is recorded while 310000 is still pending', await noteStarts('Recorded in GHL'), await note());
    h.release();                                   // the older 310000 response arrives now
    await page.waitForTimeout(800);
    check('8 the late 310000 confirmation shows no error', (await errCount()) === 0);
    await input().fill('310000');                  // operator enters 310000 again
    await until(async () => (await note()) !== null, 'note');
    check('8 retyped 310000 is a Draft (not "Recorded in GHL")', await noteStarts('Draft — not saved yet'), await note());
    await input().press('Tab');
    await until(async () => writesOf(310000) === 2, '310000 re-sent', 8000).catch(() => {});
    check('8 its blur sends its own save of 310000', writesOf(310000) === 2, writes(opp(A)).map((r) => r.args.value));
    await until(async () => noteStarts('Recorded in GHL'), '310000 recorded').catch(() => {});
    check('8 310000 is recorded only after its own confirmed save', (await noteStarts('Recorded in GHL')) && db[opp(A)] === 310000, { note: await note(), a: db[opp(A)] });

    // 9 — reversed completion order: the older save completes while the newer one is still saving.
    await fresh({}, A);
    await input().fill('310000');
    const h310 = hold((r) => r.kind === 'write' && r.target === opp(A) && r.args.value === 310000);
    await input().press('Tab');
    await h310.hit;
    await input().fill('320000');
    const h320 = hold((r) => r.kind === 'write' && r.target === opp(A) && r.args.value === 320000);
    await input().press('Tab');
    await h320.hit;
    h310.release();                                // the older save completes first
    await until(async () => db[opp(A)] === 310000, '310000 applied');
    await page.waitForTimeout(800);
    check('9 the older completion leaves the newer amount "Saving to GHL…"', await noteStarts('Saving to GHL…'), await note());
    h320.release();
    await until(async () => (await noteStarts('Recorded in GHL')) && db[opp(A)] === 320000, '320000 recorded').catch(() => {});
    check('9 the newer amount then records on its own', (await noteStarts('Recorded in GHL')) && db[opp(A)] === 320000, { note: await note(), a: db[opp(A)] });
    await input().fill('310000');
    check('9 retyped 310000 (completed out of turn) is a Draft', await noteStarts('Draft — not saved yet'), await note());
    await input().press('Tab');
    await until(async () => writesOf(310000) === 2, '310000 re-sent', 8000).catch(() => {});
    check('9 and its blur sends its own save', writesOf(310000) === 2, writes(opp(A)).map((r) => r.args.value));

    // 10a — a stale UNCERTAIN failure after a newer recorded save.
    await fresh({}, A);
    await input().fill('310000');
    h = hold((r) => r.kind === 'opp-read' && r.target === opp(A)); h.early = true; h.failRead = true;
    await input().press('Tab');
    await h.hit;
    await input().fill('320000');
    await input().press('Tab');
    await until(async () => noteStarts('Recorded in GHL'), '320000 recorded');
    h.release();                                   // the older readback fails late
    await page.waitForTimeout(800);
    check('10a an older uncertain result shows no error on the newer amount', (await errCount()) === 0 && !/Save could not be confirmed/.test((await note()) || ''), await note());
    check('10a the newer amount is no longer claimed "Recorded" (GHL may hold either)', await noteStarts('Draft — not saved yet'), await note());
    const n320 = writesOf(320000);
    await input().focus();
    await input().press('Tab');
    await until(async () => writesOf(320000) === n320 + 1, '320000 re-sent', 8000).catch(() => {});
    const rec10a = await until(async () => noteStarts('Recorded in GHL'), 'recorded again').then(() => true).catch(() => false);
    check('10a its blur re-saves it, and it is recorded again', writesOf(320000) === n320 + 1 && rec10a, writes(opp(A)).map((r) => r.args.value));

    // 10b — a stale REFUSAL after a newer recorded save: nothing was written, nothing changes.
    await fresh({}, A);
    await input().fill('310000');
    h = hold((r) => r.kind === 'write' && r.target === opp(A) && r.args.value === 310000); h.refuse = true;
    await input().press('Tab');
    await h.hit;
    await input().fill('320000');
    await input().press('Tab');
    await until(async () => noteStarts('Recorded in GHL'), '320000 recorded');
    h.release();                                   // the older save is refused late
    await page.waitForTimeout(800);
    check('10b an older refusal leaves the newer amount "Recorded in GHL", with no error', (await noteStarts('Recorded in GHL')) && (await errCount()) === 0 && db[opp(A)] === 320000, { note: await note(), a: db[opp(A)] });

    // 11 — a newer save in flight: the previously recorded amount is not de-duped.
    await fresh({}, A);
    await input().fill('310000');
    await input().press('Tab');
    await until(async () => noteStarts('Recorded in GHL'), '310000 recorded');
    await input().fill('320000');
    h = hold((r) => r.kind === 'write' && r.target === opp(A) && r.args.value === 320000);
    await input().press('Tab');
    await h.hit;
    await input().fill('310000');
    check('11 while 320000 is in flight, retyped 310000 is a Draft', await noteStarts('Draft — not saved yet'), await note());
    await input().press('Tab');
    await until(async () => writesOf(310000) === 2, '310000 re-sent', 8000).catch(() => {});
    check('11 and its blur sends a save (not de-duped)', writesOf(310000) === 2, writes(opp(A)).map((r) => r.args.value));
    h.release();
    await page.waitForTimeout(800);

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
