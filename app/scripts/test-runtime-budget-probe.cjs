/**
 * Runtime-budget probe (B15-26 B1, temporary, Test only), offline.
 *
 * global.fetch and console are replaced for the whole run: any outbound
 * request or log line fails. The runtime context is a fixture whose
 * accesses are counted, so the checks can prove the context is not
 * examined before the environment and method gates.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');
const APP = path.resolve(__dirname, '..');
const SOURCE = path.join(APP, 'netlify', 'functions', 'runtime-budget-probe.ts');
Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);

let outbound = 0;
global.fetch = async (url) => { outbound++; throw new Error('unexpected outbound request: ' + url); };
let logged = 0;
for (const k of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
  const original = console[k].bind(console);
  console[k] = (...a) => { logged++; original(...a); };
}
const report = (line) => process.stdout.write(line + '\n');

const { handler, observeRemainingBudget } = require(SOURCE);

/** A runtime context fixture that counts every property access and call. */
function context(method) {
  const st = { touched: 0, calls: 0, thisOk: true };
  // Other Lambda-style context fields are present so a leak of any of them is visible.
  const target = { functionName: 'runtime-budget-probe', memoryLimitInMB: 1024, awsRequestId: 'offline-request' };
  if (method !== undefined) target.getRemainingTimeInMillis = method;
  const proxy = new Proxy(target, {
    get(t, k) {
      st.touched++;
      const v = t[k];
      if (k !== 'getRemainingTimeInMillis' || typeof v !== 'function') return v;
      return function () { st.calls++; if (this !== proxy) st.thisOk = false; return v.apply(this, arguments); };
    },
    has(t, k) { st.touched++; return k in t; },
  });
  return { ctx: proxy, st };
}
/** A GET event whose body getter fails the run if the handler reads it. */
function event(httpMethod) {
  return { httpMethod, queryStringParameters: {}, headers: {}, get body() { throw new Error('request body was read'); } };
}
const setEnv = (v) => { if (v === undefined) delete process.env.IAOS_ENV; else process.env.IAOS_ENV = v; };

let passed = 0; let failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; report('PASS ' + name); }
  catch (e) { failed++; report('FAIL ' + name + ': ' + (e && e.message)); }
}
const parse = (r) => JSON.parse(r.body);
function headersOk(r) {
  assert.equal(r.headers['Cache-Control'], 'no-store');
  assert.equal(r.headers['Content-Type'], 'application/json');
}

