/**
 * B15-27b -- SAME-CONTACT, TWO-DEAL rendered regressions for the two gaps the
 * r2/r3 review requests left open ("deal-bound by source, no two-deal rendered
 * proof"):
 *
 *   O1/O2  the above-Max override (`handleOverrideAndContinue`): deal 1's
 *          override note is in flight while the page moves to deal 2 of the
 *          SAME contact; it then succeeds (O1) or fails (O2). Deal 2 has the
 *          same figures, so a leaked `setNegotiationOverride` would render deal
 *          2 as "Overridden" (isOverrideCurrent matches), and a leaked
 *          `setOverrideActionError` would render inside deal 2's own warning.
 *   R1/R2  the readiness-invalidation RETRY effect: deal 1's approved decision
 *          goes stale (seller price changes), its invalidation note is in
 *          flight while the page moves to deal 2; it then succeeds (R1) or
 *          fails (R2). `invalidationWriteError` is not cleared on a deal
 *          change, so a leaked error would persist on deal 2's readiness panel.
 *
 * Route (the only rendered one on one mounted page -- Seller Call has no
 * in-page deal switcher): A/deal 1 -> hop contact C, pick a deal -> A (picker
 * again) -> pick deal 2. The held write is released only once deal 2's own
 * data is shown, so the CONTACT guard passes and only the DEAL guard decides.
 *
 * Offline: scripts/harness/b15-27b/runner.cjs (unchanged) with
 * scripts/harness/b15-27b/two-deal-fixture.cjs. Nothing leaves the machine.
 *
 * NEGATIVE CONTROLS: --before=108a519 (before B15-27b) must fail O1, O2 and R2;
 * --before=d22499d (override deal-bound, invalidation error contact-bound)
 * must fail R2 only. Test-only: no application file is changed by this suite.
 */
const { run } = require('./harness/b15-27b/runner.cjs');
const { twoDeals } = require('./harness/b15-27b/two-deal-fixture.cjs');

const fixture = twoDeals();
const { A, OPP1, OPP2, C } = fixture;
const ABOVE_MAX = 450000;   // both deals: Max Supported Offer ~$416,830, so above Max
const INVALIDATION = 'IAOS OFFER READINESS DECISION INVALIDATION';
const INJECTED = 'fixture: injected failure';

