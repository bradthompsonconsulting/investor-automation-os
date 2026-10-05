/**
 * PR #126 (Bones / Jess, 2026-10-05) -- the per-deal Current Offer save
 * coordinator (lib/current-offer-save-coordinator.ts), driven directly.
 *
 * Offline, no browser. The injected `write` is a fake whose every call is
 * held until the test settles it, and a tiny in-memory "GHL" applies each
 * write when the test says it reached the server -- so every completion
 * order and every failure class can be forced. Covered:
 *   - per-deal serialization, blur coalescing and de-dupe, both orders;
 *   - result classes: confirmed, refused (nothing written), unverified (the
 *     write finished, the readback failed/disagreed), indeterminate (the
 *     request may still land: no response, 5xx, generic 409, 202);
 *   - an indeterminate result makes the deal UNRESOLVED: no further
 *     submission (blur or Accept), queued saves dropped and never released,
 *     nothing "recorded", a carrier snapshot does not clear it;
 *   - Confirm Accept: protected for the whole sequence (queued blurs dropped,
 *     new blurs ignored, never replayed), through the same queue, resolves or
 *     rejects with the write's own result; an unknown acceptance leaves the
 *     deal unresolved;
 *   - independent deals; seeding.
 */
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);
const LIB = path.resolve(__dirname, '../src/lib');
const { createOfferSaveCoordinator, classifyOfferWriteError, classifyOfferWriteResult, UNRESOLVED_SAVE_MESSAGE, UNRESOLVED_ACCEPT_MESSAGE } = require(path.join(LIB, 'current-offer-save-coordinator.ts'));
const { AppWriteSignInRequired } = require(path.join(LIB, 'app-write-session.ts'));

let checks = 0;
let failures = 0;
function check(name, ok, detail) {
  checks += 1;
  if (!ok) failures += 1;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}
const tick = () => new Promise((r) => setImmediate(r));
const withPutStatus = (e, s) => Object.assign(e, { putStatus: s });

/** A harness: a fake GHL value per deal, and a write whose calls are held. */
function harness() {
  const ghl = {};
  const calls = [];
  const write = (oppId, amount) => new Promise((resolve, reject) => {
    const c = {
      oppId, amount, done: false,
      settle(kind) {
        c.done = true;
        switch (kind) {
          case 'ok': ghl[oppId] = amount; return resolve({ ok: true, putStatus: 200 });
          case 'refuse': return reject(new Error('setCurrentOffer PUT → 403: {"error":"refused"}'));
          case 'frozen': return reject(new Error('setCurrentOffer PUT → 409: {"error":"Current Offer is frozen or invalid"}'));
          case 'signin': return reject(new AppWriteSignInRequired('Sign in for application writes before saving. Your edits have not been submitted.'));
          case 'mismatch': ghl[oppId] = amount; return resolve({ ok: false, putStatus: 200 });
          case 'readback-failed': ghl[oppId] = amount; return reject(withPutStatus(new Error('setCurrentOffer readback → 500: x'), 200));
          case 'network': return reject(new TypeError('Failed to fetch'));
          case 'server5xx': return reject(new Error('setCurrentOffer PUT → 502: bad gateway'));
          case 'generic409': return reject(new Error('setCurrentOffer PUT → 409: {"error":"Write refused or unconfirmed; refresh and inspect before retrying"}'));
          case 'indeterminate202': ghl[oppId] = amount; return resolve({ ok: true, putStatus: 202 });
          case '202-readback-failed': return reject(withPutStatus(new Error('setCurrentOffer readback → 401: x'), 202));
          default: throw new Error('unknown settle kind ' + kind);
        }
      },
    };
    calls.push(c);
  });
  const co = createOfferSaveCoordinator(write);
  let changes = 0;
  co.subscribe(() => { changes += 1; });
  const open = (oppId) => calls.filter((c) => !c.done && (!oppId || c.oppId === oppId));
  return { ghl, calls, co, open, changes: () => changes };
}

