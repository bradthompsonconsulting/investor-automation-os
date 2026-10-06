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
 */
const path = require('node:path');
const lib = require(path.resolve(__dirname, '../../netlify/functions/lib/current-offer-barrier.ts'));
const callLog = require(path.resolve(__dirname, '../../netlify/functions/lib/call-log-barrier.ts'));

function createBarrierFixture({ contactOf, env = 'test', locationId = 'fixture-location', callLogRules = true }) {
  const records = new Map();
  const etags = new Map();
  let etagSeq = 0;
  let failNext = [];
  const maybeFail = (op, key) => { const i = failNext.findIndex((f) => f(op, key)); if (i >= 0) { failNext.splice(i, 1); throw new Error('fixture: storage failure'); } };
  const store = {
    async get(key) { maybeFail('get', key); return records.has(key) ? structuredClone(records.get(key)) : null; },
    async getWithMetadata(key) { maybeFail('getWithMetadata', key); return records.has(key) ? { data: structuredClone(records.get(key)), etag: etags.get(key) } : null; },
    async setJSON(key, value, options) {
      maybeFail('setJSON', key);
      if (options?.onlyIfNew && records.has(key)) return { modified: false };
      if (options?.onlyIfMatch !== undefined && etags.get(key) !== options.onlyIfMatch) return { modified: false };
      records.set(key, structuredClone(value)); const etag = 'etag-' + (++etagSeq); etags.set(key, etag);
      return { modified: true, etag };
    },
  };
  const scope = lib.barrierScope(env, locationId);
  const callLogScope = callLog.callLogScope(env, locationId);
  const locked = new Set();
  const withCallLogMessage = (v) => (v.state === 'clear' ? v : { ...v, message: callLog.describeCallLog(v) });

  /** Answers one /.netlify/functions/call-log-barrier request (status / begin / reconcile). */
  async function handleCallLog(method, url, post) {
    try {
      if (method === 'GET') {
        const contactId = new URL(url).searchParams.get('contactId');
        return { status: 200, body: withCallLogMessage(await callLog.callLogStatus(store, callLogScope, contactId)) };
      }
      const contactId = post.contactId;
      if (locked.has(contactId)) return { status: 409, body: { state: 'in_progress', message: 'Another write for this contact is in progress. Nothing was changed; use Check again in a moment.' } };
      if (post.action === 'begin') {
        let v;
        try { v = callLog.validateBegin(post.purpose, post.result, post.body, post.steps); } catch { return { status: 400, body: { error: 'Invalid call-log request' } }; }
        try {
          await callLog.beginCallLog(store, callLogScope, { contactId, purpose: v.purpose, result: v.result, body: v.body, steps: v.steps }, new Date().toISOString());
          return { status: 200, body: { state: 'reserved' } };
        } catch (e) {
          if (e instanceof callLog.CallLogHeld) return { status: 409, body: withCallLogMessage(e.status) };
          if (e instanceof callLog.ReservationMismatch) return { status: 409, body: { state: 'rejected', code: 'reservation_mismatch', message: e.message } };
          throw e;
        }
      }
      if (post.action === 'reconcile') {
        const out = await callLog.reconcileCallLog(store, callLogScope, contactId, post.attempt);
        return { status: 200, body: out.state === 'clear' ? out : withCallLogMessage(out) };
      }
      return { status: 400, body: { error: 'Invalid' } };
    } catch {
      return { status: 503, body: { error: 'The call-log request could not be completed; nothing was sent to GHL' } };
    }
  }
  const withMessage = (s) => (s.state === 'clear' ? s : { ...s, message: lib.describeBlocked(s) });

  /** Answers one /.netlify/functions/current-offer-barrier request. */
  async function handle(method, url, post) {
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
    // ghl-write's call-log rule (lib/call-log-barrier.ts), checked before the Current Offer rules apply.
    const needsCallLog = operation === 'contact.callLogResult' || (operation === 'note.create' && callLog.isCallLogNoteText(args && args.body));
    if (callLogRules && callLog.CALL_LOG_OPERATIONS.has(operation)) {
      let clOwned;
      try { clOwned = await callLog.isCallLogOwned(store, callLogScope, requestId); }
      catch { if (needsCallLog) return { status: 409, body: { outcome: 'not_sent', error: 'The call-log reservation could not be read; nothing was sent' } }; clOwned = false; }
      if (needsCallLog && !clOwned) return { status: 409, body: { outcome: 'not_sent', error: 'No call-log reservation for this write; nothing was sent' } };
      if (clOwned) {
        if (locked.has(targetId)) return { status: 409, body: { outcome: 'not_sent', error: 'Nothing was sent; the save could not start' } };
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
          if (e instanceof callLog.NotSent || e instanceof callLog.NotOwned) return { status: 409, body: { outcome: 'not_sent', error: `${e.message}; nothing was sent` } };
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
    callLogStatus: (contactId) => callLog.callLogStatus(store, callLogScope, contactId),
    status: (opp) => lib.statusOf(store, scope, opp),
    failStorageOnce: (pred) => failNext.push(pred),
    reset() { records.clear(); etags.clear(); locked.clear(); failNext = []; },
  };
}

module.exports = { createBarrierFixture };
