/**
 * PR #126 fourth re-review (Bones, 2026-10-05) -- the per-deal Current Offer
 * save coordinator (lib/current-offer-save-coordinator.ts), driven directly.
 *
 * Offline, no browser. The injected `write` is a fake whose every call is
 * held until the test settles it, and a tiny in-memory "GHL" applies each
 * write when the test says it reached the server -- so every completion
 * order can be forced. Covered: per-deal serialization (one write + readback
 * in flight per deal), blur coalescing and de-dupe, refusal vs uncertain,
 * Bones's two overlapping-request cases, independent deals (navigation),
 * Confirm Accept through the same queue (resolve/reject with the write's own
 * result), and seeding from the carrier.
 */
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);
const { createOfferSaveCoordinator, classifyOfferSaveError } = require(path.resolve(__dirname, '../src/lib/current-offer-save-coordinator.ts'));

let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}
const tick = () => new Promise((r) => setImmediate(r));

/** A harness: a fake GHL value per deal, and a write whose calls are held. */
function harness() {
  const ghl = {};
  const calls = [];   // { oppId, amount, settle(kind) }
  const write = (oppId, amount) => new Promise((resolve, reject) => {
    const c = {
      oppId, amount, done: false,
      // 'ok'      -> GHL applies it; readback verifies it
      // 'refuse'  -> 4xx, nothing applied
      // 'uncertain' -> GHL applies it; the readback fails
      // 'mismatch'  -> GHL applies it, then something else lands; readback disagrees
      settle(kind) {
        c.done = true;
        if (kind === 'refuse') return reject(new Error(`setCurrentOffer PUT → 403: refused`));
        ghl[oppId] = amount;
        if (kind === 'uncertain') return reject(new Error('readback failed (500)'));
        if (kind === 'mismatch') return resolve({ ok: false });
        return resolve({ ok: ghl[oppId] === amount });
      },
    };
    calls.push(c);
  });
  let changes = 0;
  const co = createOfferSaveCoordinator(write, () => { changes += 1; });
  const open = (oppId) => calls.filter((c) => !c.done && (!oppId || c.oppId === oppId));
  return { ghl, calls, co, open, changes: () => changes };
}

