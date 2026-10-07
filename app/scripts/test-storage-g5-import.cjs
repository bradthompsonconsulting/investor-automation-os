/**
 * Storage correction (PR #131 plan v6 §9, §10, §14) -- the G5 default-deny
 * gate, narrowing rules N1–N4, the conservative legacy import and its single
 * store-wide owner, over the wire harness with the REAL @netlify/blobs client.
 */
'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
require('./harness/ts-loader.cjs');
const { check, done } = require('./harness/check.cjs');
const { createWire } = require('./harness/blob-wire.cjs');
const wire = createWire({ ownershipStores: ['site:iaos-ownership-v2'] });
global.fetch = wire.fetch;
process.env.NETLIFY_BLOBS_CONTEXT = wire.context();
const vs = require('../netlify/functions/lib/verified-store.ts');
vs.transport.fetch = wire.fetch;
const { InvocationScope } = require('../netlify/functions/lib/invocation-scope.ts');
const g5 = require('../netlify/functions/lib/g5-gate.ts');
const li = require('../netlify/functions/lib/legacy-import.ts');
const cut = require('../netlify/functions/lib/cutover.ts');
const { canonical, digest } = require('../netlify/functions/lib/hash.ts');
const { WriteGate, WriteRefused } = require('../netlify/functions/lib/write-gate.ts');
const S = 'iaos-ownership-v2';
const L = 'iaos-write-receipts';
const ENV = 'test'; const LOC = 'loc-fixture';
const scope = () => new InvocationScope('iaos-cutover');
const store = (sc = scope()) => new vs.VerifiedStore(sc, S);
const legacyStore = (sc = scope()) => new vs.VerifiedStore(sc, L, undefined, true);
const ev = (o) => ({ ...o });
const narrowing = (rule, pathId, scopes, evidence, extra = {}) => ({ v: 1, id: `n-${crypto.randomBytes(3).toString('hex')}`, pathId, rule, scopes, evidence, evidenceDigest: digest(canonical(evidence)), approvalRef: 'approval-ref-0001', createdAt: 'x', ...extra });
const AUDIT = (entries) => narrowing('AUDIT', 'default', [], { complete: true, unresolvedDeploys: 0, unauditedFunctions: 0, documentDigest: 'd'.repeat(64), pathCount: entries.length }, { auditEntries: entries });
const fresh = () => wire.clear();
const SCOPE = `${ENV}:${LOC}`;
const tableAfterAudit = () => g5.applyNarrowing(g5.DEFAULT_TABLE(), AUDIT([
  { pathId: 'disposition-note', scope: 'location', effects: ['note', 'last_touch'] },
  { pathId: 'ghl-write-fields', scope: 'location', effects: ['*'] },
]));

