/**
 * B15-27b P3 + P4 -- Seller Call: Seller A's Accept timestamp recovery can never
 * start a reservation or a write against Seller B, and a delayed note append
 * (or error) for A never lands on B.
 *
 * Offline, rendered (scripts/harness/b15-27b/runner.cjs, fixture readyPlusB):
 * contact A is the Offer Ready deal (Confirm Accept genuinely enabled, the real
 * durable barrier); contact B ("Bravo") is a plain contact with its own deal,
 * whose writes are APPLIED and logged, so a write against the wrong contact is
 * visible.
 *
 *   R1  wrong contact (P3): A's Accept records the agreement but its last
 *       touch is refused before sending, so A's recovery is offered. On B no
 *       recovery is offered; if any is shown it is pressed, as an operator
 *       would. Nothing is reserved for B's deal and nothing is written to B.
 *       Back on A the recovery is still offered, and it writes A's timestamp
 *       to A, once.
 *   R2  A's recovery is in flight when the page moves to B, and fails: B shows
 *       no message from it.
 *   R3-R6 (P4): A's property-identity withdrawal, readiness approval, Contract
 *       Ready item and above-Max override are each written while the page
 *       moves to B: A's note never appears in B's Notes list, and a failure
 *       shows no error on B. Each writes exactly one note, for A.
 *   P*  the same actions on A, without navigating: the note is shown on A
 *       (unchanged), and the recovery works.
 *
 * NEGATIVE CONTROLS: --before=<P1 commit> and --before=108a519 / 16bcf12 render
 * the pages without P3/P4 and must fail R1-R6.
 */
const { run, readyPlusB } = require('./harness/b15-27b/runner.cjs');

