/**
 * B15-29 D2 r6 (Captain GO, local) -- unit / classifier / persistence / fake-clock suite for src/lib/protected-lane.ts
 * and its caller wiring in src/lib/app-write-session.ts (mint + write). Node only; no browser, no network.
 *
 * A VIRTUAL CLOCK replaces setTimeout / clearTimeout / Date.now (the lane reads them at call time), so every boundary is
 * exact. sessionStorage is an in-memory fake that can fail or be tampered with; fetch is scripted per request: answer,
 * hang (never resolves, ignores abort), or headers then a body that never ends (ignores cancel). `stallHits` counts
 * every injected stall that was actually reached, so a timing row cannot pass on an unrelated early failure.
 *
 *   node scripts/test-b15-29-protected-lane.cjs                  all rows (every row must pass)
 *   node scripts/test-b15-29-protected-lane.cjs --controls       every mutation control (each must fail its target rows)
 *   node scripts/test-b15-29-protected-lane.cjs --mutate=<name>  one control
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { spawnSync } = require('node:child_process');
require('./harness/ts-loader.cjs');
const ts = require('typescript');

const APP = path.resolve(__dirname, '..');
const LANE = path.join(APP, 'src/lib/protected-lane.ts');
const AWS = path.join(APP, 'src/lib/app-write-session.ts');
const arg = (k) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const MUTATE = arg('mutate');

const R = (find, repl) => ({ find, repl });
const MUTATIONS = {
  'persist-after-fetch':     { targets: ['P1'], edits: [R('    live = e;\n    void dispatch(e, holdId);', '    live = e;\n    void dispatch(e, holdId);'), R('      if (r === "corrupt" || r === "unreadable" || !writeRecords([...r, rec])) { settle(e, null, new LaneNotSent("persist_failed")); continue; }', '      queueMicrotask(() => { if (r !== "corrupt" && r !== "unreadable") writeRecords([...r, rec]); });')] },
  'dispatch-on-persist-fail':{ targets: ['P2'], edits: [R('      if (r === "corrupt" || r === "unreadable" || !writeRecords([...r, rec])) { settle(e, null, new LaneNotSent("persist_failed")); continue; }', '      if (r !== "corrupt" && r !== "unreadable") writeRecords([...r, rec]);')] },
  'key-under-iaos-prefix':   { targets: ['P3'], edits: [R('export const UNRESOLVED_KEY = "iaosLane.unresolved.v1";', 'export const UNRESOLVED_KEY = "iaos.lane.unresolved.v1";')] },
  'one-directional-wildcard':{ targets: ['P5'], edits: [R('const conflicts = (a: string, b: string) => a === "*" || b === "*" || a === b;', 'const conflicts = (a: string, b: string) => a === "*" || a === b;')] },
  'no-dispatch-recheck':     { targets: ['P5'], edits: [R('      { const why = blocked(e.meta.key); if (why) { settle(e, null, new LaneNotSent(why)); continue; } }\n', '')] },
  'tie-dispatches':          { targets: ['P6a'], edits: [R('    if (Date.now() - e.enqueuedAt >= LANE_MAX_WAIT_MS) {', '    if (Date.now() - e.enqueuedAt > LANE_MAX_WAIT_MS) {'), R('    e.waitTimer = setTimeout(() => { if (!e.done && queue.includes(e)) dropQueued(e, "waited"); }, LANE_MAX_WAIT_MS);', '    e.waitTimer = setTimeout(() => { if (!e.done && queue.includes(e)) dropQueued(e, "waited"); }, LANE_MAX_WAIT_MS + 1);')] },
  'deadline-awaits-fetch':   { targets: ['P6b', 'P6c'], edits: [R('    const res = await Promise.race([sent, deadline]);', '    const res = await sent;'), R('    const step = await Promise.race([reader.read(), deadline]);', '    const step = await reader.read();')] },
  'late-response-releases':  { targets: ['P8'], edits: [R('    sent.catch(() => { /* a late rejection after the deadline is ignored */ });', '    sent.then(async (late) => { if (holdId) { try { const t = await late.clone().text(); if (classifyRelease(e.meta!.path, e.meta!.body, late.status, t) === "release") setRecordState(holdId, "remove"); } catch {} } }, () => {});')] },
  'any-status-releases':     { targets: ['P9', 'P10'], edits: [R('  let b: unknown;\n  try { b = JSON.parse(text); } catch { return "retain"; }', '  if (status < 600) return "release";\n  let b: unknown;\n  try { b = JSON.parse(text); } catch { return "retain"; }')] },
  'no-reset-on-signout':     { targets: ['L5'], edits: [R('  for (const e of queue.splice(0)) settle(e, null, new LaneNotSent(reason));', '  void reason;')] },
  'no-write-priority':       { targets: ['L1'], edits: [R('  const w = queue.findIndex((x) => x.kind === "write");', '  const w = -1;')] },
  'no-queue-bound':          { targets: ['L2'], edits: [R('    if (queue.length >= LANE_MAX_QUEUED) { settle(e, null, new LaneNotSent("full")); return; }\n', '')] },
  'skip-stall':              { targets: ['P6b'], harness: 'skip-stall' },
};
if (process.argv.includes('--controls')) {
  let bad = 0;
  for (const name of Object.keys(MUTATIONS)) {
    const r = spawnSync(process.execPath, [__filename, `--mutate=${name}`], { encoding: 'utf8', env: process.env, timeout: 5 * 60_000 });
    const line = (r.stdout || '').split('\n').filter((l) => l.startsWith('CONTROL ')).pop() || `CONTROL ${name} NO-RESULT`;
    const caught = r.status === 0 && / CAUGHT /.test(line);
    console.log(`${line} rc=${r.status}`); if (!caught) bad += 1;
  }
  console.log(`\nB15-29 protected lane controls: ${Object.keys(MUTATIONS).length - bad}/${Object.keys(MUTATIONS).length} controls caught their target`);
  process.exit(bad ? 1 : 0);
}
let laneSource = fs.readFileSync(LANE, 'utf8').replace(/\r\n/g, '\n');
if (MUTATE) {
  const m = MUTATIONS[MUTATE]; if (!m) { console.error(`FAILED: unknown --mutate=${MUTATE}`); process.exit(2); }
  for (const e of m.edits || []) {
    const n = laneSource.split(e.find).length - 1;
    if (n !== 1) { console.error(`FAILED: ${MUTATE} edit matched ${n} times: ${JSON.stringify(e.find.slice(0, 70))}`); process.exit(2); }
    laneSource = laneSource.split(e.find).join(e.repl);
  }
}

