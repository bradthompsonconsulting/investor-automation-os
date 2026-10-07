/**
 * Storage correction (PR #131 plan v6 §3, §4, §14) -- send ownership, terminal
 * surrender, lock v2 and the stage marker v2, over the wire harness with the
 * REAL @netlify/blobs 11.1.0 client. Offline.
 */
'use strict';
const assert = require('node:assert/strict');
require('./harness/ts-loader.cjs');
const { check, done } = require('./harness/check.cjs');
const { createWire } = require('./harness/blob-wire.cjs');
const wire = createWire({ ownershipStores: ['site:iaos-ownership-v2'] });
global.fetch = wire.fetch;
process.env.NETLIFY_BLOBS_CONTEXT = wire.context();
const vs = require('../netlify/functions/lib/verified-store.ts');
vs.transport.fetch = wire.fetch;
const { InvocationScope, clock } = require('../netlify/functions/lib/invocation-scope.ts');
const os = require('../netlify/functions/lib/owned-send.ts');
const lk = require('../netlify/functions/lib/contact-lock-v2.ts');
const sm = require('../netlify/functions/lib/stage-marker-v2.ts');
const S = 'iaos-ownership-v2';
const scope = () => new InvocationScope('ghl-write');
const store = (sc) => new vs.VerifiedStore(sc, S);
const KEYS = { decision: 'call-log/v3/decision/d1', outcome: 'call-log/v3/outcome/d1' };
const FIELDS = { scopeKey: 'test:loc', opId: 'v2-op', attemptId: 'note:1', requestDigest: 'r'.repeat(64) };
const fresh = () => wire.clear();
const LOCK = 'lock2/abc';

