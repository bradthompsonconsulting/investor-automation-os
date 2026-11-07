/**
 * B15-27b -- shared runner for the B15-27b suites (offline, headless Chromium).
 *
 * The B15-27 cross-contact pattern (test-b15-27-cross-contact.cjs, unchanged):
 * Vite serves scripts/harness/b15-27b, which renders the REAL Contact page and
 * Seller Call with the real GHL client. Every /.netlify/functions request is
 * answered here from an in-memory fixture; any response can be HELD (so A's
 * write is still pending while the page moves to B, and back), answered with a
 * failure after the hold, or both. The durable Current Offer / call-log
 * barriers are the REAL server modules (current-offer-barrier-fixture.cjs).
 * Nothing leaves the machine.
 *
 * Fixtures:
 *   twoContacts()   contacts A (Alpha) and B (Bravo), one deal each (the
 *                   B15-27 fixture);
 * ctx.refuseNext: the server refuses the next matching write BEFORE sending (not_sent).
 * ctx.abortNext: the next matching request is aborted (a network error in the page).
 * ctx.respondNext: { match, status, body, apply } -- answer the next match with this response; `apply`
 *   lands the write first (a server that wrote to GHL but could not confirm it: 409 indeterminate).
 * twoContacts().reset({ aDeals, bDeals }): a contact may hold two deals ("<First> deal", "<First> deal 2").
 *
 *   readyPlusB()    A = the Offer Ready deal of seller-call-offer-ready-fixture
 *                   (Confirm Accept genuinely enabled) and B (Bravo), a plain
 *                   contact with its own deal. Writes to B are APPLIED and
 *                   logged, so a write against the wrong contact is visible.
 *
 * NEGATIVE CONTROL: --before=<rev> renders <rev>'s ContactWorkspace,
 * SellerCallWorkspace, CallLogControl and (when <rev> has it) contact-drafts,
 * written next to the real files as _b15_27b_before_* and removed on exit.
 */
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');

const APP = path.resolve(__dirname, '..', '..', '..');
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
const { createBarrierFixture } = require('../current-offer-barrier-fixture.cjs');
const { parseOutcomeNote } = require(path.join(APP, 'src/lib/seller-call-outcome.ts'));

const HARNESS = 'scripts/harness/b15-27b';
const A = 'fixtureContactA';
const B = 'fixtureContactB';
const A_CALLBACK = '2026-10-06T15:00:00.000Z';   // Oct 6, 10:00 AM CT
const B_CALLBACK = '2026-10-09T19:30:00.000Z';   // Oct 9, 2:30 PM CT

// ── --before=<rev> ──────────────────────────────────────────────────────────
const beforeArg = process.argv.find((a) => a.startsWith('--before='));
const BEFORE_REV = beforeArg ? beforeArg.slice('--before='.length) : null;
const generated = [];
function prepareEntry() {
  if (!BEFORE_REV) return `${HARNESS}/index.html`;
  const has = (p) => { try { execFileSync('git', ['cat-file', '-e', `${BEFORE_REV}:app/${p}`], { cwd: APP, stdio: 'ignore' }); return true; } catch { return false; } };
  const show = (p) => execFileSync('git', ['show', `${BEFORE_REV}:app/${p}`], { cwd: APP, encoding: 'utf8', maxBuffer: 64 << 20 });
  const write = (rel, body) => { const f = path.join(APP, rel); fs.writeFileSync(f, body); generated.push(f); };
  const swaps = [
    ['src/pages/ContactWorkspace.tsx', 'src/pages/_b15_27b_before_ContactWorkspace.tsx', '../pages/ContactWorkspace', './ContactWorkspace'],
    ['src/pages/SellerCallWorkspace.tsx', 'src/pages/_b15_27b_before_SellerCallWorkspace.tsx', '../pages/SellerCallWorkspace', './SellerCallWorkspace'],
    ['src/components/CallLogControl.tsx', 'src/components/_b15_27b_before_CallLogControl.tsx', '../components/CallLogControl', './CallLogControl'],
    ['src/lib/contact-drafts.ts', 'src/lib/_b15_27b_before_contact-drafts.ts', '../lib/contact-drafts', './contact-drafts'],
  ].filter(([p]) => has(p));
  const rewrite = (body) => {
    for (const [, to, fromPages] of swaps) {
      const base = path.basename(to).replace(/\.tsx?$/, '');
      body = body.split(`"${fromPages}"`).join(`"${path.posix.join(path.posix.dirname(fromPages), base)}"`);
    }
    return body;
  };
  for (const [p, to] of swaps) write(to, rewrite(show(p)));
  const main = fs.readFileSync(path.join(APP, HARNESS, 'main.tsx'), 'utf8')
    .replace('"../../../src/pages/ContactWorkspace"', '"../../../src/pages/_b15_27b_before_ContactWorkspace"')
    .replace('"../../../src/pages/SellerCallWorkspace"', '"../../../src/pages/_b15_27b_before_SellerCallWorkspace"');
  write(`${HARNESS}/_before_main.tsx`, main);
  write(`${HARNESS}/_before.html`, fs.readFileSync(path.join(APP, HARNESS, 'index.html'), 'utf8').replace('./main.tsx', './_before_main.tsx'));
  console.log(`# NEGATIVE CONTROL: rendering ${BEFORE_REV}'s ${swaps.map(([p]) => path.basename(p)).join(', ')}`);
  return `${HARNESS}/_before.html`;
}
const cleanup = () => { for (const f of generated) { try { fs.rmSync(f); } catch { /* already gone */ } } };
process.on('exit', cleanup);