const fixture = readyPlusB();
run({
  title: 'B15-27b P3+P4 Seller Call',
  floor: 34,
  fixture,
  scenarios: async (c) => {
    const { page, check, hold, isWrite, holdThenFail, opsFor, writes, doneWrites, text, allText, settle, until, go, fresh } = c;
    const RA = fixture.A, RA_OPP = fixture.A_OPP, B = fixture.B, B_OPP = fixture.B_OPP;
    const MARK = RA_OPP;   // every IAOS record A writes names A's opportunity
    const INJECTED = 'fixture: injected failure';
    const openA = async () => {
      await page.getByTestId('negotiation-current-offer-input').waitFor({ timeout: 30000 });
      await page.getByTestId('offer-readiness-checklist').waitFor({ state: 'attached', timeout: 30000 });
    };
    const freshA = async (opts = { currentOffer: 400000 }) => { await fresh(opts, `/contacts/${RA}/seller-call`); await openA(); };
    const bLoaded = () => until(async () => (await text()).includes('Bravo deal'), 'Bravo Seller Call');
    const toB = async () => { await go(`/contacts/${B}/seller-call`); await bLoaded(); };
    const toA = async () => { await go(`/contacts/${RA}/seller-call`); await openA(); };
    const notesText = async () => {
      if ((await page.getByTestId('seller-call-notes-panel').count()) === 0) await page.getByTestId('seller-call-notes-toggle').click();
      await until(async () => (await page.getByTestId('seller-call-notes-list').count()) + (await page.getByTestId('seller-call-notes-empty').count()) > 0, 'notes panel');
      return (await page.getByTestId('seller-call-notes-panel').textContent()) || '';
    };
    const recover = () => page.getByTestId('call-timestamp-recover');
    const acceptToggle = () => page.getByTestId('call-outcome-accept-toggle');
    const acceptConfirm = () => page.getByTestId('call-outcome-accept-confirm');
    const accept = async () => {
      if (!(await acceptConfirm().count())) await acceptToggle().click();
      await acceptConfirm().waitFor({ timeout: 5000 });
      await acceptConfirm().click();
      await until(async () => (await page.getByTestId('call-outcome-accept-recorded').count()) > 0, 'Agreement Reached').catch(async (e) => { const el = page.getByTestId('call-outcome-error'); throw new Error(e.message + ' | ' + ((await el.count()) ? await el.innerText() : 'no error shown') + ' | ' + JSON.stringify(c.log.filter((r) => r.kind === 'write').map((r) => [r.op, r.status]))); });
    };
    const bTouched = () => writes(B).length > 0 || writes(B_OPP).length > 0
      || c.log.some((r) => r.kind === 'current-offer-barrier' && r.post && JSON.stringify(r.post).includes(B_OPP));

    // ── P3 ─────────────────────────────────────────────────────────────────
    // R1 — A's recovery state while B is shown.
    await freshA();
    c.refuseNext.push(isWrite('contact.lastCallAttempt', RA));
    await accept();
    await until(async () => (await recover().count()) > 0, 'A recovery offered');
    check('P3a A: Agreement Reached with the timestamp-only recovery offered (unchanged)', (await recover().count()) === 1);
    const touchesA0 = c.log.filter((r) => r.kind === 'write' && r.op === 'contact.lastCallAttempt' && r.contact === RA).length;
    await toB();
    await settle(600);
    const shownOnB = await recover().count();
    check('R1 on B, A\'s timestamp recovery is not offered', shownOnB === 0, { shownOnB });
    if (shownOnB > 0) { await recover().first().click().catch(() => {}); await settle(2000); }
    check('R1 nothing is reserved for B\'s deal and nothing is written to B', !bTouched(), { bWrites: opsFor(B), bState: fixture.b.fields });
    check('R1 B\'s last-call time is untouched', fixture.b.fields.length === 0, fixture.b.fields);
    await toA();
    await until(async () => (await recover().count()) > 0, 'A recovery again').catch(() => {});
    check('R1 back on A, A\'s recovery is offered again', (await recover().count()) === 1);
    if ((await recover().count()) > 0) await recover().click();   // conditional, so a negative control runs on
    await until(async () => (await recover().count()) === 0, 'A recovered').catch(() => {});
    await settle(600);
    const touchesA = c.log.filter((r) => r.kind === 'write' && r.op === 'contact.lastCallAttempt' && r.contact === RA);
    check('P3b A\'s recovery writes A\'s timestamp to A, once', touchesA.length === touchesA0 + 1 && (await recover().count()) === 0, { before: touchesA0, after: touchesA.length });
    check('R1 still nothing written to B', !bTouched(), opsFor(B));

    // R2 — A's recovery in flight at A -> B, and its write fails: no message on B.
    await freshA();
    c.refuseNext.push(isWrite('contact.lastCallAttempt', RA));
    await accept();
    await until(async () => (await recover().count()) > 0, 'R2 recovery offered');
    let h = holdThenFail('contact.lastCallAttempt', RA);
    await recover().click();
    await h.hit;
    await toB();
    h.release();
    await until(async () => c.log.filter((r) => r.kind === 'write' && r.op === 'contact.lastCallAttempt' && r.contact === RA && r.done).length >= 1, 'R2 failure lands');
    await settle(1200);
    check('R2 A\'s failed recovery shows no message on B', (await page.getByTestId('call-outcome-error').count()) === 0 && !(await text()).includes(INJECTED));
    check('R2 and offers no recovery on B; nothing written to B', (await recover().count()) === 0 && !bTouched());
    await toA();
    await until(async () => (await recover().count()) > 0, 'R2 A recovery kept').catch(() => {});
    check('R2 back on A, A\'s recovery is still offered (its timestamp is still unconfirmed)', (await recover().count()) === 1);

    // R7 — B15-27b r2 (Bones finding 4): Accept pending at A -> B; it finishes with timestamp_failed while A is
    // hidden. Back on A the recovery is there (kept for A's deal); B never gets it, nothing is written to B.
    await freshA();
    c.refuseNext.push(isWrite('contact.lastCallAttempt', RA));   // refused before sending -> timestamp_failed
    h = hold(isWrite('contact.lastCallAttempt', RA));
    if (!(await acceptConfirm().count())) await acceptToggle().click();
    await acceptConfirm().waitFor({ timeout: 5000 });
    await acceptConfirm().click();
    await h.hit;   // the offer and the acceptance note are written; the last touch is pending
    await toB();
    h.release();
    await until(async () => c.log.some((r) => r.kind === 'write' && r.op === 'contact.lastCallAttempt' && r.contact === RA && r.done), 'R7 touch refused');
    await settle(1500);
    check('R7 while A is hidden its Accept finished: B shows no recovery and nothing is written to B', (await recover().count()) === 0 && !bTouched(), opsFor(B));
    await toA();
    await until(async () => (await recover().count()) > 0, 'R7 A recovery').catch(() => {});
    check('R7 back on A, the timestamp recovery recorded while A was hidden is offered', (await recover().count()) === 1);
    if ((await recover().count()) > 0) await recover().click();   // conditional, so a negative control runs on
    await until(async () => (await recover().count()) === 0, 'R7 recovered').catch(() => {});
    await settle(500);
    check('R7 it recovers A\'s timestamp on A, once', c.log.filter((r) => r.kind === 'write' && r.op === 'contact.lastCallAttempt' && r.contact === RA && r.status === 200).length === 1 && !bTouched());

    // R8 — B15-27b r2: the readiness-invalidation RETRY (an effect, not a click), rendered. A's approved decision
    // goes stale (the seller price changes), so the page writes the invalidation note; it is held across A -> B.
    const INVALIDATION = 'IAOS OFFER READINESS DECISION INVALIDATION';
    const isInvalidation = (r) => r.kind === 'write' && r.op === 'note.create' && r.contact === RA && r.args && String(r.args.body).includes(INVALIDATION);
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
    // same contact (positive): the invalidation note is written and shown on A
    await freshA();
    await approveThenStale();
    await until(async () => c.log.some((r) => isInvalidation(r) && r.done), 'R8p invalidation write').catch(() => {});
    await settle(600);
    check('R8p same contact: a stale decision writes its invalidation note once, shown in A\'s notes',
      c.log.filter((r) => isInvalidation(r)).length === 1 && (await notesText()).includes(INVALIDATION));
    // success while B is shown
    await freshA();
    h = hold(isInvalidation);
    await approveThenStale();
    await h.hit;
    await toB();
    h.release();
    await until(async () => c.log.some((r) => isInvalidation(r) && r.done), 'R8 invalidation lands');
    await settle(800);
    check('R8 A -> B with A\'s invalidation retry pending: A\'s invalidation note never appears in B\'s Notes list', !(await notesText()).includes(INVALIDATION) && !bTouched());
    // failure while B is shown
    await freshA();
    h = hold(isInvalidation); c.failNext.push(isInvalidation);
    await approveThenStale();
    await h.hit;
    await toB();
    h.release();
    await until(async () => c.log.some((r) => isInvalidation(r) && r.status === 500), 'R8 invalidation fails');
    await settle(800);
    check('R8 A\'s failed invalidation retry shows no error on B', (await page.getByTestId('readiness-invalidation-write-error').count()) === 0 && !(await text()).includes(INJECTED));

    // ── P4 ─────────────────────────────────────────────────────────────────
    const actions = [
      { id: 'R3', what: 'property-identity withdrawal', setup: async () => {},
        start: async () => page.getByTestId('withdraw-property-identity').click(),
        sameContact: async () => (await page.getByTestId('property-identity-status').innerText()).includes('not yet confirmed') },
      { id: 'R4', what: 'readiness approval', setup: async () => {
          const panel = page.getByTestId('readiness-human-action-panel');
          await panel.waitFor({ timeout: 15000 });
          if (!(await panel.evaluate((el) => el.open))) await panel.locator('summary').first().click();
          await page.getByTestId('readiness-approve-button').waitFor({ timeout: 5000 });
        },
        start: async () => page.getByTestId('readiness-approve-button').click(),
        sameContact: async () => (await page.getByTestId('readiness-human-action-current').count()) > 0 },
      { id: 'R5', what: 'Contract Ready item', setup: accept,
        start: async () => page.locator('[data-testid^="contract-ready-item-"]').first().click(),
        sameContact: async () => page.locator('[data-testid^="contract-ready-item-"]').first().isChecked() },
      { id: 'R6', what: 'above-Max override', setup: async () => {
          const input = page.getByTestId('negotiation-current-offer-input');
          await input.fill('450000');
          await input.evaluate((el) => el.blur());
          await until(async () => (await page.getByTestId('negotiation-override-acknowledge-checkbox').count()) > 0, 'above-Max warning');
          await page.getByTestId('negotiation-override-acknowledge-checkbox').check();
          await page.getByTestId('negotiation-override-reason-input').fill('B15-27b override reason');
        },
        start: async () => page.getByTestId('negotiation-action-override-continue').click(),
        sameContact: async () => (await page.getByTestId('negotiation-override-acknowledged').count()) > 0 },
    ];
    for (const a of actions) {
      // same contact (positive)
      await freshA();
      await a.setup();
      const n0 = doneWrites(RA, 'note.create');
      await a.start();
      await until(async () => doneWrites(RA, 'note.create') > n0, `${a.id} same-contact write`).catch(() => {});
      await settle(600);
      check(`${a.id}p same contact: the ${a.what} is written once for A and shown on A`,
        doneWrites(RA, 'note.create') === n0 + 1 && (await a.sameContact()), { notes: doneWrites(RA, 'note.create') - n0 });
      // success while B is shown
      await freshA();
      await a.setup();
      const n1 = c.log.filter((r) => r.kind === 'write' && r.op === 'note.create' && r.contact === RA).length;
      h = hold(isWrite('note.create', RA));
      await a.start();
      await h.hit;
      await toB();
      const bNotesBefore = await notesText();
      h.release();
      await until(async () => doneWrites(RA, 'note.create') > n1 - (n1 > 0 ? 0 : 0) && c.log.filter((r) => r.kind === 'write' && r.op === 'note.create' && r.contact === RA && r.done).length >= n1 + 1, `${a.id} A write`);
      await settle(800);
      const bNotes = await notesText();
      check(`${a.id} A -> B while A's ${a.what} is pending: A's note never appears in B's Notes list`, !bNotes.includes(MARK) && bNotesBefore.includes('Seed note for Bravo'), bNotes.slice(0, 200));
      check(`${a.id} the ${a.what} wrote exactly one note, for A; nothing for B`,
        c.log.filter((r) => r.kind === 'write' && r.op === 'note.create' && r.contact === RA).length === n1 + 1 && !bTouched(), opsFor());
      // failure while B is shown
      await freshA();
      await a.setup();
      h = holdThenFail('note.create', RA);
      await a.start();
      await h.hit;
      await toB();
      h.release();
      await until(async () => c.log.some((r) => r.kind === 'write' && r.op === 'note.create' && r.contact === RA && r.status === 500), `${a.id} A failure`);
      await settle(800);
      check(`${a.id} A's failed ${a.what} shows no error on B`, !(await allText()).includes(INJECTED), (await text()).split('\n').filter((l) => /fail|couldn/i.test(l)).slice(0, 3));
    }
  },
});