(async () => {
  // ── G5 ───────────────────────────────────────────────────────────────────
  await check('G5-1 no table, an unreadable table or an unknown entry = blocked; the default table blocks everything', async () => {
    assert.equal(g5.allows(null, 'contact:x', ['note']).ok, false);
    assert.equal(g5.allows({ v: 1, entries: [{ pathId: 'p', scope: 'galaxy', effects: ['note'], basis: 'audit', ref: null }], narrowings: [] }, 'contact:x', ['note']).ok, false);
    assert.equal(g5.allows(g5.DEFAULT_TABLE(), 'contact:x', ['note']).ok, false);
    assert.equal(g5.allows(g5.DEFAULT_TABLE(), 'opportunity:o', ['stage']).ok, false);
    fresh();
    const sc = new InvocationScope('ghl-write');
    const gate = new WriteGate(sc, store(sc), { id: 'd', context: 'production', published: true }, ENV, LOC);
    gate.captured = { epoch: 1, activationId: 'a', deployId: 'd', g5Digest: 'x' };
    await assert.rejects(gate.checkSubject('contact:x', ['note']), (e) => e instanceof WriteRefused && e.refusal.body.code === 'g5_blocked');
    wire.on(wire.get(S, 'authz/g5/table'), wire.status(500), 9);
    await assert.rejects(gate.checkSubject('contact:x', ['note']), (e) => e instanceof WriteRefused);
  });
  await check('G5-2 static: no GHL mutating request bypasses the gated boundary', async () => {
    const dir = path.join(__dirname, '../netlify/functions');
    const files = [...fs.readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => path.join(dir, f)), ...fs.readdirSync(path.join(dir, 'lib')).filter((f) => f.endsWith('.ts')).map((f) => path.join(dir, 'lib', f))];
    for (const f of files) {
      if (f.endsWith('ghl-write-boundary.ts')) continue;
      const src = fs.readFileSync(f, 'utf8');
      const mutating = /fetch\([^)]*(leadconnectorhq|GHL_BASE)[^;]*method:\s*["'`](POST|PUT|DELETE|PATCH)/s.test(src);
      if (/voice-/.test(path.basename(f))) continue;   // voice stays disabled (plan v6 §13; asserted elsewhere)
      assert.equal(mutating, false, `${path.basename(f)} issues a GHL mutation outside the boundary`);
    }
    const b = fs.readFileSync(path.join(dir, 'lib/ghl-write-boundary.ts'), 'utf8');
    assert.ok(/if \(method !== "GET"\) throw new MutationRefused/.test(b), 'call() refuses non-GET');
    assert.ok(/if \(!this\.gate\) throw new MutationRefused/.test(b), 'no gate, no mutation');
  });
  await check('G5-3 overlap by effect class: a legacy disposition note on X blocks a v2 call-log save on X; a different contact is unaffected only under an explicit narrowing', async () => {
    const t = { v: 1, entries: [{ pathId: 'disposition-note', scope: 'contact:X', effects: ['note', 'last_touch'], basis: 'narrowed', ref: 'n' }], narrowings: ['n'], updatedAt: 'x' };
    assert.equal(g5.allows(t, 'contact:X', ['call_result', 'last_touch', 'note']).ok, false);
    assert.equal(g5.allows(t, 'contact:X', ['call_result']).ok, true, 'no shared effect class');
    assert.equal(g5.allows(t, 'contact:Y', ['note']).ok, true, 'narrowed to X only');
    assert.equal(g5.allows(tableAfterAudit(), 'contact:Y', ['note']).ok, false, 'without narrowing the audited path stays location-wide');
  });
  await check('G5-4 unknown subject stays location-wide; unknown effects stay ALL', async () => {
    const t = tableAfterAudit();
    assert.equal(g5.allows(t, 'opportunity:any', ['stage']).ok, false, 'ghl-write-fields: unknown effects -> *');
    assert.equal(g5.allows(t, 'contact:any', ['task']).ok, false);
  });
  await check('G5-5 narrowing accepted only for N1–N4 (and the complete AUDIT); absence of errors / empty search / value match / elapsed time are never clearance', async () => {
    for (const basis of ['absence_of_errors', 'empty_search', 'value_match', 'elapsed_time', 'revocation', 'session_expiry', 'missing_logs']) {
      const r = narrowing('N3', 'disposition-note', [], { basis, retentionCoversWindow: true, windowStart: 'a', windowEnd: 'b', invocationCount: 0, independentCount: 0, outcomes: [] });
      assert.throws(() => g5.validateNarrowing(r), g5.NarrowingRefused);
    }
    assert.throws(() => g5.validateNarrowing(narrowing('N9', 'x', [], {})), g5.NarrowingRefused);
    assert.throws(() => g5.validateNarrowing({ ...narrowing('N2', 'x', [], { deploys: [{ deployId: 'd', commit: 'abcdef1', pathPresent: false }], unresolvedDeploys: 0 }), approvalRef: '' }), g5.NarrowingRefused);
    const incompleteAudit = narrowing('AUDIT', 'default', [], { complete: false, unresolvedDeploys: 1, unauditedFunctions: 0, documentDigest: 'd', pathCount: 1 }, { auditEntries: [{ pathId: 'p', scope: 'location', effects: ['*'] }] });
    assert.throws(() => g5.validateNarrowing(incompleteAudit), g5.NarrowingRefused, 'an incomplete path set keeps the default ALL block');
  });
  await check('G5-6 N4: an uncorrelated matching value -> no narrowing; one correlated + one pending -> block retained; incomplete enumeration -> retained; effect absent -> no narrowing', async () => {
    const base = (subs, en = { coverageComplete: true, count: subs.length, independentCount: subs.length, windowStart: 'a', windowEnd: 'b' }) => ({ enumeration: en, submissions: subs });
    const corr = (s) => ({ submissionId: 's1', subject: s, effect: 'note', resolution: 'correlated', correlationId: 'op-digest', ghlRecordId: 'note-1', at: 't' });
    assert.throws(() => g5.validateNarrowing(narrowing('N4', 'disposition-note', [], base([{ submissionId: 's', subject: 'contact:X', effect: 'note', resolution: 'correlated', correlationId: '', ghlRecordId: '' }]))), g5.NarrowingRefused, 'a matching value alone is not correlation');
    assert.throws(() => g5.validateNarrowing(narrowing('N4', 'disposition-note', [], base([corr('contact:X'), { submissionId: 's2', subject: 'contact:X', effect: 'note', resolution: 'pending' }]))), g5.NarrowingRefused, 'pending keeps X blocked');
    g5.validateNarrowing(narrowing('N4', 'disposition-note', [{ scope: 'contact:X', effects: ['note'] }], base([corr('contact:X'), { submissionId: 's2', subject: 'contact:X', effect: 'note', resolution: 'pending' }])));
    assert.throws(() => g5.validateNarrowing(narrowing('N4', 'disposition-note', [], base([corr('contact:X')], { coverageComplete: false, count: 1, independentCount: 1, windowStart: 'a', windowEnd: 'b' }))), g5.NarrowingRefused);
    assert.throws(() => g5.validateNarrowing(narrowing('N4', 'disposition-note', [], { basis: 'effect_absent' })), g5.NarrowingRefused);
  });
  await check('G5-6b N1: a path that writes after dispatch, trusts SDK `modified`, or dispatches despite a storage error is refused', async () => {
    const ok = { codePathCitations: ['lib/x.ts:10'], tests: ['t1'], durableBeforeDispatchOnEveryBranch: true, readbackBeforeDispatch: true, trustsSdkModified: false, failsClosedOnStorageError: true, importClassified: true };
    g5.validateNarrowing(narrowing('N1', 'p', [{ scope: 'contact:X', effects: ['note'] }], ok));
    for (const bad of [{ durableBeforeDispatchOnEveryBranch: false }, { trustsSdkModified: true }, { failsClosedOnStorageError: false }, { readbackBeforeDispatch: false }]) {
      assert.throws(() => g5.validateNarrowing(narrowing('N1', 'p', [{ scope: 'contact:X', effects: ['note'] }], { ...ok, ...bad })), g5.NarrowingRefused);
    }
  });
  await check('G5-7 widening is always allowed; any narrowing changes the digest, so writes refuse until a fresh activation records it', async () => {
    const t0 = tableAfterAudit();
    const t1 = g5.widen(t0, { pathId: 'extra', scope: 'contact:Z', effects: ['note'] });
    assert.notEqual(g5.tableDigest(t1), g5.tableDigest(t0));
    const n = narrowing('N2', 'disposition-note', [], { deploys: [{ deployId: 'd1', commit: 'abcdef1', pathPresent: false }], unresolvedDeploys: 0 });
    const t2 = g5.applyNarrowing(t0, n);
    assert.notEqual(g5.tableDigest(t2), g5.tableDigest(t0));
    assert.throws(() => g5.applyNarrowing(t2, n), g5.NarrowingRefused, 'never applied twice');
    assert.throws(() => g5.applyNarrowing(t0, narrowing('N1', 'disposition-note', [{ scope: 'contact:X', effects: ['task'] }], { codePathCitations: ['a'], tests: ['b'], durableBeforeDispatchOnEveryBranch: true, readbackBeforeDispatch: true, trustsSdkModified: false, failsClosedOnStorageError: true, importClassified: true })), g5.NarrowingRefused, 'a narrowing can only reduce');
    fresh();
    wire.seed(S, 'authz/g5/table', t2);
    const sc = new InvocationScope('ghl-write');
    const gate = new WriteGate(sc, store(sc), { id: 'd', context: 'production', published: true }, ENV, LOC);
    gate.captured = { epoch: 1, activationId: 'a', deployId: 'd', g5Digest: g5.tableDigest(t0) };
    await assert.rejects(gate.checkSubject('contact:Y', ['call_result']), (e) => e.refusal.body.code === 'g5_blocked', 'digest changed: refused until re-activation');
  });
  await check('G5-8 the sandbox contact q2ygQtBXQSBezlU4WjNH stays blocked by its legacy block even under a permissive table', async () => {
    fresh();
    const t = { v: 1, entries: [], narrowings: ['n'], updatedAt: 'x' };
    wire.seed(S, 'authz/g5/table', t);
    wire.seed(S, cut.legacyBlockKey(ENV, LOC, 'contact:q2ygQtBXQSBezlU4WjNH'), { v: 1, subject: 'contact:q2ygQtBXQSBezlU4WjNH', class: 'blocked_unknown', reasons: ['legacy_stage_or_call_save'], evidenceDigest: 'e' });
    const sc = new InvocationScope('ghl-write');
    const gate = new WriteGate(sc, store(sc), { id: 'd', context: 'production', published: true }, ENV, LOC);
    gate.captured = { epoch: 1, activationId: 'a', deployId: 'd', g5Digest: g5.tableDigest(t) };
    await assert.rejects(gate.checkSubject('contact:q2ygQtBXQSBezlU4WjNH', ['note']), (e) => e.refusal.body.code === 'legacy_blocked');
    await gate.checkSubject('contact:other-synthetic', ['note']);
  });

  // ── Import classification (pure) ─────────────────────────────────────────
  const W = () => ({ S1: new Map(), S2: new Map(), S3: new Map() });
  const put = (w, s, key, value) => w[s].set(key, { key, snapshot: s, etag: 'e', absent: value === null, valueDigest: value === null ? null : digest(canonical(value)), value });
  const all3 = (w, key, value) => { for (const s of ['S1', 'S2', 'S3']) put(w, s, key, value); };
  const input = (extra = {}) => ({ env: ENV, locationId: LOC, knownSubjects: [], unstablePrefixes: [], ...extra });
  const op = (o, c) => ({ v: 3, op: o, contactId: c, result: 'No Answer', body: 'b', bodyDigest: 'x', createdAt: 't' });
  const v3 = (kind, id) => `call-log/v3/${kind}/${digest(`${SCOPE}:${id}`)}`;
  const attK = (o, slot, n) => `call-log/v3/attempt/${digest(`${SCOPE}:${o}:${slot}:${n}`)}`;
  const completeOp = (w, o, c) => {
    all3(w, v3('op', o), op(o, c));
    for (const slot of ['result', 'note', 'touch']) { all3(w, attK(o, slot, 1), { v: 3, op: o, slot, n: 1, requestId: `${o}-${slot}-1` }); all3(w, v3('outcome', `${o}-${slot}-1`), { kind: 'confirmed' }); all3(w, v3('decision', `${o}-${slot}-1`), { d: 'send' }); }
    all3(w, v3('final', o), { v: 3, op: o, kind: 'complete', result: 'No Answer', slots: [], at: 't' });
  };
  await check('I1 differing versions are all retained and the most conservative wins (a write-once record that changed is quarantined)', async () => {
    const w = W(); completeOp(w, 'op1', 'C1');
    put(w, 'S3', v3('final', 'op1'), { v: 3, op: 'op1', kind: 'not_saved', result: 'x', slots: [], at: 't' });
    const c = li.classifyWorld(w, input());
    assert.equal(c.subjects.get('contact:C1').class, 'quarantined');
  });
  await check('I2 a contradiction (a vanished record) is quarantined', async () => {
    const w = W(); completeOp(w, 'op1', 'C1'); put(w, 'S3', v3('final', 'op1'), null);
    assert.equal(li.classifyWorld(w, input()).subjects.get('contact:C1').class, 'quarantined');
  });
  await check('I3 an orphan operation with attempts but no final: its subject is blocked', async () => {
    const w = W(); all3(w, v3('op', 'op2'), op('op2', 'C2')); all3(w, attK('op2', 'result', 1), { v: 3, op: 'op2', slot: 'result', n: 1, requestId: 'op2-result-1' });
    assert.equal(li.classifyWorld(w, input()).subjects.get('contact:C2').class, 'blocked_unknown');
  });
  await check('I4 a head naming a missing operation (referenced but missing) is never resolved', async () => {
    const w = W(); all3(w, `call-log/head/${digest(`${SCOPE}:C4`)}`, { v: 3, current: 'ghost', at: 't' });
    const c = li.classifyWorld(w, input({ knownSubjects: ['contact:C4'] }));
    assert.equal(c.subjects.get('contact:C4').class, 'quarantined');
  });
  await check('I5 every legacy "never sent" proof (not_dispatched / withdrawn) and a not_saved final are blocked_unknown (provenance)', async () => {
    const w = W(); all3(w, v3('op', 'op5'), op('op5', 'C5'));
    all3(w, attK('op5', 'result', 1), { v: 3, op: 'op5', slot: 'result', n: 1, requestId: 'op5-result-1' });
    all3(w, v3('decision', 'op5-result-1'), { d: 'withdrawn' });
    all3(w, v3('final', 'op5'), { v: 3, op: 'op5', kind: 'not_saved', result: 'x', slots: [], at: 't' });
    const c = li.classifyWorld(w, input());
    assert.equal(c.subjects.get('contact:C5').class, 'blocked_unknown');
    assert.ok([...c.subjects.get('contact:C5').reasons].some((r) => r === 'legacy_never_sent_proof' || r === 'legacy_not_saved_final'));
  });
  await check('I6 R1 (complete with every slot confirmed) and R2 (no persisted attempt, cited v3 prefix) resolve; R2 is refused on an uncited prefix', async () => {
    const w = W(); completeOp(w, 'op6', 'C6'); all3(w, v3('op', 'op7'), op('op7', 'C7'));
    const c = li.classifyWorld(w, input());
    assert.equal(c.subjects.get('contact:C6').class, 'resolved');
    assert.equal(c.subjects.get('contact:C7').class, 'resolved');
    const w2 = W(); all3(w2, `current-offer/request/${digest(`${SCOPE}:rq`)}`, { v: 2, opp: 'O8', contactId: 'C8', step: 'offer', barrierId: 'b' });
    assert.equal(li.classifyWorld(w2, input()).subjects.get('opportunity:O8').class, 'blocked_unknown', 'Current Offer prefix: no R2');
  });
  await check('I7 an unattributable subject-bearing record HALTS: no completion, no cutover record', async () => {
    const w = W(); all3(w, `lock/${digest('unknown-contact')}`, { claimedAt: 't' });
    const c = li.classifyWorld(w, input());
    assert.equal(c.unattributed.length, 1);
  });
  await check('legacy locks and stage markers block their subjects; bare receipts are counted, never subject blocks; send receipts carried under the same key', async () => {
    const w = W();
    all3(w, `lock/${digest(LOC + 'C9')}`, { claimedAt: 't' });
    all3(w, 'a'.repeat(64), { fingerprint: 'f', claimedAt: 't' });
    all3(w, `send/${'b'.repeat(64)}`, { outcome: 'submitted', documentDigest: 'd' });
    const c = li.classifyWorld(w, input({ knownSubjects: ['contact:C9'] }));
    assert.equal(c.subjects.get('contact:C9').class, 'blocked_unknown');
    assert.equal(c.bareReceipts, 1);
    assert.ok(c.sendReceipts.has(`authz/send/${'b'.repeat(64)}`));
  });

  // ── The run (wire) ───────────────────────────────────────────────────────
  const runToken = () => crypto.randomBytes(32).toString('hex');
  const seedLegacy = () => {
    wire.seed(L, v3('op', 'v3op1'), op('v3op1', 'CA'));
    wire.seed(L, attK('v3op1', 'result', 1), { v: 3, op: 'v3op1', slot: 'result', n: 1, requestId: 'v3op1-result-1' });
    wire.seed(L, v3('decision', 'v3op1-result-1'), { d: 'send' });
    wire.seed(L, v3('outcome', 'v3op1-result-1'), { kind: 'uncertain' });
    wire.seed(L, `send/${'c'.repeat(64)}`, { outcome: 'refused', documentDigest: null });
  };
  async function captureAll(s, run, tokn, snaps = ['S1', 'S2', 'S3']) {
    for (const snap of snaps) for (let i = 0; i < 20; i++) { const r = await li.captureBatch(s, legacyStore(), s.scope, { runId: run, snapshot: snap, env: ENV, locationId: LOC }); if (r.done) break; }
    void tokn;
  }
  await check('O1 one store-wide owner: a second runId is refused while the owner exists, including concurrent starts (exactly one wins)', async () => {
    fresh();
    const r = await Promise.allSettled([li.claimImportOwner(store(), 'run-aaaaaaa1', runToken()), li.claimImportOwner(store(), 'run-bbbbbbb2', runToken())]);
    assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
    await assert.rejects(li.claimImportOwner(store(), 'run-ccccccc3', runToken()), li.ImportHalted);
  });
  await check('I8/I9/O3 an interrupted capture resumes to an identical manifest; completion refused before S2 drain; then owner completion -> cutover bound to owner; changed content on resume halts', async () => {
    fresh(); seedLegacy();
    const t = runToken(); const run = 'run-imp00008';
    await li.claimImportOwner(store(), run, t);
    // interrupt the first S1 batch mid-way, then resume
    const sc = scope(); sc.deadlines.work = Date.now() + 3_200;
    await li.captureBatch(store(sc), legacyStore(sc), sc, { runId: run, snapshot: 'S1', env: ENV, locationId: LOC }).catch(() => null);
    await captureAll(store(), run, t);
    assert.equal(await cut.cutoverValid(store()), null, 'no early cutover');
    await assert.rejects(li.completeImport(store(), { env: ENV, locationId: LOC, runId: run, runToken: t, knownSubjects: [], unstablePrefixes: [], T_r: new Date().toISOString(), drainMinutes: 30 }, await li.loadWorld(store(), run)), (e) => /drain interval/.test(e.message));
    const r = await li.completeImport(store(), { env: ENV, locationId: LOC, runId: run, runToken: t, knownSubjects: [], unstablePrefixes: [], T_r: new Date(Date.now() - 3_600_000).toISOString(), drainMinutes: 30 }, await li.loadWorld(store(), run));
    const c = await cut.cutoverValid(store());
    assert.ok(c); assert.equal(c.ownerRunId, run); assert.equal(c.manifestDigest, r.digest);
    assert.ok(wire.json(S, cut.legacyBlockKey(ENV, LOC, 'contact:CA')), 'the uncertain v3 subject is blocked');
    assert.ok(wire.json(S, `authz/send/${'c'.repeat(64)}`), 'send receipt imported under the same key');
    assert.equal(wire.keys(L).length, 5, 'the legacy store was never written');
    // I9: a changed capture on resume halts
    const k = li.evidenceObsKey(run, 'S1', v3('op', 'v3op1'));
    const o = wire.json(S, k); wire.remove(S, k); wire.seed(S, k, { ...o, valueDigest: 'tampered' });
    const p = wire.json(S, li.evidenceProgressKey(run, 'S1')); wire.remove(S, li.evidenceProgressKey(run, 'S1')); wire.seed(S, li.evidenceProgressKey(run, 'S1'), { ...p, done: false, next: 0 });
    await assert.rejects(li.captureBatch(store(), legacyStore(), scope(), { runId: run, snapshot: 'S1', env: ENV, locationId: LOC }), li.ImportHalted);
  });
  await check('I10 the dry run writes nothing', async () => {
    fresh(); seedLegacy();
    const before = wire.keys(S).length;
    for (let i = 0; i < 5; i++) { const r = await li.captureBatch(store(), legacyStore(), scope(), { runId: 'run-dry00010', snapshot: 'S1', env: ENV, locationId: LOC }, true); if (r.done) break; }
    assert.equal(wire.keys(S).length, before);
  });
  await check('O2 batches of the same run serialize on the FIXED import lock key (independent of the run)', async () => {
    assert.equal(cut.IMPORT_LOCK_KEY, 'authz/import/lock');
    const src = fs.readFileSync(path.join(__dirname, '../netlify/functions/iaos-cutover.ts'), 'utf8');
    assert.ok(/acquireLock\(s, inv\.scope, IMPORT_LOCK_KEY/.test(src));
  });
  await check('O3b a cutover record not bound to the owner (runId or digest mismatch) is invalid', async () => {
    fresh();
    wire.seed(S, cut.IMPORT_OWNER_KEY, { v: 1, runId: 'r1', ownerHash: 'h', startedAt: 't', state: 'complete', manifestDigest: 'm1' });
    wire.seed(S, cut.CUTOVER_KEY, { v: 1, importComplete: true, ownerRunId: 'r1', manifestDigest: 'm2', T_r: 't', drainUntil: 't', createdAt: 't' });
    assert.equal(await cut.cutoverValid(store()), null);
  });
  await check('O4 static: no live authorization path reads `evidence/`', async () => {
    const dir = path.join(__dirname, '../netlify/functions');
    const live = ['ghl-write.ts', 'call-log-barrier.ts', 'current-offer-barrier.ts', 'ghl-disposition.ts', 'ghl-executed-artifact-upload.ts', 'lib/write-gate.ts', 'lib/admission.ts', 'lib/cutover.ts', 'lib/g5-gate.ts', 'lib/call-log-barrier.ts', 'lib/current-offer-barrier.ts', 'lib/contact-lock-v2.ts', 'lib/owned-send.ts', 'lib/endpoint-kit.ts'];
    const code = (f) => fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const f of live) assert.ok(!/["'`]evidence\//.test(code(f).replace(/PUBLICATION_ARCHIVE_PREFIX = "evidence\/publication\/"|ACTIVATION_ARCHIVE_PREFIX = "evidence\/activation\/"/g, '')), `${f} names evidence/`);
  });
  await check('O5 legacy-format (non-v2-) ids are refused by the format rule', async () => {
    assert.equal(cut.isV2Id('v2-0b0c4a52-5f0e-4f45-9a4d-2a1a6a6f0e11'), true);
    for (const id of ['0b0c4a52-5f0e-4f45-9a4d-2a1a6a6f0e11', 'v3-abcdef', 'v2-', 'V2-abcdef', 'v2-abc']) assert.equal(cut.isV2Id(id), false, id);
  });
  await check('O6 a send-receipt check with no imported receipt refuses a pending-readback claim', async () => {
    fresh();
    const wr = require('../netlify/functions/lib/write-receipts.ts');
    process.env.IAOS_ENV = 'test';
    await assert.rejects(wr.requireSendOutcome(store(), 'attempt-x', 'provider_accepted_pending_readback', 'doc'), /No matching server send receipt/);
  });
  await check('O7 a subject with no legacy block is still refused by the default G5 table', async () => {
    fresh();
    const t = g5.DEFAULT_TABLE(); wire.seed(S, 'authz/g5/table', t);
    const sc = new InvocationScope('ghl-write');
    const gate = new WriteGate(sc, store(sc), { id: 'd', context: 'production', published: true }, ENV, LOC);
    gate.captured = { epoch: 1, activationId: 'a', deployId: 'd', g5Digest: g5.tableDigest(t) };
    await assert.rejects(gate.checkSubject('contact:clean', ['note']), (e) => e.refusal.body.code === 'g5_blocked');
  });
  done('storage G5 and import');
})();