run({
  title: 'B15-27b same-contact two-deal isolation',
  floor: 24,
  fixture,
  scenarios: async (c) => {
    const { page, check, hold, until, settle, go, fresh, allText } = c;
    const noteWrites = (pred = () => true) => c.log.filter((r) => r.kind === 'write' && r.op === 'note.create' && r.contact === A && pred(String(r.args && r.args.body)));
    // OPP2 ('…-opp-2') contains OPP1 as a prefix: deal 1 is "names OPP1 and not OPP2".
    const deal1 = (b) => b.includes(OPP1) && !b.includes(OPP2);
    const deal2 = (b) => b.includes(OPP2);
    const isOverrideNote = (r) => r.kind === 'write' && r.op === 'note.create' && r.contact === A && !String(r.args.body).includes(INVALIDATION) && /override/i.test(String(r.args.body));
    const isInvalidation = (r) => r.kind === 'write' && r.op === 'note.create' && r.contact === A && String(r.args.body).includes(INVALIDATION);

    const ack = () => page.getByTestId('negotiation-override-acknowledge-checkbox');
    const acknowledged = () => page.getByTestId('negotiation-override-acknowledged');
    const invalidationError = () => page.getByTestId('readiness-invalidation-write-error');

    const pick = async (name) => {
      const btn = page.getByRole('button', { name, exact: true });
      await btn.waitFor({ timeout: 30000 });
      await btn.click();
    };
    /** Deal `name` of A is shown with its own data loaded. */
    const dealLoaded = async (name) => {
      await page.getByTestId('negotiation-current-offer-input').waitFor({ timeout: 30000 });
      await page.getByTestId('offer-readiness-checklist').waitFor({ state: 'attached', timeout: 30000 });
      await until(async () => (await page.getByTestId('negotiation-current-offer-input').inputValue()) === String(ABOVE_MAX)
        && (await ack().count()) + (await acknowledged().count()) > 0, `${name} loaded`);
    };
    const openA = async (name) => { await pick(name); await dealLoaded(name); };
    /** A (any state) -> C, pick C's deal -> A, pick `name`. One mounted page throughout. */
    const hopTo = async (name) => {
      await go(`/contacts/${C}/seller-call`);
      await pick('Charlie deal');
      await until(async () => !(await allText()).includes('Select the deal for this call'), 'Charlie deal selected');
      await go(`/contacts/${A}/seller-call`);
      await openA(name);
    };
    const start = async () => { await fresh({ offer1: ABOVE_MAX, offer2: ABOVE_MAX }, `/contacts/${A}/seller-call`); await openA('Ready deal'); };
    const prepareOverride = async () => {
      await ack().check();
      await page.getByTestId('negotiation-override-reason-input').fill('B15-27b two-deal override reason');
    };
    const approveThenStale = async () => {
      const panel = page.getByTestId('readiness-human-action-panel');
      await panel.waitFor({ timeout: 15000 });
      if (!(await panel.evaluate((el) => el.open))) await panel.locator('summary').first().click();
      await page.getByTestId('readiness-approve-button').click();
      await until(async () => (await page.getByTestId('readiness-human-action-current').count()) > 0, 'approved');
      const price = page.getByTestId('seller-price-position-input');
      await price.fill('431000');
      await price.evaluate((el) => el.blur());
    };

    // ── Fixture sanity: the two deals coincide, and the route reaches deal 2 ──
    await start();
    check('F1 deal 1 is above Max with its override control (not acknowledged)', (await ack().count()) === 1 && (await acknowledged().count()) === 0);
    await hopTo('Ready deal 2');
    check('F2 the same mounted page reaches deal 2 of the same contact, above Max with the same figures', (await ack().count()) === 1 && (await acknowledged().count()) === 0);

    // ── O0 positive: the override on deal 1, without moving ──
    await start();
    await prepareOverride();
    await page.getByTestId('negotiation-action-override-continue').click();
    await until(async () => (await acknowledged().count()) > 0, 'O0 acknowledged').catch(() => {});
    check('O0p same deal: the override is written once, for deal 1, and shown as Overridden', (await acknowledged().count()) === 1
      && c.log.filter((r) => isOverrideNote(r) && r.done).length === 1 && noteWrites(deal1).length === 1);
    await hopTo('Ready deal 2');
    check('O0 deal 1\'s recorded override does not carry to deal 2 (restored per deal from its note)', (await acknowledged().count()) === 0 && (await ack().count()) === 1);

    // ── O1: deal 1's override succeeds while deal 2 is shown ──
    await start();
    await prepareOverride();
    let h = hold(isOverrideNote);
    await page.getByTestId('negotiation-action-override-continue').click();
    await h.hit;
    await hopTo('Ready deal 2');
    check('O1 precondition: deal 2 shown, above Max, not overridden, before deal 1\'s write lands', (await ack().count()) === 1 && (await acknowledged().count()) === 0);
    h.release();
    await until(async () => c.log.some((r) => isOverrideNote(r) && r.done), 'O1 write lands');
    await settle(1000);
    check('O1 deal 1\'s override landing while deal 2 is shown does not mark deal 2 Overridden', (await acknowledged().count()) === 0);
    check('O1 deal 2 still requires its own acknowledgement (its warning is up)', (await ack().count()) === 1);
    check('O1 exactly one override note, naming deal 1 and not deal 2', c.log.filter(isOverrideNote).length === 1
      && String(c.log.find(isOverrideNote).args.body).includes(OPP1) && !String(c.log.find(isOverrideNote).args.body).includes(OPP2));
    await hopTo('Ready deal');
    check('O1 back on deal 1, its override is in effect (restored from its note)', (await acknowledged().count()) === 1);
    check('O1 nothing was re-sent', c.log.filter(isOverrideNote).length === 1);

    // ── O2: deal 1's override fails while deal 2 is shown ──
    await start();
    await prepareOverride();
    h = hold(isOverrideNote); c.failNext.push(isOverrideNote);
    await page.getByTestId('negotiation-action-override-continue').click();
    await h.hit;
    await hopTo('Ready deal 2');
    h.release();
    await until(async () => c.log.some((r) => isOverrideNote(r) && r.status === 500), 'O2 failure lands');
    await settle(1000);
    const o2Text = await allText();
    check('O2 deal 1\'s failed override shows no error on deal 2', !o2Text.includes(INJECTED) && !/Couldn't record this override/.test(o2Text), o2Text.split('\n').filter((l) => /fail|couldn/i.test(l)).slice(0, 3));
    check('O2 deal 2 is unchanged: warning up, not overridden', (await ack().count()) === 1 && (await acknowledged().count()) === 0);
    await hopTo('Ready deal');
    check('O2 back on deal 1, the override is not in effect (its write failed)', (await acknowledged().count()) === 0 && (await ack().count()) === 1);
    check('O2 one override attempt in all, nothing written for deal 2', c.log.filter(isOverrideNote).length === 1 && noteWrites(deal2).length === 0);

    // ── R0 positive: the invalidation retry on deal 1, without moving ──
    await start();
    await approveThenStale();
    await until(async () => c.log.some((r) => isInvalidation(r) && r.done), 'R0 invalidation').catch(() => {});
    await settle(600);
    check('R0p same deal: a stale decision writes one invalidation note for deal 1', c.log.filter(isInvalidation).length === 1
      && String(c.log.find(isInvalidation).args.body).includes(OPP1));

    // ── R1: deal 1's invalidation succeeds while deal 2 is shown ──
    await start();
    h = hold(isInvalidation);
    await approveThenStale();
    await h.hit;
    await hopTo('Ready deal 2');
    check('R1 precondition: deal 2 shown, with no decision of its own', (await page.getByTestId('readiness-human-action-current').count()) === 0);
    h.release();
    await until(async () => c.log.some((r) => isInvalidation(r) && r.done), 'R1 invalidation lands');
    await settle(1000);
    check('R1 deal 2 shows no invalidation error and no stale decision', (await invalidationError().count()) === 0
      && (await page.getByTestId('readiness-human-action-stale').count()) === 0 && (await page.getByTestId('readiness-human-action-current').count()) === 0);
    check('R1 the invalidation names deal 1, not deal 2', String(c.log.find(isInvalidation).args.body).includes(OPP1) && !String(c.log.find(isInvalidation).args.body).includes(OPP2));
    await hopTo('Ready deal');
    await settle(800);
    check('R1 back on deal 1, its decision reads STALE', (await page.getByTestId('readiness-human-action-stale').count()) === 1);
    check('R1 the invalidation was written once (not re-sent on return)', c.log.filter(isInvalidation).length === 1);

    // ── R2: deal 1's invalidation fails while deal 2 is shown ──
    await start();
    h = hold(isInvalidation); c.failNext.push(isInvalidation);
    await approveThenStale();
    await h.hit;
    await hopTo('Ready deal 2');
    h.release();
    await until(async () => c.log.some((r) => isInvalidation(r) && r.status === 500), 'R2 invalidation fails');
    await settle(1000);
    check('R2 deal 1\'s failed invalidation shows no error on deal 2', (await invalidationError().count()) === 0 && !(await allText()).includes(INJECTED));
    check('R2 deal 2 is not retried and nothing names deal 2', c.log.filter(isInvalidation).length === 1 && noteWrites(deal2).length === 0);
    await settle(1200);
    check('R2 the error still has not reached deal 2 after a further wait', (await invalidationError().count()) === 0);
    await hopTo('Ready deal');
    await until(async () => c.log.some((r) => isInvalidation(r) && r.status === 200), 'R2 retry on deal 1').catch(() => {});
    await settle(800);
    check('R2 back on deal 1, the retry writes its invalidation once, for deal 1', c.log.filter((r) => isInvalidation(r) && r.status === 200).length === 1
      && c.log.filter(isInvalidation).every((r) => String(r.args.body).includes(OPP1)));
    check('R2 deal 1 shows no lingering error after its successful retry', (await invalidationError().count()) === 0);
  },
});
