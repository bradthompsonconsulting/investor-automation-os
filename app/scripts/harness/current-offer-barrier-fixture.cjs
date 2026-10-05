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
 * The caller must install the `.ts` transpile hook before requiring this file.
 */
const path = require('node:path');
const lib = require(path.resolve(__dirname, '../../netlify/functions/lib/current-offer-barrier.ts'));

function createBarrierFixture({ contactOf, env = 'test', locationId = 'fixture-location' }) {
  const records = new Map();
  let failNext = [];
  const maybeFail = (op, key) => { const i = failNext.findIndex((f) => f(op, key)); if (i >= 0) { failNext.splice(i, 1); throw new Error('fixture: storage failure'); } };
  const store = {
    async get(key) { maybeFail('get', key); return records.has(key) ? structuredClone(records.get(key)) : null; },
    async setJSON(key, value, options) { maybeFail('setJSON', key); if (options?.onlyIfNew && records.has(key)) return { modified: false }; records.set(key, structuredClone(value)); return { modified: true }; },
    async delete(key) { maybeFail('delete', key); records.delete(key); },
  };
  const scope = lib.barrierScope(env, locationId);
  const locked = new Set();
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
   * Returns { status, body } exactly as ghl-write would.
   */
  async function write({ operation, targetId, requestId, contactId }, apply, { refuse = null, failAfterSend = false, beforeLockRelease = null } = {}) {
    let owned;
    try { owned = await lib.isBarrierOwned(store, scope, requestId); }
    catch {
      if (operation === 'opportunity.currentOffer') return { status: 409, body: { outcome: 'not_sent', error: 'The Current Offer reservation could not be read; nothing was sent' } };
      return { status: 409, body: { error: 'Write refused or unconfirmed; refresh and inspect before retrying' } };
    }
    if (operation === 'opportunity.currentOffer' && !owned) return { status: 409, body: { outcome: 'not_sent', error: 'No Current Offer reservation for this save; nothing was sent' } };
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
    handle, write, store, records,
    status: (opp) => lib.statusOf(store, scope, opp),
    failStorageOnce: (pred) => failNext.push(pred),
    reset() { records.clear(); locked.clear(); failNext = []; },
  };
}

module.exports = { createBarrierFixture };