(async () => {
  // classification -- by what is known about the REQUEST
  check('a 403 PUT is a refusal', classifyOfferWriteError(new Error('setCurrentOffer PUT → 403: x')) === 'refused');
  check('a 400 and a 401 PUT are refusals', classifyOfferWriteError(new Error('setCurrentOffer PUT → 400: x')) === 'refused' && classifyOfferWriteError(new Error('setCurrentOffer PUT → 401: x')) === 'refused');
  check('the server\'s pre-write "frozen" 409 is a refusal', classifyOfferWriteError(new Error('setCurrentOffer PUT → 409: {"error":"Current Offer is frozen or invalid"}')) === 'refused');
  check('the server\'s generic 409 (may follow a PUT to GHL) is indeterminate', classifyOfferWriteError(new Error('setCurrentOffer PUT → 409: {"error":"Write refused or unconfirmed; refresh and inspect before retrying"}')) === 'indeterminate');
  check('sign-in required (thrown before sending) is a refusal', classifyOfferWriteError(new AppWriteSignInRequired('Sign in for application writes before saving.')) === 'refused');
  check('a local validation error (nothing sent) is a refusal', classifyOfferWriteError(new Error('setCurrentOffer: value must be a positive finite number')) === 'refused');
  check('a 5xx PUT is indeterminate', classifyOfferWriteError(new Error('setCurrentOffer PUT → 502: x')) === 'indeterminate');
  check('a network failure is indeterminate', classifyOfferWriteError(new TypeError('Failed to fetch')) === 'indeterminate');
  check('a readback failure after a 200 PUT is unverified (the write finished)', classifyOfferWriteError(withPutStatus(new Error('setCurrentOffer readback → 500: x'), 200)) === 'unverified');
  check('a readback failure after a 202 (indeterminate) PUT is indeterminate', classifyOfferWriteError(withPutStatus(new Error('readback refused'), 202)) === 'indeterminate');
  check('a 202 result is indeterminate even when the snapshot readback matches', classifyOfferWriteResult({ ok: true, putStatus: 202 }) === 'indeterminate');
  check('a 200 result is confirmed when the readback matches, unverified when not', classifyOfferWriteResult({ ok: true, putStatus: 200 }) === 'confirmed' && classifyOfferWriteResult({ ok: false, putStatus: 200 }) === 'unverified');

  // 1 -- a single save
  {
    const h = harness();
    check('1 nothing typed is a draft', h.co.statusFor('A', 100) === 'draft');
    h.co.requestSave('A', 100); await tick();
    check('1 a save in flight is "saving"', h.co.statusFor('A', 100) === 'saving' && h.open('A').length === 1);
    h.open('A')[0].settle('ok'); await tick();
    check('1 a verified save is "recorded"', h.co.statusFor('A', 100) === 'recorded');
    h.co.requestSave('A', 100); await tick();
    check('1 blurring the verified amount again sends nothing', h.calls.length === 1);
    check('1 subscribers are told about each change', h.changes() >= 2);
  }

  // 2 -- serialization: an older $410k write in flight; the newer $420k waits.
  {
    const h = harness();
    h.co.requestSave('A', 410000); await tick();
    h.co.requestSave('A', 420000); await tick();
    check('2 while $410k is in flight, $420k is NOT sent', h.calls.length === 1 && h.calls[0].amount === 410000);
    check('2 $420k shows "saving" (queued) and $410k shows draft', h.co.statusFor('A', 420000) === 'saving' && h.co.statusFor('A', 410000) === 'draft');
    h.calls[0].settle('ok'); await tick();
    check('2 after $410k settles, $420k is sent; nothing is recorded meanwhile', h.calls.length === 2 && h.calls[1].amount === 420000 && h.co.statusFor('A', 410000) === 'draft');
    h.calls[1].settle('ok'); await tick();
    check('2 $420k is recorded only after its own readback, and GHL holds $420k', h.co.statusFor('A', 420000) === 'recorded' && h.ghl.A === 420000);
  }

  // 3 -- coalescing; 4 -- the corrective save.
  {
    const h = harness();
    h.co.requestSave('A', 410000); h.co.requestSave('A', 420000); h.co.requestSave('A', 430000); await tick();
    h.calls[0].settle('ok'); await tick();
    check('3 the replaced middle amount is never sent', h.calls.length === 2 && h.calls[1].amount === 430000);
    h.calls[1].settle('ok'); await tick();
    check('3 the latest amount is recorded and GHL holds it', h.co.statusFor('A', 430000) === 'recorded' && h.ghl.A === 430000);
  }
  {
    const h = harness();
    h.co.requestSave('A', 310000); await tick(); h.calls[0].settle('ok'); await tick();
    h.co.requestSave('A', 320000); await tick();
    h.co.requestSave('A', 310000); await tick();
    check('4 with $320k in flight, retyped $310k is queued (corrective save not suppressed)', h.co.statusFor('A', 310000) === 'saving');
    h.calls[1].settle('ok'); await tick();
    h.calls[2].settle('ok'); await tick();
    check('4 the corrective $310k is written after $320k and recorded', h.calls.map((c) => c.amount).join() === '310000,320000,310000' && h.co.statusFor('A', 310000) === 'recorded' && h.ghl.A === 310000);
  }

  // 5 -- determinate failures: refusal keeps the previous verified amount; unverified confirms nothing but does not block.
  {
    const h = harness();
    h.co.requestSave('A', 100); await tick(); h.calls[0].settle('ok'); await tick();
    h.co.requestSave('A', 200); await tick(); h.calls[1].settle('refuse'); await tick();
    check('5 a refused save says failed for its amount', h.co.statusFor('A', 200) === 'failed' && /refused the save \(403\)/.test(h.co.failureFor('A', 200)));
    check('5 a refusal wrote nothing: the previous verified amount is still recorded', h.co.statusFor('A', 100) === 'recorded' && h.ghl.A === 100);
    h.co.requestSave('A', 150); await tick(); h.calls[2].settle('signin'); await tick();
    check('5 sign-in required is a refusal ("not sent") and changes nothing', h.co.statusFor('A', 150) === 'failed' && /not sent/.test(h.co.failureFor('A', 150)) && h.co.statusFor('A', 100) === 'recorded');
    h.co.requestSave('A', 160); await tick(); h.calls[3].settle('frozen'); await tick();
    check('5 the pre-write "frozen" 409 is a refusal and does not block the deal', h.co.statusFor('A', 160) === 'failed' && !h.co.isLocked('A'));
    h.co.requestSave('A', 300); await tick(); h.calls[4].settle('readback-failed'); await tick();
    check('5 a readback failure after a 200 PUT is "could not be confirmed"', h.co.statusFor('A', 300) === 'unconfirmed' && h.co.failureFor('A', 300) === 'Save could not be confirmed.');
    check('5 after it NOTHING is recorded, but the deal is not blocked', h.co.statusFor('A', 100) === 'draft' && !h.co.isLocked('A'));
    h.co.requestSave('A', 300); await tick();
    h.calls[5].settle('mismatch'); await tick();
    check('5 a later save verifies itself; a disagreeing readback is unconfirmed, never recorded', h.calls.length === 6 && h.co.statusFor('A', 300) === 'unconfirmed');
  }

  // 6 -- INDETERMINATE: every kind blocks the deal; no further submission; queued saves dropped, never released.
  for (const kind of ['network', 'server5xx', 'generic409', 'indeterminate202', '202-readback-failed']) {
    const h = harness();
    h.co.requestSave('A', 100); await tick(); h.calls[0].settle('ok'); await tick();
    h.co.requestSave('A', 410000); await tick();
    h.co.requestSave('A', 420000); await tick();        // queued behind it
    h.calls[1].settle(kind); await tick();
    check(`6 ${kind}: the deal is unresolved and locked, with the message shown`, h.co.statusFor('A', 410000) === 'unresolved' && h.co.isLocked('A') && h.co.unresolvedMessage('A') === UNRESOLVED_SAVE_MESSAGE);
    check(`6 ${kind}: the queued $420k is dropped, never sent`, h.calls.length === 2);
    check(`6 ${kind}: nothing for the deal is "recorded" -- not even the earlier verified amount`, h.co.statusFor('A', 100) === 'unresolved' && h.co.statusFor('A', 420000) === 'unresolved');
    h.co.requestSave('A', 430000); await tick();
    check(`6 ${kind}: a later blur sends nothing`, h.calls.length === 2);
    h.co.seed('A', 410000);
    check(`6 ${kind}: a carrier snapshot (even showing the amount) does not clear it`, h.co.statusFor('A', 410000) === 'unresolved');
    let rejected = null; try { await h.co.saveForAccept('A', 410000); } catch (e) { rejected = e; }
    check(`6 ${kind}: Accept is refused before sending anything`, rejected !== null && h.calls.length === 2 && h.co.beginAccept('A') === false);
    h.co.requestSave('B', 410000); await tick();
    check(`6 ${kind}: another deal is unaffected`, h.calls.length === 3 && h.calls[2].oppId === 'B' && !h.co.isLocked('B'));
  }
  {
    const h = harness();
    h.co.requestSave('A', 410000); await tick();
    const pAccept = h.co.saveForAccept('A', 410000).then(() => 'resolved', (e) => e.message);
    await tick();
    h.calls[0].settle('network'); await tick();
    check('6 an Accept queued behind an indeterminate save is rejected as unresolved, never sent', (await pAccept) === UNRESOLVED_SAVE_MESSAGE && h.calls.length === 1);
  }

  // 7 -- deals are independent (navigation A -> B).
  {
    const h = harness();
    h.co.requestSave('A', 250000); await tick();
    h.co.requestSave('B', 250000); await tick();
    check('7 B\'s save of the same amount is sent while A\'s is in flight', h.calls.length === 2 && h.calls[1].oppId === 'B');
    h.calls[0].settle('ok'); await tick();
    check('7 A\'s completion records A only', h.co.statusFor('A', 250000) === 'recorded' && h.co.statusFor('B', 250000) === 'saving');
    h.calls[1].settle('refuse'); await tick();
    check('7 B\'s refusal is B\'s alone', h.co.statusFor('B', 250000) === 'failed' && h.co.statusFor('A', 250000) === 'recorded');
  }

  // 8 -- Confirm Accept: protected for the whole sequence, through the same queue.
  {
    const h = harness();
    h.co.requestSave('A', 410000); await tick();         // a blur save in flight
    h.co.requestSave('A', 420000); await tick();         // a blur save queued (never sent yet)
    check('8 beginAccept starts the protected sequence', h.co.beginAccept('A') === true && h.co.isLocked('A'));
    let acceptResult = null;
    const p = h.co.saveForAccept('A', 400000).then((r) => { acceptResult = r; });
    await tick();
    check('8 the Accept write waits behind the save already in flight', h.calls.length === 1);
    h.co.requestSave('A', 450000); await tick();
    check('8 a blur during the sequence is ignored (not queued)', h.co.statusFor('A', 450000) === 'draft');
    h.calls[0].settle('ok'); await tick();
    check('8 the queued, never-sent $420k blur was dropped: the next write is the accepted $400k', h.calls.length === 2 && h.calls[1].amount === 400000);
    h.calls[1].settle('ok'); await p;
    check('8 Accept resolves with the write\'s own result and records the accepted amount', acceptResult && acceptResult.ok === true && h.co.statusFor('A', 400000) === 'recorded');
    check('8 still locked through the note and last-touch (until endAccept)', h.co.isLocked('A'));
    h.co.requestSave('A', 460000); await tick();
    check('8 a blur while the note/last-touch run is ignored', h.calls.length === 2);
    h.co.endAccept('A', false);
    await tick();
    check('8 after endAccept nothing ignored during the sequence is replayed', h.calls.length === 2 && !h.co.isLocked('A') && h.ghl.A === 400000);
    check('8 a second beginAccept is refused while one is running', (h.co.beginAccept('A'), h.co.beginAccept('A')) === false);
    h.co.endAccept('A', false);
  }
  {
    const h = harness();
    h.co.beginAccept('A');
    const p = h.co.saveForAccept('A', 400000); await tick();
    h.calls[0].settle('refuse');
    let rejected = null; try { await p; } catch (e) { rejected = e; }
    h.co.endAccept('A', false);
    check('8 a refused Accept write rejects with the write\'s own error and leaves the deal usable', rejected && /PUT → 403/.test(rejected.message) && !h.co.isLocked('A'));
    h.co.beginAccept('A');
    const p2 = h.co.saveForAccept('A', 400000); await tick();
    h.calls[1].settle('mismatch');
    const r2 = await p2; h.co.endAccept('A', false);
    check('8 an unverified Accept write resolves { ok: false } (accept module reports it)', r2.ok === false && h.co.statusFor('A', 400000) === 'unconfirmed');
    h.co.beginAccept('A');
    const p3 = h.co.saveForAccept('A', 400000).then(() => 'resolved', (e) => e.message); await tick();
    h.calls[2].settle('network');
    const r3 = await p3; h.co.endAccept('A', false);
    check('8 an indeterminate Accept write rejects as unresolved and blocks the deal', r3 === UNRESOLVED_SAVE_MESSAGE && h.co.isLocked('A') && h.co.statusFor('A', 400000) === 'unresolved');
  }
  {
    const h = harness();
    h.co.beginAccept('A');
    const p = h.co.saveForAccept('A', 400000); await tick();
    h.calls[0].settle('ok'); await p;
    h.co.endAccept('A', true);                            // the acceptance note's outcome is unknown
    check('8 an unknown acceptance leaves the deal unresolved: locked, nothing recorded', h.co.isLocked('A') && h.co.unresolvedMessage('A') === UNRESOLVED_ACCEPT_MESSAGE && h.co.statusFor('A', 400000) === 'unresolved');
    h.co.requestSave('A', 410000); await tick();
    check('8 and nothing more is sent for that deal', h.calls.length === 1);
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
    h.calls[0].settle('ok'); await tick();
    h.co.beginAccept('A'); h.co.seed('A', 999);
    check('9 a seed during Accept is ignored', h.co.statusFor('A', 310000) === 'recorded');
    h.co.endAccept('A', false);
  }

  console.log(`\nCurrent Offer save coordinator: ${checks - failures}/${checks} checks passed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
