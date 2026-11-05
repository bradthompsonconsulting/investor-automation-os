/**
 * B15-27b r2 -- Bones REVISE (d22499d) findings 1 and 3, rendered.
 *
 * Offline (scripts/harness/b15-27b/runner.cjs, fixture twoContacts).
 *
 *   F1  A late save for one record never changes another record's uncertainty
 *       notice. A's note save is held; on B a note save is aborted (uncertain:
 *       B is "may already be in GHL" and its lock is released); then A's save
 *       lands. B stays uncertain -- shown, stored, and leaving B's box sends
 *       nothing. A's own draft is still cleaned up.
 *   F1b The same with the OPERATOR replaced during A's outstanding save: the new
 *       operator's uncertain draft on A is untouched when the old operator's
 *       save lands, and the old operator's kept draft is cleaned up.
 *   F3  Outcome completion is bound to the exact deal. Contact A has two deals.
 *       A Pass on deal 1 is held; the page moves (via B) to deal 2 of the SAME
 *       contact, where a Pass reason is typed; then deal 1's Pass lands (and, in
 *       a second case, fails). Deal 2's form, reason and saved draft are untouched
 *       and show no error from deal 1; deal 1's note is written for deal 1 and
 *       its draft is removed.
 *
 * NEGATIVE CONTROL: --before=d22499d must fail F1, F1b and F3.
 */
const { run, twoContacts } = require('./harness/b15-27b/runner.cjs');

