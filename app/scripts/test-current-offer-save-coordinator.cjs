/**
 * PR #126 (Bones / Jess, 2026-10-05) -- the per-deal Current Offer save
 * coordinator (lib/current-offer-save-coordinator.ts), driven directly.
 *
 * Offline, no browser. The injected `write` is a fake whose every call is
 * held until the test settles it, so every completion order and failure
 * class can be forced. Covered:
 *   - per-deal serialization, blur coalescing and de-dupe, both orders;
 *   - classification by PROOF (stacked server PR, Jess: an HTTP error alone
 *     is not proof nothing was written): confirmed; refused only on the
 *     server's outcome "not_sent", sign-in before sending, or local
 *     validation; everything else -- any other HTTP error, no response,
 *     indeterminate, a readback that failed or did not verify -- blocks;
 *   - UNRESOLVED: no further submission (blur or Accept), queued saves
 *     dropped and never released, nothing "recorded", a carrier snapshot does
 *     not clear it, the server's durable barrier (OfferSaveBlocked,
 *     markUnresolved) blocks with its own message, and only the server's
 *     evidence-based "Check again" (clearUnresolved) clears it; no message
 *     tells the operator to reload;
 *   - Confirm Accept: whenIdle waits for a save in flight; protected for the
 *     whole sequence; through the same queue with its reserved request id;
 *     the server's reconcile decides the end state;
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
const { createOfferSaveCoordinator, classifyOfferWriteError, classifyOfferWriteResult, OfferSaveBlocked, UNRESOLVED_SAVE_MESSAGE, UNRESOLVED_ACCEPT_MESSAGE } = require(path.join(LIB, 'current-offer-save-coordinator.ts'));
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
const NOT_SENT = (status, error) => new Error(`setCurrentOffer PUT → ${status}: ${JSON.stringify({ error, outcome: 'not_sent' })}`);

function harness() {
  const ghl = {};
  const calls = [];
  const write = (oppId, amount, requestId) => new Promise((resolve, reject) => {
    const c = {
      oppId, amount, requestId, done: false,
      settle(kind) {
        c.done = true;
        switch (kind) {
          case 'ok': ghl[oppId] = amount; return resolve({ ok: true, putStatus: 200 });
          case 'not_sent': return reject(NOT_SENT(409, 'No Current Offer reservation for this save; nothing was sent'));
          case 'frozen': return reject(NOT_SENT(409, 'Current Offer is frozen or invalid'));
          case 'signin': return reject(new AppWriteSignInRequired('Sign in for application writes before saving. Your edits have not been submitted.'));
          case 'blocked': return reject(new OfferSaveBlocked('Unresolved — the Current Offer save may still reach GHL. (server)'));
          case 'forbidden': return reject(new Error('setCurrentOffer PUT → 403: {"error":"Production write refused by the proof write scope"}'));
          case 'mismatch': ghl[oppId] = amount; return resolve({ ok: false, putStatus: 200 });
          case 'readback-failed': ghl[oppId] = amount; return reject(withPutStatus(new Error('setCurrentOffer readback → 500: x'), 200));
          case 'network': return reject(new TypeError('Failed to fetch'));
          case 'server5xx': return reject(new Error('setCurrentOffer PUT → 502: bad gateway'));
          case 'generic409': return reject(new Error('setCurrentOffer PUT → 409: {"error":"Write refused or unconfirmed; refresh and inspect before retrying"}'));
          case 'indeterminate202': ghl[oppId] = amount; return resolve({ ok: true, putStatus: 202 });
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
  // classification -- by what is PROVEN about the request
  check('the server\'s outcome "not_sent" is a refusal (any status)', classifyOfferWriteError(NOT_SENT(409, 'x')) === 'refused' && classifyOfferWriteError(NOT_SENT(403, 'x')) === 'refused');
  check('sign-in required (thrown before sending) is a refusal', classifyOfferWriteError(new AppWriteSignInRequired('Sign in for application writes before saving.')) === 'refused');
  check('a local validation error (nothing sent) is a refusal', classifyOfferWriteError(new Error('setCurrentOffer: value must be a positive finite number')) === 'refused');
  check('an HTTP error alone is NOT proof: a bare 403, 400 or generic 409 blocks', ['403', '400', '409'].every((st) => classifyOfferWriteError(new Error(`setCurrentOffer PUT → ${st}: {"error":"x"}`)) === 'indeterminate'));
  check('a 5xx and a network failure block', classifyOfferWriteError(new Error('setCurrentOffer PUT → 502: x')) === 'indeterminate' && classifyOfferWriteError(new TypeError('Failed to fetch')) === 'indeterminate');
  check('a readback failure after the PUT blocks', classifyOfferWriteError(withPutStatus(new Error('setCurrentOffer readback → 500: x'), 200)) === 'indeterminate');
  check('a 202 blocks even when the snapshot readback matches; a 200 that did not verify blocks', classifyOfferWriteResult({ ok: true, putStatus: 202 }) === 'indeterminate' && classifyOfferWriteResult({ ok: false, putStatus: 200 }) === 'indeterminate');
  check('a verified 200 is confirmed', classifyOfferWriteResult({ ok: true, putStatus: 200 }) === 'confirmed');
  check('no unresolved message tells the operator to reload or to check GHL themselves', ![UNRESOLVED_SAVE_MESSAGE, UNRESOLVED_ACCEPT_MESSAGE].some((m) => /[Rr]eload|[Cc]heck the deal in GHL/.test(m)) && [UNRESOLVED_SAVE_MESSAGE, UNRESOLVED_ACCEPT_MESSAGE].every((m) => /Check again/.test(m)));

  // 1 -- a single save
  {
    const h = harness();
    check('1 nothing typed is a draft', h.co.statusFor('A', 100) === 'draft');
    h.co.requestSave('A', 100); await tick();
    check('1 a save in flight is "saving"; a blur save carries no reserved id (the write reserves it)', h.co.statusFor('A', 100) === 'saving' && h.open('A').length === 1 && h.calls[0].requestId === undefined);
    h.open('A')[0].settle('ok'); await tick();
    check('1 a verified save is "recorded"', h.co.statusFor('A', 100) === 'recorded');
    h.co.requestSave('A', 100); await tick();
    check('1 blurring the verified amount again sends nothing', h.calls.length === 1);
    check('1 subscribers are told about each change', h.changes() >= 2);
  }

  // 2 -- serialization; 3 -- coalescing; 4 -- the corrective save.
  {
    const h = harness();
    h.co.requestSave('A', 410000); await tick();
    h.co.requestSave('A', 420000); await tick();
    check('2 while $410k is in flight, $420k is NOT sent', h.calls.length === 1 && h.co.statusFor('A', 420000) === 'saving');
    h.calls[0].settle('ok'); await tick();
    check('2 after $410k settles, $420k is sent; nothing is recorded meanwhile', h.calls.length === 2 && h.co.statusFor('A', 410000) === 'draft');
    h.calls[1].settle('ok'); await tick();
    check('2 $420k is recorded only after its own readback', h.co.statusFor('A', 420000) === 'recorded' && h.ghl.A === 420000);
  }
  {
    const h = harness();
    h.co.requestSave('A', 410000); h.co.requestSave('A', 420000); h.co.requestSave('A', 430000); await tick();
    h.calls[0].settle('ok'); await tick();
    check('3 the replaced middle amount is never sent', h.calls.length === 2 && h.calls[1].amount === 430000);
    h.calls[1].settle('ok'); await tick();
    check('3 the latest amount is recorded', h.co.statusFor('A', 430000) === 'recorded');
  }
  {
    const h = harness();
    h.co.requestSave('A', 310000); await tick(); h.calls[0].settle('ok'); await tick();
    h.co.requestSave('A', 320000); await tick();
    h.co.requestSave('A', 310000); await tick();
    h.calls[1].settle('ok'); await tick(); h.calls[2].settle('ok'); await tick();
    check('4 the corrective $310k is written after $320k and recorded', h.calls.map((c) => c.amount).join() === '310000,320000,310000' && h.co.statusFor('A', 310000) === 'recorded');
  }

  // 5 -- proven refusals do not block; everything else does.
  for (const kind of ['not_sent', 'frozen', 'signin']) {
    const h = harness();
    h.co.requestSave('A', 100); await tick(); h.calls[0].settle('ok'); await tick();
    h.co.requestSave('A', 200); await tick(); h.calls[1].settle(kind); await tick();
    check(`5 ${kind}: refused -- "Not saved", the previous verified amount stands, the deal is NOT blocked`, h.co.statusFor('A', 200) === 'failed' && /^Not saved — /.test(h.co.failureFor('A', 200)) && h.co.statusFor('A', 100) === 'recorded' && !h.co.isLocked('A'));
  }
  for (const kind of ['forbidden', 'generic409', 'server5xx', 'network', 'indeterminate202', 'mismatch', 'readback-failed']) {
    const h = harness();
    h.co.requestSave('A', 100); await tick(); h.calls[0].settle('ok'); await tick();
    h.co.requestSave('A', 410000); await tick();
    h.co.requestSave('A', 420000); await tick();
    h.calls[1].settle(kind); await tick();
    check(`6 ${kind}: unresolved and locked, queued $420k dropped, nothing recorded`, h.co.statusFor('A', 410000) === 'unresolved' && h.co.isLocked('A') && h.calls.length === 2 && h.co.statusFor('A', 100) === 'unresolved' && h.co.unresolvedMessage('A') === UNRESOLVED_SAVE_MESSAGE);
    h.co.requestSave('A', 430000); await tick();
    h.co.seed('A', 410000);
    let rejected = null; try { await h.co.saveForAccept('A', 410000, 'acc-offer-0001'); } catch (e) { rejected = e; }
    check(`6 ${kind}: no blur, no Accept, a snapshot does not clear it`, h.calls.length === 2 && rejected !== null && h.co.beginAccept('A') === false && h.co.statusFor('A', 410000) === 'unresolved');
    h.co.requestSave('B', 410000); await tick();
    check(`6 ${kind}: another deal is unaffected`, h.calls.length === 3 && h.calls[2].oppId === 'B');
  }

  // 7 -- the durable barrier from the server.
  {
    const h = harness();
    h.co.requestSave('A', 410000); await tick();
    h.calls[0].settle('blocked'); await tick();
    check('7 a reservation the server refuses blocks with the server\'s own message, nothing sent', h.co.isLocked('A') && /\(server\)/.test(h.co.unresolvedMessage('A')));
    h.co.markUnresolved('A', 'Unresolved — the Current Offer save may still reach GHL. (status)');
    check('7 a later status read updates the message', /\(status\)/.test(h.co.unresolvedMessage('A')));
    h.co.clearUnresolved('A');
    check('7 only "Check again" (clearUnresolved) clears it; afterwards nothing is assumed recorded', !h.co.isLocked('A') && h.co.statusFor('A', 410000) === 'draft');
    h.co.requestSave('A', 410000); await tick();
    check('7 and the next blur is sent', h.calls.length === 2);
  }
  {
    const h = harness();
    h.co.markUnresolved('A', 'Blocked by another browser.');
    h.co.requestSave('A', 100); await tick();
    check('7 a status-read block (another browser, a reload) stops every submission', h.calls.length === 0 && h.co.statusFor('A', 100) === 'unresolved');
  }
  {
    const h = harness();
    h.co.requestSave('A', 100); await tick();
    h.co.markUnresolved('A', 'own barrier');
    check('7 a status read is ignored while this tab\'s own save holds the barrier', !h.co.isLocked('A') && h.co.statusFor('A', 100) === 'saving');
    h.calls[0].settle('ok'); await tick();
    h.co.requestSave('A', 200); await tick();
    h.co.clearUnresolved('A');
    check('7 clearUnresolved never interrupts a save in flight', h.co.statusFor('A', 200) === 'saving');
  }

  // 8 -- Confirm Accept.
  {
    const h = harness();
    h.co.requestSave('A', 410000); await tick();          // a blur save in flight
    h.co.requestSave('A', 420000); await tick();          // a blur save queued
    check('8 beginAccept locks the deal', h.co.beginAccept('A') === true && h.co.isLocked('A'));
    let idle = false;
    const w = h.co.whenIdle('A').then(() => { idle = true; });
    await tick();
    check('8 whenIdle waits for the save in flight (the queued blur was dropped)', idle === false && h.calls.length === 1);
    h.calls[0].settle('ok'); await w;
    check('8 ...and resolves once it settles, with nothing else sent', idle === true && h.calls.length === 1);
    let acceptResult = null;
    const p = h.co.saveForAccept('A', 400000, 'acc-offer-0001').then((r) => { acceptResult = r; });
    await tick();
    check('8 the accept write carries its reserved request id', h.calls.length === 2 && h.calls[1].amount === 400000 && h.calls[1].requestId === 'acc-offer-0001');
    h.co.requestSave('A', 450000); await tick();
    check('8 a blur during the sequence is ignored', h.co.statusFor('A', 450000) === 'draft');
    h.calls[1].settle('ok'); await p;
    check('8 Accept resolves with the write\'s result and records the accepted amount', acceptResult && acceptResult.ok === true && h.co.statusFor('A', 400000) === 'recorded');
    check('8 still locked through the note and last-touch', h.co.isLocked('A'));
    h.co.endAccept('A', null); await tick();
    check('8 the server proved every step: unlocked, nothing replayed', !h.co.isLocked('A') && h.calls.length === 2);
  }
  {
    const h = harness();
    h.co.beginAccept('A');
    await h.co.whenIdle('A');
    const p = h.co.saveForAccept('A', 400000, 'acc-offer-0002'); await tick();
    h.calls[0].settle('ok'); await p;
    h.co.endAccept('A', 'Unresolved — the acceptance note may still reach GHL. (server)');
    check('8 the server could not prove a step: the deal stays unresolved with the server\'s message', h.co.isLocked('A') && /acceptance note/.test(h.co.unresolvedMessage('A')) && h.co.statusFor('A', 400000) === 'unresolved');
  }
  {
    const h = harness();
    h.co.requestSave('A', 410000); await tick();
    h.co.beginAccept('A');
    const w = h.co.whenIdle('A');
    h.calls[0].settle('network'); await w;
    check('8 whenIdle also resolves when the save in flight ended unresolved (Accept then stops)', h.co.unresolvedMessage('A') === UNRESOLVED_SAVE_MESSAGE);
    let rejected = null; try { await h.co.saveForAccept('A', 400000, 'acc-offer-0003'); } catch (e) { rejected = e; }
    check('8 ...and the Accept write is refused before sending', rejected !== null && h.calls.length === 1);
  }
  {
    const h = harness();
    h.co.beginAccept('A');
    const p3 = h.co.saveForAccept('A', 400000, 'acc-offer-0004').then(() => 'resolved', (e) => e.message); await tick();
    h.calls[0].settle('not_sent');
    const r3 = await p3;
    check('8 a not_sent Accept write rejects with the server\'s refusal (the accept module reports it); not blocked by itself', /not_sent/.test(r3) && h.co.unresolvedMessage('A') === null);
  }

  // 9 -- seeding; 10 -- independent deals.
  {
    const h = harness();
    h.co.seed('A', 300000);
    check('9 a restored carrier amount is recorded', h.co.statusFor('A', 300000) === 'recorded');
    h.co.requestSave('A', 300000); await tick();
    check('9 blurring it unchanged sends nothing', h.calls.length === 0);
    h.co.requestSave('A', 310000); await tick();
    h.co.seed('A', 300000);
    check('9 a seed while a save is pending is ignored', h.co.statusFor('A', 310000) === 'saving');
  }
  {
    const h = harness();
    h.co.requestSave('A', 250000); await tick();
    h.co.requestSave('B', 250000); await tick();
    check('10 deals are independent', h.calls.length === 2 && h.calls[1].oppId === 'B');
  }

  console.log(`\nCurrent Offer save coordinator: ${checks - failures}/${checks} checks passed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