// ── Fixture: two plain contacts (the B15-27 fixture) ────────────────────────
function twoContacts() {
  let db;
  const contact = (id, first, cb) => ({
    id, first, fields: new Map(cb ? [[F.callbackDatetimePrecise, cb], [F.callbackDatetime, Date.parse(cb)]] : []),
    notes: [{ id: `${id}-n1`, body: `Seed note for ${first}`, dateAdded: '2026-09-30T12:00:00.000Z' }],
  });
  const field = (c, fid) => (c.fields.has(fid) ? c.fields.get(fid) : null);
  return {
    name: 'twoContacts',
    reset({ aCallback = null, bCallback = null, aDeals = 1, bDeals = 1 } = {}) { db = { [A]: contact(A, 'Alpha', aCallback), [B]: contact(B, 'Bravo', bCallback) }; db[A].deals = aDeals; db[B].deals = bDeals; },
    get db() { return db; },
    contactOf: (o) => (o === `${A}-opp` || o === `${A}-opp-2` ? A : o === `${B}-opp` || o === `${B}-opp-2` ? B : null),
    precheck: () => null,
    applyWrite(op, target, args) {
      const c = db[target];
      if (!c) return { status: 404, body: { error: 'unknown target' } };
      const set = (...ids) => ids.forEach((fid) => (args.value === null ? c.fields.delete(fid) : c.fields.set(fid, args.value)));
      switch (op) {
        case 'note.create':
          c.notes.push({ id: `${target}-n${c.notes.length + 1}`, body: args.body, dateAdded: new Date().toISOString() }); return { status: 200, body: { note: { id: 'n' } } };
        case 'contact.callLogResult': set(F.callDisposition); break;
        case 'contact.lastCallAttempt': set(F.lastCallAttempt, F.lastCallAttemptPrecise); break;
        case 'contact.callback': case 'contact.explicitCallback': set(F.callbackDatetime, F.callbackDatetimePrecise); break;
        default: return { status: 400, body: { error: `fixture does not model ${op}` } };
      }
      return { status: 200, body: { confirmed: true } };
    },
    answer(req) {
      const c = db[req.contact];
      switch (req.kind) {
        case 'notes': return { status: 200, body: { notes: c.notes.slice() } };
        case 'detail': return { status: 200, body: { contact: { id: c.id, firstName: c.first, lastName: 'Fixture', phone: '+15555550100', dndSettings: {},
          address1: `${c.first} Street 1`, city: 'Austin', state: 'TX', postalCode: '78701', customFields: [...c.fields].map(([fid, value]) => ({ id: fid, value })) } } };
        case 'row': return { status: 200, body: {
          id: c.id, firstName: c.first, lastName: 'Fixture', phone: '+15555550100', email: '', address1: '', city: '', state: '', postalCode: '',
          dateAdded: '2026-09-01T00:00:00.000Z', tags: [], dndSettings: {}, motivationScore: null, dealScore: null, combinedScore: null, completenessScore: null,
          callbackDatetime: field(c, F.callbackDatetimePrecise), callbackDatetimePrecise: field(c, F.callbackDatetimePrecise),
          lastCallAttempt: field(c, F.lastCallAttemptPrecise), lastCallAttemptPrecise: field(c, F.lastCallAttemptPrecise),
          callDisposition: field(c, F.callDisposition), dispositionAt: field(c, F.dispositionAt) } };
        case 'defs': return { status: 200, body: { customFields: [] } };
        case 'folder': return { status: 200, body: { customField: { id: 'folder', name: 'Folder', position: 0 } } };
        case 'ghl-opportunities': return { status: 200, body: { pipelineId: 'fixture-pipeline', stages: [],
          opportunities: [A, B].flatMap((cid) => Array.from({ length: db[cid].deals }, (_, i) => ({ id: i === 0 ? `${cid}-opp` : `${cid}-opp-${i + 1}`, contactId: cid, contactName: db[cid].first,
            opportunityName: i === 0 ? `${db[cid].first} deal` : `${db[cid].first} deal ${i + 1}`, phone: '', email: '', stageId: 'fixture-stage', customFields: [] }))) } };
        case 'ghl-underwriting-policy': return { status: 200, body: { values: [] } };
        case 'ghl-contact-conversations': return { status: 200, body: { messages: [], conversations: [] } };
        default: return { status: 404, body: { error: `fixture does not model ${req.kind}` } };
      }
    },
  };
}

