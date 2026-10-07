/**
 * Board 15 / PR #126 stacked server PR -- the durable Current Offer barrier for
 * the offline BROWSER tests. It runs the REAL server module
 * (netlify/functions/lib/current-offer-barrier.ts) in Node against an
 * in-memory store, and mirrors ghl-write's own use of it:
 *   - /.netlify/functions/current-offer-barrier  begin / reconcile / status,
 *     with the per-contact write lock ("in_progress" while a write holds it);
 *   - barrier-owned writes: no reservation -> 409 not_sent for a Current Offer;
 *     the send is claimed by `beforeDispatch` immediately before the fixture
 *     applies the write; a refusal before that answers 409 not_sent; a failure
 *     after it is recorded as uncertain and answers 409 indeterminate.
 * State lives in Node, so a second browser context and a page reload see the
 * same records -- the point of the durable barrier.
 *
 * Board 15 / PR #131: the same fixture also runs the REAL durable call-log
 * module (netlify/functions/lib/call-log-barrier.ts) against the same store,
 * mirroring ghl-write and /.netlify/functions/call-log-barrier: a call result
 * or a call-log-format note is refused (not_sent) without a reservation, and a
 * reserved step is checked, ordered, claimed and recorded exactly as on the
 * server. Callers pass the write's `args`.
 *
 * The caller must install the `.ts` transpile hook before requiring this file.
 *
 * Storage correction (PR #131): the store is the REAL verified adapter
 * (lib/verified-store.ts) over the REAL @netlify/blobs client and the wire
 * harness -- strong reads only, conditional writes classified from the wire.
 * `failStorageOnce` maps to wire faults (an exhausted 5xx, i.e. an uncertain
 * outcome); `staleReadOnce` freezes the cached origin for that key, which no
 * ownership read can reach any more (the wire records a violation if one does).
 */
const path = require('node:path');
const lib = require(path.resolve(__dirname, '../../netlify/functions/lib/current-offer-barrier.ts'));
const callLog = require(path.resolve(__dirname, '../../netlify/functions/lib/call-log-barrier.ts'));
const vs = require(path.resolve(__dirname, '../../netlify/functions/lib/verified-store.ts'));
const { InvocationScope } = require(path.resolve(__dirname, '../../netlify/functions/lib/invocation-scope.ts'));
const { createWire } = require('./blob-wire.cjs');

