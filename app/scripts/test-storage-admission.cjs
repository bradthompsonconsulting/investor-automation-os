/**
 * Storage correction -- write admission and publication control (PR #131
 * amendments r1–r4; Bones-approved r4 #issuecomment-6043033100), over the wire
 * harness with the REAL @netlify/blobs 11.1.0 client. Offline.
 *
 * Groups: sender tickets (PUB-*), the single authoritative record (ST-1..ST-6),
 * publication attempts (PA-*), the default-deny classifier (CL-1..CL-7) and
 * the accepted Owner exception (OB-1, a documented known gap -- not a protection).
 */
'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
require('./harness/ts-loader.cjs');
const { check, done } = require('./harness/check.cjs');
const { createWire } = require('./harness/blob-wire.cjs');
const wire = createWire({ ownershipStores: ['site:iaos-ownership-v2'] });
global.fetch = wire.fetch;
process.env.NETLIFY_BLOBS_CONTEXT = wire.context();
const vs = require('../netlify/functions/lib/verified-store.ts');
vs.transport.fetch = wire.fetch;
const { InvocationScope } = require('../netlify/functions/lib/invocation-scope.ts');
const ad = require('../netlify/functions/lib/admission.ts');
const S = 'iaos-ownership-v2';
const KEY = 'authz/admission';
const A = '6ac5f00d000000000000000a';
const B = '6ac5f00d000000000000000b';
const SITE = '00000000-0000-0000-0000-000000000001';
const scope = (fn = 'ghl-write') => new InvocationScope(fn);
const store = (sc = scope('iaos-activation')) => new vs.VerifiedStore(sc, S);
const tok = () => crypto.randomBytes(32).toString('hex');
const rec = () => wire.json(S, KEY);
const isPut = (req) => req.method === 'PUT' && req.key === KEY;

/** A fixture-only APPROVED semantics record (the real one is a gated release prerequisite, P5). */
const SEMANTICS = {
  v: 1, ref: 'fixture-semantics-1', endpoint: 'restoreSiteDeploy', createdAt: '2026-10-07T00:00:00.000Z',
  approvals: { bones: 'fixture-approval-bones', jess: 'fixture-approval-jess' },
  predicates: [
    { id: 'applied-201', classifies: 'APPLIED', status: 201, body: [{ field: 'id', op: 'equals_target' }, { field: 'published_at', op: 'present' }], citation: 'fixture citation only' },
    { id: 'rejected-404', classifies: 'REJECTED', status: 404, body: [{ field: 'code', op: 'equals', value: '404' }], citation: 'fixture citation only' },
  ],
};
const R201 = (target) => ({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: target, site_id: SITE, published_at: '2026-10-07T02:00:00Z', state: 'ready' }) });

function seedOpen(deployId = A, activationId = 'v2-act-0001', epoch = 1) {
  wire.seed(S, KEY, { v: 3, epoch, activationId, deployId, state: 'open', g5Digest: 'g'.repeat(64), activatedAt: 'x', activationMark: 'fixture', tickets: {}, publication: null });
}
async function fullCycle(p, target, { semantics = true } = {}) {
  const s = store();
  if (semantics && !wire.json(S, 'authz/provider-semantics/1')) await ad.registerSemantics(s, 1, SEMANTICS);
  const pubId = 'pub-' + crypto.randomBytes(4).toString('hex');
  await ad.closeAdmission(s, p, pubId, target);
  const att = 'att-' + crypto.randomBytes(4).toString('hex');
  await ad.claimAttempt(s, p, att);
  await ad.markAttemptDispatching(s, p, att, SITE);
  const c = await ad.recordResponse(s, p, att, R201(target));
  const r = rec();
  const act = 'v2-act-' + crypto.randomBytes(4).toString('hex');
  const next = await ad.activate(s, scope('iaos-activation'), { p, runtimeDeployId: target, attemptSetDigest: r.publication.attemptSetDigest, g5Digest: 'g'.repeat(64), activationId: act });
  return { pubId, att, c, activationId: next.activationId };
}
const spec = (subject = 'contact:x', effects = ['note'], rid = 'v2-req-' + crypto.randomBytes(4).toString('hex')) => ({ opId: 'v2-op', attemptId: 'note:1', requestId: rid, subject, effects });
const fresh = () => wire.clear();