// ── Fixture: the Offer Ready deal (A) plus a plain contact B ────────────────
function readyPlusB() {
  const fx = require('../seller-call-offer-ready-fixture.cjs');
  const RA = fx.CONTACT;
  let bState;
  const bOpp = `${B}-opp`;
  return {
    name: 'readyPlusB', fx, A: RA, A_OPP: fx.OPP, B, B_OPP: bOpp,
    reset(opts = {}) { fx.reset(opts); bState = { fields: [], notes: [{ id: 'b-n1', body: 'Seed note for Bravo', dateAdded: '2026-09-30T12:00:00.000Z' }] }; },
    get b() { return bState; },
    contactOf: (o) => (o === fx.OPP ? RA : o === bOpp ? B : null),
    precheck(req) {
      if (req.contact === B) return null;
      const pre = fx.precheckWrite({ op: req.op, target: req.contact, args: req.args });
      return pre ? { status: pre.status, error: pre.body.error } : null;
    },
    applyWrite(op, target, args) {
      if (target === B || target === bOpp) {
        if (op === 'note.create') bState.notes.push({ id: `b-n${bState.notes.length + 1}`, body: args.body, dateAdded: new Date().toISOString() });
        if (op === 'contact.lastCallAttempt') {
          bState.fields = bState.fields.filter((f) => f.id !== F.lastCallAttempt && f.id !== F.lastCallAttemptPrecise);
          bState.fields.push({ id: F.lastCallAttempt, value: args.value.slice(0, 10) }, { id: F.lastCallAttemptPrecise, value: args.value });
        }
        return { status: 200, body: { confirmed: true } };
      }
      fx.applyWrite({ op, target, args });
      return { status: 200, body: { confirmed: true } };
    },
    answer(req) {
      if (req.contact === B) {
        if (req.kind === 'notes') return { status: 200, body: { notes: bState.notes.map((x) => ({ ...x })) } };
        if (req.kind === 'detail') return { status: 200, body: { contact: { id: B, firstName: 'Bravo', lastName: 'Fixture', phone: '+15555550101', customFields: bState.fields.map((f) => ({ ...f })) } } };
        if (req.kind === 'row') return { status: 200, body: { id: B, firstName: 'Bravo', lastName: 'Fixture', phone: '+15555550101', tags: [] } };
      }
      if (req.kind === 'opp-read' && req.target === bOpp) return { status: 200, body: { opportunity: { id: bOpp, contactId: B, customFields: [] } } };
      const res = fx.answer({ ...req, target: req.target });
      if (req.kind === 'ghl-opportunities') {
        res.body.opportunities = [...res.body.opportunities, { id: bOpp, contactId: B, contactName: 'Bravo', opportunityName: 'Bravo deal', phone: '', email: '', stageId: 'fixture-stage', customFields: [] }];
      }
      return res;
    },
  };
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
    if ((m = p.match(/^\/opportunities\/([^/?]+)$/))) return { kind: 'opp-read', target: m[1] };
    if (/\/customFields\/[^/]+$/.test(p)) return { kind: 'folder' };
    if (/\/customFields$/.test(p)) return { kind: 'defs' };
    return { kind: 'proxy-other', path: p };
  }
  if (fn === 'ghl-contact') return { kind: 'row', contact: u.searchParams.get('id') };
  return { kind: fn };
}

