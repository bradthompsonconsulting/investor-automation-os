/**
 * INV-98 Board #9 (Bones REVISE item 2) -- offline tests for Seller Call's
 * Confirm Accept write sequence and its call-timestamp recovery
 * (`src/lib/seller-call-accept-writes.ts`), plus source checks that
 * `SellerCallWorkspace.tsx` runs exactly these functions and gates
 * Confirm Accept on them.
 *
 * The app has no DOM test harness; the page's write logic lives in the
 * module so the behaviour itself is exercised here, and the wiring checks
 * pin the page to it. The server side of the same sequence runs through
 * the real ghl-write handler in test-production-write-scope.cjs.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const APP = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) {
  if (name.startsWith('.') && parent) { const c = path.resolve(path.dirname(parent.filename), name + '.ts'); if (fs.existsSync(c)) return c; }
  return originalResolve.call(this, name, parent, ...rest);
};
Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);

const lib = require(path.join(APP, 'src/lib/seller-call-accept-writes.ts'));
const outcomeLib = require(path.join(APP, 'src/lib/seller-call-outcome.ts'));
const PAGE = fs.readFileSync(path.join(APP, 'src/pages/SellerCallWorkspace.tsx'), 'utf8');
const PAGE_NC = PAGE.replace(/\/\*[\s\S]*?\*\//g, '');

let checks = 0, failures = 0;
async function check(name, fn) {
  try { await fn(); checks++; console.log('PASS ' + name); }
  catch (e) { checks++; failures++; console.log('FAIL ' + name + ' -- ' + (e && e.stack || e)); }
}

const ARGS = { contactId: 'c1', opportunityId: 'o1', offerValue: 190000, note: 'ACCEPT NOTE BODY', at: '2026-09-29T13:00:00.000Z' };
function client(behaviour = {}) {
  const calls = [];
  return {
    calls,
    setCurrentOffer: async (id, v) => { calls.push(['offer', id, v]); if (behaviour.offer === 'throw') throw new Error('offer down'); return { ok: behaviour.offer !== 'unconfirmed' }; },
    createNote: async (id, body) => { calls.push(['note', id, body]); if (behaviour.note === 'throw') throw new Error('note down'); return {}; },
    setLastCallAttempt: async (id, iso) => { calls.push(['timestamp', id, iso]); if (behaviour.timestamp === 'throw') throw new Error('Write was not confirmed'); return {}; },
  };
}

(async () => {
  // ===== The write sequence.
  await check('success: Current Offer, then accept note, then call timestamp -- in that order, once each', async () => {
    const c = client();
    const r = await lib.runConfirmAcceptWrites(c, ARGS);
    assert.deepEqual(r, { stage: 'complete', acceptanceRecorded: true, note: ARGS.note });
    assert.deepEqual(c.calls, [['offer', 'o1', 190000], ['note', 'c1', ARGS.note], ['timestamp', 'c1', ARGS.at]]);
  });
  await check('Current Offer write throws -> nothing recorded, no note, no timestamp', async () => {
    const c = client({ offer: 'throw' });
    const r = await lib.runConfirmAcceptWrites(c, ARGS);
    assert.equal(r.stage, 'offer_failed'); assert.equal(r.acceptanceRecorded, false);
    assert.ok(/Nothing was recorded/.test(r.message));
    assert.deepEqual(c.calls.map((x) => x[0]), ['offer']);
  });
  await check('Current Offer not confirmed -> nothing recorded, no note', async () => {
    const c = client({ offer: 'unconfirmed' });
    const r = await lib.runConfirmAcceptWrites(c, ARGS);
    assert.equal(r.stage, 'offer_unconfirmed'); assert.deepEqual(c.calls.map((x) => x[0]), ['offer']);
  });
  await check('accept note fails -> reported as UNKNOWN (reload to check), no timestamp write', async () => {
    const c = client({ note: 'throw' });
    const r = await lib.runConfirmAcceptWrites(c, ARGS);
    assert.equal(r.stage, 'note_failed'); assert.equal(r.acceptanceRecorded, 'unknown');
    // Brad / Bones 2026-10-05: never "reload and check"; the durable barrier decides.
    assert.ok(/may or may not have been recorded/.test(r.message) && !/[Rr]eload/.test(r.message) && /until IAOS can prove what happened/.test(r.message));
    assert.deepEqual(c.calls.map((x) => x[0]), ['offer', 'note']);
  });
  await check('timestamp fails AFTER the note -> acceptance reported RECORDED, only the timestamp outstanding, never "record again"', async () => {
    const c = client({ timestamp: 'throw' });
    const r = await lib.runConfirmAcceptWrites(c, ARGS);
    assert.equal(r.stage, 'timestamp_failed'); assert.equal(r.acceptanceRecorded, true);
    assert.equal(r.note, ARGS.note); assert.equal(r.pendingTimestamp, ARGS.at);
    assert.ok(/^Acceptance recorded\. Only the call timestamp/.test(r.message), r.message);
    assert.ok(/never records the acceptance again/.test(r.message));
    assert.deepEqual(c.calls.map((x) => x[0]), ['offer', 'note', 'timestamp']);
  });
  await check('after a timestamp failure, the saved accept note makes Confirm Accept NOT offered (and a reload reads Agreement Reached)', async () => {
    const note = outcomeLib.formatOutcomeNote({ opportunityId: 'o1', at: ARGS.at, operator: 'brad', kind: 'accept', reason: null, followUpAt: null, snapshot: { sellerPosition: 190000, currentOffer: 190000, targetAcquisitionPrice: null, maxSupportedOffer: null, expectedSpread: null, arv: 485000, repairs: 52000, readinessStatus: 'OFFER_READY' } });
    const latest = outcomeLib.latestOutcomeNoteForOpportunity([{ body: note }], 'o1');
    assert.equal(latest.kind, 'accept');
    assert.equal(lib.confirmAcceptOffered(latest.kind), false);
    assert.equal(lib.confirmAcceptOffered(null), true);
    assert.equal(lib.confirmAcceptOffered('pass'), true);
    assert.equal(lib.confirmAcceptOffered('follow_up'), true);
  });

  // ===== Timestamp recovery: BOTH last-call fields, read first.
  // `last_call_attempt` (D) is a DATE field, confirmed by its YYYY-MM-DD
  // prefix; `last_call_attempt_precise` (P) is TEXT, the exact ISO written.
  const D = 'field-last-call-date', P = 'field-last-call-precise';
  const IDS = { date: D, precise: P };
  const T0 = ARGS.at;                       // the original, unconfirmed timestamp
  const T1 = '2026-09-29T13:10:00.000Z';    // a recovery attempt
  const T2 = '2026-09-29T13:20:00.000Z';    // a later attempt
  const LATER = '2026-09-30T09:00:00.000Z'; // newer call activity saved by someone else
  const OLDER = '2026-09-01T08:00:00.000Z';
  // A tiny stateful GHL: writes set BOTH fields the way the server does.
  function ghlFields(initial, behaviour = {}) {
    const state = { fields: initial.slice() };
    const calls = [];
    return {
      state, calls,
      readLastCallFields: async (id) => { calls.push(['read', id]); if (behaviour.read === 'throw') throw new Error('read down'); return state.fields.map((f) => ({ ...f })); },
      setLastCallAttempt: async (id, iso) => {
        calls.push(['write', id, iso]);
        const mode = typeof behaviour.write === 'function' ? behaviour.write(iso) : behaviour.write;
        if (mode === 'fail') throw new Error('write refused');
        state.fields = state.fields.filter((f) => f.id !== D && f.id !== P).concat([{ id: D, value: iso }, { id: P, value: iso }]);
        if (mode === 'lost') throw new Error('response lost after the write landed');
        return {};
      },
    };
  }
  const recover = (g, pending, now) => lib.recoverLastCallAttempt(g, { contactId: 'c1', pendingTimestamp: pending, now, fieldIds: IDS });
  const writes = (g) => g.calls.filter((x) => x[0] === 'write');

  // -- Bones item 1: a failed or lost recovery write keeps ITS timestamp pending.
  await check('T0 fails; the T1 recovery write lands but loses its response -> T1 becomes pending; the next recovery reads T1 and makes ZERO writes', async () => {
    const g = ghlFields([], { write: 'lost' });
    const first = await recover(g, T0, T1);
    assert.equal(first.kind, 'write_unconfirmed');
    assert.equal(first.pendingTimestamp, T1, 'the attempted T1 -- not T0 -- is now pending');
    assert.deepEqual(writes(g), [['write', 'c1', T1]]);
    g.calls.length = 0;
    const second = await recover(g, first.pendingTimestamp, T2);
    assert.deepEqual(second, { kind: 'confirmed', at: T1, reason: 'pending_landed' });
    assert.deepEqual(g.calls, [['read', 'c1']], 'read only -- zero additional writes');
  });
  await check('a recovery write that fails WITHOUT landing also becomes pending; the next recovery reads nothing newer and writes once, freshly', async () => {
    let n = 0;
    const g = ghlFields([], { write: () => (++n === 1 ? 'fail' : 'ok') });
    const first = await recover(g, T0, T1);
    assert.equal(first.kind, 'write_unconfirmed'); assert.equal(first.pendingTimestamp, T1);
    const second = await recover(g, first.pendingTimestamp, T2);
    assert.deepEqual(second, { kind: 'written', at: T2 });
    assert.deepEqual(writes(g).map((w) => w[2]), [T1, T2]);
  });

  // -- Bones item 2: both fields, real serialization, clear only on complete evidence.
  await check('both fields confirm the pending write (date YYYY-MM-DD + exact precise text) -> cleared, no write', async () => {
    const g = ghlFields([{ id: D, value: '2026-09-29' }, { id: P, value: T0 }]);
    assert.deepEqual(await recover(g, T0, T1), { kind: 'confirmed', at: T0, reason: 'pending_landed' });
    assert.equal(writes(g).length, 0);
  });
  await check('the date field read back as a full ISO string also confirms by its YYYY-MM-DD prefix (the server rule)', async () => {
    const g = ghlFields([{ id: D, value: '2026-09-29T00:00:00.000Z' }, { id: P, value: T0 }]);
    assert.equal((await recover(g, T0, T1)).kind, 'confirmed'); assert.equal(writes(g).length, 0);
  });
  await check('a NEWER complete timestamp is saved (later activity) -> cleared, and never overwritten', async () => {
    const g = ghlFields([{ id: D, value: '2026-09-30' }, { id: P, value: LATER }]);
    assert.deepEqual(await recover(g, T0, T1), { kind: 'confirmed', at: LATER, reason: 'later_activity' });
    assert.equal(writes(g).length, 0);
    assert.equal(g.state.fields.find((f) => f.id === P).value, LATER, 'later activity untouched');
  });
  for (const [label, fields] of [
    ['a newer precise time without its date', [{ id: P, value: LATER }]],
    ['a newer date without its precise time', [{ id: D, value: '2026-09-30' }]],
    ['a newer precise time whose date disagrees', [{ id: D, value: '2026-09-29' }, { id: P, value: LATER }]],
    // Bones: both fields exist and disagree -- an OLDER precise time with a LATER date.
    ['an older precise time (2026-09-28) with a later date (2026-09-30)', [{ id: D, value: '2026-09-30' }, { id: P, value: '2026-09-28T09:00:00.000Z' }]],
  ]) {
    await check(`newer but INCOMPLETE evidence (${label}) -> warning kept, NO write, pending unchanged`, async () => {
      const g = ghlFields(fields);
      const r = await recover(g, T0, T1);
      assert.equal(r.kind, 'blocked'); assert.equal(r.pendingTimestamp, T0);
      assert.equal(writes(g).length, 0);
    });
  }
  for (const [label, fields] of [
    ['only the precise time of the pending write landed', [{ id: P, value: T0 }]],
    ['only the date of the pending write landed', [{ id: D, value: '2026-09-29' }]],
    ['the pending precise time landed but the date shows an older day', [{ id: D, value: '2026-09-28' }, { id: P, value: T0 }]],
  ]) {
    await check(`partial landing (${label}) -> not cleared; one fresh write completes both fields`, async () => {
      const g = ghlFields(fields);
      assert.deepEqual(await recover(g, T0, T1), { kind: 'written', at: T1 });
      assert.deepEqual(writes(g).map((w) => w[2]), [T1]);
      assert.deepEqual(lib.readLastCallFields(g.state.fields, IDS), { kind: 'complete', precise: T1, date: '2026-09-29' });
    });
  }
  for (const [label, fields] of [['nothing saved', []], ['an older complete timestamp', [{ id: D, value: '2026-09-01' }, { id: P, value: OLDER }]]]) {
    await check(`${label} -> the pending write did not land; exactly one fresh write, read strictly first`, async () => {
      const g = ghlFields(fields);
      assert.deepEqual(await recover(g, T0, T1), { kind: 'written', at: T1 });
      assert.deepEqual(g.calls, [['read', 'c1'], ['write', 'c1', T1]]);
    });
  }
  for (const [label, fields] of [
    ['duplicate precise entries', [{ id: D, value: '2026-09-29' }, { id: P, value: T0 }, { id: P, value: T0 }]],
    ['duplicate date entries', [{ id: D, value: '2026-09-29' }, { id: D, value: '2026-09-29' }, { id: P, value: T0 }]],
    ['a non-string date', [{ id: D, value: 1759150800000 }, { id: P, value: T0 }]],
    ['a date that is not YYYY-MM-DD', [{ id: D, value: '09/29/2026' }, { id: P, value: T0 }]],
    ['a precise time that is not an ISO instant', [{ id: D, value: '2026-09-29' }, { id: P, value: 'yesterday' }]],
    ['a precise time without the Z (not the server serialization)', [{ id: D, value: '2026-09-29' }, { id: P, value: '2026-09-29T13:00:00.000' }]],
    // Bones: a missing value is malformed evidence, never an absent field.
    ['a precise entry whose value is undefined', [{ id: P, value: undefined }]],
    ['a precise entry with no value key at all', [{ id: P }]],
    ['a date entry with no value key at all', [{ id: D }]],
    ['both entries present with no values', [{ id: D }, { id: P }]],
    ['a valueless date entry beside the pending precise time', [{ id: D }, { id: P, value: T0 }]],
    ['a null precise value', [{ id: D, value: '2026-09-29' }, { id: P, value: null }]],
    ['an empty-string precise value', [{ id: D, value: '2026-09-29' }, { id: P, value: '' }]],
    ['an empty-string date value', [{ id: D, value: '' }, { id: P, value: T0 }]],
  ]) {
    await check(`malformed evidence (${label}) -> warning kept, NO write`, async () => {
      const g = ghlFields(fields);
      const r = await recover(g, T0, T1);
      assert.equal(r.kind, 'blocked'); assert.equal(r.pendingTimestamp, T0);
      assert.ok(/Nothing was written/.test(r.message));
      assert.equal(writes(g).length, 0);
    });
  }
  await check('the same instant in a different ISO spelling is NOT the exact text written -> warning kept, NO write', async () => {
    const g = ghlFields([{ id: D, value: '2026-09-29' }, { id: P, value: '2026-09-29T13:00:00Z' }]);
    const r = await recover(g, T0, T1);
    assert.equal(r.kind, 'blocked'); assert.equal(writes(g).length, 0);
  });
  await check('the readback itself fails -> warning kept, pending unchanged, NOTHING written', async () => {
    const g = ghlFields([], { read: 'throw' });
    const r = await recover(g, T0, T1);
    assert.equal(r.kind, 'blocked'); assert.equal(r.pendingTimestamp, T0); assert.ok(/Nothing was written/.test(r.message));
    assert.deepEqual(g.calls, [['read', 'c1']]);
  });
  await check('readLastCallFields: absent / complete / partial / malformed classification', () => {
    assert.deepEqual(lib.readLastCallFields([], IDS), { kind: 'absent' });
    assert.deepEqual(lib.readLastCallFields([{ id: D, value: '2026-09-29' }, { id: P, value: T0 }, { id: 'other', value: 'x' }], IDS), { kind: 'complete', precise: T0, date: '2026-09-29' });
    assert.equal(lib.readLastCallFields([{ id: P, value: T0 }], IDS).kind, 'partial');
    assert.equal(lib.readLastCallFields([{ id: D, value: null }], IDS).kind, 'malformed');
  });

  // ===== The page runs exactly these functions and gates Confirm Accept on them.
  await check('page: the accept branch keeps the freeze gate, then delegates the three writes to runConfirmAcceptWrites with the frozen value and the attempt note', () => {
    assert.ok(/import \{ runConfirmAcceptWrites, confirmAcceptOffered, recoverLastCallAttempt \} from "\.\.\/lib\/seller-call-accept-writes";/.test(PAGE));
    const freezeAt = PAGE_NC.indexOf('if (freeze.kind === "blocked")');
    const runAt = PAGE_NC.indexOf('await runConfirmAcceptWrites(');
    assert.ok(freezeAt !== -1 && runAt > freezeAt, 'freeze gate precedes the writes');
    assert.ok(/offerValue: freeze\.value, note: attempt\.note, at: nowIso/.test(PAGE_NC));
    // PR #126 fourth re-review: the accepted price is written through the page's
    // per-deal Current Offer save coordinator (serialized with any blur save),
    // whose own write is ghl.opportunities.setCurrentOffer.
    // PR #126 stacked server PR: each write carries the request id reserved with the durable barrier.
    assert.ok(/setCurrentOffer: \(opportunityId, value\) => offerSaves\.saveForAccept\(opportunityId, value, acceptIds\.offer\)/.test(PAGE_NC));
    assert.ok(/createNote: \(id, body\) => ghl\.notes\.create\(id, body, \{ requestId: acceptIds\.note \}\)/.test(PAGE_NC));
    assert.ok(/setLastCallAttempt: \(id, iso\) => ghl\.contacts\.setLastCallAttempt\(id, iso, \{ requestId: acceptIds\.touch \}\)/.test(PAGE_NC));
    assert.ok(/createOfferSaveCoordinator\(saveCurrentOfferReserved\)/.test(PAGE_NC));

  });
  await check('page: a timestamp failure appends the saved accept note to local state (Agreement Reached shows at once) and arms timestamp-only recovery', () => {
    assert.ok(/setNotes\(\(prev\) => \[\.\.\.\(prev \?\? \[\]\), \{ id: `local-\$\{Date\.now\(\)\}`, body: result\.note, dateAdded: nowIso \}\]\);[\s\S]{0,120}if \(result\.stage === "timestamp_failed"\) \{\s*setTimestampRecovery\(\{ pendingTimestamp: result\.pendingTimestamp \}\);\s*setOutcomeActionError\(result\.message\);/.test(PAGE_NC));
  });
  await check('page: offer failures and note failures return WITHOUT appending an accept note', () => {
    assert.ok(/if \(result\.stage === "offer_failed" \|\| result\.stage === "offer_unconfirmed"\) \{\s*setOutcomeActionError\(offerSaves\.unresolvedMessage\(acceptOppId\) \?\? result\.message\);\s*return;\s*\}/.test(PAGE_NC));
    assert.ok(/if \(result\.stage === "note_failed"\) \{\s*setOutcomeActionError\(result\.message\);\s*return;\s*\}/.test(PAGE_NC));
  });
  await check('page: the Accept toggle and the Accept form render only while confirmAcceptOffered(latestOutcome?.kind)', () => {
    assert.ok(/\{!confirmAcceptOffered\(latestOutcome\?\.kind\) \? \(\s*<span data-testid="call-outcome-accept-recorded"/.test(PAGE));
    assert.ok(/showOutcomeForm === "accept" && confirmAcceptOffered\(latestOutcome\?\.kind\) \?/.test(PAGE));
  });
  await check('page: "Check & retry call timestamp" renders only during recovery and runs recoverLastCallAttempt over BOTH last-call fields', () => {
    assert.ok(/\{timestampRecovery \? \(\s*<button\s+data-testid="call-timestamp-recover"\s+onClick=\{\(\) => \{ void handleRecoverCallTimestamp\(\); \}\}/.test(PAGE));
    assert.ok(/await recoverLastCallAttempt\(/.test(PAGE_NC));
    assert.ok(/readLastCallFields: async \(id\) => \(await ghl\.contacts\.getDetail\(id\)\)\.customFields/.test(PAGE_NC));
    assert.ok(/fieldIds: \{ date: CONFIG\.fields\.lastCallAttempt, precise: CONFIG\.fields\.lastCallAttemptPrecise \}/.test(PAGE_NC));
  });
  await check('page: the warning clears ONLY on confirmed/written; otherwise the module\'s pendingTimestamp is kept', () => {
    assert.ok(/if \(recovered\.kind === "confirmed" \|\| recovered\.kind === "written"\) \{\s*setTimestampRecovery\(null\);\s*setOutcomeActionError\(null\);\s*\} else \{(?:\s*\/\/[^\n]*)*\s*setTimestampRecovery\(\{ pendingTimestamp: recovered\.pendingTimestamp \}\);\s*setOutcomeActionError\(recovered\.message\);\s*\}/.test(PAGE_NC));
  });
  await check('page: the only direct setLastCallAttempt calls are the two adapters handed to the module (outcome writes + recovery) and the non-accept outcomes', () => {
    const direct = (PAGE_NC.match(/ghl\.contacts\.setLastCallAttempt\(/g) || []).length;
    assert.equal(direct, 3, 'accept adapter, recovery adapter, and the unchanged Pass path');
  });

  console.log(`\nseller-call-accept-writes checks=${checks} failures=${failures}`);
  process.exitCode = failures ? 1 : 0;
})();