const fixture = twoContacts();
run({
  title: 'B15-27b r2 notice isolation and deal-bound outcomes',
  floor: 23,
  fixture,
  scenarios: async (c) => {
    const { page, A, B, check, hold, isWrite, holdThenFail, opsFor, doneWrites, text, settle, until, go, fresh, load, setOperator } = c;
    const contactLoaded = (first) => until(async () => (await text()).includes(`Seed note for ${first}`), `${first} notes`);
    const noteBox = () => page.locator('input[placeholder="New note (any text = attempted)…"], input[placeholder="Saving…"]');
    const notice = async (testid) => { const el = page.getByTestId(testid); return (await el.count()) ? await el.getAttribute('data-draft-state') : null; };
    const notesFor = (cid) => opsFor(cid).filter((o) => o === 'note.create').length;

    // ── F1 ──
    await fresh({}, `/contacts/${A}`);
    await contactLoaded('Alpha');
    let h = hold(isWrite('note.create', A));
    await noteBox().fill('F1 Alpha note');
    await noteBox().press('Tab');
    await h.hit;
    await go(`/contacts/${B}`);
    await contactLoaded('Bravo');
    c.abortNext.push(isWrite('note.create', B));
    await noteBox().fill('F1 Bravo note');
    await noteBox().press('Tab');
    await until(async () => (await notice('note-draft')) === 'sending' && !(await noteBox().isDisabled()), 'F1 B uncertain, unlocked').catch(() => {});
    check('F1 B\'s aborted save: B is "may already be in GHL" and its lock is released', (await notice('note-draft')) === 'sending');
    h.release();   // A's save lands now
    await until(async () => doneWrites(A, 'contact.lastCallAttempt') >= 1, 'F1 A lands');
    await settle(600);
    check('F1 after A\'s late save lands, B\'s uncertainty notice is still shown', (await notice('note-draft')) === 'sending', await notice('note-draft'));
    const bBefore = notesFor(B);
    await noteBox().focus(); await noteBox().press('Tab');
    await settle(600);
    check('F1 and leaving B\'s box sends nothing (no blind re-send)', notesFor(B) === bBefore, opsFor(B));
    await load(`/contacts/${B}`);
    await contactLoaded('Bravo');
    check('F1 B\'s stored record is still uncertain after a reload', (await noteBox().inputValue()) === 'F1 Bravo note' && (await notice('note-draft')) === 'sending');
    await go(`/contacts/${A}`);
    await contactLoaded('Alpha');
    check('F1 A\'s own draft was cleaned up when its save landed', (await noteBox().inputValue()) === '' && (await notice('note-draft')) === null);

    // ── F1b: operator replaced during an outstanding save ──
    await fresh({}, `/contacts/${A}`, 'operator-two');
    await contactLoaded('Alpha');
    c.abortNext.push(isWrite('note.create', A));
    await noteBox().fill('F1b operator two note');
    await noteBox().press('Tab');
    await until(async () => (await notice('note-draft')) === 'sending', 'F1b op2 uncertain').catch(() => {});
    await setOperator('operator-one');
    await settle(300);
    check('F1b operator one on A sees none of operator two\'s draft', (await noteBox().inputValue()) === '' && (await notice('note-draft')) === null);
    h = hold(isWrite('note.create', A));
    await noteBox().fill('F1b operator one note');
    await noteBox().press('Tab');
    await h.hit;
    await setOperator('operator-two');   // replaced while operator one's save is outstanding
    await settle(300);
    h.release();
    await until(async () => doneWrites(A, 'contact.lastCallAttempt') >= 1, 'F1b op1 lands');
    await settle(600);
    check('F1b operator two\'s uncertain draft on A is untouched by operator one\'s landed save',
      (await noteBox().inputValue()) === 'F1b operator two note' && (await notice('note-draft')) === 'sending', { v: await noteBox().inputValue(), n: await notice('note-draft') });
    const a1b = notesFor(A);
    await noteBox().focus(); await noteBox().press('Tab');
    await settle(500);
    check('F1b leaving the box sends nothing for operator two', notesFor(A) === a1b, opsFor(A));
    await load(`/contacts/${A}`, 'operator-one');
    await contactLoaded('Alpha');
    check('F1b operator one\'s kept draft was cleaned up when its save landed', (await noteBox().inputValue()) === '' && (await notice('note-draft')) === null, await noteBox().inputValue());

    // ── F3: two deals of the same contact ──
    const scChoose = async (name) => {
      await until(async () => (await page.getByRole('button', { name, exact: true }).count()) > 0 || (await text()).includes(name), `${name} shown`);
      const btn = page.getByRole('button', { name, exact: true });
      if (await btn.count()) await btn.click();
      await until(async () => (await page.getByTestId('call-outcome-pass-toggle').count()) > 0, `${name} resolved`);
      await settle(300);
    };
    const openPass = async () => {
      if ((await page.getByTestId('call-outcome-pass-reason').count()) === 0) await page.getByTestId('call-outcome-pass-toggle').click();
    };
    const reason = async () => ((await page.getByTestId('call-outcome-pass-reason').count()) ? page.getByTestId('call-outcome-pass-reason').inputValue() : null);
    const toDeal2ViaB = async () => {
      await go(`/contacts/${B}/seller-call`);
      await scChoose('Bravo deal');            // B's choice replaces the remembered deal
      await go(`/contacts/${A}/seller-call`);
      await scChoose('Alpha deal 2');          // the SAME contact, its other deal
    };
    for (const variant of ['lands', 'fails']) {
      await fresh({ aDeals: 2, bDeals: 2 }, `/contacts/${A}/seller-call`);
      // deal 2 of A already holds an unfinished Pass reason (its own kept draft)
      await scChoose('Alpha deal 2');
      await openPass();
      await page.getByTestId('call-outcome-pass-reason').fill('F3 deal 2 reason');
      await settle(300);
      await go(`/contacts/${B}/seller-call`);
      await scChoose('Bravo deal');
      await go(`/contacts/${A}/seller-call`);
      await scChoose('Alpha deal');
      // a Pass on deal 1 of the SAME contact, held
      await openPass();
      await page.getByTestId('call-outcome-pass-reason').fill('F3 deal 1 reason');
      await until(async () => !(await page.getByTestId('call-outcome-pass-confirm').isDisabled()), 'F3 confirm');
      h = variant === 'lands' ? hold(isWrite('note.create', A)) : holdThenFail('note.create', A);
      await page.getByTestId('call-outcome-pass-confirm').click();
      await h.hit;
      await toDeal2ViaB();   // deal 2 of A shown, its draft restored, while deal 1's Pass is pending
      check(`F3 (${variant}) deal 2's own draft is restored while deal 1's Pass is pending`, (await reason()) === 'F3 deal 2 reason', await reason());
      h.release();
      await until(async () => c.log.some((r) => r.kind === 'write' && r.op === 'note.create' && r.contact === A && r.done), `F3 ${variant}`);
      await settle(1200);
      check(`F3 (${variant}) deal 1's late Pass leaves deal 2's open form and reason untouched`, (await reason()) === 'F3 deal 2 reason', await reason());
      check(`F3 (${variant}) and shows no error from deal 1 on deal 2`, (await page.getByTestId('call-outcome-error').count()) === 0);
      const notes = c.log.filter((r) => r.kind === 'write' && r.op === 'note.create' && r.contact === A);
      check(`F3 (${variant}) deal 1's Pass note was written for deal 1, once`, notes.length === 1 && /\nOpportunity: fixtureContactA-opp\n/.test(notes[0].args.body), notes.map((r) => r.args.body.split('\n').find((l) => l.startsWith('Opportunity'))));
      await load(`/contacts/${A}/seller-call`);
      await scChoose('Alpha deal 2');
      check(`F3 (${variant}) deal 2's draft survived (restored after a reload)`, (await reason()) === 'F3 deal 2 reason', await reason());
      await load(`/contacts/${A}/seller-call`);
      await scChoose('Alpha deal');
      const d1 = await reason();
      check(variant === 'lands' ? 'F3 (lands) deal 1\'s draft is removed: its Pass is recorded' : 'F3 (fails) deal 1\'s draft is kept, marked "may already be in GHL"',
        variant === 'lands' ? (d1 ?? '') === '' : d1 === 'F3 deal 1 reason' && (await notice('call-outcome-draft')) === 'sending', { d1, n: await notice('call-outcome-draft') });
    }
  },
});