(async () => {
  await check('P1 Test GET: 200 with exactly { available: true, remainingMs }, no-store, method called once on its context', async () => {
    setEnv('test');
    const { ctx, st } = context(() => 59876);
    const r = await handler(event('GET'), ctx);
    assert.equal(r.statusCode, 200); headersOk(r);
    assert.deepEqual(Object.keys(parse(r)), ['available', 'remainingMs']);
    assert.deepEqual(parse(r), { available: true, remainingMs: 59876 });
    assert.equal(st.calls, 1); assert.equal(st.thisOk, true);
  });

  await check('P2 Test GET: zero remaining is a valid observation', async () => {
    setEnv('test');
    assert.deepEqual(parse(await handler(event('GET'), context(() => 0).ctx)), { available: true, remainingMs: 0 });
  });

  for (const env of ['production', undefined, '', 'TEST', 'Test', ' test', 'test ', 'staging']) {
    await check(`P3 IAOS_ENV ${JSON.stringify(env)}: 404 before the context is examined (GET and POST)`, async () => {
      setEnv(env);
      for (const m of ['GET', 'POST']) {
        const { ctx, st } = context(() => 59876);
        const r = await handler(event(m), ctx);
        assert.equal(r.statusCode, 404); headersOk(r);
        assert.deepEqual(parse(r), { error: 'Not found' });
        assert.equal(st.touched, 0); assert.equal(st.calls, 0);
      }
    });
  }

  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'get', undefined]) {
    await check(`P4 Test ${JSON.stringify(m)}: 405 before the context is examined`, async () => {
      setEnv('test');
      const { ctx, st } = context(() => 59876);
      const r = await handler(event(m), ctx);
      assert.equal(r.statusCode, 405); headersOk(r);
      assert.deepEqual(parse(r), { error: 'Method not allowed' });
      assert.equal(st.touched, 0); assert.equal(st.calls, 0);
    });
  }

  const unavailable = { available: false, remainingMs: null };
  const missing = [['undefined context', undefined], ['null context', null], ['no method', {}], ['method is a number', { getRemainingTimeInMillis: 59876 }], ['method is a string', { getRemainingTimeInMillis: 'x' }], ['primitive context', 7]];
  for (const [name, ctx] of missing) {
    await check(`P5 missing: ${name} -> 200 available:false`, async () => {
      setEnv('test');
      const r = await handler(event('GET'), ctx);
      assert.equal(r.statusCode, 200); headersOk(r);
      assert.deepEqual(parse(r), unavailable);
    });
  }

  const invalid = [['NaN', NaN], ['Infinity', Infinity], ['-Infinity', -Infinity], ['-1', -1], ['-0.5', -0.5], ['numeric string', '59876'], ['null', null], ['undefined', undefined], ['object', {}], ['boolean', true], ['bigint', 59876n]];
  for (const [name, value] of invalid) {
    await check(`P6 invalid return: ${name} -> available:false`, async () => {
      setEnv('test');
      const { ctx, st } = context(() => value);
      const r = await handler(event('GET'), ctx);
      assert.equal(r.statusCode, 200); headersOk(r);
      assert.deepEqual(parse(r), unavailable);
      assert.equal(st.calls, 1);
    });
  }

  await check('P7 throwing method -> 200 available:false', async () => {
    setEnv('test');
    const r = await handler(event('GET'), context(() => { throw new Error('boom'); }).ctx);
    assert.equal(r.statusCode, 200); assert.deepEqual(parse(r), unavailable);
  });
  await check('P8 throwing property getter -> 200 available:false', async () => {
    setEnv('test');
    const ctx = Object.defineProperty({}, 'getRemainingTimeInMillis', { get() { throw new Error('boom'); } });
    const r = await handler(event('GET'), ctx);
    assert.equal(r.statusCode, 200); assert.deepEqual(parse(r), unavailable);
  });
  await check('P9 observeRemainingBudget alone: valid, missing, invalid and throwing', () => {
    assert.deepEqual(observeRemainingBudget({ getRemainingTimeInMillis: () => 12.5 }), { available: true, remainingMs: 12.5 });
    assert.deepEqual(observeRemainingBudget(undefined), unavailable);
    assert.deepEqual(observeRemainingBudget({ getRemainingTimeInMillis: () => -1 }), unavailable);
    assert.deepEqual(observeRemainingBudget({ getRemainingTimeInMillis: () => { throw new Error('x'); } }), unavailable);
  });

  await check('P10 source: no imports, provider, credential, body, timer or logging access; only IAOS_ENV is read', () => {
    const code = ts.transpileModule(fs.readFileSync(SOURCE, 'utf8'), { compilerOptions: { removeComments: true, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
    for (const banned of [/\bimport\b/, /\brequire\s*\(/, /\bfetch\s*\(/, /setTimeout|setInterval|sleep/, /console\./, /\.body\b/, /JSON\.parse/, /headers\s*\.\s*(cookie|authorization)/i, /leadconnectorhq|GHL_|BLOB|TOKEN|SECRET/i]) assert.ok(!banned.test(code), 'source matches ' + banned);
    assert.deepEqual([...code.matchAll(/process\.env\.(\w+)/g)].map((m) => m[1]), ['IAOS_ENV']);
  });

  await check('P11 the whole run made zero outbound requests and logged nothing', () => {
    assert.equal(outbound, 0); assert.equal(logged, 0);
  });

  report('Runtime budget probe: passed=' + passed + ' failed=' + failed);
  process.exitCode = failed ? 1 : 0;
})();