// ── virtual clock ── (the real timer is kept for the per-row watchdog only)
const realSetTimeout = global.setTimeout; const realClearTimeout = global.clearTimeout;
let now = 1_000_000; let seq = 0; const timers = new Map();
global.setTimeout = (fn, ms = 0) => { const id = ++seq; timers.set(id, { at: now + Math.max(0, ms), fn, id }); return id; };
global.clearTimeout = (id) => { timers.delete(id); };
const realNow = Date.now; Date.now = () => now;
const flush = async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r)); };
async function advance(ms) {
  const end = now + ms;
  for (;;) {
    await flush();
    const due = [...timers.values()].filter((t) => t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
    if (!due) break;
    now = due.at; timers.delete(due.id); due.fn(); await flush();
  }
  now = end; await flush();
}

// ── fake sessionStorage ──
const mem = new Map(); const storage = { failSet: false, failGet: false, tamper: false, setCalls: [] };
global.sessionStorage = {
  getItem: (k) => { if (storage.failGet) throw new Error('SecurityError'); const v = mem.has(k) ? mem.get(k) : null; return storage.tamper && v ? v + ' ' : v; },
  setItem: (k, v) => { storage.setCalls.push({ k, at: now }); if (storage.failSet) throw new Error('QuotaExceededError'); mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); }, key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; }, clear: () => mem.clear(),
};

// ── scripted fetch ──
const calls = []; let script = []; let stallHits = 0; let snapshotAtFetch = null; const STALL = MUTATE && MUTATIONS[MUTATE].harness === 'skip-stall' ? 'skip' : 'on';
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
global.fetch = (url, init = {}) => {
  calls.push({ url: String(url), init, at: now });
  snapshotAtFetch = mem.get('iaosLane.unresolved.v1') ?? null;
  const s = script.shift() || { kind: 'answer', status: 200, body: { ok: true } };
  if (s.kind === 'answer') return Promise.resolve(json(s.status, s.body));
  if (s.kind === 'raw') return Promise.resolve(new Response(s.text, { status: s.status }));
  if (s.kind === 'deferred') return new Promise((res) => { s.resolve = () => res(json(s.status, s.body)); });
  if (s.kind === 'hang') { if (STALL === 'skip') return Promise.reject(new TypeError('Failed to fetch')); stallHits += 1; return new Promise(() => {}); }
  if (s.kind === 'body-never-ends') {
    if (STALL === 'skip') return Promise.resolve(json(200, { confirmed: true }));
    const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"partial":')); stallHits += 1; }, cancel() { /* ignores cancel */ } });
    return Promise.resolve(new Response(stream, { status: 200 }));
  }
  if (s.kind === 'late') return new Promise((res) => { s.resolve = () => res(json(s.status, s.body)); });
  throw new Error('bad script');
};

