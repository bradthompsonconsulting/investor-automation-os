/**
 * B15-29 (INV-137) -- single-flight session status, design r1–r6 (Bones ACCEPT). Real Layout + OneLoginAccess + the
 * REAL Dashboard (scripts/harness/one-login-dashboard), offline. Every /.netlify/functions request is answered here
 * from fictional fixtures; any response can be HELD and released by the script in a chosen order. The page clock is
 * Playwright's fake clock, paused: a backoff fires only when the script advances it (deterministic, never wall-clock).
 * Harness-only instrumentation (VITE_IAOS_STATUS_PROBE=1): window.__iaosStatusProbe and window.__iaosStatusTrace.
 *
 * Rows (ids from the design): D1 D2p D3 D4p D5 D6 D7 D8a D8b D9 D10 D11 D12 D13 D14 D15 D16 D17 D18 D19 D20
 * D21a D21b D21c D22a D22b D22c D23p D24 D25p D25q D26T D26S D27a D27b ST1 ST2 BUILD.
 *
 *   node scripts/test-b15-29-status-single-flight.cjs                     all rows, unmutated (every row must pass)
 *   node scripts/test-b15-29-status-single-flight.cjs --controls          every mutation control (see MUTATIONS)
 *   node scripts/test-b15-29-status-single-flight.cjs --mutate=<name>     one control (its target rows only)
 *   --layer=no-refusal-invalidate                                         the fixed D22b/D22c configuration
 *   --rows=D1,D4p                                                         run only these rows (diagnostics)
 *
 * A control PASSES iff every row it targets FAILS (with the required trace record where one is specified); rows it
 * does not target are run only as setup and not evaluated. The unmutated run must pass ALL rows.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const APP = path.resolve(__dirname, '..');
const HARNESS = '/scripts/harness/one-login-dashboard/index.html';
const OLA = path.join(APP, 'src/components/OneLoginAccess.tsx');
const READ_SESSION = path.join(APP, 'src/lib/read-session.ts');

const arg = (k) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const MUTATE = arg('mutate');
const LAYER = arg('layer');
const ONLY = arg('rows') ? arg('rows').split(',') : null;
const CONTROLS = process.argv.includes('--controls');
const EFFECTIVE_LAYER = () => LAYER || (MUTATE && MUTATIONS[MUTATE] && MUTATIONS[MUTATE].layer) || null;

// ── mutations: exact-text rewrites served in memory (each must match exactly the stated number of times) ──
const R = (file, find, repl, count = 1) => ({ file, find, repl, count });
const LAYERS = {
  'no-refusal-invalidate': [R(OLA, '      if (cur.kind === "flight") cur.f.invalidated = true;\n', '')],
};
const MUTATIONS = {
  'unowned-cleanup':          { targets: ['D8a'], edits: [R(OLA, 'if (s.kind !== "flight" || s.f !== f) return;   // not the owner: no write of any kind', 'if (s.kind !== "flight") return;')] },
  'old-gen-applies':          { targets: ['D7'], edits: [R(OLA, 'if (f.g !== generation.current || frozen.current || s < appliedSeq.current) return;', 'if (frozen.current || s < appliedSeq.current) return;')] },
  'backoff-not-occupied':     { targets: ['D4p', 'D14'], edits: [R(OLA, '    if (s.kind === "scheduled") { setSlot({ ...s, queued: merge(s.queued, item) }, "request:merge-queued"); return; }\n', '')] },
  'no-cancel-on-signout':     { targets: ['D9'], edits: [R(OLA, '    cancelSlot("signout");\n', '')] },
  'no-cancel-on-signin':      { targets: ['D10'], edits: [R(OLA, '      cancelSlot("signin");\n', '')] },
  'no-cancel-on-unmount':     { targets: ['D11'], edits: [R(OLA, 'return () => { unmountedRef.current = true; cancelSlot("unmount"); };', 'return () => { unmountedRef.current = true; };')] },
  'idle-refusals-not-counted':{ targets: ['D5'], edits: [R(OLA, '      refusals.current += 1;\n', '      if (slotRef.current.kind === "flight") refusals.current += 1;\n')] },
  'fresh-resets-exhaustion':  { targets: ['D6', 'D24'], edits: [R(OLA, 'if (cls === "reset") { refusals.current = 0; exhausted.current = false; }', 'if (cls !== "refusal") { refusals.current = 0; exhausted.current = false; }')] },
  'apply-invalidated-success':{ targets: ['D2p'], edits: [R(OLA, '    if (r.kind === "signed_in" && (f.invalidated || f.preExhaustion)) return;   // a stale success never confirms a session\n', '')] },
  'no-finally':               { targets: ['D12', 'D13'], edits: [R(OLA, '      try { apply(f, s, r); } finally { complete(f); }', '      apply(f, s, r); if (r.kind !== "unavailable") complete(f);')] },
  'skip-reader-when-signed-in': { targets: ['D1', 'D19'], edits: [R(READ_SESSION, '  const res = await fetch(url, { ...init, credentials: "same-origin" });',
    '  const res = sessionStorage.getItem("iaos.one-login.operator") ? new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }) : await fetch(url, { ...init, credentials: "same-origin" });')] },
  'no-invalidate-on-exhaust': { layer: 'no-refusal-invalidate', targets: ['D22b'], edits: [R(OLA, '      s.f.invalidated = true;\n      s.f.preExhaustion = true;\n', '')] },
  'exhaust-keeps-refusal-work': { targets: ['D23p'], edits: [R(OLA, 'if (!(s.queued.fresh && !halted() && s.g === generation.current)) {', 'if (false) {')] },
  'exhaust-cancels-fresh':    { targets: ['D25p'], edits: [R(OLA, 'if (!(s.queued.fresh && !halted() && s.g === generation.current)) {', 'if (true) {')] },
  'drop-fresh-on-exhaust':    { targets: ['D25q'], edits: [R(OLA, 'if (pendingRef.current && !pendingRef.current.fresh) setPending(null, "exhaust:pending-clear");', 'if (pendingRef.current) setPending(null, "exhaust:pending-clear");')] },
  'no-fire-time-eligibility': { targets: ['D27a'], edits: [R(OLA, '    if (eligible(q, s.g)) void fx.start(q);\n', '    void fx.start(q);\n')] },
  'dual-holder':              { targets: ['D4p', 'D26S'], edits: [R(OLA, '    if (s.kind === "scheduled") { setSlot({ ...s, queued: merge(s.queued, item) }, "request:merge-queued"); return; }',
    '    if (s.kind === "scheduled") { setSlot({ ...s, queued: merge(s.queued, item) }, "request:merge-queued"); setPending(merge(pendingRef.current, item), "request:merge-pending"); return; }')] },
  'capture-after-idle':       { targets: ['D4p'], edits: [R(OLA, '    const q = s.queued;   // captured before the slot is released\n    setSlot({ kind: "idle" }, "fire:slot-idle");',
    '    setSlot({ kind: "idle" }, "fire:slot-idle");\n    const q = (slotRef.current as any).queued;')] },
  'no-unmount-guard':         { targets: ['D21a', 'D21b', 'D21c'], record: { D21a: ['adoptSession', 'setStatus'], D21b: ['setStatus'], D21c: ['setStatus'] },
    edits: [R(OLA, '    if (unmountedRef.current) return;\n    // Discarded:', '    // Discarded:'), R(OLA, '    if (unmountedRef.current) return;\n    const s = slotRef.current;\n    if (s.kind !== "flight" || s.f !== f) return;', '    const s = slotRef.current;\n    if (s.kind !== "flight" || s.f !== f) return;'),
      R(OLA, '      if (unmountedRef.current) return;\n      const r: StatusResult', '      const r: StatusResult')] },
  'idle-before-pending-clear':{ targets: ['D26T'], i1Site: 'complete:slot-idle', edits: [R(OLA, '    const q = pendingRef.current;\n    setPending(null, "complete:pending-clear");\n    setSlot({ kind: "idle" }, "complete:slot-idle");',
    '    setSlot({ kind: "idle" }, "complete:slot-idle");\n    const q = pendingRef.current;\n    setPending(null, "complete:pending-clear");')] },
  'catch-bypasses-apply':     { targets: ['D21b'], record: { D21b: ['setStatus'] }, edits: [R(OLA, 'catch { ctxFlight.current = f.id; res = null; }', 'catch { ctxFlight.current = f.id; fx.setStatus({ kind: "unavailable", message: UNAVAILABLE_TEXT }); res = null; }')] },
  'json-bypasses-apply':      { targets: ['D21c'], record: { D21c: ['setStatus'] }, edits: [R(OLA, '.catch(() => { ctxFlight.current = f.id; return JSON_FAILED; })', '.catch(() => { ctxFlight.current = f.id; fx.setStatus({ kind: "unavailable", message: UNAVAILABLE_TEXT }); return JSON_FAILED; })')] },
  // r5 structural controls (Bones, review of 64a0959): a deliberate bypass must be caught by the structural row.
  'bypass-ownership-setter':  { targets: ['ST1'], edits: [R(OLA, '    setSlot({ kind: "idle" }, "complete:slot-idle");', '    slotRef.current = { kind: "idle" };')] },
  'bypass-apply-wrapper':     { targets: ['ST2'], edits: [R(OLA, '    if (r.kind === "unavailable") { fx.setStatus({ kind: "unavailable", message: UNAVAILABLE_TEXT }); return; }',
    '    if (r.kind === "unavailable") { setStatusRaw({ kind: "unavailable", message: UNAVAILABLE_TEXT }); return; }')] },
  'bypass-handle-write':      { targets: ['ST2'], edits: [R(OLA, '    fx.setHandle(null);\n    fx.setStatus({ kind: "signed_out", reason: r.reason });', '    handle.current = null;\n    fx.setStatus({ kind: "signed_out", reason: r.reason });')] },
  'scheduled-merge-new-timer':{ targets: ['D4p'], edits: [R(OLA, '    if (s.kind === "scheduled") { setSlot({ ...s, queued: merge(s.queued, item) }, "request:merge-queued"); return; }',
    '    if (s.kind === "scheduled") { clearTimeout(s.timer); fx.schedule(merge(s.queued, item), 1000, "request:merge-queued"); return; }')] },
};

if (CONTROLS) {
  // Each control in its own process (a fresh Vite module graph per mutation).
  let bad = 0; const lines = [];
  for (const name of Object.keys(MUTATIONS)) {
    const r = spawnSync(process.execPath, [__filename, `--mutate=${name}`], { cwd: path.resolve(APP, '..'), encoding: 'utf8', env: process.env, timeout: 15 * 60_000 });
    const last = (r.stdout || '').trim().split('\n').filter((l) => l.startsWith('CONTROL ')).pop() || `CONTROL ${name} NO-RESULT rc=${r.status}`;
    fs.writeFileSync(path.join(process.env.SF_CONTROL_LOG_DIR || require('node:os').tmpdir(), `control-${name}.log`), (r.stdout || '') + (r.stderr || ''));
    lines.push(`${last} rc=${r.status}`); console.log(lines[lines.length - 1]);
    if (r.status !== 0) bad += 1;
  }
  console.log(`\nB15-29 single-flight controls: ${lines.length - bad}/${lines.length} controls caught their target`);
  process.exit(bad ? 1 : 0);
}

const edits = [...(LAYER ? LAYERS[LAYER] || [] : []), ...(MUTATE ? [...(MUTATIONS[MUTATE].layer ? LAYERS[MUTATIONS[MUTATE].layer] : []), ...MUTATIONS[MUTATE].edits] : [])];
if (MUTATE && !MUTATIONS[MUTATE]) { console.error(`FAILED: unknown --mutate=${MUTATE}`); process.exit(2); }
if (LAYER && !LAYERS[LAYER]) { console.error(`FAILED: unknown --layer=${LAYER}`); process.exit(2); }
const rewrite = {};
for (const e of edits) {
  const src = rewrite[e.file] ?? fs.readFileSync(e.file, 'utf8').replace(/\r\n/g, '\n');
  const n = src.split(e.find).length - 1;
  if (n !== e.count) { console.error(`FAILED: a ${MUTATE || LAYER} edit matched ${n} times, expected ${e.count}: ${JSON.stringify(e.find.slice(0, 80))}`); process.exit(2); }
  rewrite[e.file] = src.split(e.find).join(e.repl);
}
const inMemory = { name: 'b15-29-sf-mutate', enforce: 'pre', load(id) { const f = path.resolve(id.split('?')[0]); return rewrite[f] ?? null; } };

// ── results ──
const results = [];   // { id, ok, detail }
function row(id, ok, detail) { results.push({ id, ok: !!ok, detail }); console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${id}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`); }
const watchdog = setTimeout(() => { console.error('FAIL  did not finish within 14 minutes'); process.exit(1); }, 14 * 60_000);

// ── fixtures ──
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const MAILERS = { weekStartCT: TODAY, weekEndCT: TODAY, thisWeekReady: [], thisWeekBusiness: [], overdue: [], noAddress: [], totals: { ready: 0, business: 0, overdue: 0, noAddress: 0, byMailerType: {} } };
const CONTACTS = [{ id: 'c1', firstName: 'Lee', lastName: 'Example', phone: '+15555551001', email: '', address1: '1 Example St', city: 'Sampletown', state: 'TX', postalCode: '75000',
  dateAdded: '2026-09-01T00:00:00.000Z', tags: [], dndSettings: {}, motivationScore: null, dealScore: null, combinedScore: null, completenessScore: null,
  callbackDatetime: null, callbackDatetimePrecise: null, lastCallAttempt: null, lastCallAttemptPrecise: null, callDisposition: null, dispositionAt: null }];
const READERS = ['ghl-contacts', 'ghl-mailers', 'ghl-opportunities', 'ghl-conversations'];
const signedIn = (op = 'opA', session = 's1', handle = 'h1') => ({ status: 200, json: { state: 'signed_in', signedIn: true, handle, expiresAt: new Date(Date.now() + 3600_000).toISOString(), operator: op, session } });
const REVOKED = { status: 200, json: { state: 'revoked', signedIn: false } };
const SIGNED_OUT = { status: 200, json: { state: 'signed_out', signedIn: false } };
const UNAVAIL = { status: 503, json: { error: 'unavailable', by: 'iaos-session-unavailable' } };
const READ_401 = { status: 401, json: { error: 'Read sign-in required', by: 'iaos-app-read-auth' } };
const TOKEN_OK = { status: 200, json: { token: 'offline-token', expiresInSeconds: 900 } };
const ABORT = { abort: true };
const BAD_JSON = { status: 200, raw: 'not json {' };

async function main() {
  const { createServer } = await import('vite');
  const react = (await import('@vitejs/plugin-react')).default;
  const tailwindcss = (await import('@tailwindcss/vite')).default;
  const { chromium } = require('playwright');
  const server = await createServer({
    root: APP, configFile: false, plugins: [inMemory, react(), tailwindcss()], logLevel: 'error', clearScreen: false,
    define: { 'import.meta.env.VITE_IAOS_STATUS_PROBE': JSON.stringify('1') },
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    optimizeDeps: { entries: [HARNESS.slice(1)], include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] },
  });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  const foreign = []; const pageErrors = [];

  /** One isolated browser context = one independent session (separate cookie jar and storage). */
  async function newSession(tag) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, timezoneId: 'America/Chicago' });
    const net = { log: [], held: [], answer: {}, queue: {} };
    // default answers, overridable per function: answer[fn] = spec | (req) => spec ; queue[fn] = [spec, ...] (consumed first)
    net.answer['app-read-session'] = signedIn();
    net.answer['app-write-token'] = TOKEN_OK;
    net.answer['app-signout'] = { status: 200, json: { state: 'revoked' } };
    net.answer['ghl-contacts'] = { status: 200, json: CONTACTS };
    net.answer['ghl-mailers'] = { status: 200, json: MAILERS };
    net.answer['ghl-opportunities'] = { status: 200, json: { pipelineId: 'fixture-pipeline', stages: [], opportunities: [] } };
    net.answer['ghl-conversations'] = { status: 200, json: [] };
    net.answer['ghl-underwriting-policy'] = { status: 200, json: { values: [] } };
    net.answer['call-log-barrier'] = { status: 200, json: { entries: [] } };
    await ctx.route('**/*', async (route) => {
      const req = route.request(); const url = req.url();
      if (url.endsWith('/app-read-login.html')) return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>login</title>' });
      if (url.startsWith(base) && !url.includes('/.netlify/functions/')) return route.continue();
      if (!url.includes('/.netlify/functions/')) { foreign.push(url); return route.abort(); }
      const fn = new URL(url).pathname.replace(/^.*\/\.netlify\/functions\//, '');
      const entry = { tag, fn, method: req.method(), n: net.log.length };
      net.log.push(entry);
      const q = net.queue[fn];
      let spec = q && q.length ? q.shift() : net.answer[fn];
      if (typeof spec === 'function') spec = spec(entry);
      if (spec && spec.hold) {
        const h = { fn, entry, route, released: false };
        h.promise = new Promise((r) => { h.release = (s) => { h.released = true; r(s); }; });
        net.held.push(h);
        spec = await h.promise;
      }
      entry.answered = spec ? (spec.abort ? 'abort' : spec.status) : 404;
      entry.state = spec && spec.json && spec.json.state;
      if (!spec) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: `unmodelled ${fn}` }) });
      if (spec.abort) return route.abort();
      return route.fulfill({ status: spec.status, contentType: 'application/json', body: spec.raw !== undefined ? spec.raw : JSON.stringify(spec.json) });
    });
    return { ctx, net, tag };
  }
  async function openTab(S) {
    const page = await S.ctx.newPage();
    page.on('pageerror', (e) => pageErrors.push(`${S.tag}: ${String(e)}`));
    await page.clock.install({ time: new Date() });
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    await page.goto(`${base}${HARNESS}`);
    return page;
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(40); } return false; };
  /** Let the page run every macrotask already queued (React commits, fetch continuations); no timer is advanced. */
  const settle = async (p, n = 3) => { for (let i = 0; i < n; i += 1) { await p.evaluate(() => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); })).catch(() => {}); await sleep(30); } };
  const probe = (p) => p.evaluate(() => { const x = window.__iaosStatusProbe; return x ? { slotKind: x.slotKind, pendingHeld: x.pendingHeld, queuedHeld: x.queuedHeld, queued: x.queued, refusals: x.refusals, exhausted: x.exhausted, scheduledId: x.scheduledId, timersArmed: x.timersArmed, currentFlightId: x.currentFlightId } : null; });
  const trace = (p) => p.evaluate(() => (window.__iaosStatusTrace || []).slice());
  const statusGets = (S) => S.net.log.filter((e) => e.fn === 'app-read-session').length;
  const count = (S, fn) => S.net.log.filter((e) => e.fn === fn).length;
  const holdNext = (S, fn) => { (S.net.queue[fn] ||= []).push({ hold: true }); };
  const heldOf = (S, fn) => S.net.held.filter((h) => h.fn === fn && !h.released);
  const waitHeld = (S, fn, k = 1) => until(() => heldOf(S, fn).length >= k);
  const release = async (S, fn, spec, p) => { const h = heldOf(S, fn)[0]; if (!h) throw new Error(`nothing held for ${fn}`); h.release(spec); await until(() => h.entry.answered !== undefined); if (p) await settle(p); };
  const shown = (p, id) => p.getByTestId(id).first().isVisible().catch(() => false);
  /** The status line's Sign out (DOM click: Playwright's 'stable' wait needs animation frames, which the paused clock holds). */
  const clickSignOut = (p) => p.getByTestId('read-access-signed-in').locator('button').first().evaluate((b) => b.click());
  const tick = async (p, ms) => { await p.clock.runFor(ms); await settle(p); };
  const fire = async (p, ev) => { await p.evaluate((e) => (e === 'visibilitychange' ? document : window).dispatchEvent(new Event(e)), ev); await settle(p); };
  const LOST = 'iaos-read-session-lost';
  const UNAV_EV = 'iaos-session-unavailable';
  /** Cold start to a signed-in Dashboard whose readers have all answered (status 1, readers 200, prime 200). */
  async function signedInDashboard(S) {
    const p = await openTab(S);
    await until(() => shown(p, 'read-access-signed-in'));
    await until(() => READERS.every((fn) => count(S, fn) >= 1));
    await settle(p, 5);
    return p;
  }
  const samples = { S: [] };   // D26′-S
  const sample = async (p, where) => { const x = await probe(p); if (x) samples.S.push({ where, ...x }); return x; };
  const i1 = async (p) => (await trace(p)).filter((r) => r.rule === 'I-1');
  const i1Feed = [];   // D26′-T: every I-1 record from the D4′ / D23′ / D25′ / D27 scripts

  // ════════════════════════════════════ rows ════════════════════════════════════
  const ROWS = {};

  ROWS.D1 = async () => {
    const S = await newSession('D1'); const p = await signedInDashboard(S);
    const readers = Object.fromEntries(READERS.map((fn) => [fn, count(S, fn)]));
    row('D1', statusGets(S) === 1 && READERS.every((fn) => readers[fn] >= 1) && await shown(p, 'read-access-signed-in'),
      { statusGets: statusGets(S), readers });
    await S.ctx.close();
  };

  /**
   * RB (r3): the only source-reachable Dashboard reader burst WHILE revalidating. Cold signed_in (readers 200) -> the
   * saving-token prime answers 503 session-unavailable (T5) -> status F1 = unavailable (the page lapses) -> "Try again"
   * (a reset) -> F2 = signed_in -> epoch++ -> the Dashboard re-runs its 4 readers, which are HELD. Prime after F2: 200.
   */
  async function rb(S, { holdF2 = false } = {}) {
    S.net.queue['app-write-token'] = [UNAVAIL];
    S.net.queue['app-read-session'] = [signedIn(), UNAVAIL];
    const p = await openTab(S);
    await until(() => shown(p, 'one-login-try-again'));
    await until(() => READERS.every((fn) => S.net.log.some((e) => e.fn === fn && e.answered !== undefined)));
    await settle(p, 4);
    for (const fn of READERS) (S.net.queue[fn] ||= []).push({ hold: true });
    if (holdF2) holdNext(S, 'app-read-session');
    const base = statusGets(S);
    await p.getByTestId('one-login-try-again').first().click();
    let idF2 = null;
    if (holdF2) { await waitHeld(S, 'app-read-session'); idF2 = (await probe(p)).currentFlightId; await release(S, 'app-read-session', signedIn(), p); }
    await until(() => shown(p, 'read-access-signed-in'));
    await until(() => READERS.every((fn) => heldOf(S, fn).length >= 1));
    await settle(p, 4);
    return { p, base, idF2 };
  }
  const releaseReader = (S, fn, spec, p) => release(S, fn, spec || S.net.answer[fn], p);
  /** D4′ steps 1–4: a reachable refusal-only scheduled backoff (scheduledId k). Returns the probe state. */
  async function toScheduled(S) {
    const r = await rb(S);
    holdNext(S, 'app-read-session');
    await releaseReader(S, 'ghl-contacts', READ_401, r.p);            // R1 401 -> refusal 1 while idle -> F3 at once
    await waitHeld(S, 'app-read-session');
    const s1 = await sample(r.p, 'D4p.F3');
    await releaseReader(S, 'ghl-mailers', READ_401, r.p);             // R2 401 during F3 -> refusals 2, F3 invalidated, pending
    const s2 = await sample(r.p, 'D4p.pending');
    const appWriteBefore = count(S, 'app-write-token');
    await release(S, 'app-read-session', signedIn('opA', 's1', 'hX'), r.p);   // F3 answers signed_in: NOT applied
    const s3 = await sample(r.p, 'D4p.scheduled');
    return { ...r, s1, s2, s3, appWriteBefore };
  }

  ROWS.D2p = async () => {
    const S = await newSession('D2p'); const { p, base } = await rb(S);
    holdNext(S, 'app-read-session');
    await fire(p, 'focus');                                          // F3 (fresh), held
    await waitHeld(S, 'app-read-session');
    const idF3 = (await probe(p)).currentFlightId;
    for (const fn of READERS) await releaseReader(S, fn, UNAVAIL, p);  // 4 x T5 -> refusals 4 -> exhaustion at the 3rd
    const tokBefore = count(S, 'app-write-token');
    await release(S, 'app-read-session', signedIn('opA', 's1', 'hF3'), p);
    await tick(p, 3000);
    const t = await trace(p); const x = await probe(p);
    const adoptedF3 = t.some((r) => r.rule === 'apply' && r.flight === idF3 && ['adoptSession', 'setHandle'].includes(r.op));
    row('D2p', statusGets(S) - base === 2 && x.exhausted === true && !adoptedF3 && count(S, 'app-write-token') === tokBefore &&
      await shown(p, 'read-access-recovery') && !(await shown(p, 'read-access-signed-in')),
      { statusSinceTryAgain: statusGets(S) - base, exhausted: x.exhausted, adoptedF3, tokBefore, tok: count(S, 'app-write-token') });
    await S.ctx.close();
  };

  ROWS.D3 = async () => {
    const S = await newSession('D3'); const p = await signedInDashboard(S);
    const b = statusGets(S);
    await fire(p, LOST);
    const x = await probe(p);
    row('D3', statusGets(S) === b + 1 && x.refusals === 1, { sent: statusGets(S) - b, refusals: x.refusals });
    await S.ctx.close();
  };

  ROWS.D4p = async () => {
    const S = await newSession('D4p'); const r = await toScheduled(S); const p = r.p;
    const k = r.s3.scheduledId;
    const b = statusGets(S);
    await fire(p, 'visibilitychange');                               // a trigger that needs no reader
    const s4 = await sample(p, 'D4p.merged');
    await tick(p, 999); const before = statusGets(S) - b;
    await tick(p, 1); const at = statusGets(S) - b;
    const started = (await trace(p)).filter((x) => x.rule === 'apply' && x.op === 'start').pop();   // the fired request carries the merged queued item
    for (const fn of ['ghl-opportunities', 'ghl-conversations']) await releaseReader(S, fn, null, p);
    await settle(p);
    const ok = r.s1.slotKind === 'flight' && r.s2.pendingHeld === true &&
      r.s3.slotKind === 'scheduled' && typeof k === 'number' && r.s3.pendingHeld === false && r.s3.queuedHeld === true && r.s3.timersArmed === 1 &&
      s4.scheduledId === k && s4.timersArmed === 1 && s4.pendingHeld === false && s4.queued && s4.queued.reason === 'ended' && s4.queued.fresh === true &&
      before === 0 && at === 1 && !!started && !!started.item && started.item.reason === 'ended' && started.item.fresh === true;
    row('D4p', ok, { s1: r.s1.slotKind, s2: r.s2.pendingHeld, s3: r.s3, s4, before, at, startedItem: started && started.item });
    i1Feed.push(...await i1(p));
    await S.ctx.close();
  };

  ROWS.D5 = async () => {
    const S = await newSession('D5'); const p = await signedInDashboard(S);
    const b = statusGets(S);
    await fire(p, UNAV_EV);                                          // refusal 1 while idle -> G1 at once
    await until(() => statusGets(S) === b + 1); await settle(p);
    await fire(p, UNAV_EV);                                          // refusal 2 BETWEEN flights -> backoff
    await tick(p, 1000); await until(() => statusGets(S) === b + 2, 3000); await settle(p);
    await fire(p, UNAV_EV);                                          // refusal 3 -> exhausted
    await tick(p, 3000);
    const x = await probe(p);
    row('D5', statusGets(S) - b === 2 && x.exhausted === true && await shown(p, 'read-access-recovery'), { sent: statusGets(S) - b, refusals: x.refusals, exhausted: x.exhausted });
    await S.ctx.close();
  };

  ROWS.D6 = async () => {
    const S = await newSession('D6');
    S.net.answer['app-write-token'] = UNAVAIL;                        // every prime -> T5
    const p = await openTab(S);
    await until(() => statusGets(S) >= 2); await settle(p, 4);
    await tick(p, 1000); await settle(p, 4);
    await tick(p, 3000); await settle(p, 4);
    const x1 = await probe(p); const loop = statusGets(S);
    S.net.queue['app-read-session'] = [UNAVAIL];
    await fire(p, 'focus');                                          // fresh while exhausted: exactly 1 GET, no reset
    await settle(p, 4);
    const x2 = await probe(p); const afterFocus = statusGets(S);
    S.net.answer['app-write-token'] = TOKEN_OK;
    await until(() => shown(p, 'one-login-try-again'));
    await p.getByTestId('one-login-try-again').first().click();
    await settle(p, 4);
    const x3 = await probe(p);
    row('D6', loop === 1 + 2 && x1.exhausted === true && afterFocus === loop + 1 && x2.exhausted === true && statusGets(S) === afterFocus + 1 && x3.exhausted === false,
      { loop, exhausted1: x1.exhausted, afterFocus, exhausted2: x2.exhausted, total: statusGets(S), exhausted3: x3.exhausted });
    await S.ctx.close();
  };

  /** D7 / D8: a sign-in replaces the generation while the old flight F1 is still held; F2 is held too. */
  async function overlap(S) {
    const p = await signedInDashboard(S);
    S.net.queue['app-read-session'] = [REVOKED];
    await fire(p, 'focus');
    await until(() => shown(p, 'one-login-sign-in'));
    holdNext(S, 'app-read-session');
    await fire(p, 'focus');
    await waitHeld(S, 'app-read-session');
    const idF1 = (await probe(p)).currentFlightId;
    holdNext(S, 'app-read-session');
    const [popup] = await Promise.all([p.waitForEvent('popup'), p.getByTestId('one-login-sign-in').first().click()]);
    await popup.evaluate(() => window.opener.postMessage({ type: 'iaos-app-read-signed-in' }, location.origin));
    await waitHeld(S, 'app-read-session', 2);
    await settle(p);
    const idF2 = (await probe(p)).currentFlightId;
    return { p, idF1, idF2 };
  }
  const appliedFor = (t, id) => t.filter((r) => r.rule === 'apply' && r.flight === id && !['start', 'schedule'].includes(r.op));
  ROWS.D7 = async () => {
    const S = await newSession('D7'); const { p, idF1, idF2 } = await overlap(S);
    const n = statusGets(S);
    await release(S, 'app-read-session', signedIn('opA', 'sOld', 'hOld'), p);   // OLD first, while F2 owns the slot
    const t = await trace(p);
    const stillOut = await shown(p, 'read-access-recovery') && !(await shown(p, 'read-access-signed-in'));
    await release(S, 'app-read-session', signedIn('opA', 'sNew', 'hNew'), p);
    await until(() => shown(p, 'read-access-signed-in'));
    row('D7', idF1 !== idF2 && appliedFor(t, idF1).length === 0 && stillOut && statusGets(S) === n && await shown(p, 'read-access-signed-in'),
      { idF1, idF2, appliedF1: appliedFor(t, idF1).map((r) => r.op), stillOut, extra: statusGets(S) - n });
    await S.ctx.close();
  };
  ROWS.D8a = async () => {
    const S = await newSession('D8a'); const { p, idF1, idF2 } = await overlap(S);
    const n = statusGets(S);
    await release(S, 'app-read-session', signedIn('opA', 'sOld', 'hOld'), p);
    const x = await probe(p);
    row('D8a', x.slotKind === 'flight' && x.currentFlightId === idF2 && x.pendingHeld === false && statusGets(S) === n, { idF1, idF2, probe: x, extra: statusGets(S) - n });
    await release(S, 'app-read-session', signedIn('opA', 'sNew', 'hNew'), p);
    await S.ctx.close();
  };
  ROWS.D8b = async () => {
    const S = await newSession('D8b'); const { p, idF1, idF2 } = await overlap(S);
    const n = statusGets(S);
    const hOld = heldOf(S, 'app-read-session')[0]; const hNew = heldOf(S, 'app-read-session')[1];
    hNew.release(signedIn('opA', 'sNew', 'hNew')); await until(() => hNew.entry.answered !== undefined); await settle(p);
    await until(() => shown(p, 'read-access-signed-in'));
    const x1 = await probe(p);
    hOld.release(signedIn('opA', 'sOld', 'hOld')); await until(() => hOld.entry.answered !== undefined); await settle(p);
    await tick(p, 2000);
    const t = await trace(p); const x2 = await probe(p);
    row('D8b', x1.slotKind === 'idle' && appliedFor(t, idF1).length === 0 && x2.slotKind === 'idle' && x2.timersArmed === 0 && statusGets(S) === n && await shown(p, 'read-access-signed-in'),
      { idF1, idF2, x1: x1.slotKind, appliedF1: appliedFor(t, idF1).map((r) => r.op), x2, extra: statusGets(S) - n });
    await S.ctx.close();
  };

  /** A refusal-only scheduled backoff on a signed-in Dashboard via two refusal events (state-machine rows). */
  async function scheduledByEvents(S, p) {
    await fire(p, LOST); await until(() => !!S.net.log.filter((e) => e.fn === 'app-read-session').slice(-1)[0].answered); await settle(p, 3);
    await fire(p, LOST);
    return probe(p);
  }
  ROWS.D9 = async () => {
    const S = await newSession('D9'); const p = await signedInDashboard(S);
    const x0 = await scheduledByEvents(S, p);
    const n = statusGets(S);
    await clickSignOut(p);
    await until(() => count(S, 'app-signout') === 1); await settle(p, 4);
    const x1 = await probe(p);
    await tick(p, 2000);
    row('D9', x0.slotKind === 'scheduled' && x0.timersArmed === 1 && x1.timersArmed === 0 && x1.slotKind === 'idle' && statusGets(S) === n,
      { x0: x0.slotKind, armed0: x0.timersArmed, x1, extra: statusGets(S) - n });
    await S.ctx.close();
  };
  ROWS.D10 = async () => {
    const S = await newSession('D10'); const p = await signedInDashboard(S);
    S.net.queue['app-read-session'] = [REVOKED, REVOKED];
    await fire(p, 'focus'); await until(() => shown(p, 'one-login-sign-in'));
    const x0 = await scheduledByEvents(S, p);
    const n = statusGets(S);
    const [popup] = await Promise.all([p.waitForEvent('popup'), p.getByTestId('one-login-sign-in').first().click()]);
    await popup.evaluate(() => window.opener.postMessage({ type: 'iaos-app-read-signed-in' }, location.origin));
    await until(() => statusGets(S) === n + 1); await settle(p, 3);
    const x1 = await probe(p);
    await tick(p, 2000);
    row('D10', x0.slotKind === 'scheduled' && x1.timersArmed === 0 && statusGets(S) === n + 1, { x0: x0.slotKind, x1, sent: statusGets(S) - n });
    await S.ctx.close();
  };
  ROWS.D11 = async () => {
    const S = await newSession('D11'); const p = await signedInDashboard(S);
    const x0 = await scheduledByEvents(S, p);
    const n = statusGets(S);
    await p.evaluate(() => window.__iaosNavigate('/away')); await until(() => shown(p, 'away')); await settle(p, 3);
    const x1 = await probe(p);
    await tick(p, 2000);
    row('D11', x0.slotKind === 'scheduled' && x1.timersArmed === 0 && statusGets(S) === n, { x0: x0.slotKind, x1, extra: statusGets(S) - n });
    await S.ctx.close();
  };
  for (const [id, spec] of [['D12', ABORT], ['D13', BAD_JSON]]) {
    ROWS[id] = async () => {
      const S = await newSession(id);
      S.net.queue['app-read-session'] = [spec];
      const p = await openTab(S);
      const shownTry = await until(() => shown(p, 'one-login-try-again'), 8000);
      await settle(p, 3);
      const x = await probe(p); const tok = count(S, 'app-write-token'); const n = statusGets(S);
      if (shownTry) await p.getByTestId('one-login-try-again').first().click();
      await settle(p, 4);
      row(id, shownTry && x.slotKind === 'idle' && tok === 0 && statusGets(S) === n + 1 && await until(() => shown(p, 'read-access-signed-in'), 5000),
        { shownTry, slot: x && x.slotKind, tok, sentAfterTryAgain: statusGets(S) - n });
      await S.ctx.close();
    };
  }
  ROWS.D14 = async () => {
    const S = await newSession('D14'); const p = await signedInDashboard(S);
    const n = statusGets(S);
    holdNext(S, 'app-read-session');
    await p.evaluate((ev) => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event(ev)); window.dispatchEvent(new Event(ev)); }, UNAV_EV);
    await settle(p);
    const atOnce = statusGets(S) - n; const x0 = await probe(p);
    await release(S, 'app-read-session', signedIn('opA', 's1', 'h14'), p);
    await fire(p, 'focus');                                          // during the backoff: must merge, not send
    const during = statusGets(S) - n;
    await tick(p, 1000);
    const total = statusGets(S) - n;
    row('D14', atOnce === 1 && x0.refusals === 2 && during === 1 && total === 2, { atOnce, refusals: x0.refusals, during, total });
    await S.ctx.close();
  };
  ROWS.D15 = async () => {
    const S = await newSession('D15'); const p = await signedInDashboard(S);
    const n = statusGets(S);
    await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); window.dispatchEvent(new Event('focus')); });
    await settle(p);
    row('D15', statusGets(S) === n, { sent: statusGets(S) - n });
    await S.ctx.close();
  };
  ROWS.D16 = async () => {
    const S = await newSession('D16'); const p = await signedInDashboard(S);
    S.net.answer['app-signout'] = { status: 500, json: { error: 'fixture' } };
    await clickSignOut(p);
    await until(() => shown(p, 'one-login-retry-sign-out'));
    const n = statusGets(S);
    for (const ev of ['focus', LOST, UNAV_EV]) await fire(p, ev);
    await fire(p, 'visibilitychange');
    await tick(p, 3000);
    row('D16', statusGets(S) === n, { sent: statusGets(S) - n });
    await S.ctx.close();
  };
  ROWS.D17 = async () => {
    const S = await newSession('D17');
    const A = await signedInDashboard(S); const nA = statusGets(S);
    const B = await signedInDashboard(S); const nB = statusGets(S);
    await clickSignOut(A);
    await until(() => count(S, 'app-signout') === 1); await settle(A, 3);
    S.net.queue['app-read-session'] = [SIGNED_OUT];
    const n = statusGets(S);
    await fire(B, LOST);
    await until(() => shown(B, 'read-access-recovery'));
    row('D17', nA === 1 && nB === 2 && statusGets(S) === n + 1 && await shown(B, 'read-access-recovery') && !(await shown(B, 'read-access-signed-in')),
      { coldA: nA, coldB: nB - nA, bSent: statusGets(S) - n });
    await S.ctx.close();
  };
  ROWS.D18 = async () => {
    const SA = await newSession('D18A'); const SB = await newSession('D18B');
    SB.net.answer['app-read-session'] = signedIn('opB', 'sB', 'hB');
    const A = await signedInDashboard(SA); const B = await signedInDashboard(SB);
    for (let i = 0; i < 3; i += 1) { await fire(A, LOST); await tick(A, 1000); }
    const xa = await probe(A); const xb = await probe(B);
    row('D18', xa.exhausted === true && xb.refusals === 0 && xb.exhausted === false && statusGets(SB) === 1 && await shown(B, 'read-access-signed-in'),
      { a: { exhausted: xa.exhausted, refusals: xa.refusals }, b: { exhausted: xb.exhausted, refusals: xb.refusals, gets: statusGets(SB) } });
    await SA.ctx.close(); await SB.ctx.close();
  };
  ROWS.D19 = async () => {
    const S = await newSession('D19');
    S.net.queue['ghl-conversations'] = [READ_401];
    const p = await openTab(S);
    await until(() => READERS.every((fn) => count(S, fn) >= 1)); await until(() => statusGets(S) >= 2, 5000); await settle(p, 4);
    row('D19', READERS.every((fn) => count(S, fn) >= 1) && statusGets(S) === 2, { readers: Object.fromEntries(READERS.map((fn) => [fn, count(S, fn)])), statusGets: statusGets(S) });
    await S.ctx.close();
  };

  /*
   * r5 structural enforcement (Bones, review of 64a0959), on the source actually served (mutations included):
   * ST1 ownership: `slotRef.current =` and `pendingRef.current =` are assigned ONLY inside setSlot / setPending.
   * ST2 application wrappers: every raw state setter / side effect is called ONLY inside the `raw` table, and
   *     `handle.current =` / `appliedSeq.current =` are assigned only there -- so no response-application path can
   *     bypass the traced `fx` wrappers.
   */
  const servedOla = () => (rewrite[OLA] ?? fs.readFileSync(OLA, 'utf8')).replace(/\r\n/g, '\n');
  ROWS.ST1 = async () => {
    const lines = servedOla().split('\n');
    const hits = lines.map((l, i) => [i + 1, l]).filter(([, l]) => /\b(slotRef|pendingRef)\.current\s*=(?!=)/.test(l));
    const allowed = hits.every(([, l]) => /^\s*function (setSlot|setPending)\(/.test(l));
    row('ST1', hits.length === 2 && allowed, { hits: hits.map(([n, l]) => `${n}: ${l.trim().slice(0, 90)}`) });
  };
  ROWS.ST2 = async () => {
    const lines = servedOla().split('\n');
    const start = lines.findIndex((l) => /^\s*const raw: Fx = \{/.test(l));
    const end = start < 0 ? -1 : lines.findIndex((l, i) => i > start && /^\s*\};\s*$/.test(l));
    const inRaw = (i) => i > start && i < end;
    const RAW = ['setStatusRaw', 'setPartitionRaw', 'setAccountChangedRaw', 'adoptSessionRaw', 'scheduleRaw', 'startRaw',
      'primeAppWriteSession', 'confirmAppWriteSession', 'replaceAppWriteSession', 'clearOperatorScopedData', 'rememberOperator'];
    const bad = [];
    lines.forEach((l, i) => {
      for (const n of RAW) {
        const re = new RegExp(`(?<![\\w.])${n}\\(`, 'g');
        if (re.test(l) && !inRaw(i) && !new RegExp(`function ${n}\\(`).test(l)) bad.push(`${i + 1}: ${n}`);
      }
      if (/\b(handle|appliedSeq)\.current\s*=(?!=)/.test(l) && !inRaw(i)) bad.push(`${i + 1}: ${l.trim().slice(0, 60)}`);
    });
    row('ST2', start > 0 && end > start && bad.length === 0, { rawTable: [start + 1, end + 1], bad });
  };
  ROWS.D20 = async () => {
    const S = await newSession('D20'); const p = await signedInDashboard(S);
    holdNext(S, 'app-read-session');
    await fire(p, 'focus'); await waitHeld(S, 'app-read-session');
    await fire(p, LOST);
    const n = statusGets(S);
    await release(S, 'app-read-session', REVOKED, p);
    const revokedShown = await until(() => shown(p, 'read-access-recovery'), 5000);
    await tick(p, 1000);
    row('D20', revokedShown && statusGets(S) === n + 1, { revokedShown, trailing: statusGets(S) - n });
    await S.ctx.close();
  };

  const attribution = {};
  for (const [id, spec] of [['D21a', signedIn('opB', 'sX', 'hX')], ['D21b', ABORT], ['D21c', BAD_JSON]]) {
    ROWS[id] = async () => {
      const S = await newSession(id); const { p, idF2 } = await rb(S, { holdF2: true });
      for (const fn of READERS) await releaseReader(S, fn, null, p);
      await settle(p, 3);
      const t0 = await trace(p);
      const positive = ['setStatus', 'adoptSession'].every((op) => t0.some((r) => r.rule === 'apply' && r.op === op && r.flight === idF2 && r.unmounted === false));
      holdNext(S, 'app-read-session');
      await fire(p, 'focus'); await waitHeld(S, 'app-read-session');
      const idH = (await probe(p)).currentFlightId;
      const storage = () => p.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]));
      const snap = await storage(); const gets = statusGets(S); const tok = count(S, 'app-write-token');
      await p.evaluate(() => window.__iaosNavigate('/away')); await until(() => shown(p, 'away')); await settle(p, 3);
      const mark = (await trace(p)).length;
      await release(S, 'app-read-session', spec, p);
      await settle(p, 4); await tick(p, 5000);
      const after = (await trace(p)).slice(mark);
      const prohibited = after.filter((r) => r.rule === 'apply' && r.unmounted === true);
      attribution[id] = { idH, prohibited };
      const x = await probe(p);
      const T = prohibited.length === 0 && after.filter((r) => r.flight === idH && r.rule === 'apply').every((r) => r.unmounted === false);
      const N = statusGets(S) === gets && count(S, 'app-write-token') === tok;
      const L = (await storage()) === snap;
      const C = x.timersArmed === 0;
      const Ech = after.filter((r) => r.rule === 'report').length === 0;
      await p.evaluate(() => window.__iaosNavigate('/')); await settle(p, 4);
      const Rm = await until(() => statusGets(S) === gets + 1, 5000);
      row(id, positive && idH !== idF2 && T && N && L && C && Ech && Rm,
        { positive, idF2, idH, T, prohibited: prohibited.map((r) => `${r.op}@${r.flight}`), N, L, C, E: Ech, R: Rm });
      await S.ctx.close();
    };
  }

  /** D22: exhaustion protection, alone (layer) and combined. */
  async function d22(S, refusalsN) {
    const p = await signedInDashboard(S);
    holdNext(S, 'app-read-session');
    await fire(p, 'focus'); await waitHeld(S, 'app-read-session');
    const idF = (await probe(p)).currentFlightId;
    for (let i = 0; i < refusalsN; i += 1) await fire(p, LOST);
    await release(S, 'app-read-session', signedIn('opA', 's1', 'h22'), p);
    const t = await trace(p);
    return { p, adopted: t.some((r) => r.rule === 'apply' && r.flight === idF && r.op === 'adoptSession') };
  }
  if (!EFFECTIVE_LAYER()) ROWS.D22a = async () => { const S = await newSession('D22a'); const r = await d22(S, 3); row('D22a', !r.adopted, r.adopted); await S.ctx.close(); };
  if (EFFECTIVE_LAYER() === 'no-refusal-invalidate') {
    ROWS.D22b = async () => { const S = await newSession('D22b'); const r = await d22(S, 3); row('D22b', !r.adopted && await shown(r.p, 'read-access-recovery'), { adopted: r.adopted }); await S.ctx.close(); };
    ROWS.D22c = async () => { const S = await newSession('D22c'); const r = await d22(S, 2); row('D22c', r.adopted, { adopted: r.adopted }); await S.ctx.close(); };
  }

  ROWS.D23p = async () => {
    const S = await newSession('D23p'); const r = await toScheduled(S); const p = r.p;
    const n = statusGets(S);
    await releaseReader(S, 'ghl-opportunities', READ_401, p);         // refusal 3 -> exhaustion; refusal-only work cancelled
    const x = await sample(p, 'D23p.exhausted');
    await tick(p, 2000);
    row('D23p', x.exhausted === true && x.timersArmed === 0 && x.slotKind === 'idle' && x.scheduledId === null && statusGets(S) === n, { x, extra: statusGets(S) - n });
    i1Feed.push(...await i1(p));
    await S.ctx.close();
  };
  ROWS.D24 = async () => {
    const S = await newSession('D24'); const p = await signedInDashboard(S);
    for (let i = 0; i < 3; i += 1) { await fire(p, LOST); await tick(p, 1000); }
    const x0 = await probe(p); const n = statusGets(S);
    await fire(p, 'focus'); await settle(p, 3);
    const x1 = await probe(p); const signed = await shown(p, 'read-access-signed-in');
    await fire(p, UNAV_EV); await tick(p, 2000);
    const afterRefusal = statusGets(S);
    S.net.queue['app-read-session'] = [UNAVAIL];
    await fire(p, 'focus'); await until(() => shown(p, 'one-login-try-again'), 5000);
    await p.getByTestId('one-login-try-again').first().click(); await settle(p, 4);
    const x2 = await probe(p);
    row('D24', x0.exhausted && n + 1 === afterRefusal && x1.exhausted === true && signed && statusGets(S) === n + 3 && x2.exhausted === false,
      { x0: x0.exhausted, focusSent: afterRefusal - n, x1: x1.exhausted, signed, total: statusGets(S) - n, x2: x2.exhausted });
    await S.ctx.close();
  };
  ROWS.D25p = async () => {
    const S = await newSession('D25p'); const r = await toScheduled(S); const p = r.p;
    const k = r.s3.scheduledId;
    await fire(p, 'visibilitychange');                               // the scheduled work becomes fresh
    await releaseReader(S, 'ghl-opportunities', READ_401, p);         // refusal 3 -> exhaustion; fresh work KEPT
    const x = await sample(p, 'D25p.exhausted');
    const n = statusGets(S);
    await tick(p, 1000);
    await settle(p, 4);
    const y = await probe(p);
    row('D25p', x.exhausted === true && x.scheduledId === k && x.timersArmed === 1 && statusGets(S) === n + 1 && await shown(p, 'read-access-signed-in') && y.exhausted === true,
      { k, x, sent: statusGets(S) - n, exhaustedAfter: y.exhausted });
    i1Feed.push(...await i1(p));
    await S.ctx.close();
  };
  ROWS.D25q = async () => {
    const S = await newSession('D25q'); const p = await signedInDashboard(S);
    holdNext(S, 'app-read-session');
    await fire(p, LOST); await waitHeld(S, 'app-read-session');       // refusal 1 -> F at once (held)
    await fire(p, 'focus');                                          // fresh -> pending
    await fire(p, LOST); await fire(p, LOST);                        // refusals 2, 3 -> exhaustion; fresh pending KEPT
    const x = await probe(p); const n = statusGets(S);
    await release(S, 'app-read-session', signedIn('opA', 's1', 'hq'), p);
    await tick(p, 1000);
    row('D25q', x.exhausted === true && x.pendingHeld === true && statusGets(S) === n + 1, { x, sent: statusGets(S) - n });
    await S.ctx.close();
  };
  for (const id of ['D27a', 'D27b']) {
    ROWS[id] = async () => {
      const S = await newSession(id); const r = await toScheduled(S); const p = r.p;
      const k = r.s3.scheduledId;
      if (id === 'D27a') await p.evaluate(() => window.__iaosStatusProbe.bumpGenerationOnly());
      const x0 = await sample(p, `${id}.pre`);
      const n = statusGets(S);
      await tick(p, 1000);
      const x1 = await sample(p, `${id}.post`);
      const want = id === 'D27a' ? 0 : 1;
      row(id, x0.scheduledId === k && x0.timersArmed === 1 && statusGets(S) - n === want && (id === 'D27b' || x1.slotKind === 'idle'), { k, x0, sent: statusGets(S) - n, x1: x1.slotKind });
      i1Feed.push(...await i1(p));
      await S.ctx.close();
    };
  }
  ROWS.D26T = async () => {
    const site = MUTATE && MUTATIONS[MUTATE].i1Site;
    row('D26T', i1Feed.length === 0, { records: i1Feed.slice(0, 5), total: i1Feed.length });
    attribution.D26T = { i1: i1Feed.slice() };
    if (site) attribution.D26T.site = site;
  };
  ROWS.D26S = async () => {
    const bad = samples.S.filter((x) => (x.pendingHeld && x.slotKind !== 'flight') || x.timersArmed > 1);
    row('D26S', samples.S.length > 0 && bad.length === 0, { samples: samples.S.length, bad: bad.slice(0, 3) });
  };
  if (!MUTATE && !LAYER) {
    ROWS.BUILD = async () => {
      const { build } = await import('vite');
      const out = path.join(require('node:os').tmpdir(), `b15-29-sf-dist-${process.pid}`);
      await build({ root: APP, logLevel: 'error', build: { outDir: out, emptyOutDir: true } });
      const files = []; (function walk(d) { for (const f of fs.readdirSync(d)) { const q = path.join(d, f); if (fs.statSync(q).isDirectory()) walk(q); else files.push(q); } })(out);
      const hits = {};
      for (const s of ['__iaosStatusTrace', '__iaosStatusProbe', 'bumpGenerationOnly', 'VITE_IAOS_STATUS_PROBE', 'complete:slot-idle', 'request:merge-pending']) {
        hits[s] = files.filter((f) => fs.readFileSync(f, 'latin1').includes(s)).length;
      }
      fs.rmSync(out, { recursive: true, force: true });
      row('BUILD', files.length > 0 && Object.values(hits).every((n) => n === 0), { files: files.length, hits });
    };
  }

  // ── run ──
  const order = Object.keys(ROWS);
  let want = MUTATE ? MUTATIONS[MUTATE].targets.slice() : ONLY || order;
  // D26 aggregates the I-1 records and probe samples of these scripts: they run first as setup when D26 is wanted.
  if (want.some((w) => w.startsWith('D26'))) want = [...new Set([...want, 'D4p', 'D23p', 'D25p', 'D27a', 'D27b'])];
  for (const id of order) {
    if (!want.includes(id)) continue;
    try { await ROWS[id](); } catch (e) { row(id, false, `threw: ${String(e && e.message || e).split('\n')[0]}`); }
  }
  // The D22b / D22c rows need the fixed layer: in the full unmutated run they run in a child process and are merged.
  if (!MUTATE && !LAYER && !ONLY) {
    const r = spawnSync(process.execPath, [__filename, '--layer=no-refusal-invalidate', '--rows=D22b,D22c'], { cwd: path.resolve(APP, '..'), encoding: 'utf8', env: process.env, timeout: 10 * 60_000 });
    for (const l of (r.stdout + r.stderr).split('\n')) {
      const m = l.match(/^(PASS|FAIL)  (D22[bc])(.*)$/);
      if (m) row(`${m[2]}`, m[1] === 'PASS', m[3].trim() || undefined);
    }
    if (!results.some((x) => x.id === 'D22b') || !results.some((x) => x.id === 'D22c')) row('D22bc-layer-run', false, `child rc=${r.status}`);
  }
  clearTimeout(watchdog);
  await browser.close().catch(() => {}); await server.close().catch(() => {});
  if (MUTATE) {
    const t = MUTATIONS[MUTATE].targets;
    const failed = t.filter((id) => results.some((r) => r.id === id && !r.ok));
    const missing = t.filter((id) => !results.some((r) => r.id === id));
    const ok = failed.length === t.length && missing.length === 0 && attributionOk();
    console.log(`CONTROL ${MUTATE} ${ok ? 'CAUGHT' : 'NOT-CAUGHT'} targets=${t.join(',')} failedTargeted=${failed.join(',') || '-'} otherFailures=${results.filter((r) => !r.ok && !t.includes(r.id)).map((r) => r.id).join(',') || '-'}`);
    process.exit(ok ? 0 : 1);
  }
  const fails = results.filter((r) => !r.ok);
  if (foreign.length || pageErrors.length) console.error(`NOTE foreign=${foreign.length} pageErrors=${pageErrors.slice(0, 3).join(' | ')}`);
  console.log(`\nB15-29 single-flight status: ${results.length - fails.length}/${results.length} rows passed${LAYER ? ` (layer ${LAYER})` : ''}`);
  process.exit(fails.length ? 1 : 0);

  /** r5/r6: a control must fail its target BECAUSE of the specified record, not for an unrelated reason. */
  function attributionOk() {
    const m = MUTATIONS[MUTATE];
    if (m.i1Site) {
      const recs = (attribution.D26T && attribution.D26T.i1) || [];
      const ok = recs.length > 0 && recs.every((r) => r.site === m.i1Site);
      console.log(`ATTRIBUTION D26T site=${m.i1Site} records=${JSON.stringify(recs.slice(0, 3))} ok=${ok}`);
      if (!ok) return false;
    }
    for (const [id, ops] of Object.entries(m.record || {})) {
      const a = attribution[id];
      const ok = !!a && a.prohibited.some((r) => r.flight === a.idH && ops.includes(r.op));
      console.log(`ATTRIBUTION ${id} idH=${a && a.idH} required=${ops.join('|')} found=${a ? a.prohibited.map((r) => `${r.op}@${r.flight}`).join(',') : '-'} ok=${ok}`);
      if (!ok) return false;
    }
    return true;
  }
}
main().catch((e) => { console.error('FAILED', e); process.exit(1); });
