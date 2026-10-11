/**
 * B14-13 (Brad, 2026-10-11) -- a definitive refusal of a blur Current Offer
 * save releases the page's own reservation.
 *
 * Production showed "Current Offer 400000: unresolved -- Check again" after the
 * write scope refused the save before sending anything. The server now answers
 * that refusal with outcome "not_sent" (test-production-write-scope.cjs), and
 * the page's `saveCurrentOfferReserved` (SellerCallWorkspace.tsx) reconciles
 * the reservation it took for that save, so the deal is not left blocked.
 *
 * Offline, no browser. The REAL function is extracted from the page source and
 * run with fake network calls, alone and through the REAL save coordinator.
 * Covered:
 *   - a refused save (server not_sent, local validation, sign-in) reconciles
 *     the reservation once and re-throws the original error unchanged;
 *   - an indeterminate failure (any other HTTP error, no response) does NOT
 *     reconcile -- the barrier must stay;
 *   - success, a blocked reservation, and Accept's own reserved id never
 *     reconcile here;
 *   - a failed reconcile never masks the refusal;
 *   - through the coordinator: "failed" with "Not saved -- ...", never
 *     "unresolved".
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
require('./harness/ts-loader.cjs');
const ts = require('typescript');

const APP = path.resolve(__dirname, '..');
const coordinator = require(path.join(APP, 'src/lib/current-offer-save-coordinator.ts'));
const { AppWriteSignInRequired } = require(path.join(APP, 'src/lib/app-write-session.ts'));

let checks = 0, failures = 0;
async function check(name, fn) {
  checks++;
  try { await fn(); console.log('PASS ' + name); }
  catch (e) { failures++; console.log('FAIL ' + name + '\n  ' + (e && e.stack || e)); }
}

// ---- Extract the real function from the page.
const PAGE = fs.readFileSync(path.join(APP, 'src/pages/SellerCallWorkspace.tsx'), 'utf8').replace(/\r\n/g, '\n');
const start = PAGE.indexOf('async function saveCurrentOfferReserved(');
const end = PAGE.indexOf('\n}\n', start);
assert.ok(start > 0 && end > start, 'saveCurrentOfferReserved found in the page');
const SOURCE = PAGE.slice(start, end + 2);
const JS = ts.transpileModule(SOURCE, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

const OPP = 'offline-opp';
const SCOPE_403 = `setCurrentOffer PUT → 403: ${JSON.stringify({ outcome: 'not_sent', error: 'Production write refused by the proof write scope', by: 'iaos-production-write-scope', code: 'OPERATION_NOT_PERMITTED' })}`;

/** Builds the function with fakes; `log` records every call in order. */
function build({ reserve = { state: 'reserved' }, write, reconcile = async () => ({ state: 'clear' }) }) {
  const log = [];
  const deps = {
    ghl: { opportunities: { setCurrentOffer: async (opp, amount, opts) => { log.push(['write', opp, amount, opts && opts.requestId]); return write(opp, amount, opts); } } },
    newRequestIds: (steps) => Object.fromEntries(steps.map((s) => [s, `rid-${s}`])),
    beginReservation: async (opp, purpose, steps) => { log.push(['begin', opp, purpose, steps.map((s) => s.requestId).join(',')]); if (reserve instanceof Error) throw reserve; return reserve; },
    reconcileReservation: async (opp) => { log.push(['reconcile', opp]); return reconcile(opp); },
    classifyOfferWriteError: coordinator.classifyOfferWriteError,
    OfferSaveBlocked: coordinator.OfferSaveBlocked,
    AppWriteSignInRequired,
    RESERVATION_FAILED_MESSAGE: 'reservation failed (offline)',
  };
  const fn = new Function(...Object.keys(deps), `${JS}\nreturn saveCurrentOfferReserved;`)(...Object.values(deps));
  return { fn, log };
}
const reconciles = (log) => log.filter((e) => e[0] === 'reconcile');

