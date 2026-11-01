/**
 * B15-20b — shared offline fixture for the Seller Call callback-status
 * rendered test and its fictional-data walkthrough.
 *
 * Starts Vite on 127.0.0.1 (an ephemeral port) serving ./index.html (the REAL
 * Contact and Seller Call pages), launches headless Chromium with the page
 * clock installed at a fixed fictional "now", and answers every
 * /.netlify/functions request from an in-memory fixture of FICTIONAL contacts.
 * Seller Call writes run through the REAL durable barrier module
 * (current-offer-barrier-fixture.cjs, as test-contact-isolation does) and land
 * only in memory. Any other request is aborted and counted (`foreign`); any
 * GHL hand-off is aborted and counted (`handoffs`). Nothing leaves the machine.
 *
 * The caller must not run two of these at once (one heavy job at a time).
 */
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');

const APP = path.resolve(__dirname, '../../..');
const HARNESS = 'scripts/harness/seller-call-callback-status/index.html';
const BEFORE_FILE = path.join(__dirname, 'SellerCallBefore.tsx');

if (!Module._extensions['.ts'] || !Module._extensions['.ts'].__b1520b) {
  const hook = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText, filename);
  hook.__b1520b = true;
  Module._extensions['.ts'] = hook;
  Module._resolveFilename = ((original) => function (name, parent, ...rest) {
    if (name.startsWith('.') && parent) {
      const candidate = path.resolve(path.dirname(parent.filename), name + '.ts');
      if (fs.existsSync(candidate)) return candidate;
    }
    return original.call(this, name, parent, ...rest);
  })(Module._resolveFilename);
}
const { getConfig } = require(path.join(APP, 'shared/ghl-config.ts'));
const { parseOutcomeNote } = require(path.join(APP, 'src/lib/seller-call-outcome.ts'));
const { createBarrierFixture } = require(path.join(APP, 'scripts/harness/current-offer-barrier-fixture.cjs'));
const F = getConfig('test').fields;

/**
 * FICTIONAL contacts. `callback` is the stored value of BOTH callback carriers
 * (precise TEXT and DATE), exactly as test-contact-isolation stores them; a
 * non-date string models a stored value that cannot be read as a time.
 */
const PEOPLE = {
  cbToday:    { first: 'Tessa',  last: 'Today',      address1: '101 Fictional Ln', city: 'Waco',   state: 'TX', postalCode: '76701' },
  cbFuture:   { first: 'Felix',  last: 'Future',     address1: '202 Sample St',    city: 'Tyler',  state: 'TX', postalCode: '75701' },
  cbOverdue:  { first: 'Olive',  last: 'Overdue',    address1: '303 Example Ave',  city: 'Temple', state: 'TX', postalCode: '76501' },
  cbNone:     { first: 'Nora',   last: 'None',       address1: '404 Placeholder Rd', city: 'Bryan', state: 'TX', postalCode: '77801' },
  cbBad:      { first: 'Uma',    last: 'Unreadable', address1: '505 Mock Ct',      city: 'Killeen', state: 'TX', postalCode: '76541' },
};

