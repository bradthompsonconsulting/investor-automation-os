/**
 * AirDroid call eligibility -- the browser-side decision and in-flight state, offline (no browser).
 * Scope: IAOS_AIRDROID_CALL_ELIGIBILITY_AMENDED_SCOPE_2026-10-16.md §3–§5 and §6 C.
 *
 * global.fetch is a fixture; nothing leaves the process.
 */
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const APP = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) {
  if (name.startsWith('.') && parent) {
    for (const ext of ['.ts', '.tsx']) {
      const candidate = path.resolve(path.dirname(parent.filename), name + ext);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return originalResolve.call(this, name, parent, ...rest);
};
Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);

let outbound = [];
let route = null;
global.fetch = async (url, init = {}) => {
  outbound.push({ url: String(url), init });
  if (!route) throw new Error('unexpected request ' + url);
  return route(String(url), init);
};
const lib = require(path.join(APP, 'src/lib/airdroid-eligibility.ts'));

let checks = 0, failures = 0;
async function check(name, fn) {
  checks += 1;
  try { const r = await fn(); if (r === false) throw new Error('returned false'); console.log('PASS ' + name); }
  catch (e) { failures += 1; console.log('FAIL ' + name + ' -- ' + e.message); }
}
const eq = (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const A = 'contactA1234567890';
const good = { decision: 'eligible', contactId: A, phoneDigits: '2025550147', readAt: '2026-10-16T19:00:00.000Z' };

(async () => {
  // ---- copy, exactly as approved ----------------------------------------------
  await check('copy: the six approved strings, verbatim', () => eq(lib.ELIGIBILITY_COPY, {
    checking: 'Checking call status…',
    suppressed: 'Calls are suppressed in GHL. Review the contact before calling.',
    incorrect_number: 'This number is marked Incorrect Number.',
    unknown: 'Could not verify call status. Refresh and try again.',
    changed: 'The contact or number changed. Review it before calling.',
    refresh: 'Refresh status',
    review: 'Review contact',
  }));
  await check('copy: no clearance or consent claim anywhere in the component or the eligibility code', () => {
    const src = ['src/components/SellerCallVoiceControls.tsx', 'src/lib/airdroid-eligibility.ts', 'netlify/functions/call-eligibility.ts', 'netlify/functions/lib/call-eligibility-rule.ts']
      .map((f) => fs.readFileSync(path.join(APP, f), 'utf8')).join('\n');
    // The rule and lib comments say what the check is NOT ("not a declaration of legal consent"); no UI string may claim it.
    const strings = [...src.matchAll(/"([^"\n]{6,})"|`([^`\n]{6,})`/g)].map((m) => m[1] || m[2]);
    const bad = strings.filter((s) => /safe to call|consent|verified|cleared to call|ok to call/i.test(s));
    eq(bad, []);
  });

  // ---- response shape: anything unexpected is unknown, never eligible ----------
  await check('shape: the exact response parses', () => eq(lib.parseEligibilityResponse(200, good), good));
  await check('shape: valid ISO instants parse (leap day, offset, no fraction, 9-digit fraction)', () => {
    for (const readAt of ['2028-02-29T00:00:00Z', '2026-10-16T19:00:00+05:30', '2026-10-16T19:00:00-06:00', '2026-10-16T19:00:00Z', '2026-10-16T19:00:00.123456789Z']) {
      eq(lib.parseEligibilityResponse(200, { ...good, readAt })?.readAt, readAt);
    }
  });
  const badShapes = {
    'non-200 status': [503, good],
    'array body': [200, [good]],
    'null body': [200, null],
    'extra key': [200, { ...good, safe: true }],
    'missing readAt': [200, { decision: 'eligible', contactId: A, phoneDigits: '2025550147' }],
    'unknown decision': [200, { ...good, decision: 'allowed' }],
    'decision not a string': [200, { ...good, decision: true }],
    'eligible without phone digits': [200, { ...good, phoneDigits: null }],
    'phone digits not 10 digits': [200, { ...good, phoneDigits: '202555014' }],
    'phone digits a number': [200, { ...good, phoneDigits: 2025550147 }],
    'contactId missing': [200, { decision: 'eligible', phoneDigits: '2025550147', readAt: good.readAt, contact: A }],
    // T3 (Bones): readAt shape only -- no age policy.
    'readAt not an ISO instant': [200, { ...good, readAt: 'yesterday' }],
    'readAt a number': [200, { ...good, readAt: 1792200000000 }],
    'readAt an impossible date': [200, { ...good, readAt: '2026-13-45T99:99:00Z' }],
    // Bones F2 (2026-10-16): Date.parse accepted these; neither is an ISO instant.
    'readAt without a timezone (2026-10-16T19:00)': [200, { ...good, readAt: '2026-10-16T19:00' }],
    'readAt on an invalid calendar date (2026-02-30T19:00:00.000Z)': [200, { ...good, readAt: '2026-02-30T19:00:00.000Z' }],
    'readAt with seconds but no timezone': [200, { ...good, readAt: '2026-10-16T19:00:00' }],
    'readAt at hour 24': [200, { ...good, readAt: '2026-10-16T24:00:00Z' }],
    'readAt on 2027-02-29 (not a leap year)': [200, { ...good, readAt: '2027-02-29T12:00:00Z' }],
    'readAt with a malformed offset': [200, { ...good, readAt: '2026-10-16T19:00:00+5:30' }],
    // T3: a non-success status carrying an otherwise eligible body.
    'HTTP 409 with an eligible body': [409, good],
    'HTTP 204': [204, good],
  };
  for (const [label, [status, body]] of Object.entries(badShapes)) {
    await check(`shape: ${label} -> null (unknown)`, () => eq(lib.parseEligibilityResponse(status, body), null));
  }

  // ---- verdict: binding to the exact contact and number ---------------------------
  const bound = { contactId: A, target: '2025550147' };
  const verdict = (r) => lib.handoffVerdict(r, bound);
  await check('verdict: eligible, same contact and digits -> dial', () => eq(verdict(good), { dial: true }));
  await check('verdict: eligible but the fresh number differs -> changed', () => eq(verdict({ ...good, phoneDigits: '4695550123' }), { dial: false, reason: 'changed' }));
  await check('verdict: response for another contact -> unknown', () => eq(verdict({ ...good, contactId: 'someoneElse' }), { dial: false, reason: 'unknown' }));
  await check('verdict: null (unparseable) -> unknown', () => eq(verdict(null), { dial: false, reason: 'unknown' }));
  for (const [decision, reason] of [['suppressed', 'suppressed'], ['incorrect_number', 'incorrect_number'], ['invalid_phone', 'changed'], ['mismatch', 'unknown'], ['unknown', 'unknown']]) {
    await check(`verdict: ${decision} -> ${reason}`, () => eq(verdict({ ...good, decision, phoneDigits: null }), { dial: false, reason }));
  }

  // ---- the shared in-flight gate ---------------------------------------------------
  await check('gate: a call while a call is in flight is ignored (both buttons share one gate)', () => {
    const g = new lib.EligibilityGate();
    const first = g.begin('call');
    eq([!!first, g.begin('call'), g.checking], [true, null, true]);
    eq(g.finish(first.seq), true);
    eq(g.checking, false);
  });
  await check('gate: a finished request cannot finish again', () => {
    const g = new lib.EligibilityGate();
    const t = g.begin('call');
    eq([g.finish(t.seq), g.finish(t.seq)], [true, false]);
  });
  await check('gate: Refresh during an in-flight call makes the call stale and aborts its read', () => {
    const g = new lib.EligibilityGate();
    const callTicket = g.begin('call');
    const refreshTicket = g.begin('refresh');
    eq([callTicket.signal.aborted, g.finish(callTicket.seq), g.finish(refreshTicket.seq)], [true, false, true]);
  });
  await check('gate: a call while a refresh is in flight is ignored', () => {
    const g = new lib.EligibilityGate();
    g.begin('refresh');
    eq(g.begin('call'), null);
  });
  await check('gate: invalidate (navigation, seller or number change, unmount) makes the in-flight request stale', () => {
    const g = new lib.EligibilityGate();
    const t = g.begin('call');
    g.invalidate();
    eq([t.signal.aborted, g.finish(t.seq), g.checking], [true, false, false]);
  });
  await check('gate: a new call after a finished one gets a fresh, current ticket', () => {
    const g = new lib.EligibilityGate();
    const a = g.begin('call'); g.finish(a.seq);
    const b = g.begin('call');
    eq([b.seq > a.seq, g.finish(b.seq)], [true, true]);
  });

  // ---- the read: one GET, failures are unknown --------------------------------------
  await check('read: one same-origin GET to the call-eligibility function with the encoded contact id', async () => {
    outbound = []; route = () => ok(good);
    const r = await lib.readCallEligibility(A, new AbortController().signal);
    eq(r, good);
    eq(outbound.length, 1);
    eq(outbound[0].url, `/.netlify/functions/call-eligibility?contactId=${A}`);
    eq([outbound[0].init.method ?? 'GET', outbound[0].init.credentials, outbound[0].init.body], ['GET', 'same-origin', undefined]);
  });
  await check('read: non-200 -> null', async () => { route = () => ok(good, 500); eq(await lib.readCallEligibility(A, new AbortController().signal), null); });
  await check('read: invalid JSON -> null', async () => { route = () => new Response('nope', { status: 200 }); eq(await lib.readCallEligibility(A, new AbortController().signal), null); });
  await check('read: network failure -> null', async () => { route = () => { throw new Error('offline'); }; eq(await lib.readCallEligibility(A, new AbortController().signal), null); });
  const stall = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  await check('read: the caller aborting (stale request) -> null', async () => {
    route = stall;
    const c = new AbortController();
    const p = lib.readCallEligibility(A, c.signal);
    c.abort();
    eq(await p, null);
  });
  await check('read: the client timeout -> null (8 s by default; 60 ms here)', async () => {
    route = stall;
    const t0 = Date.now();
    eq(await lib.readCallEligibility(A, new AbortController().signal, 60), null);
    eq([Date.now() - t0 < 2000, lib.CLIENT_TIMEOUT_MS], [true, 8000]);
  });

  // ---- T5 (Bones): a transport that IGNORES the abort and delivers late must not count -------------------------------
  const lateEligible = (ms) => () => new Promise((resolve) => setTimeout(() => resolve(ok(good)), ms));   // never looks at init.signal
  await check('T5: client timeout, then the transport delivers eligible late anyway -> null', async () => {
    route = lateEligible(150);
    const r = await lib.readCallEligibility(A, new AbortController().signal, 40);
    await new Promise((res) => setTimeout(res, 200));
    eq(r, null);
  });
  await check('T5: caller abort (stale request), then the transport delivers eligible late anyway -> null', async () => {
    route = lateEligible(150);
    const c = new AbortController();
    const p = lib.readCallEligibility(A, c.signal);
    setTimeout(() => c.abort(), 30);
    eq(await p, null);
  });
  await check('T5: an already-aborted caller signal -> null without waiting for the transport', async () => {
    route = lateEligible(500);
    const c = new AbortController(); c.abort();
    const t0 = Date.now();
    eq([await lib.readCallEligibility(A, c.signal), Date.now() - t0 < 300], [null, true]);
  });
  await check('T5: an old request finishing late changes nothing and does not clear a newer request\'s guard', () => {
    const g = new lib.EligibilityGate();
    const old = g.begin('call');
    g.invalidate();                                        // e.g. the seller changed
    const newer = g.begin('call');
    eq([g.finish(old.seq), g.checking, g.begin('call'), g.finish(newer.seq)], [false, true, null, true]);
  });
  await check('T5: A -> B -> A: the original request stays stale even though contact and number match again', () => {
    const g = new lib.EligibilityGate();
    const first = g.begin('call');
    g.invalidate(); g.invalidate();                        // two changes (A to B, B back to A)
    eq(g.finish(first.seq), false);
  });
  await check('T6: a Refresh that timed out, then delivers eligible late, cannot affect a later Call, which gets its own read', async () => {
    const g = new lib.EligibilityGate();
    const refresh = g.begin('refresh');
    route = lateEligible(150);
    const refreshResult = await lib.readCallEligibility(A, refresh.signal, 40);
    const refreshFinished = g.finish(refresh.seq);
    const callTicket = g.begin('call');
    await new Promise((res) => setTimeout(res, 200));     // the refresh's late answer has now arrived
    eq([refreshResult, refreshFinished, !!callTicket, g.finish(refresh.seq), g.checking], [null, true, true, false, true]);
  });

  console.log(`\nAirDroid eligibility state: ${checks - failures}/${checks} checks passed`);
  process.exitCode = failures ? 1 : 0;
})();
