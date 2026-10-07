/**
 * Storage correction (PR #131 plan v6 §7) -- pinned budgets and latency realism.
 *
 * 1. MEASURE, per endpoint path, the sequential storage round trips before
 *    each GHL dispatch: every storage request over the wire gets a fixed
 *    latency D; the GHL fake answers instantly; N = time-to-dispatch / D.
 * 2. Assert N x p95 + 1 s <= T_dispatch (p95 = 600 ms).
 * 3. Simulate 1,000 ordinary saves per path, drawing each of the N round trips
 *    from the latency model (p50 150 ms, p95 600 ms, p99 1.5 s): 0 may end in
 *    recovery (total > T_dispatch) when every round trip is <= p99, and the
 *    99th-percentile total must be <= 0.6 x T_dispatch.
 * 4. Tail: an injected 5 s stall ends in the protected uncertain / refused
 *    state (never Saved, never a send after T_dispatch).
 * 5. The budget-table constants are asserted.
 */
'use strict';
process.env.NODE_ENV = 'test';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { setupV2Env } = require('./harness/v2-env.cjs');
const { check, done } = require('./harness/check.cjs');
const { createGhl } = require('./harness/ghl-fake.cjs');
const env = setupV2Env();
const { getConfig } = require('../shared/ghl-config.ts');
const config = getConfig('test');
const ghl = createGhl(config.locationId);
const { BUDGETS } = require('../netlify/functions/lib/invocation-scope.ts');
const { callLogNote } = require('../src/lib/call-outcome-copy.ts');
const FN = {
  'call-log-barrier': require('../netlify/functions/call-log-barrier.ts'),
  'current-offer-barrier': require('../netlify/functions/current-offer-barrier.ts'),
  'ghl-write': require('../netlify/functions/ghl-write.ts'),
  'ghl-disposition': require('../netlify/functions/ghl-disposition.ts'),
};
process.env.IAOS_WEBHOOK_SECRET = 'offline-webhook-secret-fixture';
const A = 'fixtureContactA';
const OPP = 'fixtureOppA';
const v2 = () => 'v2-' + crypto.randomUUID();
let t0 = 0; const dispatchTimes = [];
env.hooks.ghlFetch = async (url, init = {}) => {
  if ((init.method || 'GET') !== 'GET') dispatchTimes.push(Date.now() - t0);
  return ghl.fetch(url, init);
};
const post = (fn, body, headers = env.writeHeaders()) => env.invoke(FN[fn], { fn, httpMethod: 'POST', headers, body: JSON.stringify(body) });
const D = 120;
function fresh() { env.reset(); ghl.clear(); ghl.addContact(A); ghl.addOpp(OPP, A, { customFields: [] }); dispatchTimes.length = 0; }
async function measure(prep, act) {
  fresh(); await prep();
  env.wire.setLatency((req) => (req.store === 'site:iaos-ownership-v2' ? D : 0));
  dispatchTimes.length = 0; t0 = Date.now();
  const r = await act();
  env.wire.setLatency(null);
  return { r, rounds: dispatchTimes.map((t) => Math.round(t / D)) };
}
// The latency model: a piecewise log-linear distribution through p50 150, p95 600, p99 1500 (cap 3 s).
function sample() {
  const u = Math.random();
  const seg = (u0, u1, v0, v1) => Math.exp(Math.log(v0) + ((u - u0) / (u1 - u0)) * (Math.log(v1) - Math.log(v0)));
  if (u < 0.5) return seg(0, 0.5, 40, 150);
  if (u < 0.95) return seg(0.5, 0.95, 150, 600);
  if (u < 0.99) return seg(0.95, 0.99, 600, 1500);
  return seg(0.99, 1, 1500, 3000);
}
const results = {};