function createBarrierFixture({ contactOf, env = 'test', locationId = 'fixture-location', callLogRules = true }) {
  const S = vs.OWNERSHIP_STORE;
  const wire = createWire({ ownershipStores: ['site:' + S] });
  const ctx = JSON.parse(Buffer.from(wire.context(), 'base64').toString('utf8'));
  const prevTransport = vs.transport.fetch;
  /* The adapter's transport: this fixture's wire for blob hosts; anything else goes to whatever was installed before. */
  vs.transport.fetch = async (url, init) => {
    const u = new URL(String(url));
    if (u.origin === wire.EDGE || u.origin === wire.UNCACHED) return wire.fetch(url, init);
    return (prevTransport || globalThis.fetch)(url, init);
  };
  /** A fresh verified store per simulated invocation (each has its own scope and claim token). */
  const freshStore = () => new vs.VerifiedStore(new InvocationScope('ghl-write'), S, ctx);
  let store = freshStore();
  const records = { keys: () => wire.keys(S)[Symbol.iterator](), has: (k) => wire.keys(S).includes(k), get: (k) => wire.json(S, k) };
  const scope = lib.barrierScope(env, locationId);
  const callLogScope = callLog.callLogScope(env, locationId);
  const locked = new Set();
  /** Answers one /.netlify/functions/call-log-barrier request (approved lifecycle v3), as the real endpoint does. */
  async function handleCallLog(method, url, post) {
    store = freshStore();
    try {
      if (method === 'GET') {
        const q = new URL(url).searchParams;
        const contactId = q.get('contactId');
        const op = q.get('operationId');
        if (op === null) return { status: 200, body: await callLog.statusByContact(store, callLogScope, contactId) };
        const v = await callLog.statusByOperation(store, callLogScope, contactId, op);
        return v ? { status: 200, body: v } : { status: 404, body: { state: 'unknown' } };
      }
      const contactId = post.contactId;
      if (locked.has(contactId)) return { status: 409, body: { state: 'in_progress', message: 'Another write for this contact is in progress. Nothing was changed; use Check again in a moment.' } };
      const now = new Date().toISOString();
      if (post.action === 'begin') {
        if (Object.keys(post).sort().join() !== 'action,body,contactId,operationId,result') return { status: 400, body: { error: 'Invalid call-log request' } };
        let v;
        try { v = callLog.validateBegin(post.operationId, post.result, post.body); } catch { return { status: 400, body: { error: 'Invalid call-log request' } }; }
        try { return { status: 200, body: await callLog.beginOperation(store, callLogScope, { contactId, op: v.op, result: v.result, body: v.body }, now) }; }
        catch (e) {
          if (e instanceof callLog.CallLogHeld) return { status: 409, body: { state: 'held', current: e.status } };
          if (e instanceof callLog.ReservationMismatch) return { status: 409, body: { state: 'rejected', code: 'reservation_mismatch', message: e.message } };
          throw e;
        }
      }
      if (post.action === 'resume' && post.legacy === true) return { status: 200, body: await callLog.settleLegacy(store, callLogScope, contactId) };
      if (post.action === 'resume' || post.action === 'retry') {
        let v;
        try {
          v = post.action === 'resume'
            ? await callLog.resumeOperation(store, callLogScope, contactId, post.operationId)
            : await callLog.retryAttempt(store, callLogScope, contactId, post.operationId, post.slot, post.after);
        } catch (e) { if (e instanceof callLog.InvalidRequest) return { status: 400, body: { error: e.message } }; throw e; }
        return v ? { status: 200, body: v } : { status: 404, body: { state: 'unknown' } };
      }
      return { status: 400, body: { error: 'Invalid call-log request' } };
    } catch {
      return { status: 503, body: { error: 'The call-log request could not be completed; nothing was sent to GHL' } };
    }
  }

  const withMessage = (s) => (s.state === 'clear' ? s : { ...s, message: lib.describeBlocked(s) });

  /** Answers one /.netlify/functions/current-offer-barrier request. */
  async function handle(method, url, post) {
    store = freshStore();
    try {
      if (method === 'GET') {
        const opp = new URL(url).searchParams.get('opportunityId');
        return { status: 200, body: withMessage(await lib.statusOf(store, scope, opp)) };
      }
      const opp = post.opportunityId;
      const contactId = contactOf(opp);
      if (!contactId) return { status: 503, body: { error: 'unknown opportunity' } };
      if (locked.has(contactId)) return { status: 409, body: { state: 'in_progress', message: 'Another write for this contact is in progress. Nothing was changed; use Check again in a moment.' } };
      if (post.action === 'begin') {
        const v = lib.validateSteps(post.purpose, post.steps);
        try {
          await lib.beginBarrier(store, scope, { opp, contactId, purpose: v.purpose, steps: v.steps }, new Date().toISOString());
          return { status: 200, body: { state: 'reserved' } };
        } catch (e) {
          if (e instanceof lib.BarrierHeld) return { status: 409, body: withMessage(e.status) };
          throw e;
        }
      }
      if (post.action === 'reconcile') return { status: 200, body: withMessage(await lib.reconcileBarrier(store, scope, opp)) };
      return { status: 400, body: { error: 'Invalid' } };
    } catch {
      return { status: 503, body: { error: 'The Current Offer barrier request could not be completed; nothing was sent to GHL' } };
    }
  }

  /**
   * One ghl-write request for a barrier-relevant operation.
   *   apply()          performs the write in the fixture's GHL and returns { confirmed }.
   *   refuse           a pre-send refusal { status, error } (the server's gate).
   *   failAfterSend    the GHL call is made, then fails (the response is lost).
 *   sentNotApplied   the GHL call leaves but is not applied yet (it may land later).
   * Returns { status, body } exactly as ghl-write would.
   */
  async function write({ operation, targetId, requestId, contactId, args }, apply, { refuse = null, failAfterSend = false, sentNotApplied = false, beforeLockRelease = null, outcome = null } = {}) {
    store = freshStore();
    // ghl-write's call-log rule (lib/call-log-barrier.ts), checked before the Current Offer rules apply.
    const needsCallLog = operation === 'contact.callLogResult' || (operation === 'note.create' && callLog.isCallLogNoteText(args && args.body))
      || (callLog.CALL_LOG_OPERATIONS.has(operation) && typeof callLog.isOperationRequestId === 'function' && callLog.isOperationRequestId(requestId));
    if (callLogRules && callLog.CALL_LOG_OPERATIONS.has(operation)) {
      let clOwned;
      try { clOwned = await callLog.isCallLogBound(store, callLogScope, requestId); }
      catch { if (needsCallLog) return { status: 409, body: { outcome: 'not_sent', error: 'The call-log reservation could not be read; nothing was sent' } }; clOwned = false; }
      if (needsCallLog && !clOwned) return { status: 409, body: { outcome: 'not_sent', proves: 'nothing', error: 'No call-log reservation for this write; nothing was sent' } };
      if (clOwned) {
        if (locked.has(targetId)) return { status: 409, body: { outcome: 'not_sent', proves: 'nothing', error: 'Nothing was sent; the save could not start' } };
        locked.add(targetId);
        try {
          const done = await callLog.runCallLogOwnedWrite(store, callLogScope, { operation, targetId, requestId, args }, async (hooks) => {
            if (refuse) { const e = new Error(refuse.error); e.refusal = refuse; throw e; }
            await hooks.beforeDispatch();
            hooks.state.dispatched = true;
            if (sentNotApplied) throw new Error('fixture: sent, response lost, not applied yet');
            const r = await apply();
            if (failAfterSend) throw new Error('fixture: response lost after the GHL call');
            return { confirmed: r.confirmed };
          });
          if (beforeLockRelease) await beforeLockRelease();
          return { status: 200, body: { confirmed: done.confirmed } };
        } catch (e) {
          if (e instanceof callLog.NotSent || e instanceof callLog.NotOwned) {
            const cl = e instanceof callLog.NotSent ? e : null;
            return { status: 409, body: { outcome: 'not_sent', proves: cl ? cl.proves : 'nothing', ...(cl && cl.code ? { code: cl.code } : {}), ...(cl && cl.outcome ? { recorded: cl.outcome } : {}), error: `${e.message}; nothing was sent` } };
          }
          return { status: 409, body: { outcome: 'indeterminate', error: 'The call save may have reached GHL; it is unresolved' } };
        } finally { locked.delete(targetId); }
      }
    }
    let owned;
    try { owned = await lib.isBarrierOwned(store, scope, requestId); }
    catch {
      if (operation === 'opportunity.currentOffer') return { status: 409, body: { outcome: 'not_sent', error: 'The Current Offer reservation could not be read; nothing was sent' } };
      return { status: 409, body: { error: 'Write refused or unconfirmed; refresh and inspect before retrying' } };
    }
    if (lib.RESERVED_OPERATIONS.has(operation) && !owned) return { status: 409, body: { outcome: 'not_sent', error: 'No reservation for this write; nothing was sent' } };
    // ghl-write's rule: a negotiation-outcome note only under a reservation of the same kind.
    if (operation === 'note.create') {
      let refusal;
      try { refusal = await lib.checkNoteReservation(store, scope, requestId, outcome); } catch { refusal = 'The reservation could not be read; nothing was sent'; }
      if (refusal) return { status: 409, body: { outcome: 'not_sent', error: refusal } };
    }
    if (!owned) {
      if (refuse) return { status: refuse.status, body: { error: refuse.error } };
      const r = await apply();
      return { status: 200, body: { confirmed: r.confirmed } };
    }
    if (locked.has(contactId)) return { status: 409, body: { outcome: 'not_sent', error: 'Nothing was sent; the save could not start' } };
    locked.add(contactId);
    try {
      const done = await lib.runOwnedWrite(store, scope, { operation, targetId, requestId, contactId }, async (hooks) => {
        if (refuse) { const e = new Error(refuse.error); e.refusal = refuse; throw e; }
        await hooks.beforeDispatch();
        hooks.state.dispatched = true;
        // The GHL call left but has not been applied yet (it may land later).
        if (sentNotApplied) throw new Error('fixture: sent, response lost, not applied yet');
        const r = await apply();
        if (failAfterSend) throw new Error('fixture: response lost after the GHL call');
        return { confirmed: r.confirmed };
      });
      if (beforeLockRelease) await beforeLockRelease();
      return { status: 200, body: { confirmed: done.confirmed } };
    } catch (e) {
      if (e instanceof lib.NotSent) {
        const refusal = e.refusal && e.refusal.refusal ? e.refusal.refusal : null;
        return { status: refusal ? refusal.status : 409, body: { error: refusal ? refusal.error : 'Nothing was sent; the save was refused before reaching GHL', outcome: 'not_sent' } };
      }
      return { status: 409, body: { outcome: 'indeterminate', error: 'The save may have reached GHL; it is unresolved' } };
    } finally { locked.delete(contactId); }
  }

  return {
    handle, handleCallLog, write, store, records,
    callLogStatus: (contactId) => callLog.statusByContact(store, callLogScope, contactId),
    callLogOperation: (contactId, op) => callLog.statusByOperation(store, callLogScope, contactId, op),
    status: (opp) => lib.statusOf(store, scope, opp),
    /** pred(kind, key), kind 'setJSON' | 'get' | 'getWithMetadata': that request's storage outcome becomes uncertain (an exhausted 5xx). */
    failStorageOnce: (pred) => wire.on((req) => pred(req.method === 'PUT' ? 'setJSON' : req.method === 'GET' ? 'getWithMetadata' : req.method, req.key) || (req.method === 'GET' && pred('get', req.key)), wire.status(503), 3),
    /** v2 reads are strong: a stale cached copy is kept for the key, and any ownership read reaching it is a recorded violation. */
    staleReadOnce: (pred) => { wire.setEventual(true); for (const k of wire.keys(S)) if (pred(k)) wire.freeze(S, k); },
    violations: () => wire.violations,
    /** The key of a call-log v3 record, as the module computes it (for targeted storage faults in tests). */
    callLogKey: (kind, ...parts) => {
      const { digest } = require(path.resolve(__dirname, '../../netlify/functions/lib/hash.ts'));
      return `call-log/v3/${kind}/${digest([callLogScope, ...parts].join(':'))}`;
    },
    reset() { wire.clear(); locked.clear(); store = freshStore(); },
  };
}

module.exports = { createBarrierFixture };
