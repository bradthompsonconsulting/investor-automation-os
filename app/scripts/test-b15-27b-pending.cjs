/**
 * B15-27b P1 -- per-contact saving state on the Contact page: A -> B -> A while
 * A's save is still pending can never start a second, overlapping save for A,
 * and A's pending save never blocks B.
 *
 * Offline, rendered (scripts/harness/b15-27b/runner.cjs). A's write is HELD,
 * the page goes to B and back to A, and then:
 *   U1  Set Callback: back on A the control's Save is disabled; a forced click
 *       AND a direct call of the rendered Save handler send nothing; when the
 *       hold is released A has exactly one callback, one note, one attempt.
 *   U2  note box: back on A it shows "Saving..." and is disabled; typing and
 *       leaving it through the rendered handlers sends nothing; exactly one
 *       note and one attempt for A.
 *   U3  Clear Callback: back on A, Clear is disabled; a direct call of its
 *       handler sends nothing; exactly one clear.
 *   U4  meanwhile B is usable: B's note box and B's callback control are
 *       enabled while A's save is pending, and B's own note saves for B.
 *   U5  not stuck: A's save finishes while B is shown; back on A the controls
 *       are enabled again.
 * Writes: every write goes to its own contact, in the accepted order.
 *
 * NEGATIVE CONTROLS: --before=108a519 (U1-U3 fail: the regression this fixes);
 * --before=16bcf12 (U4 fails: main blocked B with A's busy state).
 */
const { run, twoContacts } = require('./harness/b15-27b/runner.cjs');