// ── modules ──
const cfg = require(path.join(APP, 'shared/ghl-config.ts'));
cfg.setRuntimeConfig({ ...cfg.projectRuntimeConfig(cfg.getConfig('test'), 'test'), oneLogin: { active: true } });
const { AppWriteSignInRequired } = require(path.join(APP, 'src/lib/write-errors.ts'));
function freshLane() {
  for (const k of Object.keys(require.cache)) if (k === LANE || k === AWS) delete require.cache[k];
  const out = ts.transpileModule(laneSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const m = new Module(LANE, module); m.filename = LANE; m.paths = Module._nodeModulePaths(path.dirname(LANE)); m._compile(out, LANE);
  require.cache[LANE] = m; m.loaded = true;
  return m.exports;
}
function reset() { mem.clear(); calls.length = 0; script = []; stallHits = 0; snapshotAtFetch = null; storage.failSet = false; storage.failGet = false; storage.tamper = false; storage.setCalls.length = 0; timers.clear(); }
const records = () => { const v = mem.get('iaosLane.unresolved.v1'); return v ? JSON.parse(v).records : []; };
const WRITE = (contact, op = 'note.create', requestId = `req-${contact}`) => ['/.netlify/functions/ghl-write', { method: 'POST', headers: {}, body: JSON.stringify({ operation: op, targetId: contact, requestId, args: { body: 'x' } }) }];
const WILD = () => ['/.netlify/functions/ghl-write', { method: 'POST', headers: {}, body: JSON.stringify({ operation: 'opportunity.askingPrice', targetId: 'opp1', requestId: 'req-opp', args: { value: 1 } }) }];
const READ = () => ['/.netlify/functions/ghl-contacts', {}];
const outcome = (p) => p.then((r) => ({ ok: true, r }), (e) => ({ ok: false, e }));

const results = [];
let unhandled = 0;
process.on('unhandledRejection', (e) => { unhandled += 1; console.error('FAIL  unhandled rejection: ' + String(e && e.message || e)); });
function row(id, ok, detail) { results.push({ id, ok: !!ok }); console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${id}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`); }

const ROWS = {
  async L1() { reset(); const L = freshLane();
    script = [{ kind: 'deferred', status: 200, body: [] }]; const first = script[0];
    const a = outcome(L.laneFetch(...READ(), { kind: 'read' })); const b = outcome(L.laneFetch(...READ(), { kind: 'read' }));
    const w = outcome(L.laneFetch(...WRITE('c1'), { kind: 'write' }));
    await flush(); const inFlight = calls.length;
    script.push({ kind: 'answer', status: 200, body: { note: { id: 'n1' } } }, { kind: 'answer', status: 200, body: [] });
    first.resolve(); await advance(1); await a; await w; await b;
    row('L1', inFlight === 1 && calls.length === 3 && calls[1].url.endsWith('ghl-write') && calls[2].url.endsWith('ghl-contacts'), { inFlight, order: calls.map((c) => c.url.replace(/^.*\//, '')) }); },
  async L2() { reset(); const L = freshLane();
    script = [{ kind: 'hang' }]; void L.laneFetch(...READ(), { kind: 'read' }); await flush();
    const q = []; for (let i = 0; i < 12; i += 1) q.push(outcome(L.laneFetch(...READ(), { kind: 'read' })));
    const thirteenth = await outcome(L.laneFetch(...READ(), { kind: 'read' }));
    row('L2', !thirteenth.ok && thirteenth.e instanceof L.LaneNotSent && thirteenth.e.reason === 'full' && calls.length === 1, { reason: thirteenth.e && thirteenth.e.reason, calls: calls.length }); },
  async L5() { reset(); const L = freshLane(); const ok = [];
    for (const reason of ['signed_out', 'replaced', 'unmounted']) {
      script = [{ kind: 'deferred', status: 200, body: [] }]; const live = script[0];
      const inflight = outcome(L.laneFetch(...READ(), { kind: 'read' }));
      const queued = outcome(L.laneFetch(...WRITE('c9'), { kind: 'write' }));
      await flush(); const e0 = L.laneSnapshot().epoch; L.laneReset(reason); const q = await queued; live.resolve(); const f = await inflight;
      ok.push(!q.ok && q.e instanceof L.LaneNotSent && q.e.reason === reason && q.e instanceof AppWriteSignInRequired && f.ok && L.laneSnapshot().epoch === e0 + 1);
      if (reason === 'signed_out') L.laneReset('replaced');
    }
    row('L5', ok.every(Boolean) && calls.filter((c) => c.url.endsWith('ghl-write')).length === 0, { ok }); },
  async L6() { reset(); const L = freshLane();
    script = [{ kind: 'hang' }, { kind: 'answer', status: 200, body: [] }];
    const a = outcome(L.laneFetch(...READ(), { kind: 'read' }));
    await advance(11_000); const b = outcome(L.laneFetch(...READ(), { kind: 'read' }));   // queued 1 000 ms before a's deadline
    await advance(999); const before = calls.length; await advance(1); const ra = await a; await flush(); const rb = await b;
    row('L6', before === 1 && !ra.ok && ra.e instanceof L.LaneUncertain && ra.e.kind === 'read' && rb.ok && calls.length === 2 && records().length === 0 && L.laneSnapshot().abandoned === 1, { before, calls: calls.length }); },
  async L10() { reset(); cfg.setRuntimeConfig({ ...cfg.projectRuntimeConfig(cfg.getConfig('test'), 'test') }); const L = freshLane();
    script = [{ kind: 'deferred', status: 200, body: [] }, { kind: 'deferred', status: 200, body: [] }];
    void L.laneFetch(...READ(), { kind: 'read' }); void L.laneFetch(...WRITE('c1'), { kind: 'write' }); await flush();
    const concurrent = calls.length; const noRecord = records().length === 0;
    cfg.setRuntimeConfig({ ...cfg.projectRuntimeConfig(cfg.getConfig('test'), 'test'), oneLogin: { active: true } });
    row('L10', concurrent === 2 && noRecord, { concurrent, noRecord }); },
  async P1() { reset(); const L = freshLane();
    script = [{ kind: 'answer', status: 200, body: { note: { id: 'n1' } } }];
    const r = await outcome(L.laneFetch(...WRITE('c1', 'note.create', 'rq-1'), { kind: 'write' }));
    const at = snapshotAtFetch ? JSON.parse(snapshotAtFetch).records : [];
    row('P1', r.ok && at.length === 1 && at[0].state === 'dispatching' && at[0].requestId === 'rq-1' && at[0].key === 'contact:c1' && records().length === 0, { atFetch: at }); },
  async P2() { reset(); const L = freshLane();
    storage.failSet = true; const a = await outcome(L.laneFetch(...WRITE('c1'), { kind: 'write' })); const callsA = calls.length;
    storage.failSet = false; storage.tamper = true; const b = await outcome(L.laneFetch(...WRITE('c2'), { kind: 'write' })); storage.tamper = false;
    storage.failGet = true; const c = await outcome(L.laneFetch(...WRITE('c3'), { kind: 'write' })); storage.failGet = false;   // unreadable: earlier holds unknown
    const g = global.sessionStorage; global.sessionStorage = undefined; const d = await outcome(L.laneFetch(...WRITE('c4'), { kind: 'write' })); global.sessionStorage = g;   // absent
    row('P2', [a, b, c, d].every((x) => !x.ok && x.e.reason === 'persist_failed') && callsA === 0 && calls.length === 0, { reasons: [a, b, c, d].map((x) => x.e && x.e.reason), calls: calls.length }); },
  async P3() { reset(); let L = freshLane();
    script = [{ kind: 'hang' }]; const w = outcome(L.laneFetch(...WRITE('c1'), { kind: 'write' })); await flush();
    for (const reason of ['signed_out', 'replaced', 'unmounted']) L.laneReset(reason);
    // operator-partition clears every sessionStorage key starting "iaos." on an account change
    for (const k of [...mem.keys()]) if (k.startsWith('iaos.')) mem.delete(k);
    const kept = records().length === 1 && records()[0].state === 'dispatching';
    timers.clear(); L = freshLane();                                     // a reload: new module state, same tab storage
    const after = await outcome(L.laneFetch(...WRITE('c1', 'contact.lastCallAttempt', 'rq-x'), { kind: 'write' }));
    void w;
    row('P3', kept && !after.ok && after.e.reason === 'uncertain_pending' && calls.length === 1, { kept, after: after.e && after.e.reason, calls: calls.length }); },
  async P4() { reset(); const L = freshLane();
    row('P4', !('laneResolveUncertain' in L) && !/export\s+function\s+laneResolveUncertain/.test(laneSource), Object.keys(L)); },
  async P5() { const keys = { C: () => WRITE('C'), D: () => WRITE('D'), W: () => WILD() }; const exp = (a, b) => a === 'W' || b === 'W' || a === b; const bad = [];
    for (const held of ['C', 'D', 'W']) for (const next of ['C', 'D', 'W']) {
      reset(); const L = freshLane(); script = [{ kind: 'hang' }];
      L.laneFetch(...keys[held](), { kind: 'write' }).catch(() => {}); await advance(20_000);
      script = [{ kind: 'answer', status: 200, body: { note: { id: 'n' }, confirmed: true } }];
      const r = await outcome(L.laneFetch(...keys[next](), { kind: 'write' }));
      const blocked = !r.ok && r.e.reason === 'uncertain_pending';
      if (blocked !== exp(held, next)) bad.push(`${held}->${next}:${blocked}`);
    }
    // dispatch-time re-check: a record created while the write waited in the queue
    reset(); const L = freshLane(); script = [{ kind: 'deferred', status: 200, body: [] }]; const live = script[0];
    void L.laneFetch(...READ(), { kind: 'read' }); const q = outcome(L.laneFetch(...WRITE('C'), { kind: 'write' })); await flush();
    mem.set('iaosLane.unresolved.v1', JSON.stringify({ v: 1, env: cfg.getConfig('test').locationId, records: [{ holdId: 'x', key: '*', requestId: null, operation: 'x', createdAt: now, state: 'uncertain' }] }));
    live.resolve(); const rq = await q;
    row('P5', bad.length === 0 && !rq.ok && rq.e.reason === 'uncertain_pending' && calls.filter((c) => c.url.endsWith('ghl-write')).length === 0, { bad, recheck: rq.e && rq.e.reason }); },
  async P6a() { reset(); let L = freshLane();
    script = [{ kind: 'deferred', status: 200, body: [] }, { kind: 'answer', status: 200, body: [] }]; let live = script[0];
    void L.laneFetch(...READ(), { kind: 'read' }); const a = outcome(L.laneFetch(...READ(), { kind: 'read' }));
    await advance(9_999); live.resolve(); await flush(); const ra = await a; const dispatchedAt9999 = calls.length === 2 && calls[1].at === now;
    reset(); L = freshLane(); script = [{ kind: 'deferred', status: 200, body: [] }]; live = script[0];
    void L.laneFetch(...READ(), { kind: 'read' }); const b = outcome(L.laneFetch(...READ(), { kind: 'read' }));
    await advance(10_000); live.resolve(); await flush(); const rb = await b;
    row('P6a', ra.ok && dispatchedAt9999 && !rb.ok && rb.e.reason === 'waited' && calls.length === 1, { dispatchedAt9999, tie: rb.e && rb.e.reason, calls: calls.length }); },
  async P6b() { reset(); const L = freshLane(); script = [{ kind: 'hang' }];
    const t0 = now; let at = null; const w = L.laneFetch(...WRITE('c1'), { kind: 'write' }).then(null, (e) => { at = now; return e; });
    await advance(19_999); const early = at; await advance(1); const e = await w; await advance(120_000);
    row('P6b', stallHits === 1 && early === null && at === t0 + 20_000 && e instanceof L.LaneUncertain && e.reason === 'timeout' && records()[0]?.state === 'uncertain' && calls.length === 1, { stallHits, at: at && at - t0, name: e && e.name, rec: records()[0]?.state, calls: calls.length }); },
  async P6c() { reset(); const L = freshLane(); script = [{ kind: 'body-never-ends' }];
    const t0 = now; let at = null; const w = L.laneFetch(...WRITE('c1'), { kind: 'write' }).then(null, (e) => { at = now; return e; });
    await advance(20_000); const e = await w;
    row('P6c', stallHits === 1 && at === t0 + 20_000 && e instanceof L.LaneUncertain && records()[0]?.state === 'uncertain', { stallHits, at: at && at - t0, rec: records()[0]?.state }); },
  async P6d() { reset(); const L = freshLane(); script = [{ kind: 'body-never-ends' }];
    const t0 = now; let at = null; const r = L.laneFetch(...READ(), { kind: 'read' }).then(null, (e) => { at = now; return e; });
    await advance(12_000); const e = await r;
    row('P6d', stallHits === 1 && at === t0 + 12_000 && e instanceof L.LaneUncertain && e.kind === 'read' && records().length === 0, { stallHits, at: at && at - t0 }); },
  async P7() { // the real caller: appWriteFetch -> savingToken -> requestToken (mint, lane) -> write (lane)
    reset(); const L = freshLane(); const A = require(AWS);
    script = [{ kind: 'deferred', status: 200, body: [] }, { kind: 'hang' }]; const blocker = script[0];
    void L.laneFetch(...READ(), { kind: 'read' }); const t0 = now;
    let at = null; const save = A.appWriteFetch('/.netlify/functions/ghl-write', WRITE('c1')[1]).then(null, (e) => { at = now; return e; });
    await advance(9_999); blocker.resolve(); await flush();                    // the mint dispatched at 9 999, then stalls
    await advance(12_000); const e = await save;
    row('P7', stallHits === 1 && at === t0 + 21_999 && e instanceof AppWriteSignInRequired && calls.filter((c) => c.url.endsWith('ghl-write')).length === 0 && records().length === 0, { stallHits, at: at && at - t0, name: e && e.constructor.name, writes: calls.filter((c) => c.url.endsWith('ghl-write')).length }); },
  async P7tie() { reset(); const L = freshLane(); const A = require(AWS);
    script = [{ kind: 'deferred', status: 200, body: [] }]; const blocker = script[0];
    void L.laneFetch(...READ(), { kind: 'read' }); const t0 = now;
    let at = null; const save = A.appWriteFetch('/.netlify/functions/ghl-write', WRITE('c1')[1]).then(null, (e) => { at = now; return e; });
    await advance(10_000); blocker.resolve(); await flush(); const e = await save;
    row('P7tie', at === t0 + 10_000 && e instanceof AppWriteSignInRequired && calls.length === 1, { at: at && at - t0, calls: calls.length }); },
  async P7prime() { reset(); const L = freshLane(); const A = require(AWS);
    script = [{ kind: 'deferred', status: 200, body: [] }, { kind: 'deferred', status: 200, body: { token: 't1', expiresInSeconds: 900 } }, { kind: 'deferred', status: 200, body: [] }, { kind: 'hang' }];
    const [b1, mint, b2] = script;
    void L.laneFetch(...READ(), { kind: 'read' }); const t0 = now;
    let at = null; const save = A.appWriteFetch('/.netlify/functions/ghl-write', WRITE('c1')[1]).then(null, (e) => { at = now; return e; });
    await advance(9_999); b1.resolve(); await flush();                         // mint dispatched at 9 999
    await advance(11_000); L.laneFetch(...READ(), { kind: 'read' }).catch(() => {}); await flush();   // a read queued 999 ms before the mint answers
    await advance(999); mint.resolve(); await flush();                         // mint answers at 21 998; that read (b2) dispatches; the write queues behind it
    await advance(9_999); b2.resolve(); await flush();                         // write dispatched at 21 998 + 9 999 = 31 997, then stalls
    await advance(20_000); const e = await save; await flush();
    row('P7prime', stallHits === 1 && at === t0 + 51_997 && at - t0 <= 52_000 && e instanceof L.LaneUncertain && records()[0]?.state === 'uncertain', { stallHits, at: at && at - t0, name: e && e.name, rec: records()[0]?.state }); },
  async P8() { reset(); const L = freshLane(); script = [{ kind: 'late', status: 200, body: { note: { id: 'n1' } } }]; const late = script[0];
    const pending = outcome(L.laneFetch(...WRITE('c1'), { kind: 'write' })); await advance(20_000); const w = await pending;
    late.resolve(); await advance(1_000);
    row('P8', !w.ok && w.e instanceof L.LaneUncertain && records().length === 1 && records()[0].state === 'uncertain', { rec: records() }); },
  async P9() { reset(); const L = freshLane(); script = [{ kind: 'answer', status: 200, body: { confirmed: true } }];
    let atResolve = null; const r = await L.laneFetch(...WRITE('c1', 'contact.lastCallAttempt'), { kind: 'write' }).then((x) => { atResolve = records().length; return x; });
    const c = L.classifyRelease; const req = { operation: 'note.create' }; const T = (b) => JSON.stringify(b);
    const env = [
      ['nested', c('ghl-write', req, 200, T({ note: { id: 'n1', body: 'x' } })), 'release'], ['top', c('ghl-write', req, 200, T({ id: 'n1' })), 'release'],
      ['empty-note', c('ghl-write', req, 200, T({ note: {} })), 'retain'], ['empty-id', c('ghl-write', req, 200, T({ note: { id: '' } })), 'retain'],
      ['num-id', c('ghl-write', req, 200, T({ note: { id: 7 } })), 'retain'], ['none', c('ghl-write', req, 200, T({})), 'retain'],
      ['conflict', c('ghl-write', req, 200, T({ note: { id: 'a' }, id: 'b' })), 'retain'], ['confirmed-false', c('ghl-write', req, 200, T({ note: { id: 'n1' }, confirmed: false })), 'retain'],
      ['indeterminate', c('ghl-write', req, 409, T({ outcome: 'indeterminate', error: 'x' })), 'retain'], ['unparseable', c('ghl-write', req, 200, 'not json'), 'retain'],
      ['generic-409', c('ghl-write', { operation: 'contact.callback' }, 409, T({ error: 'Write refused or unconfirmed; refresh and inspect before retrying' })), 'retain'],
      ['200-unconfirmed', c('ghl-write', { operation: 'contact.callback' }, 200, T({ confirmed: false })), 'retain'],
      ['not-sent', c('ghl-write', { operation: 'contact.callback' }, 409, T({ outcome: 'not_sent', error: 'x' })), 'release'],
    ];
    const bad = env.filter(([, got, want]) => got !== want).map(([n, got]) => `${n}:${got}`);
    row('P9', r.status === 200 && atResolve === 0 && bad.length === 0, { atResolve, bad }); },
  async P11() { // Seller Call result mapping through the REAL save client (writeCommand -> appWriteFetch -> lane)
    reset(); freshLane(); for (const k of Object.keys(require.cache)) if (/seller-conversation-save-client|write-command/.test(k)) delete require.cache[k];
    const { createSellerConversationSaveClient } = require(path.join(APP, 'src/lib/seller-conversation-save-client.ts'));
    const client = createSellerConversationSaveClient(600_000);
    script = [{ kind: 'answer', status: 200, body: { token: 't1', expiresInSeconds: 900 } }, { kind: 'hang' }];
    const first = client.send('note.create', 'c1', { body: 'x' }, 'rq-1', () => {});
    await advance(20_000); const o1 = await first;                                   // dispatched, timed out -> uncertain
    const o2 = await client.send('contact.occupancy', 'c1', { value: 'vacant' }, 'rq-2', () => {});   // held contact -> not sent
    row('P11', stallHits === 1 && o1.kind === 'uncertain' && o2.kind === 'refused' && /\[uncertain_pending\]$/.test(o2.message) && !/^Not sent: Not sent/.test(o2.message) && calls.filter((c) => c.url.endsWith('ghl-write')).length === 1,
      { o1: o1.kind, o2, writes: calls.filter((c) => c.url.endsWith('ghl-write')).length }); },
  async P10() { const c = freshLane().classifyRelease; const T = (b) => JSON.stringify(b);
    const cases = [
      ['auth401', c('call-log-barrier', { action: 'begin' }, 401, T({ error: 'Application write sign-in required' })), 'release'],
      ['auth401+extra', c('call-log-barrier', { action: 'begin' }, 401, T({ error: 'Application write sign-in required', x: 1 })), 'retain'],
      ['origin403', c('repair-approval-save', {}, 403, T({ error: 'Application write origin refused' })), 'release'],
      ['session401', c('ghl-write', { operation: 'note.create' }, 401, T({ error: 'x', by: 'iaos-app-write-auth' })), 'release'],
      ['session503', c('ghl-write', { operation: 'note.create' }, 503, T({ error: 'x', by: 'iaos-session-unavailable' })), 'release'],
      ['other503', c('ghl-write', { operation: 'note.create' }, 503, T({ error: 'x' })), 'retain'],
      ['clb-reserved', c('call-log-barrier', { action: 'begin' }, 200, T({ state: 'reserved', op: 'o' })), 'release'],
      ['clb-finished', c('call-log-barrier', { action: 'begin' }, 200, T({ state: 'finished' })), 'release'],
      ['clb-held', c('call-log-barrier', { action: 'begin' }, 409, T({ state: 'held' })), 'release'],
      ['clb-reserved-ish', c('call-log-barrier', { action: 'begin' }, 200, T({ state: 'reserved-ish' })), 'retain'],
      ['clb-500', c('call-log-barrier', { action: 'begin' }, 500, T({ state: 'reserved' })), 'retain'],
      ['clb-resume', c('call-log-barrier', { action: 'resume' }, 200, T({ state: 'anything' })), 'release'],
      ['clb-resume-nostate', c('call-log-barrier', { action: 'resume' }, 200, T({})), 'retain'],
      ['cob-reserved', c('current-offer-barrier', { action: 'begin' }, 200, T({ state: 'reserved' })), 'release'],
      ['cob-blocked409', c('current-offer-barrier', { action: 'begin' }, 409, T({ state: 'blocked' })), 'release'],
      ['cob-reconcile', c('current-offer-barrier', { action: 'reconcile' }, 200, T({ state: 'clear' })), 'release'],
      ['cob-unknown', c('current-offer-barrier', { action: 'begin' }, 200, T({ state: 'clear' })), 'retain'],
      ['repair-verified', c('repair-approval-save', {}, 200, T({ outcome: 'verified' })), 'release'],
      ['repair-unknown', c('repair-approval-save', {}, 200, T({ outcome: 'unknown' })), 'retain'],
      ['pa-closed', c('property-answer', { action: 'close' }, 200, T({ outcome: 'closed', message: 'm' })), 'release'],
      ['pa-other', c('property-answer', { action: 'answer' }, 200, T({ outcome: 'saved' })), 'retain'],
      ['readback', c('ghl-contract-send-readback', {}, 200, T({ signerCompletion: {}, buyerIdentity: {} })), 'release'],
      ['readback-partial', c('ghl-contract-send-readback', {}, 200, T({ signerCompletion: {} })), 'retain'],
      ['pdf', c('generate-contract-pdf', {}, 200, T({ pdfBase64: 'x', evidence: {} })), 'release'],
      ['pdf-bad', c('generate-contract-pdf', {}, 200, T({ pdfBase64: 'x' })), 'retain'],
      ['upload-2xx', c('ghl-executed-artifact-upload', {}, 201, T({})), 'release'],
      ['upload-409', c('ghl-executed-artifact-upload', {}, 409, T({ error: 'x' })), 'retain'],
      ['unknown-endpoint', c('something-new', {}, 200, T({ confirmed: true })), 'retain'],
    ];
    const bad = cases.filter(([, got, want]) => got !== want).map(([n, got]) => `${n}:${got}`);
    row('P10', bad.length === 0, bad); },
};

(async () => {
  const want = MUTATE ? MUTATIONS[MUTATE].targets : Object.keys(ROWS);
  for (const id of Object.keys(ROWS)) {
    if (!want.includes(id)) continue;
    let wd; const hung = new Promise((res) => { wd = realSetTimeout(() => res('hung'), 30_000); });
    try { const r = await Promise.race([ROWS[id](), hung]); if (r === 'hung') row(id, false, 'hung: no result within 30 s (real time)'); }
    catch (e) { row(id, false, `threw: ${String(e && e.message || e).split('\n')[0]}`); }
    finally { realClearTimeout(wd); }
  }
  Date.now = realNow;
  if (MUTATE) {
    const t = MUTATIONS[MUTATE].targets; const failed = t.filter((id) => results.some((r) => r.id === id && !r.ok));
    const ok = failed.length === t.length;
    console.log(`CONTROL ${MUTATE} ${ok ? 'CAUGHT' : 'NOT-CAUGHT'} targets=${t.join(',')} failedTargeted=${failed.join(',') || '-'}`);
    process.exit(ok ? 0 : 1);
  }
  const fails = results.filter((r) => !r.ok);
  console.log(`\nB15-29 protected lane: ${results.length - fails.length}/${results.length} rows passed${unhandled ? `; ${unhandled} unhandled rejection(s)` : ''}`);
  process.exit(fails.length || unhandled ? 1 : 0);
})();