(async () => {
  await check('source: the refused-save release reconciles only on a "refused" classification, then re-throws', () => {
    assert.ok(/if \(classifyOfferWriteError\(e\) === "refused"\) \{\s*try \{ await reconcileReservation\(oppId\); \} catch \{[^}]*\}\s*\}\s*throw e;/.test(SOURCE), SOURCE);
  });

  await check('Production scope refusal (403, outcome "not_sent"): reserved, sent once, reconciled once for the same deal, original error re-thrown', async () => {
    const original = new Error(SCOPE_403);
    const { fn, log } = build({ write: async () => { throw original; } });
    await assert.rejects(fn(OPP, 400000), (e) => e === original);
    assert.deepEqual(log, [['begin', OPP, 'blur', 'rid-offer'], ['write', OPP, 400000, 'rid-offer'], ['reconcile', OPP]]);
  });

  for (const [label, err] of [
    ['local validation (nothing sent)', new Error('setCurrentOffer: value must be a positive finite number')],
    ['sign-in required before sending', new AppWriteSignInRequired('Sign in for application writes')],
    ['any other not_sent refusal (frozen)', new Error(`setCurrentOffer PUT → 409: ${JSON.stringify({ outcome: 'not_sent', error: 'Current Offer is frozen or invalid' })}`)],
  ]) {
    await check(`refused -- ${label}: reconciled once, error re-thrown`, async () => {
      const { fn, log } = build({ write: async () => { throw err; } });
      await assert.rejects(fn(OPP, 400000), (e) => e === err);
      assert.equal(reconciles(log).length, 1);
    });
  }

  for (const [label, err] of [
    ['indeterminate 409', new Error(`setCurrentOffer PUT → 409: ${JSON.stringify({ outcome: 'indeterminate', error: 'The save may have reached GHL' })}`)],
    ['500 with no outcome', new Error('setCurrentOffer PUT → 500: {"error":"boom"}')],
    ['the old Production refusal body (no outcome)', new Error('setCurrentOffer PUT → 403: {"error":"Production write refused by the proof write scope","by":"iaos-production-write-scope","code":"OPERATION_NOT_PERMITTED"}')],
    ['no response', new TypeError('Failed to fetch')],
    ['readback failed', new Error('setCurrentOffer readback failed after PUT 200')],
  ]) {
    await check(`not proven unsent -- ${label}: NOT reconciled (the barrier stays), error re-thrown`, async () => {
      const { fn, log } = build({ write: async () => { throw err; } });
      await assert.rejects(fn(OPP, 400000), (e) => e === err);
      assert.equal(reconciles(log).length, 0);
    });
  }

  await check('success: no reconcile here (the server releases a confirmed save itself)', async () => {
    const { fn, log } = build({ write: async () => ({ ok: true, putStatus: 200 }) });
    assert.deepEqual(await fn(OPP, 400000), { ok: true, putStatus: 200 });
    assert.equal(reconciles(log).length, 0);
  });

  await check('blocked reservation: nothing written, nothing reconciled, OfferSaveBlocked with the server message', async () => {
    const { fn, log } = build({ reserve: { state: 'blocked', message: 'held elsewhere' }, write: async () => { throw new Error('must not write'); } });
    await assert.rejects(fn(OPP, 400000), (e) => e instanceof coordinator.OfferSaveBlocked && e.message === 'held elsewhere');
    assert.deepEqual(log.map((e) => e[0]), ['begin']);
  });

  await check("Accept's reserved id: no reservation and no reconcile here (Accept reconciles its own barrier)", async () => {
    const original = new Error(SCOPE_403);
    const { fn, log } = build({ write: async () => { throw original; } });
    await assert.rejects(fn(OPP, 190000, 'accept-offer-id'), (e) => e === original);
    assert.deepEqual(log, [['write', OPP, 190000, 'accept-offer-id']]);
  });

  for (const [label, reconcile] of [['throws', async () => { throw new Error('check failed'); }], ['stays blocked', async () => ({ state: 'blocked', message: 'x' })]]) {
    await check(`reconcile ${label}: the original refusal is still what the caller sees`, async () => {
      const original = new Error(SCOPE_403);
      const { fn } = build({ write: async () => { throw original; }, reconcile });
      await assert.rejects(fn(OPP, 400000), (e) => e === original);
    });
  }

  await check('through the real coordinator: a Production scope refusal is "failed" with "Not saved -- Production write refused ...", never "unresolved"; the deal accepts the next save', async () => {
    let n = 0;
    const { fn, log } = build({ write: async () => { n++; if (n === 1) throw new Error(SCOPE_403); return { ok: true, putStatus: 200 }; } });
    const c = coordinator.createOfferSaveCoordinator(fn);
    c.requestSave(OPP, 400000);
    await c.whenIdle(OPP);
    assert.equal(c.statusFor(OPP, 400000), 'failed');
    assert.equal(c.unresolvedMessage(OPP), null);
    assert.equal(c.failureFor(OPP, 400000), 'Not saved — Production write refused by the proof write scope');
    assert.equal(reconciles(log).length, 1);
    c.requestSave(OPP, 410000);
    await c.whenIdle(OPP);
    assert.equal(c.statusFor(OPP, 410000), 'recorded');
  });

  await check('through the real coordinator: an indeterminate failure still makes the deal unresolved (unchanged)', async () => {
    const { fn, log } = build({ write: async () => { throw new Error('setCurrentOffer PUT → 500: {"error":"boom"}'); } });
    const c = coordinator.createOfferSaveCoordinator(fn);
    c.requestSave(OPP, 400000);
    await c.whenIdle(OPP);
    assert.equal(c.statusFor(OPP, 400000), 'unresolved');
    assert.equal(reconciles(log).length, 0);
  });

  console.log(`current-offer-refusal-release checks=${checks} failures=${failures}`);
  process.exitCode = failures ? 1 : 0;
})();