(async () => {
  // classification
  check('a 4xx PUT is a refusal', classifyOfferSaveError(new Error('setCurrentOffer PUT → 403: x')).kind === 'refused');
  check('a 5xx PUT is uncertain', classifyOfferSaveError(new Error('setCurrentOffer PUT → 502: x')).kind === 'unconfirmed');
  check('a network failure is uncertain', classifyOfferSaveError(new TypeError('Failed to fetch')).kind === 'unconfirmed');

  // 1 -- a single save
  {
    const h = harness();
    check('1 nothing typed is a draft', h.co.statusFor('A', 100) === 'draft');
    h.co.requestSave('A', 100);
    await tick();
    check('1 a save in flight is "saving"', h.co.statusFor('A', 100) === 'saving' && h.open('A').length === 1);
    h.open('A')[0].settle('ok'); await tick();
    check('1 a verified save is "recorded"', h.co.statusFor('A', 100) === 'recorded');
    h.co.requestSave('A', 100); await tick();
    check('1 blurring the verified amount again sends nothing', h.calls.length === 1);
    check('1 the page was told about each change', h.changes() >= 2);
  }

  // 2 -- serialization: Bones's exact case. Older $410k write held; newer $420k must not be sent until it settles.
  {
    const h = harness();
    h.co.requestSave('A', 410000); await tick();
    h.co.requestSave('A', 420000); await tick();
    check('2 while $410k is in flight, $420k is NOT sent (one write per deal at a time)', h.calls.length === 1 && h.calls[0].amount === 410000);
    check('2 $420k shows "saving" (queued) and $410k shows draft', h.co.statusFor('A', 420000) === 'saving' && h.co.statusFor('A', 410000) === 'draft');
    h.calls[0].settle('ok'); await tick();
    check('2 after $410k settles, $420k is sent', h.calls.length === 2 && h.calls[1].amount === 420000);
    check('2 $410k\'s verification is not shown as recorded while $420k is pending', h.co.statusFor('A', 410000) === 'draft' && h.co.statusFor('A', 420000) === 'saving');
    h.calls[1].settle('ok'); await tick();
    check('2 $420k is recorded only after its own readback, and GHL holds $420k', h.co.statusFor('A', 420000) === 'recorded' && h.ghl.A === 420000);
  }

  // 3 -- a stale readback can no longer verify: the old overlap (write B lands between write A and A's readback) cannot happen.
  {
    const h = harness();
    h.co.requestSave('A', 410000); h.co.requestSave('A', 420000); h.co.requestSave('A', 430000); await tick();
    check('3 repeated blurs while saving coalesce: only the latest queued amount waits', h.calls.length === 1);
    h.calls[0].settle('ok'); await tick();
    check('3 the replaced middle amount is never sent', h.calls.length === 2 && h.calls[1].amount === 430000);
    h.calls[1].settle('ok'); await tick();
    check('3 the latest amount is recorded and GHL holds it', h.co.statusFor('A', 430000) === 'recorded' && h.ghl.A === 430000);
    check('3 writes went out strictly in order 410k, 430k', h.calls.map((c) => c.amount).join() === '410000,430000');
  }

  // 4 -- returning to the in-flight amount while a newer one is queued.
  {
    const h = harness();
    h.co.requestSave('A', 310000); await tick(); h.calls[0].settle('ok'); await tick();
    h.co.requestSave('A', 320000); await tick();
    h.co.requestSave('A', 310000); await tick();
    check('4 with $320k in flight, retyped $310k is queued (corrective save not suppressed)', h.co.statusFor('A', 310000) === 'saving' && h.co.statusFor('A', 320000) === 'draft');
    h.calls[1].settle('ok'); await tick();
    check('4 the corrective $310k write is sent after $320k', h.calls.length === 3 && h.calls[2].amount === 310000);
    h.calls[2].settle('ok'); await tick();
    check('4 $310k is recorded and GHL holds it', h.co.statusFor('A', 310000) === 'recorded' && h.ghl.A === 310000);
  }

  // 5 -- refusals and uncertain results, in both positions.
  {
    const h = harness();
    h.co.requestSave('A', 100); await tick(); h.calls[0].settle('ok'); await tick();
    h.co.requestSave('A', 200); await tick(); h.calls[1].settle('refuse'); await tick();
    check('5 a refused save says failed for its amount', h.co.statusFor('A', 200) === 'failed' && /refused the save \(403\)/.test(h.co.failureFor('A', 200)));
    check('5 a refusal wrote nothing: the previous verified amount is still recorded', h.co.statusFor('A', 100) === 'recorded' && h.ghl.A === 100);
    h.co.requestSave('A', 300); await tick(); h.calls[2].settle('uncertain'); await tick();
    check('5 an uncertain save says unconfirmed for its amount', h.co.statusFor('A', 300) === 'unconfirmed' && h.co.failureFor('A', 300) === 'Save could not be confirmed.');
    check('5 after an uncertain save NOTHING is recorded (GHL unknown)', h.co.statusFor('A', 100) === 'draft');
    h.co.requestSave('A', 300); await tick();
    check('5 blurring the uncertain amount again retries it', h.calls.length === 4 && h.calls[3].amount === 300);
    h.calls[3].settle('mismatch'); await tick();
    check('5 a readback that disagrees is unconfirmed, never recorded', h.co.statusFor('A', 300) === 'unconfirmed');
  }

  // 6 -- an older failure while a newer amount is queued never labels the newer one.
  {
    const h = harness();
    h.co.requestSave('A', 410000); h.co.requestSave('A', 420000); await tick();
    h.calls[0].settle('uncertain'); await tick();
    check('6 an older uncertain result: the queued newer amount is then sent and shows saving, no error', h.calls.length === 2 && h.co.statusFor('A', 420000) === 'saving' && h.co.failureFor('A', 420000) === null);
    h.calls[1].settle('ok'); await tick();
    check('6 the newer amount is recorded by its own readback', h.co.statusFor('A', 420000) === 'recorded');
    h.co.requestSave('A', 510000); h.co.requestSave('A', 520000); await tick();
    h.calls[2].settle('refuse'); await tick();
    check('6 an older refusal: the newer amount is sent, no error on it', h.calls.length === 4 && h.co.failureFor('A', 520000) === null);
    h.calls[3].settle('ok'); await tick();
    check('6 then recorded', h.co.statusFor('A', 520000) === 'recorded' && h.ghl.A === 520000);
  }

  // 7 -- deals are independent (navigation A -> B).
  {
    const h = harness();
    h.co.requestSave('A', 250000); await tick();
    h.co.requestSave('B', 250000); await tick();
    check('7 B\'s save of the same amount is sent while A\'s is in flight', h.calls.length === 2 && h.calls[1].oppId === 'B');
    check('7 A\'s pending save does not label B, and B\'s does not label A', h.co.statusFor('B', 250000) === 'saving' && h.co.statusFor('A', 250000) === 'saving');
    h.calls[0].settle('ok'); await tick();
    check('7 A\'s completion records A only', h.co.statusFor('A', 250000) === 'recorded' && h.co.statusFor('B', 250000) === 'saving');
    h.calls[1].settle('refuse'); await tick();
    check('7 B\'s refusal is B\'s alone', h.co.statusFor('B', 250000) === 'failed' && h.co.statusFor('A', 250000) === 'recorded');
  }

  // 8 -- Confirm Accept through the same queue.
  {
    const h = harness();
    h.co.requestSave('A', 410000); await tick();
    let acceptResult = null;
    const p = h.co.saveForAccept('A', 420000).then((r) => { acceptResult = r; });
    await tick();
    check('8 Accept waits behind the blur save in flight (not sent concurrently)', h.calls.length === 1);
    h.calls[0].settle('ok'); await tick();
    check('8 Accept is sent after it', h.calls.length === 2 && h.calls[1].amount === 420000);
    h.calls[1].settle('ok'); await p;
    check('8 Accept resolves with the write\'s own result and records its amount', acceptResult && acceptResult.ok === true && h.co.statusFor('A', 420000) === 'recorded');
    h.co.requestSave('A', 420000); await tick();
    check('8 an untouched blur after Accept sends nothing', h.calls.length === 2);
    const p2 = h.co.saveForAccept('A', 420000);
    await tick();
    check('8 Accept is never de-duped (it is the acceptance record)', h.calls.length === 3);
    h.calls[2].settle('refuse');
    let rejected = null; try { await p2; } catch (e) { rejected = e; }
    check('8 a refused Accept rejects with the write\'s own error', rejected && /PUT → 403/.test(rejected.message));
    const p3 = h.co.saveForAccept('A', 430000); await tick();
    h.calls[3].settle('mismatch');
    check('8 an unverified Accept resolves { ok: false }', (await p3).ok === false && h.co.statusFor('A', 430000) === 'unconfirmed');
    h.co.requestSave('A', 440000); await tick();
    const p4 = h.co.saveForAccept('A', 440000); await tick();
    h.co.requestSave('A', 450000); await tick();
    check('8 a blur after a queued Accept queues behind it and does not replace it', h.calls.length === 5 && h.calls[4].amount === 440000);
    h.calls[4].settle('ok'); await tick();
    h.calls[5].settle('ok'); await p4; await tick();
    check('8 order kept: blur 440k, Accept 440k, blur 450k', h.calls.slice(4).map((c) => c.amount).join() === '440000,440000,450000');
    h.calls[6].settle('ok'); await tick();
    check('8 the last blur is recorded', h.co.statusFor('A', 450000) === 'recorded');
  }

  // 9 -- seeding from the carrier.
  {
    const h = harness();
    h.co.seed('A', 300000);
    check('9 a restored carrier amount is recorded', h.co.statusFor('A', 300000) === 'recorded');
    h.co.requestSave('A', 300000); await tick();
    check('9 blurring it unchanged sends nothing', h.calls.length === 0);
    h.co.requestSave('A', 310000); await tick();
    h.co.seed('A', 300000);
    check('9 a seed while a save is pending is ignored (the read may predate it)', h.co.statusFor('A', 310000) === 'saving' && h.co.statusFor('A', 300000) === 'draft');
  }

  console.log(`\nCurrent Offer save coordinator: ${checks - failures}/${checks} checks passed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