function createFixture() {
  const state = { db: {}, log: [], holds: [], failNext: [], foreign: [], handoffs: [] };
  const bf = createBarrierFixture({ contactOf: (o) => (o.endsWith('-opp') && state.db[o.slice(0, -4)] ? o.slice(0, -4) : null) });

  /** callbacks: { [contactId]: iso | 'unreadable-text' | null } */
  function reset(callbacks = {}) {
    state.db = {};
    for (const [id, p] of Object.entries(PEOPLE)) {
      const cb = Object.prototype.hasOwnProperty.call(callbacks, id) ? callbacks[id] : null;
      const parsed = cb ? Date.parse(cb) : NaN;
      state.db[id] = {
        id, ...p, phone: '+15555550100',
        fields: new Map(cb ? [[F.callbackDatetimePrecise, cb], [F.callbackDatetime, Number.isFinite(parsed) ? parsed : cb]] : []),
        notes: [{ id: `${id}-n1`, body: `Fictional seed note for ${p.first}`, dateAdded: '2026-10-20T12:00:00.000Z' }],
      };
    }
    state.log = []; state.holds = []; state.failNext = []; state.foreign.length = 0; state.handoffs.length = 0;
    bf.reset();
  }
  const field = (c, id) => (c.fields.has(id) ? c.fields.get(id) : null);
  const row = (c) => ({
    id: c.id, firstName: c.first, lastName: c.last, phone: c.phone, email: '', address1: c.address1, city: c.city, state: c.state,
    postalCode: c.postalCode, dateAdded: '2026-10-01T00:00:00.000Z', tags: [], dndSettings: {}, motivationScore: null, dealScore: null,
    combinedScore: null, completenessScore: null, propertyAddress: '',
    callbackDatetime: field(c, F.callbackDatetimePrecise), callbackDatetimePrecise: field(c, F.callbackDatetimePrecise),
    lastCallAttempt: field(c, F.lastCallAttemptPrecise), lastCallAttemptPrecise: field(c, F.lastCallAttemptPrecise),
    callDisposition: field(c, F.callDisposition), dispositionAt: field(c, F.dispositionAt),
  });
  const detail = (c) => ({ contact: { id: c.id, firstName: c.first, lastName: c.last, phone: c.phone, dndSettings: {},
    address1: c.address1, city: c.city, state: c.state, postalCode: c.postalCode,
    customFields: [...c.fields].map(([id, value]) => ({ id, value })) } });
  const pipeline = () => ({
    pipelineId: 'fixture-pipeline', stages: [],
    opportunities: Object.values(state.db).map((c) => ({ id: `${c.id}-opp`, contactId: c.id, contactName: `${c.first} ${c.last}`,
      opportunityName: `${c.first} deal`, phone: '', email: '', stageId: 'fixture-stage', customFields: [] })),
  });
  function applyWrite(op, target, args) {
    const c = state.db[target];
    if (!c) return { status: 404, body: { error: 'unknown target' } };
    const set = (...ids) => ids.forEach((id) => (args.value === null ? c.fields.delete(id) : c.fields.set(id, args.value)));
    switch (op) {
      case 'note.create':
        c.notes.push({ id: `${target}-n${c.notes.length + 1}`, body: args.body, dateAdded: new Date().toISOString() }); return { status: 200, body: { note: { id: 'n' } } };
      case 'contact.disposition': case 'contact.callLogResult': set(F.callDisposition); break;
      case 'contact.routing': set(F.callRouting); break;
      case 'contact.dispositionAt': set(F.dispositionAt); break;
      case 'contact.lastCallAttempt': set(F.lastCallAttempt, F.lastCallAttemptPrecise); break;
      case 'contact.callback': case 'contact.explicitCallback': set(F.callbackDatetime, F.callbackDatetimePrecise); break;
      default: return { status: 400, body: { error: `fixture does not model ${op}` } };
    }
    return { status: 200, body: { confirmed: true } };
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
      case 'notes': return { status: 200, body: { notes: state.db[req.contact].notes.slice() } };
      case 'detail': return { status: 200, body: detail(state.db[req.contact]) };
      case 'row': return { status: 200, body: row(state.db[req.contact]) };
      case 'defs': return { status: 200, body: { customFields: [] } };
      case 'folder': return { status: 200, body: { customField: { id: 'folder', name: 'Folder', position: 0 } } };
      case 'ghl-opportunities': return { status: 200, body: pipeline() };
      case 'ghl-underwriting-policy': return { status: 200, body: { values: [] } };
      case 'ghl-contact-conversations': return { status: 200, body: { messages: [], conversations: [] } };
      default: return { status: 404, body: { error: `fixture does not model ${req.kind}` } };
    }
  }
  /** Holds the first matching request until `release()`; `hit` resolves when it arrives. */
  function hold(match) {
    let release; let onHit;
    const h = { match, used: false, released: new Promise((r) => { release = r; }), hit: new Promise((r) => { onHit = r; }) };
    h.release = release; h.onHit = onHit; state.holds.push(h);
    return h;
  }

  async function start({ before = null, now } = {}) {
    if (fs.existsSync(BEFORE_FILE)) fs.rmSync(BEFORE_FILE);
    if (before) {
      const src = execFileSync('git', ['show', `${before}:app/src/pages/SellerCallWorkspace.tsx`], { cwd: APP, encoding: 'utf8' });
      // Re-point the page's imports from src/pages/ to this folder: parent-relative ones and same-folder ones (its CSS).
      fs.writeFileSync(BEFORE_FILE, src.replace(/from "\.\.\//g, 'from "../../../src/').replace(/(from|import) "\.\//g, '$1 "../../../src/pages/'));
      process.on('exit', () => { if (fs.existsSync(BEFORE_FILE)) fs.rmSync(BEFORE_FILE); });
    }
    const { createServer } = await import('vite');
    const react = (await import('@vitejs/plugin-react')).default;
    const tailwindcss = (await import('@tailwindcss/vite')).default;
    const { chromium } = require('playwright');
    const server = await createServer({
      root: APP, configFile: false, plugins: [react(), tailwindcss()], logLevel: 'error', clearScreen: false,
      server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
      optimizeDeps: { entries: [HARNESS], include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] },
    });
    await server.listen();
    const base = server.resolvedUrls.local[0].replace(/\/$/, '');
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Chicago' });
    const page = await context.newPage();
    await page.clock.install({ time: new Date(now) });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await context.route(/gohighlevel\.com|leadconnectorhq\.com/, (route) => { state.handoffs.push(route.request().url()); return route.abort(); });
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { state.foreign.push(url); return route.abort(); }
      let post = null;
      try { post = route.request().postDataJSON(); } catch { post = null; }
      const req = classify(url, route.request().method(), post);
      state.log.push(req);
      const h = state.holds.find((x) => !x.used && x.match(req));
      if (h) { h.used = true; h.onHit(req); await h.released; }
      if (req.kind === 'call-log-barrier' || req.kind === 'current-offer-barrier') {
        const res = req.kind === 'call-log-barrier' ? await bf.handleCallLog(route.request().method(), url, post) : await bf.handle(route.request().method(), url, post);
        return route.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(res.body) });
      }
      const fi = state.failNext.findIndex((p) => p(req));
      if (fi >= 0) { state.failNext.splice(fi, 1); req.status = 500; return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'fixture: injected failure' }) }); }
      const res = req.kind === 'write'
        ? await bf.write({ operation: req.op, targetId: req.contact, requestId: req.requestId, contactId: req.contact, args: req.args },
          () => { const a = applyWrite(req.op, req.contact, req.args); return { confirmed: a.status === 200 }; },
          { outcome: req.op === 'note.create' ? parseOutcomeNote(req.args.body) : null })
        : answer(req);
      req.status = res.status;
      return route.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(res.body) });
    });
    await page.goto(`${base}/${HARNESS}`);
    await page.waitForFunction(() => typeof window.__iaosNavigate === 'function', null, { timeout: 60000 });
    const stop = async () => {
      await browser.close().catch(() => {}); await server.close().catch(() => {});
      if (fs.existsSync(BEFORE_FILE)) fs.rmSync(BEFORE_FILE);
    };
    return { page, browser, server, base, pageErrors, stop };
  }

  return { state, reset, hold, start, PEOPLE, F };
}

module.exports = { createFixture, PEOPLE };