run({
  title: 'B15-27b P1 per-contact saving state',
  floor: 25,
  fixture: twoContacts(),
  scenarios: async (c) => {
    const { page, A, B, check, hold, isWrite, opsFor, writes, doneWrites, text, settle, until, go, fresh, invokeProp } = c;
    const contactLoaded = (first) => until(async () => (await text()).includes(`Seed note for ${first}`), `${first} notes`);
    const noteBox = () => page.locator('input[placeholder="New note (any text = attempted)…"], input[placeholder="Saving…"]');
    const openCallback = async () => {
      if ((await page.locator('input[type="datetime-local"]').count()) === 0) await page.getByRole('button', { name: /^(Set|Change) Callback$/ }).first().click();
      await until(async () => (await page.locator('input[type="datetime-local"]').count()) === 1, 'callback control');
    };
    const saveBtn = () => page.getByRole('button', { name: 'Save', exact: true });
    const clearBtn = () => page.getByRole('button', { name: 'Clear', exact: true });
    const CALLBACK_OPS = ['contact.explicitCallback', 'note.create', 'contact.lastCallAttempt'];
    const NOTE_OPS = ['note.create', 'contact.lastCallAttempt'];
    const aba = async () => { await go(`/contacts/${B}`); await contactLoaded('Bravo'); await go(`/contacts/${A}`); await contactLoaded('Alpha'); };

    // U1 — Set Callback pending, A -> B -> A.
    await fresh({}, `/contacts/${A}`);
    await contactLoaded('Alpha');
    await openCallback();
    await page.locator('input[type="datetime-local"]').fill('2026-10-06T10:00');
    let h = hold(isWrite('contact.explicitCallback', A));
    await saveBtn().click();
    await h.hit;
    await aba();
    await openCallback();
    check('U1 back on A while A\'s callback save is pending: Save is disabled', await saveBtn().isDisabled());
    await saveBtn().click({ force: true, timeout: 2000 }).catch(() => {});
    const invoked1 = await invokeProp(saveBtn(), 'onClick');
    await settle();
    check('U1 a forced click and a direct call of the Save handler send no second callback write', invoked1 && opsFor(A).filter((o) => o === 'contact.explicitCallback').length === 1, { invoked1, ops: opsFor(A) });
    h.release();
    await until(async () => doneWrites(A, 'contact.lastCallAttempt') >= 1, 'U1 A writes');
    await settle(600);
    check('U1 exactly one callback, one note and one attempt for A, in order; nothing for B',
      JSON.stringify(opsFor(A)) === JSON.stringify(CALLBACK_OPS) && writes(B).length === 0, opsFor());
    check('U1 A shows its callback once the save finishes', (await text()).includes('Callback: Oct 6, 10:00 AM'));

    // U2 — note save pending, A -> B -> A.
    await fresh({}, `/contacts/${A}`);
    await contactLoaded('Alpha');
    h = hold(isWrite('note.create', A));
    await noteBox().fill('B15-27b U2 Alpha note');
    await noteBox().press('Tab');
    await h.hit;
    await aba();
    const u2 = { disabled: await noteBox().isDisabled(), placeholder: await noteBox().getAttribute('placeholder') };
    check('U2 back on A while A\'s note save is pending: the note box shows Saving… and is disabled', u2.disabled && u2.placeholder === 'Saving…', u2);
    const typed = await invokeProp(noteBox(), 'onChange', { target: { value: 'B15-27b U2 duplicate attempt' } });
    await settle(150);
    const left = await invokeProp(noteBox(), 'onBlur', '__el__');
    await settle();
    check('U2 typing and leaving the box through its handlers sends no second note', typed && left && opsFor(A).filter((o) => o === 'note.create').length === 1, { typed, left, ops: opsFor(A) });
    h.release();
    await until(async () => doneWrites(A, 'contact.lastCallAttempt') >= 1, 'U2 A writes');
    await settle(600);
    check('U2 exactly one note and one attempt for A; nothing for B', JSON.stringify(opsFor(A)) === JSON.stringify(NOTE_OPS) && writes(B).length === 0, opsFor());
    check('U2 the box is usable again once A\'s save finishes', !(await noteBox().isDisabled()));

    // U3 — Clear Callback pending, A -> B -> A.
    await fresh({ aCallback: c.A_CALLBACK }, `/contacts/${A}`);
    await contactLoaded('Alpha');
    await until(async () => (await text()).includes('Callback: Oct 6, 10:00 AM'), 'U3 A callback');
    await openCallback();
    h = hold(isWrite('contact.explicitCallback', A));
    await clearBtn().click();
    await h.hit;
    await aba();
    await openCallback();
    check('U3 back on A while A\'s clear is pending: Clear and Save are disabled', (await clearBtn().count()) === 1 && (await clearBtn().isDisabled()) && (await saveBtn().isDisabled()));
    const invoked3 = await invokeProp(clearBtn(), 'onClick');
    await settle();
    check('U3 a direct call of the Clear handler sends no second clear', invoked3 && opsFor(A).length === 1, { invoked3, ops: opsFor(A) });
    h.release();
    await until(async () => doneWrites(A, 'contact.explicitCallback') >= 1, 'U3 A clear');
    await settle(600);
    check('U3 exactly one clear for A; nothing else written', JSON.stringify(opsFor()) === JSON.stringify(['contact.explicitCallback']), opsFor());

    // U4 — B is usable while A's note save is pending; B saves its own note.
    await fresh({}, `/contacts/${A}`);
    await contactLoaded('Alpha');
    h = hold(isWrite('note.create', A));
    await noteBox().fill('B15-27b U4 Alpha note');
    await noteBox().press('Tab');
    await h.hit;
    await go(`/contacts/${B}`);
    await contactLoaded('Bravo');
    check('U4 A\'s pending note save does not disable B\'s note box', !(await noteBox().isDisabled()));
    await openCallback();
    check('U4 A\'s pending note save does not disable B\'s callback Save', !(await saveBtn().isDisabled()));
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click().catch(() => {});
    let bSaved = true;
    try { await noteBox().fill('B15-27b U4 Bravo note', { timeout: 3000 }); await noteBox().press('Tab', { timeout: 3000 }); } catch { bSaved = false; }
    if (bSaved) await until(async () => doneWrites(B, 'contact.lastCallAttempt') >= 1, 'U4 B save').catch(() => { bSaved = false; });
    check('U4 B saves its own note while A\'s is pending', bSaved && JSON.stringify(opsFor(B)) === JSON.stringify(NOTE_OPS), opsFor(B));
    h.release();
    await until(async () => doneWrites(A, 'contact.lastCallAttempt') >= 1, 'U4 A finish');
    await settle(600);
    check('U4 each note went to its own contact, once', c.fixture.db[A].notes.filter((n) => n.body === 'B15-27b U4 Alpha note').length === 1
      && c.fixture.db[B].notes.filter((n) => n.body === 'B15-27b U4 Bravo note').length === 1 && !c.fixture.db[B].notes.some((n) => n.body.includes('Alpha')));

    // U5 — not stuck: A's callback save finishes while B is shown; back on A the control is usable.
    await fresh({}, `/contacts/${A}`);
    await contactLoaded('Alpha');
    await openCallback();
    await page.locator('input[type="datetime-local"]').fill('2026-10-06T10:00');
    h = hold(isWrite('contact.explicitCallback', A));
    await saveBtn().click();
    await h.hit;
    await go(`/contacts/${B}`);
    await contactLoaded('Bravo');
    h.release();
    await until(async () => doneWrites(A, 'contact.lastCallAttempt') >= 1, 'U5 A writes');
    await settle(400);
    await go(`/contacts/${A}`);
    await contactLoaded('Alpha');
    await openCallback();
    check('U5 back on A after its save finished: the callback control is usable', !(await saveBtn().isDisabled()));
    check('U5 the note box is usable', !(await noteBox().isDisabled()));

    // U6 — same contact, no navigation: Save stays disabled while the save runs (unchanged), and enabled after.
    await fresh({}, `/contacts/${A}`);
    await contactLoaded('Alpha');
    await openCallback();
    await page.locator('input[type="datetime-local"]').fill('2026-10-06T10:00');
    h = hold(isWrite('contact.explicitCallback', A));
    await saveBtn().click();
    await h.hit;
    check('U6 same contact: Save is disabled while the save runs', await saveBtn().isDisabled());
    const invoked6 = await invokeProp(saveBtn(), 'onClick');
    await settle();
    check('U6 same contact: a direct call of the Save handler sends nothing more', invoked6 && opsFor(A).length === 1, opsFor(A));
    h.release();
    await until(async () => doneWrites(A, 'contact.lastCallAttempt') >= 1, 'U6 writes');
    await settle(400);
    check('U6 same contact: one callback sequence; the control closes and shows the callback',
      JSON.stringify(opsFor(A)) === JSON.stringify(CALLBACK_OPS) && (await text()).includes('Callback: Oct 6, 10:00 AM') && (await page.locator('input[type="datetime-local"]').count()) === 0);
    // U7 — same contact note box: busy while saving, then cleared and usable.
    h = hold(isWrite('note.create', A));
    await noteBox().fill('B15-27b U7 Alpha note');
    await noteBox().press('Tab');
    await h.hit;
    check('U7 same contact: the note box shows Saving… while the save runs', (await noteBox().getAttribute('placeholder')) === 'Saving…' && (await noteBox().isDisabled()));
    h.release();
    await until(async () => doneWrites(A, 'note.create') >= 2, 'U7 note');
    await until(async () => !(await noteBox().isDisabled()), 'U7 box usable').catch(() => {});
    check('U7 same contact: after the save the box is empty and usable', (await noteBox().inputValue()) === '' && !(await noteBox().isDisabled()));
    // U8 — same contact failure: the error shows and the busy state ends.
    c.failNext.push(isWrite('note.create', A));
    await noteBox().fill('B15-27b U8 Alpha note');
    await noteBox().press('Tab');
    await until(async () => (await text()).includes('fixture: injected failure'), 'U8 error').catch(() => {});
    check('U8 same contact: a failed note save is reported and the box is usable again', (await text()).includes('fixture: injected failure') && !(await noteBox().isDisabled()));
  },
});