(async () => {
  // ── Claims and dispatch (D1–D4) ──────────────────────────────────────────
  await check('D0 a validated create mints an OwnedSend; the claim record carries the claimant hash, never the token', async () => {
    fresh();
    const sc = scope();
    const c = await os.claimSend(store(sc), sc, KEYS, FIELDS);
    assert.ok(c.owned);
    const rec = wire.json(S, KEYS.decision);
    assert.equal(rec.d, 'send');
    assert.equal(rec.claimantHash, sc.claimantHash);
    assert.equal(JSON.stringify(rec).includes('token'), false);
  });
  await check('D1 a conflict (another claimant) gives no ownership', async () => {
    fresh();
    wire.seed(S, KEYS.decision, { d: 'send', claimantHash: 'foreign' });
    const sc = scope();
    const c = await os.claimSend(store(sc), sc, KEYS, FIELDS);
    assert.equal(c.owned, null); assert.equal(c.reason, 'conflict');
  });
  await check('D1b a 403 on the claim: uncertain, then a read shows nothing -> no ownership, so 0 dispatch', async () => {
    fresh();
    wire.on(wire.put(S), wire.status(403));
    const sc = scope();
    const c = await os.claimSend(store(sc), sc, KEYS, FIELDS);
    assert.equal(c.owned, null);
  });
  await check('D3 an ack-lost claim is recovered ONLY by an exact strong read of our own claim (same scope)', async () => {
    fresh();
    wire.on(wire.put(S), wire.ackLost());
    const sc = scope();
    const c = await os.claimSend(store(sc), sc, KEYS, FIELDS);
    assert.ok(c.owned, 'own claim recovered');
  });
  await check('D3b a recovered read from ANOTHER scope (reload, other browser, other invocation) never adopts the claim', async () => {
    fresh();
    const a = scope();
    await os.claimSend(store(a), a, KEYS, FIELDS);
    const b = scope();
    wire.on(wire.put(S), wire.status(503), 9);
    const c = await os.claimSend(store(b), b, KEYS, FIELDS);
    assert.equal(c.owned, null);
  });
  await check('D2 one dispatch per invocation: a second consume throws before any I/O; a forged object is refused', async () => {
    fresh();
    const sc = scope();
    const c = await os.claimSend(store(sc), sc, KEYS, FIELDS);
    os.consumeForDispatch(c.owned);
    assert.throws(() => os.consumeForDispatch(c.owned), (e) => e instanceof os.NotDispatchable && e.reason === 'consumed');
    assert.throws(() => os.consumeForDispatch({ scope: sc }), (e) => e instanceof os.NotDispatchable && e.reason === 'forged');
  });
  await check('D4 the latch: a second OwnedSend in the same scope cannot dispatch; past T_dispatch nothing dispatches', async () => {
    fresh();
    const sc = scope();
    const a = await os.claimSend(store(sc), sc, KEYS, FIELDS);
    const b = await os.claimSend(store(sc), sc, { decision: 'call-log/v3/decision/d2', outcome: 'call-log/v3/outcome/d2' }, FIELDS);
    os.consumeForDispatch(a.owned);
    assert.throws(() => os.consumeForDispatch(b.owned), (e) => e.reason === 'latched');
    const late = scope();
    const c = await os.claimSend(store(late), late, { decision: 'x/d3', outcome: 'x/o3' }, FIELDS);
    late.deadlines.dispatch = clock.now() - 1;
    assert.throws(() => os.consumeForDispatch(c.owned), (e) => e.reason === 'scope');
  });
  // ── Terminal surrender (D5) ───────────────────────────────────────────────
  await check('D5 claim -> not_dispatched created -> dispatch(same) throws; 0 GHL calls; proves this_request', async () => {
    fresh();
    const sc = scope();
    const c = await os.claimSend(store(sc), sc, KEYS, FIELDS);
    assert.equal(await os.publishNotDispatched(store(sc), c.owned), 'this_request');
    assert.throws(() => os.consumeForDispatch(c.owned), (e) => e.reason === 'surrendered');
  });
  await check('D5a an ambiguous not_dispatched publication still surrenders; proves nothing', async () => {
    fresh();
    const sc = scope();
    const c = await os.claimSend(store(sc), sc, KEYS, FIELDS);
    wire.on(wire.put(S, KEYS.outcome), wire.ackLost());
    assert.equal(await os.publishNotDispatched(store(sc), c.owned), 'nothing');
    assert.throws(() => os.consumeForDispatch(c.owned), (e) => e.reason === 'surrendered');
  });
  await check('D5b a throw mid-write still surrenders (surrender happens before any I/O)', async () => {
    fresh();
    const sc = scope();
    const c = await os.claimSend(store(sc), sc, KEYS, FIELDS);
    wire.on(wire.put(S, KEYS.outcome), wire.reset(), 9);
    assert.equal(await os.publishNotDispatched(store(sc), c.owned), 'nothing');
    assert.equal(c.owned.surrendered, true);
  });
  await check('D5c recovery never restores a sender: a consumed send can never be published not_dispatched', async () => {
    fresh();
    const sc = scope();
    const c = await os.claimSend(store(sc), sc, KEYS, FIELDS);
    os.consumeForDispatch(c.owned);
    assert.equal(await os.publishNotDispatched(store(sc), c.owned), 'nothing');
    assert.equal(wire.json(S, KEYS.outcome), null);
  });
  await check('W1 a 403 on the withdrawal proves nothing (no attempt n+1)', async () => {
    fresh();
    wire.on(wire.put(S), wire.status(403));
    assert.equal(await os.withdraw(store(scope()), KEYS.decision), 'nothing');
  });

  // ── Lock v2 ───────────────────────────────────────────────────────────────
  await check('L0 acquire creates a held record with holderDeadline = T_abs; release CASes to free{releasedByHash}; never deleted', async () => {
    fresh();
    const sc = scope();
    const l = await lk.acquireLock(store(sc), sc, LOCK, { opId: 'v2-op', deployId: 'd' });
    const held = wire.json(S, LOCK);
    assert.equal(held.state, 'held'); assert.equal(held.holderDeadline, new Date(sc.deadlines.abs).toISOString());
    assert.equal(await l.release(), 'released');
    const free = wire.json(S, LOCK);
    assert.equal(free.state, 'free'); assert.equal(free.releasedByHash, l.holderHash);
    assert.equal(wire.count((e) => e.method === 'DELETE'), 0);
  });
  await check('L1 Bones\'s race: A\'s release applied and its ack lost -> B acquires -> A\'s retry gets 412 -> B stays locked; A proven released by B\'s prevReleasedByHash', async () => {
    fresh();
    const a = scope(); const la = await lk.acquireLock(store(a), a, LOCK, { opId: null, deployId: 'd' });
    const b = scope();
    let lb = null;
    wire.on(wire.put(S, LOCK), { kind: 'ackLost', before: async () => {} });
    // after A's release applies (ack lost), B acquires before A's adapter retry
    const origFetch = wire.fetch;
    const releasing = la.release();
    // B acquires concurrently once A's first PUT has applied
    await new Promise((r) => setTimeout(r, 50));
    lb = await lk.acquireLock(store(b), b, LOCK, { opId: null, deployId: 'd' });
    assert.equal(await releasing, 'released');
    const rec = wire.json(S, LOCK);
    assert.equal(rec.state, 'held'); assert.equal(rec.holderHash, lb.holderHash, 'B remains locked');
    assert.equal(rec.prevReleasedByHash, la.holderHash);
    void origFetch;
  });
  await check('L2 an ack-lost acquire is granted only by reading OUR holderHash', async () => {
    fresh();
    wire.on(wire.put(S, LOCK), wire.ackLost());
    const sc = scope();
    const l = await lk.acquireLock(store(sc), sc, LOCK, { opId: null, deployId: 'd' });
    assert.equal(wire.json(S, LOCK).holderHash, l.holderHash);
  });
  await check('L3 contention: a held lock refuses another holder (409 held_in_progress); after its deadline it reads held_release_unverified -- never expiry', async () => {
    fresh();
    const a = scope(); await lk.acquireLock(store(a), a, LOCK, { opId: null, deployId: 'd' });
    const b = scope();
    await assert.rejects(lk.acquireLock(store(b), b, LOCK, { opId: null, deployId: 'd' }), (e) => e instanceof lk.LockHeld && e.status === 'held_in_progress');
    const now = clock.now; clock.now = () => now() + 60_000;
    try {
      const c = new InvocationScope('ghl-write');
      await assert.rejects(lk.acquireLock(store(c), c, LOCK, { opId: null, deployId: 'd' }), (e) => e instanceof lk.LockHeld && e.status === 'held_release_unverified');
    } finally { clock.now = now; }
  });
  await check('L4 a stale etag on acquire loses the swap and re-decides from a fresh read', async () => {
    fresh();
    const a = scope(); const la = await lk.acquireLock(store(a), a, LOCK, { opId: null, deployId: 'd' }); await la.release();
    const b = scope();
    wire.on(wire.put(S, LOCK), wire.before(async () => { wire.seed(S, LOCK, { v: 2, state: 'held', holderHash: 'x', fn: 'f', opId: null, acquiredAt: 'a', holderDeadline: new Date(Date.now() + 9e6).toISOString(), prevReleasedByHash: null, deployId: 'd' }); }));
    await assert.rejects(lk.acquireLock(store(b), b, LOCK, { opId: null, deployId: 'd' }), (e) => e instanceof lk.LockHeld);
  });
  for (const fault of ['401', '403', '503x3', 'reset x3', 'hang']) {
    await check(`L8 a release fault (${fault}) never claims "released": release_unverified, the lock stays held`, async () => {
      fresh();
      const sc = scope();
      const l = await lk.acquireLock(store(sc), sc, LOCK, { opId: null, deployId: 'd' });
      if (fault === '401') wire.on(wire.put(S, LOCK), wire.status(401), 9);
      if (fault === '403') wire.on(wire.put(S, LOCK), wire.status(403), 9);
      if (fault === '503x3') wire.on(wire.put(S, LOCK), wire.status(503), 9);
      if (fault === 'reset x3') wire.on(wire.put(S, LOCK), wire.reset(), 9);
      if (fault === 'hang') { wire.on(wire.put(S, LOCK), wire.hang(), 9); sc.deadlines.clean = clock.now() + 2_500; }
      assert.equal(await l.release(), 'release_unverified');
      assert.equal(wire.json(S, LOCK).state, 'held');
    });
  }
  await check('L9 status is durable across reloads and browsers: free / held_in_progress / held_release_unverified / held_legacy / unknown', async () => {
    fresh();
    assert.equal((await lk.readLockStatus(store(scope()), LOCK, false)).status, 'free');
    const sc = scope(); await lk.acquireLock(store(sc), sc, LOCK, { opId: 'v2-op', deployId: 'd' });
    assert.equal((await lk.readLockStatus(store(scope()), LOCK, false)).status, 'held_in_progress');
    assert.equal((await lk.readLockStatus(store(scope()), LOCK, true)).status, 'held_legacy');
    wire.on(wire.get(S, LOCK), wire.status(500), 9);
    assert.equal((await lk.readLockStatus(store(scope()), LOCK, false)).status, 'unknown');
  });
  await check('L9b same-operation recovery: only with that opId\'s VERIFIED final, a held record naming it, past its deadline; never a different holder', async () => {
    fresh();
    const sc = scope(); await lk.acquireLock(store(sc), sc, LOCK, { opId: 'v2-op', deployId: 'd' });
    const r = scope();
    assert.equal(await lk.recoverLockForOperation(store(r), r, LOCK, 'v2-op', false), 'not_applicable', 'no verified final');
    assert.equal(await lk.recoverLockForOperation(store(r), r, LOCK, 'v2-op', true), 'not_applicable', 'holder may still be running');
    const now = clock.now; clock.now = () => now() + 60_000;
    try {
      const r2 = new InvocationScope('call-log-barrier');
      assert.equal(await lk.recoverLockForOperation(store(r2), r2, LOCK, 'v2-other', true), 'not_applicable', 'a different operation');
      assert.equal(await lk.recoverLockForOperation(store(r2), r2, LOCK, 'v2-op', true), 'released');
    } finally { clock.now = now; }
  });
  await check('L10 Bones\'s B/A eventual-read counterexample: an older or foreign record never proves our release', async () => {
    fresh();
    const a = scope(); const la = await lk.acquireLock(store(a), a, LOCK, { opId: null, deployId: 'd' });
    // A's release conflicts; a read shows an OLDER free record from someone else (not ours).
    wire.on(wire.put(S, LOCK), wire.before(async () => { wire.seed(S, LOCK, { v: 2, state: 'free', releasedAt: 'x', releasedByHash: 'someone-else', releasedForOp: null }); }));
    assert.equal(await la.release(), 'release_unverified');
    // eventual reads never reach ownership code
    wire.setEventual(true); wire.freeze(S, LOCK);
    assert.equal((await lk.readLockStatus(store(scope()), LOCK, false)).status, 'free');
    assert.equal(wire.violations.length, 0, 'ownership reads are strong only');
  });
  await check('T7 resume after T_abs without finally: zero I/O, the lock stays held_release_unverified', async () => {
    fresh();
    const sc = scope(); const l = await lk.acquireLock(store(sc), sc, LOCK, { opId: null, deployId: 'd' });
    const before = wire.log.length;
    sc.deadlines.abs = clock.now() - 1; sc.deadlines.clean = clock.now() - 1;
    assert.equal(await l.release(), 'release_unverified');
    assert.equal(wire.log.length, before);
    assert.equal(wire.json(S, LOCK).state, 'held');
  });

  // ── Stage marker v2 ───────────────────────────────────────────────────────
  const MK = 'stage-unresolved/m1';
  await check('S1 claim: absent -> created; unresolved -> refused (another attempt); resolved by the same attempt only', async () => {
    fresh();
    const a = scope();
    const c = await sm.claimStageMarker(store(a), a, MK, 'v2-req-a');
    assert.equal(await sm.stageMarkerUnresolved(store(scope()), MK), true);
    const b = scope();
    await assert.rejects(sm.claimStageMarker(store(b), b, MK, 'v2-req-b'), (e) => e instanceof sm.StageMarkerHeld);
    assert.equal(await c.resolve(), true);
    assert.equal(await sm.stageMarkerUnresolved(store(scope()), MK), false);
    const d = scope();
    await sm.claimStageMarker(store(d), d, MK, 'v2-req-d');   // resolved -> onlyIfMatch
    assert.equal(wire.count((e) => e.method === 'DELETE'), 0);
  });
  await check('S2 an ack-lost marker claim is ours only by our attemptHash; a failed resolve leaves it unresolved', async () => {
    fresh();
    wire.on(wire.put(S, MK), wire.ackLost());
    const a = scope();
    const c = await sm.claimStageMarker(store(a), a, MK, 'v2-req');
    wire.on(wire.put(S, MK), wire.status(403), 9);
    assert.equal(await c.resolve(), false);
    assert.equal(await sm.stageMarkerUnresolved(store(scope()), MK), true);
  });
  await check('S3 an unreadable marker fails closed (throws), never "resolved"', async () => {
    fresh();
    wire.on(wire.get(S, MK), wire.status(503), 9);
    await assert.rejects(sm.stageMarkerUnresolved(store(scope()), MK));
  });
  done('storage ownership');
})();