/**
 * Runs one suite. `scenarios(ctx)` drives the page; `floor` is the minimum number of checks.
 */
async function run({ title, floor, fixture, scenarios }) {
  let checks = 0;
  let failures = 0;
  const check = (name, ok, detail) => {
    checks += 1;
    if (!ok) failures += 1;
    console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
  };
  const entry = prepareEntry();
  const bf = createBarrierFixture({ contactOf: fixture.contactOf });
  const ctx = { A, B, A_CALLBACK, B_CALLBACK, F, fixture, bf, check, log: [], holds: [], failNext: [], refuseNext: [], abortNext: [], respondNext: [], foreign: [], pageErrors: [] };
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const { chromium } = require('playwright');
  const server = await createServer({
    root: APP, configFile: false, plugins: [react()], logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: [entry], include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] },
  });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const exit = async (code) => { await browser.close().catch(() => {}); await server.close().catch(() => {}); cleanup(); process.exit(code); };
  const watchdog = setTimeout(() => { console.error('FAIL  watchdog: suite exceeded 8 minutes'); exit(1); }, 8 * 60 * 1000);
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Chicago' });
    const page = await context.newPage();
    ctx.page = page;
    page.on('pageerror', (e) => ctx.pageErrors.push(String(e)));
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { ctx.foreign.push(url); return route.abort(); }
      let post = null;
      try { post = route.request().postDataJSON(); } catch { post = null; }
      const method = route.request().method();
      const req = classify(url, method, post);
      if (req.kind === 'current-offer-barrier' || req.kind === 'call-log-barrier') req.post = post;
      ctx.log.push(req);
      const h = ctx.holds.find((x) => !x.used && x.match(req));
      if (h) { h.used = true; h.onHit(req); await h.released; }
      const fulfill = (res) => { req.status = res.status; req.done = true; return route.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(res.body) }); };
      if (req.kind === 'call-log-barrier') return fulfill(await bf.handleCallLog(method, url, post));
      if (req.kind === 'current-offer-barrier') return fulfill(await bf.handle(method, url, post));
      const ai = ctx.abortNext.findIndex((p) => p(req));
      if (ai >= 0) { ctx.abortNext.splice(ai, 1); req.done = true; req.status = 'aborted'; return route.abort('failed'); }
      const ri2 = ctx.respondNext.findIndex((x) => x.match(req));
      if (ri2 >= 0) {
        const x = ctx.respondNext.splice(ri2, 1)[0];
        if (x.apply && req.kind === 'write') fixture.applyWrite(req.op, req.contact, req.args);
        return fulfill({ status: x.status, body: x.body });
      }
      const fi = ctx.failNext.findIndex((p) => p(req));
      if (fi >= 0) { ctx.failNext.splice(fi, 1); return fulfill({ status: 500, body: { error: 'fixture: injected failure' } }); }
      if (req.kind === 'write') {
        const ri = ctx.refuseNext.findIndex((p) => p(req));
        const pre = ri >= 0 ? (ctx.refuseNext.splice(ri, 1), { status: 409, error: 'fixture: refused before sending' }) : fixture.precheck(req);
        return fulfill(await bf.write({ operation: req.op, targetId: req.contact, requestId: req.requestId, contactId: fixture.contactOf(req.contact) ?? req.contact, args: req.args },
          () => { const a = fixture.applyWrite(req.op, req.contact, req.args); return { confirmed: a.status === 200 }; },
          { outcome: req.op === 'note.create' ? parseOutcomeNote(req.args.body) : null, refuse: pre }));
      }
      return fulfill(fixture.answer(req));
    });
    await context.route(/gohighlevel\.com/, (route) => route.abort());

    // ── helpers ──
    ctx.hold = (match) => {
      let release; let hitResolve;
      const h = { match, released: new Promise((r) => { release = r; }), hit: new Promise((r) => { hitResolve = r; }) };
      h.release = release; h.onHit = hitResolve; ctx.holds.push(h);
      return h;
    };
    ctx.isWrite = (op, contact) => (r) => r.kind === 'write' && r.op === op && r.contact === contact;
    ctx.holdThenFail = (op, contact) => { ctx.failNext.push(ctx.isWrite(op, contact)); return ctx.hold(ctx.isWrite(op, contact)); };
    ctx.writes = (contact) => ctx.log.filter((r) => r.kind === 'write' && (!contact || r.contact === contact));
    ctx.opsFor = (contact) => ctx.writes(contact).map((r) => r.op);
    ctx.doneWrites = (contact, op) => ctx.log.filter((r) => r.kind === 'write' && r.contact === contact && r.op === op && r.done).length;
    ctx.text = () => page.locator('body').innerText();
    ctx.allText = () => page.locator('body').textContent();
    ctx.settle = (ms = 400) => page.waitForTimeout(ms);
    ctx.until = async (fn, label, ms = 15000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(50); }
      throw new Error(`timed out waiting for ${label}`);
    };
    ctx.go = (to) => page.evaluate((t) => window.__iaosNavigate(t), to);
    /** A full document load of the harness (new JS state; browser storage kept), then `to`. */
    ctx.load = async (to, op = 'operator-one') => {
      await page.goto(`${base}/${entry}?op=${encodeURIComponent(op)}`);
      await page.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 });
      if (to) await ctx.go(to);
    };
    ctx.setOperator = (op) => page.evaluate((o) => window.__iaosSetOperator(o), op);
    ctx.clearStorage = () => page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { /* none */ } });
    /** Fresh fixture, request log and browser storage, then a document load on `to`. */
    ctx.fresh = async (opts, to, op) => {
      fixture.reset(opts); ctx.log.length = 0; ctx.holds.length = 0; ctx.failNext.length = 0; ctx.refuseNext.length = 0; ctx.abortNext.length = 0; ctx.respondNext.length = 0; bf.reset();
      await ctx.load(null, op);
      await ctx.clearStorage();
      await ctx.load(to, op);
    };
    /** Calls a rendered element's React prop handler directly (past a disabled control). */
    ctx.invokeProp = (locator, prop, arg) => locator.evaluate((el, [p, a]) => {
      const key = Object.keys(el).find((k) => k.startsWith('__reactProps$'));
      if (!key || typeof el[key][p] !== 'function') return false;
      el[key][p](a === '__el__' ? { currentTarget: el, target: el } : a ?? {}); return true;
    }, [prop, arg]);

    await scenarios(ctx);

    check('no request left the machine', ctx.foreign.length === 0, ctx.foreign.slice(0, 5));
    check('no page errors', ctx.pageErrors.length === 0, ctx.pageErrors.slice(0, 5));
  } catch (e) {
    check(`suite ran to completion (${e.message.split('\n')[0]})`, false);
  }
  clearTimeout(watchdog);
  if (checks < floor) check(`at least ${floor} checks ran`, false, checks);
  console.log(`\n${title}: ${checks - failures}/${checks} checks passed${BEFORE_REV ? ` (negative control vs ${BEFORE_REV})` : ''}`);
  await exit(failures === 0 ? 0 : 1);
}

module.exports = { run, twoContacts, readyPlusB, A, B, A_CALLBACK, B_CALLBACK, F, BEFORE_REV };