(async () => {
  // ── Sender tickets ────────────────────────────────────────────────────────
  await check('PUB-1 Bones\'s race (b): A paused AFTER its dispatching CAS; close, publish B, activate B; A sends; B\'s overlapping admits refused until A\'s exact outcome; non-overlapping proceed', async () => {
    fresh(); seedOpen(A);
    const sa = scope(); const sta = store(sa);
    const cap = await ad.captureActivation(sta, A, 'v2-act-0001');
    const held = await ad.admit(sta, sa, cap, spec('contact:x', ['note']));
    await ad.markDispatching(sta, held);
    const p = tok();
    await fullCycle(p, B);
    assert.equal(rec().tickets[held.ticket.ticketId].state, 'dispatching', 'kept across publication and activation');
    const sb = scope(); const stb = store(sb);
    const capB = await ad.captureActivation(stb, B, rec().activationId);
    await assert.rejects(ad.admit(stb, sb, capB, spec('contact:x', ['note', 'last_touch'])), (e) => e instanceof ad.TicketOverlap);
    const other = await ad.admit(stb, sb, capB, spec('contact:y', ['note']));
    assert.ok(other.ticket);
    assert.equal(await ad.removeWithOutcome(sta, held, 'confirmed'), true);
    const sb2 = scope(); const stb2 = store(sb2);
    assert.ok(await ad.admit(stb2, sb2, await ad.captureActivation(stb2, B, rec().activationId), spec('contact:x', ['note'])));
  });
  await check('PUB-2 race (a): A paused after admit, before dispatching; close revokes it; A\'s dispatching CAS fails; 0 sends', async () => {
    fresh(); seedOpen(A);
    const sa = scope(); const sta = store(sa);
    const held = await ad.admit(sta, sa, await ad.captureActivation(sta, A, 'v2-act-0001'), spec());
    await ad.closeAdmission(store(), tok(), 'pub-00000002', B);
    assert.equal(rec().tickets[held.ticket.ticketId], undefined, 'admitted ticket revoked at close');
    await assert.rejects(ad.markDispatching(sta, held), (e) => e instanceof ad.AdmissionClosed);
  });
  await check('PUB-3 an uncertain ticket survives B\'s and C\'s cycles; overlap refused indefinitely', async () => {
    fresh(); seedOpen(A);
    const sa = scope(); const sta = store(sa);
    const held = await ad.admit(sta, sa, await ad.captureActivation(sta, A, 'v2-act-0001'), spec());
    await ad.markDispatching(sta, held); await ad.markUncertain(sta, held);
    const p = tok(); await fullCycle(p, B); await fullCycle(p, A);
    assert.equal(rec().tickets[held.ticket.ticketId].state, 'uncertain');
    const sc = scope(); const st = store(sc);
    await assert.rejects(ad.admit(st, sc, await ad.captureActivation(st, A, rec().activationId), spec()), (e) => e instanceof ad.TicketOverlap);
  });
  await check('PUB-4 admit racing close: exactly one compare-and-swap wins; no admit after close', async () => {
    fresh(); seedOpen(A);
    const sa = scope(); const sta = store(sa);
    const cap = await ad.captureActivation(sta, A, 'v2-act-0001');
    wire.on(isPut, wire.before(async () => { await ad.closeAdmission(store(), tok(), 'pub-00000004', B); }));
    await assert.rejects(ad.admit(sta, sa, cap, spec()), (e) => e instanceof ad.AdmissionClosed);
    assert.equal(Object.keys(rec().tickets).length, 0);
  });
  await check('PUB-5a an ambiguous dispatching CAS that reads back `admitted` -> not applied -> send nothing', async () => {
    fresh(); seedOpen(A);
    const sa = scope(); const sta = store(sa);
    const held = await ad.admit(sta, sa, await ad.captureActivation(sta, A, 'v2-act-0001'), spec());
    wire.on(isPut, wire.status(503), 3);
    await assert.rejects(ad.markDispatching(sta, held), (e) => e instanceof ad.TransitionUnresolved);
    assert.equal(rec().tickets[held.ticket.ticketId].state, 'admitted');
  });
  await check('PUB-5b an ambiguous dispatching CAS that reads a DIFFERENT dispatchMark -> send nothing', async () => {
    fresh(); seedOpen(A);
    const sa = scope(); const sta = store(sa);
    const held = await ad.admit(sta, sa, await ad.captureActivation(sta, A, 'v2-act-0001'), spec());
    wire.on(isPut, { kind: 'status', status: 503, before: async () => { const r = rec(); r.tickets[held.ticket.ticketId] = { ...r.tickets[held.ticket.ticketId], state: 'dispatching', dispatchMark: 'not-ours' }; wire.seed(S, KEY, r); } }, 1);
    wire.on(isPut, wire.status(503), 2);
    await assert.rejects(ad.markDispatching(sta, held), (e) => e instanceof ad.TransitionUnresolved || e instanceof ad.AdmissionClosed);
  });
  await check('PUB-5c an ack-lost dispatching CAS is confirmed ONLY by our exact dispatchMark', async () => {
    fresh(); seedOpen(A);
    const sa = scope(); const sta = store(sa);
    const held = await ad.admit(sta, sa, await ad.captureActivation(sta, A, 'v2-act-0001'), spec());
    wire.on(isPut, wire.ackLost());
    await ad.markDispatching(sta, held);
    assert.equal(rec().tickets[held.ticket.ticketId].dispatchMark, held.ticket.dispatchMark);
  });
  await check('PUB-5d removal is refused for (i) a completed-OPERATION record, (ii) another attempt\'s outcome, (iii) an uncertain outcome', async () => {
    fresh(); seedOpen(A);
    const sa = scope(); const sta = store(sa);
    const held = await ad.admit(sta, sa, await ad.captureActivation(sta, A, 'v2-act-0001'), spec());
    await ad.markDispatching(sta, held); await ad.markUncertain(sta, held);
    const n = await ad.recoverTickets(store(), () => true, async () => false);
    assert.equal(n, 0);
    assert.equal(await ad.removeWithOutcome(sta, held, 'not_dispatched'), false, 'an uncertain ticket is never recorded not_dispatched');
    assert.ok(rec().tickets[held.ticket.ticketId]);
  });
  await check('PUB-6a an old A invocation captured before a controlled A -> B -> A: its admission is refused (activation_changed); 0 sends', async () => {
    fresh(); seedOpen(A);
    const sa = scope(); const sta = store(sa);
    const cap = await ad.captureActivation(sta, A, 'v2-act-0001');
    const p = tok(); await fullCycle(p, B); await fullCycle(p, A);
    assert.equal(rec().deployId, A);
    await assert.rejects(ad.admit(sta, sa, cap, spec()), (e) => e instanceof ad.ActivationChanged);
  });
  await check('PUB-6b an old admitted A ticket is deleted at the first close; its dispatching fails', async () => {
    fresh(); seedOpen(A);
    const sa = scope(); const sta = store(sa);
    const held = await ad.admit(sta, sa, await ad.captureActivation(sta, A, 'v2-act-0001'), spec());
    const p = tok(); await fullCycle(p, B); await fullCycle(p, A);
    await assert.rejects(ad.markDispatching(sta, held));
  });
  await check('PUB-6c a stale tab echoing the old activationId after A -> B -> A: 409, no write', async () => {
    fresh(); seedOpen(A);
    const p = tok(); await fullCycle(p, B); await fullCycle(p, A);
    await assert.rejects(ad.captureActivation(store(), A, 'v2-act-0001'), (e) => e instanceof ad.ActivationChanged);
  });
  await check('PUB-11 cleanup after a publication change: the admitted sender records its outcome and removes its own ticket while closed; it can never admit or dispatch', async () => {
    fresh(); seedOpen(A);
    const sa = scope(); const sta = store(sa);
    const held = await ad.admit(sta, sa, await ad.captureActivation(sta, A, 'v2-act-0001'), spec());
    await ad.markDispatching(sta, held);
    await ad.closeAdmission(store(), tok(), 'pub-00000011', B);
    assert.equal(await ad.removeWithOutcome(sta, held, 'confirmed'), true);
    assert.equal(rec().state, 'closed');
    const sc = scope();
    await assert.rejects(ad.captureActivation(store(sc), A, 'v2-act-0001'), (e) => e instanceof ad.AdmissionClosed);
  });

  // ── The single authoritative record (r4 §A/§B) ──────────────────────────
  await check('ST-1 two claims race T2: exactly one outstanding attempt; the loser refused after re-read', async () => {
    fresh(); seedOpen(A);
    const p = tok(); await ad.closeAdmission(store(), p, 'pub-0000st01', B);
    const r = await Promise.allSettled([ad.claimAttempt(store(), p, 'att-aaaa0001'), ad.claimAttempt(store(), p, 'att-bbbb0002')]);
    assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
    assert.ok(r.some((x) => x.status === 'rejected' && x.reason.code === 'attempt_outstanding'));
  });
  for (const t of ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9']) {
    await check(`ST-2 ${t}: applied-but-unacknowledged is recovered by its exact mark; failed-before-apply leaves the record exactly as before`, async () => {
      for (const mode of ['ackLost', 'notApplied']) {
        fresh(); seedOpen(A);
        const s = store(); await ad.registerSemantics(s, 1, SEMANTICS);
        const p = tok();
        const steps = {
          T1: async () => ad.closeAdmission(store(), p, 'pub-0000st02', B),
          T2: async () => ad.claimAttempt(store(), p, 'att-st020002'),
          T3: async () => ad.markAttemptDispatching(store(), p, 'att-st020002', SITE),
          T4: async () => ad.recordResponse(store(), p, 'att-st020002', R201(B)),
        };
        const order = ['T1', 'T2', 'T3', 'T4'];
        const prep = async (upto) => { for (const x of order) { if (x === upto) return; await steps[x](); } };
        let run;
        if (order.includes(t)) { await prep(t); run = steps[t]; }
        else if (t === 'T5') { await prep('T4'); run = () => ad.markAttemptUnresolved(store(), p, 'att-st020002', 'timeout'); }
        else if (t === 'T6') { await prep('T3'); run = () => ad.abandonAttempt(store(), p, 'att-st020002'); }
        else if (t === 'T7') { await prep('T3'); run = () => ad.handoverPublisher(store(), tok()); }
        else if (t === 'T8') {
          await prep('T4'); wire.remove(S, 'authz/provider-semantics/1');
          await steps.T4(); wire.seed(S, 'authz/provider-semantics/1', SEMANTICS);
          run = () => ad.reclassifyAttempt(store(), p, 'att-st020002');
        } else {
          await prep('T4'); await steps.T4();
          run = () => ad.activate(store(), scope('iaos-activation'), { p, runtimeDeployId: B, attemptSetDigest: rec().publication.attemptSetDigest, g5Digest: 'g'.repeat(64), activationId: 'v2-act-st02' });
        }
        const before = JSON.stringify(rec());
        if (mode === 'ackLost') { wire.on(isPut, wire.ackLost()); await run(); assert.notEqual(JSON.stringify(rec()), before, `${t} applied`); }
        else { wire.on(isPut, wire.status(503), 3); await assert.rejects(run()); assert.equal(JSON.stringify(rec()), before, `${t} not applied: record exactly as before`); }
      }
    });
  }
  await check('ST-3 T6 racing T3 and T7 racing T3: one wins; abandonment winning -> 0 requests; T3 winning -> dispatching kept (blocking)', async () => {
    for (const racer of ['T6', 'T7']) {
      fresh(); seedOpen(A);
      const p = tok(); await ad.closeAdmission(store(), p, 'pub-0000st03', B); await ad.claimAttempt(store(), p, 'att-st030003');
      wire.on(isPut, wire.before(async () => { if (racer === 'T6') await ad.abandonAttempt(store(), p, 'att-st030003'); else await ad.handoverPublisher(store(), tok()); }));
      await assert.rejects(ad.markAttemptDispatching(store(), p, 'att-st030003', SITE), 'abandonment won: T3 refused, nothing may be sent');
      assert.equal(rec().publication.outstanding, null);
      fresh(); seedOpen(A);
      const p2 = tok(); await ad.closeAdmission(store(), p2, 'pub-0000st03', B); await ad.claimAttempt(store(), p2, 'att-st030004');
      await ad.markAttemptDispatching(store(), p2, 'att-st030004', SITE);
      await assert.rejects(racer === 'T6' ? ad.abandonAttempt(store(), p2, 'att-st030004') : ad.handoverPublisher(store(), tok()));
      assert.equal(rec().publication.outstanding.state, 'dispatching');
    }
  });
  await check('ST-4 T9 racing T2: never both. Activation refused while outstanding exists; a claim refused after phase "applied"', async () => {
    fresh(); seedOpen(A);
    const p = tok(); await ad.registerSemantics(store(), 1, SEMANTICS);
    await ad.closeAdmission(store(), p, 'pub-0000st04', B); await ad.claimAttempt(store(), p, 'att-st040001');
    await assert.rejects(ad.activate(store(), scope('iaos-activation'), { p, runtimeDeployId: B, attemptSetDigest: rec().publication.attemptSetDigest, g5Digest: 'g', activationId: 'v2-act-st04' }), (e) => e.code === 'attempt_outstanding');
    await ad.markAttemptDispatching(store(), p, 'att-st040001', SITE); await ad.recordResponse(store(), p, 'att-st040001', R201(B));
    await assert.rejects(ad.claimAttempt(store(), p, 'att-st040002'), (e) => e.code === 'already_applied');
  });
  await check('ST-5 a missing, partial or corrupt history copy changes nothing: T9 and T2 decide from authz/admission alone', async () => {
    fresh(); seedOpen(A);
    const p = tok(); await ad.registerSemantics(store(), 1, SEMANTICS);
    await ad.closeAdmission(store(), p, 'pub-0000st05', B); await ad.claimAttempt(store(), p, 'att-st050001');
    await ad.markAttemptDispatching(store(), p, 'att-st050001', SITE); await ad.recordResponse(store(), p, 'att-st050001', R201(B));
    wire.seed(S, 'evidence/publication/pub-0000st05/corrupt', { garbage: true });
    for (const k of wire.keys(S).filter((k) => k.startsWith('evidence/'))) wire.remove(S, k);
    const next = await ad.activate(store(), scope('iaos-activation'), { p, runtimeDeployId: B, attemptSetDigest: rec().publication.attemptSetDigest, g5Digest: 'g', activationId: 'v2-act-st05' });
    assert.equal(next.state, 'open');
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../netlify/functions/lib/admission.ts'), 'utf8');
    assert.ok(!/read[A-Za-z]*\([^)]*PUBLICATION_ARCHIVE_PREFIX|read[A-Za-z]*\([^)]*ACTIVATION_ARCHIVE_PREFIX|readData\([^)]*evidence\//.test(src), 'archives are never read');
  });
  await check('ST-6 T4\'s evidence write ambiguous and unresolved: the attempt stays dispatching; no terminal state; no new attempt', async () => {
    fresh(); seedOpen(A);
    const p = tok(); await ad.registerSemantics(store(), 1, SEMANTICS);
    await ad.closeAdmission(store(), p, 'pub-0000st06', B); await ad.claimAttempt(store(), p, 'att-st060001'); await ad.markAttemptDispatching(store(), p, 'att-st060001', SITE);
    wire.on(isPut, wire.status(503), 3);
    await assert.rejects(ad.recordResponse(store(), p, 'att-st060001', R201(B)));
    assert.equal(rec().publication.outstanding.state, 'dispatching');
    await assert.rejects(ad.claimAttempt(store(), p, 'att-st060002'), (e) => e.code === 'attempt_outstanding');
  });

  // ── Publication attempts (r3, rerun against r4) ─────────────────────────
  await check('PA-1/PA-2 no response; the fake API applies it later; two runtime confirmations pass: NOT verified, activation refused, admission closed, no retry; a later cycle\'s Close refused', async () => {
    fresh(); seedOpen(A);
    const p = tok(); await ad.closeAdmission(store(), p, 'pub-0000pa01', B); await ad.claimAttempt(store(), p, 'att-pa010001'); await ad.markAttemptDispatching(store(), p, 'att-pa010001', SITE);
    await ad.markAttemptUnresolved(store(), p, 'att-pa010001', 'timeout');
    await assert.rejects(ad.activate(store(), scope('iaos-activation'), { p, runtimeDeployId: B, attemptSetDigest: rec().publication.attemptSetDigest, g5Digest: 'g', activationId: 'v2-act-pa01' }));
    await assert.rejects(ad.claimAttempt(store(), p, 'att-pa010002'), (e) => e.code === 'attempt_outstanding');
    await assert.rejects(ad.closeAdmission(store(), tok(), 'pub-0000pa02', A), (e) => e.code === 'publication_in_progress');
    assert.equal(rec().state, 'closed');
  });
  await check('PA-3 Bones\'s two-cycle sequence is impossible: a second attempt cannot be claimed while the first is unresolved (Close and Claim)', async () => {
    fresh(); seedOpen(A);
    const p = tok(); await ad.closeAdmission(store(), p, 'pub-0000pa03', A); await ad.claimAttempt(store(), p, 'att-pa030001'); await ad.markAttemptDispatching(store(), p, 'att-pa030001', SITE);
    await ad.markAttemptUnresolved(store(), p, 'att-pa030001', 'transport');
    await assert.rejects(ad.claimAttempt(store(), p, 'att-pa030002'));
    await assert.rejects(ad.closeAdmission(store(), p, 'pub-0000pa04', B));
  });
  await check('PA-5 an ambiguous T3 that reads back `claimed` -> nothing sent; T3 is never granted twice', async () => {
    fresh(); seedOpen(A);
    const p = tok(); await ad.closeAdmission(store(), p, 'pub-0000pa05', B); await ad.claimAttempt(store(), p, 'att-pa050001');
    wire.on(isPut, wire.status(503), 3);
    await assert.rejects(ad.markAttemptDispatching(store(), p, 'att-pa050001', SITE));
    assert.equal(rec().publication.outstanding.state, 'claimed');
    await ad.markAttemptDispatching(store(), p, 'att-pa050001', SITE);
    await assert.rejects(ad.markAttemptDispatching(store(), p, 'att-pa050001', SITE), (e) => e.code === 'already_dispatching');
  });
  await check('PA-6/PA-7 publisher restart: `claimed` is abandoned by handover (0 requests); `dispatching` stays non-terminal and blocks the new process', async () => {
    fresh(); seedOpen(A);
    const p = tok(); await ad.closeAdmission(store(), p, 'pub-0000pa06', B); await ad.claimAttempt(store(), p, 'att-pa060001');
    const p2 = tok(); await ad.handoverPublisher(store(), p2);
    assert.equal(rec().publication.history[0].terminal, 'ABANDONED');
    await assert.rejects(ad.markAttemptDispatching(store(), p, 'att-pa060001', SITE));
    await ad.claimAttempt(store(), p2, 'att-pa060002'); await ad.markAttemptDispatching(store(), p2, 'att-pa060002', SITE);
    await assert.rejects(ad.handoverPublisher(store(), tok()), (e) => e.code === 'attempt_outstanding');
  });
  await check('PA-8 a second publisher process in one cycle can never claim', async () => {
    fresh(); seedOpen(A);
    const p = tok(); await ad.closeAdmission(store(), p, 'pub-0000pa08', B);
    await assert.rejects(ad.claimAttempt(store(), tok(), 'att-pa080001'), (e) => e.code === 'not_publisher');
  });
  await check('PA-9 a REJECTED attempt (under approved semantics) lets the cycle make a new attempt with a new attemptId', async () => {
    fresh(); seedOpen(A); await ad.registerSemantics(store(), 1, SEMANTICS);
    const p = tok(); await ad.closeAdmission(store(), p, 'pub-0000pa09', B); await ad.claimAttempt(store(), p, 'att-pa090001'); await ad.markAttemptDispatching(store(), p, 'att-pa090001', SITE);
    const c = await ad.recordResponse(store(), p, 'att-pa090001', { status: 404, contentType: 'application/json', body: JSON.stringify({ code: 404, message: 'Not Found' }) });
    assert.equal(c.cls, 'REJECTED');
    await assert.rejects(ad.claimAttempt(store(), p, 'att-pa090001'), (e) => e.code === 'attempt_id_reused');
    await ad.claimAttempt(store(), p, 'att-pa090002');
  });
  await check('PA-11 5xx, a malformed body, or a body naming another deploy: UNRESOLVED, blocking', async () => {
    for (const resp of [{ status: 502, contentType: 'text/html', body: '<html>' }, { status: 201, contentType: 'application/json', body: '{not json' }, R201(A)]) {
      fresh(); seedOpen(A); await ad.registerSemantics(store(), 1, SEMANTICS);
      const p = tok(); await ad.closeAdmission(store(), p, 'pub-0000pa11', B); await ad.claimAttempt(store(), p, 'att-pa110001'); await ad.markAttemptDispatching(store(), p, 'att-pa110001', SITE);
      assert.equal((await ad.recordResponse(store(), p, 'att-pa110001', resp)).cls, 'UNRESOLVED');
      assert.equal(rec().publication.outstanding.state, 'unresolved');
    }
  });

  // ── The classifier (r4 §C) ───────────────────────────────────────────────
  const T = B;
  const pubFor = () => ({ pubId: 'pub-cl', targetDeployId: T });
  const ev = (resp) => ad.buildEvidence(pubFor(), { attemptId: 'att-cl', request: { fingerprint: 'f' } }, resp);
  await check('CL-1 201 with a matching body and NO semantics record: RESPONDED (non-terminal); activation and T2 refused', async () => {
    assert.equal(ad.classify(ev(R201(T)), T, []).cls, 'RESPONDED');
    fresh(); seedOpen(A);
    const p = tok(); await ad.closeAdmission(store(), p, 'pub-0000cl01', B); await ad.claimAttempt(store(), p, 'att-cl010001'); await ad.markAttemptDispatching(store(), p, 'att-cl010001', SITE);
    assert.equal((await ad.recordResponse(store(), p, 'att-cl010001', R201(B))).cls, 'RESPONDED');
    await assert.rejects(ad.activate(store(), scope('iaos-activation'), { p, runtimeDeployId: B, attemptSetDigest: rec().publication.attemptSetDigest, g5Digest: 'g', activationId: 'v2-act-cl01' }));
    await assert.rejects(ad.claimAttempt(store(), p, 'att-cl010002'));
  });
  await check('CL-2 every 4xx (404, 422, 401, 403, 409) without semantics: RESPONDED; there is no bare "definitive 4xx" rule', async () => {
    for (const status of [404, 422, 401, 403, 409]) assert.equal(ad.classify(ev({ status, contentType: 'application/json', body: JSON.stringify({ code: status }) }), T, []).cls, 'RESPONDED');
  });
  await check('CL-3 5xx, 429, malformed body, a body naming another deploy, no evidence: UNRESOLVED', async () => {
    for (const r of [{ status: 500, contentType: null, body: '{}' }, { status: 429, contentType: null, body: '{}' }, { status: 201, contentType: 'application/json', body: 'x' }, R201(A)]) assert.equal(ad.classify(ev(r), T, [SEMANTICS]).cls, 'UNRESOLVED');
    assert.equal(ad.classify(undefined, T, [SEMANTICS]).cls, 'UNRESOLVED');
  });
  await check('CL-4 a semantics record approved LATER (T8): a RESPONDED attempt with persisted evidence becomes APPLIED only when an exact predicate matches; UNRESOLVED never changes', async () => {
    fresh(); seedOpen(A);
    const p = tok(); await ad.closeAdmission(store(), p, 'pub-0000cl04', B); await ad.claimAttempt(store(), p, 'att-cl040001'); await ad.markAttemptDispatching(store(), p, 'att-cl040001', SITE);
    await ad.recordResponse(store(), p, 'att-cl040001', R201(B));
    await assert.rejects(ad.reclassifyAttempt(store(), p, 'att-cl040001'), (e) => e.code === 'no_matching_semantics');
    await ad.registerSemantics(store(), 1, SEMANTICS);
    assert.equal((await ad.reclassifyAttempt(store(), p, 'att-cl040001')).cls, 'APPLIED');
    assert.equal(rec().publication.phase, 'applied');
    fresh(); seedOpen(A); await ad.registerSemantics(store(), 1, SEMANTICS);
    const q = tok(); await ad.closeAdmission(store(), q, 'pub-0000cl05', B); await ad.claimAttempt(store(), q, 'att-cl040002'); await ad.markAttemptDispatching(store(), q, 'att-cl040002', SITE);
    await ad.markAttemptUnresolved(store(), q, 'att-cl040002', 'timeout');
    await assert.rejects(ad.reclassifyAttempt(store(), q, 'att-cl040002'), (e) => e.code === 'not_responded');
  });
  await check('CL-5 a predicate matching the status but not the body (or the body but not the status): not terminal', async () => {
    assert.equal(ad.classify(ev({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: T }) }), T, [SEMANTICS]).cls, 'RESPONDED');
    assert.equal(ad.classify(ev({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: T, published_at: 'x' }) }), T, [SEMANTICS]).cls, 'RESPONDED');
  });
  await check('CL-6 a configuration flag "true" with no semantics record has no effect; static: no flag is read for classification', async () => {
    process.env.IAOS_P5_ESTABLISHED = 'true'; process.env.P5_ESTABLISHED = 'true';
    assert.equal(ad.classify(ev(R201(T)), T, []).cls, 'RESPONDED');
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../netlify/functions/lib/admission.ts'), 'utf8');
    assert.ok(!/process\.env/.test(src), 'admission.ts reads no environment flag');
    delete process.env.IAOS_P5_ESTABLISHED; delete process.env.P5_ESTABLISHED;
  });
  await check('CL-7 ABANDONED via T6 or T7 is terminal without provider semantics; an unapproved semantics record is ignored', async () => {
    fresh(); seedOpen(A);
    const p = tok(); await ad.closeAdmission(store(), p, 'pub-0000cl07', B); await ad.claimAttempt(store(), p, 'att-cl070001');
    await ad.abandonAttempt(store(), p, 'att-cl070001');
    assert.equal(rec().publication.history[0].terminal, 'ABANDONED');
    assert.equal(rec().publication.outstanding, null);
    const unapproved = { ...SEMANTICS, approvals: { bones: '', jess: '' } };
    assert.equal(ad.validSemantics(unapproved), false);
    assert.equal(ad.classify(ev(R201(T)), T, [unapproved]).cls, 'RESPONDED');
  });

  // ── The accepted Owner exception (known gap, NOT a protection) ──────────
  await check('OB-1 KNOWN GAP (Brad\'s accepted exception): an out-of-tool A -> B -> A by a Netlify Owner leaves A admitting under its EARLIER activation without fresh verification', async () => {
    fresh(); seedOpen(A, 'v2-act-0001', 1);
    // Out-of-tool publications run no code: authz/admission is untouched.
    const before = JSON.stringify(rec());
    /* (Owner publishes B, then A, directly in Netlify -- nothing observes it) */
    assert.equal(JSON.stringify(rec()), before);
    const sc = scope(); const st = store(sc);
    const cap = await ad.captureActivation(st, A, 'v2-act-0001');
    const held = await ad.admit(st, sc, cap, spec());
    assert.ok(held.ticket, 'A admits again under its earlier activation: the documented, accepted exception');
  });
  done('storage admission and publication');
})();