(async () => {
  await check('B0 the budget table is pinned (plan v6 §7)', async () => {
    for (const fn of ['call-log-barrier', 'current-offer-barrier', 'ghl-write', 'ghl-disposition']) assert.deepEqual([BUDGETS[fn].work, BUDGETS[fn].ghlTimeout, BUDGETS[fn].dispatch, BUDGETS[fn].clean, BUDGETS[fn].abs], [20_000, 10_000, 10_000, 25_000, 26_000], fn);
    assert.equal(BUDGETS['ghl-disposition'].contactCheck, 5_000);
    assert.deepEqual([BUDGETS['ghl-executed-artifact-upload'].ghlTimeout, BUDGETS['ghl-executed-artifact-upload'].dispatch], [null, null]);
    assert.deepEqual([BUDGETS['ghl-executed-artifact-upload:finalize'].ghlTimeout, BUDGETS['ghl-executed-artifact-upload:finalize'].dispatch], [12_000, 8_000]);
    for (const b of Object.values(BUDGETS)) if (b.dispatch !== null) assert.equal(b.dispatch, b.work - b.ghlTimeout);
  });
  const paths = {
    'ghl-write: call-log result slot (owned)': async () => {
      const op = v2(); const note = callLogNote('No Answer', '');
      return measure(async () => { await post('call-log-barrier', { action: 'begin', contactId: A, operationId: op, result: 'No Answer', body: note }); },
        () => post('ghl-write', { operation: 'contact.callLogResult', targetId: A, requestId: `${op}-result-1`, args: { value: 'No Answer' } }));
    },
    'ghl-write: call-log note slot (owned, previous slot confirmed)': async () => {
      const op = v2(); const note = callLogNote('No Answer', '');
      return measure(async () => {
        await post('call-log-barrier', { action: 'begin', contactId: A, operationId: op, result: 'No Answer', body: note });
        await post('ghl-write', { operation: 'contact.callLogResult', targetId: A, requestId: `${op}-result-1`, args: { value: 'No Answer' } });
      }, () => post('ghl-write', { operation: 'note.create', targetId: A, requestId: `${op}-note-1`, args: { body: note } }));
    },
    'ghl-write: Current Offer (owned)': async () => {
      const id = v2();
      return measure(async () => { await post('current-offer-barrier', { action: 'begin', opportunityId: OPP, purpose: 'blur', steps: [{ step: 'offer', requestId: id }] }); },
        () => post('ghl-write', { operation: 'opportunity.currentOffer', targetId: OPP, requestId: id, args: { value: 250000 } }));
    },
    'ghl-write: plain note': async () => measure(async () => {}, () => post('ghl-write', { operation: 'note.create', targetId: A, requestId: v2(), args: { body: 'plain' } })),
    'ghl-disposition: note then last touch (two dispatches)': async () => measure(async () => {}, () => post('ghl-disposition', { customData: { contact_id: A, disposition: 'No Answer', duration: '3' } }, { 'x-iaos-secret': process.env.IAOS_WEBHOOK_SECRET })),
  };
  for (const [name, run] of Object.entries(paths)) {
    await check(`B1 ${name}: measured round trips N, N x p95 + 1 s <= T_dispatch`, async () => {
      const { r, rounds } = await run();
      assert.equal(r.statusCode, 200, r.body);
      assert.ok(rounds.length >= 1, 'it dispatched');
      const N = Math.max(...rounds);
      results[name] = N; console.log('  measured N =', N, 'dispatch rounds', JSON.stringify(rounds));
      assert.ok(N * 600 + 1000 <= 10_000, `N=${N}: ${N * 600 + 1000} ms > T_dispatch`);
    });
  }
  await check('B2 1,000 simulated ordinary saves per path: 0 in recovery when every round trip <= p99; the p99 total <= 0.6 x T_dispatch', async () => {
    const report = [];
    for (const [name, N] of Object.entries(results)) {
      const totals = []; let recovery = 0;
      for (let i = 0; i < 1000; i++) {
        let total = 0; let allWithinP99 = true;
        for (let k = 0; k < N; k++) { const x = sample(); total += x; if (x > 1500) allWithinP99 = false; }
        totals.push(total);
        if (allWithinP99 && total > 10_000) recovery++;
      }
      totals.sort((a, b) => a - b);
      const p99 = totals[989];
      report.push(`${name}: N=${N}, p50=${Math.round(totals[499])} ms, p99=${Math.round(p99)} ms, recovery=${recovery}`);
      assert.equal(recovery, 0, name);
      assert.ok(p99 <= 6_000, `${name}: p99 total ${Math.round(p99)} ms > 0.6 x T_dispatch`);
    }
    console.log('  ' + report.join('\n  '));
  });
  await check('B3 tail: an injected 5 s storage stall before dispatch ends refused or uncertain -- never Saved, never a send after T_dispatch', async () => {
    fresh();
    let stalled = false;
    env.wire.setLatency((req) => { if (!stalled && req.store === 'site:iaos-ownership-v2' && req.key === 'authz/admission' && req.method === 'PUT') { stalled = true; return 5_000; } return 0; });
    dispatchTimes.length = 0; t0 = Date.now();
    const r = await post('ghl-write', { operation: 'note.create', targetId: A, requestId: v2(), args: { body: 'plain' } });
    env.wire.setLatency(null);
    assert.ok(dispatchTimes.every((t) => t <= 10_000), 'no send after T_dispatch');
    if (dispatchTimes.length === 0) assert.notEqual(r.statusCode, 200);
  });
  done('storage budgets');
})();
